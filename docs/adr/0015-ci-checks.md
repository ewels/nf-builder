# 0015. Run every check on each pull request in one CI workflow

- Status: Accepted (agent)
- Date: 2026-11-21

## Context

F-003 adds CI: `pnpm check`, Playwright on Chromium, Firefox and WebKit, the QA-01 bundle budget, the IO-41 host allow-list, ADR lint and `features.json` validation. QA-34 asks for Renovate and `pnpm audit`. The checks need exact definitions to be enforceable, and agents must be able to run all but the browser matrix locally.

## Decision

- `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, with one job per check so the PR's checks list names what failed: `pnpm check`, e2e per browser, bundle budget, network hosts, ADR lint, `features.json`, and `pnpm audit --audit-level high`. Actions are pinned by full SHA; the token is read-only; superseded runs are cancelled.
- Every check is a Node script in `scripts/` with unit tests and `file:line` messages that say how to fix the problem, and GitHub annotations in Actions. `pnpm check` also runs the ADR lint and `features.json` validation.
- **QA-01** counts the initial JavaScript: the entry chunk named in the Vite manifest (`build.manifest: true`) plus its static imports, never dynamic imports, gzipped with Node's zlib, with 1 kB = 1000 bytes. Monaco and the language server stay out only by being lazy-loaded. Worker bundles don't count until F-702 revisits the budgets. The limit lives in `scripts/budgets.json`; raising it needs a reason in the PR. The Vite manifest is therefore also served at `/.vite/manifest.json`, which reveals only file names.
- **IO-41** scans built `.js`, `.mjs`, `.cjs`, `.css` and `.html` files for absolute URLs. A host must be on the runtime allow-list in `scripts/allow-list.ts`, which also builds the CSP `connect-src`, or in `scripts/non-fetched-urls.ts`, a separate list of URLs that are never fetched (XML namespaces, documentation links in library error messages), each with a reason.
- **Browsers:** CI runs every end-to-end test on Chromium and the `@smoke` tests on Firefox and WebKit. Local runs default to Chromium (`PW_BROWSERS` selects others).
- **Renovate:** `renovate.json` keeps dependencies and action digests current. Installing the Renovate app and requiring the checks on `main` are repository settings for the maintainer. Node and pnpm bumps must also update `netlify.toml`; the unit tests on `netlify.toml` fail until they do.

## Consequences

- A regression in size, network hosts, ADR hygiene or the feature list fails its own named job.
- URLs users open themselves (help links) will need entries in the never-fetched list when they appear.

## Alternatives

- One job running everything: simpler YAML, but the checks list can't show which check failed.
- A bundle-size service or action: adds a third party; a 100-line script does it.
- Scanning source instead of build output: misses URLs that dependencies add.
