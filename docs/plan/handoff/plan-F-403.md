# Plan: F-403, zip import in a worker with top-level folder stripping and size limits

Planner output, 2026-11-23. I changed nothing in the repo. Paths are relative to `/home/user/nf-builder` unless they are absolute.

**What I read:**
- `origin/main` at `2c3cc69`, in a scratch worktree that I have since removed: AGENTS.md, CLAUDE.md, F-403 and related features in `docs/plan/features.json`, `docs/spec/{data-and-io,ux,quality,architecture,README}.md`, ADRs 0002, 0003, 0009, 0015, 0043, 0045 and 0047, `docs/licences.md`, `docs/plan/handoff/README.md` and `plan-F-207.md` (for the format).
- **Code:** `apps/web/src/{workspace,project,engine}/*`, `apps/web/vite.config.ts`, `packages/engine/src/{service/types.ts,templates.ts,index.ts,source/language.ts,model/tree.ts}`, `packages/sources/*`, `.dependency-cruiser.cjs`, `scripts/{check-bundle-budget,worker-manifest,security-policy}.ts`, `e2e/{projects,templates,engine,csp}.ts`, `e2e/new-project.spec.ts`, `.github/workflows/ci.yml` (e2e job) and `tools/corpus/*`.
- **fflate:** the 0.8.3 tarball from npm, read as text only. I bundled its entry points to measure size, but executed none of its code.
- **Data sources:** npm metadata and the npm bulk advisory endpoint; MDN browser-compat-data 8.1.10.
- **The pinned rnaseq-nf tree:** from the corpus cache in `/home/user/wt-F-208/.cache/corpus/`, plus a `git archive` zip of it that I built.
- **Branches:** ADR numbers on `origin/feat/F-206` and `origin/feat/F-208`.

## 0. Scope

**In scope:**
- **`packages/sources`, the shared import module** (IO-12, used by both routes):
  - limits and size formatting;
  - entry path rules and the top-level folder rule;
  - the ignore list (syntax and default);
  - the text-or-binary check;
  - file selection and the summary.
- **`packages/sources`, the zip reader** (IO-11, QA-32), on fflate.
- **Engine worker:** staging calls on `WorkspaceApi`, and `createProject` from a staged import. The worker copies the files, as it does for templates (ADR 0047).
- **New project dialog:** the Import route with Zip file as its source, a summary, an editable ignore list and refusal messages.
- **Tests:** unit and e2e (steps 1 and 2, a cross-browser smoke test, and a QA-01 chunk check).
- **Records:** ADR, spec, licences, notes.

**Out of scope:**
- the GitHub route, and UX-61's report after import (F-401);
- recording the zip name and hash on the project (IO-13: F-401 cites it, and it changes the stored format);
- storing binary files (needs IndexedDB schema v2, ADR 0045);
- dropping a zip into an open project (F-210, UX-16);
- export and backup (F-404, F-406);
- a Cancel button for a running unpack.

## 1. Findings

### 1.1 Spec and ADRs
- **IO-11:** "Zip import unzips in a worker and strips a single top-level folder."
- **IO-12:** "Both routes apply the size limit (1 MB per text file) and the default ignore list, editable before confirming. Limits guard against zip bombs: at most 20,000 entries and 200 MB uncompressed."
- **QA-32:** "Zip import enforces the IO-12 limits."
- **UX-60:** three routes: Start blank, From a template, Import (GitHub repo or zip).
- **UX-61:** a summary (files, skipped, size) before creating the project, then a report afterwards. F-401 cites UX-61; F-403 needs the summary half because IO-12 asks for the list to be editable before confirming.
- **Glossary:** "Project: a set of text files … plus a layout sidecar."
- **ADR 0009, lines 28–33:**
  - zip import unzips in a worker and strips a single top-level folder;
  - both routes take text files up to 1 MB;
  - "An editable ignore list (`work/`, `results/`, test data)";
  - limits of 20,000 entries and 200 MB;
  - a summary before creating the project;
  - the source recorded on the project.
- **ADR 0009, S4 result:** `codeload.github.com` blocks cross-origin reads, so zip import is a file upload (F-008 note).
- **ADR 0003, line 16:** names "fflate … for zip".
  - Its package table makes `packages/sources` home to "GitHub, zip and registry clients", importing only `lang-core`.
  - `apps/web` may already import `sources` (the dependency-cruiser rule `web-imports-only-listed-packages` exists).
- **ADR 0043:**
  - worker chunks are outside QA-01;
  - `check:hosts` scans worker code;
  - Comlink lives only in `apps/web`;
  - the main thread keeps no project content.
- **ADR 0045:**
  - schema v1 `files` holds `{projectId, path, text}`, "text only … Binary content will need a version bump" (line 15);
  - storage runs in the engine worker;
  - file text never sits on the main thread (AR-30).
- **ADR 0047:** `NewProject.template` names a template and the worker copies its files, so the request carries no file text. F-403 follows the same pattern.
- **QA-30 and ADR 0040:** the document policy has `script-src 'self'` and `worker-src 'self'`.
- **ADR 0044:** frames. `randomId()` already falls back where `crypto.randomUUID` is missing.
- **Notes left for F-403:**
  - F-008: upload only;
  - F-113: `open` or `writeFiles` for imports;
  - F-202: binary needs a schema bump;
  - F-203: the route group has room for Import.
- **Related features:**
  - **F-210:** depends on F-403 ("Dropping a zip reuses F-403's zip import").
  - **F-404:** step 3 imports an exported zip, but F-404 depends only on F-401.
- **Gaps the spec leaves open** (open points in section 6):
  - what the default ignore list contains;
  - whether MB means 10^6 or 2^20 bytes;
  - whether folders count as entries;
  - what happens to binary files;
  - the exact folder-stripping rule;
  - a cap on the zip file itself;
  - how to treat headers that understate sizes.

### 1.2 Code facts (origin/main)
- **`packages/sources`** is a stub:
  - `src/index.ts` is `export {};`;
  - its `package.json` has no dependencies;
  - its tsconfig has the `ES2024` lib only, so `TextDecoder` won't type-check. The engine solves this with `"types": ["node"]`.
- **`apps/web/src/workspace/workspace.ts`:**
  - `createProject` (line 146) refuses a template combined with files (155);
  - one `serial` queue handles project calls;
  - `change()` records autosave;
  - `randomId()` is exported.
- **`WorkspaceApi`** (`workspace/types.ts`) extends `EngineApi`. `NewProject` is `{name, languageVersion, files, template?, publishDocs?}`.
- **`engine-client.ts`** forwards every method explicitly through `race(...)`. Tests fake `WorkspaceApi` with casts, so added methods don't break them.
- **`new-project-dialog.tsx`:**
  - `NewProjectRoute = "blank" | "template"` (line 15);
  - the "How to start" fieldset (160);
  - the pure `newProjectRequest` (35) and `submitOutcome` (62);
  - `useModal().run` closes on success and shows failures inline.
  - The existing unit test doesn't pin the number of routes.
- **`project-store.ts` `create`** (165) sends `files: []`, `template` and `publishDocs`, then calls `openAndShow`.
- **Paths:** there is no path validation anywhere. `FileTree` tolerates a file and a folder with the same path.
- **Worker bundles:**
  - the worker build is `format: "es"`, so dynamic imports in the worker already split into chunks (the parser and catalogue);
  - `.vite/worker-manifest.json` records each worker chunk's `src`;
  - `check-bundle-budget` counts only the main manifest's static closure.
- **e2e:**
  - helpers `readStoredDatabase`, `readProject`, `openNewProjectDialog` and `watchForCspViolations` exist;
  - CI restores `.cache/corpus` only in the Chromium leg;
  - F-205's tests throw "The … corpus is missing: run pnpm corpus:fetch" when it is absent.
- **Node 22.23.5** (the repo's engine), verified:
  - `DecompressionStream('deflate-raw')` and `zlib.crc32` exist;
  - `structuredClone(new File(...))` gives a `Blob` with no name, so the worker call must take the name separately.

### 1.3 The pinned rnaseq-nf tree (`53377cff…`) and a GitHub-style archive
- **The tree:** 35 files, 6,154,363 bytes, with no `.gitattributes`, so a GitHub archive holds exactly this tree.
- **`git archive --format=zip --prefix=rnaseq-nf-53377cff870bdb0ae02ee5cdb74703af4b18e887/`** with git 2.43.0 gives a 1,695,437-byte zip:
  - 49 entries: 35 files and 14 folders, including the top folder itself;
  - the commit id as the zip comment;
  - 33 deflated and 16 stored entries;
  - no data descriptors.
- **The real GitHub archive couldn't be fetched:** the sandbox proxy refuses `github.com/…/archive/…`. That GitHub builds its archives with `git archive` is from memory, not checked this session.
- **Text-or-binary check** (NUL in the first 8,000 bytes, or invalid UTF-8; over 1,000,000 bytes is too large):
  - only `multiqc/nextflow_logo.png` (40,309 bytes) is binary;
  - the largest text file is 691,995 bytes.
  - Across rnaseq, sarek and fetchngs, only `.png`, `.pdf`, one `.ai` and one large `.svg` are skipped, and no text file fails UTF-8.
- **Under the recommended default ignore list** (2.5):
  - 22 files, 30,562 bytes (shown as "31 kB");
  - 12 files under `data/ggal/` ignored (6,083,492 bytes);
  - 1 binary file.
- **With no test-data patterns:** 34 files, 6,114,054 bytes.
- **The corpus pipelines' own `.gitignore`s:** nf-core ignores `.nextflow*`, `work/`, `data/`, `results/`, `testing/`, `test-datasets/`, `null/`, `.nf-test*` and `.lineage/`.
- **F-203's Samplesheet to MultiQC template** ships `assets/test/*.fastq`.

### 1.4 Zip library: fflate against `DecompressionStream`

| | fflate 0.8.3 | `DecompressionStream('deflate-raw')` |
|---|---|---|
| **Version, licence** | 0.8.3, MIT, no dependencies. Published 2026-05-16. npm integrity `sha512-tbZNuJrL…vgA==` matches the tarball. | Built in |
| **Support** | Plain JS: every browser, and Node | Chrome and Edge 103, Firefox 113, Safari 16.4 (MDN BCD 8.1.10); Node 22 has it |
| **Size** (rolldown 1.2.19, minified, gzip -9) | `unzipSync`: 5,473 B (2,747 B gzipped). With `zipSync`: 12,534 B (6,084 B). The `Inflate` stream: 4,955 B (2,431 B). No URLs; no `Worker` or `createObjectURL` in the sync bundle. | 0 |
| **Container parsing** | Yes, from the central directory: comment scan, ZIP64, UTF-8 or Latin-1 names | None. We would hand-write the end record, central directory, local headers, ZIP64, name decoding and optionally CRC-32 (about 100 to 150 lines) |
| **Zip writer** (F-404, F-406) | `zipSync` | None. CompressionStream plus a hand-written writer with CRC-32 |
| **Async** | The async API spawns `blob:` workers (`lib/worker.cjs`, `esm/browser.js:12`), which the document's `worker-src 'self'` forbids. Use only the sync API, in our worker. | Async and cancellable |
| **Advisory** | GHSA-px8p-9vwx-vf98: `unzipSync` loops forever on malformed ZIP64; affects ≥0.8.0 <0.8.3 and ≥0.7.0 <0.7.5. 0.8.3 is fixed; its changelog says "Fix buffer over-read for Zip64 extra fields". | n/a |
| **Bomb behaviour** | `unzipSync` inflates each entry into a buffer of its recorded size (`inflateSync(…, {out: new u8(su)})`, lines 2652–2690). With a caller buffer `resize` is false, so output never grows past the recorded size, but the copy loop keeps running (lines 216–393, 375–386). An entry that understates its size costs CPU, not memory, and comes back silently cut. No CRC check. | Exact byte counts, and decoding stops on cancel |
| **`unzipSync` details** | `filter({name, size, originalSize, compression})` runs before each entry in central-directory order, and a throw from it aborts. Any compression other than 0 or 8 throws unless filtered out. Results are keyed by name, so duplicates overwrite and `__proto__` sets the prototype. | n/a |

**Pick: fflate 0.8.3, pinned exactly, using the sync `unzipSync` only** (open point 1). Reasons:
- ADR 0003 already names it.
- It is a tested container parser, so we don't own a binary parser.
- `zipSync` covers F-404 and F-406.
- Tests build their fixtures with the same library.
- It adds about 2.7 kB to a lazily loaded worker chunk.

The cost is the understated-size case, which is bounded by the guards in 2.2.

## 2. Design

### 2.1 Where it runs (open point 2)

```
main thread (dialog)                     engine worker (workspace)                         lazy worker chunk
<input type=file> → File ─ stageZip(blob, name) ─► stager: blob.size check, arrayBuffer() ─► @nf-builder/sources: readZip,
summary (paths, counts) ◄──────── result ──────── stage {id, candidates} (texts stay here)    parseIgnore, summarise, selectFiles
ignore text ─ restageImport(id, ignore) ─────────► summarise again (no IO)                   (fflate inside)
Create ─ createProject({…, import: {id, ignore}}) ► selectFiles → ProjectDb.createProject → discard stage
```

- **The engine worker unzips.** A `File` is a handle: cloning it into the worker doesn't read its bytes on the main thread. File text exists only in the worker and IndexedDB (AR-30, ADR 0045).
- **`@nf-builder/sources` loads by `await import()`** on the first `stageZip`, so fflate is a worker chunk outside QA-01 and isn't loaded when the worker starts.
- **The main thread** receives paths, counts and sizes only, and imports nothing from `sources` except `formatBytes` and types.
- **`stageZip` and `restageImport` stay outside the workspace's `serial` queue,** because they touch neither the database nor the open project.
- **`createProject` stays queued.** One stage is kept at a time, and a newer one replaces it.

### 2.2 Limits (QA-32) and how each is enforced

| Limit (`IMPORT_LIMITS`) | Value | Checked | Outcome |
|---|---|---|---|
| `maxArchiveBytes` | 200,000,000 | `blob.size`, before reading | refused `too-big` |
| `maxEntries` | 20,000 central-directory records (files, folders, `__MACOSX/`) | pass 1 filter, counting | refused `too-many-entries` at record 20,001 |
| `maxTotalBytes` | 200,000,000 recorded uncompressed bytes, summed over all records | pass 1 filter, before anything is inflated | refused `too-large-uncompressed` |
| `maxTextFileBytes` | 1,000,000 | recorded size, before inflating | skipped `too-large`; never inflated |
| Plausibility (for each entry we inflate) | stored: compressed = recorded; deflated: compressed ≤ recorded + recorded/8 + 1,024 | before pass 2 | refused `damaged`, naming the path |
| `unpackMs` | 30,000 | pass 2 filter, before each entry | refused `too-slow` |

1 MB is 1,000,000 bytes, and sizes are shown in SI units (open point 7).

Memory stays under about 200 MB of zip bytes (freed after reading) plus at most 200 MB of inflated entries. Each inflated entry's output is capped at its recorded size of 1 MB or less. Its decode work is at most about 1,032 × 1.13 MB. The deadline bounds the total.

### 2.3 Reading: `readZip(bytes, options)`
1. **Pass 1, list only.** Call `unzipSync(bytes, {filter})`, where the filter records `{name, size, originalSize, compression}`, counts and sums with the limit checks, and returns `false`, so nothing is inflated.
   - A limit breach throws a private `Breach(code)`, mapped to its refusal.
   - Any fflate error means `not-zip`.
2. **Classify** each record by `entryPath(name)` (2.4) as a folder (no candidate), unsafe (candidate, `unsafe-path`, raw name shown) or a file.
3. **Decide the top-level folder** (2.4) and strip it.
4. **Plan each file, in record order:**
   - a path already seen gives `duplicate`, and the first entry wins;
   - compression other than 0 or 8 gives `unsupported`;
   - a recorded size over 1 MB gives `too-large`;
   - a failed plausibility check refuses the whole zip as `damaged`;
   - anything else is marked for inflating.
5. **Pass 2.** Call `unzipSync(bytes, {filter})` with an index counter that admits only the marked records, checking the deadline before each.
   - Thrown fflate errors give `damaged`, naming the last admitted path.
   - Results are read with `Object.hasOwn` by raw name. The plan admits at most one record per raw name, and `__proto__` segments are unsafe, so the lookup is unambiguous.
6. **Decode:** `decodeText(bytes)` (2.6) gives the text, or `null` for `binary`.
7. **Return** `{ok: true, entries, stripped, candidates}`, with candidates sorted by path.

### 2.4 Paths and the top-level folder (IO-11)

**`entryPath(raw)`:**
- `\` becomes `/`, and a trailing `/` marks a folder.
- These are unsafe:
  - an empty path;
  - a leading `/`, or a drive letter (`^[A-Za-z]:`);
  - U+0000–U+001F or U+007F;
  - an empty, `.`, `..` or `__proto__` segment;
  - more than 1,024 characters.
- There is no Unicode normalisation, and case is kept.

**`topFolder(entries)`:**
- It considers safe files and folders whose first segment isn't `__MACOSX`.
- If there is at least one file, all of them share one first segment `T`, and no file is `T` itself, it returns `T`. Otherwise it returns `null`.
- Exactly one level is stripped: `a/b/main.nf` becomes `b/main.nf`.
- The rule is decided once at read time, so editing the ignore list never moves paths.

**`stripFolder(path, T)`** removes `T/` where present. `__MACOSX/…` and unsafe paths are left alone.

### 2.5 Ignore list (IO-12, open points 5 and 6)

**Syntax**, a subset of `.gitignore`:
- one pattern per line, trimmed; blank lines and `#` lines are skipped;
- `*` and `?` stay within a folder, and `**` crosses folders;
- a trailing `/` matches folders only (and everything under them);
- a pattern with no `/` except a trailing one matches a name at any depth;
- a leading or inner `/` anchors the pattern to the top;
- matching is case-sensitive;
- `!`, `[` and `\` lines are reported as `IgnoreProblem {line, text, message}` and not applied.

Patterns match stripped paths.

**`DEFAULT_IGNORE`** (recommended; it honours ADR 0009's "test data" with the nf-core folder convention, not file extensions):

```
# Run output and caches
work/
results/
null/
.nextflow*
.nf-test*
.lineage/
# Test data
/data/
/testing/
/test-datasets/
# Version control and system files
.git/
node_modules/
__MACOSX/
.DS_Store
```

- `.nf-builder/` is never ignored, so a re-imported export keeps its layout (F-404 step 3).
- The template's `assets/test/*.fastq` are kept.

### 2.6 Text or binary
`decodeText(bytes)`:
- returns `null` if any of the first 8,000 bytes is 0 (git's heuristic);
- otherwise returns `new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes)`, or `null` if that throws.

A BOM and CRLF line endings survive byte for byte. Binary files are skipped, and the schema is unchanged (open point 4).

### 2.7 Selection and summary

**Which reason applies**, in order:
1. `unsafe-path` or `duplicate`;
2. `ignored`, when a pattern matches;
3. `unsupported`, `too-large` or `binary`;
4. otherwise the file is imported.

**`selectFiles`** returns `{path, text}[]`, sorted.

**`summarise`** returns:
- `files` and `bytes`;
- `stripped`;
- `skipped` groups in a fixed order (ignored, too-large, binary, unsafe-path, duplicate, unsupported), each with `count`, `bytes` and at most 100 sorted paths;
- `ignore` and `ignoreProblems`.

**`importProblem(summary)`** gives the Create-time message for ignore-list problems or zero files.

### 2.8 Worker API
- **`stageZip(file: Blob, name: string)`:**
  - checks the size, reads the blob, runs `readZip`, and stores `{id, source: name, read}`;
  - returns `{ok: true, id, summary}` for `DEFAULT_IGNORE`, or a refusal.
- **`restageImport(id, ignore)`** gives a new summary, or the refusal `gone`.
- **`discardImport(id)`** drops the stage.
- **`createProject({…, files: [], import: {id, ignore}})`:**
  - refuses an import combined with a template or files;
  - refuses an unknown id with the `gone` message;
  - refuses when `importProblem` reports a problem;
  - otherwise stores `selectFiles(...)` in one transaction, discards the stage and returns the `ProjectMeta`.

Every result is plain data.

### 2.9 Dialog (open point 14)
- **Route group:** a third radio, "Import", under "How to start".
- **Under it:**
  - an "Import from" fieldset with a "Zip file" radio, checked (F-401 adds "GitHub repository" before it);
  - a file input labelled "Zip file to import", accepting `.zip,application/zip,application/x-zip-compressed`.
- **States:**
  - `empty`;
  - `reading`: `role="status"` "Reading <name>…";
  - `refused`: `role="alert"` with the message;
  - `ready`: the summary section.
- **The summary section**, headed "Import summary", shows:
  - "<n> files, <size>" (or "1 file");
  - "Removed the top-level folder <T>/.";
  - a `<details>` "Skipped files (<k>)" with groups;
  - a labelled "Ignore list" textarea with help text: "One pattern per line, as in .gitignore. A trailing / matches a folder and a leading / anchors to the top. Binary files and files over 1 MB are always skipped.";
  - the problems.
- **Restaging:** an edit restages after 300 ms, and an older reply never replaces a newer one.
- **Project name:** when a zip is read and the Name field still says "Untitled project", the name becomes `zipProjectName(file.name)`.
- **Discarding:** choosing another file, leaving the route or closing the dialog discards the stage.
- **No new header control,** so the F-201 baseline is untouched.

### 2.10 Messages (British English; numbers grouped en-GB)

| Code | Message |
|---|---|
| `too-big` | "This zip is 230 MB. Imports take zips of up to 200 MB." |
| `too-many-entries` | "This zip has more than 20,000 files and folders. Imports take up to 20,000." |
| `too-large-uncompressed` | "This zip expands to more than 200 MB. Imports take up to 200 MB uncompressed." |
| `not-zip` | "This file isn't a zip archive, or it is damaged." |
| `damaged` (plausibility) | "This zip is damaged: <path> doesn't match its recorded size." |
| `damaged` (inflate error) | "This zip couldn't be unpacked at <path> (<detail>). It may be damaged or password-protected." |
| `too-slow` | "This zip took more than 30 seconds to unpack and was stopped. It may be damaged." |
| `gone` | "That import is no longer available. Choose the zip file again." |
| Create, ignore-list problem | "Fix the ignore list first. Line <n>: <message>" |
| Create, no files | "Nothing to import: every file was skipped." |

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/sources/src/import/limits.ts` | `ImportLimits {maxArchiveBytes; maxEntries; maxTotalBytes; maxTextFileBytes; unpackMs}` (readonly numbers); `IMPORT_LIMITS: ImportLimits`; `formatBytes(bytes: number): string` (B, kB, MB, GB, SI; one decimal below 10, dropped when zero); `formatCount(n: number): string` |
| `packages/sources/src/import/types.ts` | `FixedSkipReason = "too-large"\|"binary"\|"unsafe-path"\|"duplicate"\|"unsupported"`; `SkipReason = "ignored"\|FixedSkipReason`; `ImportCandidate {path; size; text: string\|null; reason: FixedSkipReason\|null}`; `ImportedFile {path; text}`; `SkipGroup {reason; count; bytes; paths: readonly string[]}`; `IgnoreProblem {line; text; message}`; `ImportSummary {source; stripped: string\|null; files; bytes; skipped: readonly SkipGroup[]; ignore: string; ignoreProblems: readonly IgnoreProblem[]}`; `ImportRefusalCode = "too-big"\|"too-many-entries"\|"too-large-uncompressed"\|"not-zip"\|"damaged"\|"too-slow"\|"gone"`; `ImportRefusal {ok: false; code; message}`. All readonly. |
| `packages/sources/src/import/messages.ts` | `refuse(code: ImportRefusalCode, detail?: {size?: number; path?: string; cause?: string}, limits?: ImportLimits): ImportRefusal` (the copy in 2.10) |
| `packages/sources/src/import/paths.ts` | `EntryPath = {kind: "file"\|"folder"; path} \| {kind: "unsafe"; path; problem}`; `entryPath(raw: string): EntryPath`; `topFolder(entries: readonly EntryPath[]): string\|null`; `stripFolder(path: string, folder: string\|null): string` |
| `packages/sources/src/import/ignore.ts` | `DEFAULT_IGNORE: string`; `IgnoreRule {line; pattern; anchored; folderOnly; regex: RegExp}`; `IgnoreList {rules: readonly IgnoreRule[]; problems: readonly IgnoreProblem[]}`; `parseIgnore(text: string): IgnoreList`; `isIgnored(list: IgnoreList, path: string): boolean` |
| `packages/sources/src/import/text.ts` | `SNIFF_BYTES = 8000`; `decodeText(bytes: Uint8Array): string\|null` |
| `packages/sources/src/import/select.ts` | `SKIP_ORDER: readonly SkipReason[]`; `SKIP_LIST_MAX = 100`; `skipReason(c: ImportCandidate, list: IgnoreList): SkipReason\|null`; `selectFiles(candidates: readonly ImportCandidate[], list: IgnoreList): readonly ImportedFile[]`; `summarise(input: {source: string; stripped: string\|null; candidates: readonly ImportCandidate[]; ignore: string}): ImportSummary`; `importProblem(summary: ImportSummary): string\|null` |
| `packages/sources/src/zip/read-zip.ts` | `ZipRead {ok: true; entries: number; stripped: string\|null; candidates: readonly ImportCandidate[]}`; `ReadZipOptions {limits?: ImportLimits; now?: () => number}`; `checkArchiveSize(size: number, limits?: ImportLimits): ImportRefusal\|null` (also refuses under 22 bytes as `not-zip`); `readZip(bytes: Uint8Array, options?: ReadZipOptions): ZipRead\|ImportRefusal` |
| `packages/sources/test/fixtures/zips.ts` | `zipOf(files: Record<string, string\|Uint8Array\|[Uint8Array, {level: 0\|1\|6}]>, options?: {comment?: string}): Uint8Array` (fflate `zipSync`); `withRecordedSizes(zip: Uint8Array, name: string, sizes: {originalSize?: number; compressedSize?: number}): Uint8Array` (patches the central record and the local header) |
| `apps/web/src/workspace/import-stage.ts` | `SourcesModule` (the `sources` exports used); `ImportStager {stageZip(file: Blob, name: string): Promise<ImportStageResult>; restage(id: string, ignore: string): Promise<ImportStageResult>; files(id: string, ignore: string): Promise<readonly ImportedFile[]\|ImportRefusal>; discard(id: string): void}`; `createImportStager(options?: {load?: () => Promise<SourcesModule>; newId?: () => string; now?: () => number; limits?: ImportLimits}): ImportStager` (default `load` is `() => import("@nf-builder/sources")`) |
| `apps/web/src/project/zip-import.ts` | `ZipImportState = {status: "empty"} \| {status: "reading"; name} \| {status: "ready"; name; id; summary: ImportSummary; ignore: string; updating: boolean} \| {status: "refused"; name; message}`; `ZipImportView {state; choose(file: File\|null): void; setIgnore(text: string): void; reset(): void}`; `createZipImport(deps: {workspace: () => Pick<WorkspaceApi, "stageZip"\|"restageImport"\|"discardImport">; onChange: (s: ZipImportState) => void; timer?: Timer; debounceMs?: number}): ZipImportView`; `useZipImport(): ZipImportView`; `zipProjectName(fileName: string): string` |
| `apps/web/src/project/import-section.tsx` | `SKIP_LABELS: Record<SkipReason, string>`; `ImportSection(props: {view: ZipImportView; busy: boolean}): JSX.Element` (presentational) |
| `e2e/zips.ts` | `corpusDir(id)`; `pinnedSha(id)` (reads `.cache/corpus/<id>.complete`); `gitArchiveZip(dir: string, prefix: string, out: string): void` (copies into a temp repo, clears `GIT_*`, sets `core.autocrlf=false` and fixed dates, runs `git archive --format=zip --prefix=<prefix>/`); `writeZip(files, out, level?)` (fflate); `RNASEQ_NF_SKIPPED`; `chooseZip(page, path): Promise<Locator>` (dialog, Import, Zip file, `setInputFiles`, wait for summary or alert) |
| Test files | `packages/sources/test/import/{limits,paths,ignore,text,select}.test.ts`; `packages/sources/test/zip/{read-zip,read-zip-fuzz}.test.ts`; `apps/web/test/{import-stage,zip-import,import-section}.test.ts(x)`; `e2e/zip-import.spec.ts` |

### 3.2 Change
- **`packages/sources/package.json`:**
  - `"dependencies": {"fflate": "0.8.3"}`;
  - `"devDependencies": {"fast-check": "4.11.0"}`;
  - `"sideEffects": false`.
- **`packages/sources/tsconfig.json`:** `"compilerOptions": {"types": ["node"]}`, as the engine has.
- **`packages/sources/src/index.ts`:** re-export everything above.
- **`packages/sources/README.md`:** a short description.
- **Root `package.json`:** devDependency `"fflate": "0.8.3"`, for e2e and web-test fixtures. Lockfile updated.
- **`apps/web/package.json`:** `"@nf-builder/sources": "workspace:*"`.
- **`apps/web/src/workspace/types.ts`:**
  - `ImportChoice {id: string; ignore: string}`;
  - `ImportStageResult = {ok: true; id: string; summary: ImportSummary} | ImportRefusal`;
  - `NewProject.import?: ImportChoice`;
  - `WorkspaceApi` gains `stageZip(file: Blob, name: string): Promise<ImportStageResult>`, `restageImport(id: string, ignore: string): Promise<ImportStageResult>` and `discardImport(id: string): Promise<void>`.
- **`apps/web/src/workspace/workspace.ts`:**
  - `WorkspaceOptions.importer?: ImportStager`;
  - the three methods, outside `serial`;
  - the `createProject` import branch and its checks (2.8).
- **`apps/web/src/engine/engine-client.ts`:** forward the three methods.
- **`apps/web/src/project/new-project-dialog.tsx`:**
  - `NewProjectRoute` adds `"import"`;
  - a `useZipImport` prop;
  - `NewProjectForm.zip: ZipImportState`;
  - `NewProjectRequest.template` becomes optional, plus `import?: ImportChoice`;
  - `newProjectRequest` and `submitOutcome` handle the import route;
  - the name default;
  - render `ImportSection`.
- **`apps/web/src/project/project-store.ts`:** `create` passes `template` only when set, and `import`.
- **`apps/web/src/project/project-controls.tsx`:** pass `useZipImport`.
- **`apps/web/src/styles.css`:** summary and textarea styles, reusing the `dialog-*` classes.
- **Docs:** section 7.
- **Not changed:**
  - `packages/engine` and `lang-core`;
  - dependency-cruiser (`apps/web` to `sources` is already allowed);
  - `.github/workflows/` (CI already restores the corpus and has git in the Chromium leg);
  - the IndexedDB schema;
  - generated files;
  - the AGENTS.md commands (no new script);
  - the visual baselines.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`limits.test.ts`** | |
| `F-403 IO-12 QA-32: the limits are 20,000 entries, 200 MB uncompressed, a 200 MB zip, 1 MB per text file and 30 s to unpack, with 1 MB = 1,000,000 bytes` | constants |
| `F-403 IO-12: formatBytes writes 999 B, 31 kB, 6.1 MB, 1 MB and 200 MB` | exact strings |
| **`paths.test.ts`** | |
| `F-403 IO-11: backslashes become slashes and a trailing slash marks a folder` | |
| `F-403 QA-32: absolute paths, drive letters, control characters, empty, ., .. and __proto__ segments and paths over 1,024 characters are unsafe` | |
| `F-403 IO-11: one top-level folder is stripped; a file at the top, two top-level names or a file named like the folder strip nothing` | |
| `F-403 IO-11: __MACOSX/ entries don't count when deciding the folder, and only one level is stripped` | |
| **`ignore.test.ts`** | |
| `F-403 IO-12: the default list ignores run output, .git/, node_modules/, __MACOSX/ and .DS_Store at any depth, and /data/, /testing/ and /test-datasets/ at the top only` | includes `modules/x/data/a.nf` kept and `.nf-builder/layout.json` kept |
| `F-403 IO-12: name patterns match at any depth, anchored ones from the top; a trailing slash matches folders only; * and ? stay in a folder; ** crosses folders` | |
| `F-403 IO-12: blank and # lines are skipped; !, [ and \ lines are problems with their line numbers and are not applied` | |
| **`text.test.ts`** | |
| `F-403 IO-12: a NUL in the first 8,000 bytes or invalid UTF-8 makes a file binary; a NUL after byte 8,000 doesn't` | |
| `F-403 IO-20: a BOM and CRLF line endings are kept, so the text re-encodes to the same bytes` | |
| **`select.test.ts`** | |
| `F-403 IO-12: selectFiles keeps text files no pattern ignores, sorted by path; ignored wins over binary and too-large; unsafe and duplicate win over ignored` | |
| `F-403 IO-12 UX-61: summarise gives files, bytes and skipped groups in a fixed order with at most 100 paths each, and carries the ignore problems` | |
| `F-403 IO-12: importProblem reports the first ignore-list problem and an import with no files` | messages from 2.10 |
| **`read-zip.test.ts`** (fixtures from `zipOf`) | |
| `F-403 IO-11: a git archive-style zip (a folder entry per folder, a comment, stored and deflated entries) reads with its top-level folder stripped` | |
| `F-403 IO-12: text files over 1 MB are skipped without being inflated, binary files are skipped, and compression other than stored or deflated is unsupported` | |
| `F-403 IO-12: duplicate paths keep the first entry` | |
| `F-403 step 2 IO-12 QA-32: checkArchiveSize refuses a zip over 200 MB, and anything under 22 bytes` | |
| `F-403 step 2 IO-12 QA-32: a zip with 20,001 entries is refused with the entries message` | real constants; 20,001 empty entries |
| `F-403 step 2 IO-12 QA-32: recorded sizes over 200 MB in total are refused before anything is inflated` | `withRecordedSizes`, and a load spy showing no inflate |
| `F-403 QA-32: an entry whose compressed size exceeds its recorded size by more than an eighth plus 1 kB is refused as damaged, naming it` | |
| `F-403 QA-32: an entry whose data expands past its recorded size yields at most its recorded size, quickly` | 100 kB recorded, 50 MB of "a" deflated; text length 100,000; under 5 s |
| `F-403 QA-32: once 30 seconds have passed, unpacking stops before the next entry with the too-slow message` | injected clock |
| `F-403 IO-14: random bytes and an empty file are refused as not a zip` | |
| `F-403 ADR-0003: every ZipRead and refusal survives structuredClone` | |
| **`read-zip-fuzz.test.ts`** | |
| `F-403 QA-32: corrupted, truncated or extended archives always give files or a refusal, never an exception, each within 2 s` | fast-check, seed 403, 300 runs |
| **Web: `import-stage.test.ts`** | |
| `F-403 QA-01: the sources module is loaded on the first stageZip only` | `load` spy |
| `F-403 IO-11: a blob over 200 MB is refused without being read` | a fake `Blob` whose `arrayBuffer` throws |
| **Web: `workspace.test.ts`** (new `describe`) | |
| `F-403 IO-11 IO-12: stageZip gives a summary; createProject with the import stores exactly the selected files and discards the stage` | `fake-indexeddb` records |
| `F-403 IO-12: restageImport applies an edited list, and createProject uses the list it is given` | |
| `F-403 step 2 QA-32: a refused zip comes back as data and stores nothing` | |
| `F-403: createProject refuses an unknown or discarded import, an import with a template or files, ignore-list problems and an import with no files` | |
| `F-403 ADR-0003: stage results survive structuredClone` | |
| **Web: `engine-client.test.ts`** | |
| `F-403 ADR-0003: stageZip, restageImport and discardImport cross the bridge with a Blob and a name` | the Node `MessageChannel` |
| **Web: `zip-import.test.ts`** | |
| `F-403 IO-12: choosing a file shows reading, then the summary; a refusal shows its message` | fake workspace |
| `F-403 IO-12: an ignore-list edit restages after 300 ms, and an older reply never replaces a newer one` | fake timer |
| `F-403: choosing another file, reset and a refusal discard the previous stage` | |
| `F-403 UX-60: zipProjectName drops .zip and keeps at most 100 characters` | |
| **Web: `new-project-dialog.test.tsx`** | |
| `F-403 UX-60: a third route, Import, with Zip file as its source and a labelled file input` | |
| `F-403 IO-12 UX-61 QA-10: a staged zip shows files and size, the removed folder, skipped groups and the labelled ignore list; a refusal is an alert` | static markup |
| `F-403 UX-60 IO-12: newProjectRequest for Import needs a read zip with files and no list problems, and carries its id and ignore text without a template` | |
| **Web: `project-store.test.ts`** | |
| `F-403 UX-60: create sends the import choice without a template, then opens the new project` | |
| **E2E `e2e/zip-import.spec.ts`** | |
| `F-403 step 1 IO-11 IO-12 QA-30: a GitHub archive zip of rnaseq-nf imports the same files as the pinned tree, without its top-level folder` | Chromium only (corpus). Summary "22 files, 31 kB" and "Removed the top-level folder rnaseq-nf-53377cff870bdb0ae02ee5cdb74703af4b18e887/."; 12 ignored and 1 binary (`multiqc/nextflow_logo.png`); the name defaults to the zip name. After Create, the IndexedDB files for the project equal `readProject(corpus)` minus `data/**` and the PNG (path and text). No CSP violation or console error. |
| `F-403 IO-12: removing /data/ from the ignore list before confirming updates the summary to 34 files, and they are stored` | |
| `F-403 step 2 IO-12 QA-32: a zip with more than 20,000 entries is refused with a clear message and no project is created` | exact alert text; project count unchanged |
| `F-403 step 2 IO-12 QA-32: a zip that expands to more than 200 MB is refused with a clear message before anything is unpacked` | one honest 201,000,000-byte zero entry at level 1; alert within 5 s |
| `F-403 IO-11 QA-20: a small zip imports and its files are stored @smoke` | `git archive` of the hello-world template with prefix `hello-world-main/`; stored files equal the template's |
| `F-403 QA-01 IO-11: the zip reader is only in a lazily loaded worker chunk, never in the initial JavaScript` | fflate's string `invalid zip data` is absent from the initial closure and present in a worker-manifest chunk, as F-205's QA-01 test does |

No `@visual` test: nothing on the canvas or in the header changes.

## 5. Tasks (branch `feat/F-403`, worktree `/home/user/wt-F-403`)

0. **Orchestrator:** settle the open points, especially 1, 3, 5 and 15. Run `pnpm corpus:fetch` in the worktree.
1. **Import core** (no zip):
   - `limits.ts`, `types.ts`, `messages.ts`, `paths.ts`, `ignore.ts`, `text.ts`, `select.ts`;
   - the index exports, the tsconfig `types`, and `sideEffects`;
   - their tests.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
2. **Zip reader:**
   - `pnpm --filter @nf-builder/sources add --save-exact fflate@0.8.3`;
   - `pnpm --filter @nf-builder/sources add -D --save-exact fast-check@4.11.0`;
   - `pnpm add -D -w --save-exact fflate@0.8.3`;
   - `read-zip.ts`, `test/fixtures/zips.ts`, `read-zip.test.ts` and `read-zip-fuzz.test.ts`;
   - the licences row.
   - Record two timings for the ADR: `readZip` on the rnaseq-nf `git archive` zip, and one entry recorded as 1 MB that inflates to about 1 GB.
   - Done when these pass: `pnpm --filter @nf-builder/sources test`, `pnpm check` and `pnpm audit --audit-level high`.
3. **Worker staging:**
   - the `@nf-builder/sources` dependency in `apps/web`;
   - `import-stage.ts`, the `types.ts` and `workspace.ts` changes, and the client facade;
   - the web tests.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-202|F-203"`.
4. **Dialog:**
   - `zip-import.ts`, `import-section.tsx`, the dialog, store and controls changes, and styles;
   - their tests.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check`, and `pnpm build && pnpm check:budget && pnpm check:hosts`. Report the QA-01 change in the PR.
5. **End-to-end:**
   - `e2e/zips.ts` and `e2e/zip-import.spec.ts`;
   - export `PW_CHROMIUM_EXECUTABLE` first.
   - Done when these pass: `pnpm test:e2e -- --grep F-403`, `pnpm test:e2e -- --grep "F-202|F-203|F-205"`, and `pnpm smoke` (under 60 s; record the time).
   - CI's Firefox and WebKit legs run the `@smoke` import.
6. **Records** (section 7).
   - Done when `pnpm check` passes.
7. **Orchestrator:** PR (with the `scope-change` label if open point 17 is taken), CI green on `CI`, `Deploy check` and `Scope guard`, then review.

## 6. Open points (each has a recommendation; none is decided here)

1. **Zip library** (decide and record: a new runtime dependency).
   - **Recommendation:** fflate 0.8.3, pinned exactly, as a runtime dependency of `@nf-builder/sources`. Use the sync `unzipSync` only.
   - Also add a root dev dependency on the same version for e2e and web-test fixtures, and fast-check 4.11.0 as a `sources` dev dependency.
   - The reasons are in 1.4: ADR 0003 names it, its parser is tested, F-404 and F-406 need its writer, and it is small. Versions below 0.8.3 carry GHSA-px8p-9vwx-vf98.
   - **Alternative:** `DecompressionStream` with a hand-written container reader and CRC-32. It counts bytes exactly, but we would own a binary parser and still need a writer later.
2. **Which worker.**
   - **Recommendation:** the engine worker, with `sources` loaded lazily. File text never leaves the worker (AR-30, ADR 0045), and the chunk is outside QA-01.
   - **A separate worker started by the page:** its texts would have to cross the main thread or a hand-built `MessageChannel`.
   - **A nested worker started by the engine worker:** isolates CPU and could be terminated on Cancel, but adds a third worker entry and copies every text once more.
3. **Headers that understate sizes.**
   - **Recommendation:** use the 2.2 guards (plausibility, plus a 30 s deadline checked between entries). Accept that such an entry is cut silently at its recorded size; real archivers don't write these. Don't check CRC (fflate doesn't expose it).
   - **Alternative:** our own central-directory reader with streaming inflate and CRC.
4. **Binary files.**
   - **Recommendation:** skip them, listed as "Binary files", with no schema change. The glossary says a project is text files, and schema v1 is text only.
   - Consequence: rnaseq-nf loses one PNG, and nf-core pipelines lose their docs images, so exports lack them.
   - Optionally add an M8 feature for binary passthrough (schema v2, export), which needs the `scope-change` label.
5. **Default ignore list.**
   - **Recommendation:** the 2.5 list. It reads ADR 0009's "test data" as nf-core's root `data/`, `testing/` and `test-datasets/`, so ADR 0009 stands.
   - Step 1 then expects 22 files.
   - **Option B:** no test-data patterns (34 files). This amends ADR 0009 and needs an ADR.
   - **Option A:** test data by extension (`*.fastq`, `*.fq` and so on). It would drop the F-203 template's `assets/test/*.fastq` on re-import.
6. **Ignore syntax.**
   - **Recommendation:** the 2.5 `.gitignore` subset, with unsupported lines blocking Create rather than being dropped silently.
7. **Units.**
   - **Recommendation:** 1 MB is 1,000,000 bytes, everywhere, displayed in SI units.
8. **What an entry is.**
   - **Recommendation:** every central-directory record, folders and `__MACOSX/` included. This also covers F-401's tree items.
9. **Cap on the zip file itself.**
   - **Recommendation:** 200 MB, checked before reading. This is a spec addition to IO-12.
10. **The folder rule.**
    - **Recommendation:** as in 2.4: one level, `__MACOSX/` excluded, decided before the ignore list, and stated in IO-11.
11. **Path rules.**
    - **Recommendation:** unsafe paths are skipped, not refused; backslashes are converted; no Unicode normalisation.
12. **A damaged entry or inflate error.**
    - **Recommendation:** it aborts the whole import. IO-14 treats it as an I/O error, and `unzipSync` can't skip one entry.
13. **Summary ownership.**
    - **Recommendation:** F-403 builds the summary half of UX-61 for zips, as IO-12 needs. The report after import (parse failures, legacy share, suggestions) stays with F-401, which reuses `ImportSection`.
14. **UI.**
    - **Recommendation:**
      - an "Import" route with an "Import from" group holding one "Zip file" radio, so F-401 adds a second without moving selectors;
      - the default name taken from the zip;
      - no header button.
15. **F-401 overlap.**
    - Both features build the Import route and IO-12's shared module.
    - **Recommendation:** don't run them in parallel. Land F-403's tasks 1 and 4 first, or plan F-401 against section 2 and rebase. Either way, add a note to F-401.
16. **IO-13.**
    - **Recommendation:** out of scope, since F-403 doesn't cite it.
    - Note for F-401: record the zip case as `{kind: "zip", name, sha256}`, hashed from the staged blob in the worker. `crypto.subtle` exists only in secure contexts, which matters for frames (ADR 0044).
17. **F-404's dependencies.**
    - Step 3 imports a zip, so add F-403 to F-404's `depends_on`.
    - **Recommendation:** yes. This is a `features.json` change and needs the `scope-change` label and a record.
18. **Fixtures.**
    - **Recommendation:** build the rnaseq-nf archive at test time with `git archive` from `.cache/corpus/rnaseq-nf` and the GitHub prefix `<repo>-<sha>/`. This needs no new host and no committed binary.
    - Use fflate `zipSync` for synthetic and hostile zips.
    - A real codeload archive couldn't be fetched here, and no ADR records codeload for tools.
19. **Step 1's wording.** F-401 isn't built, so "same files as the GitHub import" can't be compared directly.
    - **Recommendation:** read it as "the pinned tree after the IO-12 rules", which is also what F-401 step 1 compares against.
    - F-401's e2e test reuses `RNASEQ_NF_SKIPPED` so both routes assert one set.
20. **The `@smoke` tag.**
    - **Recommendation:** tag the small-zip test (QA-20: it covers cloning a `File` into a worker in Firefox and WebKit). Check that `pnpm smoke` stays under 60 s.

**Decide-and-record items (AGENTS.md):**
- **New runtime dependency:** fflate (1). Dev dependencies: fflate at the root, fast-check in `sources`.
- **Package boundaries:** none. This is the first use of `apps/web` importing `sources`, which ADR 0003 already allows.
- **Stored or exported format:** none. Schema v1 is unchanged; `NewProject.import` is an in-memory API.
- **User-visible spec changes:** IO-11 and IO-12, which need an ADR.
- **ADR interplay:** reads ADR 0009's ignore list (5). Amends it only if option B is chosen.
- **Workflows:** none.
- **`features.json`:** the F-404 `depends_on` change (17) and an optional binary feature (4).
- **Open questions:** none.

## 7. Records (drafts for the orchestrator)

**ADR**, `Accepted (agent)`. Use the next free number at landing (0048 and 0049 are taken on `feat/F-208` and `feat/F-206`). Title: "Import zips with fflate in the engine worker: text files only, IO-12 limits checked before unpacking". It covers:
- **Context:**
  - IO-11, IO-12 and QA-32;
  - ADR 0009's list;
  - the S4 result (upload only);
  - ADR 0045's text-only schema;
  - the comparison in 1.4.
- **Decision:**
  - fflate 0.8.3, sync API only, in a lazily loaded chunk of the engine worker;
  - the staging calls and `NewProject.import`;
  - the 2.2 limits and when each is checked;
  - the folder, path, ignore, text and selection rules;
  - the default list;
  - the messages.
- **Consequences:**
  - binary files, symlinks (imported as their target text) and executable bits (`bin/`) are not kept;
  - entries with understated headers are cut;
  - no CRC check;
  - the measured times;
  - F-401 and F-210 reuse the module.
- **Alternatives:**
  - `DecompressionStream`;
  - a separate or nested worker;
  - storing binary files;
  - an extension-based test-data list.

Add it to `docs/adr/README.md`.

**Spec, `data-and-io.md`:**
- **IO-11:** "Zip import reads the file in the engine worker and strips a single top-level folder: when every entry outside `__MACOSX/` lies under one folder, that folder is removed from every path (ADR NNNN)."
- **IO-12:** "Both routes skip binary files and text files over 1 MB, and apply the default ignore list (ADR NNNN), editable before confirming. Limits guard against zip bombs: at most 20,000 entries (files and folders), 200 MB uncompressed and a 200 MB zip. 1 MB is 1,000,000 bytes."

**Spec, `architecture.md`, Data flow:** add one line: "Zip import reads and unpacks the file in the engine worker; the page sees only the summary."

**`docs/licences.md` row:** "fflate 0.8.3 (101arrowz/fflate) | Zip reading in the engine worker (F-403, ADR NNNN); test fixtures | MIT | npm package licence; runtime dependency of `@nf-builder/sources`, dev dependency at the root".

**`features.json` notes:**
- **F-403:** "Verified …"
- **F-401:**
  - reuse `packages/sources/src/import/` and `ImportSection`;
  - add "GitHub repository" to "Import from";
  - IO-13's zip case;
  - `RNASEQ_NF_SKIPPED`;
  - binary files are skipped on both routes.
- **F-404:**
  - imported projects lack binary files and executable bits;
  - `.nf-builder/` is never ignored;
  - write with fflate `zipSync`;
  - the `depends_on` change if taken.
- **F-210:** dropping a zip reuses `stageZip` and `selectFiles`, writing through `writeFiles` in the worker.
- **F-406:** a backup import may bypass the ignore list.

**`progress.md` Decisions:**
- the ADR and fflate;
- the default list reading of ADR 0009;
- binary files skipped;
- the F-404 dependency, if taken.

## 8. Evidence

- **fflate tarball**, read as text in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-fflate/x/package/`:
  - `package.json` (MIT, `sideEffects: false`, no dependencies) and `LICENSE`;
  - `CHANGELOG.md` (0.8.3);
  - `lib/worker.cjs` (blob workers);
  - `esm/browser.js`: lines 188–205 (error codes), 216–393 (inflate with a fixed buffer), 1812–1858 (names, `zh`, `z64hs`), 2409–2556 (streaming `Unzip`) and 2652–2690 (`unzipSync`).
- **npm:**
  - `npm view fflate`: 0.8.3, published 2026-05-16; 0.4.9, 0.5.4, 0.6.11 and 0.7.5 published 2026-07-20;
  - the tarball's SHA-512 matches `dist.integrity`;
  - the npm bulk advisories endpoint lists GHSA-px8p-9vwx-vf98 (moderate, CVSS 7.5).
- **Sizes:** bundles built with rolldown 1.2.19 in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-size/` (`out-a.js`, `out-b.js`, `out-c.js`). None contains a URL, `Worker` or `createObjectURL`.
- **MDN browser-compat-data 8.1.10:** `api.DecompressionStream.deflate-raw` (in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-bcd/`).
- **Node 22.23.5 checks:** `DecompressionStream('deflate-raw')`, `Blob` over `MessageChannel`, `structuredClone(File)` gives a `Blob` with no name, and `zlib.crc32`.
- **Fixture:** `git archive` of the cached rnaseq-nf tree in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-gitarchive/rnaseq-nf.zip`, inspected with `unzip -Z`.
- **Corpus classification:** the script is `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-scripts/classify.py`, run on `/home/user/wt-F-208/.cache/corpus/{rnaseq-nf,rnaseq-nf-typed,rnaseq,sarek,fetchngs}`.
- **The real GitHub archive:** the attempt at `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/plan403-gh-zip/` returned the proxy's JSON refusal.
- **Repository (origin/main `2c3cc69`):**
  - `docs/adr/0003…md:16`, `0009…md:28-33,54` and `0045…md:15`;
  - `apps/web/src/workspace/workspace.ts:100,146,155`;
  - `apps/web/src/project/new-project-dialog.tsx:15,35,62,160`;
  - `apps/web/src/project/project-store.ts:165`;
  - `packages/sources/*`;
  - `scripts/security-policy.ts`;
  - `.github/workflows/ci.yml` (the e2e job and its corpus step).
- **Branches:** `docs/adr/0048-code-view-monaco.md` (F-208) and `0049-details-pane.md` (F-206).
