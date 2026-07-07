# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CONTEXT.md` and `docs/adr/` (architecture decision records) for domain vocabulary and stable design notes.

### Changed

- Dependency maintenance: `undici` ^6.27.0 (security), `typescript-eslint`, `homebridge` (dev), `@types/node`.

## [0.2.1-beta.0] - 2026-05-17

### Added

- Opt-in **Matter zone valves** per controller (`matterZoneValves`, default off): one Matter `WaterValve` per active zone when Homebridge Matter is enabled.
- Matter open/close and duration handling via shared `ZoneRuntime` and the same manual run/stop SIP paths as HomeKit valves.
- Polling sync of active state and remaining duration into Matter accessories from queue/runtime snapshots.
- Stable Matter accessory identity from controller serial + zone number; stale zones unregistered on rediscovery.

### Changed

- Homebridge 2 baseline for Matter APIs (`configureMatterAccessory`, Matter bridge registration).

## [0.2.0]

### Fixed

- `WaterBudgetSet` command encoding/parsing in `sipcommands.yaml` (program + seasonal adjust fields).

### Added

- Program water budget read/write control path.
- Configurable program budget HomeKit UI type (`programBudgetServiceType`: `fan` | `light` | `switch`).
- Budget services scoped to enabled programs from `programSwitchList` (or A–D when program switches are on and list is unset).
- `requestTimeoutMs` and `connectTimeoutMs` for Rain Bird transport.

### Changed

- Transport resilience: request abort timeouts and broader HTTPS→HTTP fallback on connection/TLS failures.

## [0.1.0]

### Added

- Initial local Rain Bird plugin: SIP client, encryption, YAML command/model resources.
- HTTPS-first controller creation with HTTP fallback.
- HomeKit platform with controller and per-zone expose modes, polling, queue status service, manual zone/program control.

[Unreleased]: https://github.com/chundla/homebridge-rainbird-local/compare/v0.2.1-beta.0...HEAD
[0.2.1-beta.0]: https://github.com/chundla/homebridge-rainbird-local/compare/v0.2.0...v0.2.1-beta.0
[0.2.0]: https://github.com/chundla/homebridge-rainbird-local/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/chundla/homebridge-rainbird-local/releases/tag/v0.1.0