# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repo root (if present)
- `docs/adr/` at the repo root (if present)

If these files don't exist, proceed silently.

## File structure

This repo is configured as **single-context**:

- one root `CONTEXT.md`
- one root `docs/adr/`

## Use glossary vocabulary and flag ADR conflicts

- Prefer terms defined in `CONTEXT.md` when naming domain concepts.
- If output contradicts an ADR, call the conflict out explicitly instead of silently overriding it.
