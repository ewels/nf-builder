# 0023. Probe cross-origin access from the deployed site with a Playwright-driven page

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

Spike S4 (F-008) must show, from the deployed origin and in real browsers, whether the app can call the Nextflow registry API, `raw.githubusercontent.com` and `codeload.github.com` directly (ADR 0009). The production CSP limits `connect-src` to the ADR 0002 allow-list and must not be loosened (ADR 0014); IO-41 fails the build if the bundle names a host outside it. The agent sandbox's proxy refuses or alters some GitHub hosts, so it can't be the only vantage point. Checked first-hand on 2026-11-22: the registry's OpenAPI document is at `https://registry.nextflow.io/openapi/`, every path is under `/api/v1/`, and module names must be URL-encoded (`nf-core%2Ffastqc`).

## Decision

- **Page:** a static, host-free probe page at `apps/web/public/spike/s4/` ships with every deploy and does nothing until driven. It fetches the targets it is given, records outcome and timing, and exposes `window.s4Probe.run(targets)`.
- **Targets in test code:** the target list lives in `e2e/s4-probe/targets.ts`, so the built bundle names no third-party host and IO-41 stays honest.
- **CSP:** the Playwright run opens the page with `bypassCSP`, so it measures each host's CORS policy rather than our own CSP. `netlify.toml` is unchanged; nothing is loosened.
- **Server view:** for each target the test also makes a Node-side request with the page's `Origin`, follows redirects by hand and sends a preflight, recording status, CORS headers and the redirect chain, including for requests the browser blocks.
- **Workflow:** a separate `S4 probe` workflow runs the deployed probe in Chromium, Firefox and WebKit, on pull requests that touch the probe (against the PR's deploy preview, after waiting for its head commit) and on `workflow_dispatch` against any `nf-builder.netlify.app` site. Artefacts are kept 90 days. CORS outcomes never fail it; only a broken probe does. It is not in AGENTS.md's "CI green" list: like Deploy check and Scope guard, it is a deliberate exception to ADR 0015's single workflow.
- **Sandbox:** local runs against a preview are cross-checks for the registry and `raw.githubusercontent.com` only.
- **Lifetime:** the probe stays for re-runs until F-502 builds the registry client, which deletes it.

## Consequences

- Every deploy carries a small inert page under `/spike/s4/`.
- Re-checking third-party CORS later is one workflow dispatch.
- Results depend on third parties on the day; the report dates them.

## Alternatives

- A per-path header rule loosening the CSP for the probe: Netlify doesn't document how overlapping header rules combine, and `vite preview` can't serve per-path headers.
- A deploy-preview-only build switched on `CONTEXT`: a second build mode to keep working.
- A throwaway PR: leaves no way to re-run.
- Hard-coded targets with an IO-41 exclusion: weakens the host check.
- Running the probe inside Deploy check: every PR would depend on flaky third parties.
