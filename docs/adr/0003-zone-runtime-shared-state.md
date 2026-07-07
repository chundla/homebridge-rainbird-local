# ADR 0003: ZoneRuntime as shared state for HAP and Matter

## Status

Accepted

## Context

The plugin exposes the same physical zones through HomeKit valves/switches and optional Matter `WaterValve` accessories. Divergent duration or active-state logic would confuse users and complicate testing.

## Decision

Each discovered controller gets one `ZoneRuntime` (`createZoneRuntime(zones, defaultDurationMinutes)`):

- Stores per-zone **configured duration** (seconds, minimum 60).
- Tracks **active zones** and **remaining duration** updated from polling (`setActiveZones`, queue-backed remaining seconds).

HAP `RainbirdAccessory` and `MatterZoneValveBridge` read/write control through this runtime and the same `RainbirdController` methods (`startZone`, `stackZone`, `stopIrrigation`).

## Consequences

- Matter open with explicit duration updates shared stored duration; without duration, open uses stored value.
- Polling is the authority for active/remaining when queue data is available.
- Tests should target `ZoneRuntime` and bridge/platform sync behavior, not duplicate state machines.

## References

- `src/zoneRuntime.ts`
- `src/matterZoneValveBridge.ts`
- `src/platform.ts` (`refreshStatus`)