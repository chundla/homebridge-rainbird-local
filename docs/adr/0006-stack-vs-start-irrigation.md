# ADR 0006: Stack vs start for overlapping zone runs

## Status

Accepted

## Context

When a user starts a zone while another zone is already running, behavior may be **interrupt** (stop current, start new) or **queue behind** (stack), depending on household expectation and Rain Bird SIP support (`RunStation` vs stack command).

## Decision

Per-controller config `stackRunRequests` (boolean, default false):

- **false**: use `startZone` — new manual run replaces active irrigation.
- **true**: if `ZoneRuntime` reports active zones, use `stackZone`; otherwise `startZone`.

Same rule applies in HAP zone valves/switches and Matter `WaterValve` open handlers.

## Consequences

- Default preserves “tap zone = run now” semantics.
- Power users enable stacking explicitly in config.
- Call sites must check active zones via `ZoneRuntime`, not only HAP characteristic state.

## References

- `platformAccessory.ts` (zone/program valve paths)
- `matterZoneValveBridge.ts` (`openZoneValve`)