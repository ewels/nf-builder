# Plan: F-404, export a project as a zip, the layout sidecar optional; untouched files equivalent to the source

Written by the planner on 2026-11-28 from `origin/main` at `0f6e1d3` (F-401, F-210, F-703 and F-503 merged; the local `main` checkout was behind, so I read an archive of `origin/main`). I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**In scope:**
- **Export dialog (UX-62):** the header's Export button (disabled today) opens a dialog with "Include the layout" checked by default; Export downloads `<name>.zip`.
- **The zip (IO-20):** every project file at the current revision, `.nf-builder/layout.json` only when the box is ticked. Untouched files are the engine's text unchanged, so byte-identical to what was imported (stronger than "equivalent").
- **Notes from earlier features:** zip written with fflate `zipSync` (F-403); `bin/*` marked executable (F-401, ADR 0057); case-only path clashes warned (F-210, ADR 0055); a file and a folder sharing a prefix (`x`, `x/y`) handled (F-403); `.gitkeep` exported (ADR 0055); hidden in read-only (F-703, ADR 0056).
- **Step 2 (IO-21):** an oracle-backed check that an edited export lints clean when its source did.
- **Step 3:** export, fresh storage, zip import through F-403's route: identical sidecar bytes and node positions.

**Out of scope:**
- "Export all projects" and backup import (IO-04, F-406). The header's Import button stays as it is.
- Binary files, symlinks and executable bits lost at import (F-407; ADR 0053's consequences). Export can't restore what was never stored.
- Pushing to GitHub (F-402 and later), File System Access API saving.
- The F-207 note on the canvas store's layout notice after a `writeFiles` sidecar (F-210's add path, not export or create-from-zip).
- Linting every edited corpus pipeline's export in CI (ADR 0011's "edited corpus exports"); open point 6.

## 1. Findings

### 1.1 Spec and ADRs
- **IO-20:** "Export writes a zip of all project files, with the layout sidecar optional. Files the user did not change are equivalent to what was imported (see glossary)." Glossary: equivalent = same AST ignoring positions and whitespace, same comments; byte identity not required.
- **IO-21:** "Exported projects pass `nextflow lint` with no errors when the imported project did (CI oracle, ADR 0011)."
- **UX-62:** "Export dialog: zip of the project, with a checkbox to include the layout sidecar (on by default)."
- **ADR 0008:** "Export includes the sidecar by default." Step 3 is its confirmation. ADR 0008 is `Accepted`, so its body can't be edited (only spike results appended); record the confirmation elsewhere (open point 15).
- **ADR 0011:** the oracle "runs `nextflow lint` on templates, edit outputs and edited corpus exports". The last part isn't built.
- **ADR 0053:** fflate 0.8.3 in `@nf-builder/sources`, "Only `unzipSync` is used" (F-404 adds `zipSync`: an amendment). Import keeps text byte for byte (BOM, CRLF). The folder rule (IO-11): one top-level folder is stripped when every entry sits under it. Not kept at import: binaries, executable bits, empty folders, symlinks (imported as text holding the target).
- **ADR 0057:** "Projects imported from GitHub lack binary files and executable bits (F-404 should mark `bin/*` executable)." `ProjectMeta.source` holds the origin.
- **ADR 0056:** "Export stays hidden in read-only for v0.1 (F-404 and F-406), even though it only reads." Dialogs aren't rendered in read-only.
- **ADR 0055:** `.gitkeep` files are exported; "Paths that differ only by case can both exist; F-404 warns about them on export." `projectPathProblem` is in `@nf-builder/lang-core` (`packages/lang-core/src/paths.ts`).
- **ADR 0040:** CSP has `img-src ... blob:`; nothing restricts an `<a download>` to a `blob:` URL. **ADR 0044:** works in frames; a sandboxed frame without `allow-downloads` blocks the download (degrade, don't crash).
- **No spec text** fixes the zip's internal layout (top folder or not), the file name, permissions, timestamps, or what the dialog says about clashes.

### 1.2 Code on main
- **Header** (`apps/web/src/shell/app-header.tsx`): Export is `<button disabled>`; the whole `header-actions` block isn't rendered in read-only. `.header-button:disabled` has its own colour, so enabling it changes header pixels in visual baselines.
- **Workspace** (`apps/web/src/workspace/workspace.ts`, `types.ts`) runs in the engine worker and wraps `EngineApi`; `serial` orders every change, so a read inside `serial` sees one revision. `import-stage.ts` lazily loads `@nf-builder/sources/import` (fflate) as its own worker chunk; the same pattern suits export.
- **Engine:** `listFiles()` lists every file (including `.nf-builder/layout.json` and `.gitkeep`); `readFile(path)` returns `model.file(path).source.text`, the exact stored text. `LAYOUT_PATH` is in `packages/engine/src/layout/types.ts`. `equivalent()` and `printSourceFile` are exported from `@nf-builder/engine`.
- **Comlink:** `apps/web/src/engine/expose.ts` wraps `open` and `watch`; `engine-client.ts` already uses `transfer` for page-to-worker blobs. A `Uint8Array` result can be transferred back the same way.
- **Pending text:** `canvasStore.getState().flushEdits()` awaits registered Code-view flushes (F-209, F-703).
- **Project store** (`apps/web/src/project/project-store.ts`): `ProjectDialog` union (`new`, `rename`, `delete`), `showDialog`, focus return to the opener; dialogs are native `<dialog>` via `useModal` (`project-dialogs.tsx`).
- **fflate 0.8.3 `zipSync`:** per-file `ZipAttributes` `os`, `attrs` (Unix mode `<< 16` with `os: 3`) and `mtime` (DOS time, 1980 to 2099; defaults to now). It sets the UTF-8 flag for non-ASCII names, which `readZip` honours. Flat keys with `/` are paths, so `x` and `x/y` can both be written.
- **Tests to reuse:** `packages/sources/test/fixtures/zips.ts`; `e2e/zips.ts` (`corpusDir`, `gitArchiveZip`, `writeZip`, `chooseZip`, `RNASEQ_NF_SKIPPED`); `e2e/history.ts` (`applyThroughStore`, `storedFiles`); `e2e/layout.ts` (`dragNode`, `nodePosition`, `readSidecar`, `SIDECAR`); `e2e/csp.ts`; `e2e/read-only.ts`.
- **Oracle pair already linted in CI:** `tools/oracle/cases/f208-code-edit` (source, `lint: ok`) and `f208-code-edit-after` (one added call in `main.nf`, `lint: ok`), joined by one `replaceFileText`. Step 2 can reuse them with no new case.
- **Corpus:** `rnaseq-nf` has 22 files after the IO-12 rules, `bin/fastqc.sh`, and processes `FASTQC` (`modules/fastqc/main.nf`, included by `modules/rnaseq.nf`). Every pinned pipeline's recorded `nextflow lint` has no errors.

## 2. Design

### 2.1 Zip layout (exported format; open points 1 to 4)
- Entries sit under one folder, `<slug>/`, as in a GitHub archive, so F-403's folder rule strips exactly it on re-import, even when every file sits in one folder and the sidecar is left out.
- Only file entries, no folder entries (projects have no empty folders; `.gitkeep` is a file). Names are UTF-8.
- `os: 3`; mode `0o100755` for files under `bin/` at the project root, `0o100644` for everything else. Deflate at fflate's default level; `mtime` is the export time.
- Text encoded with `TextEncoder`; a BOM is the text's own U+FEFF, so it round-trips.
- File name `<slug>.zip`. The slug is the project name with control characters and `/ \ : * ? " < > |` replaced by `-`, runs of `-` collapsed, leading and trailing dots, spaces and dashes trimmed, at most 100 characters, and `project` when empty.

### 2.2 Where it runs
- **Worker:** `WorkspaceApi.exportProject({layout})` runs inside `serial`: `listFiles()`, `readFile()` for each path (dropping `LAYOUT_PATH` unless `layout`), then `zipProject` from a new lazy subpath `@nf-builder/sources/export`. Returns `{ok, fileName, bytes, files, revision}` or an `EngineRefusal` (`no-project`, or `invalid` "Nothing to export." with no files). `expose.ts` transfers `bytes.buffer`.
- **Page:** the project store's `exportProject(layout)` awaits `canvasStore.getState().flushEdits()`, calls the workspace, then `downloadBytes(bytes, fileName)` (Blob `application/zip`, object URL, hidden `<a download>` click, URL revoked after 60 s). Export reads the engine's current text, not IndexedDB, so it includes edits that are still saving.

### 2.3 Dialog (UX-62)
`ExportDialog` (`apps/web/src/project/export-dialog.tsx`), `ProjectDialog` gains `{kind: "export"}`. On open it calls `listFiles()` and shows:
- the heading "Export project", the file name `<slug>.zip`, and "<n> files";
- the checkbox "Include the layout (.nf-builder/layout.json)", checked, disabled with "This project has no layout yet." when the file is absent;
- warnings (`exportClashes`, lang-core): "These paths differ only by case and clash on macOS and Windows: …" and "<x> is both a file and a folder; some tools can't unzip both." (at most 100 each);
- when `current.source` is set: "Files skipped when this project was imported (binary files, for example) aren't in the export.";
- Export (primary) and Cancel. Export shows "Preparing the zip…" while it runs; errors show inline (`role="alert"`) and the dialog stays open; success closes it and returns focus to the header button.
The header button is enabled when a project is current and none is opening.

### 2.4 Copy (British English, sentence case)
| When | Text |
|---|---|
| Heading | "Export project" |
| Checkbox | "Include the layout (.nf-builder/layout.json)" |
| No sidecar | "This project has no layout yet." |
| Running | "Preparing the zip…" |
| No files | "Nothing to export." |
| Failure | "Couldn't export the project: <message>" |

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/sources/src/export/zip-project.ts` | `ExportEntry {path: string; text: string}`; `ZipProjectOptions {folder: string; mtime?: number}`; `zipProject(files: readonly ExportEntry[], options: ZipProjectOptions): Uint8Array`; `exportMode(path: string): number` (`0o100755` under root `bin/`, else `0o100644`) |
| `packages/sources/src/export/name.ts` | `exportSlug(projectName: string): string`; `exportFileName(projectName: string): string` |
| `packages/sources/src/export/index.ts` | re-exports the above (the `./export` subpath) |
| `packages/lang-core/src/paths.ts` (extend) | `PathClashes {caseOnly: readonly (readonly string[])[]; fileAndFolder: readonly string[]}`; `exportClashes(paths: readonly string[]): PathClashes` |
| `packages/sources/test/export/zip-project.test.ts`, `name.test.ts`; `packages/sources/test/fixtures/zip-attrs.ts` (`centralEntries(bytes): {name; os; mode; utf8}[]`, a central-directory reader for tests) | section 4 |
| `apps/web/src/project/export-dialog.tsx` | `ExportDialog({onClose}: {onClose(): void}): JSX.Element` |
| `apps/web/src/project/download.ts` | `downloadBytes(bytes: Uint8Array, fileName: string, doc?: Document, timer?: (fn: () => void, ms: number) => void): void` |
| `apps/web/test/export-dialog.test.tsx`, `download.test.ts`, `export-project.test.ts` (workspace-level) | section 4 |
| `e2e/export.ts` | `exportZip(page, {layout?: boolean}): Promise<{fileName: string; files: Record<string, Uint8Array>; entries: ZipEntryInfo[]}>` (clicks Export, awaits Playwright's `download`, unzips with fflate); `stripFolder(files, folder)` |
| `e2e/export.spec.ts` | section 4 |

### 3.2 Change
- **`packages/sources/package.json`:** `"./export": "./src/export/index.ts"`.
- **`packages/lang-core/src/index.ts`:** export `exportClashes`, `PathClashes`.
- **`apps/web/src/workspace/types.ts`:** `ExportOptions {layout: boolean}`; `ExportResult {ok: true; fileName: string; bytes: Uint8Array; files: number; revision: number}`; `WorkspaceApi.exportProject(options: ExportOptions): Promise<ExportResult | EngineRefusal>`.
- **`apps/web/src/workspace/workspace.ts`:** `exportProject` in `serial`; lazy `import("@nf-builder/sources/export")` (injectable loader, like `createImportStager`).
- **`apps/web/src/engine/expose.ts`:** wrap `exportProject` with Comlink `transfer(result, [result.bytes.buffer])` on success.
- **`apps/web/src/engine/engine-client.ts`:** pass `exportProject` through if the client lists methods explicitly.
- **`apps/web/src/project/project-store.ts`:** `ProjectDialog` gains `{kind: "export"}`; `ProjectActions.exportProject(layout: boolean): Promise<void>` (flush, export, download; throws the refusal message); `ProjectStoreDeps.download?` and `flushEdits?` for tests.
- **`apps/web/src/project/project-controls.tsx`** (or wherever dialogs render): render `ExportDialog` when `dialog.kind === "export"` and not read-only.
- **`apps/web/src/shell/app-header.tsx`, `app-shell.tsx`:** `onExport` and `canExport` props; the button enabled when `canExport`.
- **`apps/web/src/styles.css`:** dialog warning list styles only.
- **`.dependency-cruiser.cjs`:** comment of `web-worker-no-github-client` names `@nf-builder/sources/export` too (rule unchanged).
- **`e2e/engine.ts`:** `WorkspaceHook.exportProject` type, if the hook is used.
- **Unchanged:** workflows, CSP, host allow-list, IndexedDB schema, sidecar format, AGENTS.md command table (no new script), dependencies.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/sources/test/export/zip-project.test.ts`** | |
| `F-404 IO-20: zipProject then readZip gives back every path and text byte for byte, with the folder stripped` | fast-check over valid project paths (`projectPathProblem` null), Unicode names, BOM, CRLF, empty files, `x` beside `x/y`; `readZip(...).stripped === folder`; texts equal |
| `F-404 IO-20 ADR-0057: files under the root bin/ are 0755 and all others 0644, made on Unix` | `centralEntries`: `os === 3`, modes; `modules/x/bin/y` is 0644 |
| `F-404 IO-20: names are UTF-8 flagged when not ASCII, there are no folder entries, and every entry sits under the folder` | |
| **`packages/sources/test/export/name.test.ts`** | |
| `F-404 UX-62: exportFileName replaces unsafe characters, trims, caps at 100 characters and falls back to project.zip` | table of names incl. `a/b`, `..`, `CON`, emoji, empty |
| **`packages/lang-core/test/paths.test.ts`** (extend) | |
| `F-404 ADR-0055: exportClashes groups paths that differ only by case and lists files that are also folders` | `README.md`/`readme.md`; `x` with `x/y`; none for a clean list |
| **`apps/web/test/export-project.test.ts`** (real engine, fake IndexedDB, as `workspace.test.ts`) | |
| `F-404 step 1 IO-20: after one renameDeclaration, every file outside the command's patches is byte-identical in the export and equivalent() to its import` | `tools/oracle/cases/f111-start-typed` imported from a zip, one process renamed; touched = `Applied.patches` paths |
| `F-404 step 2 IO-21: f208-code-edit imported from a zip, one replaceFileText, exported: the files equal f208-code-edit-after byte for byte` | the oracle lints both cases (CI `oracle`); sidecar excluded |
| `F-404 UX-62 ADR-0008: the sidecar is in the export only with layout true; .gitkeep files are always in it` | |
| `F-404: exportProject refuses with no project and with no files, and is ordered after a pending apply` | `serial` ordering: an `apply` queued first is in the export |
| **`apps/web/test/engine-expose.test.ts`** (extend) | `F-404: exportProject's bytes are transferred, not copied` (buffer detached on the worker side) |
| **`apps/web/test/project-store.test.ts`** (extend) | |
| `F-404 UX-62: exportProject flushes code edits before asking the workspace, then downloads the file name and bytes it returns` | call order |
| `F-404: a refused export throws its message and downloads nothing` | |
| **`apps/web/test/download.test.ts`** | `F-404: downloadBytes clicks a hidden download link to a blob URL and revokes it after 60 s` |
| **`apps/web/test/export-dialog.test.tsx`** | |
| `F-404 UX-62: the layout box is checked by default; unticking it exports with layout false` | |
| `F-404 UX-62: without a sidecar the box is disabled with its note` | |
| `F-404 ADR-0055: case-only clashes and file-and-folder paths are listed as warnings and Export stays enabled` | |
| `F-404 IO-13: an imported project shows the skipped-files note; a template project doesn't` | |
| `F-404 QA-10: a failure shows inline and keeps the dialog open; success closes it and returns focus to Export` | |
| **`apps/web/test/app-shell.test.tsx`** (extend) | `F-404 UX-62: Export is disabled with no project and enabled with one; read-only renders no Export (ADR 0056)` |
| **`e2e/export.spec.ts`** (Chromium) | |
| `F-404 step 1 IO-20: import rnaseq-nf from a zip, rename FASTQC, export: every file the rename didn't touch is byte-identical to the pinned tree` | `gitArchiveZip(corpusDir("rnaseq-nf"))`, `chooseZip`, Create; `applyThroughStore(renameDeclaration)`; download; folder `<slug>/`; untouched = pinned files minus `RNASEQ_NF_SKIPPED` minus patched paths, byte equal; patched files differ; `bin/fastqc.sh` mode 0755 |
| `F-404 step 2 IO-21: f208-code-edit imported, the Code edit applied, the export without layout equals oracle case f208-code-edit-after` | byte for byte; the CI `oracle` job lints the case |
| `F-404 step 3 IO-02 ADR-0008: export with the layout, import the zip in a fresh browser context: the sidecar bytes and every node position are identical` | hello-world template, `dragNode` one node, export; `browser.newContext()`, switcher empty, import the download; `readSidecar` text equal; `nodePosition` equal for every node; no "Laying out nodes…" |
| `F-404 UX-62: unticking the layout leaves .nf-builder/ out; re-importing lays the graph out with ELK` | |
| `F-404 QA-30: exporting logs no CSP violation and no console error, at top level and in a cross-origin iframe` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-404`. Run `pnpm format` and `pnpm check` before every commit. Settle section 6 first.

1. **Zip writer and path clashes.** `packages/sources/src/export/*`, the `./export` subpath, `exportClashes` in lang-core, their tests and the `centralEntries` fixture.
   - Done when `pnpm --filter @nf-builder/sources test`, `pnpm --filter @nf-builder/lang-core test` and `pnpm check` pass.
2. **Workspace export.** `ExportOptions`, `ExportResult`, `WorkspaceApi.exportProject`, the lazy loader, the transfer in `expose.ts`, the engine client; `export-project.test.ts` (steps 1 and 2 at unit level) and the expose test.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
3. **Dialog, store and header.** `download.ts`, `exportProject` in the project store, `{kind: "export"}`, `ExportDialog`, header props; unit tests.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-201|F-202|F-703"` pass, apart from `@visual` diffs caused by the enabled Export button (list them; they are re-approved from CI, ADR 0021).
4. **End-to-end.** `e2e/export.ts`, `e2e/export.spec.ts` (needs `pnpm corpus:fetch`).
   - Done when `pnpm test:e2e -- --grep F-404`, `pnpm smoke` (under 60 s) and `BASE_PATH=/nf-builder/ pnpm build && pnpm check:budget && pnpm check:hosts` pass (QA-01: fflate's writer stays in a worker chunk).
5. **Records** (section 7). Done when `pnpm check` passes (ADR lint, `features.json` validation).

## 6. Open points (none decided here)

1. **A top-level folder in the zip** (exported format). Without one, a project whose files all sit in one folder, exported without the sidecar, loses that folder on re-import (IO-11 strips it). **Recommend:** wrap every entry in `<slug>/`, as GitHub archives do. **Alternative:** flat entries, and document the edge case.
2. **File name and slug rule** (2.1). **Recommend** as written, `<slug>.zip` with no date. **Alternative:** append the export date.
3. **Executable bits** (ADR 0057 asks for `bin/*`). **Recommend:** root `bin/**` at 0755, everything else 0644, `os: 3`. Module binaries (`resources/usr/bin/` under a module, `nextflow.enable.moduleBinaries`) also need the bit, but I didn't verify the folder name against https://docs.seqera.io/nextflow/modules/developing-modules#resources; add it only after checking the docs (AGENTS.md "Nextflow knowledge").
4. **Timestamps, compression, folder entries.** **Recommend:** export time as `mtime`, fflate's default level, no folder entries. Zips aren't byte-reproducible; their files are.
5. **API and package shape** (amends ADR 0053's "only `unzipSync`" and the API lists of ADRs 0043, 0045, 0053). **Recommend:** `WorkspaceApi.exportProject` in the worker, a new `@nf-builder/sources/export` subpath loaded lazily, bytes transferred. No new engine method: `listFiles` and `readFile` inside the workspace's `serial` see one revision. **Alternative:** an `EngineApi.files()` snapshot call.
6. **Step 2's oracle.** **Recommend:** reuse the CI-linted pair `f208-code-edit` → `f208-code-edit-after` (no new case, no workflow edit), matched byte for byte in e2e and in the workspace test. ADR 0011's "edited corpus exports" stays unbuilt: record it in `docs/plan/open-questions.md` as a follow-up that needs a `corpus-parse` step (a workflow edit). **Alternative:** build it now: `test:corpus` writes each pin's edited tree to `.cache/corpus-export/`, then `pnpm corpus:lint --dir` in CI.
7. **Clashes.** **Recommend:** warn about case-only clashes and file-and-folder paths in the dialog, and still export. **Alternative:** block export.
8. **Files lost at import.** **Recommend:** the one-line note when `ProjectMeta.source` is set (2.3); no per-file list (it isn't stored).
9. **Unsaved edits.** **Recommend:** flush Code-view edits, then export the engine's text, so the zip matches the screen even while saving.
10. **Read-only.** **Recommend:** keep ADR 0056 (Export not rendered, dialogs not rendered); no store guard, since export doesn't write.
11. **Header Import button.** Stays disabled; IO-04's "Import" is F-406's. **Recommend:** a note on F-406.
12. **"Clear storage" in step 3.** **Recommend:** a fresh Playwright browser context (empty IndexedDB by construction), checked by an empty project switcher.
13. **Visual baselines.** Enabling Export changes the header in every baseline with an open project. **Recommend:** re-approve from CI (ADR 0021) and list them in the PR.
14. **Object URL lifetime.** **Recommend:** revoke after 60 s (immediate revocation cancels downloads in some browsers).
15. **ADR 0008 confirmation.** **Recommend:** record it in the new ADR and the F-404 note, not in ADR 0008's body.
16. **Re-import limits.** An exported project can exceed what import accepts (files over 1 MB edited in Code, over 20,000 files, paths on the default ignore list such as `results/`). **Recommend:** no checks in v0.1; state it in the ADR's consequences.

**AGENTS.md decide-and-record items:**
- **Exported format:** points 1 to 4 (new ADR).
- **ADR amendments:** point 5 (ADRs 0043, 0045, 0053).
- **Package boundaries:** point 5's new subpath of an existing package; no dependency-cruiser rule changes (a comment only).
- **Workflows:** none, unless point 6's alternative is chosen.
- **Open questions:** point 6's follow-up entry.
- **None:** runtime dependencies (fflate is already one), stored format, `features.json` scope.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, the next free number when F-404 starts: "Export a project as a zip under one folder, with the layout optional and bin/ executable". Covers 2.1 to 2.3 and points 1 to 9, 14 to 16; amends ADR 0053 (`zipSync` used; `WorkspaceApi.exportProject`; `./export` subpath), ADRs 0043 and 0045 (API list); confirms ADR 0008's sidecar default (step 3). Row in `docs/adr/README.md`.
- **Spec:**
  - IO-20: append "Entries sit under one folder named after the project; files under `bin/` are executable; names are UTF-8 (ADR 00NN)."
  - UX-62: append "It warns about paths that differ only by case and files that are also folders, and notes that files skipped at import are missing."
- **`features.json`:**
  - **F-404:** `passes`, and a note: "Verified …: step 1 by `e2e/export.spec.ts` (rnaseq-nf from a zip, `FASTQC` renamed, every file outside the rename's patches byte-identical to the pin, `bin/fastqc.sh` 0755) and `apps/web/test/export-project.test.ts`; step 2 by the `f208-code-edit` → `f208-code-edit-after` export, byte for byte with the oracle case CI lints; step 3 by the fresh-context round trip (sidecar bytes and positions identical; ADR 0008 confirmed). Decisions in ADR 00NN."
  - **F-406:** reuse `zipProject` and `exportFileName`; one folder per project in the backup; the header's Import button is yours.
  - **F-407:** export binary files once they are stored.
- **`docs/plan/open-questions.md`:** "Lint edited corpus exports in CI (ADR 0011)" with point 6's recommendation, unless built.
- **`progress.md` Decisions:** the ADR, the folder rule, the modes, the API amendment, the reused oracle pair, the re-approved baselines.
