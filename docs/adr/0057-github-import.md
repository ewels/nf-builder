# 0057. Import public GitHub repositories from the document: two API calls, raw downloads, shared filters and a recorded source

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

IO-10 asks for GitHub import from `owner/repo` or a github.com URL with an optional ref. ADR 0009 fixes the shape: two API calls, contents from `raw.githubusercontent.com`. IO-12 asks for the same limits and ignore list as the zip route (ADR 0053). IO-13 asks the project to record its source. UX-61 asks for a summary before import and a report after it, but doesn't define "parse failures" or "legacy share". IO-14 says only I/O errors and limit breaches abort.

Other ADRs constrain this:
- QA-30 and ADR 0040: workers make no cross-origin requests; the document fetches and passes them data, because a `<meta>` policy doesn't govern URL-loaded workers.
- ADR 0043 and AR-30: file text lives in the engine worker and IndexedDB, not in UI stores.
- ADR 0045: schema v1 stores text only, and format changes are decide-and-record.
- ADR 0002 and IO-41: `api.github.com` and `raw.githubusercontent.com` are already allowed.
- ADR 0003: `packages/sources` holds the GitHub client and may import only `lang-core`.
- ADR 0030: tokens and private repositories (F-402) are deferred to M8.

Research: the [F-401 plan](https://github.com/ewels/nf-builder/blob/d5d4b7b/docs/plan/handoff/plan-F-401.md), its live probes of the API on this repository, and spike S4 (`docs/research/2026-11-22-spike-s4-cors.md`).

## Decision

- **Where it runs.**
  - The GitHub client (`packages/sources/src/github/`, exported as `@nf-builder/sources/github`) runs in the document. It takes `fetch` by injection, sends `credentials: "omit"` and only a safelisted `Accept` header, so there are no preflights.
  - Each raw file is read with `arrayBuffer()` and handed to the worker in one `importProject` call with the buffers transferred. This is a reading of AR-30: transient transport is not project state. Bytes are never decoded on the main thread and never put in a store.
  - The worker decodes with `decodeText` (BOM and CRLF kept), skips files that aren't text, and writes the record and its files in one transaction.
  - A dependency-cruiser rule, `web-worker-no-github-client`, stops `apps/web/src/engine/engine.worker.ts` from reaching `packages/sources/src/github/`. The worker imports only `@nf-builder/sources` or `@nf-builder/sources/import`. The ADR 0003 table is unchanged.
- **Requests.**
  1. Resolve: `GET /repos/{owner}/{name}/commits/{ref or HEAD}` with `Accept: application/vnd.github.sha`; the body must be a 40-character SHA.
  2. List: `GET /repos/{owner}/{name}/git/trees/{sha}?recursive=1`. `truncated: true` aborts. Mode 100644 and 100755 entries are files; symlinks and submodules are skipped; a malformed entry is an `unexpected` error.
  3. Download: `GET https://raw.githubusercontent.com/{owner}/{name}/{sha}/{path}`, 8 in flight, one retry after 1 s on a network error or a 5xx, none on a 4xx.
  - A renamed repository answers with a 301 that `fetch` follows, adding one request per call. "At most two" holds for current names.
  - Editing the ignore list re-plans from the listing with no request.
- **Integrity.** The client refuses a body whose `content-length` already differs from the tree size before reading it (skipped when `content-encoding` is set, since the header then counts encoded bytes), and checks the read length against the tree size. A difference is an `incomplete` error. There is no SHA-1 check in the app: `crypto.subtle` is missing in insecure frames (ADR 0044), and raw content addressed by commit SHA is immutable. The e2e test checks blob SHAs itself.
- **Filters and limits (IO-12), shared with F-403.**
  - The default ignore list is F-403's `DEFAULT_IGNORE` (ADR 0053), shared by both routes, not the plan's narrower list. One list keeps both routes' summaries consistent.
  - `planImport` (new, `src/import/plan.ts`) applies the zip route's skip rules by name and size before any download: unsafe paths, symlinks and submodules (`unsupported`), binaries by extension (`binaryByName`, new, `src/import/binary.ts`), files over 1 MB, then the ignore list. Content checks (a NUL in the first 8,000 bytes, invalid UTF-8) run in the worker after download. Every other helper is F-403's.
  - The 20,000-file and 200 MB limits apply to the files selected after filtering. A breach disables Import. Sizes are SI (1 MB = 1,000,000 bytes).
  - The worker's `importProject` checks the file count, per-file size and total size again, so a caller can't bypass them.
  - No `.nf` file warns but doesn't block (IO-14); nothing selected disables Import.
- **Dialog (UX-60, UX-61).**
  - GitHub is a second source, "GitHub repository", in F-403's "Import from" group on the Import route, beside "Zip file". The route takes a repository and an optional "Branch, tag or commit". Both sources share `ImportSummaryView`.
  - The Name field defaults to the repository name until edited.
  - There is no token field until F-402: an inert field would invite people to paste secrets.
  - Publish docs is hidden for a GitHub import (F-606 step 3).
  - Review makes the two API calls and shows the summary. Import downloads with a progress status and a Cancel import button. Closing the dialog, with Escape or otherwise, aborts an in-flight import. Nothing is stored unless every download succeeds.
  - After import an Import report dialog shows the files imported and skipped, parse failures, legacy syntax and suggestions. The report is session-only.
- **Report definitions (UX-61).**
  - Parse failures: files whose parse status is `partial` or `verbatim`, with the heads of the declarations kept as text.
  - Legacy share: legacy processes and workflows over all modelled processes and workflows, as counts and a percentage.
  - Suggestions: diagnostics of severity `suggestion` at import time.
- **API.** This amends the API lists in ADRs 0043 and 0045.
  - `EngineApi.report()` returns a `ProjectReport` for the current revision, or the `no-project` refusal. It is computed by the pure `projectReport` in `packages/engine/src/report/`.
  - `WorkspaceApi.importProject({name, languageVersion, source, files})` stores a project from bytes and returns its meta and the files that weren't text. It stores nothing when it throws.
- **Stored format (IO-13).** This amends ADR 0045's record shape. `ProjectMeta.source?: {kind: "github", repo, ref, sha}`: `repo` as entered, `ref` null for the default branch, `sha` the resolved commit. It is written once, in the import transaction, and kept by rename, touch and save. The rule: **an additive optional field doesn't bump the schema version; anything an older build would misread does.** Object stores without indexes are schemaless and every write spreads the record, so an older tab keeps the field. The union stays open for a zip kind and a template kind.
- **Errors.** Invalid input, not found, no such ref, empty repository, rate limited (with the reset time), refused, truncated, network, a failed or incomplete download, and cancellation each have a message (`apps/web/src/import/messages.ts`). Errors show inline and nothing is created.
- **Evidence.** CI can't depend on live GitHub (60 anonymous requests an hour per IP, shared runner IPs), and the sandbox proxy refuses the API for nf-core.
  - The e2e tests mock GitHub with `page.route`. The fetchngs tree fixture is real: generated from git at the pin, where `git ls-tree -r -t -l` equals the API's tree. Its blob SHAs are checked against the corpus cache.
  - The unit tests' API responses are synthesised from the GitHub REST documentation.
  - An opt-in live test runs with `F401_LIVE=1`. No workflow calls GitHub.

## Consequences

- The worker never holds a network client, and the main thread never holds decoded text.
- Both import routes share one ignore list, one set of limits and one summary component.
- **Known limitation.** A 429 from raw without CORS headers is opaque to the page, so it surfaces as "Couldn't reach GitHub" rather than the rate-limit message.
- Projects imported from GitHub lack binary files and executable bits (F-404 should mark `bin/*` executable). F-407 covers binaries.
- Zip imports don't record a source yet: the IO-13 zip case, `{kind: "zip", name, sha256}`, is still to come.
- F-402 adds the token field, an `Authorization` header (which preflights) and the blobs API on the same client.

## Alternatives

- **Fetching in the worker:** breaks QA-30; the meta policy doesn't govern it.
- **Decoding on the main thread:** `text()` strips BOMs and puts project text in the UI thread.
- **Schema v2 for `source`:** a no-op migration that forces open older tabs to reload, for a field they keep anyway.
- **The plan's narrower ignore list:** the two routes would summarise the same repository differently.
- **A separate "Import from GitHub" route:** duplicates F-403's Import route and its summary.
- **Verifying git SHA-1 in the app:** unavailable in insecure frames and redundant for immutable raw URLs.
- **A token field now:** inert until F-402.
- **No dependency-cruiser rule, relying on the injected `fetch`:** weaker; a later import could pull the client into the worker unnoticed.
