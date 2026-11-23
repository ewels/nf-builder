# Plan: F-703, read-only mode below 1024 px

Planner output, 2026-11-23. I changed nothing in the repository.

**What happened while I worked:** F-209 merged as PR #50 (`d195424`) partway through. F-207 is still open as PR #49. F-309 has started building in `/home/user/wt-F-309` and so far has only its oracle fixtures. Settle open point 1 before building.

**Sources I read:**
- `origin/main`, first at `893c900` and then at `d195424` once F-209 had merged. I read it through the shared scratch worktree `scratchpad/main`. It was there before this run and someone else moved it to `d195424`, so I left it in place.
- I checked that F-209 as merged has the same `apps/web`, `e2e` and `packages/engine/src` as its branch head `399f5bd`.
- `feat/F-207` at `ea528c1` in `/home/user/wt-F-207`: dragging, Auto-layout, sidecar writes and `e2e/layout.ts`.
- `docs/plan/handoff/plan-F-309.md` and the settled points in `handoff/README.md`.

**What the feature cites:**
- Requirement: UX-04.
- Dependency: F-206.
- Notes for F-703:
  - from F-202, about multi-tab writes;
  - from F-206: "hide the details header's Edit and Code buttons";
  - from F-208: "set Monaco `readOnly` below 1024 px".
- Also relevant: product non-goal "Editing on phones. Small screens get a read-only view." and the F-309 plan's note "F-703: hide fix buttons".
- ADRs read: 0003 (phones get read-only mode), 0021 (it defers the narrow-screen mode to F-703), 0044, 0045, 0046, 0047, 0048, 0049 and 0051.

## 0. Scope

**In scope:**
- **Detection:** below 1024 CSS px of viewport width the app is read-only (UX-04). This applies to a top-level window, a frame and a zoomed page alike. It is re-evaluated when the window crosses the threshold, with no reload.
- **What stays:** canvas and details only:
  - the header with the app name, project switcher (switching only) and save state;
  - the workflow tabs and the canvas, with pan, zoom, fit, the port-labels toggle and selection;
  - the details pane;
  - the status bar.
- **What goes:** every editing control on `main` and on the F-207 branch.
- **Central refusals in the page's stores**, on top of the hidden controls:
  - commands, undo and redo (F-209's queue);
  - sidecar writes and node moves (F-207);
  - project create, rename and delete (F-202).
- **Safe transitions:**
  - narrowing first sends any pending Code-view edit, then turns read-only;
  - widening brings back the editing controls and each tab's view mode.
- **Layout:**
  - canvas and details side by side from 640 to 1023 px, stacked below 640 px;
  - no horizontal page scroll down to 320 px.
- **The note:** its text, a polite status region, and focus that would be lost moves to it.
- **Tests:** unit tests, end-to-end tests (390 px step, boundary, transition, frame, touch, `@smoke`) and two new visual baselines.

**Out of scope:**

| What | Owner |
|---|---|
| Multi-tab write coordination and Web Locks (F-202's note) | Not UX-04. ADR 0045's "last write wins per file" stands (open point 13). |
| An "Edit anyway" override for zoomed desktops (WCAG 1.4.4) | F-701, which owns QA-10 (open point 8) |
| Edge types on touch, where there is no hover | F-701 |
| Read-only handling inside features not yet built (palette drops, connect, popup, Files view, import, export, config editors) | Each feature, through `useReadOnly()` and the central guards. Notes in section 7. |
| Skipping the palette and template prefetch on phones | F-702 (note) |
| README text about small screens | F-704 (note) |

## 1. Findings

### 1.1 Spec and ADRs
- **UX-04:** "Below 1024 px wide the app is read-only: canvas and details only, with a note that editing needs a larger screen."
  - It doesn't say whether 1024 itself is editable, what read-only blocks, or how the layout looks at phone widths.
- **`product.md` non-goals:** "Editing on phones. Small screens get a read-only view."
- **ADR 0003:** "Monaco is heavy: it is lazy-loaded, and phones get read-only mode." This reads as phones not needing the editor.
- **ADR 0021:**
  - the grid widths are inline `gridTemplateColumns` from the layout store;
  - widths persist in `nf-builder:layout` (version 1);
  - "the narrow-screen mode stays with F-703".
- **ADR 0044:** the app works in frames, so a 390 px iframe must be read-only too. Every existing frame test uses `width="1200"`, so none of them is affected.
- **ADR 0048:**
  - Typing sends `ReplaceFileText` after 300 ms, on blur, and when the mode or tab changes.
  - A refused draft stays in the per-path Monaco model for the session, and a remounted editor sends it again.
  - The graph re-fits whenever its pane changes size.
- **ADR 0051 (F-209):**
  - One queue runs apply, undo and redo.
  - Pending Code-view text is flushed before an undo.
  - Shortcuts don't fire in text fields, the editor or dialogs.
- **ADR 0045:** opening a project writes `openedAt` (`touchProject`). That is metadata, not project content.
- **QA-10:** WCAG 2.2 AA outside the canvas drawing. This brings in 1.4.10 Reflow at 320 px, and 1.4.4 Resize text (open point 8).

### 1.2 Code as it stands (main `d195424`, plus F-207 `ea528c1`)

**Edit paths, and what F-703 does with each:**

| Surface | Where | How it writes | Read-only treatment |
|---|---|---|---|
| Palette and registry section (Enter or drop come with F-301) | `shell/left-column.tsx` → `PalettePanel`, `RegistrySection` (loads on mount) | nothing yet | Left column not rendered |
| Files view (placeholder) | `left-column.tsx` | – | Not rendered |
| Column resize and collapse | `ColumnSeparator`, `SideColumn` toggle → `nf-builder:layout` | localStorage | Separators not rendered. Details can't be collapsed and are always shown. The stored layout is neither read for the grid nor written. |
| Templates, Import (disabled), Export (disabled), version select | `shell/app-header.tsx` | Templates opens New project | `.header-actions` not rendered |
| New, Rename and Delete project | `project/project-switcher.tsx`, `project-controls.tsx`, `project-store.ts` `create`, `rename`, `remove` | IndexedDB | Panel shows the project list only. Any open dialog closes on entry. The store refuses. |
| Switching projects | `ProjectSwitcher` → `open(id)` | `openedAt` only | Kept |
| View modes, G, S and C | `views/view-mode-toggle.tsx` in `TabStripView`; `use-view-mode-keys.ts` | – | Toggle hidden, keys ignored, tab shown as Graph, the tab's stored mode kept |
| Monaco (Split and Code) | `code/code-editor.tsx` → `canvasStore.apply` (`replaceFileText`) | commands | Not mounted (open point 2). Flushed before entry. |
| Undo and Redo buttons, Ctrl or Cmd+Z, Ctrl+Y | `history/history-controls.tsx`, `use-history-keys.ts` → `canvasStore.undo/redo` → `send` | commands | Not rendered, keys ignored, `send` refuses |
| Edit and Code (disabled) | `details/details-header.tsx` | – | Not rendered |
| Node drag and keyboard move (F-207) | `workflow-canvas.tsx` `nodesDraggable`, `onMove` → `moveNodes` → `save` → `setLayout` | sidecar | `nodesDraggable={false}`, so both are off (1.3). `moveNodes` ignores moves. |
| Auto-layout (F-207) | `ControlButton` "Auto-layout all/selected nodes" → `placeNodes` → `save` | sidecar | Not rendered |
| Automatic placement of unplaced nodes (F-207) | `placeMissing` → `onPlace` → `placeNodes` → `save` | sidecar | Positions kept in memory, `save` skipped (open point 4) |
| Node a11y description (F-207) | "…then use the arrow keys to move it." | – | Read-only wording: "Press enter or space to select this node." |
| Minimap | `<MiniMap pannable zoomable />`, 200×150 px | – | Not rendered (open point 6) |
| Test hooks | `nfBuilderWorkspace.apply` → `canvasStore.apply`; `nfBuilderEngine` is the raw engine | – | Store hook refused; raw engine untouched (test-only) |
| F-309 fix buttons, `applyFix` (when merged) | planned `problems-panel`; `canvasStore.applyFix` joins the queue | commands | Hidden; refused through `send` (task 5 or a note) |

**Store facts:**
- **F-209's queue:**
  - `send(session, call, after)` is the one path for `apply`, `undo` and `redo`; it checks the session and the summary when the task runs.
  - `registerFlush` adds to a private `flushes` set, which `stepHistory` awaits.
  - Refusals are built by `refusal(code, message)` with `EngineRefusalCode = RefusalCode | "stale" | "no-project" | "no-history"`.
- **F-207's writer:** `save()` in `canvas-store.ts` is the only sidecar writer.
- **Project store:**
  - `start()` prefetches the palette and the templates, then opens the first stored project.
  - `create`, `rename` and `remove` call the workspace.

**Test facts:**
- Unit tests run in Node with `renderToStaticMarkup`. zustand 5's `useStore` server snapshot is `getInitialState()`, so a test can't set store state and then render it. Tests use presentational `…View` components with props, as `DetailsHeaderView` and `TabStripView` do.
- e2e viewport: 1440×900 for every project (`playwright.config.ts`), and 2560×1440 for one canvas test. No existing test or baseline is below 1024 px.
- `openProject` (in `e2e/canvas.ts`) reads `getByLabel("Nextflow version")`, which read-only mode hides.
- **Helpers to reuse:**
  - `openStoredFixture`, `historyStatus` and `applyThroughStore` (F-209), but `applyThroughStore` throws on refusal;
  - `dragNode`, `nodePosition`, `readSidecar` and `waitSaved` (F-207);
  - `readFile` and `switcher` (F-202);
  - `watchForCspViolations`.
- No CSS media query exists anywhere in `apps/web/src`.
- `index.html` already has `<meta name="viewport" content="width=device-width, initial-scale=1">`.

### 1.3 Measurements

Probe of F-207's production build, sandbox Chromium; section 8 has the scripts.

**At 390×844, with no project:**
- the document is **713 px** wide (horizontal scroll);
- left column 256 px, centre 161 px, right 296 px;
- the header's actions alone are 415 px.
- 320×640 gives the same 713 px.

**At the boundary:** `matchMedia("(min-width: 1024px)").matches` is `false` at 1023 and `true` at 1024, with `innerWidth` equal to the viewport.

**The header without its actions** still needs about 352 px:
- app name 77, switcher 115 (up to 280 with a long name), "Nothing to save" 96;
- 2×16 gap and 32 padding.
- So it must truncate and tighten at 320.

**With `f205-canvas` open at 1440:**
- **Status bar:** items of 91 + 89 + 128 + 83 px, so at least about 455 px with gaps and padding. It overflows at 390 and must wrap.
- **Tab strip:** tabs 72 px, view-mode toggle 166 px.
- **Minimap:** 200×150 px.
- **Dragging:** all 12 of 12 nodes have `.draggable`.
- **Controls:** Zoom in, Zoom out, Fit view, Port labels, "Auto-layout all nodes".

**React Flow 13.0.2:** the keyboard move of selected nodes filters by `node.draggable || (nodesDraggable && node.draggable === undefined)`, the same rule as pointer drags. So `nodesDraggable={false}` turns off both.

## 2. Design

### 2.1 Detection, threshold and boundary
- **One media query:** `WIDE_QUERY = "(min-width: 1024px)"`, and `readOnly = !matchMedia(WIDE_QUERY).matches`.
  - 1024 px is editable and 1023 px is read-only.
  - Fractional widths between them are read-only, because `min-width` is exact.
- **`matchMedia` with a `change` listener, not a resize listener.** It fires only on a crossing, agrees with CSS, and measures the frame's own viewport inside an iframe (ADR 0044).
  - Browser zoom changes CSS px, so zooming in far enough on a desktop turns read-only (open point 8).
- **Width only.** No pointer, height or user-agent checks.
- **Initial value:** read synchronously when the module loads. The first render is already right, so a phone never mounts the palette, the registry section or Monaco.
- **Fallback:** with no `matchMedia` (Node unit tests, very old browsers) the app is editable.

### 2.2 State and transition (AR-30, ADR 0004)
`apps/web/src/read-only/read-only-store.ts` is a vanilla Zustand store, `{readOnly}`.

`start({flush, onEnter})` subscribes to the media query and returns `stop`. `main.tsx` calls it with:
- `flush: () => canvasStore.getState().flushEdits()` (a new public action that awaits F-209's registered code-pane flushes; `stepHistory` reuses it);
- `onEnter: closeProjectDialog`.

**Narrowing** (`matches` becomes false):
1. Increment `seq`.
2. Await `flush()`. A rejection is ignored.
3. If `seq` is unchanged and the window is still narrow, set `readOnly: true`, then call `onEnter()`.

The UI stays editable for the few milliseconds the flush takes. The pending edit therefore passes the guard, because the guard reads `readOnly` when the command runs. No timeout: each send settles, and `connectEngine`'s `race` rejects when the worker fails.

**Widening:** increment `seq`, then set `readOnly: false` at once. This also cancels a narrowing whose flush is still pending.

**Residual case:** text typed during the flush is sent by the editor's unmount flush. That send is refused with `read-only`, but the text stays in the session's Monaco model and is re-sent when the editor mounts again on widening (ADR 0048). Nothing is lost within the session.

### 2.3 What read-only shows
Read-only mode shows exactly what section 0 lists:
- the header with the app name, the switcher and the save state, plus the storage warning or note when present;
- the note;
- the tab strip with workflow tabs only;
- the canvas in Graph mode, with Zoom in, Zoom out, Fit view and Port labels;
- the details column;
- the status bar.

**Not rendered** (rather than hidden with CSS), so nothing loads and nothing stays focusable:
- the left column and the separators;
- the header actions;
- the switcher's New, Rename and Delete;
- dialogs;
- the view-mode toggle and the history controls (their live region is mounted again on widening);
- the Code pane;
- Edit and Code;
- Auto-layout and the minimap.

**Tabs and selection:**
- Each tab keeps its stored `mode`. `TabPanel` renders `shownMode(tab.mode, readOnly)`, which is `"graph"` while read-only, and `data-view-mode` reports that shown mode.
- The selection and details are kept across a crossing.

**Project switcher:** with no stored projects, its panel reads "No projects in this browser."

### 2.4 Central refusals (decide-and-record; open points 9 and 10)
- **Canvas store.** `createCanvasStore(engine, readOnly: () => boolean = () => false)`, and `canvasStore = createCanvasStore(getEngine, isReadOnly)`.
  - Inside `send`'s queued task, after the session and summary checks: `if (readOnly()) return refusal("read-only", READ_ONLY_REFUSAL)`. This covers `apply`, `undo`, `redo`, every later command feature, and F-309's `applyFix`, which joins the same queue.
  - `moveNodes`: returns at once.
  - `save()`: returns at once, so placements and Auto-layout results are shown but never written.
- **Engine type:** `EngineRefusalCode` gains `"read-only"`, documented as "returned only by the page's canvas store, never by the worker". It is type-only: no `EngineApi` method changes (ADR 0043).
- **Project store.**
  - `ProjectStoreDeps.readOnly: () => boolean` (default `isReadOnly`).
  - `create`, `rename` and `remove` throw `Error(READ_ONLY_REFUSAL)` before calling the workspace. `useModal` already shows such an error inline.
  - `open` is unchanged.
- **Not guarded:**
  - the worker and `EngineApi`;
  - `nfBuilderEngine` (a raw test hook);
  - view actions (`open`, `openWorkflow`, `selectTab`, `select`, `setPortLabels`, `setMode`);
  - `touchProject`;
  - autosave `flush`.
- **Messages:** `READ_ONLY_REFUSAL = "Editing needs a larger screen or a wider window."`, and the text sync reports it as `failed`, which needs no code change.

### 2.5 Layout below 1024 px (UX-02, QA-10)
- **`.app-shell` rows** become `var(--header-height) auto minmax(0, 1fr) var(--status-height)` in every mode. The note container is the new `auto` row. It is empty, with no padding, while editable, so it is 0 px high and no existing baseline moves.
- **`.app-shell.is-read-only`:** rows `auto auto minmax(0, 1fr) auto`.
  - **Header:**
    - `flex-wrap: wrap`, `min-height: var(--header-height)`, `gap: var(--space-2)`, `padding-inline: var(--space-2)`;
    - the switcher's `max-width: min(280px, 45vw)`;
    - the save state may ellipsise.
  - **Status bar:** wraps, with a minimum height of 28 px.
- **`.app-columns.is-read-only`:** no inline style. `grid-template-columns: minmax(0, 1fr) 296px`, the right column's default (`COLUMN_LIMITS.right.initial`).
- **Stacked layout:** `@media not all and (min-width: 640px) { .app-columns.is-read-only { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 3fr) minmax(0, 2fr) } }`.
  - DOM order is canvas then details, which is also the visual order.
  - 640 is a layout-only CSS breakpoint (open point 5).
- **Details column:** `SideColumn` gets `collapsible={false}`, so there is no toggle and the body shows even if the stored layout says collapsed.
- **Re-fit:** the graph re-fits on every pane resize, as F-208 does. There is no other canvas change.
- **Target:** no horizontal page overflow at 320, 390 and 639 px with a project open, the persistence note shown, and a 40-character project name. The canvas is excepted (WCAG 1.4.10, two-dimensional content).

### 2.6 The note (UX-04, QA-10 to QA-13)
- **Text:** "Read-only view: editing needs a larger screen or a wider window." (open point 12). It is not dismissible.
- **Markup:** `<div className="read-only-note" role="status">`, always mounted right after `<header>`. Inside it, `<p tabIndex={-1}>` is rendered only while read-only.
  - A crossing is announced politely.
  - On a page that loads read-only, the text is first in reading order after the banner.
- **Style:** `--color-text` on `--color-surface-muted` (about 14:1), with a bottom border. No animation, so `prefers-reduced-motion` is unaffected, and colour carries no meaning.
- **Focus:** when the mode turns read-only and `document.activeElement === document.body` after the render (the focused control was removed), focus moves to the note's `<p>`. This doesn't happen on the first render.

### 2.7 Keyboard
- **Shortcuts off:**
  - `useViewModeKeys` and `useHistoryKeys` return before `preventDefault` when `isReadOnly()`, so the browser's own keys still work.
  - Delete is already `deleteKeyCode={null}`.
  - Arrow keys don't move nodes, because `nodesDraggable` is false.
- **Unchanged:** Enter and Space select a node, Escape clears, and Tab order is header, note (only when focused programmatically), tabs, canvas, details.
- **F-701** audits all of this later.

### 2.8 Frames, zoom and touch
- **Frames:** the media query inside an iframe measures the frame, so a 390 px frame is read-only (ADR 0044).
- **Touch:** React Flow pans with one finger and zooms with a pinch, as it already does. A tap on a node selects it, and the details show.
- **Zoom:** see open point 8.

### 2.9 Baselines and existing tests
- **Existing baselines** are at 1440 or 2560 px and don't change: the note row is 0 px, and nothing else changes while editable. CI confirms this.
- **New `@visual` baselines**, approved from CI (ADR 0021):
  - `read-only-phone`: 390×844, stored `f205-canvas`, nothing selected, full page;
  - `read-only-narrow`: 1000×768, side by side.
  - Both rely on F-207's ELK placement, which is deterministic.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `apps/web/src/read-only/read-only-store.ts` | `EDIT_MIN_WIDTH = 1024`; `WIDE_QUERY = "(min-width: 1024px)"`; `READ_ONLY_TEXT`; `READ_ONLY_REFUSAL`; `interface MediaWatch {readonly matches: boolean; addEventListener(type: "change", l: (e: {readonly matches: boolean}) => void): void; removeEventListener(type: "change", l: (e: {readonly matches: boolean}) => void): void}`; `interface ReadOnlyState {readonly readOnly: boolean}`; `interface ReadOnlyActions {start(o: {flush(): Promise<void>; onEnter(): void}): () => void}`; `createReadOnlyStore(media: () => MediaWatch \| null): StoreApi<ReadOnlyState & ReadOnlyActions>`; `readOnlyStore`; `isReadOnly(): boolean`; `useReadOnly(): boolean` |
| `apps/web/src/read-only/read-only-note.tsx` | `ReadOnlyNoteView(props: {readOnly: boolean; noteRef?: Ref<HTMLParagraphElement>}): JSX.Element`; `ReadOnlyNote(): JSX.Element` (connected; the focus rule of 2.6) |
| `apps/web/test/read-only-store.test.ts`, `apps/web/test/read-only-note.test.tsx` | section 4 |
| `e2e/read-only.ts` | `PHONE = {width: 390, height: 844}`; `NARROW = {width: 1000, height: 768}`; `NOTE_TEXT`; `readOnlyNote(page): Locator`; `openStoredCanvas(page, name)` (at 1440: create a stored `f205-canvas` project through `nfBuilderEngine.createProject`, then wait until saved); `resize(page, size)`; `visibleControls(page): Promise<string[]>` (descriptors of every visible `button, a[href], input, select, textarea, [role=tab], [role=radio], [role=separator], [tabindex]:not([tabindex="-1"])` in `.app-shell`, with React Flow nodes and edges collapsed to `node` and `edge`); `READ_ONLY_ALLOWED: readonly RegExp[]`; `applyOutcome(page, command): Promise<{ok: boolean; code?: string; message?: string}>`; `horizontalOverflow(page): Promise<number>` |
| `e2e/read-only.spec.ts` | section 4 |

### 3.2 Change
- **`packages/engine/src/service/types.ts`:** `EngineRefusalCode` gains `"read-only"`, with a doc comment.
- **`apps/web/src/canvas/canvas-store.ts`:**
  - `createCanvasStore(engine, readOnly = () => false)`;
  - the guard in `send`;
  - the guards in `moveNodes` and `save` (F-207);
  - `WorkspaceActions.flushEdits(): Promise<void>`, which `stepHistory` uses;
  - `canvasStore = createCanvasStore(getEngine, isReadOnly)`.
- **`apps/web/src/project/project-store.ts`:**
  - `ProjectStoreDeps.readOnly`;
  - guards in `create`, `rename` and `remove`;
  - `export function closeProjectDialog(): void`.
- **`apps/web/src/main.tsx`:** `readOnlyStore.getState().start({flush: () => canvasStore.getState().flushEdits(), onEnter: closeProjectDialog})`.
- **`apps/web/src/app-shell.tsx`:**
  - `useReadOnly()`;
  - `<ReadOnlyNote/>` after `AppHeader`;
  - the `is-read-only` classes;
  - no `LeftColumn` and no separators;
  - no inline grid style;
  - `SideColumn collapsible={!readOnly}`;
  - `AppHeader readOnly`.
- **`apps/web/src/shell/app-header.tsx`:** prop `readOnly?: boolean`; omits `.header-actions`.
- **`apps/web/src/shell/side-column.tsx`:** prop `collapsible?: boolean` (default true); when false, there is no toggle and the body is never `hidden`.
- **`apps/web/src/project/project-controls.tsx`:** passes `readOnly`; renders no dialog while read-only.
- **`apps/web/src/project/project-switcher.tsx`:** prop `readOnly?: boolean`; no `.project-actions`; "No projects in this browser." when the list is empty.
- **`apps/web/src/details/details-header.tsx`:** `DetailsHeaderView({selected, readOnly})`; no Edit or Code while read-only.
- **`apps/web/src/shell/tab-strip.tsx`:** `TabStripView` prop `readOnly?: boolean` (no `ViewModeToggle`); `TabStrip` passes `controls={readOnly ? null : <HistoryControls/>}`.
- **`apps/web/src/views/view-mode.ts`:** `shownMode(mode: ViewMode, readOnly: boolean): ViewMode`.
- **`apps/web/src/views/tab-panel.tsx`:** renders and reports `shownMode`.
- **`apps/web/src/views/use-view-mode-keys.ts` and `apps/web/src/history/use-history-keys.ts`:** return early when `isReadOnly()`.
- **`apps/web/src/canvas/canvas-host.tsx`:** passes `readOnly`.
- **`apps/web/src/canvas/workflow-canvas.tsx`:** prop `readOnly: boolean`:
  - `nodesDraggable={!readOnly}`;
  - no Auto-layout `ControlButton`;
  - no `MiniMap`;
  - read-only `ariaLabelConfig` node descriptions.
- **`apps/web/src/styles.css`:** 2.5 and 2.6.
- **Task 5 only, if F-309 is on `main`:** its panel and row components hide fix buttons through `useReadOnly()`.
- **Unchanged:**
  - dependencies;
  - dependency-cruiser rules;
  - workflows;
  - stored and exported formats (`nf-builder:layout` and the sidecar v1);
  - the AGENTS.md command table;
  - generated files;
  - every existing baseline.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **web `test/read-only-store.test.ts`** (fake `MediaWatch`) | |
| `F-703 UX-04: the app starts read-only below 1024 px and editable at 1024 px and wider` | `WIDE_QUERY` is `(min-width: 1024px)`; the initial state follows `matches` |
| `F-703 UX-04: without matchMedia the app is editable` | |
| `F-703 UX-04 ADR-0004: narrowing turns read-only only after the pending code edits are sent, then calls onEnter once` | deferred flush; `readOnly` false until it resolves |
| `F-703 UX-04: widening turns editing back on at once, and widening during a pending flush cancels the narrowing` | |
| `F-703: a failing flush still turns read-only, and stop removes the listener` | |
| **`canvas-store.test.ts`** (extend; fake engine) | |
| `F-703 UX-04 AR-24 AR-23: read-only apply, undo and redo are refused with code read-only without calling the engine` | engine call counts; message |
| `F-703 UX-04 F-207: read-only placements are shown but never saved, and moves are ignored` | `setLayout` never called; `content.positions` updated by `placeNodes`; unchanged by `moveNodes` |
| `F-703 F-209: flushEdits awaits every registered code-pane flush, and one failing flush doesn't stop the others` | |
| `F-703: once editable again, apply reaches the engine` | |
| **`project-store.test.ts`** (extend) | |
| `F-703 UX-04: read-only create, rename and delete are refused without calling the workspace; open still opens a stored project` | |
| **`app-shell.test.tsx`** (extend) | |
| `F-703 UX-04 UX-01: the read-only header shows the app name, project switcher and save state, with no Templates, Import, Export or version selector` | `AppHeader readOnly` |
| `F-703 UX-04 UX-02: a non-collapsible side column has no toggle and shows its body even when the stored layout is collapsed` | `SideColumn` |
| `F-201 F-703: editable, the shell's markup is unchanged apart from an empty status container after the header` | guards the baselines |
| **`read-only-note.test.tsx`** | |
| `F-703 UX-04 QA-10: read-only, the note is a polite status region that says editing needs a larger screen` | exact text, `role="status"`, `tabindex="-1"` on the paragraph |
| `F-703: editable, the status container is empty` | |
| **`project-ui.test.tsx`** (extend) | |
| `F-703 UX-04: the read-only project panel lists stored projects with no New, Rename or Delete, and says when there are none` | |
| **`details-pane.test.tsx`** (extend) | |
| `F-703 UX-04 UX-32: read-only, the details header has no Edit or Code buttons while a node is selected` | |
| **`tab-strip.test.tsx`** (extend, F-209's file) | |
| `F-703 UX-04 UX-27 AR-23: the read-only tab strip shows the workflow tabs only, with no view-mode toggle or undo and redo controls` | |
| **`view-mode.test.ts`, `tab-panel.test.tsx`** (extend) | |
| `F-703 UX-04 UX-27: read-only, a tab in Split or Code mode shows only its graph and keeps its mode` | `shownMode`, `PanelLayout` |
| **e2e `e2e/read-only.spec.ts`** (Chromium) | |
| `F-703 step 1 UX-04: at 390 px wide a stored project shows its canvas and details, no editing controls, and the note` | 1. At 1440, `openStoredCanvas`.<br>2. Resize to `PHONE` and reload.<br>3. The note's exact text is shown.<br>4. `.workflow-canvas[data-canvas-state="ready"]` is visible, at least 300 px wide and 300 px high, with all 12 nodes.<br>5. `aside[aria-label="Details"]` is visible below the canvas and shows the workflow summary.<br>6. A click on `GREET` shows its details.<br>7. `visibleControls` all match `READ_ONLY_ALLOWED` (switcher, workflow tab, Zoom in, Zoom out, Fit view, Port labels, React Flow link, node, edge).<br>8. None of these: `#column-left`, `[role=separator]`, the version select, a view-mode radiogroup, Undo or Redo, Auto-layout, `.react-flow__minimap`, `.react-flow__node.draggable`, Edit or Code.<br>9. `horizontalOverflow` is 0.<br>10. No CSP violation or console error. |
| `F-703 UX-04 AR-23 AR-24: read-only, commands, undo, redo, drags and shortcuts change nothing` | 1. At 1440, make one edit with `applyThroughStore`.<br>2. Resize to 390 without reloading.<br>3. `applyOutcome` is `{ok: false, code: "read-only"}`.<br>4. Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, G, S, C, Delete, a mouse drag and ArrowRight on a selected node: `readFile` of `main.nf` and the sidecar unchanged, `historyStatus` unchanged, `data-view-mode="graph"`, node position unchanged. |
| `F-703 UX-04 F-207: viewing a project without a sidecar at 390 px lays it out without writing the sidecar` | nodes placed; `readFile(SIDECAR)` is null and the stored database has no sidecar after `waitSaved` |
| `F-703 UX-04 ADR-0004 ADR-0048: narrowing during a code edit sends it first, and widening brings back the Split view and the editing controls` | 1. At 1440, Split mode, `typeComment`.<br>2. Resize to 390 at once.<br>3. `readFile` contains the comment, and the note is shown.<br>4. Resize to 1440: Split is back, the editor shows the text, the palette is back, and Undo is enabled with "Edit main.nf". |
| `F-703 UX-04: the switch is at 1024 px, and canvas and details stack below 640 px` | 1024: no note, palette visible. 1023: note, side by side. 640: side by side. 639: details below canvas (bounding boxes). |
| `F-703 UX-04: entering read-only closes an open dialog and leaves only the project list in the switcher` | New project dialog via Templates at 1440, then resize |
| `F-703 UX-04 QA-10: a crossing moves lost focus to the note, and nothing scrolls sideways at 320 px` | focus the palette search, then resize: the note's paragraph is focused. At 320×640 with a long project name and the persistence note forced (as `projects.spec.ts` does), overflow is 0. |
| `F-703 UX-04 ADR-0044: inside a 390 px cross-origin iframe the app is read-only` | iframe `width="390"`: note shown, palette absent, no CSP violation |
| `F-703 UX-04: on a touch phone a tap selects a node and shows its details` | `test.use({viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3})`; `innerWidth` is 390; `tap` on `GREET` shows its details |
| `F-703 UX-04: at 390 px the app starts read-only with the note and without the palette or project actions @smoke` | no project; runs on Chromium, Firefox and WebKit (QA-20) |
| `F-703 UX-04: the read-only views at 390 and 1000 px match their approved baselines @visual` | `read-only-phone`, `read-only-narrow` (full page) |

## 5. Tasks

**Starting point:** branch `feat/F-703` from `main` once F-207 (#49) has merged; F-209 is already in. Run `pnpm check` before every commit. The e2e tests need `PW_CHROMIUM_EXECUTABLE`. Tests open fixtures at 1440 px before resizing, because `openProject` reads the version select.

1. **Read-only state and central refusals** (no visible change).
   - Files:
     - `read-only-store.ts`;
     - the engine `"read-only"` code;
     - the canvas-store guards and `flushEdits`;
     - the project-store guards and `closeProjectDialog`;
     - `main.tsx` `start`;
     - the store unit tests.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
2. **Shell layout and note.**
   - Files:
     - `read-only-note.tsx`, `app-shell.tsx`, `side-column.tsx`, `app-header.tsx`;
     - the `styles.css` rows, grid, 640 stacking, header and status wrapping;
     - the unit tests;
     - `e2e/read-only.ts`;
     - the `@smoke`, boundary, focus and reflow e2e tests.
   - Done when `pnpm check`, `pnpm test:e2e -- --grep "F-703|F-201|F-204"` and `pnpm smoke` (under 60 s) pass.
3. **Projects and details.**
   - Files:
     - `project-controls.tsx`, `project-switcher.tsx`, `details-header.tsx`;
     - their unit tests;
     - the dialog e2e test.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-703|F-202|F-203|F-206"` pass.
4. **Tabs, view modes, history and canvas.**
   - Files:
     - `tab-strip.tsx`, `view-mode.ts`, `tab-panel.tsx`;
     - both key hooks;
     - `canvas-host.tsx`, `workflow-canvas.tsx`;
     - the unit tests;
     - the step 1, blocked, sidecar, transition, iframe and touch e2e tests.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-703|F-205|F-206|F-207|F-208|F-209|F-011"`;
     - `pnpm smoke`.
5. **F-309 fix buttons**, only if F-309 is on `main` by now.
   - Hide them through `useReadOnly()`; check that `applyFix` goes through `send`; extend `READ_ONLY_ALLOWED` for the status-bar count buttons.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-703|F-309"` pass.
   - Otherwise this becomes a note to F-309 (section 7).
6. **Visual baselines.**
   - Add the `@visual` test.
   - Done when the PR's Chromium job produces both `-actual.png` images, the orchestrator has viewed and committed them (ADR 0021), and CI is green with every existing baseline unchanged.
7. **Records** (section 7).
   - Done when `pnpm check` and the Scope guard pass.

## 6. Open points (recommendations only; none decided here)

1. **Order.** F-703 depends only on F-206, so the scheduler may pick it now. It must cover F-207's dragging and Auto-layout, and F-207 is still a PR.
   - **Recommend:** start after #49 merges; record "after F-207 and F-209 in practice" in the notes, with no `depends_on` change and no `scope-change` label. F-309 is being built now: tell its builder to use `useReadOnly()` if F-703 lands first, or do task 5 here.
2. **Monaco below 1024 px** (F-208's note).
   - **Recommend:** don't mount the code view at all: Graph only, toggle hidden, modes kept. This is the literal UX-04 ("canvas and details only") and ADR 0003's intent, and it keeps about 900 kB gzipped off phones.
   - **Alternative:** Code view with Monaco `readOnly: true`. It contradicts "canvas and details only", Split is unusable at 390 px, and the shared model would show a refused draft rather than the file.
3. **Project management in read-only.**
   - **Recommend:** switching stays; New, Templates, Import, Rename and Delete are hidden and refused; a dialog open on entry closes.
   - **Alternative:** allow creating from a template so a phone visitor has something to view. That is beyond "canvas and details only".
4. **Sidecar writes on a read-only open** (F-207 writes placements on open).
   - **Recommend:** read-only writes nothing to the project. Positions stay in memory and the sidecar is written at the next wide open. Opening still sets `openedAt` (metadata, ADR 0045).
   - **Alternative:** allow automatic placement writes, which aren't user edits. That gives a "Saving…" on a view-only screen.
5. **Layout.**
   - **Recommend:** side by side from 640 to 1023 px with a fixed 296 px details column, stacked 3:2 below 640 px; the details aren't collapsible and the stored layout isn't touched.
   - **Alternatives:** always stacked (wastes width at 1000 px); a bottom sheet (more code).
6. **Canvas controls.**
   - **Recommend:** keep zoom, fit and the port-labels toggle; drop the minimap (half the canvas width at 390 px).
   - **Alternative:** keep the minimap from 640 px with CSS.
7. **Header in read-only.**
   - **Recommend:** hide all header actions, including Export (a disabled stub today) and the version select (the status bar still shows the version). Add a note to F-404 to keep Export hidden in read-only for v0.1.
   - **Alternative:** allow Export later, since it only reads.
8. **WCAG 1.4.4 (QA-10).** Browser zoom of 200% on a 1280 to 2047 px screen gives a viewport under 1024 CSS px, so editing goes away.
   - **Recommend:** accept for v0.1 as UX-04 says, record it in the ADR, and leave F-701 a note to decide on a session-only "Edit anyway".
   - **Alternative:** add that override now. It changes UX-04 and needs a usable narrow editing layout.
9. **Refusal code.**
   - **Recommend:** add `"read-only"` to the engine's `EngineRefusalCode` (type-only; the worker never returns it).
   - **Alternative:** a web-only union, which ripples through `text-sync.ts` and the hooks' types.
10. **Where the guard lives.**
    - **Recommend:** the page's stores only (`send`, `moveNodes` and `save`, and the project store), checked when a command runs. The worker stays unaware of viewport width.
    - **Alternative:** a worker-side `setReadOnly`. It also blocks `nfBuilderEngine` but changes ADR 0043's API.
11. **Transition.**
    - **Recommend:** flush, then guard, with no timeout. Text typed during the flush stays in the session model.
    - **Alternative:** guard first, so a pending edit waits for the next wide visit and is lost on a reload.
12. **Copy.**
    - **Recommend:** note "Read-only view: editing needs a larger screen or a wider window."; refusal "Editing needs a larger screen or a wider window."; empty switcher "No projects in this browser."
    - **Alternative:** name the threshold ("at least 1,024 pixels wide").
13. **F-202's note** (multi-tab writes, Web Locks). It isn't UX-04.
    - **Recommend:** answer it in F-703's notes. ADR 0045's "last write wins" stands for v0.1, with no Web Locks.
14. **Allow-list test.**
    - **Recommend:** keep the e2e allow-list (`READ_ONLY_ALLOWED`). Every later feature that adds a visible control either hides it in read-only or adds it to the list in its own PR, so missing read-only handling fails CI.
15. **`@smoke`.**
    - **Recommend:** tag one quick test (no project), so WebKit, the phone engine, and Firefox run it (QA-20). It adds about 2 s to `pnpm smoke`.
16. **Startup prefetch.**
    - **Recommend:** leave the palette and template prefetch as it is; add a note to F-702.

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** none.
- **Package boundaries or dependency-cruiser rules:** none (one member added to an engine type union, point 9).
- **Stored or exported format:** none. `nf-builder:layout` and sidecar v1 are unchanged; the sidecar simply isn't written while read-only (point 4).
- **Workflows:** none.
- **`features.json` beyond `passes` and `notes`:** none (point 1).
- **ADR interplay:** this realises ADR 0003's consequence and ADR 0021's deferral, and reuses ADR 0048's re-fit and ADR 0051's flush. ADR 0045's multi-tab clause stands (point 13). Nothing is superseded.
- **Spec behaviour:** UX-04 is amended (section 7).
- **Open questions in `open-questions.md`:** none apply. Point 8 is recorded in the ADR and an F-701 note.

## 7. Records (drafts for the orchestrator)

**ADR** (`Accepted (agent)`, the next free number at landing; F-207, F-309 and F-403 are also taking numbers):
- **Title:** "Make the app read-only below 1024 px with a width media query, canvas and details only, and refusals in the page's stores".
- **It covers:** sections 2.1 to 2.9, points 2 to 14, and the 1.3 measurements.
- **It notes** the type-only `EngineRefusalCode` addition and the WCAG 1.4.4 consideration.
- Add a row to `docs/adr/README.md`.

**Spec, `ux.md` UX-04:** "Below 1024 px wide (CSS pixels of the window or frame; 1024 px is editable) the app is read-only: canvas and details only, with a note that editing needs a larger screen.
- The palette, Files view, code view, undo and redo, node moves, Auto-layout and project creation, renaming and deletion aren't offered.
- Commands are refused and nothing is written to the project.
- Switching projects and workflow tabs, selection, pan, zoom and fit still work.
- Below 640 px the details sit under the canvas.
- Narrowing sends a pending code edit first; widening restores the editing controls and each tab's view mode (ADR …)."

**`features.json` notes:**
- **F-703:** "Verified …: step 1 by `e2e/read-only.spec.ts` (390 px stored project, allow-list, blocked commands, sidecar, transition, 1024 boundary, 640 stacking, 320 reflow, iframe, touch, `@smoke` on three browsers) and the `read-only-phone` and `read-only-narrow` baselines (ADR …). Monaco isn't mounted below 1024 px (F-208's note). F-202's multi-tab note: not UX-04; ADR 0045's last-write-wins stands for v0.1."
- **F-210, F-301 and F-503:** the left column isn't rendered in read-only; commands go through `canvasStore.apply`, which refuses `read-only`.
- **F-302 and F-308:** keep `nodesConnectable` and edge drops off when `readOnly` (`WorkflowCanvas` prop).
- **F-303 to F-306 and F-311:** don't open the popup on double-click or Enter in read-only.
- **F-307:** opening a workflow tab is allowed in read-only; add the breadcrumb to `READ_ONLY_ALLOWED`; take and emit editing stays hidden.
- **F-309:** hide fix buttons via `useReadOnly()`; `applyFix` must go through `send`; place the panel sensibly in the stacked layout. Skip this note if task 5 ran.
- **F-310:** Delete, paste and their keys check `isReadOnly()`.
- **F-312:** documentation fixes are hidden in read-only.
- **F-401 and F-403:** guard `importProject` in the project store like `create`.
- **F-404 and F-406:** Export stays hidden in read-only for v0.1 (point 7).
- **F-504 to F-506:** insert and Make local copy are refused or hidden.
- **F-601 to F-607:** editors aren't shown in read-only; F-605 decides on previews.
- **F-701:** shortcuts check `isReadOnly()`; audit the note and its focus move; decide on "Edit anyway" (WCAG 1.4.4); give touch users the edge types.
- **F-702:** the palette and template prefetch still run on phones.
- **F-704:** the README says small screens get a read-only view.

**Other records:**
- **`progress.md` Decisions:** the ADR, the UX-04 amendment, the refusal code, the sidecar rule, the F-202 note's answer, and the two new baselines.
- **`docs/plan/handoff/README.md`:** an F-703 row; delete this plan in the PR that merges F-703.

## 8. Evidence

The scratchpad is `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`. The probes ran against `/home/user/wt-F-207/apps/web/dist`, served under `/nf-builder/` on port 4190 (the server is stopped), with the sandbox Chromium.

| Probe | Path | Result |
|---|---|---|
| Shell geometry at 390, 1023, 1024 and 320 px, plus the media query | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/probe703/scripts/probe.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/probe703/result.json` | 1.3: document 713 px wide at 390 and 320; `(min-width: 1024px)` false at 1023, true at 1024 |
| Status bar, tab strip, minimap, draggable nodes and controls with `f205-canvas` at 1440 | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/probe703/scripts/status.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/probe703/status.json` | status items 91 + 89 + 128 + 83 px; minimap 200×150; 12 of 12 nodes `.draggable`; five controls including Auto-layout |
| React Flow 13.0.2 keyboard-move gate | `/home/user/wt-F-207/node_modules/.pnpm/@xyflow+react@13.0.2_*/node_modules/@xyflow/react/dist/index.js` (minified) | the arrow-key move filters with the same `nodesDraggable` rule as `getDragItems` |
| zustand 5.1.0 server snapshot | `zustand/esm/react.mjs` | `useSyncExternalStore(..., () => selector(api.getInitialState()))`, hence `…View` components with props in unit tests |

**Files read for the design:**
- **On `origin/main`:** `apps/web/src/` `app-shell.tsx`, `main.tsx`, `shell/*`, `layout/layout-store.ts`, `project/{project-store,project-controls,project-switcher,project-dialogs,project-status}.ts(x)`, `canvas/{canvas-store,canvas-host,workflow-canvas}.ts(x)`, `views/*`, `code/{code-pane,code-editor,text-sync,models,monaco}.ts(x)`, `details/{details-header,details-pane}.tsx`, `history/*`, `styles.css`, `index.html`; `packages/engine/src/service/types.ts`; `playwright.config.ts`; `e2e/{browsers,canvas,projects,details,history,code-view,csp}.ts`.
- **On `feat/F-207`:** the diffs of `canvas-store.ts`, `canvas-host.tsx`, `workflow-canvas.tsx`, `canvas.css`, `engine-client.ts` and `workspace.ts`, and `e2e/layout.ts`.
