# GitHub Pages hosting: headers, deploy and the registry snapshot

Research for ADRs 0040 and 0041, 2026-11-22. ADR numbers below were renumbered to 0040 and 0041 when the ADRs were written.

## Recommendation

1. **Headers.** GitHub Pages can't set response headers. GitHub staff confirmed this, and the responses I fetched show it. So:
   - **CSP:** move it into a `<meta http-equiv="Content-Security-Policy">` that the build injects at the top of `<head>`. Generate it from one source module that replaces `scripts/netlify-config.ts`. Use ADR 0014's policy **minus `frame-ancestors`**: a meta policy ignores that directive, and Chromium logs it as a console *error*, which would fail our e2e "no console errors" assertions. I reproduced this.
   - **Referrer:** add `<meta name="referrer" content="no-referrer">`.
   - **Nothing else can be delivered on Pages:** not X-Frame-Options, `frame-ancestors`, nosniff, COOP, CORP or Permissions-Policy. Record each as an accepted risk, or compensate in code.
   - **Clickjacking:** add a small check in `main.tsx` so the app refuses to render when `window.top !== window.self`.
   - **Workers aren't covered.** A meta policy does not govern Web Workers loaded from a URL. I reproduced a worker fetching a host the policy forbids. QA-30 must say so, and the honest rule is that network calls stay in the document.
   - **Cross-origin isolation:** nothing needs it, so COOP/COEP loss costs nothing.
2. **Deploy.** Add a new `pages.yml` using:
   - `actions/configure-pages` v6.0.0 (`45bfe0192ca1faeb007ade9deae92b16b8254a0d`)
   - `actions/upload-pages-artifact` v5.0.0 (`fc324d3547104276b827a68afc52ff2a11cc49c9`)
   - `actions/deploy-pages` v5.0.1 (`368f82528645a54fb793d4d04e342629a3f51346`)

   The deploy job needs `pages: write`, `id-token: write` and environment `github-pages`. The maintainer must set Settings → Pages → Source = **GitHub Actions**; `GITHUB_TOKEN` can't do it. That's a new maintainer issue. Set `base` from an env var, fed by configure-pages' `base_path`. Default it to `/`, and build e2e with `/nf-builder/` too.
3. **Snapshot without secrets.**
   - Keep `registry-snapshot.yml` and its branch. Delete its `verify` job, which is the `NETLIFY_BUILD_HOOK` part.
   - `pages.yml` triggers on `push` to main, `workflow_dispatch`, and `workflow_run` of "Registry snapshot" (completed, on main, success, not from a PR). A trigger on pushes to `registry-snapshot` won't work, because that branch is pushed with `GITHUB_TOKEN`.
   - The build checks out `registry-snapshot` into a directory and sets `REGISTRY_SNAPSHOT_DIR`. That mode already exists in the plugin, so the plugin needs no change for Pages.
4. **Gates.**
   - Delete `deploy-check.yml`.
   - Add a CI job (a PR gate) that builds the site exactly as Pages will and checks the meta policy statically (`check:site`).
   - In `pages.yml`, add a verify job after deploy on main: `version.json` commit, the meta policy, and `check:registry --url`.
   - `vite preview` should mirror Pages: no security headers, the same base path, and `appType: "mpa"` (no SPA fallback).
   - `check:hosts` (IO-41) needs no logic change.
5. **Netlify.** I recommend removing it from the repo. Deploy previews were consumed by Deploy check and the S4 probe; both are going away. Keeping Netlify means keeping a second header policy and Node/pnpm pins synced by hand. If the maintainer wants previews, the branch-reading plugin already works anonymously now that the repo is public; trigger it with an explicit env var instead of `NETLIFY=true`.
6. **Origin.** Strongly consider a custom domain before F-202 (projects in IndexedDB) ships:
   - Every Pages project site of the account shares the origin `https://ewels.github.io`. That means shared IndexedDB and localStorage, and CSP `'self'` covers all of them.
   - Moving hosts later would orphan users' projects.
   - A custom domain also makes `base` `/`, so nothing in this list about the base path applies.

**Smallest PR sequence**

- **Maintainer, now:** a new issue to enable Pages with Source "GitHub Actions". In the same issue, ask them to:
  - decide on a custom domain;
  - update the repo homepage, which still points to netlify.app;
  - decide what happens to the Netlify site.

  Also comment on #7 to swap `Deployed site matches netlify.toml` for the new CI job.
- **PR A (docs-only, straight to main, ADR 0031):**
  - ADR 0040, "Host on GitHub Pages; security policy in a meta element". It supersedes 0002 and 0014 and restates what still stands from them. Status `Accepted`, since the hosting choice is the maintainer's.
  - ADR 0041, "Deploy the registry snapshot with the site from Actions". It supersedes 0035 and restates format v1, the builder, the failure policy and the check. Status `Accepted (agent)`.
  - Status lines of 0002, 0014 and 0035 → `Superseded by …`, plus the README index.
  - QA-30 amendment and the progress Decisions line.
- **PR B (`scope-change` label): Pages alongside Netlify.**
  - Policy module and meta plugin.
  - `BASE_PATH`.
  - Host-neutral `version.json` env.
  - `pages.yml`.
  - The CI `site` job, the post-deploy check, and e2e under the base path with the mirrored preview.
  - The frame guard.
  - features.json: a new M0 feature for Pages hosting, plus F-704's URL.

  Netlify keeps working until PR C. Merge PR B after Pages is enabled; until then configure-pages/deploy fails on main.
- **PR C: remove Netlify.**
  - Delete `netlify.toml`, `deploy-check.yml`, `netlify-config.ts` (and the `smol-toml` dev dependency) and `check-deploy-headers.ts`.
  - Remove the plugin's Netlify branch mode and its token.
  - In `registry-snapshot.yml`, remove the `verify` job and the `netlify.toml` it writes to the snapshot branch.
  - Drop the S4 probe's PR trigger and its Netlify URL regex.
  - Update tests, AGENTS.md, the PR template, README and renovate.json.
  - Close #27 and #31.

## Evidence

### 1. Headers

**Pages can't set headers.**
- Staff on community discussion #54257: "We don't support this feature today so a `meta` tag unfortunately is the only way" (2023). The latest staff reply (2024-07) says it isn't prioritised, and a 2026-09 comment still reports no support.
- What Pages actually sends, from `curl` against `google.github.io/styleguide/` and `microsoft.github.io/monaco-editor/index.js`:
  - `server: GitHub.com`, `content-type`, `last-modified`, `etag`
  - `access-control-allow-origin: *`
  - `cache-control: max-age=600`, `expires`
  - sometimes `strict-transport-security: max-age=31556952`
  - Fastly/varnish headers: `via`, `x-served-by`, `x-cache`, `x-cache-hits`, `x-timer`, `x-fastly-request-id`, `age`
  - `x-github-request-id`, `x-proxy-cache`, `accept-ranges`, `vary`
- No CSP, nosniff, XFO, Referrer-Policy, COOP, CORP or Permissions-Policy. GitHub's *default* 404 page carries its own CSP, but a custom `404.html` gets none.
- `.json` is served as `application/json` (jupyterlite.github.io), and `.js` as `application/javascript`.
- For contrast, live Netlify (`curl nf-builder.netlify.app/version.json`) sends the full ADR 0014 set.

**Header by header (ADR 0014 lines 13–14; `/home/user/wt-main/netlify.toml:18-28`):**
- **CSP via meta.** CSP3 §3.3 says the `Content-Security-Policy-Report-Only` header "is not supported inside a meta element. Neither are the `report-uri`, `frame-ancestors`, and `sandbox` directives." It also says meta "policies… are not applied to content which precedes them", so inject with `head-prepend` (Vite's `injectTo`, `index.d.ts:1917`) at build only. `vite dev` would break: its React Refresh preamble is inline (`/home/user/wt-main/apps/web/vite.config.ts:12-13`). Every other directive in our policy works in meta: `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `worker-src`, `object-src`, `base-uri` and `form-action`.
- **Referrer.** `<meta name="referrer" content="no-referrer">` is Baseline since 2020 (MDN). Declare it statically, not by script injection.
- **Clickjacking.** MDN: "Setting `X-Frame-Options` inside the `<meta>` element… has no effect." Chromium also logs an error for it. The only option is script: don't mount the app when `window.top !== window.self`; show an "open in a new tab" link instead. A sandboxed frame with scripts off renders nothing at all.

  The residual risk is low. Cross-site frames get partitioned storage (Chrome 115+, Firefox 103+), so a framed copy has no projects. Same-site frames from other `ewels.github.io/*` sites are same-origin anyway, so no frame defence helps there.
- **nosniff, COOP, CORP, Permissions-Policy.** These are header-only. MDN warns: "Do not set other security headers using `<meta http-equiv=`". The W3C Permissions Policy spec defines only the header and the iframe `allow` attribute.
  - **nosniff:** low impact, since we serve no user content and Pages sends correct types.
  - **CORP:** moot, because Pages adds `ACAO: *` to everything and the content is public.
  - **COOP:** we lose XS-Leak protection against `window.open` openers. Low impact.
  - **Permissions-Policy:** the app requests none of these features, and `script-src 'self'` keeps third-party script out.

**Workers.** MDN (Using Web Workers): workers "are, in general, not governed by the content security policy of the document… set a Content-Security-Policy response header for the request which delivered the worker script". The exception is `blob:`/`data:` workers, which inherit the creator's policy.

**Reproduced in Chromium 157** with meta policy `connect-src 'self'` (a Playwright probe page):
```
results {"docFetch":"blocked: Failed to fetch","urlWorker":"allowed","blobWorker":"blocked: Failed to fetch"}
hits on other origin ["/urlworker"]
error: The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.
error: X-Frame-Options may only be set via an HTTP header sent along with a document. It may not be set inside <meta>.
framed page loaded inside cross-site iframe: probe
```
`/home/user/wt-main/e2e/csp.ts:21-23` collects console errors, and `/home/user/wt-main/e2e/app-shell.spec.ts:34` asserts there are none, so `frame-ancestors` must be left out of the meta.

The workers the spec plans:
- the engine worker (`docs/spec/architecture.md:15`);
- zip unzip (IO-11, `docs/spec/data-and-io.md:17`);
- Pyodide (FI-54, `docs/spec/files.md:51`).

On Pages these run with no CSP. That also means Pyodide needs no `'wasm-unsafe-eval'` on Pages; F-607's note (`/home/user/wt-main/docs/plan/features.json:1286`) changes accordingly.

Workers' cross-origin fetches will probably send an origin-only Referer. I inferred this from the same policy-container rule and didn't test it. Fix: `referrerPolicy: "no-referrer"` in the fetch client.

**Cross-origin isolation.** `grep -rn "SharedArrayBuffer|crossOriginIsolated|Cross-Origin-Embedder|COEP|Atomics"` over code and docs finds only the COOP line in netlify.toml and its test. There's no COEP, so the site was never cross-origin isolated. The S5 spike ran under this policy plus `'wasm-unsafe-eval'` (`/home/user/wt-main/docs/research/2026-11-22-spike-s5-nf-metro.md:55-56`).

**Honest QA-30 amendment** (`/home/user/wt-main/docs/spec/quality.md:38`; `docs/spec/` itself has no Netlify mention):

> Strict CSP delivered in a `<meta http-equiv>` element at the start of the app document's `<head>` (GitHub Pages sends no custom headers, ADR 0040): no inline scripts; `connect-src` limited to the allow-list. The policy governs the document only: Web Workers make no cross-origin requests (the document fetches and passes data), and IO-41 scans every bundle. `frame-ancestors`, X-Frame-Options, nosniff, COOP, CORP and Permissions-Policy are unavailable; the app refuses to run inside a frame.

ADR 0002:34 had rejected Pages for exactly this ("can't set response headers, so no real Content-Security-Policy, and no deploy previews"). The new ADR should say plainly that the maintainer now accepts that trade-off.

### 2. Deploying from Actions

**Docs and actions.**
- GitHub docs ("Using custom workflows with GitHub Pages"): the job needs `pages: write` and `id-token: write`; the default environment is `github-pages`; the artifact is a gzip of one tar under 10 GB, with no symlinks.
- deploy-pages `action.yml` (v5.0.1, node24): its `preview` input for PR previews is "only in alpha… not available to the public".
- upload-pages-artifact v5: excludes dot-files unless `include-hidden-files` is set. So `/.vite/manifest.json` won't be served; it's only read locally (`scripts/check-bundle-budget.ts:48`, `scripts/check-hosts.ts:107`).
- configure-pages v6 outputs `base_path` (e.g. "/my-repo"). Its `enablement` input "requires a token other than `GITHUB_TOKEN`".
- The REST create/update Pages API (`build_type: workflow`) needs an admin, maintainer, or the "manage GitHub Pages settings" permission. So enabling Pages is a maintainer issue.
- Limits: published site ≤ 1 GB, deploy timeout 10 min, the 10 builds/hour limit doesn't apply to Actions. The snapshot branch is 105.7 MB across 5,588 tree entries (`gh api …/git/trees/registry-snapshot?recursive=1`).
- Repo is `public`, `has_pages: false`, `homepage: https://nf-builder.netlify.app/`.
- Use concurrency group `pages` with `cancel-in-progress: false`, as GitHub's starter `pages/static.yml` does. The Vite guide's example pins configure-pages v6, upload-pages-artifact v5 and deploy-pages v5.

**What the `/nf-builder/` base path breaks:**
- **Vite `base`.** Vite rewrites HTML, CSS and JS-imported asset URLs. Runtime strings need `import.meta.env.BASE_URL`. Prefer an absolute base over `./`: in installed Vite, a relative base makes `BASE_URL` `"./"` (`vite/dist/node/chunks/node.js:37711`), which inside a worker resolves against `/assets/`.
- **Absolute paths today.** The app has none yet: no router, no fetches, no workers in `/home/user/wt-main/apps/web/src`. The places that do use them:
  - `/home/user/wt-main/apps/web/public/spike/s4/index.html:7` (`src="/spike/s4/probe.js"`; public files aren't rewritten);
  - `/home/user/wt-main/scripts/check-deploy-headers.ts:175` (regex `/assets/`);
  - e2e `request.get("/registry/…")` and `"/version.json"` (`/home/user/wt-main/e2e/registry-snapshot.spec.ts:11,20,24`, `/home/user/wt-main/e2e/app-shell.spec.ts:68-75,104`).

  F-502 (`/registry/index.json`) and F-607 (Pyodide `indexURL`) must use `BASE_URL`.
- **Preview catches mistakes.** Built with base `/nf-builder/`, `vite preview` redirects `/` to the base (302) and returns 404 for other paths outside it (`node.js:16882-16896`). So e2e under the base catches absolute-path bugs, and `page.goto("/")` keeps working.
- **Workers.** `new Worker(new URL("./w.ts", import.meta.url))` is base-safe.
- **SPA fallback.** Pages has no rewrites. A `404.html` is served with status 404: `google.github.io/styleguide/nope/deep` returned 404 with its custom page. The app has no routes and the spec plans none, so drop the fallback rather than copying `index.html` or adding hash routing. That changes F-002 step 2, which needs the ADR and `scope-change`. Use `appType: "mpa"` in preview to mirror Pages (`node.js:35784`).
- **CSP `'self'`.** It means the origin `https://ewels.github.io`, i.e. every project site of the account. `github.io` is on the Public Suffix List (line 13914), so other accounts are separate sites, but project sites of the same account share the origin, and with it storage.
- **User site.** `ewels.github.io/` returns 404, so there's no user site. If one later gets a custom domain, project sites move under it (GitHub docs, "About custom domains").

### 3. Registry snapshot without secrets

- **Trigger options:**
  - **Push to `registry-snapshot`: doesn't work.** GitHub docs ("Triggering a workflow"): "events triggered by the `GITHUB_TOKEN` will not create a new workflow run", except `workflow_dispatch` and `repository_dispatch`. The publish step is at `/home/user/wt-main/.github/workflows/registry-snapshot.yml:108-109`.
  - **`workflow_run`: recommended.** It only fires if the workflow file is on the default branch, chains at most 3 levels deep, and runs with the default branch's SHA and ref. It fires on any completion, PR dry runs (`registry-snapshot.yml:11-15`) included. Guard it:
    ```yaml
    on:
      push: { branches: [main] }
      workflow_dispatch:
      workflow_run: { workflows: ["Registry snapshot"], types: [completed], branches: [main] }
    # build job:
    if: github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'pull_request')
    ```
  - **Equally valid:** a reusable `pages.yml` (`workflow_call`) called by a job after `publish`, which must grant `pages`/`id-token`. Or `gh workflow run` with `actions: write`, using the `workflow_dispatch` exception.
  - **Not recommended:** one combined workflow (it mixes a 120-minute third-party job with deploys and their cancel semantics), or a second cron (fragile).
- **Combining.** `actions/checkout` with `ref: registry-snapshot`, `path: .cache/registry-snapshot`, `persist-credentials: false`, then `REGISTRY_SNAPSHOT_DIR=… pnpm build`. That's the existing `dir` mode (`/home/user/wt-main/scripts/registry-snapshot-site.ts:31-32,127-137`). If the branch is missing, skip it, keeping ADR 0035:21's "a deploy never depends on it".
- **F-501's plugin on both hosts.**
  - The Netlify `branch` mode already reads anonymously when no token is set (`registry-snapshot-site.ts:33-42,60-67`).
  - From here, `git -c credential.helper= ls-remote … registry-snapshot` exits 0, and raw `index.json` returns 200.
  - For host neutrality, replace the `NETLIFY === "true"` switch with an explicit `REGISTRY_SNAPSHOT_REPO`, and drop `REGISTRY_SNAPSHOT_TOKEN`. Or delete branch mode outright if Netlify goes.
  - **Unconfirmed:** live Netlify production (commit `ebf27fc`) answers `/registry/index.json` with `200 text/html` (the fallback). I couldn't see its build log or tell whether the repo was still private when it was built.
- **Deployed-snapshot check.** `check:registry --url` joins `${base}/${path}` (`/home/user/wt-main/scripts/check-registry-snapshot.ts:153-157`), so `https://ewels.github.io/nf-builder` works. It fetches every bundle; Pages returns 429 when rate limited (limits doc). Pages caches for `max-age=600`, and I couldn't confirm that a deploy purges the CDN.

### 4. CI gates

- **What Deploy check is today.** It's in AGENTS.md's "CI green" (`/home/user/wt-main/AGENTS.md:19`) and the PR template (`/home/user/wt-main/.github/pull_request_template.md:24`). ADR 0016:16 names it as an exception workflow, and issue #7's suggested required checks include `Deployed site matches netlify.toml`. `main` currently has no protection (`protected: false`).
- **Replacement:**
  - **PR gate:** a CI job building with `BASE_PATH=/nf-builder/` that runs a new `check:site`. It checks that `index.html`'s first `<head>` children are the CSP meta (before any script or link) and the referrer meta; that the policy equals the source module and passes `cspProblems`; that there's no `frame-ancestors`, `report-uri` or `sandbox`; that assets are under the base; and that `version.json` exists.
  - **On main:** a `verify` job in `pages.yml` that polls `page_url/version.json?ts=` for `GITHUB_SHA`, re-checks the served meta, and runs `check:registry --url` on snapshot-triggered runs.
- **Preview.** It can keep exactly the same policy, delivered by meta. `securitypolicyviolation` fires for meta policies, as reproduced above; `/home/user/wt-main/e2e/csp.ts:16`. Header assertions become meta assertions: `/home/user/wt-main/e2e/app-shell.spec.ts:15-17` and the header test at 65-84. Preview should send no security headers (`/home/user/wt-main/apps/web/vite.config.ts:10-18`), so that workers run as they will in production.
- **IO-41.** No logic change. The meta policy's absolute URLs are on the allow-list and pass the `.html` scan, and JSON isn't scanned (`/home/user/wt-main/scripts/check-hosts.ts:20-26`). Run it on the Pages-shaped build. Only the comment at `/home/user/wt-main/scripts/allow-list.ts:3` changes.

### 5. Change list

**Workflows**
- `/home/user/wt-main/.github/workflows/deploy-check.yml`: delete.
- `/home/user/wt-main/.github/workflows/registry-snapshot.yml`:
  - delete the `verify` job (lines 111-134);
  - delete the `netlify.toml` it writes to the branch (101, 106);
  - drop the "repository is private" comments (1-2, 38).
- `/home/user/wt-main/.github/workflows/s4-probe.yml`: drop the PR trigger and the wait step; point the dispatch default at Pages. Or delete early; F-502 deletes it anyway. The CORS results don't depend on the origin, so ADR 0009 stands.
- `/home/user/wt-main/.github/workflows/ci.yml`: add the `site` job.
- New `pages.yml`.

**Config**
- `/home/user/wt-main/netlify.toml`: delete.
- `/home/user/wt-main/renovate.json:35`: remove the netlify.toml note.
- `/home/user/wt-main/apps/web/vite.config.ts`: `base` from env, meta plugin, no preview or dev headers, `appType: "mpa"`.
- `/home/user/wt-main/playwright.config.ts`: `BASE_PATH` env for the build and preview server, `baseURL` with `/nf-builder/`, and the comment at line 75.

**Scripts**
- `/home/user/wt-main/scripts/netlify-config.ts`: replace with `security-policy.ts`, keeping `CONNECT_SRC_ALLOW_LIST` and `cspProblems`. Remove the `smol-toml` dev dependency (`/home/user/wt-main/package.json:44`; the lockfile changes).
- `/home/user/wt-main/scripts/check-deploy-headers.ts`: rewrite as a Pages post-deploy check.
- `/home/user/wt-main/scripts/registry-snapshot-site.ts`: keep `dir` mode; drop or generalise branch mode.
- `/home/user/wt-main/scripts/allow-list.ts`: comment only.
- `/home/user/wt-main/scripts/version-json.ts`: host-neutral env, e.g. `GITHUB_SHA` or an explicit variable alongside `COMMIT_REF`.
- New `check-site.ts`, plus its `package.json` script and AGENTS.md row (`test/agents-md.test.ts` enforces both).

**e2e and tests**
- Import or wording changes:
  - `/home/user/wt-main/e2e/app-shell.spec.ts`, `/home/user/wt-main/e2e/s4-probe-page.spec.ts`
  - `/home/user/wt-main/e2e/spike-s5-nf-metro.spec.ts`, `/home/user/wt-main/e2e/s3-spike/headers.ts`, `/home/user/wt-main/spikes/s5-nf-metro/headers.ts`, `/home/user/wt-main/spikes/s5-nf-metro/README.md:8`
  - `/home/user/wt-main/test/check-hosts.test.ts:208`, `/home/user/wt-main/test/s3-spike.test.ts`, `/home/user/wt-main/test/spike-s5.test.ts`
- `/home/user/wt-main/e2e/s4-probe/report.ts:77-84` and `/home/user/wt-main/test/s4-probe.test.ts`: URL regex.
- `/home/user/wt-main/e2e/registry-snapshot.spec.ts`: paths relative to the base.
- `/home/user/wt-main/test/netlify-config.test.ts`: becomes `security-policy.test.ts`; drop the build, NODE_VERSION and PNPM_VERSION cases.
- `/home/user/wt-main/test/check-deploy-headers.test.ts`: rewrite.
- `/home/user/wt-main/test/registry-snapshot-site.test.ts:120-279`: Netlify-mode cases.
- `/home/user/wt-main/test/version-json.test.ts`
- `/home/user/wt-main/test/workflows.test.ts`: the hook assertions at 286-291, the "private" test at 294, and new `pages.yml` assertions (SHA pins, permissions, the `workflow_run` guard).

**Docs**
- `/home/user/wt-main/AGENTS.md`: lines 19, 30, 31, 51 (65 is generic).
- `/home/user/wt-main/.github/pull_request_template.md:24`
- `/home/user/wt-main/README.md:5`
- `/home/user/wt-main/docs/plan/roadmap.md`: lines 9, 19, 62.
- `/home/user/wt-main/docs/plan/handoff/README.md`: lines 22, 87, 92.
- `/home/user/wt-main/docs/plan/handoff/plan-F-205.md:90`
- Leave the dated research notes, `progress.md` history and open-questions Q1 as they are.

**ADRs**
- **Supersede:** 0002 (Accepted; hosting at line 12, Pages rejected at 34), 0014, and 0035 (Serving at line 21, the hook at 20 and 28, the #31 consequence at 26).
- **Lapse without editing** (record it in the new ADR's Consequences, since Accepted bodies can't change):
  - 0015: lines 14 (`/.vite/manifest.json` served) and 17 (Renovate and netlify.toml);
  - 0016:16 and 0031:19 (Deploy check);
  - 0022:13-14, 0023:12-16 and 0024:15 (spike headers and preview probe);
  - 0013:58 (spike result text);
  - 0012:35 is generic, so leave it.

**Spec**
- No spec ID mentions Netlify. Amend QA-30, and add a line for frame refusal if adopted.

**features.json**
- F-002: description (line 23) and steps 2-4 (34-36).
- F-008: line 160. Historical; append a note only.
- F-501: notes (1048), including its "to pass" condition.
- F-502: notes (1066), the SPA fallback and #31.
- F-607: notes (1286), `wasm-unsafe-eval` in netlify.toml.
- F-704: description and step (1351, 1362), the Netlify URL.
- Adding a hosting feature, or changing steps and descriptions, needs `scope-change` plus the ADR.

**Issues**
- Close #31: moot, the repo is public.
- Close #27: no hook is needed.
- Update #7's check list.
- Open "Enable GitHub Pages (Source: GitHub Actions)". Include the custom-domain decision, the repo homepage, and what happens to the Netlify site.

### Couldn't confirm
- Worker CSP behaviour in Firefox and WebKit. I only ran Chromium 157; MDN states the rule generally.
- That `.wasm` is served as `application/wasm` on github.io. sql.js.org showed it, but that site is behind Cloudflare. It matters for F-607's `instantiateStreaming`.
- Whether Pages purges its CDN on deploy.
- Whether going public lifts #33 (Actions billing). The docs say standard runners are free for public repos, but I couldn't see whether jobs start.
- Which other `ewels.github.io` project sites exist. The user-repos API is blocked through this proxy.
- What counts as "activity" for the 60-day automatic disable of scheduled workflows in public repos. That would eventually stop the daily snapshot.
- Whether Netlify previews work with UI-only settings and no netlify.toml.

## Sources
- https://github.com/orgs/community/discussions/54257 ; https://github.com/orgs/community/discussions/13309
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- https://docs.github.com/en/rest/pages/pages
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://raw.githubusercontent.com/actions/deploy-pages/main/README.md ; https://raw.githubusercontent.com/actions/upload-pages-artifact/main/README.md ; https://raw.githubusercontent.com/actions/configure-pages/main/README.md (plus each action.yml at the SHAs above) ; https://raw.githubusercontent.com/actions/starter-workflows/main/pages/static.yml
- https://www.w3.org/TR/CSP3/ (§3.3) ; https://www.w3.org/TR/permissions-policy/
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/http-equiv ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/referrer ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy ; https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning
- https://privacysandbox.google.com/3pcd/storage-partitioning
- https://vite.dev/guide/static-deploy ; https://vite.dev/guide/build
- https://publicsuffix.org/list/public_suffix_list.dat
