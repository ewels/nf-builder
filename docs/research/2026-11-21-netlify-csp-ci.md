# Netlify, CSP and CI notes

2026-11-21, researcher agent, for F-002 and F-003. Sources were searched snippets of Netlify docs (unreachable from the sandbox), Netlify's open-source parsers, GitHub docs and package tarballs; facts marked unverified were not confirmed first-hand.

## netlify.toml
- base unset (repo root); command = "pnpm --filter <web pkg> build"; publish = "apps/web/dist".
- Node: NODE_VERSION in [build.environment]; precedence .nvmrc > .node-version > NODE_VERSION > UI. Don't add .nvmrc.
- pnpm: packageManager + corepack; PNPM_VERSION env is legacy/undocumented but harmless; F-003 unit test asserts netlify.toml PNPM_VERSION == packageManager and NODE_VERSION major satisfies engines.node.
- SPA: [[redirects]] from="/*" to="/index.html" status=200 (force false default so real files served).
- [[headers]] for="/*" [headers.values]; CSP on ONE line (no newlines, no arrays -> comma = second policy).
- Researcher suggested Node 24 (Corepack issue only affects node 26 + pnpm 11).

## CSP now
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
Other: X-Content-Type-Options nosniff; Referrer-Policy no-referrer; X-Frame-Options DENY; COOP same-origin; CORP same-origin; Permissions-Policy camera=(), microphone=(), geolocation=(), payment=(), usb=(). Skip HSTS (.app preloaded; Netlify adds it).
Later loosening:
- Monaco 0.57: injects <style> -> style-src 'unsafe-inline'. Provide MonacoEnvironment.getWorker with new Worker(new URL(...),{type:'module'}) to avoid blob:.
- Shiki: oniguruma WASM needs 'wasm-unsafe-eval'; JS regex engine avoids it.
- Pyodide: 'wasm-unsafe-eval', probably 'unsafe-eval' in worker; self-host packages (no jsdelivr).
- CheerpJ: CDN in script-src/connect-src, wasm-unsafe-eval, maybe unsafe-eval.
- codeload.github.com: api zipball redirects there; add when zip-from-GitHub lands. S4 probe page needs its own header rule.
- img-src avatars.githubusercontent.com / raw for markdown preview images.
- React 19 sets styles via CSSOM -> style-src 'self' OK; React Flow 13 css is imported file.

## Deployed header checks (sandbox can't reach *.netlify.app)
- Netlify posts commit status context netlify/<site>/deploy-preview with target_url; no GitHub Deployments; prod gets no status.
- COMMIT_REF, CONTEXT, REVIEW_ID env at build. Preview URL https://deploy-preview-<PR>--nf-builder.netlify.app
- Design: Vite plugin writes dist/version.json {commit: COMMIT_REF ?? "local", context}. Workflow on pull_request + push main; poll <url>/version.json?ts= every 15s until commit == expected (PR head sha / github.sha), timeout 20 min; then fetch /, deep route (200 text/html), hashed asset; assert headers equal netlify.toml values; QA-30 checks. On main: pass if newer commit live and compare API says ahead.
- Locally/e2e: Vite preview.headers serve same headers; Playwright fails on securitypolicyviolation.

## Playwright/Actions
actions/checkout v7.0.1 3d3c42e5aac5ba805825da76410c181273ba90b1
actions/setup-node v7.1.0 949feb2413d6458794dcd2491c4babbbce0c15c1
pnpm/action-setup v6.1.1 73e46992e05b19abd31f2f3c20e0e7370d762115 (no version input; reads packageManager)
actions/upload-artifact v7.0.2 cf430e030ddbb5b0abf93d22962f4752f3646cd9
@playwright/test 1.65.1; `pnpm exec playwright install --with-deps chromium firefox webkit`; workers:1 on CI; matrix per browser. No browser caching.
setup-node: node-version-file: package.json (engines.node), cache: pnpm.
