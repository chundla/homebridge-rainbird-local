# Architecture Decision Records

Short, durable decisions for the Rain Bird Local plugin. Read **`CONTEXT.md`** at the repo root for vocabulary and module map.

| ADR | Title |
|-----|--------|
| [0001](0001-local-https-first-http-fallback.md) | HTTPS-first local transport with HTTP fallback |
| [0002](0002-serialized-command-queue.md) | Serialized SIP command queue per controller |
| [0003](0003-zone-runtime-shared-state.md) | ZoneRuntime as shared state for HAP and Matter |
| [0004](0004-dual-protocol-surfaces.md) | Dual HAP and Matter surfaces in one plugin |
| [0005](0005-yaml-sip-resources-at-build.md) | YAML SIP and model resources loaded from dist |
| [0006](0006-stack-vs-start-irrigation.md) | Stack vs start for overlapping zone runs |

When adding an ADR, use the next number, **Status** (Proposed | Accepted | Superseded), and link relevant source paths.