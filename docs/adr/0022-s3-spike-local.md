# 0022. Run spike S3 locally, with its own header set and no CI job

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

Spike S3 (F-007, ADR 0010) runs the Nextflow language server jar under CheerpJ in a Web Worker and measures cold start, memory and diagnostics latency. CheerpJ loads from its CDN and its JIT needs `'unsafe-eval'`, which QA-30 and ADR 0014 forbid in production. ADR 0014 says e2e runs under the production policy; `vite preview` can't serve per-path headers, and Netlify's merging of overlapping header rules is undocumented (ADR 0023). The spike is a one-off measurement, not app behaviour.

## Decision

- The spike lives in `e2e/s3-spike/` with its own Playwright config, `e2e/s3-spike.config.ts` (files named `*.spike.ts`), outside `apps/web`. It is never deployed.
- Its `serve.ts` builds the page into `.cache/s3-spike/` and serves it locally on two ports: one with `netlify.toml`'s headers plus the CheerpJ CDN in `script-src` and `connect-src` and `'unsafe-eval'`; one with the CDN and only `'wasm-unsafe-eval'`, to record what the strictest QA-30-compatible policy blocks. The ports differ from spike S5's (ADR 0024).
- `netlify.toml`, `scripts/allow-list.ts` and IO-41 are unchanged.
- Test-time hosts (ADR 0017): `cjrtnc.leaningtech.com` from the local browser only; `github.com` and `release-assets.githubusercontent.com` for the pinned language server jar, cached in `.cache/language-server/<tag>/` and shared with the catalogue generator (ADR 0020). The jar pin is read from `packages/lang-2610/upstream.json`.
- It runs locally (`pnpm test:e2e -- --config e2e/s3-spike.config.ts`), not in CI; CI and Netlify never fetch the jar for it. The known-error fixture is also an oracle case, so CI checks it with `nextflow lint`.
- The spike is kept for re-runs until a feature adopts the language server or ADR 0010's idea is dropped.

## Consequences

- The finding can be re-run in one command.
- The production CSP stays strict; CheerpJ's needs are recorded as adoption costs.
- The numbers come from the agent sandbox's machine, not CI.

## Alternatives

- A per-path Netlify header rule: undocumented merging.
- Playwright's `bypassCSP`: would hide the CSP cost this spike must measure.
- A CI or `workflow_dispatch` job: a JVM-in-browser measurement on shared runners adds noise without changing the go/no-go.
- The page in `apps/web`: IO-41 and the allow-list would need loosening.
