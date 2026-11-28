# 0055. List project files in the worker and draw the tree on the main thread, create files and folders with a CreateFile command, and add files through the import stage

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-16 asks for a Files view: the project tree with new file, new folder and upload actions, a `registry` tag on registry module folders, an error badge on files that failed to parse, and dropped files or a zip added to the project. UX-10 puts it in the left column's Files tab, UX-20 holds open files in the tab strip, and UX-52 and AR-03 set the project layout.

Several earlier decisions shape it:
- ADR 0043 keeps the main thread free of the language pack, so the page can't read registry rules or parse status itself.
- ADR 0045 stores text files only, in schema v1, with no folder records.
- ADR 0039 makes edits commands with patches, and AR-21 lists them; there was no command to create a file.
- ADR 0051 says raw writes through `writeFiles` clear the undo history.
- ADR 0053 (F-403) staged zips in the worker with one set of limits, ignore rules and text checks.
- ADR 0052 (F-207) writes `.nf-builder/layout.json` outside commands.
- ADR 0054 (F-309) added code-only file tabs and `openFile`.
- ADR 0056 (F-703) removes the left column below 1024 px and refuses commands there.

A survey of the pinned corpus (sarek, rnaseq, fetchngs, rnaseq-nf) found nested vendored modules, and 12 `modules/local/` folders that hold a `meta.yml` and would match a naive registry rule. Listing every file of sarek costs about 100 kB of structured clone per pull. Diagnostics cost about 215 ms on sarek, against a parse status that is already known.

Research: the [F-210 plan](https://github.com/ewels/nf-builder/blob/ce092d7/docs/plan/handoff/plan-F-210.md).

## Decision

- **The tree model.**
  - `EngineApi.listFiles()` (amends ADR 0043's API list) returns the project's paths with their parse status and the registry module folders. The page pulls it while the Files panel is visible, after each change and layout write, and stops when the panel is hidden or the left column isn't rendered, as in read-only (ADR 0056).
  - Rows are built on the main thread by a pure engine function from the list and the session's expansion state. Files come before folders at each level, in case-insensitive natural order. A path that is both a file and a folder shows the folder only.
  - Expansion, selection and the left column's tab are session only; nothing is stored.
- **New file and new folder.**
  - A new `CreateFile` command creates an empty file, one undo step each (extends ADR 0039's command set and AR-21). Undoing it is the only deletion the Files view can produce.
  - A new folder is an empty `<folder>/.gitkeep`, listed in the tree and exported with the project. No stored-format change: schema v1 stands.
  - New names, zip entries and uploads share one path rule, `projectPathProblem`, moved from F-403's import code into `@nf-builder/lang-core`. The New file dialog shows its message inline and disables Create.
  - The dialog creates at the folder and in the session it was opened for.
- **Adding files.**
  - Uploads and drops are raw writes through the workspace's `stageFiles`, `previewAdd` and `addFiles` (amends ADR 0043's API list). They can't be undone and they clear the undo history (ADR 0051); the Add files dialog says "Adding files can't be undone, and it clears the undo history." A pending Code-view edit is flushed first.
  - Loose files take IO-12's limits: 1 MB per text file, binary files skipped and listed, and at most 20,000 files and 200 MB at a time, checked before reading. There is no ignore list, because the user chose the files.
  - A dropped or uploaded zip uses F-403's staging unchanged (IO-11, IO-12, QA-32, the ignore list editable before confirming), plus a "Keep the folder <name>/" checkbox, off by default, so a module zip dropped into `modules/local/` keeps its folder.
  - The Add files dialog is always shown and names the target folder. Existing files are replaced only after it lists them ("Add and replace"). Clashes with a folder, a path under a file, or `.nf-builder/` are skipped with their reasons.
  - The target is the selected folder, else the selected file's folder, else the root; a drop on a row targets that row's folder. Upload is disabled inside `.nf-builder/`. Dropped folders are refused with a message.
  - `addFiles` returns the full text of the added files to the page, once and transiently, so the existing change path is reused.
- **Registry tags.** A folder carries the `registry` tag when the pack's own `scriptInclude` check accepts it as a module reference, which handles nested vendoring; scope `local` is excluded. The tag is display only: read-only registry files (FI-22) are left to F-506.
- **Badges.** A file is badged from its parse status, not from diagnostics: its parse error count ("1 parse error", "3 parse errors") when it has parse problems, and a neutral "Not fully parsed" when it is verbatim or partial without problems. Badges aren't aggregated onto folders.
- **Opening files and the tab strip.**
  - A script with a workflow opens its canvas tab (the entry workflow, else the first). Anything else opens a code-only file tab through F-309's `openFile`. `.nf-builder/**` opens read-only.
  - The tablist is labelled "Open workflows and files" and holds only tabs. A closable file tab closes with Delete (`aria-keyshortcuts="Delete"`) and has a pointer-only × that is `aria-hidden`; workflow tabs stay F-307's. A deleted file's tab closes.
- **Keyboard.** The WAI-ARIA tree pattern: flat rows with level, set size and position, a roving tabindex, selection following focus, arrows, Home and End, Enter to open, and type-ahead. Type-ahead consumes letters, so G, S and C don't switch view modes while the tree has focus. Focus stays in the tree after opening.
- **Read-only (ADR 0056).** Adds are refused, including one already in flight when the window narrows; `createFile` and `createFolder` are refused through the canvas store's `apply` refusal. A document-level drop guard for file drags stays mounted in read-only, so a file dropped on the page never navigates away; it leaves the palette's drags alone.
- **Tests.**
  - `CreateFile` joins the edit property tests and the corpus edit harness, which now runs 6 fixed examples per command kind before its random runs, so every kind is tried whatever the run count; no assertion is weakened.
  - The `@smoke` test on Firefox and WebKit adds the zip through the Upload input, because Playwright's synthetic `DataTransfer` with files crashes Firefox; the drop path is tested on Chromium.
  - One `@visual` baseline, `files-view-registry-error`, approved from CI (ADR 0021).

## Consequences

- Every file the user can see in an exported project can be seen and opened in the app, and new files and folders undo like any other edit.
- Adding files still clears the history. A user who adds the wrong file can't remove it in the app until the rename, move and delete feature (F-313) lands.
- `.gitkeep` files are ordinary project files: they are exported, counted and shown.
- The Files view costs about 100 kB of clone on sarek per change while it is visible, and nothing while it is hidden (note to F-702).
- F-309, F-605 and F-601 reuse the file tabs; F-307 extends tab closing to workflow tabs; F-506 adds read-only registry files with an engine guard; F-701 audits the tree, type-ahead versus G, S and C, and `*`.
- Paths that differ only by case can both exist; F-404 warns about them on export.

## Alternatives

- **Deltas on every project change:** couples every edit to the Files view and misses layout writes.
- **Rows built in the worker:** rows depend on the page's expansion state.
- **`summary.files` from open only:** goes stale after the first edit.
- **New files through `writeFiles`:** each new file would clear the whole undo history.
- **Folder records or a `ProjectMeta.folders` field:** a stored-format change, and the field is lost on export.
- **Session-only folders:** fail step 1's "persist after reload".
- **Never stripping a zip's folder when adding to a project:** departs from F-403 and IO-11 for GitHub archives.
- **Adding one clean file without the dialog:** one less click, but a second path to test and no undo warning.
- **Reading dropped folders recursively:** extra scope; a zip covers the case.
- **Tagging the namespace folder, as mockup 4 does:** the spec tags module folders, and the spec wins.
- **Read-only registry files now:** a partial guard, since canvas tabs could still edit them.
- **Badges from diagnostics:** about 215 ms on sarek, and they cover more than "failed to parse".
- **A paths-only change type for adds:** reworks the canvas store's change handling.
- **Drag-and-drop in the cross-browser smoke test:** crashes Firefox under Playwright.
