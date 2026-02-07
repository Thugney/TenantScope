# Endpoint Analytics Collector Review

**Collector**: `collectors/Get-EndpointAnalytics.ps1`  
**Dashboard pages**: Endpoint Analytics

## Status
PASS (no required-field gaps found)

## Required Dashboard Fields (Endpoint Analytics)
**Device scores (deviceScores)**
`id`, `deviceName`, `manufacturer`, `model`,  
`endpointAnalyticsScore`, `startupPerformanceScore`, `appReliabilityScore`,  
`workFromAnywhereScore`, `healthStatus`, `needsAttention`

**Device performance (devicePerformance)**
`deviceName`, `coreBootTimeInMs`, `loginTimeInMs`, `blueScreenCount`, `restartCount`

**App reliability (appReliability)**
`appName`, `appPublisher`, `appVersion`, `appCrashCount`, `appHangCount`,  
`meanTimeToFailure`, `healthScore`, `activeDeviceCount`, `trend`

**Model insights (modelInsights)**
`model`, `manufacturer`, `deviceCount`, `avgHealthScore`, `avgStartupScore`, `recommendation`

**Overview**
`overallScore`, `startupPerformanceScore`, `appReliabilityScore`, `workFromAnywhereScore`, `batteryHealthScore`

## Collector Coverage
- All required fields above are produced.
- UI maps `endpointAnalyticsScore` → `healthScore` and merges boot/login times from `devicePerformance`.
- Uses live Graph data (no sample/static data paths).

## Graph Collection Details
- Endpoints (beta):
  - `/beta/deviceManagement/userExperienceAnalyticsOverview`
  - `/beta/deviceManagement/userExperienceAnalyticsDeviceScores`
  - `/beta/deviceManagement/userExperienceAnalyticsDevicePerformance`
  - `/beta/deviceManagement/userExperienceAnalyticsAppHealthApplicationPerformance`
- Optional endpoints (license-dependent):
  - `/beta/deviceManagement/userExperienceAnalyticsBatteryHealthDevicePerformance`
  - `/beta/deviceManagement/userExperienceAnalyticsWorkFromAnywhereMetrics`
  - `/beta/deviceManagement/userExperienceAnalyticsDeviceStartupProcesses`
  - `/beta/deviceManagement/userExperienceAnalyticsAppHealthDevicePerformance`
- Required scopes: `DeviceManagementManagedDevices.Read.All`.
- Output file: `data/endpoint-analytics.json`.

## Risks / Notes
- Many endpoints are beta and licensing-dependent; sections will be empty if unavailable.
- `trend` for app reliability is heuristic (derived from crash counts and score), not Graph-provided.

## Duplicate Code Check
- No new duplicate patterns detected in this collector (see `reviews/duplicates.md` for global duplicates).

## UI Notes
- Resolved (2026-02-07): device health donut now renders Excellent/Good/Fair/Poor segments; legend aligns with the ring.
