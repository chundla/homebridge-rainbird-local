# Rain Bird Local — domain context

Homebridge plugin that controls Rain Bird irrigation controllers over the **local** LNK WiFi module API (SIP over JSON-RPC on `/stick`). No cloud API.

## Glossary

| Term | Meaning |
|------|---------|
| **Controller** | A physical Rain Bird unit reachable at `host` with a `password`. One Homebridge platform instance can manage multiple controllers via `devices[]`. |
| **Zone** (station) | A sprinkler circuit numbered **1-based** in user config and most SIP commands. |
| **Program** | Schedule program A–D. In **config/UI** programs are **1–4** (A=1). In **Rain Bird API** calls they are **0–3** (subtract 1 before `getWaterBudget` / `setWaterBudget` and similar). |
| **LNK / stick endpoint** | Local HTTP(S) path `https://{host}/stick` (or HTTP fallback) carrying encrypted JSON-RPC tunnel payloads. |
| **SIP command** | Binary-style command template from `sipcommands.yaml`, encoded into the tunnel request. |
| **Expose mode** | How HomeKit (HAP) presents a controller: `controller` (one Irrigation System + optional extras) or `zones` (one Valve per zone). Independent of Matter. |
| **Zone runtime** | In-memory `ZoneRuntime` per controller: configured duration, active zones, remaining duration. **Source of truth** for HAP zone valves and Matter `WaterValve` sync. |
| **Stack run** | When `stackRunRequests` is true, a new zone run uses `stackZone` if something is already active; otherwise `startZone` (interrupt). |
| **Refresh** | Periodic poll per controller: active stations, queue, rain delay/sensor, then push state into HAP handlers and Matter bridge. |
| **Matter zone valves** | Optional per-controller `matterZoneValves` (default off): one Matter `WaterValve` per non-ignored zone when bridge Matter is enabled. |
| **Health / fault** | After **3** consecutive refresh failures, accessories for that controller are marked unhealthy until refresh succeeds again. |

## System boundaries

```
Homebridge (HAP + optional Matter)
    └── RainbirdPlatform (DynamicPlatformPlugin)
            ├── RainbirdController (per device) — serialized SIP API
            ├── ZoneRuntime (per device) — shared durations/active state
            ├── RainbirdAccessory (HAP handlers, WeakMap-backed)
            └── MatterZoneValveBridge — opt-in Matter registration/sync
                    └── Rain Bird controller (firmware) over LAN only
```

## Configuration surfaces

- **Platform**: `RainBirdLocal` — `name`, `debug`, `devices[]` (preferred) or legacy single `host`/`password` plus `additionalControllers` / `controllers`.
- **Per controller**: host, password, `expose`, `ignoredZones`, `zoneNames`, durations, refresh interval, program switches/budget UI type, `zoneValves` / `zoneSwitches`, `matterZoneValves`, `stackRunRequests`, timeouts.

Schema: `config.schema.json`. Normalization: `normalizeControllerConfig()` (e.g. Matter default off).

## HomeKit (HAP) presentation

### Controller expose mode

- Primary **Irrigation System** service; optional **Program** switches (A–D subset), **program budget** UI (`fan` | `light` | `switch`), optional per-zone switches or native **Valve** tiles.
- Custom **Queue** service exposes next zone, remaining runtime, current zone, summary (plugin-specific UUIDs in `platformAccessory.ts`).

### Zones expose mode

- One **Valve** accessory per discovered zone (after `ignoredZones` filter).

Handlers are attached via `RainbirdAccessory` and stored in a **WeakMap** on the platform accessory to avoid leaks.

## Matter presentation (v1)

- **Only** per-zone `WaterValve`; no controller-wide Matter accessory, queue telemetry, program budget, or rain sensor in Matter v1.
- Stable UUIDs from controller serial + zone; separate namespace from HAP.
- Open/close and duration follow the same `ZoneRuntime` and `startZone` / `stackZone` / `stopIrrigation` paths as HAP valves.

## Rain Bird client layer

- **Resources**: `src/resources/sipcommands.yaml`, `models.yaml` loaded at module init; **must** be copied to `dist/resources` on build.
- **Transport**: AES-256-CBC encrypted tunnel when password is set (SHA-256 key, IV + hash prefix on wire).
- **Creation**: `RainbirdController.create()` tries **HTTPS** first, falls back to **HTTP** on connection/TLS/timeout class errors.
- **Concurrency**: All commands go through a **promise chain** (`commandQueue`) so only one SIP transaction runs at a time per controller.
- **503 busy**: Models with `retries: true` in `models.yaml` enable retry-on-busy for HTTP 503.

## Polling and remaining duration

- Active zones come from `getActiveStations()`; remaining time is **best-effort**: prefer current queue zone seconds from `getCurrentQueue()`, else fall back to configured zone duration in `ZoneRuntime`.
- Schedule data is **read-only** in the plugin (no schedule writes).

## Operational note

Local API reliability on some hardware (e.g. ESP-TM2) may require **blocking outbound internet** for the controller while keeping LAN access to Homebridge. Documented in README for troubleshooting.

## Key source files

| Area | Path |
|------|------|
| Platform lifecycle, refresh, discovery | `src/platform.ts` |
| HAP services/characteristics | `src/platformAccessory.ts` |
| SIP client, crypto, commands | `src/rainbird/rainbird.ts` |
| Shared zone state | `src/zoneRuntime.ts` |
| Matter bridge | `src/matterZoneValveBridge.ts` |
| Config types | `src/controllerConfig.ts` |

## Related documentation

- Human-oriented setup: `README.md`
- Agent workflow: `AGENTS.md`, `docs/agents/`
- Architecture decisions: `docs/adr/`