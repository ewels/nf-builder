# 0062. Export a project as a zip under one folder, with the layout optional and bin/ executable

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

IO-20 says export writes a zip of all project files with the layout sidecar optional, and that files the user didn't change are equivalent to what was imported. IO-21 says an exported project passes `nextflow lint` when its source did, checked by the CI oracle (ADR 0011). UX-62 asks for an Export dialog with a checkbox for the sidecar, on by default, and ADR 0008 says export includes the sidecar by default. No spec text fixes the zip's internal layout, its file name, file modes, timestamps, or what the dialog says about paths that won't unzip cleanly.

Earlier features left constraints. Import strips one top-level folder when every entry sits under it (IO-11, ADR 0053) and keeps text byte for byte, BOM and CRLF included; it doesn't keep binary files, executable bits, empty folders or symlinks. ADR 0053 pinned fflate 0.8.3 and said "Only `unzipSync` is used". ADR 0057 asked F-404 to mark `bin/*` executable, since GitHub imports lose the bit. ADR 0055 keeps `.gitkeep` files and lets paths that differ only by case coexist, with F-404 to warn about them; a file and a folder can share a prefix (`x` and `x/y`). ADR 0056 hides Export below 1024 px. The project model lives only in the engine worker (AR-30), and the workspace's `serial` queue orders every change (ADR 0045).

Research: the F-404 plan (deleted in the PR that merged F-404; settled in `docs/plan/handoff/README.md`, "F-404").

## Decision

- **Layout of the zip** (exported format). Every entry sits under one folder, `<slug>/`, as in a GitHub archive, so IO-11's rule strips exactly it on re-import, even when every file sits in one folder and the sidecar is left out. Only file entries, no folder entries (projects have no empty folders; `.gitkeep` is a file). Names carry the UTF-8 flag when not ASCII. Every entry's time is the export time; compression is fflate's default deflate level. Zips aren't byte-reproducible; their files are.
- **File contents.** Each file is the engine's stored text at one revision, encoded with `TextEncoder`, so untouched files are byte-identical to their import (stronger than IO-20's "equivalent"), a BOM round-trips as the text's own U+FEFF, and CRLF line endings stay. Pending Code-view edits are flushed first (`canvasStore.flushEdits()`), and export reads the engine, not IndexedDB, so the zip matches the screen even while saving.
- **Modes.** Entries are made on Unix (`os: 3`). Files under the project root's `bin/` and under any `resources/usr/bin/` (module binaries: "Only executable scripts in resources/usr/bin/ are made accessible to the process script", checked at https://docs.seqera.io/nextflow/modules/developing-modules) are `0755`; every other file is `0644`.
- **File name.** `<slug>.zip`, with no date. The slug is the project name with control characters and `/ \ : * ? " < > |` replaced by `-`, runs of `-` collapsed, leading and trailing dots, spaces and dashes trimmed, at most 100 characters, and `project` when empty. A slug the importer would skip or Windows reserves (`__MACOSX`, a leading dot, `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, with or without an extension, any case) gets `-project` appended, so a re-import keeps every file.
- **Where it runs** (amends ADRs 0043 and 0045's API lists and ADR 0053). `WorkspaceApi.exportProject({layout})` runs in the engine worker inside `serial`, so `listFiles()` and `readFile()` see one revision; it drops `.nf-builder/layout.json` unless `layout` is true. It returns `{ok, fileName, bytes, files, revision}`, with `bytes` transferred to the page, or a refusal (no project, or "Nothing to export."). The writer is fflate's `zipSync` in a new subpath, `@nf-builder/sources/export` (`zipProject`, `exportSlug`, `exportFileName`), loaded lazily so it stays in its own worker chunk (QA-01). ADR 0053's "Only `unzipSync` is used" now reads "`unzipSync` for import and `zipSync` for export". No new engine method and no new runtime dependency. The dependency-cruiser rule for the worker changed its comment only. `exportClashes` lives in `@nf-builder/lang-core` next to `projectPathProblem` and is re-exported from `@nf-builder/engine`.
- **Download.** The page wraps the bytes in a `Blob` of type `application/zip`, clicks a hidden `<a download>` on an object URL, and revokes the URL after 60 seconds (immediate revocation cancels downloads in some browsers). A sandboxed frame without `allow-downloads` ignores the click (ADR 0044); nothing depends on it succeeding.
- **Dialog (UX-62).** The header's Export button is enabled when a project is open and opens "Export project", which shows `<slug>.zip`, the file count (following the layout box) and the checkbox "Include the layout (.nf-builder/layout.json)", checked by default (ADR 0008), disabled with "This project has no layout yet." when there is no sidecar. It warns, and still exports, about paths that differ only by case ("These paths differ only by case and clash on macOS and Windows: …") and paths that are both a file and a folder ("<x> is both a file and a folder; some tools can't unzip both."), at most 100 of each. When the project was imported (`ProjectMeta.source` set) it notes "Files skipped when this project was imported (binary files, for example) aren't in the export." Export shows "Preparing the zip…" while running; a failure shows "Couldn't export the project: <message>" inline and keeps the dialog open; success closes it and returns focus to the header button.
- **Read-only.** Export stays hidden below 1024 px (ADR 0056), with no store guard, since export doesn't write.
- **Header Import.** Stays disabled; IO-04's Import belongs to F-406.
- **IO-21's oracle.** The CI-linted pair `tools/oracle/cases/f208-code-edit` and `f208-code-edit-after` (both `lint: ok`, joined by one `replaceFileText`) is the evidence: the end-to-end test and the workspace test export the edited project and match `f208-code-edit-after` byte for byte. ADR 0011's "edited corpus exports" check stays unbuilt; it needs a step in the `corpus-parse` workflow job and is recorded as Q17 in `docs/plan/open-questions.md`.
- **ADR 0008 confirmed.** Exporting with the layout and importing the zip in a fresh browser context gives the same sidecar bytes and the same position for every node (F-404 step 3). ADR 0008's body is unchanged; this ADR records the confirmation.

## Consequences

- A project round-trips through a zip with its files byte for byte and, with the sidecar, its layout; projects can move between browsers and to the command line.
- Re-import limits are not checked at export in v0.1: an export can hold a file over 1 MB edited in Code, more than 20,000 files, or paths on the default ignore list (such as `results/`), which a later import would skip or refuse.
- Files lost at import (binary files, symlinks, executable bits outside `bin/` and `resources/usr/bin/`) can't be restored; the dialog says so for imported projects. F-407 exports binary files once they are stored.
- F-406 reuses `zipProject` and `exportFileName`, with one folder per project in its backup.
- The exported format is now fixed for v0.1: changing the folder rule, the name rule or the modes needs a new ADR.
- No stored format, runtime dependency or package boundary changes beyond the new subpath of an existing package. `@visual` baselines that show the enabled Export button are re-approved from CI (ADR 0021).

## Alternatives

- **Flat entries with no top folder:** a project whose files all sit in one folder, exported without the sidecar, would lose that folder on re-import.
- **A date in the file name:** longer names for little gain; the browser already de-duplicates downloads.
- **Executable bits from the stored project:** import doesn't keep them (ADR 0053).
- **Folder entries, fixed timestamps or stored (uncompressed) entries:** no reader needs them, and reproducible zips weren't asked for.
- **An `EngineApi.files()` snapshot call:** `listFiles` and `readFile` inside `serial` already see one revision.
- **Exporting on the main thread:** the page has no model (AR-30), and fflate would join the main bundle.
- **Blocking export on path clashes:** the files are valid on Linux and in the project; a warning lets the user decide.
- **Building the edited-corpus lint now:** needs a workflow edit outside F-404's scope.
- **Revoking the object URL at once:** cancels the download in some browsers.
