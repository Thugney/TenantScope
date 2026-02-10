@{
    # Module manifest for TenantScope
    # Author: Robel (https://github.com/Thugney)
    # Repository: https://github.com/Thugney/-M365-TENANT-TOOLKIT

    # Script module or binary module file associated with this manifest.
    RootModule = 'TenantScope.psm1'

    # Version number of this module.
    ModuleVersion = '2.4.0'

    # Supported PSEditions
    CompatiblePSEditions = @('Core')

    # ID used to uniquely identify this module
    GUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

    # Author of this module
    Author = 'Robel'

    # Company or vendor of this module
    CompanyName = 'TenantScope'

    # Copyright statement for this module
    Copyright = '(c) 2024-2026 Robel. MIT License.'

    # Description of the functionality provided by this module
    Description = 'TenantScope - Microsoft 365 Tenant Intelligence Dashboard. Collects and visualizes tenant data for IT admins, security teams, and management.'

    # Minimum version of the PowerShell engine required by this module
    PowerShellVersion = '7.0'

    # Modules that must be imported into the global environment prior to importing this module
    RequiredModules = @(
        @{ ModuleName = 'Microsoft.Graph.Authentication'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Users'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Identity.DirectoryManagement'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.DeviceManagement'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Reports'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Security'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Applications'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Teams'; ModuleVersion = '2.0.0' },
        @{ ModuleName = 'Microsoft.Graph.Sites'; ModuleVersion = '2.0.0' }
    )

    # Functions to export from this module
    FunctionsToExport = @(
        # Main orchestration
        'Invoke-TenantScopeCollection',
        'Start-TenantScopeCollection',
        # Utility functions
        'Invoke-GraphWithRetry',
        'Get-DaysSinceDate',
        'Get-DaysUntilDate',
        'Format-IsoDate',
        'Get-DomainClassification',
        'Get-SourceDomain',
        'Get-ActivityStatus',
        'Get-CertificateStatus',
        'New-CollectorResult',
        'Write-CollectorProgress',
        'Save-CollectorData',
        'Get-SimplifiedOS',
        'Get-WindowsLifecycleInfo',
        # Configuration
        'Get-TenantScopeConfig',
        'Test-TenantScopeConfig'
    )

    # Cmdlets to export from this module
    CmdletsToExport = @()

    # Variables to export from this module
    VariablesToExport = @()

    # Aliases to export from this module
    AliasesToExport = @(
        'Collect-TenantData'
    )

    # Private data to pass to the module specified in RootModule
    PrivateData = @{
        PSData = @{
            # Tags applied to this module
            Tags = @('Microsoft365', 'M365', 'Intune', 'AzureAD', 'EntraID', 'Graph', 'Dashboard', 'Reporting', 'Security', 'Compliance')

            # A URL to the license for this module
            LicenseUri = 'https://github.com/Thugney/-M365-TENANT-TOOLKIT/blob/main/LICENSE'

            # A URL to the main website for this project
            ProjectUri = 'https://github.com/Thugney/-M365-TENANT-TOOLKIT'

            # A URL to an icon representing this module
            # IconUri = ''

            # Release notes of this module
            ReleaseNotes = @'
## Version 2.0.0
- Added 9 new collectors for comprehensive endpoint management:
  - Compliance Policies (Get-CompliancePolicies)
  - Configuration Profiles (Get-ConfigurationProfiles)
  - Windows Update Status (Get-WindowsUpdateStatus)
  - BitLocker Status (Get-BitLockerStatus)
  - App Deployments (Get-AppDeployments)
  - Endpoint Analytics (Get-EndpointAnalytics)
  - Service Principal Secrets (Get-ServicePrincipalSecrets)
  - ASR Rules (Get-ASRRules)
  - Sign-In Logs (Get-SignInLogs)
- Added parallel collector execution support
- Added PowerShell module structure
- Fixed missing API scopes
- Improved error handling and logging
'@

            # Prerelease string of this module
            # Prerelease = ''

            # Flag to indicate whether the module requires explicit user acceptance for install/update/save
            RequireLicenseAcceptance = $false

            # External dependent modules of this module
            # ExternalModuleDependencies = @()
        }
    }
}
