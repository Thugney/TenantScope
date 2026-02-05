# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-05

### Added
- 9 data collectors: Users, Licenses, Guests, MFA, Admin Roles, Sign-In Risk, Devices, Autopilot, Defender Alerts
- Interactive dashboard with 7 pages: Overview, Users, Licenses, Guests, Security, Devices, Lifecycle
- Data bundling via `Build-Dashboard.ps1` for local file:// access (bypasses CORS)
- Sample data set for testing without live tenant
- Exponential backoff retry logic for Graph API throttling (5 retries, 60s base)
- 5-second cooldown between collectors to reduce throttling
- Cross-referencing: MFA status and admin roles merged into user records
- CSV export from any dashboard table
- Scheduled collection via Windows Task Scheduler
- Automatic dashboard build after data collection

### Fixed
- Dashboard showing empty when opened via file:// protocol (CORS bypass via JS data bundle)
- Graph API throttling failures on `Get-MgRiskyUser` endpoint (exponential backoff + cooldown)
