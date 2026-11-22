# Plan: F-011

F-009 is already taken: it is the corpus tooling feature, M0, passing. F-011 is the next free M0 id, so save this as `docs/plan/handoff/plan-F-011.md`. The researcher's report calls the ADRs 0036 and 0037, but 0036 and 0037 are already used, so this plan uses your numbers, 0040 and 0041. I checked the line references this plan relies on in `/home/user/wt-main`. I also confirmed the three action SHAs with an anonymous `git ls-remote`: configure-pages v6.0.0 `45bfe0192ca1faeb007ade9deae92b16b8254a0d`, upload-pages-artifact v5.0.0 `fc324d3547104276b827a68afc52ff2a11cc49c9`, deploy-pages v5.0.1 `368f82528645a54fb793d4d04e342629a3f51346`.

## 0. Findings the brief doesn't cover

1. **The QA-01 budget breaks under a base path.** `scripts/check-bundle-budget.ts:92` does `found.push(url.replace(/^\//, ""))`. Under `/nf-builder/` the script path becomes `nf-builder/assets/…`, and `check:budget` fails with "not in dist". `e2e/parser-chunk.spec.ts:23` and `e2e/palette.spec.ts` call `initialJsFiles` on the e2e build and would fail the same way. Both need a `base` argument.
2. **The S4 probe page is a public file**, `apps/web/public/spike/s4/index.html`. `transformIndexHtml` never sees it, so it would get no meta policy. Its script is `src="/spike/s4/probe.js"` (absolute). Its deployed run strips the CSP *header* (`e2e/s4-probe/deployed.probe.ts:48-52`); with a meta policy it has to strip the meta element from the body instead. Two F-008 e2e tests assert it runs "under the site CSP".
3. **Vite escapes `'` as `&#39;` in attributes** (`serializeAttrs` uses escape-html). `check:site` must decode entities before comparing the policy.
4. **Charset position.** `head-prepend` pushes `<meta charset>` down to about byte 450. HTML requires the charset within the first 1024 bytes, so `check:site` should assert that as the policy grows.
5. **`REGISTRY_SNAPSHOT_DIR` must be absolute in `pages.yml`.** Vite runs in `apps/web` through `pnpm --filter`, so a relative directory would resolve there.
6. **ADR 0015 says "one job per check"** (bundle budget, network hosts). I read "check:budget and check:hosts run on that build" as: the same `BASE_PATH` build configuration, keeping their jobs (see S4).
7. **`check:registry --url` fetches every file one at a time with no cache-buster** (`check-registry-snapshot.ts:192-207`). Pages caches with `max-age=600`.
8. **Playwright resolves `goto("/")` against the origin**, which drops the `/nf-builder/` base. e2e paths must be relative (`"./"`, `"version.json"`).
9. **`check-deploy-headers`' `--allow-newer` becomes dead code.** With workflow-level concurrency group `pages`, `verify` finishes before the next run starts, so a newer commit can't be live.
10. **The F-501 / F-011 cycle.** F-501's pass condition now depends on F-011, so F-011 must not depend on F-501.

## 1. Files

**Create**
- `scripts/security-policy.ts`: the single source of the policy; replaces `netlify-config.ts`.
- `scripts/security-policy-meta.ts`: the Vite plugin.
- `scripts/base-path.ts`: `BASE_PATH` normalisation.
- `scripts/check-site.ts`: the static check and the deployed check.
- `apps/web/src/frame-guard.tsx`
- `.github/workflows/pages.yml`
- `e2e/pages-hosting.spec.ts`
- Tests:
  - `test/security-policy.test.ts` (`git mv` of `test/netlify-config.test.ts`)
  - `test/security-policy-meta.test.ts`
  - `test/netlify-toml.test.ts`
  - `test/check-site.test.ts`
  - `test/base-path.test.ts`
  - `apps/web/test/frame-guard.test.tsx`

**Change**

*App and build*
- `apps/web/vite.config.ts`:
  - `base: basePath(process.env)` and `appType: "mpa"`;
  - add the `securityPolicyMeta()` plugin;
  - remove all `server` and `preview` headers.
- `apps/web/src/main.tsx`: the frame guard.
- `apps/web/public/spike/s4/index.html`: `src="probe.js"` (relative).
- `netlify.toml`: only `[build]` and `[build.environment]` (Node and pnpm pins). Rewrite the header comment.
- `package.json`: add `"check:site": "node scripts/check-site.ts"`. `smol-toml` stays (section 6).

*Scripts*
- `scripts/version-json.ts`: host-neutral variables.
- `scripts/registry-snapshot-site.ts`: `REGISTRY_SNAPSHOT_REPO`; no token, no `NETLIFY` switch.
- `scripts/check-registry-snapshot.ts`: sampled URL mode and cache-busting queries.
- `scripts/check-bundle-budget.ts`: the `base` argument; the CLI passes `basePath(process.env)`.
- `scripts/allow-list.ts:3`: comment only.

*Spikes*
- `e2e/s3-spike/headers.ts`, `spikes/s5-nf-metro/headers.ts`: use `SITE_POLICY_HEADERS`.
- `spikes/s5-nf-metro/README.md:8`: wording.

*e2e*
- `e2e/urls.ts`, `playwright.config.ts`
- Specs: `app-shell.spec.ts`, `app-shell-layout.spec.ts`, `palette.spec.ts`, `parser-chunk.spec.ts`, `registry-snapshot.spec.ts`, `s4-probe-page.spec.ts`, `spike-s5-nf-metro.spec.ts`
- S4 probe: `e2e/s4-probe/{page,report,deployed.probe}.ts`, `e2e/s4-probe.config.ts`

*Workflows*
- `.github/workflows/ci.yml`: add the `site` job; `BASE_PATH` on the `budget` and `hosts` jobs.
- `.github/workflows/registry-snapshot.yml`:
  - remove the `verify` job (lines 111-134);
  - stop writing `netlify.toml` (lines 101 and 106);
  - reword the "private" comments (lines 1-2 and 38). The token header on git calls stays.
- `.github/workflows/s4-probe.yml`:
  - dispatch only, with no PR trigger and no wait step;
  - `url` becomes a required input with no default.

*Tests*
- `test/workflows.test.ts`, `test/version-json.test.ts`, `test/registry-snapshot-site.test.ts`, `test/check-registry-snapshot.test.ts`, `test/check-bundle-budget.test.ts`, `test/check-hosts.test.ts:208`, `test/s3-spike.test.ts`, `test/spike-s5.test.ts`, `test/s4-probe.test.ts`

*Docs*
- `.github/pull_request_template.md:24`
- `AGENTS.md`: lines 19, 28-31, 34, 47 (the `check:registry` row), 51, plus a new `check:site` row.
- `README.md:5`, `renovate.json:35` (the test name), `docs/plan/roadmap.md:9,62` (line 19 is historical, leave it)
- `docs/plan/handoff/plan-F-205.md:90`, `docs/plan/handoff/README.md:22,92`
- `docs/plan/features.json`

**Delete**
- `scripts/netlify-config.ts`
- `scripts/check-deploy-headers.ts`, `test/check-deploy-headers.test.ts`
- `.github/workflows/deploy-check.yml`

No new dependency, and no dependency-cruiser change: `vite.config.ts` may already import `scripts/`.

## 2. Interfaces

**`scripts/security-policy.ts`**
- It imports only `./allow-list.ts`, so `verify` can run it with `install: "false"`.
- Exports:
  - `CONNECT_SRC_ALLOW_LIST: readonly string[]`: unchanged.
  - `CONTENT_SECURITY_POLICY: string`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. Build the `connect-src` part from the allow-list.
  - `REFERRER_POLICY = "no-referrer"`
  - `META_IGNORED_DIRECTIVES = ["frame-ancestors", "report-uri", "sandbox"]` (CSP3 §3.3)
  - `type MetaTag = { readonly attrs: Readonly<Record<string, string>> }`
  - `POLICY_META_TAGS: readonly MetaTag[]`: the CSP element first, then the referrer element.
  - `SITE_POLICY_HEADERS: Readonly<Record<string, string>>`: the same two values as `Content-Security-Policy` and `Referrer-Policy`, for spike servers that still send headers (ADRs 0022 and 0024).
  - `cspProblems(policy: string): string[]`: unchanged.
  - `metaPolicyProblems(policy: string): string[]`: `cspProblems` plus any ignored directive.

**`scripts/security-policy-meta.ts`**
- `policyMetaHtml(): string`: both elements, serialised as Vite does (escape `& < > " '`).
- `prependPolicyMeta(html: string): string`:
  - inserts the elements right after the `<head …>` start tag;
  - does nothing if they are already there;
  - throws if there is no `<head>`.
- `securityPolicyMeta(): Plugin`:
  - name `nf-builder:security-policy-meta`, `apply: "build"`;
  - `transformIndexHtml: { order: "post", handler: () => POLICY_META_TAGS.map(t => ({ tag: "meta", attrs: t.attrs, injectTo: "head-prepend" })) }`;
  - `writeBundle({ dir })` runs `prependPolicyMeta` on every other `.html` under `dir`. Public files are copied at `renderStart`, so they exist by then.

**`scripts/base-path.ts`**
- `basePath(env: Record<string, string | undefined>): string`:
  - unset or `""` gives `"/"`;
  - `"/x"` and `"/x/"` give `"/x/"`;
  - throws on `./…`, a bare name, `//host` and full URLs.

**`scripts/version-json.ts`**
- `versionInfo(env)` returns:
  - `commit`: `SITE_COMMIT || COMMIT_REF || GITHUB_SHA || "local"`;
  - `context`: `SITE_CONTEXT || CONTEXT || "local"`.
- The JSON shape is unchanged.

**`scripts/check-bundle-budget.ts`**
- `initialJsFiles(manifest, html, base = "/")` and `checkBundleBudget(distDir, budget, base = "/")`: strip `base`, not just `/`.

**`scripts/check-site.ts`**
- It imports only `node:` built-ins and sibling scripts.
- Exports:
  - `headPolicyProblems(html: string): string[]`. It checks that:
    - the first element in `<head>` is the CSP meta, its decoded content equals `CONTENT_SECURITY_POLICY`, and `metaPolicyProblems` finds nothing;
    - the second element is the referrer meta with `no-referrer`;
    - there is no other `http-equiv` meta;
    - `<meta charset>` sits within the first 1024 bytes.
  - `assetPathProblems(html: string, base: string, exists?: (distPath: string) => boolean): string[]`:
    - looks at every `src` and `href` path, skipping `data:` and `#`;
    - each must start with `base`, must not be `./`, and its file must exist.
  - `checkSiteDir(dir: string, base: string): { ok: boolean; problems: Problem[] }`:
    - runs both checks on `index.html`;
    - runs `headPolicyProblems` on every `.html` file;
    - requires `version.json` with string `commit` and `context`.
  - `type DeployedSiteOptions = { commit: string; context?: string; timeoutMs: number; intervalMs: number; log?; fetch?; sleep?; now? }`
  - `checkDeployedSite(siteUrl: string, o: DeployedSiteOptions): Promise<{ ok; liveCommit: string | null; problems: string[] }>`:
    - polls `version.json?ts=` until it shows the commit;
    - fetches the page with `?ts=` and requires 200 and `text/html`;
    - runs `headPolicyProblems` and `assetPathProblems` with the base taken from `new URL(siteUrl).pathname`;
    - fetches the entry script and requires 200 and JavaScript.
- CLI:
  - `node scripts/check-site.ts [<dir>]`: the directory defaults to `apps/web/dist`, the base comes from `BASE_PATH`.
  - `--url <site> --commit <sha> [--context <c>] [--timeout-minutes 10] [--interval-seconds 15]`
  - Exit codes: 0 pass, 1 problems, 2 usage error or no build.

**`scripts/registry-snapshot-site.ts`**
- `SnapshotSource` is `{kind:"dir",dir}`, `{kind:"branch",url,branch}` or `{kind:"none"}`.
- `snapshotSource(env)`: `REGISTRY_SNAPSHOT_DIR` first, else `REGISTRY_SNAPSHOT_REPO` (an SSH URL is rewritten to https), else none.
- `fetchSnapshotBranch(url, branch, into)`: the token parameter is gone; keep `GIT_TERMINAL_PROMPT=0`.
- New warning text: "…Run the Registry snapshot workflow, or check REGISTRY_SNAPSHOT_REPO."

**`scripts/check-registry-snapshot.ts`**
- `DeployedOptions.sample?: { modules: number; plugins: number }`: undefined means every file, which is today's behaviour, so the existing test still passes.
- `DEPLOYED_SAMPLE = { modules: 20, plugins: 5 }`
- `evenlySpaced<T>(items: readonly T[], n: number): T[]`: keeps the first and last items.
- Every deployed GET gets `?ts=`.
- The CLI's `--url` mode uses `DEPLOYED_SAMPLE` unless `--all` is given.
- A sampled run fetches the index (`generatedAt`, QA-06, format), `ports.json`, 20 bundles (format, name@version; `requires` aren't followed) and 5 plugin files: about 27 requests.
- The full integrity check moves to the build job, which runs it on the exact files it uploads (see `pages.yml`).

**`apps/web/src/frame-guard.tsx`**
- `isFramed(win: { top: unknown; self: unknown }): boolean`
- `FramedNotice({ href }: { href: string }): JSX.Element`: a paragraph plus `<a href={href} target="_blank" rel="noopener noreferrer">Open in a new tab</a>`, styled by a class in `styles.css` with no inline style.
- `main.tsx` renders `isFramed(window) ? <FramedNotice href={location.href}/> : <StrictMode><AppShell/></StrictMode>`.

**e2e**
- `e2e/urls.ts`: `E2E_BASE_PATH = "/nf-builder/"`, `PREVIEW_ORIGIN`, `PREVIEW_URL = PREVIEW_ORIGIN + E2E_BASE_PATH`, `DEV_URL`, and `PRODUCTION_URL = "https://ewels.github.io/nf-builder/"` (placeholder).
- `playwright.config.ts`: the preview server gets `env: { REGISTRY_SNAPSHOT_DIR, BASE_PATH: E2E_BASE_PATH }` and `url: PREVIEW_URL`; the dev server gets `env: { BASE_PATH: "/" }`.
- S4 probe:
  - `report.ts`: `probeSite(value): { url: string; origin: string }` replaces `probeOrigin`. It accepts `PRODUCTION_URL` or `http://localhost:<port>/<path>/`.
  - `page.ts`: `PROBE_PATH = "spike/s4/"` and `stripPolicyMeta(html): string`.
  - The deployed probe rewrites the document body with it.

**`pages.yml` layout** (top-level `permissions: contents: read`)

```yaml
on: { push: { branches: [main] }, workflow_dispatch: {}, workflow_run: { workflows: ["Registry snapshot"], types: [completed], branches: [main] } }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:   # permissions: contents: read, pages: read; outputs: generated-at
    if: github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'pull_request')
```

- **`build` steps:**
  1. checkout (`persist-credentials: false`) and `./.github/actions/setup`;
  2. `configure-pages` (`id: pages`);
  3. `git ls-remote --exit-code --heads "$REPO_URL" registry-snapshot` writes `present=true|false`; exit 2 means false, any other failure fails the step;
  4. if present, check out `ref: registry-snapshot` to `.cache/registry-snapshot` (`persist-credentials: false`);
  5. `pnpm build` with env `BASE_PATH: ${{ steps.pages.outputs.base_path }}`, `SITE_CONTEXT: production`, and `REGISTRY_SNAPSHOT_DIR: ${{ steps.snapshot.outputs.present == 'true' && format('{0}/.cache/registry-snapshot', github.workspace) || '' }}`;
  6. `pnpm check:site` with the same `BASE_PATH`;
  7. if present, `pnpm check:registry apps/web/dist`, then write `generated-at`;
  8. `upload-pages-artifact` with `path: apps/web/dist` (it drops `.vite/` as a dot directory).
- **`deploy`:**
  - `needs: build`, `if: github.ref == 'refs/heads/main'`;
  - permissions `pages: write`, `id-token: write`;
  - `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`;
  - output `page-url`.
- **`verify`:**
  - `needs: [build, deploy]`, `if: github.ref == 'refs/heads/main'`, `timeout-minutes: 30`, setup with `install: "false"`;
  - runs `pnpm check:site --url "$PAGE_URL" --commit "$GITHUB_SHA" --context production`;
  - when `github.event_name == 'workflow_run' && needs.build.outputs.generated-at != ''`, also runs `pnpm check:registry --url "$PAGE_URL" --generated-at "$GENERATED_AT"`.
- **Rules for every job:** all values reach `run:` through `env:`, and every job sets `timeout-minutes`.
- On a dispatch from a non-main branch, only `build` runs, which makes it a dry run.

**CI `site` job:** name "Site build for GitHub Pages (QA-30)", `env: BASE_PATH: /nf-builder/`, then `pnpm build` and `run: pnpm check:site`. The `budget` and `hosts` jobs get the same `env` line.

## 3. Tests (write first, per task)

**Unit tests (`test/`)**

`security-policy.test.ts` (T1)
- `ADR-0040 QA-30: CONTENT_SECURITY_POLICY is ADR 0014's policy without frame-ancestors, on one line` (exact string)
- `ADR-0040 QA-30: the site policy passes cspProblems and metaPolicyProblems`
- `F-011 QA-30: metaPolicyProblems rejects %s, which a <meta> policy ignores` (it.each over the three directives)
- `IO-41 QA-30: connect-src is exactly CONNECT_SRC_ALLOW_LIST`
- `F-011 step 2 QA-30: POLICY_META_TAGS are the CSP then the no-referrer policy, and SITE_POLICY_HEADERS carries the same values`
- Every existing `QA-30: cspProblems rejects %s` case carries over unchanged.

`security-policy-meta.test.ts` (T1)
- `F-011 step 2 QA-30: securityPolicyMeta applies only to builds and injects the CSP meta then the referrer meta with head-prepend`
- `F-011 step 2 QA-30: prependPolicyMeta puts both elements directly after <head>, before charset, scripts and links, and leaves a stamped page unchanged`
- `F-011 step 2 QA-30: a Vite build of a page plus a public HTML file starts both pages' <head> with the policy` (a real build in a temp directory)
- `F-011 QA-30: prependPolicyMeta throws on HTML without <head>`

`base-path.test.ts`
- `F-011 ADR-0040: basePath defaults to / and normalises /nf-builder and /nf-builder/ to /nf-builder/` (T1)
- `F-011 ADR-0040: basePath rejects ./, a bare name, //host and absolute URLs` (T1)
- `F-011 ADR-0040: no app source, index.html, public file, Vite config, build script or pages.yml hard-codes /nf-builder/` (T5)

`version-json.test.ts` (T1)
- Keep both existing cases.
- Add `F-011 step 1: versionInfo takes GITHUB_SHA in Actions, and SITE_COMMIT and SITE_CONTEXT win over the host's variables`.

`check-bundle-budget.test.ts` (T1)
- `QA-01 F-011: initialJsFiles strips the base path from script and modulepreload URLs, so a /nf-builder/ build counts the same files`

`netlify-toml.test.ts` (T2)
- Keep the build, `NODE_VERSION` and `PNPM_VERSION` cases.
- Add `F-002 step 2 ADR-0040: netlify.toml holds only [build] and [build.environment]: no headers, no redirects`.

Rewiring (T2), same assertions with a new source:
- `check-hosts.test.ts`: `IO-41 QA-30: the CSP connect-src and the host scan share the ADR 0002 allow-list` now reads `CONTENT_SECURITY_POLICY`.
- `s3-spike.test.ts` and `spike-s5.test.ts`: "netlify.toml's policy/header set" becomes "the site policy (`SITE_POLICY_HEADERS`)".

`check-site.test.ts` (T3; replaces `check-deploy-headers.test.ts`)
- `F-011 step 2 QA-30: checkSiteDir passes a build whose every page starts <head> with the CSP then the referrer meta, with assets under the base and a version.json`
- `F-011 step 2 QA-30: checkSiteDir names the file when %s`, it.each over:
  - no CSP meta;
  - a script or link before it;
  - different content;
  - `frame-ancestors` present;
  - the referrer meta missing or wrong;
  - an X-Frame-Options meta;
  - charset after byte 1024.
- `F-011 step 3 ADR-0040: checkSiteDir rejects asset URLs outside the base, ./ URLs and missing files, and ignores data: URLs`
- `F-011: checkSiteDir needs version.json with a string commit and context`
- `F-011 step 1: checkDeployedSite polls version.json with a cache-busting query until the commit is live, then checks the served page's policy and entry script` (a local server under `/nf-builder/`)
- `F-011 step 1: checkDeployedSite times out naming the last commit seen`
- `F-011 step 2: checkDeployedSite names the URL when the served CSP meta differs`
- `F-011: checkDeployedSite fails on a context mismatch, a page without an entry script, or a script not served as JavaScript`
- `F-011: node scripts/check-site.ts exits 1 on a problem and 2 without a build or with bad arguments, and reads the base from BASE_PATH`

`workflows.test.ts`
- T3:
  - The F-003 job-list test adds `site` (12 blocks) and `run: pnpm check:site`.
  - `F-011 step 2 ADR-0040: the site job builds with BASE_PATH=/nf-builder/ and runs pnpm check:site after pnpm build; budget and hosts use the same base`
- T5, a new `describe("Pages workflow")` that parses the YAML with the existing `yaml` dev dependency:
  - `F-011 step 1 ADR-0040: Pages runs on pushes to main, on dispatch, and on completed Registry snapshot runs on main`
  - `F-011 step 5 ADR-0041: the build job runs for a workflow_run only when the snapshot run succeeded and wasn't a pull request` (the exact expression)
  - `F-011 ADR-0040: concurrency group pages with cancel-in-progress false`
  - `F-011 ADR-0040: top-level permissions are contents: read; only deploy has pages: write and id-token: write, in environment github-pages; no job has contents: write`
  - `F-011 ADR-0040: configure-pages v6.0.0, upload-pages-artifact v5.0.0 and deploy-pages v5.0.1 are pinned to the recorded SHAs`
  - `F-011 step 2 ADR-0040: the build takes BASE_PATH from configure-pages' base_path and runs pnpm check:site before uploading apps/web/dist`
  - `F-011 step 5 ADR-0041: the snapshot branch is checked out without credentials only when ls-remote finds it, its absolute path goes to REGISTRY_SNAPSHOT_DIR, and pnpm check:registry apps/web/dist runs before the upload`
  - `F-011 step 1 ADR-0040: deploy and verify run only on main; verify needs deploy and runs pnpm check:site --url with GITHUB_SHA`
  - `F-011 step 5 ADR-0041: verify runs pnpm check:registry --url only on workflow_run, with generated-at from the build`
  - `F-011: no ${{ }} expression appears in a run: line of pages.yml`
  - `F-011 ADR-0041: no workflow names netlify.app, NETLIFY_BUILD_HOOK or REGISTRY_SNAPSHOT_TOKEN, and deploy-check.yml is gone`
- Registry snapshot tests (T5):
  - The ADR-0035 publish test drops the verify, hook and `ignore = "exit 0"` assertions and adds "commits only `registry/**`".
  - Rename "the repository is private, so every git read…" to `F-501 step 1: every git read or write of the repository carries the job token as an http.extraheader and never prompts` (assertions unchanged).

`registry-snapshot-site.test.ts` (T5)
- The Netlify-mode cases become `REGISTRY_SNAPSHOT_REPO` cases with the same assertions (fetch and emit, missing branch, unreadable repository, clone failure message, temporary directory removed).
- Replace the token test with `F-501 step 1 ADR-0041: branch mode reads anonymously: git gets no Authorization header, the URL carries no credentials, and git never prompts`.
- `F-501 ADR-0041: snapshotSource takes REGISTRY_SNAPSHOT_REPO, rewrites an SSH URL to https, and ignores NETLIFY, REPOSITORY_URL and REGISTRY_SNAPSHOT_TOKEN`

`check-registry-snapshot.test.ts` (T5)
- `F-501 F-011 step 5 ADR-0041: with a sample, checkDeployedSnapshot fetches only the index, ports.json, 20 evenly spaced bundles and 5 plugin files, each with a cache-busting query`
- `F-501 ADR-0041: a sampled bundle that is missing, not JSON, or holds another version fails naming its path`
- `F-501: evenlySpaced keeps the first and last items and returns all items when n exceeds the length`
- `F-501 ADR-0041: check:registry --url samples by default and --all checks every file`

`s4-probe.test.ts`
- T2: `F-008 ADR-0023 ADR-0040: the S4 probe workflow runs on dispatch only, probes in Chromium, Firefox and WebKit, and always uploads the results`. Keep the env-only input test.
- T4:
  - `F-008 step 1 ADR-0040: S4_PROBE_URL accepts only the production Pages site and a local preview under its base path, over https except localhost`
  - The `QA-30` page test expects `src="probe.js"`.
  - `F-008 ADR-0023: stripPolicyMeta removes the CSP meta and nothing else, so the deployed probe measures CORS, not our CSP`

**`apps/web/test/frame-guard.test.tsx`** (T4)
- `F-011 step 4 QA-30: isFramed is true only when window.top is not window.self`
- `F-011 step 4 QA-30: FramedNotice says the app can't run inside another page and links to the same address in a new tab`

**e2e**
- `app-shell.spec.ts` (T2, base path in T4):
  - The `@smoke` F-002 test asserts that `document.head.firstElementChild` is the CSP meta, instead of checking the header.
  - `F-002 step 2 ADR-0040: vite preview serves the build as GitHub Pages does: no security headers, a deep route is 404, and the entry script is under the base` replaces the netlify.toml header test.
  - The inline-script violation test is unchanged.
  - `version.json` is fetched by a relative path.
- `pages-hosting.spec.ts` (T4):
  - `F-011 step 2 QA-30: the app page and the S4 page start <head> with the CSP and referrer meta elements, with no console error`, tagged `@smoke` so Firefox and WebKit show that no meta directive logs an error.
  - `F-011 step 3 ADR-0040: the site is served under the base path: /version.json is 404, version.json is 200, and / redirects to the base`
  - `F-011 step 4 QA-30: inside a cross-origin frame the app does not mount and offers "Open in a new tab"`. Use `page.setContent` with an iframe to `PREVIEW_URL`.
- `s4-probe-page.spec.ts`: the same two F-008 tests, with the meta check instead of the header check; the `self` target becomes `../../version.json`.
- `registry-snapshot.spec.ts`: relative paths; update the SPA comment.
- `parser-chunk.spec.ts` and `palette.spec.ts`: pass `E2E_BASE_PATH` to `initialJsFiles`.
- No visual baseline should change: rendering is identical.

**Tests removed with their behaviour.** Each maps to ADR 0040 or 0041 and has a replacement above. List them in the PR:
- the SPA fallback (netlify.toml and deep-route cases);
- the netlify.toml header set;
- `--allow-newer`;
- `REGISTRY_SNAPSHOT_TOKEN`;
- the S4 PR trigger and wait step;
- the registry verify job and its hook.

## 4. Tasks

Each builder run ends with `pnpm check`. Export `PW_CHROMIUM_EXECUTABLE` before e2e.

1. **T1, new modules, nothing wired yet:**
   - `security-policy.ts` (with `netlify-config.ts` still present), `security-policy-meta.ts`, `base-path.ts`;
   - the `version-json.ts` variables;
   - the budget `base` argument;
   - their unit tests.

   Proves it: `pnpm check`.
2. **T2, switch the build to the meta policy and drop Netlify headers and checks:**
   - `vite.config.ts` (base, plugin, `mpa`, no headers);
   - the minimal `netlify.toml` and `netlify-toml.test.ts`;
   - delete `netlify-config.ts`, `check-deploy-headers.ts` with its test, and `deploy-check.yml`;
   - rewire the spikes, unit tests and e2e imports, and change the header assertions to meta assertions (still at base `/`);
   - the S4 workflow becomes dispatch only;
   - the `allow-list.ts` comment.

   Proves it:
   ```
   pnpm check && pnpm build && head -c 800 apps/web/dist/index.html && pnpm smoke && pnpm test:e2e -- --project chromium
   ```
3. **T3, `check:site` and the CI gate:**
   - `check-site.ts` and its tests;
   - the `package.json` script;
   - the `ci.yml` `site` job and `BASE_PATH` on `budget` and `hosts`, with the `workflows.test.ts` CI tests;
   - AGENTS.md (the "CI green" sentence, the Commands rows, line 51) and the PR template.

   Proves it:
   ```
   pnpm check
   export BASE_PATH=/nf-builder/; pnpm build && pnpm check:site && pnpm check:budget && pnpm check:hosts
   SITE_COMMIT=t BASE_PATH=/nf-builder/ pnpm build && (BASE_PATH=/nf-builder/ pnpm preview &) && pnpm check:site --url http://localhost:4173/nf-builder/ --commit t
   ```
4. **T4, e2e under `/nf-builder/`, the frame guard, and the S4 base path:**
   - `urls.ts` and `playwright.config.ts`, with relative paths in every spec;
   - `pages-hosting.spec.ts`;
   - `frame-guard.tsx`, `main.tsx` and `styles.css`;
   - the S4 page `src`, `probeSite` and `stripPolicyMeta`.

   Proves it: `pnpm check && pnpm smoke && pnpm test:e2e -- --project chromium`.
5. **T5, the snapshot and `pages.yml`:**
   - the host-neutral plugin;
   - sampled and cache-busted `check:registry`;
   - the `registry-snapshot.yml` cleanup;
   - `pages.yml`;
   - the Pages, registry-snapshot and workflow tests, and the base-path guard.

   Proves it:
   ```
   pnpm check
   F=$PWD/tools/registry-snapshot/test/fixtures/expected
   REGISTRY_SNAPSHOT_DIR=$F BASE_PATH=/nf-builder/ SITE_COMMIT=t pnpm build && pnpm check:registry apps/web/dist
   BASE_PATH=/nf-builder/ pnpm preview &
   pnpm check:registry --url http://localhost:4173/nf-builder/ --generated-at 2026-11-22T00:00:00.000Z
   ```
6. **T6, docs and scope (main session):**
   - `features.json`, README, roadmap, `renovate.json`, the handoff notes, `progress.md`;
   - `pnpm format`, then `pnpm check` (the `check:features` and AGENTS.md tests).

The sandbox can't reach github.io. The deployed modes are proved only against `vite preview` under `/nf-builder/`. The first real run is the push to `main`: watch `verify`.

## 5. Records

**ADR 0040, "Host on GitHub Pages; security policy in a meta element".** It must say:

*Context*
- The repository is public, and the maintainer decided on 2026-11-22 that Pages is the production host.
- Pages sends no custom headers. Cite the staff reply and the observed responses.
- A meta policy can't carry `frame-ancestors`, `report-uri` or `sandbox`. Chromium logs `frame-ancestors` and X-Frame-Options in a meta element as console errors.
- A meta policy doesn't govern URL-loaded workers (reproduced in Chromium 157).
- Project sites share the origin `ewels.github.io`.
- ADR 0002 rejected Pages for exactly this (headers and previews); the maintainer now accepts that trade-off.
- Link the researcher's report, saved as `docs/research/2026-11-22-github-pages.md` without its scratchpad paths.

*Decision: hosting and deploy*
- `pages.yml`: the three pinned actions; the push, dispatch and `workflow_run` triggers (with ADR 0041); concurrency `pages`; least-privilege jobs.
- The URL is the placeholder `https://ewels.github.io/nf-builder/`.
- `BASE_PATH`:
  - fed from `base_path`, default `/`, absolute only, never `./`;
  - runtime URLs come from `import.meta.env.BASE_URL`;
  - `/nf-builder/` appears only in test configuration.

*Decision: the policy*
- `scripts/security-policy.ts` is the single source. Restate the policy in full, the one-line and no-comma rule, the "no inline scripts" definition, and that `'wasm-unsafe-eval'` is allowed when needed.
- Loosenings are recorded in the PR that needs them.
- Build-time code lives in `scripts/` and `e2e/`.
- The policy is injected at build time only, with head-prepend, into every emitted HTML page (public pages too, through `writeBundle`), followed by the referrer meta.
- Header-only protections are accepted risks, each with its reason: XFO and `frame-ancestors`, nosniff, COOP, CORP, Permissions-Policy.
- The frame guard compensates for clickjacking.
- Workers make no cross-origin requests; IO-41 scans every bundle.

*Decision: dev and preview*
- Dev has no policy.
- Preview mirrors Pages: no headers, the same base, `appType: "mpa"`.
- The SPA fallback is dropped: the app has no routes, and Pages serves 404.

*Decision: gates*
- There are no deploy previews.
- The PR gate is the CI `site` job plus `budget` and `hosts`, all on the same base.
- On `main`, `verify` checks the deploy.
- "CI green" means `CI` plus `Scope guard`. `version.json` reads `SITE_COMMIT`, `COMMIT_REF` or `GITHUB_SHA`, and `SITE_CONTEXT` or `CONTEXT`.

*Decision: Netlify*
- A minimal `netlify.toml` stays for development builds. Nothing in CI depends on it.
- `smol-toml` stays as a dev dependency read only by `test/netlify-toml.test.ts` (section 6).

*Decision: S4*
- Dispatch only, against Pages; the deployed probe strips the meta policy.

*Consequences*
- These Accepted lines have lapsed but can't be edited:
  - 0015:14 (the manifest is no longer served: `upload-pages-artifact` drops dot directories);
  - 0016:16 and 0031:19 (Deploy check; docs-only pushes now redeploy);
  - 0022:13-14, 0023:14-16 and 0024:15 (headers and the preview probe).
- 0015:17 still holds, because the pins stay.
- The shared-origin storage risk: decide on a custom domain before F-202.
- Unconfirmed: workers in Firefox and WebKit, the `.wasm` MIME type, CDN purge on deploy (hence the cache-busters), and the 60-day disabling of scheduled workflows.

*Alternatives*
- Keep Netlify.
- A `404.html` copy or hash routing.
- A `./` base: `BASE_URL` becomes `./`, which inside a worker resolves against `/assets/`.
- Meta X-Frame-Options or `sandbox`.
- A CDN in front of Pages for headers (another account).

**ADR 0041, "Deploy the registry snapshot with the site from Actions".** It must say:

*Context*
- `#27` (the hook secret) and `#31` (the private repository).
- A push made with `GITHUB_TOKEN` doesn't start workflows.

*Decision*
- The `workflow_run` trigger with the exact guard.
- The `ls-remote` check, then an anonymous checkout into an absolute `REGISTRY_SNAPSHOT_DIR`. With no branch, the deploy goes ahead without `/registry/`.
- A full `check:registry` on `dist` before upload.
- The bounded post-deploy sample: index, ports, 20 bundles, 5 plugins, cache-busted; `--all` for manual runs.
- The plugin is host-neutral (`REGISTRY_SNAPSHOT_REPO`); the `NETLIFY` switch and the token are gone.
- `registry-snapshot.yml` loses `verify` and stops writing `netlify.toml`. Its git calls keep the job token.
- Restate the unchanged parts of 0035:
  - format v1 and the builder;
  - the failure policy;
  - the check;
  - the schedule and the PR dry run;
  - publishing to the orphan branch;
  - the build-time hosts, with github.com used from the workflow and the Pages build;
  - not a merge gate.

*Consequences*
- Close #27 and #31.
- The snapshot is live minutes after each daily run.
- `workflow_run` fires only from the default branch's file and chains at most three deep.
- A pending run cancelled by concurrency is covered by the next deploy.
- A Netlify development site gets the snapshot only if its environment sets `REGISTRY_SNAPSHOT_REPO`.

*Alternatives*
- A push trigger on the branch (it can't fire).
- `workflow_call` (it would grant `pages` and `id-token` beside a 120-minute third-party job).
- `gh workflow run` (an extra `actions: write`).
- One combined workflow.
- A second cron.
- Building the snapshot per deploy.

**QA-30** (`docs/spec/quality.md:38`):

> Strict Content Security Policy in a `<meta http-equiv>` element at the start of every page's `<head>` (GitHub Pages sends no custom headers, ADR 0040): no inline scripts; `connect-src` limited to the ADR 0002 allow-list. The policy governs the document only: Web Workers make no cross-origin requests (the document fetches and passes them data), and IO-41 scans every bundle. `frame-ancestors`, X-Frame-Options, nosniff, COOP, CORP and Permissions-Policy are unavailable; instead the app does not start inside a frame and shows a short message with an "Open in a new tab" link.

**features.json** (label `scope-change`)
- Insert F-011 after F-010:
  ```json
  {"id":"F-011","milestone":"M0","description":"Host the app on GitHub Pages, deployed from GitHub Actions with the registry snapshot and no secrets; the QA-30 policy travels in `<meta>` elements and the app won't run inside a frame (ADRs 0040, 0041).","spec":["ADR-0040","ADR-0041","QA-30","IO-31","IO-41"],"depends_on":["F-002","F-003"],"steps":["A push to `main` runs the `Pages` workflow: it builds with the base path from `actions/configure-pages`, deploys, and its `verify` job finds the pushed commit in `version.json` at https://ewels.github.io/nf-builder/ (placeholder; a custom domain may replace it)","Every built page starts its `<head>` with the QA-30 policy in `<meta http-equiv=\"Content-Security-Policy\">` (ADR 0014's policy without `frame-ancestors`) followed by `<meta name=\"referrer\" content=\"no-referrer\">`; the CI `site` job checks a `/nf-builder/` build with `pnpm check:site` on every pull request, and `verify` checks the deployed page","`pnpm test:e2e` builds and previews under `/nf-builder/` with no security headers and no single-page-app fallback, as Pages serves it, and the app loads with no CSP violation or console error","Inside a frame the app does not mount and shows a short message with an \"Open in a new tab\" link","A successful `Registry snapshot` run on `main` triggers a Pages deploy that serves the snapshot at `/registry/` without any secret, and `verify` passes `pnpm check:registry --url` against the deployed site"],"passes":false,"notes":""}
  ```
- **F-002:**
  - Description: "…deploys to GitHub Pages from `main` (ADR 0040)."
  - Step 2: "`pnpm build` writes a static site to `apps/web/dist` with no single-page-app fallback (ADR 0040); `netlify.toml` keeps only the build command, publish directory, and Node and pnpm versions, for development builds".
  - Step 3: "Merging to `main` deploys to https://ewels.github.io/nf-builder/ (placeholder; a custom domain may replace it) and the page loads; a pull request builds the site as Pages will in the CI `site` job".
  - Step 4: "The deployed page carries a Content-Security-Policy `<meta>` element that matches QA-30".
  - Append to notes: reworded under ADR 0040; steps 3 and 4 are confirmed after merge by `verify` (Q11).
- **F-704:** "…the v0.1.0 release on GitHub Pages". Its step URL becomes `https://ewels.github.io/nf-builder/ (or the custom domain that replaces it, ADR 0040)`. Append a placeholder note.
- **Append to notes:**
  - F-501: "To pass: the Pages deploy serves `/registry/` and the verify job passes (ADR 0041); #27 and #31 no longer block."
  - F-502:
    - fetch with `import.meta.env.BASE_URL`, never `/registry/`;
    - there is no SPA fallback, so a missing file is a 404, but keep the JSON content-type check;
    - fetch in the document, not a worker (QA-30).
  - F-607:
    - no `'wasm-unsafe-eval'` is needed on Pages, because workers aren't under the meta CSP; add it to `security-policy.ts` only if the document compiles WebAssembly;
    - take `indexURL` from `BASE_URL`;
    - the `.wasm` MIME type is unconfirmed.
  - F-008 (optional): the probe is dispatch only, against Pages, and strips the meta.

**progress.md Decisions lines**
- Pages host and meta policy (ADR 0040).
- The snapshot is deployed from Actions (ADR 0041).
- The SPA fallback and deploy previews are dropped, with F-002 reworded (`scope-change`).
- `budget` and `hosts` stay separate jobs.
- S4 public HTML is stamped with the policy.
- The `check:registry --url` sample size.
- `SITE_CONTEXT`.
- `smol-toml` is kept.
- `.github/workflows/` edits: `pages.yml` is new, `deploy-check.yml` is deleted, `ci.yml`, `registry-snapshot.yml` and `s4-probe.yml` change.
- The tests removed with their behaviour.

## 6. Decided here

**`smol-toml` stays.** `netlify.toml` keeps the Node and pnpm pins, and something must keep them in step with `package.json`: `renovate.json:35` relies on that test, and Netlify development builds break if the pins drift. The same test should fail if headers or redirects come back. Dropping `smol-toml` would mean a hand-written TOML regex. The reader moves from `scripts/netlify-config.ts` into `test/netlify-toml.test.ts` alone, and the lockfile doesn't change.

## 7. Maintainer issues

**New issue, labelled `maintainer`: "Enable GitHub Pages (Source: GitHub Actions)"**

> F-011 moves production to GitHub Pages (ADRs 0040, 0041). Please:
> 1. Settings → Pages → Build and deployment → Source: **GitHub Actions**. `GITHUB_TOKEN` can't do this (configure-pages' `enablement` needs a personal token). Until then the `Pages` workflow fails at configure-pages on `main`, so F-011 waits to merge. Keep the `github-pages` environment's default rule (deploy from `main`).
> 2. Decide on a custom domain before F-202 (projects in IndexedDB) ships. Under `ewels.github.io` every project site of the account shares one origin, and with it IndexedDB, localStorage and CSP `'self'`. Moving later would orphan users' projects. With a custom domain the base becomes `/` automatically; nothing hard-codes `/nf-builder/` outside the tests.
> 3. Repository → About → Website: change `https://nf-builder.netlify.app/` to `https://ewels.github.io/nf-builder/` (or the custom domain).
> 4. The Netlify site: keep it for development builds (`netlify.toml` now has only build settings; set `REGISTRY_SNAPSHOT_REPO=https://github.com/ewels/nf-builder.git` in its environment if you want `/registry/` there; turn off branch deploys, since the snapshot branch no longer carries a `netlify.toml` that skips it), or unlink it. Either way it no longer serves security headers, so consider stopping production publishes to `nf-builder.netlify.app` so users don't land on a stale copy. You can delete the `NETLIFY_BUILD_HOOK` secret and Netlify's `REGISTRY_SNAPSHOT_TOKEN`.
> 5. Scheduled workflows in public repositories are disabled after 60 days without activity. If the daily `Registry snapshot` stops, re-enable it under Actions.

**Comment on #7**

> F-011 deletes the `Deploy check` workflow (ADR 0040). In the suggested required checks, replace `Deployed site matches netlify.toml` with the CI job `Site build for GitHub Pages (QA-30)`. The `Pages` workflow deploys only from `main` and isn't a pull-request check.

**After merge:**
- Close #31: "Resolved: the repository is public, and the Pages build reads the snapshot branch without a token (ADR 0041)."
- Close #27: "Not needed: a successful Registry snapshot run triggers the Pages deploy through `workflow_run` (ADR 0041)."

## 8. Settle first

1. **Merge timing.** Build and review now, but merge only after Pages is enabled; until then treat F-011 as blocked and move on. CI is also blocked by #33. Merging early turns every push and every daily run red at configure-pages, and fails F-002's post-merge confirmation.
2. **ADR mechanics.** The ADR lint (`scripts/check-adrs.ts:14`) only allows "Superseded by NNNN" for a whole ADR. My recommendation:
   - 0014: "Superseded by 0040".
   - 0002: stays Accepted, "amended by 0040" (only its hosting bullet and the Pages alternative change), as 0035 amended 0003.
   - 0035: "Superseded by 0041", with 0041 restating the parts that still stand.
3. **QA-30.** Land the amendment with the ADRs on `main`, so the branch's tests cite text that already exists.
4. **CI layout.** Keep the separate `budget` and `hosts` jobs with `BASE_PATH=/nf-builder/` (ADR 0015, one job per check; #7's names). The alternative is one job running three checks: fewer builds, but it contradicts 0015.
5. **The S4 page.** Stamp copied public HTML in `writeBundle`, so F-008's "under the site CSP" tests keep their meaning. The alternatives:
   - a static meta copy plus an equality test;
   - deleting the probe early, which isn't allowed: F-502 owns that under ADR 0023.
6. **The deployed registry check.** A full check on `dist` before upload, plus a remote sample of index, ports, 20 bundles and 5 plugins (about 27 requests, cache-busted).
7. **`SITE_CONTEXT=production`** in `pages.yml`, with `verify --context production`. It's a small addition to the decided `version.json` change.
8. **A fifth F-011 step for the frame guard.** The brief listed four steps; I recommend five, so the guard has a verifiable step.
9. **Tests removed with their behaviour** (section 3). The reviewer must accept them as replacements, not weakening, and the PR maps each one.
10. **Frame-notice wording.** "nf-builder can't run inside another page." and "Open in a new tab".
11. **When `passes` flips.** Per Q11, set F-011 to `true` in the PR once T1 to T5 pass, and have the post-merge `verify` (push run, then the first snapshot-triggered run) confirm steps 1 and 5. Set F-501 to passing in a follow-up PR after a snapshot-triggered `verify` passes.

## 9. Open points

- **Whether `pages: read` is enough for configure-pages in the build job.** It is a GET, so it should be. If the first run fails, the fix is `pages: write` on `build`.
- **Unconfirmed by the researcher:**
  - worker CSP behaviour in Firefox and WebKit;
  - whether github.io serves `.wasm` as `application/wasm`;
  - whether the CDN honours `?ts=`;
  - which other `ewels.github.io` sites share the origin;
  - whether Netlify builds work without headers in the toml.
- **The researcher's worker Referer note** (origin-only Referer from workers) is moot under the QA-30 rule that workers make no cross-origin requests. Nothing exists yet that needs it.
- **Docs-only pushes to `main` now redeploy Pages.** That's harmless. No `paths-ignore`, as decided.
