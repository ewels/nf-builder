# Spike S4: cross-origin access from the deployed site

2026-11-22, F-008, [ADR 0023](../adr/0023-s4-probe.md). Can the static app, served from Netlify, read the Nextflow registry API, `raw.githubusercontent.com`, `codeload.github.com` and the GitHub API directly from the browser (ADR 0009)?

## Answer

| Host | Browser access from the app's origin | Consequence |
|---|---|---|
| `registry.nextflow.io` (every `/api/v1/` endpoint probed) | Blocked: no `Access-Control-Allow-Origin`; preflight 401 | The registry snapshot (F-501) is the source; the live client (F-502) waits for CORS on the registry |
| `public-cr-prod.seqera.io` (module bundle download, after a 307) | Blocked: no CORS headers | Module bundles come from the snapshot |
| `raw.githubusercontent.com` | Allowed: `Access-Control-Allow-Origin: *` | GitHub import fetches files from it (F-401) |
| `api.github.com` (commits, recursive trees) | Allowed: `*` | Ref resolution and tree listing work (F-401) |
| `codeload.github.com` (direct, via `zipball`, via `github.com/.../archive/...`) | Blocked: `Access-Control-Allow-Origin: https://render.githubusercontent.com` | No archive download in the browser; zip import is an upload (F-403) |

All three engines agree on every target.

## Method

- A host-free page at `/spike/s4/` on deploy preview #14 (commit `dd44cf4`), driven by `e2e/s4-probe/deployed.probe.ts` under the `S4 probe` workflow (run [44983841745](https://github.com/ewels/nf-builder/actions/runs/44983841745), GitHub-hosted Ubuntu runner).
- The test serves the probe document without its CSP (`page.route`), so the page keeps its origin and only each host's CORS policy decides. Playwright's `bypassCSP` was tried first: it doesn't lift `connect-src` in WebKit (run 44982658155).
- Browsers: Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2. Requests omit credentials and bypass the cache.
- For each target the test also sends the request from Node with the page's `Origin`, follows redirects by hand (sending `Origin: null` after a cross-origin redirect, as the Fetch standard does) and sends a preflight with `Access-Control-Request-Headers: authorization`, recording status and headers.
- A second test checks every registry target against the live OpenAPI document (0.14.0, SHA-256 `d7f720a9…e5aa5`): all 10 match a `GET` operation.
- Artefact `s4-probe` (JSON and Markdown per browser, OpenAPI check), kept 90 days.

## Results

Verdicts are the same in all three browsers. Times are Chromium / Firefox / WebKit in ms.

| Target | URL | Verdict | Server view (status, `Access-Control-Allow-Origin`) | Preflight | ms |
|---|---|---|---|---|---|
| registry-service-info | `/api/v1/service-info` | blocked by CORS | 200, none | 401 | 475 / 527 / 471 |
| registry-modules-list | `/api/v1/modules/list?search=fastqc&size=5` | blocked by CORS | 200, none | 401 | 242 / 243 / 255 |
| registry-modules-search | `/api/v1/modules?query=fastqc&limit=3` | blocked by CORS | 200, none | 401 | 246 / 248 / 237 |
| registry-module | `/api/v1/modules/nf-core%2Ffastqc` | blocked by CORS | 200, none | 401 | 161 / 169 / 154 |
| registry-module-releases | `…/nf-core%2Ffastqc/releases` | blocked by CORS | 200, none | 401 | 167 / 156 / 150 |
| registry-module-release | `…/nf-core%2Ffastqc/0.0.0-6d1763b` | blocked by CORS | 200, none | 401 | 151 / 168 / 149 |
| registry-module-download | `…/0.0.0-6d1763b/download` | blocked by CORS | 307, none → `public-cr-prod.seqera.io` 200, none | 401 | 220 / 252 / 219 |
| registry-plugins | `/api/v1/plugins?size=100` | blocked by CORS | 200, none | 401 | 160 / 165 / 152 |
| registry-plugin | `/api/v1/plugins/nf-schema` | blocked by CORS | 200, none | 401 | 159 / 157 / 144 |
| registry-plugin-release | `/api/v1/plugins/nf-schema/2.6.1` | blocked by CORS | 200, none | 401 | 154 / 159 / 152 |
| raw-pipeline-file | `raw.githubusercontent.com/nf-core/fetchngs/<sha>/main.nf` | allowed (200) | 200, `*` | 403 | 143 / 32 / 26 |
| codeload-zip | `codeload.github.com/nf-core/fetchngs/zip/refs/tags/1.13.0` | blocked by CORS | 200, `https://render.githubusercontent.com` | 403 | 192 / 63 / 58 |
| api-commit | `api.github.com/repos/nf-core/fetchngs/commits/1.13.0` | allowed (200) | 200, `*` | 204 | 213 / 19 / 33 |
| api-tree | `api.github.com/repos/nf-core/fetchngs/git/trees/<sha>?recursive=1` | allowed (200) | 200, `*` | 204 | 148 / 10 / 8 |
| api-zipball | `api.github.com/repos/nf-core/fetchngs/zipball/1.13.0` | blocked by CORS | 302, `*` → codeload 200, `https://render.githubusercontent.com` | 204 | 217 / 134 / 50 |
| github-archive (control) | `github.com/nf-core/fetchngs/archive/refs/tags/1.13.0.zip` | blocked by CORS | 302, none → codeload 200, `https://render.githubusercontent.com` | 404 | 186 / 18 / 17 |

The preflight column is informative only: a plain `GET` sends none. A private-repo request with an `Authorization` header would preflight; `api.github.com` answers it with 204 and `*`.

## Registry API facts (OpenAPI 0.14.0)

- Every path is under `/api/v1/`; an earlier research note's `/api/modules` was wrong.
- Module names must be URL-encoded (`nf-core%2Ffastqc`); unencoded they give 404 or 401.
- `modules/list` takes `search` and `size`; `modules` takes `query` and `limit`. The list endpoint doesn't return port metadata, so the snapshot fetches each module's release.
- Bundle downloads redirect to `public-cr-prod.seqera.io`.

## Implications

- F-501: the snapshot is the only registry source the browser can use; build it with every module's release metadata and bundle.
- F-502: the live client is moot until the registry sends CORS headers; a live attempt shows CORS errors in the console. Re-run the probe (dispatch `S4 probe`) before building it.
- F-401: the import route (resolve the ref, list the tree, fetch raw files) works as ADR 0009 describes.
- F-403: zip import is a file upload; no GitHub archive URL can be fetched.
- ADR 0014: `codeload.github.com` doesn't need adding to the CSP.

## Sandbox caveats

The agent sandbox's proxy refuses or alters `codeload.github.com` and some `api.github.com` requests, so only the CI run is evidence for those hosts. Local runs agreed on the registry and `raw.githubusercontent.com`.

## How to re-run

Dispatch the `S4 probe` workflow with a `nf-builder.netlify.app` URL, or locally: `S4_PROBE_URL=https://nf-builder.netlify.app pnpm test:e2e -- --config e2e/s4-probe.config.ts`.

## Addendum 2026-11-23: re-run before F-502

The S4 probe ran again against the deployed site on GitHub Pages, as F-502's note required: [run 45093395128](https://github.com/ewels/nf-builder/actions/runs/45093395128), dispatched on `main` with `url=https://ewels.github.io/nf-builder/`.

- Chromium, Firefox and WebKit give the same verdicts as on 2026-11-22. Every `registry.nextflow.io` target (service info, module list and search, module, releases, release, download, plugins, plugin, plugin release) is `blocked-by-cors`: the server answers 200 without `Access-Control-Allow-Origin`, the preflight with `Authorization` answers 401 without it, and the download redirects to `public-cr-prod.seqera.io`, also without it.
- `raw.githubusercontent.com` stays `allowed` (`ACAO *`).
- `curl -sI` against `registry.nextflow.io` on 2026-11-23 shows the same missing header.

So the browser still can't read the registry directly. F-502 builds the live client behind a constant that keeps it off, and the snapshot stays the browser's only registry source (ADR 0035, ADR 0041).
