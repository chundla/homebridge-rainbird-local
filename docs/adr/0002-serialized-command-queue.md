# ADR 0002: Serialized SIP command queue per controller

## Status

Accepted

## Context

The Rain Bird local API can return HTTP **503** (device busy) when concurrent requests hit the controller. Homebridge refresh loops, user actions, and Matter commands can overlap in time.

## Decision

Each `RainbirdController` maintains a `commandQueue` promise chain. Every `processCommand` (and callers through it) enqueues work so **at most one** in-flight SIP transaction runs per controller instance.

Models flagged with `retries: true` in `models.yaml` additionally enable client-side retry behavior on 503 after model detection.

## Consequences

- Higher latency under load, but fewer busy errors and more predictable state.
- All new controller methods must route through the queue — bypassing it risks regressions.
- Multi-controller installs serialize **per controller**, not globally.

## References

- `commandQueue` / `enqueueCommand` in `src/rainbird/rainbird.ts`
- `AGENTS.md` (command queue serialization)