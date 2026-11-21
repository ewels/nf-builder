# 0010. Try the official language server in the browser; never depend on it

- Status: Proposed (pending spike S3)
- Date: 2026-11-21

## Context

The Nextflow language server gives authoritative diagnostics, formatting, hover text and "Convert script to static types". It is a Java 17 jar of about 10 MB. Its standalone builds bundle a Java runtime, so there is no native binary to run in a browser. CheerpJ runs unmodified jars in the browser via WebAssembly. It has Java 17 support and is free for FOSS projects. See [research](../research/2026-11-21-nextflow-language-and-tooling.md).

## Decision

Spend at most three sessions running the jar under CheerpJ in a Web Worker, speaking LSP over an in-memory pipe.

If it passes all three thresholds:
- cold start under 10 s;
- under 500 MB memory;
- diagnostics on a 500-line file under 2 s;

then ship it as an opt-in "Advanced checks" setting, loaded when idle. Use it for diagnostics, formatting, hover text and "Migrate to typed".

If not, record the numbers here and fall back to our own lints, the CI oracle and rule-based migrations. Either way, the editing loop never waits on it.

## Consequences

- If it works, we get authoritative checks and migrations without writing them.
- It adds a third-party runtime from CheerpJ's CDN, under licence terms tracked in `docs/licences.md` (open question Q3).

## Alternatives

- A local language server over WebSocket: breaks zero-install, but could become a power-user option later.
- Re-implementing everything in TypeScript: this is the fallback, not the plan.
