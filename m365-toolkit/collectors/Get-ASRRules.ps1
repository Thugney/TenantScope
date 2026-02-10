# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects Attack Surface Reduction (ASR) rules configuration and status.

.DESCRIPTION
    Retrieves ASR rules deployed via Intune endpoint security policies.
    Shows which rules are enabled, in audit mode, or disabled across
    the device fleet. Critical for endpoint protection posture.

    Graph API endpoints:
    - GET /deviceManagement/intents (Endpoint security policies)
    - GET /deviceManagement/templates (ASR templates)
    - GET /deviceManagement/configurationPolicies (Settings catalog ASR)

    Required scopes:
    - DeviceManagementConfiguration.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes asr-rules.json to the specified output path.

.EXAMPLE
    $result = & .\collectors\Get-ASRRules.ps1 -Config $config -OutputPath ".\data\asr-rules.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.DeviceManagement

param(
    [Parameter(Mandatory)]
    [hashtable]$Config,

    [Parameter(Mandatory)]
    [string]$OutputPath,

    [Parameter()]
    [hashtable]$SharedData = @{}
)

# ============================================================================
# IMPORT SHARED UTILITIES
# ============================================================================

. "$PSScriptRoot\..\lib\CollectorBase.ps1"

# ============================================================================
# ASR RULE DEFINITIONS
# ============================================================================

$ASRRuleDefinitions = @{
    "56a863a9-875e-4185-98a7-b882c64b5ce5" = "Block abuse of exploited vulnerable signed drivers"
    "7674ba52-37eb-4a4f-a9a1-f0f9a1619a2c" = "Block Adobe Reader from creating child processes"
    "d4f940ab-401b-4efc-aadc-ad5f3c50688a" = "Block all Office applications from creating child processes"
    "9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2" = "Block credential stealing from Windows LSASS"
    "be9ba2d9-53ea-4cdc-84e5-9b1eeee46550" = "Block executable content from email and webmail"
    "01443614-cd74-433a-b99e-2ecdc07bfc25" = "Block executable files from running unless they meet criteria"
    "5beb7efe-fd9a-4556-801d-275e5ffc04cc" = "Block execution of potentially obfuscated scripts"
    "d3e037e1-3eb8-44c8-a917-57927947596d" = "Block JavaScript or VBScript from launching downloaded content"
    "3b576869-a4ec-4529-8536-b80a7769e899" = "Block Office applications from creating executable content"
    "75668c1f-73b5-4cf0-bb93-3ecf5cb7cc84" = "Block Office applications from injecting code into other processes"
    "26190899-1602-49e8-8b27-eb1d0a1ce869" = "Block Office communication apps from creating child processes"
    "e6db77e5-3df2-4cf1-b95a-636979351e5b" = "Block persistence through WMI event subscription"
    "d1e49aac-8f56-4280-b9ba-993a6d77406c" = "Block process creations from PSExec and WMI commands"
    "b2b3f03d-6a65-4f7b-a9c7-1c7ef74a9ba4" = "Block untrusted and unsigned processes from USB"
    "92e97fa1-2edf-4476-bdd6-9dd0b4dddc7b" = "Block Win32 API calls from Office macros"
    "c1db55ab-c21a-4637-bb3f-a12568109d35" = "Use advanced protection against ransomware"
}

# ============================================================================
# LOCAL HELPER FUNCTIONS
# ============================================================================

function Get-ASRRuleMode {
    <#
    .SYNOPSIS
        Maps ASR rule mode values to readable strings.
    #>
    param([string]$Mode)

    switch ($Mode) {
        "0" { return "Disabled" }
        "1" { return "Block" }
        "2" { return "Audit" }
        "6" { return "Warn" }
        default { return $Mode }
    }
}

# ============================================================================
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$policyCount = 0

try {
    Write-Host "    Collecting Attack Surface Reduction rules..." -ForegroundColor Gray

    $asrData = @{
        policies = @()
        rulesSummary = @{}
        summary = @{
            totalPolicies = 0
            rulesInBlock = 0
            rulesInAudit = 0
            rulesDisabled = 0
            rulesInWarn = 0
        }
    }

    # Initialize rules summary
    foreach ($ruleId in $ASRRuleDefinitions.Keys) {
        $asrData.rulesSummary[$ruleId] = @{
            name = $ASRRuleDefinitions[$ruleId]
            blockCount = 0
            auditCount = 0
            warnCount = 0
            disabledCount = 0
        }
    }

    # ========================================
    # Get Endpoint Security Intents (ASR Policies)
    # ========================================
    try {
        # Get ASR templates first
        $templates = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/templates?`$filter=templateType eq 'securityBaseline'" `
                -OutputType PSObject
        } -OperationName "Security templates retrieval"

        # Get intents (policies based on templates)
        $intents = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/intents" `
                -OutputType PSObject
        } -OperationName "Security intents retrieval"

        foreach ($intent in $intents.value) {
            # Get intent settings
            try {
                $settings = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/intents/$($intent.id)/settings" `
                    -OutputType PSObject

                $asrSettings = @()

                foreach ($setting in $settings.value) {
                    # Check if this is an ASR rule setting
                    if ($setting.definitionId -match "attackSurfaceReduction" -or $setting.definitionId -match "asr") {
                        $ruleId = $null
                        $ruleMode = $null

                        # Extract rule ID and mode from setting
                        if ($setting.valueJson) {
                            $value = $setting.valueJson | ConvertFrom-Json -ErrorAction SilentlyContinue
                            if ($value) {
                                $ruleId = $value.ruleId
                                $ruleMode = $value.state
                            }
                        }

                        if ($ruleId -and $ASRRuleDefinitions.ContainsKey($ruleId)) {
                            $mode = Get-ASRRuleMode -Mode $ruleMode
                            $asrSettings += @{
                                ruleId = $ruleId
                                ruleName = $ASRRuleDefinitions[$ruleId]
                                mode = $mode
                            }

                            # Update summary
                            switch ($mode) {
                                "Block"    { $asrData.rulesSummary[$ruleId].blockCount++; $asrData.summary.rulesInBlock++ }
                                "Audit"    { $asrData.rulesSummary[$ruleId].auditCount++; $asrData.summary.rulesInAudit++ }
                                "Warn"     { $asrData.rulesSummary[$ruleId].warnCount++; $asrData.summary.rulesInWarn++ }
                                "Disabled" { $asrData.rulesSummary[$ruleId].disabledCount++; $asrData.summary.rulesDisabled++ }
                            }
                        }
                    }
                }

                if ($asrSettings.Count -gt 0) {
                    $asrData.policies += [PSCustomObject]@{
                        id                   = $intent.id
                        displayName          = $intent.displayName
                        description          = $intent.description
                        templateId           = $intent.templateId
                        createdDateTime      = Format-IsoDate -DateValue $intent.createdDateTime
                        lastModifiedDateTime = Format-IsoDate -DateValue $intent.lastModifiedDateTime
                        isAssigned           = $intent.isAssigned
                        asrRules             = $asrSettings
                        ruleCount            = $asrSettings.Count
                    }
                    $policyCount++
                }
            }
            catch {
                # Intent may not have accessible settings
            }
        }

        Write-Host "      Retrieved $policyCount ASR policies from intents" -ForegroundColor Gray
    }
    catch {
        $errors += "Intents: $($_.Exception.Message)"
    }

    # ========================================
    # Get Settings Catalog ASR Policies
    # ========================================
    try {
        $configPolicies = Invoke-GraphWithRetry -ScriptBlock {
            Invoke-MgGraphRequest -Method GET `
                -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies?`$filter=templateReference/templateFamily eq 'endpointSecurityAttackSurfaceReduction'" `
                -OutputType PSObject
        } -OperationName "Settings catalog ASR retrieval"

        foreach ($policy in $configPolicies.value) {
            try {
                # Get policy settings
                $policySettings = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies/$($policy.id)/settings" `
                    -OutputType PSObject

                $asrRules = @()

                foreach ($setting in $policySettings.value) {
                    $settingInstance = $setting.settingInstance
                    if ($settingInstance -and $settingInstance.settingDefinitionId -match "attacksurfacereductionrules") {
                        # Parse the complex setting structure
                        if ($settingInstance.groupSettingCollectionValue) {
                            foreach ($group in $settingInstance.groupSettingCollectionValue) {
                                $ruleId = $null
                                $ruleMode = $null

                                foreach ($child in $group.children) {
                                    if ($child.settingDefinitionId -match "_perrulesettings_") {
                                        $ruleId = $child.choiceSettingValue.value -replace ".*_", ""
                                    }
                                    if ($child.settingDefinitionId -match "_state") {
                                        $ruleMode = $child.choiceSettingValue.value -replace ".*_", ""
                                    }
                                }

                                if ($ruleId -and $ASRRuleDefinitions.ContainsKey($ruleId)) {
                                    $mode = Get-ASRRuleMode -Mode $ruleMode
                                    $asrRules += @{
                                        ruleId = $ruleId
                                        ruleName = $ASRRuleDefinitions[$ruleId]
                                        mode = $mode
                                    }

                                    # Update summary for settings catalog policies
                                    switch ($mode) {
                                        "Block"    { $asrData.rulesSummary[$ruleId].blockCount++; $asrData.summary.rulesInBlock++ }
                                        "Audit"    { $asrData.rulesSummary[$ruleId].auditCount++; $asrData.summary.rulesInAudit++ }
                                        "Warn"     { $asrData.rulesSummary[$ruleId].warnCount++; $asrData.summary.rulesInWarn++ }
                                        "Disabled" { $asrData.rulesSummary[$ruleId].disabledCount++; $asrData.summary.rulesDisabled++ }
                                    }
                                }
                            }
                        }
                    }
                }

                if ($asrRules.Count -gt 0) {
                    $asrData.policies += [PSCustomObject]@{
                        id                   = $policy.id
                        displayName          = $policy.name
                        description          = $policy.description
                        source               = "SettingsCatalog"
                        createdDateTime      = Format-IsoDate -DateValue $policy.createdDateTime
                        lastModifiedDateTime = Format-IsoDate -DateValue $policy.lastModifiedDateTime
                        asrRules             = $asrRules
                        ruleCount            = $asrRules.Count
                    }
                    $policyCount++
                }
            }
            catch {
                # Policy settings may not be accessible
            }
        }

        Write-Host "      Retrieved additional ASR policies from settings catalog" -ForegroundColor Gray
    }
    catch {
        $errors += "Settings catalog: $($_.Exception.Message)"
    }

    # Convert rules summary to array for easier dashboard consumption
    $asrData.rulesArray = @()
    foreach ($ruleId in $ASRRuleDefinitions.Keys) {
        $ruleSummary = $asrData.rulesSummary[$ruleId]
        $asrData.rulesArray += [PSCustomObject]@{
            ruleId        = $ruleId
            ruleName      = $ruleSummary.name
            blockCount    = $ruleSummary.blockCount
            auditCount    = $ruleSummary.auditCount
            warnCount     = $ruleSummary.warnCount
            disabledCount = $ruleSummary.disabledCount
            isDeployed    = ($ruleSummary.blockCount + $ruleSummary.auditCount + $ruleSummary.warnCount -gt 0)
        }
    }

    $asrData.summary.totalPolicies = $policyCount
    $asrData.collectionDate = (Get-Date).ToString("o")

    # Save data
    Save-CollectorData -Data $asrData -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $policyCount ASR policies" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $policyCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    if ($errorMessage -match "permission|forbidden|Authorization") {
        Write-Host "    [!] ASR rules collection requires DeviceManagementConfiguration.Read.All permission" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    Save-CollectorData -Data @{
        policies = @()
        rulesSummary = @{}
        summary = @{}
    } -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
