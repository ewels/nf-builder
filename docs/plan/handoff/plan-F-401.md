# Plan: F-401, import a public GitHub repo: ref resolution, tree listing, raw contents, filters, summary before and report after

Written by the planner on 2026-11-23 from `origin/main` at `2c3cc69` (F-203 merged). I changed nothing in the repository; I read it from a throwaway worktree, since removed. Paths are relative to the repository root. Probes and recordings are in the scratchpad (section 8).

## 0. Scope

**In scope:**
- **Import route.** A third route, "Import from GitHub", in the New project dialog (UX-60; F-203's note). It takes `owner/repo` or a github.com URL, plus an optional branch, tag or commit; empty means the default branch (IO-10).
- **Ref resolution and tree listing.** At most two `api.github.com` requests per import (ADR 0009, step 2). Contents come from `raw.githubusercontent.com`.
- **Filters and limits (IO-12).**
  - The default ignore list, editable before confirming.
  - The 1 MB per-file limit.
  - The 20,000-file and 200 MB limits.
  - Binaries skipped.
  - A truncated listing aborts.
- **Summary before (UX-61).** Files, skipped (with reasons) and size, shown before any file is downloaded.
- **Report after (UX-61).** Parse failures, legacy share and suggestions count, plus the skipped files.
- **The project source (IO-13).** Repo, ref and commit SHA, recorded on the project record.
- **Errors.** Rate limited, not found, no such ref, empty repository, truncated, network failure, a failed or incomplete download (IO-14: these I/O errors abort, and nothing is stored).
- **Testing without the network.** Recorded fixtures for unit tests, and a `page.route` GitHub mock for e2e. An opt-in live test.

**Out of scope:**
- Tokens, private repos and the blobs API (F-402, deferred to M8).
- Zip import (F-403); it reuses this plan's shared filters and `importProject`.
- Storing binary files (needs schema v2, ADR 0045) and executable bits.
- Export (F-404).
- Typed badges, suggestion counts in the status bar, % modelled (F-405).
- Recording a template source (F-203's note).
- Importing a subdirectory of a repository.
- Hosts other than github.com.

## 1. Findings

### 1.1 Spec and ADRs
- **IO-10:** "GitHub import takes `owner/repo` or a github.com URL, an optional ref (default branch if empty) and an optional token. It follows ADR 0009: two API calls, contents from raw, blobs API for private repos."
- **IO-12:** "Both routes apply the size limit (1 MB per text file) and the default ignore list, editable before confirming. Limits guard against zip bombs: at most 20,000 entries and 200 MB uncompressed." The default list is never spelled out. ADR 0009 says only "(`work/`, `results/`, test data)".
- **IO-13:** "The project records its source (repo and commit SHA, or zip name and hash)."
- **IO-14:** import never fails because of code; only I/O errors and limit breaches abort.
- **UX-61:** "Import shows a summary (files, skipped, size) before creating the project, then a report afterwards: parse failures, legacy share, suggestions count." Neither "legacy share" nor "parse failures" is defined.
- **UX-60:** lists the Import route "(GitHub repo with ref and optional token, or zip)". The mockup (`docs/mockup/6-newproject.png`) shows an Import card with Repository, Branch or tag, Token (optional) and an Import button, under a "GitHub repo | .zip file" toggle.
- **QA-30 and ADR 0040:** "Web Workers make no cross-origin requests (the document fetches and passes them data)." A meta CSP doesn't govern URL-loaded workers (reproduced in Chromium 157).
- **AR-30:** project content lives only in the engine and IndexedDB, not in Zustand stores.
- **QA-31:** imported files are never executed.
- **ADR 0002 and IO-41:** `api.github.com` and `raw.githubusercontent.com` are in `scripts/allow-list.ts` and the CSP `connect-src`.
- **ADR 0045:** schema v1. `projects` holds `{id, name, languageVersion, createdAt, updatedAt, openedAt}`; `files` holds text only. "Binary content will need a version bump." "Future format changes go through `MIGRATIONS` and are decide-and-record changes."
- **ADR 0047:** "The Import route and the metro map checkbox stay with F-401, F-403 and F-607"; "Projects don't record which template they started from. F-401 may add that".
- **F-606 step 3:** "Import a pipeline: no docs files are added until Add docs publishing is used".
- **ADR 0003:** `packages/sources` holds the "GitHub, zip and registry clients" and may import only `lang-core`. The engine rule's message in `.dependency-cruiser.cjs` says "fetching belongs in packages/sources".

### 1.2 What exists today
- **`packages/sources`:** an empty stub (`src/index.ts` is `export {}`), with one ADR-0003 test. `apps/web` may import it (`web-imports-only-listed-packages`), but `apps/web/package.json` doesn't list it yet.
- **Workspace (`apps/web/src/workspace/`).**
  - `createProject(NewProject)` writes the record and its files in one transaction.
  - `project-db.ts` keeps unknown record fields: `update(id, m => ({...m, name, updatedAt}))` and `saveFiles` put `{...meta, updatedAt}`, so an optional `source` survives rename, touch and save.
  - `WorkspaceApi` extends `EngineApi`.
- **Engine bridge.** `connectEngine` (`apps/web/src/engine/engine-client.ts`) lists every method explicitly, so new methods must be added there. `exposeEngine` spreads the API.
- **Project store.** `create()` calls `createProject` then `openAndShow` (`apps/web/src/project/project-store.ts`).
- **The dialog.** `NewProjectDialog` has a two-radio route group, `NewProjectRoute = "blank" | "template"`. `useModal.run` closes the dialog on success.
- **Engine.**
  - `EngineApi` (`packages/engine/src/service/types.ts`) has no report.
  - `countDiagnostics` exists, with `suggestions` (`packages/engine/src/diagnostics/diagnose.ts`).
  - The projector's `workflows()` returns `WorkflowRef {path, name, modelled, typed}`.
  - `Process` AST nodes carry `typed`.
  - `Unparsed` items carry `head: {keyword, name}` for scripts and configs alike (`packages/lang-core/src/ast/unparsed.ts`).
  - `ProjectSummary.files` gives each file's parse status.
- **Canvas.** It opens main.nf's entry workflow first (`canvas-store.ts`), which suits nf-core imports.
- **`check:hosts`.** It scans main and worker chunks for absolute URLs. A literal `https://github.com/...` in UI copy would be flagged; scheme-less placeholder text is fine.
- **e2e harness.**
  - `watchForCspViolations`, `readStoredDatabase` and the `window.nfBuilderEngine` hook exist.
  - CI restores `.cache/corpus` only in the Chromium e2e leg (`ci.yml`). Firefox and WebKit run `@smoke` tests only.
  - Tests that need the corpus throw a "run pnpm corpus:fetch" error (`e2e/canvas.spec.ts`).
- **Corpus.** `tools/corpus/corpus.yaml` pins fetchngs `1.13.0` at `955c892d80927cee633765e6e390f9cc6b7235c9`. `corpus:fetch` checks out with `core.autocrlf=false` and deletes `.git`.

### 1.3 GitHub API: live probes (2026-11-23) and REST docs

| Question | Answer | Evidence |
|---|---|---|
| Ref to SHA in one call | `GET /repos/{o}/{r}/commits/{ref}` with `Accept: application/vnd.github.sha` returns the 40-character SHA as the body (`Content-Length: 40`). The default JSON for `2c3cc69` was **327,609 bytes**, because it carries up to 300 diff files. | Probe on ewels/nf-builder. Docs: "application/vnd.github.sha: Returns the commit's SHA-1 hash"; "If there are more than 300 files in the commit diff… pagination link headers" |
| Default branch | `commits/HEAD` resolves to the default branch's head. | Probe: `HEAD` and `main` both gave `2c3cc690…` |
| Ref forms | Branch, tag, short or full SHA. A slashed branch (`feat/F-001`) works raw, `%2F`-encoded or as `refs/heads/…`. | Probe; docs: "Can be a commit SHA, branch name (heads/BRANCH_NAME), or tag name (tags/TAG_NAME)" |
| Unknown ref | **422**, `{"message":"No commit found for SHA: no-such-ref-zz",…}` | Probe |
| Other documented statuses for get-a-commit | 404, 409 (empty repository), 422, 429, 500, 503 | Docs |
| Tree listing | `GET /repos/{o}/{r}/git/trees/{commit_sha}?recursive=1` accepts the commit SHA and echoes it as `sha`. Entries: `{path, mode, type, sha, size (blobs only), url}`. Here: 2,645 entries, **853,747 bytes** (about 322 bytes per entry, pretty-printed), `truncated: false`. | Probe; docs: "tree_sha: The SHA1 value or ref (branch or tag) name of the tree" |
| Truncation | "The limit for the tree array is 100,000 entries with a maximum size of 7 MB when using the recursive parameter." If `truncated` is true, fetch sub-trees one at a time. At 322 bytes per entry, **7 MB is about 21,700 entries**, close to IO-12's 20,000. | Docs ("Get a tree") |
| Tree errors | Unknown ref name: **404** `"Not Found"`. Zero SHA: **422** `"Invalid object requested. SHA must identify a commit or a tree."` | Probe |
| Tree order and shape | The API's recursive tree equals `git ls-tree -r -t -l <sha>` exactly (order, path, mode, type, sha, size) for all 2,645 entries. `url` is `…/git/{blobs\|trees}/{sha}`. | `f401-cmp.py` on ewels/nf-builder@2c3cc69 |
| Raw content | `https://raw.githubusercontent.com/{o}/{r}/{sha}/{path}` returns the blob bytes. fetchngs `main.nf`: 2,766 bytes, the same git blob SHA as the tree (`02b1dc2f…`). Headers: HTTP/2, `cache-control: max-age=300`, `content-type: text/plain; charset=utf-8`, `access-control-allow-origin: *`, **no `Access-Control-Expose-Headers`**. | Probe |
| CORS | `Access-Control-Allow-Origin: *` on every API response observed (200, 404, 422) and on raw 200 and 404 (missing file, missing repo). The API exposes `ETag, Link, Location, Retry-After, X-RateLimit-Limit, -Remaining, -Used, -Resource, -Reset, …`. Spike S4 confirmed both hosts in Chromium 159, Firefox 159 and WebKit 27.2. | Probes; `docs/research/2026-11-22-spike-s4-cors.md`; docs: "The REST API supports cross-origin resource sharing (CORS) for AJAX requests from any origin" |
| Preflight | `Accept` with `application/vnd.github.sha` or `application/vnd.github+json` is CORS-safelisted, so a plain GET sends no OPTIONS. `X-GitHub-Api-Version` or `Authorization` would trigger a preflight; S4 recorded the API answering one with 204 and `*`. | Fetch standard's safelist; S4 report |
| API version | With no version header, GitHub answers `X-Github-Api-Version-Selected: 2022-11-28`. | Probe |
| Anonymous rate limits | REST: "The primary rate limit for unauthenticated requests is 60 requests per hour", per originating IP. Secondary limits: at most 100 concurrent requests, 900 points per minute per endpoint. When exceeded: "a 403 or 429 response, and the x-ratelimit-remaining header will be 0… don't retry until … x-ratelimit-reset"; for secondary limits, honour `retry-after`. | Docs ("Rate limits for the REST API") |
| Raw rate limits | Since May 2025, anonymous limits apply to "downloading files from raw.githubusercontent.com"; no numbers are published. Raw exposes no headers to the page, so only the status of a 429 is readable, and whether a 429 carries CORS headers is unknown. | GitHub changelog 2025-05-08, "Updated rate limits for unauthenticated requests" |
| Archives | `codeload.github.com` allows only `render.githubusercontent.com`, so archives are blocked (S4). | S4 report |

The sandbox proxy refuses `api.github.com` for repositories not attached to the session ("GitHub access to this repository is not enabled for this session"). The ewels/nf-builder probes went through with credentials the proxy injected (`X-Ratelimit-Limit: 15000`, `X-Oauth-Client-Id` present). So the anonymous limits above come from the docs, and **no live API call for nf-core is possible from the sandbox**. `raw.githubusercontent.com` is reachable for any repository.

### 1.4 The corpus and what the filters do to it
- **fetchngs at the pin (git, `ls-tree`).**
  - 207 entries: 48 trees and 159 blobs (153 with mode 100644, 6 with 100755). No symlinks, no submodules.
  - 2,623,767 bytes in all.
  - All 159 files in `.cache/corpus/fetchngs` hash to the tree's blob SHAs (`git hash-object --no-filters`): the corpus cache is byte-identical to what raw serves.
- **Binaries.** fetchngs holds 4 PNGs (336,087 bytes). That leaves **155 text files, 2,287,680 bytes**. The largest text files are two SVGs of 857,607 and 857,659 bytes, both under 1 MB.
- **Larger pipelines.**
  - rnaseq: 900 files, 15.6 MB, 56 binary.
  - sarek: 885 files, 27.3 MB, 32 binary; one text file over 1 MB (`docs/posters/poster_tubit_2021_FHanssen.svg`, 2,345,368 bytes).
  - rnaseq-nf: 35 files (6.2 MB, mostly FASTQ under `data/ggal/`, which its default params read).
- **Binary detection.** "NUL byte in the first 8,000 bytes, or invalid UTF-8" and a list of binary extensions agree on **every** corpus file (0 disagreements). No text file has a BOM, and CR appears only in the PNGs.
- **Report inputs.** fetchngs has 9 processes and 7 workflows, all legacy (no `nextflow.enable.types`). Its legacy share is therefore 100%. Every corpus file is fully modelled (F-104), so fetchngs has no parse failures.
- **Executable files.** 6 fetchngs files have mode 100755 (`bin/*.py`, hooks and templates). Schema v1 can't store modes.

## 2. Design

### 2.1 Where things run
- **Document (main thread).** The GitHub client (`packages/sources/src/github/`) makes the two API calls and the raw downloads. It:
  - takes `fetch` by injection, which helps tests and means it never reaches for a global in a worker;
  - sends `credentials: "omit"`;
  - sends only the safelisted `Accept` header, so there are no preflights.
- **Raw downloads.** Each file is read with `response.arrayBuffer()`. `response.text()` would strip a BOM and replace invalid bytes. The buffers are handed to the worker in **one** `importProject` call, with the `ArrayBuffer`s **transferred** (Comlink `transfer`), so no copy remains on the main thread. Nothing goes into a Zustand store, which keeps AR-30. Main-thread memory is bounded by the 200 MB limit.
- **Worker (workspace).**
  - It decodes with `TextDecoder("utf-8", {fatal: true, ignoreBOM: true})`, so a BOM and CRLF are kept and `TextEncoder` gives back the same bytes.
  - It skips content-detected binaries.
  - It writes the project record and its files in one transaction.
  - Parsing, the model and the report stay in the engine (AR-31).
- **Enforcement.** A dependency-cruiser `reachable` rule stops `apps/web/src/engine/engine.worker.ts` from reaching `packages/sources/src/github/` (open point 11). `@nf-builder/sources` gains a `./github` subpath export. The `.` entry holds only worker-safe import helpers (filters, decoding, planning), which F-403's zip worker will reuse.

### 2.2 The two API calls and the downloads
1. **Resolve.** `GET {API}/repos/{owner}/{name}/commits/{encodeURIComponent(ref ?? "HEAD")}` with `Accept: application/vnd.github.sha`. The body must match `/^[0-9a-f]{40}$/`, otherwise the error kind is `unexpected`.
2. **List.** `GET {API}/repos/{owner}/{name}/git/trees/{sha}?recursive=1` with `Accept: application/vnd.github+json`.
   - `truncated: true` is a `truncated` error: abort; the repository is too large.
   - Entries map to candidates:
     - mode 100644 or 100755 → file;
     - 120000 → symlink, skipped;
     - type `commit` → submodule, skipped;
     - trees are dropped.
3. **Download.** `GET {RAW}/{owner}/{name}/{sha}/{segments.map(encodeURIComponent).join("/")}` for each planned file.
   - At most **8 in flight**.
   - **One retry** after 1 s on a network error or a 5xx. No retry on any 4xx.
   - A body whose length differs from the tree's `size` is an `incomplete` error: abort.
   - Cancelling aborts every in-flight request.

Editing the ignore list re-plans locally from the listing, with no network. Clicking Review again with the same repo and ref reuses the listing. A renamed repository answers with a 301 that `fetch` follows; that adds one API request per call, which is noted, not hidden.

### 2.3 Filters, limits and the plan (IO-12), shared with F-403
- **Ignore list.** A gitignore subset:
  - one pattern per line; blank lines and `#` comments are skipped;
  - a trailing `/` matches a directory (any path segment);
  - a leading `/` anchors at the root;
  - `*` and `?` match within a segment, `**` across segments;
  - `!` isn't supported and is reported as a problem under the field.
  - `work/` must not match `workflows/` or `subworkflows/` (a test pins this).
  - The default list is open point 4.
- **Order of skip reasons.** A file is skipped for the first reason that applies:
  1. `unsafe-path` (empty, `.` or `..` segments, or a leading `/`);
  2. `symlink`;
  3. `submodule`;
  4. `ignored` (with the pattern);
  5. `binary` (by extension, before download);
  6. `too-large` (size over 1,000,000 bytes);
  7. `not-text` (after download: a NUL byte in the first 8,000 bytes, or invalid UTF-8).
- **Limits.** These apply to the files selected after filtering (open point 5):
  - at most **20,000 files**;
  - at most **200,000,000 bytes** in total.
  - A breach disables Import and says which pattern would help.
  - A truncated listing aborts at review.
- **Units.** 1 MB is 1,000,000 bytes, matching the repository's convention (`check-bundle-budget.ts`: "1 kB = 1000 bytes"). Sizes show as kB and MB.
- **No Nextflow scripts.** If no `.nf` file is selected, the summary warns ("No Nextflow scripts (.nf) found.") but doesn't block (IO-14).
- **Nothing left.** Zero selected files disables Import ("Nothing left to import.").
- **Everything else is imported.** README, docs, CI files, nf-test files and `bin/` scripts all come in: the project is the repository's text files, and export has to give them back (IO-20).

### 2.4 Dialog flow (UX-60, UX-61)
1. **Route.** The route group gains a third radio, **"Import from GitHub"**. The Import route shows:
   - **Repository**, with placeholder `nf-core/fetchngs or github.com/nf-core/fetchngs` (no scheme, to keep `check:hosts` clean);
   - **Branch, tag or commit**, with the help text "Leave empty for the default branch".
   - There is no token field (open point 8).
   - Publish docs is hidden on this route (open point 9, F-606 step 3).
   - The Name field defaults to the repository name until the user edits it.
2. **Review.** The submit button reads **Review** and makes the two API calls ("Checking nf-core/fetchngs…"). The summary then shows:
   - "nf-core/fetchngs at 1.13.0 (955c892)";
   - "155 files to import, 2.3 MB";
   - "4 skipped (336 kB)", with a `<details>` list of each path and its reason;
   - the editable **Ignore these paths** textarea, which updates the summary as you type;
   - any limit breach or `.nf` warning.

   Changing the repo or ref returns to the Review step.
3. **Import.** The button now reads **Import 155 files**. The dialog shows "Downloading 37 of 155 files…" (`role="status"`) and a **Cancel import** button that aborts and keeps the summary. Then:
   1. `workspace.importProject` stores the project;
   2. `openAndShow` opens it (the header shows "Opening …: Parsing n of N files");
   3. `workspace.report()` builds the report.
4. **Report.** The New project dialog closes, then an **Import report** dialog opens (native `<dialog>`, heading "Import report"):
   - "Imported nf-core/fetchngs at 1.13.0 (955c892) as fetchngs";
   - **Files:** "155 imported, 4 skipped", with the skipped list (the plan's skipped files plus the worker's `not-text` files);
   - **Parse failures:** "None", or one line per file such as "bad.nf: process SECOND kept as text";
   - **Legacy syntax:** "16 of 16 processes and workflows (100%)", plus the typed count;
   - **Suggestions:** the count;
   - a **Close** button.

   If the report fails, its section says so, and the import still stands.
5. **Errors.** Errors show inline (`role="alert"`, the existing `useModal` pattern), and nothing is created. Draft copy (British English, sentence case):

| Kind | Message |
|---|---|
| `invalid-input` | "Enter a repository as owner/name or a github.com address." (other hosts: "Only github.com repositories can be imported.") |
| `not-found` (404) | "nf-core/fetchngz wasn't found on GitHub. Check the name. Private repositories can't be imported yet." |
| `no-such-ref` (422) | "nf-core/fetchngs has no branch, tag or commit called 1.99.0." |
| `empty` (409) | "nf-core/x is an empty repository." |
| `rate-limited`, API (403 or 429 with remaining 0) | "GitHub's limit of 60 requests an hour without signing in is used up for this network. Try again after 14:05." (local time from `x-ratelimit-reset`) |
| `refused`, API (403 or 429 otherwise) | "GitHub refused the request for now. Try again in a minute." (or in `retry-after` seconds) |
| `rate-limited`, raw (429) | "GitHub is limiting downloads right now. Nothing was imported. Try again in a few minutes." |
| `truncated` | "nf-core/x has too many files for GitHub to list in one request, so it can't be imported." |
| `network` | "Couldn't reach GitHub. Check your connection and try again." |
| `download` | "Couldn't download docs/usage.md from GitHub (HTTP 404). Nothing was imported." |
| `incomplete` | "docs/usage.md didn't download completely. Nothing was imported." |
| `aborted` | "Import cancelled. Nothing was imported." |

### 2.5 The project source (IO-13)
- `ProjectMeta.source?: ProjectSource`, where `ProjectSource = {kind: "github"; repo: string; ref: string | null; sha: string}`.
  - `repo` is `owner/name` as entered.
  - A `null` ref means the default branch.
  - `sha` is the resolved 40-character commit SHA.
- It is written once at import, in the same transaction as the files, and kept by rename, touch and save.
- There is no IndexedDB version bump (open point 2). The union is left open for `{kind: "zip", …}` (F-403) and a template kind later.
- The report is session-only (open point 17).

### 2.6 The engine report
- `projectReport(model, workflows, diagnostics)` is pure, in `packages/engine/src/report/`. It returns:
  - **files:** the count of project files;
  - **parseFailures:** each file whose status is `partial` or `verbatim`, with its problem count and the heads of its `Unparsed` items (`{keyword, name}`), sorted by path;
  - **processes:** `{typed, legacy}`, counting modelled `Process` declarations by `typed`;
  - **workflows:** `{typed, legacy}`, counting the projector's modelled `WorkflowRef`s by `typed`. An unmodelled workflow is a parse failure, not a count;
  - **diagnostics:** `countDiagnostics(diagnoser.all())`.
- `legacyShare(r)` returns `{legacy, total}` over processes plus workflows.
- `EngineApi.report()` runs it on the current revision, reusing the memoised projector and diagnoser. With no project open it returns the `no-project` refusal. The workspace passes it through.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/sources/src/import/ignore.ts` | `DEFAULT_IGNORE: readonly string[]`; `IgnoreRule {pattern: string; ...}`; `parseIgnoreList(text: string): {rules: readonly IgnoreRule[]; problems: readonly string[]}`; `ignoredBy(path: string, rules: readonly IgnoreRule[]): IgnoreRule \| null` |
| `packages/sources/src/import/binary.ts` | `BINARY_EXTENSIONS: ReadonlySet<string>`; `binaryByName(path: string): boolean` |
| `packages/sources/src/import/text.ts` | `decodeText(bytes: Uint8Array): string \| null` (null: NUL in the first 8,000 bytes, or invalid UTF-8; BOM and line endings kept) |
| `packages/sources/src/import/plan.ts` | `IMPORT_LIMITS = {maxFileBytes: 1_000_000, maxFiles: 20_000, maxTotalBytes: 200_000_000}`; `Candidate {path; size: number \| null; kind: "file" \| "symlink" \| "submodule"}`; `SkipReason = "unsafe-path" \| "symlink" \| "submodule" \| "ignored" \| "binary" \| "too-large" \| "not-text"`; `SkippedFile {path; size: number \| null; reason: SkipReason; pattern?: string}`; `PlannedFile {path; size: number}`; `LimitBreach = {limit: "files" \| "total-bytes"; actual: number; max: number}`; `ImportPlan {files; skipped; totalBytes; skippedBytes; breaches; hasNextflow: boolean}`; `planImport(candidates, rules, limits?): ImportPlan` |
| `packages/sources/src/import/index.ts` | re-exports the four modules above (worker-safe) |
| `packages/sources/src/github/repo.ts` | `RepoRef {owner; name}`; `RepoInput {repo: RepoRef; ref: string \| null}`; `parseRepoInput(repo: string, ref: string): RepoInput \| {error: "empty" \| "not-github" \| "invalid"}`; `repoSlug(r: RepoRef): string` |
| `packages/sources/src/github/urls.ts` | `API_ORIGIN`, `RAW_ORIGIN`; `commitUrl(r, ref: string \| null)`; `treeUrl(r, sha)`; `rawUrl(r, sha, path)` |
| `packages/sources/src/github/errors.ts` | `GithubErrorKind = "invalid-input" \| "not-found" \| "no-such-ref" \| "empty" \| "rate-limited" \| "refused" \| "truncated" \| "network" \| "download" \| "incomplete" \| "unexpected" \| "aborted"`; `class GithubError extends Error {kind; host: "api" \| "raw"; status: number \| null; resetAt: number \| null; retryAfterSeconds: number \| null; path: string \| null}`; `errorFromResponse(res: Response, host, path?): GithubError` |
| `packages/sources/src/github/client.ts` | `FetchLike = (url: string, init: RequestInit) => Promise<Response>`; `TreeEntry {path; mode; type: "blob" \| "tree" \| "commit"; sha; size: number \| null}`; `RepoListing {repo: RepoRef; ref: string \| null; sha: string; entries: readonly TreeEntry[]}`; `DownloadedFile {path; bytes: ArrayBuffer}`; `GithubClient {resolveRef(r, ref, signal?): Promise<string>; listTree(r, sha, signal?): Promise<TreeEntry[]>; list(input: RepoInput, signal?): Promise<RepoListing>; download(r, sha, files: readonly PlannedFile[], o: {signal?; onProgress?(done: number, total: number): void}): Promise<DownloadedFile[]>}`; `createGithubClient(o: {fetch: FetchLike; concurrency?: number; retryDelayMs?: number; sleep?(ms): Promise<void>}): GithubClient`; `treeCandidates(entries): Candidate[]` |
| `packages/sources/src/github/index.ts` | re-exports `repo`, `urls`, `errors` and `client` (main thread only) |
| `packages/sources/test/fixtures/github/*.json` and `README.md` | recorded `{recorded, status, headers, body}` records (section 8): `commit-sha-200`, `commit-sha-422`, `tree-small-200`, `tree-404`, `tree-422`, `raw-200`, `raw-404` (live, ewels/nf-builder and fetchngs raw); `rate-limited-403`, `not-found-404`, `empty-409`, `raw-429` (synthesised from the docs and marked so); `nf-core-fetchngs-955c892.tree.json` (the trees API body, from git) |
| `packages/sources/test/fixtures/github/make-tree.ts` | run as `node packages/sources/test/fixtures/github/make-tree.ts <git-dir> <sha> <owner/name>`: prints the trees API body from `git ls-tree -r -t -l -z` (no package.json script) |
| `packages/sources/test/{import/ignore,import/plan,import/text,github/repo,github/client}.test.ts` | section 4 |
| `packages/engine/src/report/report.ts` | `StyleCounts {typed; legacy}`; `ParseFailure {path; status: "partial" \| "verbatim"; problems: number; unparsed: readonly DeclarationHead[]}`; `ProjectReport {revision; files; parseFailures; processes: StyleCounts; workflows: StyleCounts; diagnostics: DiagnosticCounts}`; `projectReport(model: ProjectModel, workflows: readonly WorkflowRef[], diagnostics: readonly Diagnostic[]): Omit<ProjectReport, "revision">`; `legacyShare(r): {legacy: number; total: number}` |
| `packages/engine/test/report/report.test.ts`, `packages/engine/test/corpus/report.corpus.ts` | section 4 |
| `apps/web/src/import/github-import.ts` | `ReviewRequest {repo; ref}`; `Review {input: RepoInput; listing: RepoListing; candidates: readonly Candidate[]}`; `review(client, req, signal?): Promise<Review>`; `replan(review, ignoreText): ImportPlan & {ignoreProblems: readonly string[]}`; `download(client, review, plan, o): Promise<DownloadedFile[]>`; `githubClient(): GithubClient` (binds `window.fetch`) |
| `apps/web/src/import/messages.ts` | `importErrorMessage(error: unknown, ctx: {repo: string; ref: string \| null; now?: Date}): string`; `formatBytes(n: number): string` |
| `apps/web/src/import/import-summary.tsx` | `ImportSummary(props: {review: Review; plan: ImportPlan; ignoreText: string; ignoreProblems: readonly string[]; onIgnoreChange(text: string): void}): JSX.Element` |
| `apps/web/src/import/import-report-dialog.tsx` | `ImportReport {source: ProjectSource; projectName: string; imported: number; skipped: readonly SkippedFile[]; project: ProjectReport \| {error: string}}`; `ImportReportDialog(props: {report: ImportReport; onClose(): void}): JSX.Element` |
| `apps/web/test/{github-import,import-summary,import-report-dialog,import-messages}.test.ts(x)` | section 4 |
| `e2e/github-mock.ts` | `API_HEADERS`, `RAW_HEADERS` (as recorded); `MockRepo {repo; refs: Record<string, string>; sha; tree: unknown; raw(path): Buffer \| null}`; `GithubLog {api: string[]; raw: string[]; unexpected: string[]}`; `mockGithub(page, repos, overrides?): Promise<GithubLog>` (routes both hosts and records unknown URLs); `repoFromFiles(repo, sha, files: {path; bytes: Buffer; mode?}[]): MockRepo` (git order, git blob SHA-1 via `node:crypto`); `fetchngsRepo(): MockRepo` (fixture tree plus the corpus cache; throws if the corpus is missing); `reportRepo(): MockRepo` (section 4) |
| `e2e/github-import.ts`, `e2e/github-import.spec.ts` | helpers (`importFromGithub(page, repo, ref)`, `importDialog`, `reportDialog`) and the spec (section 4) |

### 3.2 Change
- **`packages/sources/src/index.ts`:** `export * from "./import/index.ts"`.
- **`packages/sources/package.json`:**
  - `exports`: `"."` (import helpers) and `"./github"` (`./src/github/index.ts`);
  - a `devDependencies` entry is needed only if a test needs one; none is planned.
- **`packages/sources/README.md`:** what each entry is for. The worker may import only `.`.
- **`apps/web/package.json`:** `"@nf-builder/sources": "workspace:*"` (a workspace package, not a new third-party dependency).
- **`packages/engine/src/service/types.ts`:** `EngineApi.report(): Promise<ProjectReport | EngineRefusal>`.
- **`packages/engine/src/service/service.ts`:** wire `report` through `guarded`, with `projectorOf(open).workflows()` and `diagnoserOf(open).all()`.
- **`packages/engine/src/index.ts`:** export `ProjectReport`, `ParseFailure`, `StyleCounts`, `projectReport` and `legacyShare`.
- **`apps/web/src/workspace/types.ts`:**
  - `ProjectSource`;
  - `ProjectMeta.source?`;
  - `ImportFile {path; bytes: ArrayBuffer}`;
  - `ImportProject {name; languageVersion; source: ProjectSource; files: readonly ImportFile[]}`;
  - `ImportedProject {meta: ProjectMeta; skipped: readonly {path: string; reason: "not-text"}[]}`;
  - `WorkspaceApi.importProject(input: ImportProject): Promise<ImportedProject>`.
- **`apps/web/src/workspace/workspace.ts`:**
  - `importProject`, run through `serial`: validate the name, version, paths (unique, safe) and source; decode each file with `decodeText`; call `store.createProject(meta, textFiles)` once; `refresh()`.
  - `report` passes through.
- **`apps/web/src/workspace/project-db.ts`:** none expected (spreads keep `source`). The db test pins it.
- **`apps/web/src/engine/engine-client.ts`:**
  - `importProject: (input) => race(remote.importProject(transfer(input, input.files.map((f) => f.bytes))))`;
  - `report: () => race(remote.report())`.
- **`apps/web/src/project/new-project-dialog.tsx`:** `NewProjectRoute` adds `"import"`; the third radio, the Import fields, the Review then Import stages, the summary, progress, Cancel import and errors. Publish docs is hidden on Import.
- **`apps/web/src/project/project-store.ts`:**
  - `importReport: ImportReport | null`;
  - `importGithub(run: {name; languageVersion; review: Review; plan: ImportPlan}, o: {signal: AbortSignal; onProgress(done, total): void}): Promise<void>`, which runs: download, `importProject`, `askPersistence` and `checkUsage`, `openAndShow(meta.id)`, `report()`, then sets `importReport`;
  - `closeImportReport()`;
  - a `GithubClient` added to `ProjectStoreDeps`.
- **`apps/web/src/project/project-controls.tsx`:** render `ImportReportDialog` when `importReport` is set and no other dialog is open. Focus returns to the opener as today.
- **`apps/web/src/styles.css`** (or a new `import.css`): summary, skipped list and report.
- **`.dependency-cruiser.cjs`:** the `web-worker-no-github-client` rule (open point 11).
- **`e2e/engine.ts` or `e2e/projects.ts`:** `report()` on the hook type.
- **`playwright.config.ts`:** no change; the live test skips itself unless `F401_LIVE=1`.
- **Unchanged:**
  - workflows;
  - the CSP and `scripts/allow-list.ts` (both hosts are already listed);
  - the AGENTS.md command table (no new script);
  - the IndexedDB version;
  - visual baselines: the app shell is unchanged, and the template baselines capture the canvas only.

**Overlap with other in-flight features:** F-209 also changes `packages/engine/src/service/{types,service}.ts` and `engine-client.ts`; F-208 touches `engine-client.ts`. Merge `main` in before task 3.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/sources/test/import/ignore.test.ts`** | |
| `F-401 IO-12: the default ignore list skips work/, results/, .nextflow/, .nextflow.log* and .nf-test/ at any depth, and keeps workflows/ and subworkflows/` | |
| `F-401 IO-12: patterns follow the gitignore subset (trailing /, leading /, *, ?, **); blank lines and # comments are ignored; ! is reported as unsupported` | |
| **`plan.test.ts`** | |
| `F-401 IO-12 UX-61: each skip reason applies, in order: unsafe path, symlink, submodule, ignored (with the pattern), binary, over 1,000,000 bytes` | |
| `F-401 IO-12: over 20,000 selected files or 200,000,000 bytes is a breach; ignored files don't count` | |
| `F-401 step 1 IO-12 UX-61: the fetchngs 1.13.0 tree plans 155 files and 2,287,680 bytes, and skips the 4 PNGs as binary` | uses the fixture |
| `F-401 UX-61: a plan without a .nf file sets hasNextflow false` | |
| **`text.test.ts`** | |
| `F-401 step 1 IO-12: decodeText keeps a BOM and CRLF, so encoding gives back the same bytes; NUL or invalid UTF-8 gives null; empty input gives ""` | |
| **`github/repo.test.ts`** | |
| `F-401 IO-10: owner/name, github.com/owner/name, https://github.com/owner/name(.git)(/), www. and /tree/<ref> are accepted; the URL's ref fills an empty ref field` | |
| `F-401 IO-10: other hosts, bad owners or names, . and .., and empty input are rejected with a reason` | |
| **`github/client.test.ts`** (fake `fetch` replaying the recorded fixtures) | |
| `F-401 step 2 ADR-0009 IO-10: list makes exactly two API requests: commits/<encoded ref> with Accept vnd.github.sha, then git/trees/<sha>?recursive=1; no other request headers, credentials omitted` | |
| `F-401 IO-10: an empty ref resolves HEAD; a slashed branch is encoded as %2F` | |
| `F-401 ADR-0009: listTree maps blobs, symlinks and submodules to candidates and drops trees; truncated is a truncated error` | |
| `F-401 IO-14: 404, 422, 409, 403 or 429 with remaining 0 (resetAt from x-ratelimit-reset), 403 without it (retry-after), a TypeError and a non-SHA body map to their kinds` | |
| `F-401 ADR-0009: rawUrl encodes each path segment (space, #, %, ?, non-ASCII) and keeps the slashes` | |
| `F-401 step 1 IO-14: download keeps at most 8 requests in flight, reports progress, retries once on a network error or 5xx and never on 4xx; a length that differs from the tree size is incomplete; an abort stops everything` | |
| **`packages/engine/test/report/report.test.ts`** | |
| `F-401 step 3 UX-61: the report lists bad-declaration.nf as partial with process SECOND kept as text, and counts TYPED_COUNT typed, FIRST legacy and both entry workflows legacy` | files from `tools/corpus/fixtures/bad-declaration.nf` and `tools/oracle/cases/s1-legacy-calls-typed-module/` |
| `F-401 UX-61: legacyShare is legacy over typed plus legacy processes and workflows; suggestions equal countDiagnostics` | |
| **`packages/engine/test/service/service.test.ts`** (extend) | |
| `F-401 UX-61: report refuses with no-project, works after open, and its result survives structuredClone` | |
| **`packages/engine/test/corpus/report.corpus.ts`** (`pnpm test:corpus`) | |
| `F-401 step 3 UX-61: fetchngs has no parse failures and 9 legacy processes and 7 legacy workflows (100%); every pinned pipeline has no parse failures` | |
| **`apps/web/test/project-db.test.ts`** (extend) | |
| `F-401 IO-13 ADR-0045: a record's source is stored and survives listProjects, readProject, rename, touch and saveFiles` | |
| **`apps/web/test/workspace.test.ts`** (extend) | |
| `F-401 step 1 IO-13: importProject decodes the bytes (BOM and CRLF kept), stores the files and the source in one project, and returns the not-text files it skipped` | |
| `F-401 IO-14: importProject refuses duplicate or unsafe paths, a bad name or an unknown version, and then stores nothing` | |
| **`apps/web/test/engine-client.test.ts`** (extend) | |
| `F-401 QA-30 AR-30: importProject transfers the file buffers (detached after the call) and report passes through` | `MessageChannel` |
| **`apps/web/test/github-import.test.ts`** | |
| `F-401 step 2 UX-61: review makes the two calls once; replanning after an ignore edit makes none; download fetches only the planned files` | |
| **`apps/web/test/project-store.test.ts`** (extend) | |
| `F-401 UX-61 IO-13: importGithub downloads, imports with the source, opens the project, then sets the report; a failed download imports nothing and sets no report` | |
| **`apps/web/test/new-project-dialog.test.tsx`** (extend; update the F-203 route test to expect three routes, a behaviour change) | |
| `F-401 UX-60 QA-10: the Import from GitHub route has a labelled Repository and Branch, tag or commit field, no token field and no Publish docs checkbox` | |
| `F-401 UX-60: the name follows the repository name until the user edits it` | |
| **`apps/web/test/import-summary.test.tsx`, `import-report-dialog.test.tsx`, `import-messages.test.ts`** | |
| `F-401 UX-61 IO-12: the summary shows files, size and skipped counts by reason, lists skipped paths, has a labelled ignore list, and shows breaches and the .nf warning` | |
| `F-401 step 3 UX-61: the report shows the source, imported and skipped counts, each parse failure, "16 of 16 processes and workflows (100%)" and the suggestions count` | |
| `F-401 IO-14: each error kind has its message; the rate-limit message gives the reset time in local time` | |
| **`e2e/github-import.spec.ts`** (Chromium; every GitHub URL mocked; unexpected URLs fail the test) | |
| `F-401 step 1 IO-10 IO-12 IO-13: importing nf-core/fetchngs at 1.13.0 stores 155 files whose SHA-256 equals the corpus cache's and whose git blob SHA equals the tree's; the 4 PNGs are skipped; the project records the source` | first checks that the fixture's blobs equal the corpus cache's files (git blob SHA-1); reads files with `readStoredDatabase`, ignoring `.nf-builder/` |
| `F-401 step 2 ADR-0009 ADR-0002: the import makes exactly two api.github.com requests and one raw request per imported file, and no other cross-origin request` | network log |
| `F-401 step 3 UX-61: the report lists parse failures and the legacy share` | fetchngs: "Parse failures: none", "16 of 16 … (100%)", and suggestions equal to the hook's `report()`. The report repo lists `bad.nf: process SECOND kept as text`, "3 of 4 … (75%)", and `notes.txt` skipped as not text |
| `F-401 UX-61 IO-12: the summary before import shows files, skipped and size; editing the ignore list updates it with no request` | report repo; adding `data/` drops one file |
| `F-401 IO-14 UX-61: a rate-limited GitHub says when to try again and creates no project` | 403 with `x-ratelimit-remaining: 0` |
| `F-401 IO-14: a failed raw download aborts the import and stores nothing` | raw 404 for one path; the database has no new project |
| `F-401 QA-30: an import logs no CSP violation and no console error` | error tests may allow only Chromium's "Failed to load resource" entry for the mocked failing URL |
| `F-401 step 1 step 2 (live): nf-core/fetchngs at 1.13.0 from GitHub matches the corpus cache with at most two API requests` | `test.skip(!process.env.F401_LIVE)`; no mocks |

The **report repo** is built in memory by `repoFromFiles` from committed files plus generated bytes. That keeps the new Nextflow out of the plan (AGENTS.md: no syntax from memory):
- `main.nf` and `modules/local/typed_count/main.nf` and `data/s1.txt` come from `tools/oracle/cases/s1-legacy-calls-typed-module/`;
- `bad.nf` is `tools/corpus/fixtures/bad-declaration.nf`;
- `assets/logo.png` is PNG signature bytes, skipped as binary;
- `work/stale.txt` is ignored by `work/`;
- `notes.txt` holds byte 0xE9, skipped as not text after download.

## 5. Tasks

Branch `feat/F-401`. Run `pnpm check` before every commit. Settle section 6 first.

1. **Shared import helpers** (`packages/sources/src/import/`).
   - Files: the ignore, binary, text and plan modules with their tests; the fetchngs tree fixture, `make-tree.ts` and the README. Generate the fixture by fetching the pin with git (`git init`, then `git fetch --depth 1 https://github.com/nf-core/fetchngs.git 955c892…`) and running `make-tree.ts`.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
2. **GitHub client** (`packages/sources/src/github/`).
   - Files: repo, urls, errors and client with their tests; the recorded fixtures (copy them from the scratchpad, or re-record with the commands in section 8); the `./github` export.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
3. **Engine report.**
   - Files: `report.ts`, the service wiring and exports; the unit, service and corpus tests.
   - Done when these pass:
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus -- report` (the corpus test reads `.cache/corpus/`);
     - `pnpm check`.
4. **Workspace import and the boundary.**
   - Files: the types; `importProject`; the `report` pass-through; the engine-client transfer; the `@nf-builder/sources` dependency in `apps/web`; the dependency-cruiser rule; the db, workspace and engine-client tests.
   - Done when `pnpm check` passes (`pnpm arch` included), and a temporary import of `@nf-builder/sources/github` in `workspace.ts` makes `pnpm arch` fail with the rule's message (then removed).
5. **Dialog, store and report UI.**
   - Files: `apps/web/src/import/*`; the dialog route and stages; the store action and report state; the report dialog; their unit tests.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-202|F-203"` pass.
6. **End-to-end tests.**
   - Files: `e2e/github-mock.ts`, `e2e/github-import.ts`, `e2e/github-import.spec.ts`.
   - Done when these pass with the corpus present, without network access to GitHub:
     - `pnpm test:e2e -- --grep F-401`;
     - `pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm smoke` (still under 60 s).
7. **Records** (section 7).
   - Done when `pnpm check` passes (ADR lint and `features.json` validation).

## 6. Open points (none decided here)

1. **Fetching in the document, bytes transferred to the worker.** QA-30 and ADR 0040 decide that the document fetches. The decision to record is that raw bytes cross the main thread as transferred `ArrayBuffer`s, never decoded and never in a store.
   - **Recommendation:** accept. Record it in the F-401 ADR as a reading of AR-30: transient transport is not project state.
   - **Alternatives:**
     - fetching in the worker (breaks QA-30: the meta CSP doesn't govern it);
     - decoding on the main thread (`text()` strips BOMs, and the text would sit in the UI thread).
2. **Stored format: `ProjectMeta.source`.** Decide and record; it amends ADR 0045's record shape.
   - **Recommendation:** an optional field on v1 records with **no version bump**. Object stores without indexes are schemaless, and every write path spreads the record (`project-db.ts`), so an older tab keeps the field. Record the rule: "an additive optional field doesn't bump the version; anything an older build would misread does".
   - Leave `{kind: "template"}` (F-203's note) to a later feature: it isn't in IO-13, and F-401 should stay in scope.
   - **Alternative:** v2 with a no-op migration (an open older tab is told to reload).
3. **API additions:** `EngineApi.report()` (amends ADR 0043's list) and `WorkspaceApi.importProject()` (amends ADR 0045). **Recommendation:** accept, as F-202 and F-203 did with `readFile`, `close` and `templates`.
4. **Default ignore list** (spec gap: ADR 0009 says only "`work/`, `results/`, test data").
   - **Recommendation:** `work/`, `results/`, `.nextflow/`, `.nextflow.log*`, `.nf-test/`, `testdata/`, `test-data/`, `test_data/`. None matches anything in fetchngs, rnaseq or sarek. nf-core keeps test data in nf-core/test-datasets, and its `tests/` folders hold nf-test code that export must keep.
   - rnaseq-nf's `data/` is test data its default params read, so it is kept. The user can add it.
   - Record the list in IO-12.
5. **Limit semantics.** **Recommendation:**
   - 1 MB is 1,000,000 bytes and 200 MB is 200,000,000 (the repository's SI convention);
   - 20,000 files and 200 MB apply to the files selected after filtering;
   - a truncated listing aborts (IO-14). GitHub truncates at about 21,700 entries (7 MB) or 100,000 entries.

   Clarify IO-12.
6. **Binary files and modes.** Skipped by extension before download, and by content after. They are listed in the summary and the report, and not stored (schema v1 is text only). The 100755 bit isn't stored either.
   - **Recommendation:** accept for F-401.
   - Note for F-404: export lacks the skipped binaries, and should mark `bin/*` executable (Nextflow puts `bin/` on the `PATH`).
   - Storing binaries is the schema v2 change F-202 noted (F-210 and F-403).
7. **What the report counts** (spec gap in UX-61). **Recommendation:**
   - *parse failures* are files whose parse status is partial or verbatim, with the heads of the declarations kept as text;
   - *legacy share* is legacy processes and workflows over all modelled processes and workflows, shown as counts and a percentage;
   - *suggestions* are diagnostics of severity `suggestion` at import time.

   Amend UX-61 with these definitions.
8. **No token field until F-402.** UX-60 and IO-10 mention an optional token, but F-402 is deferred (ADR 0030).
   - **Recommendation:** omit the field. An inert field invites people to paste secrets.
   - Note for F-402: add the field, an `Authorization` header (which preflights; S4 saw 204 with `*`) and the blobs API.
9. **Publish docs on Import.** **Recommendation:** hide the checkbox on the Import route (F-606 step 3: imports add no docs files until Add docs publishing is used). The metro map checkbox stays with F-607.
10. **Download integrity.** **Recommendation:** compare each body's length with the tree size, which catches truncation. Don't verify git SHA-1 in the app:
    - `crypto.subtle` is missing in a frame inside an insecure page (ADR 0044);
    - raw content by commit SHA is immutable;
    - the e2e test checks blob SHAs itself.
11. **Dependency-cruiser rule.** Decide and record.
    - **Recommendation:** add `web-worker-no-github-client`: from `^apps/web/src/engine/engine\.worker\.ts$`, `reachable: true`, to `^packages/sources/src/github/`. Its message reads: "the document fetches and passes the worker data (QA-30, ADR 0040)".
    - Together with the `./github` subpath export, this keeps F-403's zip worker free to use `@nf-builder/sources`.
    - **Alternative:** no rule, relying on the injected `fetch`. That is weaker.
12. **Live evidence.** CI e2e can't depend on live GitHub (anonymous 60 an hour per IP, and runners share IPs), and the sandbox proxy refuses `api.github.com` for nf-core.
    - **Recommendation:** steps 1 to 3 pass on the mocked e2e tests. The mock's tree carries GitHub's blob SHAs, and the test checks them against the corpus cache.
    - Keep the opt-in `F401_LIVE=1` test for anyone with direct access.
    - Add no workflow.
13. **Fixture provenance.** The fetchngs tree fixture is produced from git, because the sandbox can't call the API for nf-core. Section 1.3 shows `git ls-tree -r -t -l` equals the API for all 2,645 entries.
    - **Recommendation:** accept. The README says so and gives the curl command for a live re-record.
14. **Concurrency and retries** (the spec is silent). **Recommendation:**
    - 8 raw requests in flight (well under the secondary limit of 100 concurrent requests);
    - one retry after 1 s on a network error or 5xx;
    - no retry on 4xx;
    - nothing partial is ever stored.
15. **Accepted inputs** (IO-10). **Recommendation:**
    - accept `owner/name` and github.com repository URLs (`.git`, a trailing slash, `www.`, `/tree/<ref>`);
    - leave subdirectory imports and other hosts out of scope;
    - record the forms in IO-10.
16. **Renamed repositories.** A 301 redirect adds one request per call, so "at most two" holds for fetchngs and other current names. **Recommendation:** accept and note it in the ADR.
17. **Report persistence.** **Recommendation:** session only. IO-13 stores the source, and the report can be rebuilt from the project.
18. **Project name.** **Recommendation:** default to the repository name until the user edits it; duplicates are allowed (ADR 0045).
19. **Repository with no `.nf` files.** **Recommendation:** warn but allow (IO-14). An empty selection disables Import.

**AGENTS.md decide-and-record items:**
- **Persisted format:** point 2.
- **Package boundaries and dependency-cruiser rules:** point 11, plus the `./github` export. The ADR 0003 table is unchanged.
- **Amends accepted ADRs:** points 2 and 3 (ADRs 0043 and 0045); point 1 records an AR-30 reading.
- **Spec behaviour:** IO-10, IO-12 and UX-61 (points 4, 5, 7, 8 and 15); UX-60 (points 8 and 9).
- **None:**
  - new runtime dependencies (`@nf-builder/sources` is a workspace package);
  - workflows;
  - `features.json` beyond `passes` and notes;
  - open questions.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, the next free number at landing; 0048 may be taken by F-206 to F-209): "Import public GitHub repositories from the document: two API calls, raw downloads, shared filters and a recorded source".
  - It covers 2.1 to 2.6 and section 6.
  - It amends ADR 0043 (`report`) and ADR 0045 (`importProject`, `ProjectMeta.source`, the additive-field rule).
  - It records the AR-30 reading and the dependency-cruiser rule.
  - Add a row to `docs/adr/README.md`.
- **Spec:**
  - IO-10: the accepted input forms; the token arrives with F-402;
  - IO-12: the default ignore list, SI units, limits on the selected files, binaries skipped, a truncated listing aborts;
  - IO-13: "recorded on the project record as `source`";
  - UX-61: the report's definitions;
  - UX-60: no Publish docs on Import.
- **`features.json`:**
  - **F-401:** `passes`, and a note: "Verified …: steps 1 to 3 by `e2e/github-import.spec.ts` against a mocked GitHub (tree fixture from the pin, contents from the corpus cache, blob SHAs checked); unit tests in `packages/sources` replay recorded responses; the opt-in `F401_LIVE=1` test runs against GitHub. Decisions in ADR …".
  - **F-402:** the token field, the `Authorization` preflight, the blobs API, and `GithubClient` in `@nf-builder/sources/github`.
  - **F-403:**
    - reuse `@nf-builder/sources` (`planImport`, `decodeText`, `DEFAULT_IGNORE`) and `workspace.importProject`;
    - add `{kind: "zip", name, hash}` to `ProjectSource`;
    - add a source toggle to the Import route.
  - **F-404:** skipped binaries and executable bits weren't imported (mark `bin/*` executable); `ProjectMeta.source` holds the repo and SHA.
  - **F-405:** `EngineApi.report()` has per-project style counts.
  - **F-406:** the backup carries `source`.
  - **F-606:** Publish docs is hidden on Import.
  - **F-210:** the parse-failure list in `report()` can drive the error badges.
- **`docs/licences.md`:** none; there is no third-party content, since the fetchngs tree fixture is metadata.
- **`progress.md` Decisions:** the ADR, the stored-format change, the API additions, the dependency-cruiser rule, the spec readings, and the live-evidence policy.

## 8. Evidence

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`

| Probe | Path |
|---|---|
| Live API on ewels/nf-builder (headers and bodies): commit JSON (327,609 bytes), SHA media type for `main`, `HEAD`, `2c3cc69`, a slashed branch, a bad ref; the recursive tree (2,645 entries, 853,747 bytes) | `f401-probe/own-commit.*`, `body*.txt`, `tree.headers`, `tree-own.json` |
| Scrubbed recordings for unit-test fixtures (status, the headers the client reads, body; no proxy-injected auth headers) | `f401-probe/recorded/*.json` |
| The proxy refusing the API for nf-core | `f401-probe/commit-1.13.0.{headers,json}` |
| API tree equal to `git ls-tree -r -t -l` (2,645 of 2,645 entries) | `f401-cmp.py`, `f401-probe/own-lstree.txt` |
| fetchngs at the pin via git; tree listing; synthesised trees API body (207 entries, 61,932 bytes pretty) | `f401-probe/fetchngs-git/`, `fetchngs-lstree.{txt,z}`, `fetchngs-tree.synth.json` |
| Raw `main.nf` equal to its blob (2,766 bytes, `02b1dc2f…`); raw 404 CORS | `f401-probe/raw-main.nf`, `raw.headers`, `recorded/raw-404.json` |
| Corpus survey: binaries by content and by extension, text files over 1 MB; corpus files equal to blob SHAs (159 of 159) | `f401-binsurvey.py`; corpus at `/home/user/wt-F-208/.cache/corpus` |
| GitHub docs saved: git trees, rate limits, commits, media types, CORS; changelog 2025-05-08 | `f401-probe/docs/*.html`; extracted with `f401-strip.py` |

To re-record the live fixtures, from a machine whose network reaches the API:
- `curl -sS -D - -H 'Origin: https://ewels.github.io' -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/<o>/<r>/commits/<ref>`
- `… -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/<o>/<r>/git/trees/<sha>?recursive=1'`

Keep only status, `content-type`, the `access-control-*` headers, `x-ratelimit-*`, `retry-after` and the body. From the sandbox, only ewels/nf-builder is reachable, and its responses carry proxy credentials that must be dropped.

Sources: https://docs.github.com/en/rest/git/trees (Get a tree), https://docs.github.com/en/rest/commits/commits (Get a commit), https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api, https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests, https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/, `docs/research/2026-11-22-spike-s4-cors.md`.
