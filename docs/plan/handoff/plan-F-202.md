# Plan: F-202, projects in IndexedDB with autosave, save state in the header, persistent storage and a quota warning

Planner output, 2026-11-22. I changed nothing in the repo. `/home/user/wt-main` is clean on `main` at `d2d3d6a`; `git pull` and `pnpm install` were no-ops.

## 0. Scope

**F-202 adds:**
- **IndexedDB storage for projects.** A hand-written wrapper with schema v1 and migrations. It runs inside the F-113 engine worker.
- **A worker-side "workspace".** It wraps F-113's `EngineApi` and adds project create, open (switch), rename and delete, plus autosave:
  - saves start 500 ms after each change (`apply`, `applyPatches`, `writeFiles`);
  - the workspace pushes a status (project list, current project, open progress, save state) to the main thread.
- **On the main thread:**
  - a Zustand store that mirrors that status;
  - the `persist()` request and the `estimate()` check (IO-03, warning at 80%);
  - the header: a working project switcher, the save state ("Nothing to save", "Saved", "Saving…", "Save failed") and a storage warning;
  - dialogs for New project (name only, blank), Rename and Delete;
  - "Opening *name*: n of m files" in the canvas area (QA-03, F-113 point 9).
- **Two small additions to F-113's engine service:** `readFile(path)` and `close()`.
- **E2E tests** for steps 1 to 3, switching, deleting, persistence and the stored format.
- **Re-approving the app-shell baseline** (the switcher becomes enabled).

**Out of scope:**
- The UX-60 New project dialog, the content of Start blank, and templates. These are F-203's; F-202's blank project has **no files**.
- Editing UI. Content edits come from F-208 and F-210; until then, step 1 edits through the `window.nfBuilderEngine` hook.
- Export and backup (F-404, F-406), the import source record (IO-13), remembered tokens (IO-15), and coordination between tabs.

## 1. Findings

### 1.1 Spec and ADRs
- **IO-01:** projects persist in IndexedDB; "autosave runs 500 ms after each applied command"; the header shows saved, saving or failed.
- **IO-03:** "requests persistent storage on first save and **warns at 80%** of quota". Step 3's 85% is the value the test simulates, not the threshold, so the tests check 85% and 80% (warning) and 79% (none).
- **ADR 0002:**
  - "Projects live in IndexedDB **(via Dexie)**: projects, files, settings";
  - autosave at 500 ms, persist on first save, 80%;
  - "Clearing site data deletes projects; the UI says so".
  - **Not using Dexie amends this Accepted ADR**, so it has to be decided and recorded.
- **ADR 0003:** no package fits storage.
  - The engine has no DOM, runs in a worker, and F-113 keeps its service pure and testable in Node.
  - `sources` holds "GitHub, zip and registry clients".
  - So storage goes in `apps/web`, with **no boundary change**.
- **AR-30:** "Project content lives only in the engine and IndexedDB". The architecture diagram shows `files (IndexedDB) ──► engine worker`.
- **ADR 0004, ADR 0008, IO-02:** files are authoritative text, and the layout sidecar `.nf-builder/layout.json` is an ordinary project file, stored like any other.
- **ADR 0014:**
  - `form-action 'none'`, so dialogs must never submit natively (call `preventDefault` in `onSubmit`);
  - no inline styles;
  - `worker-src 'self'`.
- **ADR 0021:** layout stays in localStorage because it hydrates synchronously; projects go in IndexedDB. Visual baselines come only from CI artefacts.
- **ADR 0029 and QA-03:** show loading progress. F-113 point 9 hands this to F-202 and asks it to queue the palette request before the open and to consider reading IndexedDB in the worker.
- **UX-01:** the header holds the project switcher and the save state. UX-60 (the full New project dialog) is F-203's.
- **LA-01:** every project has a `languageVersion`. **LA-02 and LA-03:** templates and defaults come from the pack, so Start blank's files belong to F-203 and its oracle case.

### 1.2 Code facts
- **Header (`apps/web/src/shell/app-header.tsx`):**
  - a disabled `No project` button with `aria-haspopup="menu"`;
  - a static `<p class="save-state" role="status">Nothing to save</p>`.
- **Tests that depend on the header:**
  - the e2e test `F-201 UX-01` (`e2e/app-shell-layout.spec.ts:132`) asserts that "No project" is **disabled**, so it must change;
  - the unit test (`apps/web/test/app-shell.test.tsx:34-35`) checks only the texts and stays valid;
  - the F-204 e2e test expects "No project open" in the Files tab, which is unchanged in a fresh context.
- **Visual baseline:** `e2e/__screenshots__/app-shell-layout.spec.ts/app-shell-default-chromium-linux.png` is a fresh context, so there are no projects. An enabled switcher changes its colours (`.header-button:disabled`), so the baseline has to be re-approved.
- **Existing stores** are Zustand vanilla stores with injectable dependencies (`createLayoutStore(getStorage)`). Nothing starts at import time.
- **Web unit tests** run in Node with `renderToStaticMarkup`: no DOM, no IndexedDB, no `Worker`. Nothing in the repo provides a fake IndexedDB.
- **`ProjectModel.file(path)?.source.text`** holds the current text, so `readFile` is a one-liner in the service.
- **F-111 `ReplaceFileText`:** "the path must exist"; plain files skip the parse guard. Editing `README.md` therefore needs no Nextflow syntax.
- **F-113:**
  - the service is a serial queue;
  - `ProjectModel`'s constructor parses every file synchronously, so a palette request queued after an `open` waits for the whole parse (sarek about 15 s);
  - the palette must be *issued* before the open.
- **Browser platform:**
  - the Storage spec exposes `persist()` on `Window` only; `estimate()` and `persisted()` also work in workers;
  - Playwright's `addInitScript` runs in pages, not workers. So `persist()` and `estimate()` must run on the main thread, which also lets tests stub them.
- **Packages (measured from the npm tarball):**
  - Dexie 4.4.7: 96.3 kB minified, 30.8 kB gzipped;
  - idb 8.0.4: ISC;
  - fake-indexeddb 6.2.8: Apache-2.0, no dependencies, ESM entry `fake-indexeddb/auto`.

### 1.3 Not verified
I tried to run a fake-indexeddb probe in the scratchpad, and the sandbox refused to execute the downloaded package. It would have checked:
- the compound-key range `IDBKeyRange.bound([id], [id, []])`;
- abort atomicity;
- `versionchange` and `VersionError`.

These points come from the IndexedDB spec. Task 2's tests assert them.

### 1.4 Unbuilt names this plan relies on (rebase on F-113 as built before task 1)

| From | Name | Used for |
|---|---|---|
| F-113 engine `src/service/` | `EngineApi` (`palette`, `open`, `writeFiles`, `apply`, `applyPatches`, `project`, `diagnostics`), `createEngineService()`, `OpenRequest`, `LoadProgress`, `LoadPhase`, `ProjectSummary`, `FileSummary`, `ProjectChange` (its `files: FileText[]` and `revision`), `Applied`, `ApplyOutcome`, `EngineRefusal`, `EngineRefusalCode` (`no-project`, `stale`); the serial queue; the progress callback on `open` | the workspace, autosave, progress |
| F-113 apps/web `src/engine/` | `exposeEngine(api, endpoint)`, `connectEngine(endpoint)`, `getEngine()`, `engine.worker.ts`, the `window.nfBuilderEngine` getter in `main.tsx`, `usePaletteView` calling `getEngine().palette` | the bridge, widened to the workspace |
| F-113 `e2e/engine.ts` | `EngineHook` (optional; F-202 defines its own `WorkspaceHook`) | e2e |
| F-111 lang-core | `FileText { path; text: string \| null }`, `EditCommand` (`ReplaceFileText`) | autosave input, step 1 edit |
| Comlink (F-113 dependency) | `proxy`, `releaseProxy` | the `watch` listener |

## 2. Design

### 2.1 Where things live

| Piece | Place | Why |
|---|---|---|
| IndexedDB wrapper, autosaver, workspace | `apps/web/src/workspace/`, imported only by the worker entry | Every change to files already happens in the worker. Saving there means no edit path can skip autosave (the hook, and later F-205, F-207, F-208 and F-210), and the main thread never clones file text (AR-30; F-113 measured a 364 ms gap posting sarek). |
| `persist()`, `estimate()` | `apps/web/src/project/storage-health.ts` (main thread) | `persist()` is Window-only, and init scripts can stub it. |
| Store and UI | `apps/web/src/project/`, `shell/` | |
| `readFile`, `close` | engine service (pure) | Tested in Node; F-208 needs `readFile` too. |

There is no package or dependency-cruiser change.

### 2.2 IndexedDB schema v1 (a persisted format, ADR)
- **Database:** `nf-builder`, version `1`.
- **Stores:**
  - **`projects`**, keyPath `id`: `{ id: string (crypto.randomUUID), name: string, languageVersion: string, createdAt: number, updatedAt: number, openedAt: number }`. Times are milliseconds since the epoch.
    - `updatedAt` changes on every save and rename.
    - `openedAt` changes on every open; the most recent one is reopened after a reload.
  - **`files`**, keyPath `["projectId", "path"]`: `{ projectId, path, text: string }`.
    - The path is relative POSIX, as the engine uses it. Text only.
    - A project's files are read and deleted with `IDBKeyRange.bound([id], [id, []])`.
- **No settings store yet.** A later feature adds one with a version bump.
- **Migrations:**
  - `MIGRATIONS[v]` runs in `onupgradeneeded` for each `v` from `oldVersion + 1` up to the current version;
  - a shipped step is never edited;
  - a database at a newer version (`VersionError`) gives `StorageVersionError` ("This browser has projects from a newer nf-builder. Reload to update.") and nothing is written;
  - `onversionchange` closes the connection and marks storage unavailable ("nf-builder was updated in another tab. Reload this page.").
- **Writes:** one `readwrite` transaction each for create, delete and each autosave. An autosave covers every dirty file plus each touched project's `updatedAt`, so it is all or nothing.

### 2.3 Workspace (in the worker; no Comlink, so it runs in Node)
- **Shape:** `WorkspaceApi extends EngineApi`.
- **One workspace queue** serialises `createProject`, `openProject`, `renameProject`, `deleteProject`, `flush`, the raw `open`, and the change methods (`apply`, `applyPatches`, `writeFiles`). The project id that a change is saved under is therefore always the project the engine applied it to. `palette`, `project`, `diagnostics` and `readFile` pass straight through.
- **Autosave:**
  - after an `ok` change, `autosaver.record(currentId, result.files)`;
  - trailing debounce of 500 ms, with no maximum wait;
  - one write for everything pending; the latest text per path wins; a `null` text deletes;
  - changes recorded during a write go into the next write;
  - a failed write keeps its changes, reports `failed` with the message, and retries on the next change or `flush`;
  - **state `saving` lasts from the first change until the write commits**, so Playwright can see it for at least 500 ms;
  - `discard(projectId)` runs on delete.
- **`openProject(id)`:**
  1. flush;
  2. read the record and files;
  3. push `opening`, with each `LoadProgress` from `engine.open` as it arrives;
  4. set `openedAt`;
  5. push `current`.
  - On failure: `engine.close()`, `current = null`, `openError`, reject.
- **Raw `open(request)`** (F-113's tests and bench): flush, then open an **unsaved** project (`current = null`). Its changes are not recorded.
- **`deleteProject`:** if the project is open, `discard`, then `engine.close()`, then delete the records.
- **`createProject`:**
  - checks the name (trimmed, 1 to 100 characters; duplicates allowed);
  - checks the version against `installedPackVersions()`;
  - stores the record and files without opening them.
- **Status:** `watch(listener)` keeps a single listener and replaces any earlier one. It resolves with the status once the database has opened (`storage: "ready" | "unavailable"`). The status is pushed on every change: project ops, progress events and save-state changes.

### 2.4 Main thread
- **`startProjects()`**, called once from `main.tsx`:
  1. `await requestPaletteView(version).catch(noop)`. This is a shared memo that `usePaletteView` also uses, so the palette sits ahead of the reopen in the serial queue.
  2. `watch(set)`.
  3. If nothing is open and projects exist, `openProject(projects[0].id)`.
- **`pagehide`:** `getEngine().flush()`, best effort.
- **IO-03:**
  - `requestPersistence()` runs after the first successful write in this page load: a create, or the first push of `saved` after `saving`;
  - it runs at most once per page load, only when `persisted()` is false, and is never awaited;
  - `storageUsage()` runs at start, after create, after delete and after each `saved` push; it warns when `usage / quota ≥ 0.8`.
- **Header:**
  - **Switcher:** a disclosure button (`aria-expanded`, `aria-controls`) labelled with the project name or "No project", with a chevron. Its panel:
    - lists the projects as buttons, most recently opened first, with the open one marked `aria-current="true"`;
    - then "New project…", "Rename project…" and "Delete project…"; Rename and Delete are disabled with no project open and act on the open project;
    - Escape closes it, as does a click outside.
  - **Save-state text:** "Nothing to save" with no project, otherwise "Saved", "Saving…" or "Save failed" (`title` holds the error).
  - **Storage warning:** a chip with `role="alert"` reading "Storage 85% full", with the whole percentage.
- **Dialogs** use native `<dialog>` and `showModal()`:
  - **New project:** a name field (default "Untitled project"), "Create" and "Cancel", and the sentence "Projects are stored in this browser only." Create calls `createProject({name, languageVersion: languageVersions[0], files: []})` and then `openProject`.
  - **Rename project:** the name field, "Rename" and "Cancel".
  - **Delete project:** "Delete “X”? Its files are removed from this browser and can't be recovered.", with "Delete" and "Cancel". Cancel is focused.
  - An error shows inline, and the dialog stays open.
- **Canvas area**, in order of precedence:
  1. storage unavailable: "Projects can't be stored in this browser: …";
  2. opening: "Opening X: k of n files" with `<progress>` (`role="status"`);
  3. open error: "Couldn't open X: …";
  4. a project open: "No workflow open" (F-205 replaces this);
  5. otherwise "No project open" (unchanged, so the baseline keeps it).

### 2.5 The edit in step 1
There is no UI that edits content until F-208 and F-210. The step 1 test does two things:
- renames through the UI, the one real UI edit;
- edits a file through `window.nfBuilderEngine`, now the workspace: `writeFiles([{path: "README.md", text: "one\n"}])`, then `apply({kind: "ReplaceFileText", path: "README.md", text: "two\n"}, revision)`. These are the same calls the Code view and the Files view will make.

After the reload, the switcher shows the new name and `readFile("README.md")` returns `"two\n"`. A rename alone wouldn't exercise autosave (IO-01's "after each applied command").

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `apps/web/src/workspace/types.ts` | `ProjectMeta { id; name; languageVersion; createdAt; updatedAt; openedAt }`; `NewProject { name; languageVersion; files: readonly ProjectFile[] }`; `FileChange { projectId; path; text: string \| null }`; `type SaveStatus = "saved" \| "saving" \| "failed"`; `SaveState { status; error: string \| null }`; `OpeningState { project: ProjectMeta; progress: LoadProgress \| null }`; `WorkspaceStatus { storage: "starting" \| "ready" \| "unavailable"; storageError: string \| null; projects: readonly ProjectMeta[]; current: ProjectMeta \| null; opening: OpeningState \| null; openError: { project: ProjectMeta; message: string } \| null; save: SaveState }`; `interface WorkspaceApi extends EngineApi { watch(listener: (s: WorkspaceStatus) => void): Promise<WorkspaceStatus>; createProject(input: NewProject): Promise<ProjectMeta>; openProject(id: string): Promise<ProjectSummary>; renameProject(id: string, name: string): Promise<ProjectMeta>; deleteProject(id: string): Promise<void>; flush(): Promise<SaveState> }`. All fields readonly. |
| `apps/web/src/workspace/project-name.ts` | `PROJECT_NAME_MAX = 100`; `DEFAULT_PROJECT_NAME = "Untitled project"`; `normaliseProjectName(name: string): string \| null` |
| `apps/web/src/workspace/project-db.ts` | `DB_NAME = "nf-builder"`; `DB_VERSION = 1`; `class StorageVersionError extends Error`; `interface ProjectDb { listProjects(): Promise<ProjectMeta[]>; readProject(id): Promise<{ project: ProjectMeta; files: ProjectFile[] } \| null>; createProject(meta: ProjectMeta, files: readonly ProjectFile[]): Promise<void>; renameProject(id, name, now: number): Promise<ProjectMeta \| null>; touchProject(id, now): Promise<ProjectMeta \| null>; deleteProject(id): Promise<void>; saveFiles(changes: readonly FileChange[], now: number): Promise<void>; close(): void }`; `openProjectDb(factory?: IDBFactory, onClosed?: (reason: string) => void): Promise<ProjectDb>` |
| `apps/web/src/workspace/autosave.ts` | `AUTOSAVE_DELAY_MS = 500`; `interface Timer { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }`; `interface AutosaverOptions { delayMs?; write(changes: readonly FileChange[]): Promise<void>; onState(s: SaveState): void; timer?: Timer }`; `interface Autosaver { record(projectId: string, files: readonly FileText[]): void; flush(): Promise<SaveState>; discard(projectId: string): void; state(): SaveState }`; `createAutosaver(o): Autosaver` |
| `apps/web/src/workspace/workspace.ts` | `interface WorkspaceOptions { engine: EngineApi; openDb: () => Promise<ProjectDb>; now?: () => number; newId?: () => string; timer?: Timer; delayMs?: number }`; `createWorkspace(o): WorkspaceApi` |
| `apps/web/src/project/storage-health.ts` | `QUOTA_WARNING_FRACTION = 0.8`; `StorageUsage { usage; quota; fraction }`; `storageUsage(s: StorageManager \| undefined): Promise<StorageUsage \| null>`; `nearQuota(u: StorageUsage \| null): boolean`; `requestPersistence(s: StorageManager \| undefined): Promise<boolean \| null>` (once per page load); `resetPersistenceRequest(): void` (tests); `storageWarningText(u): string` |
| `apps/web/src/project/project-store.ts` | `ProjectUiState { status: WorkspaceStatus; storageWarning: StorageUsage \| null }`; `ProjectActions { start(): Promise<void>; create(name): Promise<void>; open(id): Promise<void>; rename(id, name): Promise<void>; remove(id): Promise<void> }`; `ProjectStoreDeps { workspace: () => WorkspaceApi; palette: (v: string) => Promise<unknown>; storage: () => StorageManager \| undefined; languageVersion: string \| undefined }`; `INITIAL_STATUS`; `createProjectStore(deps): StoreApi<ProjectUiState & ProjectActions>`; `useProjects<T>(selector): T`; `startProjects(): void` |
| `apps/web/src/project/project-status.tsx` | `saveLabel(hasProject: boolean, save: SaveState): string`; `formatOpening(name: string, p: LoadProgress \| null): string`; `StorageWarning({ usage })`; `CanvasPlaceholder({ status })` |
| `apps/web/src/project/project-switcher.tsx` | `ProjectSwitcherProps { projects; current; onOpen(id); onNew(); onRename(); onDelete(); initiallyOpen?: boolean }`; `ProjectSwitcher(p)` |
| `apps/web/src/project/project-dialogs.tsx` | `ProjectNameDialog({ mode: "create" \| "rename"; initialName; onSubmit(name): Promise<void>; onClose() })`; `DeleteProjectDialog({ project; onConfirm(): Promise<void>; onClose() })` |
| `apps/web/src/project/project-controls.tsx` | `ProjectControls()`: the connected switcher plus whichever dialog is open |
| `e2e/projects.ts` | `WorkspaceHook` (the subset the tests call); `switcher(page)`; `saveState(page)`; `createProjectInUi(page, name)`; `editReadme(page, before, after): Promise<number>` (`performance.now()` before `apply`); `recordSaveStates(page)` (a `MutationObserver` log of `{text, at}`); `stubStorage(page, { fraction, persisted })` (`addInitScript` overriding `navigator.storage.estimate`, `persisted` and `persist`; counts `window.__persistCalls`; reads `window.__usageFraction` on each call); `readStoredDatabase(page)` (raw `indexedDB.open("nf-builder")` from the page, every record, then close) |
| `e2e/projects.spec.ts` | section 4 |
| `apps/web/test/{project-db,autosave,workspace,storage-health,project-store,project-ui}.test.ts(x)` | section 4 |

### 3.2 Change
- **`packages/engine/src/service/` (F-113):**
  - `EngineApi.readFile(path: string): Promise<string | null>`, giving `null` with no project or no such file;
  - `EngineApi.close(): Promise<void>`, after which calls answer `no-project`;
  - both are queued.
- **`apps/web/src/engine/expose.ts`, `engine-client.ts`, `engine.worker.ts` (F-113):**
  - keep the names, and the API type becomes `WorkspaceApi`;
  - `expose` releases the previous `watch` listener proxy when a new one replaces it;
  - the client wraps the `watch` listener in `proxy()`;
  - the worker runs `exposeEngine(createWorkspace({ engine: createEngineService(), openDb: () => openProjectDb(indexedDB) }), self)`;
  - `Window.nfBuilderEngine?: WorkspaceApi`.
- **`apps/web/src/palette/use-palette-view.ts`:** `export function requestPaletteView(version): Promise<PaletteView>`. It sends one request per version and forgets a rejected one; `usePaletteView` uses it.
- **`apps/web/src/shell/app-header.tsx`:** props `{ languageVersions; projectControls: ReactNode; saveLabel: string; storageWarning: StorageUsage | null }`. The static button and static text go.
- **`apps/web/src/app-shell.tsx`:** reads `useProjects` and renders `CanvasPlaceholder`.
- **`apps/web/src/main.tsx`:** `startProjects()`, and the `pagehide` flush.
- **`apps/web/src/styles.css`:** switcher panel, dialog, warning chip and failed save state.
- **`apps/web/package.json`:** dev dependency `"fake-indexeddb": "6.2.8"`.
- **`e2e/app-shell-layout.spec.ts`:**
  - test `F-201 UX-01`: "No project" is now enabled with `aria-expanded="false"`; Templates, Import and Export stay disabled. This is a behaviour change, not a weaker test; say so in the PR.
  - visual test: also wait until the switcher is enabled.
- **Baseline:** `e2e/__screenshots__/app-shell-layout.spec.ts/app-shell-default-chromium-linux.png`, re-approved from CI (task 8).
- **Not changed:** dependency-cruiser, `LanguagePack`, generated files, workflows, root scripts.

## 4. Tests (written before the implementation; Node tests use `import "fake-indexeddb/auto"` and a fresh `new IDBFactory()` per test)

| File: test | Asserts |
|---|---|
| **engine `test/service/service.test.ts`** | |
| `F-202 IO-01: readFile returns the current text after writeFiles and apply, and null for a missing path or with no project` | |
| `F-202: close drops the open project; later calls answer no-project` | |
| **`project-db.test.ts`** | |
| `F-202 ADR-0002 IO-01: version 1 creates the projects store keyed by id and the files store keyed by [projectId, path], and nothing else` | store names, keyPaths |
| `F-202 IO-01 LA-01: createProject stores the record and its files in one transaction` | every field |
| `F-202 IO-01: readProject returns only that project's files` | project ids `a` and `ab`; paths with U+FFFF, an astral character, nested directories |
| `F-202 IO-01: saveFiles writes puts and deletes across projects and bumps updatedAt, all or nothing` | an invalid change aborts the transaction; nothing is written |
| `F-202 UX-01: renameProject changes only name and updatedAt; deleteProject removes the record and every file` | |
| `F-202: listProjects orders by openedAt, most recent first; touchProject updates it` | |
| `F-202 ADR-0002: a database at a newer version is refused with StorageVersionError` | |
| `F-202 ADR-0002: a versionchange from another connection closes this one and reports it` | |
| **`autosave.test.ts`** (manual `Timer`) | |
| `F-202 IO-01: a change is written 500 ms after the last applied change, never earlier` | |
| `F-202 IO-01: changes within 500 ms are coalesced into one write; the latest text per path wins; deletes are null` | |
| `F-202 step 2 IO-01: the state is saving from the first change until the write commits, then saved` | |
| `F-202 IO-01: a failed write reports failed with its message, keeps the changes and retries them with the next change or flush` | |
| `F-202 IO-01: a change recorded during a write goes into the next write and the state stays saving` | |
| `F-202: flush writes at once; discard drops a project's pending changes` | |
| **`workspace.test.ts`** (fake IndexedDB plus the real `createEngineService`) | |
| `F-202 step 1 IO-01: create, open, write and edit README.md, save; a new workspace on the same database reopens the project with the edit` | the reload, simulated |
| `F-202 step 2 IO-01: watch pushes saving after an applied command and saved after the write` | |
| `F-202 IO-01: writeFiles, apply and applyPatches are autosaved; a refused command saves nothing` | |
| `F-202 QA-03 ADR-0029: openProject pushes opening progress, then the current project` | |
| `F-202 UX-01: switching flushes the previous project's pending changes first and sets openedAt` | |
| `F-202 UX-01: rename and delete update the pushed list; deleting the open project closes it and drops its pending changes` | |
| `F-202: a raw open is unsaved: its changes are not stored and no project is current` | |
| `F-202 IO-14: a failed open reports openError and leaves no project open; the next open works` | |
| `F-202 ADR-0002: when the database can't open, status is unavailable with the reason and project calls reject` | |
| `F-202 ADR-0003: every status and result survives structuredClone` | |
| **`engine-client.test.ts`** (F-113's file, over a Node `MessageChannel`) | |
| `F-202 ADR-0003: watch receives status pushes across Comlink; a second watch releases the first listener` | |
| `F-202 ADR-0028: requestPaletteView sends one request per version and forgets a rejected one` | |
| **`storage-health.test.ts`** | |
| `F-202 step 3 IO-03: usage at 85% and at 80% of quota warns; 79% doesn't` | |
| `F-202 IO-03: no estimate API, a zero quota or a rejected estimate gives no warning` | |
| `F-202 IO-03: persistence is requested once per page load and only when not persisted; unsupported is a no-op` | |
| `F-202 IO-03: the warning reads "Storage 85% full"` | |
| **`project-store.test.ts`** (fake `WorkspaceApi`) | |
| `F-202 QA-03 ADR-0029: start requests the palette before reopening the most recently opened project` | call order |
| `F-202 IO-01: the store mirrors pushed workspace status` | |
| `F-202 UX-01 LA-01: create stores a project with no files in the first installed version, then opens it` | |
| `F-202 IO-03: create requests persistence and checks the quota; each saved push and each delete checks it again` | |
| **`project-ui.test.tsx`** (`renderToStaticMarkup`) | |
| `F-202 IO-01 UX-01: the save state reads Nothing to save without a project, then Saved, Saving… or Save failed` | |
| `F-202 UX-01: the switcher shows the open project's name or No project and controls the project panel` | |
| `F-202 UX-01: the panel lists projects with the open one current, then New, Rename and Delete; Rename and Delete are disabled with no project` | |
| `F-202 ADR-0002: the New project dialog says projects are stored in this browser only` | |
| `F-202 QA-03: the canvas area shows "Opening X: 3 of 17 files" with a progress bar` | |
| `F-202 step 3 IO-03: the header shows the storage warning only at or above 80%` | |
| **E2E `e2e/projects.spec.ts`** (`--grep F-202`) | |
| `F-202 step 1 IO-01 LA-01 QA-30: create a project, rename it, edit a file, reload: the project reopens with its new name and the edit` | `@smoke`, so it also runs on Firefox and WebKit; no CSP violation or console error |
| `F-202 step 2 IO-01: after an edit the header shows Saving… and then Saved, no sooner than 500 ms after the command` | `recordSaveStates` log order; `tSaved − t0 ≥ 500` |
| `F-202 step 3 IO-03: a simulated quota at 85% shows the storage warning` | `stubStorage({fraction: 0.85})` |
| `F-202 step 3 IO-03: at 79% no warning shows; after a save that takes usage to 85% it appears` | |
| `F-202 IO-03: persistent storage is requested once, after the first save, and not when already persisted` | `__persistCalls` |
| `F-202 UX-01 UX-70: switch between two projects with the keyboard; each keeps its own files` | |
| `F-202 UX-01: Cancel keeps a project; Delete removes it and it stays gone after reload` | |
| `F-202 ADR-0002 IO-01: the stored records match the recorded IndexedDB format` | `readStoredDatabase` |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-202` after F-113 merges. In every task, write the tests first and watch them fail. Local e2e runs need `export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.

1. **Engine `readFile` and `close`.**
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/service` and `pnpm check` pass.
2. **IndexedDB layer:** `pnpm --filter @nf-builder/web add -D fake-indexeddb@6.2.8`, `types.ts`, `project-name.ts`, `project-db.ts`.
   - Done when `pnpm --filter @nf-builder/web exec vitest run test/project-db.test.ts`, `pnpm audit --audit-level high` and `pnpm check` pass.
3. **Autosaver.**
   - Done when `pnpm --filter @nf-builder/web exec vitest run test/autosave.test.ts` and `pnpm check` pass.
4. **Workspace.**
   - Done when `pnpm --filter @nf-builder/web exec vitest run test/workspace.test.ts` and `pnpm check` pass.
5. **Bridge:** the worker entry, `expose` and the client widened, the `watch` proxy, `requestPaletteView`.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts` and `pnpm test:e2e -- --grep "F-113|F-204"` pass.
6. **Main-thread store and storage health.**
   - Done when `pnpm --filter @nf-builder/web exec vitest run test/project-store.test.ts test/storage-health.test.ts` and `pnpm check` pass.
7. **UI and e2e.**
   - Write `e2e/projects.ts` and `projects.spec.ts` first.
   - Then: the header switcher and panel, the dialogs, the save state, the warning, `CanvasPlaceholder`, `main.tsx` start and `pagehide`, the styles, `project-ui.test.tsx`, and the F-201 UX-01 e2e update.
   - Done when these pass:
     - `pnpm check`;
     - `pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-202|F-201|F-002|F-113|F-204"`;
     - `pnpm smoke` (under 60 s).
8. **CI and the baseline** (orchestrator).
   - Push the branch. The Chromium `@visual` test fails on the changed header.
   - Download `playwright-chromium`, view `app-shell-default-actual.png`, and commit it at the baseline path (ADR 0021).
   - Done when every job of `CI` and `Scope guard` is green, including Firefox and WebKit smoke.
9. **Records** (section 7).
   - Done when `pnpm check` passes and the Scope guard passes without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **No IndexedDB library** (decide and record; it amends ADR 0002's "via Dexie").
   - **Recommendation:** a hand-written wrapper, about 120 lines, with `req` and `done` promise helpers.
   - Dexie costs 30.8 kB gzipped for features we don't use. idb is small, but the helpers it saves are about 20 lines.
   - Record it the way ADR 0035 amended ADR 0003: the new ADR says it amends one clause of ADR 0002, and ADR 0002's body is not edited.
2. **IndexedDB schema v1, migrations, newer-version and versionchange handling** (2.2; a persisted format, decide and record).
   - **Recommendation:** accept as designed:
     - text-only files;
     - no settings store yet;
     - `.nf-builder/layout.json` stored as a plain file.
   - F-401 and F-403 can add binary content later as an optional field with an ADR amendment. sarek ships PDFs and PNGs, so IO-12 and IO-20 will raise this.
3. **Storage in the worker, not on the main thread.**
   - **Recommendation:** the worker (2.1). Only `persist()` and `estimate()` stay on the main thread.
   - Alternative: storage on the main thread. It needs one Comlink callback fewer, but every change must go through a main-thread wrapper or it isn't saved, and opening clones every file twice on the main thread.
4. **fake-indexeddb 6.2.8 as a dev dependency of `@nf-builder/web`** (tests only; Apache-2.0; no dependencies).
   - **Recommendation:** accept, and record it in `progress.md`. It needs no licences row.
5. **Autosave readings of IO-01.**
   - **Recommendation:**
     - "Saving…" covers the 500 ms wait and the write;
     - a trailing debounce with no maximum wait (F-208 debounces its own text edits);
     - `writeFiles` is saved as well as commands (F-207, F-210);
     - a failed save keeps its changes and retries on the next change or flush;
     - a best-effort flush on `pagehide`.
6. **IO-03 readings.**
   - **Recommendation:**
     - "first save" means the first successful write in a page load;
     - `persist()` at most once per page load, only when not persisted, never awaited (Firefox may prompt);
     - the threshold is **80%** (IO-03, ADR 0002), and step 3 tests 85%;
     - the check runs at start and after every create, save and delete;
     - the warning is a header chip.
7. **Blank project = no files until F-203.**
   - **Recommendation:** accept. Start blank's files (LA-02, LA-03 `manifest.nextflowVersion`, an oracle case) are F-203's.
   - F-202's name-only New project dialog is what UX-60's dialog replaces.
   - New projects take `installedPackVersions()[0]`.
8. **Step 1's content edit goes through the test hook.**
   - **Recommendation:** accept (2.5).
   - Add a note to F-208: its e2e test repeats the persistence check through the Code view.
9. **F-202's additions to unbuilt F-113 code:**
   - `EngineApi.readFile` and `close`;
   - the hook, `expose` and the client typed as `WorkspaceApi`;
   - a raw `open` means an unsaved project;
   - `requestPaletteView`, so the palette is queued before the reopen.
   - **Recommendation:** accept, and record them in F-202's ADR. If F-113 is still open when F-202 starts, fold `readFile` and `close` into it.
10. **Loading progress has no UX row** (F-113 suggested adding one).
    - **Recommendation:** no new row. QA-03 already requires "show loading progress"; tests cite QA-03. This avoids a spec edit and the `scope-change` label.
11. **Switcher pattern and scope of actions.**
    - **Recommendation:**
      - a disclosure button with a panel of buttons, not an ARIA menu (simpler, and fully keyboard-operable by Tab);
      - Rename and Delete act on the open project;
      - duplicate names are allowed;
      - dialogs use native `<dialog>` with `preventDefault` on submit, because of CSP `form-action 'none'`.
12. **Several tabs on one project.**
    - **Recommendation:** no coordination in v0.1; the last write wins per file. `versionchange` already asks for a reload.
    - Note Web Locks in F-703's notes as a possible later guard.
13. **Changes to tests and the baseline.**
    - The F-201 UX-01 e2e test asserted a disabled switcher, and the baseline shows it. F-202 enables the switcher on purpose.
    - **Recommendation:** update the assertion, re-approve the baseline from the CI artefact, and call out both in the PR.

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** none. fake-indexeddb is a dev dependency only.
- **Package boundaries or dependency-cruiser:** no change.
- **Stored format:** yes, IndexedDB v1 (2).
- **Workflows:** none.
- **Contradicting an accepted ADR:** ADR 0002's Dexie clause (1).
- **Open questions:** none affected. Q6 is F-203's.
- **`features.json`:** notes only.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing): "Store projects in IndexedDB from the engine worker, without a library". It covers points 1 to 3, 5, 6, 9, 11 and 12, the schema in 2.2 and the test hooks. It amends ADR 0002's "via Dexie", and gets a row in `docs/adr/README.md`.
- **Spec:**
  - IO-01 and IO-03 rows get "(ADR NNNN)";
  - `architecture.md` Data flow gains one line: the worker reads and writes IndexedDB, and the main thread never holds file text.
- **`features.json` notes** (no scope change):
  - **F-202:** "Verified …: steps 1 to 3 by `e2e/projects.spec.ts` (step 1 `@smoke` on Firefox and WebKit; the content edit goes through `window.nfBuilderEngine` until F-208; threshold 80% per IO-03, step 3 stubs `estimate()` at 85%); app shell baseline re-approved from the CI artefact (ADR 0021)".
  - **F-203:** `createProject({files})`, Start blank's files, and the name-only dialog it replaces.
  - **F-207:** `layout.json` written through `writeFiles` is autosaved.
  - **F-208:** `readFile`, and a UI-driven persistence check.
  - **F-210, F-401, F-403:** `createProject` with files or `writeFiles`; binary files are a schema amendment.
  - **F-406:** the backup zip is its own format and reads through the workspace.
  - **F-703:** the Web Locks note.
- **`progress.md` Decisions:** the ADR, no Dexie, the schema v1, storage in the worker, fake-indexeddb as a dev dependency, the IO-01 and IO-03 readings, the F-201 test change and the baseline re-approval.
- **Other:** `apps/web/README.md` gets one line on `src/workspace/` (worker only) and `src/project/` (main thread). Save this plan as `docs/plan/handoff/plan-F-202.md` and delete it in the merging PR.

## 8. Evidence

- **Repository reads:**
  - `docs/spec/data-and-io.md`, `ux.md`, `architecture.md`, `quality.md`, `language.md`;
  - ADRs 0002, 0003, 0004, 0008, 0014, 0021, 0035;
  - `docs/plan/handoff/plan-F-113.md` and `plan-F-111.md`;
  - `apps/web/src/**`, `apps/web/test/**`, `e2e/app-shell*.spec.ts`, `e2e/palette.spec.ts`, `playwright.config.ts`, `.dependency-cruiser.cjs`, `packages/engine/src/model/project.ts`.
- **Package sizes:** `npm pack dexie@4.4.7` into `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/dl-dexie/` (`dist/dexie.min.js` 96,272 B, 30,825 B gzipped). `npm view` gave fake-indexeddb 6.2.8 (Apache-2.0, node ≥ 18) and idb 8.0.4 (ISC).
- **Probe not run:** `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/probe/idb-probe.mjs` was written but not run, because the sandbox refused to execute the downloaded package. Task 2's tests cover what it would have checked.
