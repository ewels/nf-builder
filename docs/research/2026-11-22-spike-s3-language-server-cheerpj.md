# Spike S3: the Nextflow language server under CheerpJ in a Web Worker

2026-11-22, F-007, [ADR 0022](../adr/0022-s3-spike-local.md). Can `language-server-all.jar` run in the browser under CheerpJ, exchange LSP messages from a Web Worker, and meet ADR 0010's thresholds (cold start under 10 s, under 500 MB, diagnostics on a 500-line file under 2 s)?

## Answer

It runs and gives the right answer: in a Web Worker under CheerpJ 5.0 (Java 17), the language server answers `initialize`, and after `textDocument/didOpen` publishes exactly the diagnostic plain Java gives for the fixture. The default setup misses the cold-start threshold (13.4 s); preloading the classes the first run used brings it to 9.6 s, inside the threshold by 0.4 s. Memory (326 MB over baseline) and edit diagnostics (0.9 s) pass comfortably. But CheerpJ's JIT evaluates strings as JavaScript, so it needs `'unsafe-eval'`, which QA-30 forbids; it also loads from its own CDN and is commercial software, free for FOSS projects. It is not shipped in v0.1 ([ADR 0026](../adr/0026-no-language-server-in-v0-1.md)).

## Setup

- Jar: the 26.10 pack's language server, v26.10.2, SHA-256 `20326778…4b26` (`packages/lang-2610/upstream.json`).
- CheerpJ 5.0 from `cjrtnc.leaningtech.com`, loader SHA-256 `280a353f…1520`, in a classic Web Worker, library mode. Messages go over `java.nio` pipes with LSP framing, one Java call at a time (piped streams failed with "Write end dead", and `Class.forName` from JavaScript hung).
- Fixture: a 500-line typed script with one undefined variable on line 487, also an oracle case (`tools/oracle/cases/s3-known-error-500/`), so CI checks the expected `nextflow lint` error.
- Browser: Chromium 157 in the agent sandbox (4 vCPU Xeon 2.1 GHz, 16 GB), through an HTTPS proxy. Pages served locally on ports 4177 (site headers plus the CDN and `'unsafe-eval'`) and 4178 (site headers plus the CDN and only `'wasm-unsafe-eval'`).
- Reproduce: `pnpm test:e2e -- --config e2e/s3-spike.config.ts` after `node e2e/s3-spike/prepare.ts`; results in `.cache/s3-spike/results/latest.md`.

## Results

Step 1 (E1): the first `publishDiagnostics` equals the plain-Java reference, `{range 486:4–486:21, severity 1, source "nextflow", message "`undefined_channel` is not defined"}`, which matches `nextflow lint`'s error at 487:5. One worker, no CSP violations, no page errors, only the page's origin and the CheerpJ CDN contacted.

Step 2 (E2), three cold and three warm runs per variant:

| Variant | Cold start, median (max); threshold 10 s | Warm start | Memory over baseline, median (max); threshold 500 MB | Peak renderer RSS | First diagnostics after `didOpen` | Edit diagnostics, median; threshold 2 s |
|---|---|---|---|---|---|---|
| CheerpJ 5.0, Java 17 | 13.4 s (13.7 s): miss | 11.3 s | 326 MB (328 MB) | 416 MB | 4.1 s | 0.9 s |
| CheerpJ 5.0, Java 17, preload | 9.6 s (9.7 s): pass | 7.2 s | 323 MB (327 MB) | 413 MB | 4.2 s | 0.9 s |
| CheerpJ 5.0, Java 17, wasmGC | no `initialize` within 300 s | | | | | |
| CheerpJ 5.0, Java 21 | no `initialize` within 300 s | | | | | |

An earlier default run gave 13.6 s cold (max 14.4 s), 312 MB and 0.9 s. Plain Java on the same machine: `initialize` 0.6 s, first diagnostics 1.1 s, edits 0.5 s. Edit diagnostics include the server's 500 ms debounce. A cold run fetches about 11.8 MB from the CDN over 61 requests, plus the 10 MB jar from the page's origin (Range requests re-read parts of it).

Definitions: cold start is worker creation to the `initialize` response with an empty cache; memory is peak renderer RSS minus the renderer's RSS before the worker starts; edit diagnostics is each `didChange` to its `publishDiagnostics`.

E3, the strictest QA-30-compatible policy (CDN plus `'wasm-unsafe-eval'`, no `'unsafe-eval'`): CheerpJ stops after its loader with "Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script". No `securitypolicyviolation` event fires, so the error text is the evidence.

## Limits

- One machine, through a proxy; a slower laptop would lose the 0.4 s margin.
- The preload list is captured from a previous run of the same Java version; shipping it means generating and versioning it with the jar.
- The wasmGC and Java 21 variants were recorded, not debugged.

## Consequences

- ADR 0010's fallback applies: our own lints (F-112), the CI oracle and rule-based migrations. The editing loop never waited on the language server, so nothing else changes.
- Revisit when CheerpJ can run without `'unsafe-eval'`, or with a worker-only CSP and the licence question answered by the maintainer (Q3). The spike re-runs in one command.
