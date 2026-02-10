# ============================================================================
# TenantScope
# Author: Robel (https://github.com/Thugney)
# Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT
# License: MIT
# ============================================================================

<#
.SYNOPSIS
    Collects MFA registration status for all users from Microsoft Graph.

.DESCRIPTION
    Retrieves authentication method registration details for each user,
    including whether they have MFA registered, which methods they use,
    and their default authentication method.

    Graph API endpoint: GET /reports/authenticationMethods/userRegistrationDetails
    Required scope: Reports.Read.All, AuditLog.Read.All

.PARAMETER Config
    The configuration hashtable loaded from config.json.

.PARAMETER OutputPath
    Full path where the resulting JSON file will be saved.

.OUTPUTS
    Writes mfa-status.json to the specified output path. Returns a hashtable with:
    - Success: [bool] whether collection completed
    - Count: [int] number of MFA records collected
    - Errors: [array] any errors encountered

.EXAMPLE
    $result = & .\collectors\Get-MFAData.ps1 -Config $config -OutputPath ".\data\mfa-status.json"
#>

#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Reports

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
# MAIN COLLECTION LOGIC
# ============================================================================

$errors = @()
$mfaCount = 0

try {
    Write-Host "    Collecting MFA registration status..." -ForegroundColor Gray

    # Try to get MFA registration details from the reports endpoint
    # This endpoint provides comprehensive MFA status for all users
    $mfaDetails = $null

    try {
        # Use the authentication methods user registration details report
        $mfaDetails = Invoke-GraphWithRetry -ScriptBlock {
            Get-MgReportAuthenticationMethodUserRegistrationDetail -All
        } -OperationName "MFA registration retrieval"
    }
    catch {
        # If the cmdlet fails, try the direct API call
        Write-Host "      Trying alternative method..." -ForegroundColor Gray

        try {
            $mfaDetails = Invoke-GraphWithRetry -ScriptBlock {
                Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" -OutputType PSObject
            } -OperationName "MFA registration (direct API)"

            # Handle paged results if necessary
            if ($mfaDetails.value) {
                $allDetails = $mfaDetails.value
                while ($mfaDetails.'@odata.nextLink') {
                    $mfaDetails = Invoke-MgGraphRequest -Method GET -Uri $mfaDetails.'@odata.nextLink' -OutputType PSObject
                    if ($mfaDetails.value) {
                        $allDetails += $mfaDetails.value
                    }
                }
                $mfaDetails = $allDetails
            }
        }
        catch {
            throw "Unable to retrieve MFA data: $($_.Exception.Message)"
        }
    }

    if ($null -eq $mfaDetails) {
        throw "No MFA data returned from Graph API"
    }

    Write-Host "      Retrieved $($mfaDetails.Count) MFA records from Graph API" -ForegroundColor Gray

    # Process each MFA record
    $processedMfa = @()

    foreach ($record in $mfaDetails) {
        # Handle both PascalCase (cmdlet) and camelCase (direct API) property names
        # Core identity
        $recordId = if ($record.Id) { $record.Id } else { $record.id }
        $upn = Get-GraphPropertyValue -Object $record -PropertyNames @("userPrincipalName", "UserPrincipalName")
        $displayName = Get-GraphPropertyValue -Object $record -PropertyNames @("userDisplayName", "UserDisplayName")
        $userType = if ($record.UserType) { $record.UserType } else { $record.userType }

        # MFA status
        $mfaRegistered = if ($null -ne $record.IsMfaRegistered) { $record.IsMfaRegistered } else { $record.isMfaRegistered }
        $mfaCapable = if ($null -ne $record.IsMfaCapable) { $record.IsMfaCapable } else { $record.isMfaCapable }
        $defaultMfa = if ($record.DefaultMfaMethod) { $record.DefaultMfaMethod } else { $record.defaultMfaMethod }

        # Passwordless capabilities (critical for modern auth)
        $passwordlessCapable = if ($null -ne $record.IsPasswordlessCapable) { $record.IsPasswordlessCapable } else { $record.isPasswordlessCapable }

        # SSPR status (Self-Service Password Reset)
        $ssprRegistered = if ($null -ne $record.IsSsprRegistered) { $record.IsSsprRegistered } else { $record.isSsprRegistered }
        $ssprEnabled = if ($null -ne $record.IsSsprEnabled) { $record.IsSsprEnabled } else { $record.isSsprEnabled }
        $ssprCapable = if ($null -ne $record.IsSsprCapable) { $record.IsSsprCapable } else { $record.isSsprCapable }

        # System-managed authentication preferences
        $systemPreferredEnabled = if ($null -ne $record.IsSystemPreferredAuthenticationMethodEnabled) {
            $record.IsSystemPreferredAuthenticationMethodEnabled
        } else {
            $record.isSystemPreferredAuthenticationMethodEnabled
        }
        $systemPreferredMethods = if ($record.SystemPreferredAuthenticationMethods) {
            $record.SystemPreferredAuthenticationMethods
        } else {
            $record.systemPreferredAuthenticationMethods
        }

        # User preferences
        $userPreferredMethod = if ($record.UserPreferredMethodForSecondaryAuthentication) {
            $record.UserPreferredMethodForSecondaryAuthentication
        } else {
            $record.userPreferredMethodForSecondaryAuthentication
        }

        # Extract methods registered (handle both cases)
        $methods = @()
        if ($record.MethodsRegistered) {
            $methods = @($record.MethodsRegistered)
        }
        elseif ($record.methodsRegistered) {
            $methods = @($record.methodsRegistered)
        }

        # Last updated timestamp
        $lastUpdated = if ($record.LastUpdatedDateTime) {
            Format-IsoDate -DateValue $record.LastUpdatedDateTime
        } elseif ($record.lastUpdatedDateTime) {
            Format-IsoDate -DateValue $record.lastUpdatedDateTime
        } else {
            $null
        }

        # Derive additional security flags
        $methodCount = $methods.Count

        # Phishing-resistant methods: FIDO2, Windows Hello, Certificate
        $hasPhishingResistant = $false
        $phishingResistantMethods = @()
        foreach ($method in $methods) {
            if ($method -in @('fido2', 'windowsHelloForBusiness', 'x509Certificate', 'passKeyDeviceBound', 'passKeyDeviceBoundAuthenticator')) {
                $hasPhishingResistant = $true
                $phishingResistantMethods += $method
            }
        }

        # Weak methods: SMS, voice call (can be SIM-swapped)
        $hasWeakMethod = $false
        $weakMethods = @()
        foreach ($method in $methods) {
            if ($method -in @('mobilePhone', 'alternateMobilePhone', 'officePhone', 'voiceCall', 'sms')) {
                $hasWeakMethod = $true
                $weakMethods += $method
            }
        }

        # Strong methods (non-phishing-resistant but better than SMS)
        $hasStrongMethod = $false
        foreach ($method in $methods) {
            if ($method -in @('microsoftAuthenticatorPush', 'softwareOneTimePasscode', 'hardwareOneTimePasscode', 'microsoftAuthenticatorPasswordless')) {
                $hasStrongMethod = $true
            }
        }

        # Build comprehensive output object
        $mfaRecord = [PSCustomObject]@{
            # Core identity
            userId                   = $recordId
            userPrincipalName        = $upn
            userDisplayName          = $displayName
            userType                 = $userType

            # MFA status
            isMfaRegistered          = [bool]$mfaRegistered
            isMfaCapable             = [bool]$mfaCapable
            methods                  = $methods
            methodCount              = $methodCount
            defaultMethod            = $defaultMfa

            # Passwordless (modern auth)
            isPasswordlessCapable    = [bool]$passwordlessCapable

            # SSPR status
            isSsprRegistered         = [bool]$ssprRegistered
            isSsprEnabled            = [bool]$ssprEnabled
            isSsprCapable            = [bool]$ssprCapable

            # Authentication method preferences
            isSystemPreferredEnabled = [bool]$systemPreferredEnabled
            systemPreferredMethods   = if ($systemPreferredMethods) { @($systemPreferredMethods) } else { @() }
            userPreferredMethod      = $userPreferredMethod

            # Security analysis flags
            hasPhishingResistant     = $hasPhishingResistant
            phishingResistantMethods = $phishingResistantMethods
            hasWeakMethod            = $hasWeakMethod
            weakMethods              = $weakMethods
            hasStrongMethod          = $hasStrongMethod

            # Metadata
            lastUpdatedDateTime      = $lastUpdated
        }

        $processedMfa += $mfaRecord
        $mfaCount++

        # Progress indicator
        if ($mfaCount % 100 -eq 0) {
            Write-Host "      Processed $mfaCount records..." -ForegroundColor Gray
        }
    }

    # Save data using shared utility
    Save-CollectorData -Data $processedMfa -OutputPath $OutputPath | Out-Null

    Write-Host "    [OK] Collected $mfaCount MFA records" -ForegroundColor Green

    return New-CollectorResult -Success $true -Count $mfaCount -Errors $errors
}
catch {
    $errorMessage = $_.Exception.Message
    $errors += $errorMessage

    # Check if this is a licensing issue (MFA reports require specific licenses)
    if ($errorMessage -match "license|subscription|feature|not available") {
        Write-Host "    [!] MFA reports may require Entra ID P1/P2 license" -ForegroundColor Yellow
    }

    Write-Host "    [X] Failed: $errorMessage" -ForegroundColor Red

    # Write empty array to prevent dashboard errors
    Save-CollectorData -Data @() -OutputPath $OutputPath | Out-Null

    return New-CollectorResult -Success $false -Count 0 -Errors $errors
}
