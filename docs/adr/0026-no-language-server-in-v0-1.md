# 0026. Keep the CheerpJ language server out of v0.1

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0010 said to ship the language server under CheerpJ as an opt-in "Advanced checks" setting if it met three thresholds. Spike S3 ([report](../research/2026-11-22-spike-s3-language-server-cheerpj.md)) found that it gives correct diagnostics, and that only a preload variant meets the cold-start threshold, by 0.4 s on one machine (9.6 s against 10 s; the default setup takes 13.4 s). Memory and diagnostics latency pass easily. CheerpJ also needs `'unsafe-eval'`, which QA-30 forbids and ADR 0014 keeps out of the CSP; it loads from its own CDN, which isn't on ADR 0002's allow-list; and it is commercial software, free for FOSS projects, which the maintainer has to accept (Q3). No feature in the v0.1 list builds "Advanced checks".

## Decision

This supersedes ADR 0010's "then ship it" branch; its fallback stands.

- v0.1 doesn't ship the language server. Diagnostics come from our own lints (F-112) and the CI oracle; migrations are rule-based.
- `e2e/s3-spike/` stays for re-runs (ADR 0022).
- Revisit when CheerpJ runs without `'unsafe-eval'`, or when the maintainer accepts its licence (Q3) and a worker-only CSP that allows `'unsafe-eval'` is decided in its own ADR. Either way it needs a new feature in `features.json`.

## Consequences

- The CSP, the allow-list and the dependency list stay as they are.
- Authoritative checks and "Migrate to typed" through the language server wait for a later release.

## Alternatives

- Ship "Advanced checks" now with the preload variant: a thin margin, `'unsafe-eval'` against QA-30, a new runtime host and a licence decision only the maintainer can make.
- Supersede QA-30 for a worker-scoped `'unsafe-eval'`: weakens a security requirement for an optional feature nobody has asked for yet.
