# Plan: F-210, the Files view: project tree, new file, new folder and upload, registry tags, parse-failure badges, and adding dropped files or zips

Planner output, 2026-11-23. I changed nothing in the repository. Paths are relative to `/home/user/nf-builder` unless they are absolute.

**What I read:**
- **`origin/main`**, first at `893c900` and then at `d195424` once F-209 merged as PR #50 during this session. I read it in a scratch worktree, since removed. Files: AGENTS.md, CLAUDE.md, F-210 and related entries in `docs/plan/features.json`, `docs/spec/{ux,files,architecture,data-and-io,quality}.md`, ADRs 0034, 0039, 0043, 0045, 0048, 0049 and 0051, `docs/plan/handoff/{README,plan-F-207,plan-F-309,plan-F-403}.md`, `docs/plan/open-questions.md` (Q16), `docs/mockup/4-subworkflow.png` and the last `progress.md` entries.
- **Code on main:** `apps/web/src/{shell,canvas,views,code,engine,workspace,project,history,palette}/*`, `packages/engine/src/{service,model,edit,history}/*`, `packages/lang-core/src/{edit,source-file,includes}.ts`, `packages/lang-2610/src/includes/*`, `.dependency-cruiser.cjs`, the e2e helpers, and `tools/oracle/cases/{f205-canvas,f105-includes-resolve}` and `tools/corpus/fixtures/`.
- **`feat/F-403`** at `088d397` (`/home/user/wt-F-403`): the import core, the zip reader, worker staging (`import-stage.ts`, the `stageZip`, `restageImport` and `discardImport` workspace calls, and `createProject` with an import), and the uncommitted `zip-import.ts`.
- **`feat/F-207`** at `ea528c1` (`/home/user/wt-F-207`): the sidecar guard, `setLayout`, and how the canvas store saves layouts.
- **The pinned corpus** in `/home/user/wt-F-403/.cache/corpus/`, for the registry layout survey (1.5).

## 0. Scope

**In scope:**
- **The Files tab of the left column (UX-10):**
  - a header with the project name and three icon buttons: New file, New folder and Upload files;
  - the project tree;
  - a drop hint box ("Drop files or a .zip here to add them to the project.");
  - a status line.

  This follows mockup 4.
- **The tree model:**
  - a flat file list with parse status and registry folders, pulled from the worker by a new `EngineApi.listFiles()`;
  - rows built by a pure engine function on the main thread.
- **Registry module folders** tagged `registry` (UX-16), found in the worker with the pack's own include rules (AR-03, ADR 0034).
- **Error badges** on files that failed to parse, from parse status.
- **New file and new folder** through a new edit command, `CreateFile`, so each is one undo step (AR-20, AR-23). A new folder holds an empty `.gitkeep`.
- **Upload and drop** of loose files or one zip into a folder of the open project:
  - a zip reuses F-403's worker staging, limits, ignore list and binary skipping;
  - files are written raw, which clears the undo history (ADR 0051).
- **Opening a file from the tree:**
  - a script with a workflow opens its canvas tab;
  - anything else opens a code-only file tab (F-309 plan 2.5, defined here if F-210 lands first);
  - files under `.nf-builder/` open read-only (the F-207 note);
  - file tabs get a close button.
- **Keyboard:** the WAI-ARIA tree pattern (QA-10, UX-70).
- **Tests** (unit and e2e, one `@smoke` and one `@visual`) and **records** (an ADR, spec changes and notes).

**Out of scope:**

| What | Owner |
|---|---|
| Rename, move and delete of files and folders | No feature owns them. Open point 14 proposes a new one. |
| Registry folders opening read-only, and "Make local copy" (FI-22) | F-506 |
| Monaco language by extension, listing binary files, Markdown preview (FI-30 to FI-32) | F-605 |
| The outline of `.nf` files with no workflow (FI-31) | F-605 |
| Per-type editors (config, schema, `meta.yml`) | F-601, F-602 and the like |
| Closing workflow tabs | F-307 (F-205 note) |
| Status-bar counts while a file tab is active | F-309 hides them |
| Binary files in projects (schema v2) | the deferred M8 feature from F-403 |
| Dropping a whole folder (reading directories recursively) | open point 9 |
| Persisting tree expansion or the left column's tab | no spec row |
| Compact single-child folders and module "items", as drawn in the mockup | open point 16 |
| Export | F-404 |

## 1. Findings

### 1.1 Spec, ADRs and notes
- **UX-10:** "Segmented control switches between **Components** and **Files**."
- **UX-16:** "The Files view shows the project tree with new file, new folder and upload actions. Registry module folders carry a `registry` tag; files that failed to parse carry an error badge. Dropping files or a zip adds them."
- **UX-20:** "Tabs above the canvas hold open workflows and open files."
- **UX-52:** opening a file from the Files view uses its editor; unknown text files open in Monaco.
- **FI-22** (F-506): registry folders open read-only, with "Make local copy".
- **AR-03 and ADR 0034:** registry references resolve to `modules/<scope>/<name>/` under the project root, or under the including script's directory when that lies in a `modules/` directory. `main.nf` and `meta.yml` are both required. The rule lives in the pack (`LanguagePack.includes`).
- **AR-20 to AR-24 and ADR 0039:**
  - commands are a lang-core union;
  - `TextPatch` already has `create` and `delete`;
  - AR-21 is a minimum set, so a new command amends the list.
- **AR-30 and ADR 0048:** the stores hold no file text; Monaco models may.
- **ADR 0043:** the main thread is pack-free (only `version`). Anything that needs `pack.includes` runs in the worker. The API list has been amended by ADRs 0045, 0049 and 0051.
- **ADR 0045:**
  - schema v1 `files` holds `{projectId, path, text}`, text only;
  - there are no folder records;
  - the sidecar is an ordinary file.
- **ADR 0051 (merged):**
  - "Raw writes (`writeFiles`, `applyPatches`) … clear the history";
  - "Undoable raw writes: imports and uploads replace whole files" is a rejected alternative;
  - "F-210's raw writes clear the history".
- **F-210 notes:**
  - zip drop reuses F-403;
  - there is no file create, delete or rename command (F-111);
  - schema v1 is text only (F-202);
  - an entry file with no workflows gets no tab (F-208);
  - `writeFiles` clears the undo history (F-209).
- **F-207 (branch, not merged):**
  - `.nf-builder/layout.json` is written only by `setLayout`;
  - `apply` and `applyPatches` refuse patches that touch it;
  - `writeFiles` may write it, and that replaces the layout;
  - the plan says F-210 shows it read-only.
- **F-309 plan 2.5:**
  - `WorkflowTab.kind`, `fileTabFor(path)` (id `file:<path>`, mode `code`, label rules) and `openFile(path)`;
  - `changed()` skips file tabs, and G, S and C do nothing on them;
  - "The tablist label stays 'Workflows' (note for F-210)".
  - F-309 isn't started.
- **F-301 step 1** expects the Files view to show `modules/local/<name>/main.nf`.
- **Mockup 4** (`docs/mockup/4-subworkflow.png`):
  - Files panel header: the project name plus three icon buttons;
  - at each level, files are listed before folders;
  - the `registry` pill sits at the right of the row;
  - a dashed drop box at the bottom reads "Drop files or a .zip here to add them to the project.";
  - file tabs for `nextflow.config` and `nextflow_schema.json` in the tab strip, with a close × on the active tab.
  - The mockup tags the namespace folder (`nf-core`) and draws module folders as leaf items with compacted paths. The spec wins where they differ (open points 10 and 16).

### 1.2 Code on main (`d195424`)
- **`shell/left-column.tsx`:**
  - `LeftView` is in `useState` and isn't persisted;
  - both panels stay mounted;
  - the Files panel is `<p className="muted">No project open</p>` with `tabIndex={0}` (line 89).
- **Tests that depend on the Files panel:**
  - the F-204 e2e tests (`palette.spec.ts:139,254-259`) expect "No project open" and the tab names;
  - `left-column.test.tsx` expects the tab markup.
- **Engine service:**
  - `open()` builds `ProjectSummary.files: FileSummary[]` (`{path, language, status, problems}`, `service.ts:251`);
  - nothing on the main thread reads it;
  - the canvas store's `changed()` updates `revision`, `workflows`, `history` and `lastChange`, but never `files`.
- **`writeFiles`** (`service.ts:272`) is raw and unconditional (it takes no revision), and clears the history.
- **`ProjectModel`** keeps a private `FileTree` and exposes `paths()`. `FileTree` tolerates a file and a folder at the same path.
- **Parse status:**
  - `ParseStatus` is `modelled`, `partial`, `verbatim` or `plain`;
  - `FileSummary.problems` counts the whole-file parse problems (lint parity);
  - plain files (`json`, `yaml`, `markdown`, `text`) are never parsed.
- **Canvas store** (F-205, F-206, F-208, F-209):
  - workflow tabs only, with no close;
  - `apply(command, session?, options?)` is the single UI path for commands, with a serial queue and `history`;
  - `renamedTabs` re-points workflow tabs.
- **Code view:**
  - `CodePane` and `CodeEditor` edit through `ReplaceFileText`;
  - every model uses the Nextflow language id;
  - there is no read-only option yet. Monaco 0.57.0 has `readOnly` and `readOnlyMessage` (`monaco.d.ts:3613`).
- **Bridge:**
  - `withChangeEvents` announces `writeFiles`, `apply`, `applyPatches`, `undo` and `redo` to `onEngineChange`;
  - the workspace's `change()` records results for autosave.
- **Property and corpus tests:** `EDIT_COMMAND_KINDS` is enumerated by `packages/engine/test/edit/{harness,properties}.test.ts` and `test/corpus/edit.corpus.ts`, and each asserts every kind is accepted at least once. A new kind needs harness support.
- **F-209:** `commandLabel` (`packages/engine/src/history/labels.ts`) is an exhaustive switch.
- **Shortcuts:** G, S, C and undo use `ignoredByShortcuts`, which skips `defaultPrevented`, editable targets and dialogs.
- **Web unit tests** run in Node with `renderToStaticMarkup`; there is no jsdom. Keyboard logic must be pure to unit-test, and DOM behaviour is checked in e2e.
- **Dialogs:** native `<dialog>` through `useModal` (`project/project-dialogs.tsx`).
- **No ARIA tree exists yet.** The palette uses accordions.

### 1.3 F-403 as built so far (`/home/user/wt-F-403`)
- **`packages/sources/src/import/*`:**
  - `IMPORT_LIMITS` (1 MB per file, 20,000 entries, 200 MB total, a 200 MB archive, 30 s to unpack);
  - `entryPath` and `problemWith` path rules;
  - `DEFAULT_IGNORE` and `parseIgnore`;
  - `decodeText`;
  - `selectFiles`, `summarise` and `importProblem`;
  - `refuse(code)`, with codes `too-big`, `too-many-entries`, `too-large-uncompressed`, `not-zip`, `damaged`, `too-slow` and `gone`.
- **`readZip`** returns `ZipRead {ok, entries, stripped, candidates}`.
- **`apps/web/src/workspace/import-stage.ts`:**
  - `ImportStager {stageZip, restage, files(id, ignore), discard}`;
  - one stage at a time;
  - `sources` loads lazily.
- **Workspace calls:** `stageZip`, `restageImport` and `discardImport` sit outside the queue. `createProject` takes `import: {id, ignore}`.
- **`project/zip-import.ts`** (uncommitted) is the dialog's controller, with a 300 ms restage and newest-reply-wins.
- **`ImportSection`** isn't written yet.

### 1.4 F-207 as built so far (`/home/user/wt-F-207`)
- `setLayout` results are `LayoutChange {revision, files, layout}`. They aren't announced to `onEngineChange`, and the store's `save()` calls `engine().setLayout` directly.
- The first save on a project without a sidecar creates `.nf-builder/layout.json`, so the tree needs a signal for it (2.1).

### 1.5 Measurements and survey (pinned corpus)

| Pin | Files | Folders | `FileSummary[]` as JSON | Registry folders by the 2.4 rule |
|---|---|---|---|---|
| sarek | 885 | 296 | 104 kB | 127 |
| rnaseq | 900 | 306 | 112 kB | 75 |
| fetchngs | 159 | 48 | 18 kB | 4 |
| rnaseq-nf | 35 | 13 | 3 kB | 0 |

- **`modules/local/*` with a `meta.yml`:** fetchngs 5, rnaseq 4, sarek 3. A rule that only requires `main.nf` and `meta.yml` would tag these local modules `registry`, so the `local` scope must be excluded (2.4).
- **`subworkflows/{local,nf-core}/*`** also have `meta.yml` files, but they aren't under `modules/`, so AR-03 never resolves them as registry modules.
- **No nested vendoring in the corpus.** `tools/oracle/cases/f105-includes-resolve` has it (`modules/nf-core/sub/modules/nf-core/dep`).

## 2. Design

### 2.1 The tree model (open point 1)

```
worker (engine service)                         main thread
listFiles() ─► {revision, files: FileSummary[],  ─► filesStore (paths, statuses, registry; no text)
               registry: RegistryFolder[]}            │  expanded, selected (session only)
                                                      ▼
                                              fileTreeRows(files, registry, expanded)  (engine, pure)
                                                      ▼
                                              <FileTree/> (presentational, AR-31)
```

- **In the worker:** `EngineApi.listFiles(): Promise<ProjectFiles | EngineRefusal>`.
  - It uses the same `FileSummary` mapping as `open()`, factored into `fileSummaries(model)`.
  - It adds `registryFolders(...)` (2.4), which needs `pack.includes`, a worker-only module (ADR 0043).
  - Cost: O(files). On sarek about 100 kB to clone, and about 150 `meta.yml` probes.
  - This amends ADR 0043's API list.
- **On the main thread:** `fileTreeRows` in `packages/engine/src/files/tree.ts` is pure and pack-free, like `canvasView` (ADR 0046) and `nodeView` (ADR 0049). It builds flat visible rows with level, set size, position, tag, badge and read-only reason.
- **When the list is pulled** (`apps/web/src/files/files-store.ts`):
  1. when a project is shown (the canvas store's `session` changes with a summary);
  2. after every `onEngineChange` (apply, undo, redo, `writeFiles`, `addFiles`);
  3. after every layout write that returned files (a new `onLayoutWritten` from the engine client, which wraps `setLayout` in `withChangeEvents`; if F-207 hasn't merged, this becomes a note for F-207).

  Pulls happen only while the Files panel is visible; a change while it's hidden marks the list stale, and showing the panel pulls. At most one pull is in flight and one queued. A reply for an older request number or another session is dropped.
- **Why the store counts its own requests rather than using `revision`:** layout writes don't advance the revision (F-207).
- **The store holds** paths, languages, statuses, problem counts, registry folders, the expanded set and the selection. There is no file text (AR-30).
- **Expanded folders and the selection** are per project and per session, with no stored format. Folders that vanish are dropped from the expanded set.

### 2.2 New file and new folder (open points 2 and 3)

**The command `CreateFile {kind: "createFile"; path: string}`** in lang-core, appended to `EDIT_COMMAND_KINDS`.
- **What it does (`packages/engine/src/edit/commands/create-file.ts`):**
  - checks `newPathProblem(path, tree)` (below);
  - returns `[{kind: "create", path, text: ""}]`;
  - the inverse is `[{kind: "delete", path}]`, through the existing `patchResult`.
- AR-24's guard runs as for every command. An empty file has no problems.
- **Undo label:** `Create <path>`.
- **Why a command:** it is one undo step (AR-23), and it doesn't clear the history, as a raw write would.

**New folder** is `CreateFile` of `<folder>/.gitkeep`, applied with `{label: "Create folder <folder>"}` (F-209's `ApplyOptions`).
- An empty folder can't be stored otherwise, because schema v1 has no folder records.
- `.gitkeep` is an ordinary file: it persists, exports and is shown in the tree.

**Shared path checks** (`packages/engine/src/files/paths.ts`, used both by the command in the worker and by the dialogs on the main thread):
- `projectPathProblem(path)` moves to lang-core (open point 17). F-403's `entryPath` delegates to it, with no change in behaviour.
  - It covers: empty; leading `/`; a drive letter; control characters; empty, `.`, `..` or `__proto__` segments; more than 1,024 characters.
- `newPathProblem(path, tree)` gives:
  - the path rule;
  - "nf-builder keeps .nf-builder/ up to date itself. Choose another folder." for `.nf-builder` and anything under it;
  - "<path> already exists.";
  - "There is already a folder called <path>.";
  - "<ancestor> is a file, so it can't hold <name>.".
- `newFolderProblem(folder, tree)` is the same for a folder, after trimming a trailing `/`.
- `ProjectModel` gains a read-only getter `get tree(): ProjectTree`.

**The UI** is native modal dialogs ("New file", "New folder"):
- one "Name" field;
- help text naming the target folder: "In modules/local/. Use / to make folders on the way." or "At the top of the project.";
- a check on each keystroke against the store's paths;
- the command sent through `canvasStore.apply(command, session, options)`;
- a refusal shown inline.

**On success:**
- the store reveals and selects the new path (expanding its ancestors);
- a new file also opens (2.6);
- the status line reads "Created <path>." or "Created folder <path>.".

### 2.3 Upload and drop (open points 4 to 9)

**The target folder:**
- the selected folder;
- else the selected file's folder;
- else the project root.

A drop onto a row targets that row's folder (or a file's parent). A drop onto empty panel space targets the root. The target is shown in the dialog. Targets inside `.nf-builder/` disable Upload and refuse drops.

**What counts as a zip:** exactly one item whose name ends in `.zip` (any case), or whose type is `application/zip` or `application/x-zip-compressed`, is staged with F-403's `stageZip(blob, name)`. Anything else is staged as loose files by a new `stageFiles(files: NamedBlob[])` in the same stager, so there is one stage slot for both.

**Loose files:**
- Count and total are checked before any reading: more than 20,000 files is refused `too-many-files`, and more than 200 MB in total `files-too-large` (new `ImportRefusalCode`s with their own copy).
- Each file over 1 MB is `too-large` and isn't read.
- Every other file is read and passed to `decodeText`; null means `binary`.
- Unsafe names become `unsafe-path`, and repeated names `duplicate`.
- The ignore list isn't applied, because the user chose these files.
- The result has the `ZipRead` shape, with `stripped: null`, so `summarise` and `selectFiles` work unchanged.

**A zip** follows F-403 exactly: the 2.2 limits, `DEFAULT_IGNORE` editable in the dialog, binary files skipped, and the one-level folder strip (IO-11). A "Keep the folder <T>/" checkbox (off by default) re-prefixes the stripped folder (open point 6). This is `files(id, ignore, {keepFolder})` in the stager.

**Directory drops:**
- They are detected with `DataTransferItem.webkitGetAsEntry()?.isDirectory`.
- They are refused with: "Folders can't be dropped. Drop the files in it, or a zip of the folder."
- A null entry, as from a synthetic `DataTransfer`, counts as a file.

**The dialog**, "Add files" or "Add files from <zip>", is always shown (open point 7). It contains:
- the target ("To assets/" or "To the top of the project");
- F-403's summary ("<n> files, <size>", "Removed the top-level folder <T>/.", the skipped groups with F-403's `SKIP_LABELS`);
- for a zip only, the ignore-list textarea, which restages after 300 ms with newest-reply-wins;
- "Replaces <k> existing files" (a `<details>` list of up to 100 paths);
- "Not added (<m>)", listing each conflict and its reason (see `planAdd` below);
- the note "Adding files can't be undone, and it clears the undo history.";
- Cancel, and "Add <n> files" ("Add and replace" when any file is replaced). The button is disabled when nothing would be added or the ignore list has problems.

**`planAdd(paths, folder, tree)`** (`packages/engine/src/files/add.ts`, pure):
- prefixes the folder;
- marks a target that equals an existing file as replaced;
- marks as conflicts and skips:
  - `managed`: the source starts with `.nf-builder/`, or the target lies under `.nf-builder/`;
  - `folder`: a folder exists at the target;
  - `under-file`: an ancestor of the target is an existing file, or one added earlier in the same set.

**Workspace calls:**
- `stageFiles(files)` stays outside the queue, like `stageZip`.
- `previewAdd(choice)` stays outside the queue. It uses `stager.files` and `engine.listFiles`, and returns `AddPreview`.
- `addFiles(choice)` runs inside `change()`, so it is queued and autosaved:
  1. `stager.files`;
  2. `listFiles`;
  3. `planAdd`;
  4. `engine.writeFiles(writes)`;
  5. discard the stage;
  6. return the `ProjectChange`.

  Problems from the stager (`gone`, ignore-list problems, "Nothing to add: every file was skipped or clashes with the project.") come back as `EngineRefusal {code: "invalid"}`.
- The engine client forwards all three and announces `addFiles` to `onEngineChange`. The canvas re-projects, code panes follow, the history clears, and the files store pulls.
- **After a successful add:**
  - the dialog closes;
  - the store reveals the target folder;
  - the status line reads "Added <n> files to <folder>/." or "Added 1 file to the top of the project.".

**A document-level guard** (`useFileDropGuard`, mounted in `AppShell`) calls `preventDefault` on `dragover` and `drop` events that carry `Files` outside the Files panel, so a stray drop never opens the file in place of the app (open point 18).

### 2.4 Registry folders (open point 10)

`registryFolders(paths, includes: IncludeRules, tree): RegistryFolder[]` (`packages/engine/src/files/registry.ts`, called by the service):
1. Take each `D/meta.yml`.
2. For each `modules` segment in `D`, from the last to the first:
   - `B` is the part before that segment and `R` the part after it;
   - skip it when `R`'s first segment is `local`;
   - otherwise call `includes.scriptInclude(B === "" ? "main.nf" : `${B}/main.nf`, R, tree)`.
3. The first split whose result is `{kind: "file", path: `${D}/main.nf`, module: R}` makes `D` a registry folder with reference `R`.

This reuses the pack's `MODULE_REFERENCE`, `registryBase` (nested vendoring) and the `main.nf` plus `meta.yml` requirement exactly. `local` is our convention (CreateProcess and F-506's "Make local copy" write there), shown by 1.5.

**The tag:**
- one per module folder, as the spec says;
- the text `registry` in a pill, with title "Registry module <R>";
- display only.

Read-only enforcement is FI-22, F-506's (open point 11).

### 2.5 Parse-failure badges (open point 12)
- **When a file is "failed":** `problems > 0 || status === "partial" || status === "verbatim"`, from `FileSummary`. Only Nextflow scripts and configs are parsed.
- **What shows:** an error glyph (`aria-hidden`) plus the text "<n> parse error(s)" (visually hidden and in the title), in `--color-error`. The glyph's shape and the text mean colour isn't the only signal (QA-12).
- **Why parse status and not diagnostics:** UX-16 says "failed to parse", and parse status is cheap and per file. `diagnoser.all()` costs about 215 ms on sarek (F-309 plan 1.3). Semantic problems are F-309's panel.
- **Folders** don't aggregate badges.

### 2.6 Opening a file (open point 13)

`openTarget(path, workflows)` (`packages/engine/src/files/open.ts`, pure):
- a path with any `WorkflowRef` gives `{kind: "workflow", workflow}`, using `defaultWorkflow` restricted to that path (the entry workflow, else the first);
- anything else gives `{kind: "file"}`.

**File tabs** follow F-309 plan 2.5. F-210 defines them if it lands first, which is likely, because F-309 isn't started. Otherwise F-210 reuses them.
- `WorkflowTab.kind: "workflow" | "file"`.
- `fileTabFor(path)` gives:
  - id `file:<path>`;
  - `workflow: null`;
  - `mode: "code"`;
  - a label of the last two segments for `main.nf`, else the file name;
  - a `title` of the full path.
- `openFile(path)` adds the tab once, activates it, loads no projection and clears the selection.
- `changed()` and `load()` skip file tabs, and `renamedTabs` ignores them.
- `setMode` ignores file tabs, so G, S and C do nothing on them.
- `TabPanel` renders only the `CodePane` for a file tab, and `TabStrip` shows no view-mode toggle.

**F-210's additions to file tabs:**
- **`readOnly: ReadOnlyReason | null`** on the tab (`"managed"` for `.nf-builder/**`, from `readOnlyReason(path)`).
  - `CodeEditor` gets `readOnly`: Monaco `readOnly: true` with `readOnlyMessage`, no `TextSync` and no flush registration, and the buffer always follows the project.
  - The pane header says "Read-only: nf-builder keeps .nf-builder/ up to date itself.".
- **`closeTab(id)`** for file tabs only:
  - a "Close <label>" × button on file tabs, keyboard reachable;
  - closing the active tab activates the previous tab, else the next, else none.

  Closing workflow tabs stays F-307's.
- **`changed()` closes file tabs whose path the change deleted** (`text === null`), for example when a New file is undone.
- **The tablist** is renamed from "Workflows" to "Open workflows and files", and the two `canvas.spec.ts` selectors follow (open point 13). This is a renamed selector, not a weakened test.

Opening a file leaves focus in the tree (open point 15).

### 2.7 Rename, delete and move (open point 14)
- They are out of scope: UX-16 lists only new file, new folder and upload, and no feature or AR-21 command covers them.
- The only deletion F-210 can produce is undoing a New file or New folder.
- **Recommendation:** add a new feature (2.11 has the draft).

### 2.8 Keyboard: the WAI-ARIA tree pattern (open point 15)

**Markup:**
- `<ul role="tree" aria-label="Project files">` holding flat `<li role="treeitem">` rows;
- each row has `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`, `aria-expanded` (folders only) and `data-path` (for tests);
- roving tabindex: one row has `tabIndex=0` (the selected row, else the first);
- single selection, and selection follows focus.

**Keys** (pure `treeKey` in `apps/web/src/files/tree-keys.ts`):

| Key | Action |
|---|---|
| Down / Up | next / previous visible row, without wrapping |
| Home / End | first / last visible row |
| Right | on a closed folder, expand it; on an open folder, move to its first child; on a file, nothing |
| Left | on an open folder, collapse it; otherwise move to the parent folder |
| Enter | open a file; toggle a folder |
| Printable characters | type-ahead to the next row whose name starts with the typed text (case-insensitive, wrapping); the buffer resets after 500 ms |

- Handled keys call `preventDefault`, so `ignoredByShortcuts` makes G, S and C inert while the tree has focus. Ctrl and Meta combinations (undo and redo) pass through.

**Mouse:** a click focuses and selects the row, then opens a file or toggles a folder.

**Accessible names:** the toolbar buttons are icon buttons with `aria-label` and `title` (New file, New folder, Upload files). The panel keeps `tabIndex=0` only for the "No project open" placeholder.

**Focus after a re-pull:** if the focused path vanished, focus moves to its parent, else to the first row.

### 2.9 The Files tab today and after

**Today:** the F-201 and F-204 tab control and a hidden placeholder.

**After:**
- `LeftColumn` renders `<FilesPanel/>` in `left-panel-files`;
- it calls `filesStore.setVisible(view === "files" && !collapsed)`;
- with no project, it keeps the exact text "No project open" for F-204's test.

**The panel, top to bottom:**
1. a header with the project name (`useProjects` `current.name`, or "Unsaved project" for raw opens) and the three buttons;
2. a status line: `role="status"` for messages, `role="alert"` for refusals outside dialogs;
3. the tree, or "Loading files…", or "The files couldn't be listed (<message>).";
4. the drop hint box;
5. a hidden `<input type="file" multiple>`.

**Visual baselines:** the default app-shell baseline shows Components, so none changes. One new `@visual` baseline covers the Files panel (open point 20).

### 2.10 Copy (British English, sentence case)

| Where | Text |
|---|---|
| No project | "No project open" |
| Drop hint | "Drop files or a .zip here to add them to the project." |
| Badge | "1 parse error" / "<n> parse errors"; title "This file doesn't parse completely: <n> parse errors." |
| Tag | "registry"; title "Registry module <ref>" |
| Read-only pane | "Read-only: nf-builder keeps .nf-builder/ up to date itself." |
| Folder drop | "Folders can't be dropped. Drop the files in it, or a zip of the folder." |
| `too-many-files` | "That's more than 20,000 files. Uploads take up to 20,000 at a time." |
| `files-too-large` | "These files add up to more than 200 MB. Uploads take up to 200 MB at a time." |
| Nothing to add | "Nothing to add: every file was skipped or clashes with the project." |
| Conflict reasons | "Managed by nf-builder", "A folder has this name", "<ancestor> is a file" |
| Undo note | "Adding files can't be undone, and it clears the undo history." |

### 2.11 Proposed new feature (for open point 14)
"Files view: rename, move and delete files and folders, as edit commands (one undo step each), updating includes that point at moved files." Milestone M3, depending on F-210. Its spec needs a UX-16 clause and AR-21 entries. Adding it needs the `scope-change` label.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/paths.ts` | `PATH_MAX = 1024`; `projectPathProblem(path: string): string \| null` (F-403's rule, moved) |
| `packages/engine/src/files/types.ts` | `RegistryFolder {path; module}`; `ProjectFiles {revision: number; files: readonly FileSummary[]; registry: readonly RegistryFolder[]}`; `ReadOnlyReason = "managed"`; `FileTreeRow {path; name; kind: "folder"\|"file"; level; setSize; posInSet; parent: string\|null; expanded: boolean\|null; language: SourceLanguage\|null; registry: string\|null; problems: number; failed: boolean; readOnly: ReadOnlyReason\|null}`; `AddConflictReason = "managed"\|"folder"\|"under-file"`; `AddConflict {path; reason; ancestor?: string}`; `AddPlan {writes: readonly {from: string; to: string}[]; replaced: readonly string[]; conflicts: readonly AddConflict[]}`; `OpenTarget = {kind: "workflow"; path; workflow: string\|null} \| {kind: "file"; path; readOnly: ReadOnlyReason\|null}` (all readonly) |
| `packages/engine/src/files/paths.ts` | `MANAGED_DIR = ".nf-builder"`; `isManagedPath(path): boolean`; `readOnlyReason(path): ReadOnlyReason\|null`; `projectTreeOf(paths: Iterable<string>): ProjectTree`; `newPathProblem(path: string, tree: ProjectTree): string\|null`; `newFolderProblem(folder: string, tree: ProjectTree): string\|null`; `folderOf(path): string`; `ancestorsOf(path): readonly string[]`; `joinFolder(folder, name): string` |
| `packages/engine/src/files/tree.ts` | `compareNames(a, b): number`; `fileTreeRows(input: {files: readonly FileSummary[]; registry: readonly RegistryFolder[]; expanded: ReadonlySet<string>}): readonly FileTreeRow[]`; `folderSet(files): ReadonlySet<string>`; `failedParse(f: FileSummary): boolean` |
| `packages/engine/src/files/registry.ts` | `registryFolders(paths: readonly string[], includes: IncludeRules, tree: ProjectTree): readonly RegistryFolder[]` |
| `packages/engine/src/files/add.ts` | `planAdd(input: {paths: readonly string[]; folder: string; tree: ProjectTree}): AddPlan` |
| `packages/engine/src/files/open.ts` | `openTarget(path: string, workflows: readonly WorkflowRef[]): OpenTarget` |
| `packages/engine/src/edit/commands/create-file.ts` | `createFile(state: EditState, command: CreateFile): TextPatch[]` |
| `packages/sources/src/import/loose.ts` | `LooseEntry {name; size; bytes: Uint8Array\|null}`; `checkLooseFiles(count: number, totalBytes: number, limits?: ImportLimits): ImportRefusal\|null`; `looseCandidates(entries: readonly LooseEntry[], limits?: ImportLimits): ZipRead` |
| `apps/web/src/files/files-store.ts` | `FilesStatus = "none"\|"loading"\|"ready"\|"unavailable"`; `FilesNotice {tone: "status"\|"alert"; text}`; `FilesState {session; status; message: string\|null; files; registry; expanded: ReadonlySet<string>; selected: string\|null; notice: FilesNotice\|null; visible: boolean}`; `FilesActions {setVisible(v): void; refresh(): Promise<void>; toggle(path): void; expand(path): void; collapse(path): void; select(path: string\|null): void; reveal(path): void; open(path): Promise<void>; targetFolder(): string; createFile(name): Promise<string\|null>; createFolder(name): Promise<string\|null>; notify(n: FilesNotice\|null): void}`; `createFilesStore(deps: {engine: () => Pick<WorkspaceApi, "listFiles">; canvas: StoreApi<WorkspaceState & WorkspaceActions>; onChange: (fn: () => void) => () => void}): StoreApi<FilesState & FilesActions>`; `filesStore`; `useFiles<T>(selector): T` |
| `apps/web/src/files/tree-keys.ts` | `TypeAhead {text; at: number}`; `TreeKeyAction = {kind: "focus"\|"expand"\|"collapse"\|"open"\|"toggle"; path} \| {kind: "none"}`; `treeKey(rows: readonly FileTreeRow[], focused: string\|null, key: {key; ctrlKey; metaKey; altKey}, typeAhead: TypeAhead, now: number): {action: TreeKeyAction; typeAhead: TypeAhead}`; `TYPEAHEAD_RESET_MS = 500` |
| `apps/web/src/files/file-tree.tsx` | `FileTree(props: {rows; selected: string\|null; dropTarget: string\|null; onKey; onActivate(row); onDrag…}): JSX.Element` (presentational) |
| `apps/web/src/files/files-panel.tsx` | `FilesPanel(): JSX.Element`; `FilesPanelView(props): JSX.Element` (static-renderable) |
| `apps/web/src/files/new-path-dialog.tsx` | `NewPathDialog(props: {kind: "file"\|"folder"; folder: string; check(name): string\|null; onSubmit(name): Promise<string\|null>; onClose(): void}): JSX.Element` |
| `apps/web/src/files/drop.ts` | `isFileDrag(types: readonly string[]): boolean`; `DropKind = {kind: "zip"; file: File} \| {kind: "files"; files: readonly File[]} \| {kind: "folder"} \| {kind: "none"}`; `dropKind(files: readonly File[], entries: readonly ({isDirectory: boolean} \| null)[]): DropKind`; `useFileDropGuard(): void` |
| `apps/web/src/files/add-files.ts` | `AddFilesState = {status: "idle"} \| {status: "reading"; name} \| {status: "ready"; name; zip: boolean; preview: AddPreview; ignore: string; keepFolder: boolean; updating: boolean; adding: boolean} \| {status: "refused"; name; message}`; `AddFilesView {state; start(kind: DropKind, folder: string): void; setIgnore(text): void; setKeepFolder(v): void; confirm(): Promise<boolean>; cancel(): void}`; `createAddFiles(deps: {workspace(): Pick<WorkspaceApi, "stageZip"\|"stageFiles"\|"previewAdd"\|"addFiles"\|"discardImport">; session(): number; onChange(s): void; onAdded(folder: string, count: number): void; timer?: Timer; debounceMs?: number}): AddFilesView` |
| `apps/web/src/files/add-files-dialog.tsx` | `AddFilesDialog(props: {view: AddFilesView; onClose(): void}): JSX.Element` (reuses F-403's summary view and `SKIP_LABELS`) |
| `apps/web/src/files/files.css` | tree, tag, badge, drop-target and hint styles (the badge uses `--color-error`, QA-13) |
| `e2e/files.ts` | `filesTab(page)`; `filesPanel(page)`; `treeRow(page, path): Locator` (`[data-path=…]`); `expandPath(page, path)`; `visiblePaths(page): Promise<string[]>`; `createInFiles(page, kind: "file"\|"folder", name)`; `uploadFiles(page, files: {name; mimeType; buffer}[])`; `dropFiles(page, target: Locator, files)` (builds a `DataTransfer` with `page.evaluateHandle` and dispatches `dragenter`, `dragover` and `drop`); `confirmAdd(page)`; `F210_BROKEN` (`tools/corpus/fixtures/bad-declaration.nf`) |
| Test files | `packages/lang-core/test/paths.test.ts`; `packages/sources/test/import/loose.test.ts`; `packages/engine/test/files/{paths,tree,registry,add,open}.test.ts`; `packages/engine/test/edit/create-file.test.ts`; `packages/engine/test/service/files.test.ts`; `apps/web/test/{files-store,tree-keys,files-panel,new-path-dialog,add-files,add-files-dialog,drop,tab-strip-files}.test.ts(x)`; `e2e/files.spec.ts` |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`:** `CreateFile {kind: "createFile"; path: string}` (doc: "Create an empty file (UX-16); a new folder is its `.gitkeep`"); add it to `EditCommand` and `EDIT_COMMAND_KINDS`.
- **`packages/lang-core/src/index.ts`:** export `paths.ts` and `CreateFile`.
- **`packages/sources/src/import/paths.ts`:** `problemWith` calls `projectPathProblem`. F-403's tests stay unchanged.
- **`packages/sources/src/import/{types,messages}.ts`:** `ImportRefusalCode` adds `too-many-files` and `files-too-large`, with their copy.
- **`packages/sources/src/index.ts`:** export `loose.ts`.
- **`packages/engine/src/edit/apply.ts`:** the `createFile` case in `build`.
- **`packages/engine/src/history/labels.ts`:** `case "createFile": return \`Create ${command.path}\``.
- **`packages/engine/src/model/project.ts`:** `get tree(): ProjectTree`.
- **`packages/engine/src/service/types.ts`:**
  - `EngineApi.listFiles(): Promise<ProjectFiles | EngineRefusal>`;
  - re-export `ProjectFiles` and `RegistryFolder`.
- **`packages/engine/src/service/service.ts`:**
  - `fileSummaries(model)`, shared with `open()`;
  - `listFiles` through `guarded`, with `registryFolders(model.paths(), pack.includes, model.tree)`.
- **`packages/engine/src/index.ts`:** export the `files/` functions and types.
- **`packages/engine/test/edit/harness.ts`:** a `createFile` case (a fresh path from `c.name`, lower-cased, with `.nf`, `.config`, `.md` or `/.gitkeep` from `c.snippet`), so the property and corpus checks accept it at least once.
- **`apps/web/src/workspace/types.ts`:**
  - `NamedBlob {blob: Blob; name: string}`;
  - `AddChoice {id; ignore; keepFolder: boolean; folder: string}`;
  - `AddPreview {ok: true; id; summary: ImportSummary; folder; adds: number; replaced: readonly string[]; replacedCount: number; conflicts: readonly AddConflict[]; conflictCount: number}`;
  - `AddPreviewResult = AddPreview | ImportRefusal | EngineRefusal`;
  - `WorkspaceApi` gains `stageFiles(files: readonly NamedBlob[]): Promise<ImportStageResult>`, `previewAdd(choice: AddChoice): Promise<AddPreviewResult>` and `addFiles(choice: AddChoice): Promise<ProjectChange | EngineRefusal>`.
- **`apps/web/src/workspace/import-stage.ts`:**
  - `ImportStager.stageFiles(files)`;
  - `files(id, ignore, options?: {keepFolder?: boolean})`;
  - `SourcesModule` adds `checkLooseFiles` and `looseCandidates`.
- **`apps/web/src/workspace/workspace.ts`:**
  - `listFiles` passes through;
  - `stageFiles` and `previewAdd` sit outside the queue;
  - `addFiles` goes through `change()`.
- **`apps/web/src/engine/engine-client.ts`:**
  - forward `listFiles`, `stageFiles`, `previewAdd` and `addFiles`;
  - `withChangeEvents` announces `addFiles`;
  - `onLayoutWritten(listener: (paths: readonly string[]) => void)`, fired by a `setLayout` wrapper when `files` isn't empty (only once F-207 has merged).
- **`apps/web/src/canvas/canvas-store.ts`:**
  - file tabs (2.6): `WorkflowTab.kind` and `readOnly`, `fileTabFor`, `openFile`, `closeTab`;
  - `changed()`, `load()`, `setMode()` and `renamedTabs` handling;
  - closing file tabs on delete.
- **`apps/web/src/views/tab-panel.tsx`:** a file tab renders the `CodePane` only, with `readOnly`.
- **`apps/web/src/shell/tab-strip.tsx`:** file tabs carry a title and close button; no toggle for file tabs; the tablist is renamed.
- **`apps/web/src/code/{code-pane,code-editor}.tsx`:** the `readOnly` prop.
- **`apps/web/src/shell/left-column.tsx`:** render `FilesPanel` and call `setVisible`.
- **`apps/web/src/shell/icons.tsx`:** the new-file, new-folder, upload, folder-chevron, file-kind, error and close glyphs (inline SVG).
- **`apps/web/src/app-shell.tsx`:** `useFileDropGuard()`.
- **`apps/web/src/styles.css`:** import `files.css` if the pattern needs it.
- **`e2e/canvas.spec.ts`:** the tablist name in two selectors (lines 53 and 539).
- **`e2e/engine.ts`:** `EngineHook.listFiles`.
- **Unchanged:**
  - dependencies (no runtime or dev additions);
  - dependency-cruiser (lang-core imports nothing; sources and engine import lang-core; web imports engine and sources);
  - workflows;
  - the IndexedDB schema;
  - generated files;
  - the AGENTS.md command table;
  - existing baselines.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`lang-core/test/paths.test.ts`** | |
| `F-210 UX-16 QA-32: projectPathProblem accepts relative POSIX paths and names the problem for an empty path, a leading slash, a drive letter, control characters, empty, ., .. and __proto__ segments and paths over 1,024 characters` | exact problem strings, matching F-403's |
| **`sources/test/import/loose.test.ts`** | |
| `F-210 UX-16 IO-12: looseCandidates keeps text files, marks files over 1 MB too-large without bytes, NUL or invalid UTF-8 as binary, unsafe names unsafe-path and repeated names duplicate` | |
| `F-210 UX-16 IO-12 QA-32: checkLooseFiles refuses more than 20,000 files and more than 200 MB in total with the upload messages` | copy from 2.10 |
| (existing) `sources/test/import/paths.test.ts` | unchanged and green after the move |
| **`engine/test/edit/create-file.test.ts`** | |
| `F-210 UX-16 AR-20: createFile creates an empty file with one create patch whose inverse deletes it` | |
| `F-210 AR-23: applying createFile's inverse restores the exact previous files` | byte equality of every file |
| `F-210 UX-16: createFile refuses an existing file, an existing folder, a path under a file, an unsafe path and anything under .nf-builder/, each with its message` | code `invalid`, messages from 2.2 |
| `F-210 AR-24: empty .nf and .config files parse without problems, so createFile is accepted for them` | |
| (existing) `engine/test/edit/properties.test.ts` and `test/corpus/edit.corpus.ts` | `createFile` accepted at least once on the start trees and each pin |
| (extend) `engine/test/history/labels.test.ts`: `F-210 AR-23: createFile is labelled "Create <path>"` | |
| **`engine/test/files/registry.test.ts`** | |
| `F-210 UX-16 AR-03: a modules/<scope>/<name>/ folder with main.nf and meta.yml is a registry folder with its reference, including multi-segment names` | `modules/nf-core/bwa/mem` gives `nf-core/bwa/mem` |
| `F-210 UX-16 AR-03 ADR-0034: a module vendored under another module's modules/ folder is found with the innermost reference` | `f105-includes-resolve`: `top`, `sub` and `sub/modules/nf-core/dep` (`nf-core/dep`) |
| `F-210 UX-16: modules/local/ folders, folders missing main.nf or meta.yml, references the pack rejects, modules/b and subworkflows/ folders are not registry folders` | |
| `F-210 UX-16: the f205-canvas fixture has exactly one registry folder, modules/nf-core/wordcount` | |
| **`engine/test/files/tree.test.ts`** | |
| `F-210 UX-16: rows list files before folders at each level, each by case-insensitive natural name order, with aria levels, set sizes and positions` | |
| `F-210 UX-16: a collapsed folder hides its descendants and an expanded one shows its children; parents are set` | |
| `F-210 UX-16: a registry folder row carries its reference, a file that failed to parse carries failed and its problem count, plain files never fail` | `partial`, `verbatim` and `modelled` with problems |
| `F-210 UX-16 ADR-0045: a folder that holds only .gitkeep is listed with its .gitkeep; .nf-builder/ rows are read-only` | |
| **`engine/test/files/paths.test.ts`**: `F-210 UX-16: newPathProblem and newFolderProblem give the dialog's messages; a trailing slash is trimmed for folders and refused for files` | |
| **`engine/test/files/add.test.ts`**: `F-210 UX-16: planAdd prefixes the folder, lists replaced files, and skips managed, folder and under-file clashes, including clashes inside the added set` | |
| **`engine/test/files/open.test.ts`**: `F-210 UX-20 UX-52: a script with an entry workflow opens it, one with only named workflows opens the first, anything else opens as a file, and .nf-builder/ files open read-only` | |
| **`engine/test/service/files.test.ts`** | |
| `F-210 UX-16: listFiles gives each file's language, parse status and problem count, sorted, and the registry folders, at the current revision` | |
| `F-210 UX-16: after writeFiles adds meta.yml beside a main.nf, listFiles lists the registry folder; after a syntax error is written, that file fails` | |
| `F-210 AR-23 ADR-0051: createFile is one undo step that undo removes; writeFiles clears the history` | |
| `F-210 ADR-0003: listFiles survives structuredClone` | |
| **`apps/web/test/import-stage.test.ts`** (new describe) | |
| `F-210 UX-16 IO-12: stageFiles stages text files, skips binary files and files over 1 MB without reading them, and refuses too many files or too much in total before reading` | fake `Blob`s whose `arrayBuffer` throws when too large |
| `F-210 IO-11: files(id, ignore, {keepFolder: true}) puts the stripped folder back on every path` | |
| **`apps/web/test/workspace.test.ts`** (new describe) | |
| `F-210 UX-16 IO-01: addFiles writes the selected files under the target folder, records them for autosave and discards the stage` | `fake-indexeddb` records after flush |
| `F-210 ADR-0051: addFiles clears the undo history` | `history().undoCount === 0` |
| `F-210 UX-16: previewAdd lists replaced files and conflicts; addFiles replaces existing files and skips conflicts and .nf-builder/ entries` | |
| `F-210 UX-16: addFiles refuses a gone stage, ignore-list problems and nothing to add, writing nothing` | |
| **`apps/web/test/engine-client.test.ts`**: `F-210 ADR-0003: listFiles, stageFiles (with Blobs and names), previewAdd and addFiles cross the bridge; addFiles is announced to onEngineChange` (plus `onLayoutWritten` once F-207 has merged) | Node `MessageChannel` |
| **`apps/web/test/canvas-store.test.ts`** (new describe) | |
| `F-210 UX-20: openFile adds one code-only tab per path; activating it loads no projection and clears the selection` | |
| `F-210 UX-20: a change with a file tab active re-projects nothing; setMode leaves a file tab in Code` | |
| `F-210 UX-20: closeTab closes a file tab and activates its neighbour; a change that deletes a file closes its tab` | |
| `F-210 IO-02: a .nf-builder/ file tab is read-only` | |
| **`apps/web/test/tab-strip-files.test.tsx`**: `F-210 UX-20 QA-10: a file tab has its path as title and a "Close <label>" button, no view-mode toggle, and the tablist is "Open workflows and files"` | static markup |
| **`apps/web/test/files-store.test.ts`** | |
| `F-210 UX-16: showing a project pulls once; a change while visible pulls again, coalesced to one queued pull; a change while hidden pulls when the panel is shown` | fake engine with deferred replies |
| `F-210 UX-16: a reply for an older request or another session is dropped` | |
| `F-210 UX-16: expand, collapse, select and reveal; folders that vanish leave the expanded set; the target folder follows the selection` | |
| `F-210 UX-16 UX-52: open dispatches to openWorkflow or openFile by openTarget` | |
| `F-210 AR-30: the store never holds file text` | no `text` key in the state after pulls |
| `F-210 AR-23 UX-16: createFile and createFolder send createFile through canvas apply with the session, label a folder "Create folder <path>", and return a refusal message` | |
| **`apps/web/test/tree-keys.test.ts`** | |
| `F-210 UX-70 QA-10: Down, Up, Home and End move through visible rows without wrapping` | |
| `F-210 UX-70: Right expands a closed folder, then moves to its first child; Left collapses an open folder, then moves to its parent` | |
| `F-210 UX-70: Enter opens a file and toggles a folder; Ctrl and Meta combinations are not handled` | |
| `F-210 UX-70: typing moves to the next row starting with the typed text, wrapping, and the buffer resets after 500 ms` | |
| **`apps/web/test/files-panel.test.tsx`** | |
| `F-210 UX-10 UX-16: with no project the Files panel says "No project open"; with one it shows the project name, New file, New folder and Upload files buttons, the tree and the drop hint` | |
| `F-210 UX-16 QA-10: role tree labelled "Project files"; treeitems with aria-level, aria-setsize, aria-posinset and aria-selected, aria-expanded on folders only; exactly one row with tabindex 0` | |
| `F-210 UX-16 QA-12: a registry folder shows the text registry titled with its module; a failed file shows the error glyph and the text "1 parse error"` | |
| **`apps/web/test/new-path-dialog.test.tsx`**: `F-210 UX-16: the dialogs name the target folder and show the check's message inline` | |
| **`apps/web/test/drop.test.ts`**: `F-210 UX-16: isFileDrag needs Files; dropKind gives zip for one .zip, files otherwise, folder when any entry is a directory, none for nothing` | |
| **`apps/web/test/add-files.test.ts`** | |
| `F-210 UX-16 IO-11: a zip is staged with stageZip and other files with stageFiles; the preview follows` | |
| `F-210 UX-16 IO-12: an ignore-list or keep-folder change previews again after 300 ms; an older reply never replaces a newer one` | |
| `F-210 UX-16: confirm sends the choice and reports the count and folder; cancel discards the stage; a refusal shows its message` | |
| **`apps/web/test/add-files-dialog.test.tsx`**: `F-210 UX-16 IO-12 UX-61: the dialog shows the target, files and size, the removed folder with its Keep checkbox, skipped groups, replaced files, conflicts, the ignore list for zips only, the undo note and the Add button's count` | static markup |
| **`e2e/files.spec.ts`** | |
| `F-210 step 1 UX-16 IO-01 QA-30: a file and a folder created from the Files view, an uploaded file and a dropped zip appear in the tree and persist after reload` | Chromium. Blank project in the UI → Files tab → New file `notes.txt` → New folder `assets` → select `assets`, Upload `samplesheet.csv` → drop a zip (`extra-main/modules/local/extra/main.nf`, `extra-main/docs/usage.md`, built with fflate) on the tree's empty space → confirm. After "Saved", reload, open Files, expand: `notes.txt`, `assets/.gitkeep`, `assets/samplesheet.csv`, `modules/local/extra/main.nf` and `docs/usage.md` are rows. `readStoredDatabase` holds them with their exact text. No CSP violation or console error. |
| `F-210 step 2 UX-16 QA-12: a registry module folder shows the registry tag and a file with a syntax error shows an error badge` | `f205-canvas` plus `broken.nf` (`bad-declaration.nf`) through the hook. `modules/nf-core/wordcount` has the tag ("Registry module nf-core/wordcount"); `modules/local/greet` has none. `broken.nf` has the badge; `main.nf` has none. Writing a syntax error into `main.nf` through the hook adds its badge, and restoring removes it. |
| `F-210 UX-16 QA-20: dropping a small zip and uploading a file add them to the tree @smoke` | all browsers |
| `F-210 AR-23 ADR-0051: New file and New folder are one undo step each; adding files clears the undo history` | the Undo button's title and disabled state (F-209 helpers) |
| `F-210 UX-70 QA-10: the tree works by keyboard (arrows, Right and Left, Home and End, Enter, type-ahead) and the three actions are reachable with Tab` | |
| `F-210 UX-20 UX-52 IO-02: a script with a workflow opens its canvas tab, README.md opens a code-only tab with a close button, and .nf-builder/layout.json opens read-only` | without F-207, the sidecar is written through the hook's `writeFiles` |
| `F-210 UX-16 IO-12 QA-32: a dropped zip with more than 20,000 entries is refused with F-403's message and nothing is written` | |
| `F-210 UX-16: dropping a folder is refused with a message, and a file dropped on the canvas doesn't navigate away` | `page.url()` unchanged |
| `F-210 UX-16 @visual: the Files view with a registry folder and a failed file matches its baseline` | left column clip, `files-view-registry-error` (ADR 0021) |

## 5. Tasks (branch `feat/F-210`, one builder run each)

Export `PW_CHROMIUM_EXECUTABLE` before any e2e command.

0. **Orchestrator:**
   - settle section 6;
   - start once F-403 has merged (it is in `depends_on`);
   - branch from `main` in a new worktree (`/home/user/wt-F-210`);
   - note whether F-207 and F-309 have merged, which decides tasks 4 and 5;
   - run `pnpm corpus:fetch` and `pnpm corpus:lint` for task 2.
1. **Shared path rule:** `lang-core/src/paths.ts` and its export; `sources/src/import/paths.ts` delegates; the lang-core test.
   - Done when these pass: `pnpm --filter @nf-builder/lang-core test`, `pnpm --filter @nf-builder/sources test` and `pnpm check`.
2. **The `CreateFile` command:**
   - the lang-core type and kind list;
   - `create-file.ts` and the `build` case;
   - `engine/src/files/paths.ts` (needed by the command);
   - `ProjectModel.tree`;
   - the label;
   - the harness case;
   - `create-file.test.ts` and `paths.test.ts`.
   - Done when these pass: `pnpm --filter @nf-builder/engine test`, `pnpm check` and `pnpm test:corpus` (`createFile` accepted on every pin).
3. **Engine files module and `listFiles`:** `files/{types,tree,registry,add,open}.ts`, the service's `listFiles` and `fileSummaries`, the exports and their tests.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
4. **Staging and workspace:**
   - `sources/src/import/loose.ts`, the new codes and copy, and its test;
   - the stager's `stageFiles` and `keepFolder`;
   - the workspace's `listFiles`, `stageFiles`, `previewAdd` and `addFiles`;
   - forwarding and announcing in the engine client, plus `onLayoutWritten` if F-207 has merged;
   - the web tests.
   - Done when these pass: `pnpm --filter @nf-builder/sources test`, `pnpm --filter @nf-builder/web test` and `pnpm check`.
5. **File tabs:**
   - if F-309 hasn't merged, the F-309 plan 2.5 design;
   - in any case `readOnly`, `closeTab`, closing tabs on delete, the tablist name, `TabPanel`, `TabStrip`, `CodePane` and `CodeEditor` read-only;
   - the `canvas.spec.ts` selectors;
   - the tests.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-205|F-208|F-209"`.
6. **The Files tree, read only:**
   - `files-store.ts`, `tree-keys.ts`, `file-tree.tsx`, the tree part of `files-panel.tsx` and `files.css`;
   - the `LeftColumn` wiring;
   - the glyphs;
   - the tests.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts` (report the QA-01 change) and `pnpm test:e2e -- --grep "F-201|F-204"`.
7. **The actions:**
   - `new-path-dialog.tsx`, the Upload input, `drop.ts` (with the guard), `add-files.ts` and `add-files-dialog.tsx`;
   - the panel's header and drop hint;
   - the tests.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts` and `pnpm test:e2e -- --grep "F-403"`.
8. **End to end:** `e2e/files.ts` and `e2e/files.spec.ts`, plus `EngineHook.listFiles`.
   - Done when these pass: `pnpm test:e2e -- --grep F-210`, `pnpm test:e2e -- --grep "F-201|F-202|F-204|F-205|F-207|F-208|F-209|F-403"` and `pnpm smoke` (under 60 s; record the time).
   - The `@visual` baseline comes from CI (ADR 0021).
9. **Records** (section 7).
   - Done when `pnpm check` passes.
10. **Orchestrator:**
    - open the PR (with `scope-change` if open point 14 adds a feature);
    - get CI green on `CI`, `Deploy check` and `Scope guard`;
    - approve the `files-view-registry-error` baseline from the `playwright-chromium` artefact;
    - run the reviewer, then the simplifier.

## 6. Open points (each with a recommendation; none decided here)

1. **Where the tree model lives.**
   - **Recommend:** a worker-pulled flat list (`EngineApi.listFiles`) and rows built on the main thread by a pure engine function (2.1). Pull only while the panel is visible, after each change or layout write. This amends ADR 0043's API list: decide and record.
   - **Alternatives:**
     - deltas on every `ProjectChange`: couples every edit to the Files view and misses `setLayout`;
     - rows built in the worker: rows depend on UI expansion state;
     - `summary.files` from open only: goes stale.
2. **New file and new folder: commands or raw writes?**
   - **Recommend:** a new `CreateFile` command, one undo step each. It amends AR-21's list and ADR 0039's command set. Cost: a harness case, and `pnpm test:corpus` must accept it on every pin.
   - **Alternative:** `writeFiles`, as the F-209 note assumed. It clears the whole undo history on every new file (ADR 0051).
3. **Empty folders.**
   - **Recommend:** an empty `<folder>/.gitkeep`, shown in the tree. No format change: ADR 0045's schema stays v1, and git keeps it on export.
   - **Alternatives:**
     - folder records: an IndexedDB schema v2, a stored-format change;
     - a `ProjectMeta.folders` field: also a stored-format change, and lost on export;
     - session-only folders: fail step 1's "persist after reload".
4. **Adding files.**
   - **Recommend:** raw writes through `addFiles`. They can't be undone and they clear the history, as ADR 0051 decided. The dialog says so ("Adding files can't be undone, and it clears the undo history.").
5. **Rules for loose files.**
   - **Recommend:**
     - IO-12's per-file limit and binary skipping;
     - the 20,000-file and 200 MB totals checked before reading, with their own copy (`too-many-files`, `files-too-large`);
     - no ignore list, because the user chose the files.
   - Amend IO-12 to say adds to a project take the same limits.
6. **A dropped zip.**
   - **Recommend:** F-403's staging unchanged (IO-11, IO-12, QA-32, with the ignore list editable before confirming), plus a "Keep the folder <T>/" checkbox, off by default. Dropping `mymodule.zip` into `modules/local/` otherwise loses `mymodule/`.
   - **Alternative:** never strip when adding to a project. This departs from F-403 and IO-11 for GitHub archives.
7. **Conflicts and confirmation.**
   - **Recommend:**
     - always show the Add dialog;
     - replace existing files only after it lists them ("Add and replace");
     - skip folder, under-file and `.nf-builder/` clashes, with reasons.
   - **Alternative:** add one clean file straight away. One less click, but a second path to test.
8. **Target folder.**
   - **Recommend:** the selected folder, else the selected file's folder, else the root. A drop onto a row targets that row's folder, and a drop onto empty space the root. Upload is disabled inside `.nf-builder/`.
9. **Dropping a folder.**
   - **Recommend:** refuse it with a message. Reading directories recursively (`webkitGetAsEntry`) is extra scope; a zip covers the case.
10. **Registry folder rule.**
    - **Recommend:** the pack's own `scriptInclude` check (2.4), which handles nested vendoring, with scope `local` excluded (1.5: 12 local modules with `meta.yml` in three pins). The tag goes on each module folder, as the spec says.
    - **Alternative:** tag the namespace folder (`nf-core`), as mockup 4 does. Where the two differ, the spec wins (`docs/mockup/README.md`).
11. **Read-only registry files (FI-22).**
    - **Recommend:** leave to F-506. The tag is display only. Note for F-506: reuse the file tab's `readOnly` reason and add an engine guard.
    - **Alternative:** make registry files read-only in file tabs now. That is a partial guard, because workflow canvas tabs could still edit them.
12. **Badges.**
    - **Recommend:** from parse status (`problems > 0`, `partial` or `verbatim`), not from diagnostics, which cost about 215 ms on sarek and cover more than "failed to parse". No aggregation onto folders.
13. **Opening files, and the tab strip.**
    - **Recommend:**
      - a script with a workflow opens its canvas tab (entry, else first);
      - anything else opens a code-only file tab, defined here from F-309 plan 2.5 if F-210 lands first (likely);
      - `.nf-builder/**` opens read-only;
      - file tabs get a close button (workflow tabs stay F-307's);
      - a deleted file's tab closes;
      - rename the tablist to "Open workflows and files", updating two e2e selectors.
    - Amend UX-20 to say files without a workflow open in a code-only tab.
14. **Rename, move and delete.**
    - **Recommend:** out of F-210. Add the feature drafted in 2.11 (M3, depends on F-210) with `scope-change`. Otherwise a wrongly uploaded file can only be removed by an export round trip.
15. **Keyboard.**
    - **Recommend:**
      - the 2.8 tree: flat rows with explicit level, set size and position, roving tabindex, selection following focus, Enter to open;
      - type-ahead, which consumes letters, so G, S and C don't fire while the tree has focus;
      - focus stays in the tree after opening.
    - Notes for F-701: audit the tree; decide on `*` (expand siblings) and on moving focus to the editor.
16. **Order and presentation.**
    - **Recommend:**
      - files before folders at each level, in case-insensitive natural order (mockup 4);
      - a glyph per language;
      - the project name in the panel header;
      - the drop hint box;
      - no compact single-child folders and no module "items", which complicate keyboard, drop targets and `aria-level`. Possible later.
17. **One path rule.**
    - **Recommend:** move F-403's `problemWith` into lang-core as `projectPathProblem`, so zips, uploads and new names share it. No boundary change.
18. **The document drop guard.**
    - **Recommend:** yes, for file drags only. It never touches F-301's palette drags.
19. **State lifetime.**
    - **Recommend:** expansion, selection and the left column tab are session only. No stored format.
20. **Visual baseline.**
    - **Recommend:** one `@visual` baseline of the Files panel with the tag and the badge, approved from CI.
21. **Landing order with F-207.**
    - **Recommend:** if F-207 has merged, F-210 adds `onLayoutWritten`. If not, put it in F-207's notes, and F-210's tree catches the sidecar at the next change.
22. **`addFiles` returns full text to the page, as `writeFiles` already does** (at most IO-12's 200 MB, once, transiently).
    - **Recommend:** accept, for one change path and `onEngineChange` unchanged. Note it for F-702.
    - **Alternative:** a paths-only change type. That reworks the canvas store's `changed()`.

**Decide-and-record items (AGENTS.md):**
- **New runtime dependency:** none.
- **Package boundaries or dependency-cruiser rules:** none.
- **Stored or exported format:** none. `.gitkeep` is an ordinary file, and schema v1 is unchanged.
- **Workflows:** none.
- **`features.json`:** the new feature (14) with `scope-change`, plus notes.
- **ADR interplay:**
  - amends ADR 0043's API list (`listFiles`, and the workspace's `stageFiles`, `previewAdd` and `addFiles`);
  - extends ADR 0039's command set (`CreateFile`);
  - consistent with ADR 0051.
- **Spec behaviour:** UX-16, AR-21, UX-20 (if F-210 defines file tabs) and IO-12.
- **Open questions:** none.

## 7. Records (drafts for the orchestrator)

**ADR**, `Accepted (agent)`, at the next free number (0052 unless F-207 or F-403 takes it first). Title: "Files view: a worker-listed tree drawn on the main thread, CreateFile for new files and folders, and adds through the import stage".
- **Context:**
  - UX-10, UX-16, UX-20 and UX-52;
  - AR-03 and ADR 0034;
  - ADR 0043's pack-free main thread;
  - ADR 0045's text-only schema;
  - ADR 0051's raw-write rule;
  - F-403's staging;
  - the F-207 sidecar;
  - F-309 plan 2.5;
  - mockup 4;
  - the 1.5 survey.
- **Decision:** sections 2.1 to 2.9 and points 1 to 22 as settled.
- **Consequences:**
  - `CreateFile` joins the property and corpus checks;
  - adds clear the history;
  - `.gitkeep` files are exported;
  - registry read-only stays with F-506;
  - F-309 reuses the file tabs;
  - adds return text transiently;
  - the QA-01 delta;
  - type-ahead versus G, S and C.
- **Alternatives:** those listed in section 6.

Add it to `docs/adr/README.md`.

**Spec:**
- **`ux.md` UX-16** (add): "The tree lists files before folders. A new folder holds an empty `.gitkeep`. New files and folders are commands, one undo step each. Added files can't be undone and clear the undo history (ADR 0051). One dropped or uploaded zip is imported as in IO-11 and IO-12, with the ignore list editable before confirming; other files are added as text files up to 1 MB, binary files skipped. Registry module folders are found by the pack's include rules, `modules/local/` excepted. A file has failed to parse when it has parse problems. `.nf-builder/` is read-only (ADR NNNN)."
- **`ux.md` UX-20** (if F-210 defines file tabs): "Files without a workflow open in a code-only tab with a close button (ADR NNNN)."
- **`architecture.md` AR-21:** add `CreateFile`.
- **`data-and-io.md` IO-12** (add): "Files added to an open project (UX-16) take the same limits: at most 20,000 files and 200 MB at a time."

**`features.json` notes:**
- **F-210:** "Verified …: step 1 by `e2e/files.spec.ts` (create, folder, upload, zip drop, reload, IndexedDB records) and the workspace tests; step 2 by `e2e/files.spec.ts` (`f205-canvas` and `bad-declaration.nf`), the registry and tree tests and the `files-view-registry-error` baseline (ADR NNNN)."
- **F-301:** the Files view pulls after each change; `modules/local/<name>/` shows once expanded; use `filesStore.reveal(path)` if step 1 needs it visible.
- **F-309:** file tabs, `openFile` and `closeTab` exist; the tablist is "Open workflows and files".
- **F-307:** `closeTab` exists for file tabs; extend it to workflow tabs.
- **F-506:** registry folders come from `listFiles().registry`; add `readOnly: "registry"` to file tabs and an engine guard (FI-22).
- **F-605:** file tabs use the Nextflow language for every file; detect by extension (FI-32); binary files never reach the tree until schema v2.
- **F-404:** `.gitkeep` files are part of the project; warn about paths that differ only by case.
- **F-701:** audit the tree (type-ahead versus G, S and C, `*`, focus after open) and the drop hint.
- **F-702:** `listFiles` costs about 100 kB of clone on sarek per change while the panel is visible; `addFiles` returns full text.
- **F-207** (if it hasn't merged): announce layout writes with files through `onLayoutWritten`.

**Other records:**
- **`progress.md` Decisions:** the ADR, `listFiles`, `CreateFile`, `.gitkeep`, adds clearing the history, the registry rule with `local` excluded, the badge rule, file tabs, the tablist rename, the new feature if added, and the baseline.
- **`docs/plan/handoff/README.md`:** an F-210 row; delete this plan in the PR that merges F-210.

## 8. Evidence
- **Spec:**
  - `docs/spec/ux.md`: UX-10 (row 18), UX-16 (24), UX-20 (30) and UX-52 (66);
  - `docs/spec/files.md`: FI-22 and FI-31 to FI-32;
  - `docs/spec/architecture.md`: AR-03 (25), AR-21 (44), AR-23, AR-24, AR-30 and AR-31;
  - `docs/spec/quality.md`: QA-01, QA-10 to QA-13 and QA-20.
- **ADRs:**
  - `0051-undo-and-redo.md`, lines 27 and 47 (raw writes clear the history; F-210);
  - `0045` (schema v1, text only);
  - `0043` (pack-free main thread);
  - `0039` (commands and patches);
  - `0034` (registry resolution);
  - `0048` (Monaco, the AR-30 reading).
- **Code on main `d195424`:**
  - `apps/web/src/shell/left-column.tsx:65,89`;
  - `apps/web/src/canvas/canvas-store.ts:152` (`renamedTabs`), `427-453` (`changed`) and `472-484`;
  - `packages/engine/src/service/service.ts:251` (`FileSummary` mapping), `272` (`writeFiles`) and `312`;
  - `packages/engine/src/service/types.ts` (`FileSummary`, `ProjectSummary.files`);
  - `apps/web/src/workspace/workspace.ts:101,138`;
  - `apps/web/src/engine/engine-client.ts:64-67`;
  - `packages/lang-core/src/edit.ts` (`TextPatch` create and delete, `EDIT_COMMAND_KINDS`);
  - `packages/lang-2610/src/includes/resolve.ts` (`MODULE_REFERENCE`, `registryBase`, `meta.yml` required);
  - `packages/engine/test/edit/{harness,properties}.test.ts` and `test/corpus/edit.corpus.ts` (every kind accepted);
  - `apps/web/src/views/view-mode.ts` (`ignoredByShortcuts`);
  - `e2e/palette.spec.ts:139,254-259` and `e2e/canvas.spec.ts:53,539`.
- **Branches:**
  - `/home/user/wt-F-403` at `088d397`: `packages/sources/src/import/*`, `src/zip/read-zip.ts`, `apps/web/src/workspace/{import-stage,types,workspace}.ts` and `apps/web/src/project/zip-import.ts`;
  - `/home/user/wt-F-207` at `ea528c1`: `apps/web/src/canvas/canvas-store.ts:325-370` (`save` calls `setLayout` directly) and the `packages/engine/src/service/types.ts` diff.
- **Plans:** `docs/plan/handoff/plan-F-309.md` 2.5 and points 5 and 8; `plan-F-403.md` 2.1 to 2.10 and 7; `plan-F-207.md` (lines 39, 178-181 and 416).
- **Mockup:** `docs/mockup/4-subworkflow.png` (Files panel header, file order, registry pill, drop box, file tabs).
- **Monaco 0.57.0:** `readOnlyMessage?: IMarkdownString` at `monaco.d.ts:3613` (in `/home/user/wt-F-207/node_modules/.pnpm/monaco-editor@0.57.0/`).
- **Corpus survey:** a Python walk of `/home/user/wt-F-403/.cache/corpus/{sarek,rnaseq,fetchngs,rnaseq-nf}`, applying the 2.4 rule with `MODULE_REFERENCE`. Results are in 1.5; the JSON sizes assume one `FileSummary` per file.
- **Fixtures:**
  - `tools/oracle/cases/f205-canvas/modules/nf-core/wordcount/{main.nf,meta.yml}`;
  - `tools/oracle/cases/f105-includes-resolve/modules/nf-core/{top,sub,sub/modules/nf-core/dep}`;
  - `tools/oracle/cases/f105-includes-missing/modules/b/meta.yml` (not a valid reference);
  - `tools/corpus/fixtures/bad-declaration.nf` (malformed on purpose, `lint: error` recorded in `fixtures.yaml`).
