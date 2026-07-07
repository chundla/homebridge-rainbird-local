# ADR 0001: HTTPS-first local transport with HTTP fallback

## Status

Accepted

## Context

Rain Bird LNK modules ship with mixed firmware behavior: some controllers answer on HTTPS (`https://{host}/stick`), others only on HTTP. Homebridge runs on user LANs with varied certificate and TLS behavior.

## Decision

`RainbirdController.create()` always attempts HTTPS first, probes with `getModelAndVersion()`, and on connection-class failures (refused, timeout, TLS/SSL/certificate, aborted) recreates the client against HTTP and retries model discovery.

Host config is **host only** — no `http://` or `https://` prefix in user JSON.

## Consequences

- Users do not choose transport in config; the plugin adapts.
- Non-connection errors on HTTPS (e.g. bad password) are **not** masked by falling back to HTTP.
- Logging should make clear which transport succeeded (see platform discovery logs).

## References

- `RainbirdController.create()` in `src/rainbird/rainbird.ts`