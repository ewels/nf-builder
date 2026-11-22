# 0040. Host on GitHub Pages, with the security policy in meta elements

- Status: Accepted
- Date: 2026-11-22

## Context

On 2026-11-22 the maintainer decided that production is hosted on GitHub Pages. Netlify was a stand-in while the repository was private, and the repository is now public. ADR 0002 had rejected Pages because it can't set response headers, which rules out a real Content-Security-Policy header and deploy previews. The maintainer now accepts that trade-off.

What Pages allows:
- **Headers:** Pages sends no custom headers; GitHub staff confirm it, and so do the observed responses.
- **Meta CSP:** a policy in a `<meta>` element can't carry `frame-ancestors`, `report-uri` or `sandbox` (CSP3 §3.3). Chromium logs `frame-ancestors` and `X-Frame-Options` in a meta element as console errors.
- **Workers:** a meta policy doesn't govern Web Workers loaded from a URL. This was reproduced in Chromium 157.
- **Origin:** project sites of one account share the origin `ewels.github.io`, and with it browser storage.
- **Deploy:** a Pages deploy comes from Actions with `pages: write` and `id-token: write`. The maintainer must set the Pages source to "GitHub Actions" (#35).

Research: [GitHub Pages hosting](../research/2026-11-22-github-pages.md); plan: [F-011](../plan/handoff/plan-F-011.md).

## Decision

- **Hosting** (amends ADR 0002's hosting line; the rest of ADR 0002 stands):
  - The `Pages` workflow (`.github/workflows/pages.yml`) builds and deploys on pushes to `main`, on dispatch, and after a successful `Registry snapshot` run (ADR 0041).
  - It uses `actions/configure-pages`, `upload-pages-artifact` and `deploy-pages`, pinned by SHA. Concurrency group `pages` doesn't cancel runs in progress. Each job gets the least privilege it needs.
  - The URL is `https://ewels.github.io/nf-builder/` until a custom domain replaces it.
- **Base path:**
  - `BASE_PATH` comes from configure-pages' `base_path` and defaults to `/`.
  - It is always absolute, never `./`.
  - Runtime URLs use `import.meta.env.BASE_URL`.
  - `/nf-builder/` appears only in test configuration.
  - There is no single-page-app fallback: the app has no routes, and Pages serves a 404 for unknown paths.
- **Policy** (supersedes ADR 0014):
  - `scripts/security-policy.ts` is the single source. It holds this CSP, on one line with no commas: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`, and the referrer policy `no-referrer`.
  - A build-only Vite plugin puts the CSP meta element first in every emitted page's `<head>`, public HTML included, followed by `<meta name="referrer" content="no-referrer">`. `vite dev` has no policy, because its React Refresh preamble is an inline script.
  - "No inline scripts" keeps ADR 0014's meaning: `script-src` and `default-src` never contain `'unsafe-inline'`, `'unsafe-eval'`, `'unsafe-hashes'`, nonces or hashes. `'wasm-unsafe-eval'` may be added when the document needs it. A loosening is recorded in the PR that needs it.
  - Build- and test-time code stays in `scripts/` and `e2e/`, under ADR 0014's dependency-cruiser rule.
- **Accepted risks** (header-only protections Pages can't send):
  - `frame-ancestors` and `X-Frame-Options`: instead, the app doesn't start inside a frame and offers an "Open in a new tab" link. Cross-site frames also get partitioned storage, so a framed copy holds no projects.
  - `nosniff`: Pages sends correct content types, and the site serves no user content.
  - `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`: Pages adds `Access-Control-Allow-Origin: *`, the content is public, and nothing needs cross-origin isolation.
  - `Permissions-Policy`: the app requests none of these features, and `script-src 'self'` keeps third-party script out.
- **Workers:** Web Workers make no cross-origin requests. The document fetches and passes them data. IO-41 scans every bundle.
- **Preview:** `vite preview` mirrors Pages: no security headers, the same base path, and `appType: "mpa"`. End-to-end tests build and preview under `/nf-builder/` and fail on any CSP violation or console error.
- **Gates:**
  - Pull requests: the CI `site` job builds with `BASE_PATH=/nf-builder/` and runs `pnpm check:site` (meta policy, asset paths, `version.json`). The `budget` and `hosts` jobs use the same base.
  - On `main`: the `verify` job in `pages.yml` checks the deployed `version.json` commit and the served policy.
  - The `Deploy check` workflow is deleted, so "CI green" means `CI` and `Scope guard`. There are no deploy previews.
- **Version stamp:** `version.json` reads `SITE_COMMIT`, `COMMIT_REF` or `GITHUB_SHA`, and `SITE_CONTEXT` or `CONTEXT`.
- **Netlify:** a minimal `netlify.toml` (build command, publish directory, and the Node and pnpm pins) stays for development builds. Nothing in CI depends on it. `smol-toml` stays as a dev dependency for the test that keeps those pins in step.
- **Spike S4:** its probe runs on dispatch only, against Pages, and the deployed run strips the meta policy.

## Consequences

- No secrets are needed to deploy.
- These lines of Accepted ADRs have lapsed:
  - ADR 0015's served `/.vite/manifest.json` (upload-pages-artifact drops dot directories);
  - ADRs 0016 and 0031's `Deploy check`;
  - ADRs 0022, 0023 and 0024's header and preview-probe lines.
- **Origin risk:** every `ewels.github.io` project site shares storage and `'self'`. A custom domain should be decided before F-202 stores projects in IndexedDB, because moving later would orphan them (#35).
- **Unconfirmed:**
  - how workers behave under a meta policy in Firefox and WebKit;
  - the `.wasm` content type on github.io;
  - whether a deploy purges Pages' CDN cache (checks add cache-busting queries).
- Docs-only pushes to `main` also redeploy, which is harmless.

## Alternatives

- Keep Netlify for production: the maintainer chose Pages.
- A `404.html` copy or hash routing: the app has no routes.
- A `./` base: inside a worker, `BASE_URL` resolves against `/assets/`.
- Meta `X-Frame-Options` or `sandbox`: ignored, and they log errors.
- A CDN in front of Pages to add headers: another account and service to run.
