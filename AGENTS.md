# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Build & Development

- **Build command copies resources**: `npm run build` includes `cp -R src/resources dist/resources` - YAML resource files must be copied to dist/
- **Watch mode**: `npm run watch` builds, links globally, and runs nodemon for live development
- **Test suite**: `npm test` rebuilds the plugin and runs the Node test suite in `test/**/*.test.js`

## Code Style (Non-Standard)

- **ESM modules required**: `"type": "module"` in package.json - all imports must use `.js` extensions even for `.ts` files
- **Switch case indentation**: `'indent': ['error', 2, { 'SwitchCase': 0 }]` - switch cases are NOT indented
- **Max line length**: 160 characters (not the typical 80/100)

## Architecture Patterns

- **Resource loading**: YAML files in `src/resources/` (sipcommands.yaml, models.yaml) are loaded at module initialization using `fileURLToPath(import.meta.url)` - must be copied to dist/
- **Command queue serialization**: RainbirdController uses `commandQueue` promise chain to serialize all API calls (line 522, 796-798)
- **HTTPS fallback logic**: Controller creation tries HTTPS first, falls back to HTTP on connection errors (platform.ts:541-560)
- **Custom HomeKit services**: Uses custom UUIDs for non-standard characteristics (RainDelayCharacteristic, QueueService, etc.) defined in platformAccessory.ts
- **WeakMap for handlers**: Accessory handlers stored in WeakMap to avoid memory leaks (platformAccessory.ts:53)

## Critical Gotchas

- **Password encryption**: Rain Bird API uses AES-256-CBC with SHA-256 hashed password - encryption adds hash prefix and IV (rainbird.ts:121-131)
- **Retry on 503**: Some models require retry logic on HTTP 503 "device busy" responses (enabled via modelInfo.retries flag)
- **Zone indexing**: Zones are 1-based in API but 0-based in some internal structures - careful with conversions
- **Program numbers**: Programs A-D are 1-4 in config but 0-3 in API calls (subtract 1 before API calls)
- **Stack vs Start**: `stackRunRequests` config determines whether to queue zones or interrupt active irrigation

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for this repo (use `gh` from this clone). See `docs/agents/issue-tracker.md`.

### Triage labels

Using the default triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout expected (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
