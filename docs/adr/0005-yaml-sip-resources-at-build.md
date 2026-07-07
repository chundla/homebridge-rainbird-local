# ADR 0005: YAML SIP and model resources loaded at runtime from dist

## Status

Accepted

## Context

SIP command templates and model capabilities (max stations, water budget, 503 retry flag) change rarely but should stay editable without recompiling TypeScript for every hex layout tweak.

## Decision

- Keep `sipcommands.yaml` and `models.yaml` under `src/resources/`.
- Load via `fileURLToPath(import.meta.url)` relative to compiled `rainbird.js` → `../resources`.
- **`npm run build`** must copy resources: `cp -R src/resources dist/resources`.

Command encoding/decoding and model lookup use these files at module initialization (`RESOURCES` singleton).

## Consequences

- Editing YAML requires rebuild (or watch) before runtime picks up changes.
- Packaging (`files` in `package.json`) ships `dist/` only — resources must live inside `dist`.
- Tests and CI must run `build` before tests that touch the client (see `npm test`).

## References

- `loadResources()` in `src/rainbird/rainbird.ts`
- `package.json` `build` script
- `AGENTS.md`