# ADR 0004: Dual HAP and Matter surfaces in one plugin

## Status

Accepted

## Context

Homebridge 2 can expose Matter alongside HAP. Rain Bird users need existing HomeKit automations preserved while optionally pairing zones to Matter controllers.

## Decision

- **Single npm package** (`homebridge-rainbird-local`), one `RainbirdPlatform`.
- **HAP** presentation controlled by `expose` (`controller` | `zones`) plus optional program/zone services.
- **Matter v1** is **opt-in** per controller (`matterZoneValves`, default `false`), publishes **only** per-zone `WaterValve`, and is **independent** of HAP expose mode.
- If `api.isMatterEnabled()` is false, log clearly and skip Matter registration; HAP unchanged.
- Matter UUIDs use a dedicated generation scheme (controller serial + zone); do not reuse HAP accessory UUIDs.

Matter v1 explicitly excludes: controller-wide accessories, queue telemetry, program budgets, rain sensor, schedule writes.

## Consequences

- Feature matrix is documented in README and PRD (GitHub issue #1).
- Future Matter scope requires a new ADR or amendment.
- `configureMatterAccessory` on the platform delegates to `MatterZoneValveBridge` for cache reload.

## References

- `src/matterZoneValveBridge.ts`
- `src/platform.ts` (`configureMatterAccessory`, `matterZoneValveBridge.syncControllerState`)
- README “Matter zone valves”