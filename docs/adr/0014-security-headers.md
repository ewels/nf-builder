# 0014. Serve a strict, one-line security header set from netlify.toml

- Status: Superseded by 0040
- Date: 2026-11-21

## Context

QA-30 asks for a strict Content-Security-Policy with no inline scripts and `connect-src` limited to the ADR 0002 allow-list. ADR 0002 puts the headers in `netlify.toml`. Later features need things a strict policy blocks: Monaco injects `<style>` elements, Shiki's Oniguruma engine and Pyodide need WebAssembly compilation, CheerpJ loads from its CDN, and GitHub zipball downloads redirect to `codeload.github.com`. The agent sandbox can't reach `*.netlify.app`, so deployed headers must be checked from GitHub Actions. Research: [Netlify, CSP and CI notes](../research/2026-11-21-netlify-csp-ci.md).

## Decision

- `netlify.toml` is the single source of response headers. One `[[headers]]` rule for `/*` sets:
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
  - No HSTS header: `.app` is HSTS-preloaded and Netlify adds its own.
- The CSP stays on one line with no commas; a comma or newline would split it into several policies.
- "No inline scripts" (QA-30) means `script-src` (and `default-src`) never contain `'unsafe-inline'`, `'unsafe-eval'`, `'unsafe-hashes'`, nonces or hashes. `'wasm-unsafe-eval'` is not an inline script and may be added when a feature needs it.
- `vite preview` serves the same headers, read from `netlify.toml`, so end-to-end tests run under the production policy and fail on any violation. `vite dev` sends every header except the CSP, because its React Refresh preamble is an inline script.
- A `deploy-check` workflow waits for the Netlify deploy of the commit (a `version.json` stamped from `COMMIT_REF`) and asserts the live headers equal `netlify.toml`, on pull request previews and on `main`.
- Build- and test-time code lives in root `scripts/` (Node scripts run with type stripping) and `e2e/` (Playwright). Build- and test-time code (`apps/web/vite.config.ts`, `e2e/`, tests) may import `scripts/`; app code under `apps/web/src`, packages and tools may not (dependency-cruiser rule `web-src-not-to-build-scripts` and the internal-package rules). `netlify.toml` is parsed with `smol-toml`, a dev dependency, in `scripts/netlify-config.ts`, the only reader.
- Every later loosening is recorded when it is made, in the PR that needs it: Monaco (`style-src 'unsafe-inline'`), `'wasm-unsafe-eval'` (Shiki, Pyodide), the CheerpJ CDN (ADR 0010), `codeload.github.com` (zip import), and a separate header rule for the S4 probe page.

## Consequences

- CSP breakage shows up locally in Playwright, not first in production.
- A unit test rejects a CSP that breaks QA-30, so loosening it is a visible, reviewed change.
- `/version.json` exposes the deployed commit SHA and context. The repository is public, so this reveals nothing new.

## Alternatives

- Nonces or hashes for inline scripts: Netlify serves static files, so nonces can't be generated per request, and hashes would invite inline scripts back.
- A `_headers` file in the build output: works, but splits configuration from `netlify.toml` (ADR 0002).
- Checking deployed headers by hand: the agent can't reach the site, and nobody would repeat it.
