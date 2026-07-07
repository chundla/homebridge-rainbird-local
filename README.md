# homebridge-rainbird-local

Homebridge plugin for **local** Rain Bird controller control (LNK WiFi module), with HTTPS-first and HTTP fallback for mixed firmware behavior.

## Features

- Local control using Rain Bird SIP-over-JSONRPC tunnel
- HTTPS fallback logic for newer firmware
- Read model, serial, stations, active stations, current queue, and schedule metadata
- Expose queue next-zone/remaining runtime, current running zone/remaining runtime, and human-readable queue summary via a dedicated HomeKit Queue Status service
- Start/stop irrigation manually, including optional stack-run queueing
- Water budget read/write for configured programs
- Program budget HomeKit UI type selector: `fan`, `light`, or `switch` (one service type per enabled program)
- Health watchdog marks accessories as faulted after repeated refresh failures
- Two HomeKit expose modes:
  - `controller`: one Irrigation System accessory (+ optional program switches, zone switches, and zone valves)
  - `zones`: one Valve accessory per zone
- Optional **Matter** per-zone `WaterValve` accessories (`matterZoneValves`, default off) when the bridge has Matter enabled

## Local Control Requirement (Important)

For ESP-TM2 (and likely similar Rain Bird controllers), local API responsiveness may fail when the controller still has normal internet access.

In this test environment, reliable local control required **blocking outbound internet access for the ESP-TM2 at the firewall** while keeping LAN access to Homebridge allowed.

If commands/timeouts are inconsistent, test with internet egress blocked for the controller as a troubleshooting step.

## Installation

```bash
npm install
npm run build
```

For local Homebridge dev linking:

```bash
npm link
```

## Homebridge config example

```json
{
  "platform": "RainBirdLocal",
  "name": "Rain Bird",
  "debug": false,
  "devices": [
    {
      "configDevice": "Main Controller",
      "host": "192.168.1.55",
      "password": "YOUR_RAINBIRD_PASSWORD",
      "expose": "controller",
      "zoneNames": ["Front Lawn", "Back Lawn", "Drip Beds"],
      "ignoredZones": [6],
      "defaultDurationMinutes": 10,
      "refreshIntervalSeconds": 30,
      "programSwitches": true,
      "programSwitchList": [1, 3],
      "programBudgetServiceType": "light",
      "zoneValves": true,
      "zoneSwitches": false,
      "logScheduleOnStart": false,
      "requestTimeoutMs": 15000,
      "connectTimeoutMs": 10000
    }
  ]
}
```

### Config notes

- Plugin-level options: `platform`, `name`, `debug`, `_bridge`
- Controller-level options are inside `devices[]`
- `configDevice`: display name for that controller
- `host`: controller IP/hostname only, no `http://` or `https://`
- `password`: controller password from the Rain Bird app
- `expose`:
  - `controller`: single accessory, can trigger default zone or selected program switches
  - `zones`: separate valve accessory per zone
- `ignoredZones`: zone numbers to hide/ignore entirely
- `programSwitches`: boolean toggle to enable/disable program switches
- `programSwitchList`: optional specific list like `[1,3]` (A=1, B=2, C=3, D=4)
- `programBudgetServiceType`: choose budget control tile type in HomeKit (`fan`, `light`, `switch`).
  - Exactly one budget UI service is created per enabled program.
  - Enabled programs follow `programSwitchList`; if list is omitted and program switches are enabled, programs A-D are used.
- `stackRunRequests`: queue a zone request behind an active run instead of interrupting it
- `requestTimeoutMs`: total request timeout in milliseconds (default 15000)
- `connectTimeoutMs`: connect timeout in milliseconds (default 10000)

## Multi-controller example

```json
{
  "platform": "RainBirdLocal",
  "devices": [
    {
      "configDevice": "Front Controller",
      "host": "192.168.1.55",
      "password": "PASS1",
      "programSwitches": true,
      "programSwitchList": [1, 2],
      "ignoredZones": [6]
    },
    {
      "configDevice": "Back Controller",
      "host": "192.168.1.56",
      "password": "PASS2",
      "expose": "zones",
      "zoneNames": ["Beds", "Garden", "Orchard"]
    }
  ]
}
```

## Accessory behavior

### Controller mode

- Exposes HomeKit `IrrigationSystem`
- `Active = true` starts irrigation on first discovered zone using `defaultDurationMinutes`
- `Active = false` sends stop irrigation
- Optional Program A-D switches trigger manual program run
- Program budget service is shown per enabled program using the configured service type (`fan`, `light`, or `switch`)
- Optional zone switches provide quick on/off per zone (auto-disabled when zone valves are enabled to avoid redundant tiles)
- Optional zone valves provide native Apple Home valve tiles (Active/In Use/Set Duration)

### Matter zone valves

- `matterZoneValves` is an explicit per-controller opt-in for per-zone Matter `WaterValve` accessories.
- Default is `false`.
- If Homebridge Matter is disabled at the bridge level, the plugin logs a clear skip message and leaves the existing HomeKit surface unchanged.
- Each active filtered zone is published as its own Matter `WaterValve` accessory with a stable controller-serial + zone-number identity.
- Matter `open` and `close` commands reuse the same Rain Bird manual run/stop paths as the HomeKit valve surface.
- Zone duration changes stay in the shared runtime, so HomeKit and Matter read the same configured duration.
- Polling pushes active state and remaining duration back into the Matter accessories using the queue/runtime snapshot.

### Zone mode

- Exposes each zone as HomeKit `Valve`
- `Active = true` starts that zone (duration from `SetDuration`, fallback default)
- `Active = false` stops irrigation
- `RemainingDuration` is updated from polling model (best-effort; not exact runtime API)

## Tested Hardware/Firmware

Tested successfully with:

- Controller: **ESP-TM2**
- Mobile app provisioning: **Rain Bird v2** app
- Wi-Fi module firmware: **4.136**
- Controller firmware: **1.51**

## Limitations

- No cloud API usage
- No schedule write support (read-only schedule snapshot)
- Remaining duration is estimated in plugin state unless richer queue/runtime parsing is added
- Program switch count is fixed at 4 currently

## Logging

- Informational logs (`log.info`) report key lifecycle and control actions: controller connect, accessory registration, irrigation starts/stops, rain delay changes, and periodic refresh heartbeat.
- Debug logs (`log.debug`) provide verbose refresh snapshots and full schedule payload output.
- Set `"debug": true` to enable verbose Rain Bird request/response tracing.

## Development

```bash
npm run lint
npm test
npm run build
```

Domain vocabulary and architecture decisions: [`CONTEXT.md`](CONTEXT.md) and [`docs/adr/`](docs/adr/).

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for version history. Current release: **v0.2.1-beta.0**.

### Recent highlights

**v0.2.1-beta.0** — Matter zone valves (opt-in), shared zone runtime sync, Homebridge 2 Matter bridge.

**v0.2.0** — Water budget fixes, configurable budget UI type, request/connect timeouts, transport resilience.

## Project status

Current implementation includes:

- Rain Bird client + crypto + SIP command port (`src/rainbird/`)
- HTTPS fallback controller creation and serialized command queue
- Model/stations/schedule read paths; manual zone/program/stop and stack-run
- Homebridge platform discovery, polling, health watchdog (`src/platform.ts`)
- HomeKit controller + zone accessories (`src/platformAccessory.ts`)
- Matter `WaterValve` bridge (`src/matterZoneValveBridge.ts`)
