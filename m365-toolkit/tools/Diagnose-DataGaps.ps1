# ============================================================================
# TenantScope - Data Gap Diagnostics
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Compares sample vs real data to flag missing fields and zeroed metrics.

.DESCRIPTION
    This script scans the collected data (*.json) and the sample data
    (data/sample/*.json), then:
    - Finds the primary array for each dataset
    - Compares property sets (sample vs real)
    - Flags numeric fields that are populated in sample but all-zero in real
    - Flags summary numeric fields that are >0 in sample but 0 in real

    It is designed to quickly identify collectors that are missing required
    fields or returning zeroed metrics despite non-empty datasets.

.PARAMETER DataRoot
    Path to the real data folder (default: ../data)

.PARAMETER SampleRoot
    Path to the sample data folder (default: ../data/sample)

.PARAMETER MinRowCount
    Minimum number of rows required before running value checks.

.PARAMETER NonZeroSampleThreshold
    Minimum fraction of non-zero values in sample to consider a field "populated".
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$DataRoot = (Join-Path $PSScriptRoot ".." "data"),

    [Parameter()]
    [string]$SampleRoot = (Join-Path $PSScriptRoot ".." "data" "sample"),

    [Parameter()]
    [int]$MinRowCount = 5,

    [Parameter()]
    [double]$NonZeroSampleThreshold = 0.2
)

function Get-PrimaryArray {
    param([Parameter(Mandatory)]$Obj)

    if ($Obj -is [System.Array]) {
        return @{ Path = '$'; Items = $Obj }
    }

    $preferred = @(
        "apps","users","groups","devices","signIns","policies","profiles",
        "teams","sites","applications","grants","controls","riskyUsers",
        "riskDetections","deviceScores","devicePerformance","deviceAppHealth",
        "serviceHealth","messageCenter","rulesArray"
    )

    foreach ($name in $preferred) {
        $prop = $Obj.PSObject.Properties[$name]
        if ($prop -and ($prop.Value -is [System.Array])) {
            return @{ Path = $name; Items = $prop.Value }
        }
    }

    $arrayProps = $Obj.PSObject.Properties | Where-Object { $_.Value -is [System.Array] }
    if ($arrayProps.Count -gt 0) {
        $largest = $arrayProps | Sort-Object { $_.Value.Count } -Descending | Select-Object -First 1
        return @{ Path = $largest.Name; Items = $largest.Value }
    }

    return @{ Path = $null; Items = @() }
}

function Get-PropNames {
    param([Parameter(Mandatory)][array]$Items)
    if (-not $Items -or $Items.Count -eq 0) { return @() }
    return (($Items | Select-Object -First 1 | Get-Member -MemberType NoteProperty).Name)
}

function Get-NumericFields {
    param([Parameter(Mandatory)][array]$Items)
    if ($Items.Count -eq 0) { return @() }
    $props = Get-PropNames -Items $Items
    $numeric = @()
    foreach ($p in $props) {
        $hasNumeric = $false
        foreach ($item in $Items) {
            $v = $item.$p
            if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) {
                $hasNumeric = $true
                break
            }
        }
        if ($hasNumeric) { $numeric += $p }
    }
    return $numeric
}

function Get-NonZeroRate {
    param(
        [Parameter(Mandatory)][array]$Items,
        [Parameter(Mandatory)][string]$Field
    )
    if ($Items.Count -eq 0) { return 0 }
    $nonZero = 0
    foreach ($item in $Items) {
        $v = $item.$Field
        if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) {
            if ($v -ne 0) { $nonZero++ }
        }
    }
    return $nonZero / $Items.Count
}

function Get-SummaryZeroFields {
    param(
        [Parameter(Mandatory)]$SampleSummary,
        [Parameter(Mandatory)]$RealSummary
    )
    if ($null -eq $SampleSummary -or $null -eq $RealSummary) { return @() }
    $result = @()
    foreach ($prop in $SampleSummary.PSObject.Properties) {
        $name = $prop.Name
        $sv = $SampleSummary.$name
        $rv = $RealSummary.$name
        if ($sv -is [int] -or $sv -is [long] -or $sv -is [double] -or $sv -is [decimal]) {
            if ($sv -gt 0 -and ($rv -eq 0 -or $null -eq $rv)) {
                $result += $name
            }
        }
    }
    return $result
}

if (-not (Test-Path $DataRoot)) { throw "DataRoot not found: $DataRoot" }
if (-not (Test-Path $SampleRoot)) { throw "SampleRoot not found: $SampleRoot" }

$sampleFiles = Get-ChildItem -Path $SampleRoot -Filter "*.json"
if ($sampleFiles.Count -eq 0) {
    Write-Host "No sample files found in $SampleRoot" -ForegroundColor Yellow
    exit 1
}

Write-Host "TenantScope Data Gap Report" -ForegroundColor Cyan
Write-Host "DataRoot:   $DataRoot"
Write-Host "SampleRoot: $SampleRoot"
Write-Host ""

foreach ($s in $sampleFiles) {
    if ($s.Name -eq "collection-metadata.json") { continue }
    $realPath = Join-Path $DataRoot $s.Name
    if (-not (Test-Path $realPath)) { continue }

    $sampleObj = Get-Content $s.FullName -Raw | ConvertFrom-Json
    $realObj = Get-Content $realPath -Raw | ConvertFrom-Json

    $samplePrimary = Get-PrimaryArray -Obj $sampleObj
    $realPrimary = Get-PrimaryArray -Obj $realObj
    $realPrimaryPath = $samplePrimary.Path
    if ($realPrimaryPath -and $realObj.PSObject.Properties[$realPrimaryPath] -and ($realObj.$realPrimaryPath -is [System.Array])) {
        $realPrimary = @{ Path = $realPrimaryPath; Items = $realObj.$realPrimaryPath }
    }

    $sampleItems = $samplePrimary.Items
    $realItems = $realPrimary.Items

    $sampleProps = Get-PropNames -Items $sampleItems
    $realProps = Get-PropNames -Items $realItems

    $missingProps = @()
    if ($sampleProps.Count -gt 0) {
        $missingProps = $sampleProps | Where-Object { $realProps -notcontains $_ }
    }

    $zeroedFields = @()
    if ($sampleItems.Count -ge $MinRowCount -and $realItems.Count -ge $MinRowCount) {
        $numericFields = Get-NumericFields -Items $sampleItems
        foreach ($f in $numericFields) {
            $sampleRate = Get-NonZeroRate -Items $sampleItems -Field $f
            $realRate = Get-NonZeroRate -Items $realItems -Field $f
            if ($sampleRate -ge $NonZeroSampleThreshold -and $realRate -eq 0) {
                $zeroedFields += $f
            }
        }
    }

    $summaryZero = Get-SummaryZeroFields -SampleSummary $sampleObj.summary -RealSummary $realObj.summary

    if ($missingProps.Count -gt 0 -or $zeroedFields.Count -gt 0 -or $summaryZero.Count -gt 0) {
        Write-Host "File: $($s.Name)" -ForegroundColor Yellow
        Write-Host "Primary array: sample=$($samplePrimary.Path)($($sampleItems.Count)) real=$($realPrimary.Path)($($realItems.Count))"
        if ($missingProps.Count -gt 0) {
            Write-Host "Missing fields: $($missingProps -join ', ')"
        }
        if ($zeroedFields.Count -gt 0) {
            Write-Host "Zeroed numeric fields: $($zeroedFields -join ', ')"
        }
        if ($summaryZero.Count -gt 0) {
            Write-Host "Summary fields zeroed: $($summaryZero -join ', ')"
        }
        Write-Host ""
    }
}
