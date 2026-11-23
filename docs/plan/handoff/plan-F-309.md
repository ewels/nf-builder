# Plan: F-309, a problems panel that lists errors, warnings and suggestions with their locations and quick fixes, plus the status-bar counts

Planner output, 2026-11-23. I changed nothing in the repository.

**Sources I read:**
- `origin/main`, first at `2c3cc69` and then at `942fada` after F-206 merged as PR #45. I read it through a scratch worktree, which I have since removed.
- `feat/F-208` at `aed70ba` in `/home/user/wt-F-208`.
- The F-206 branch, before it merged.
- `docs/plan/handoff/plan-F-209.md` and its settled points in `handoff/README.md`. F-209 is not started yet.

**What the feature cites:**
- Requirements: UX-03 and LA-30 to LA-36. LA-37 shares the same panel.
- Dependencies: F-112 and F-205.
- ADRs read: 0021, 0039, 0042, 0043, 0046, 0048 (on the F-208 branch) and 0049.

## 0. Scope

**In scope:**
- **Status bar (UX-03):** a problems count (errors plus warnings) and a separate suggestions count. With a project open, both counts are buttons that open the problems panel.
- **Problems panel:**
  - two tabs, Problems and Suggestions;
  - rows grouped by file, each with its severity, message, line and column, and code;
  - a quick-fix button on every fixable row.
- **Diagnostics on the main thread:** a read-only copy of the worker's diagnostics, pulled once per revision. It holds no file text (AR-30).
- **Quick fixes through the engine command path:** a new `EngineApi.applyFix` turns the fix's text edits into F-111's `ReplaceFileText` inside the worker, behind the AR-24 and LA-13 guards. Each applied fix is one F-209 undo step (ADR 0039, ADR 0042).
- **Navigation from a problem:**
  - a problem inside a node selects that node (F-206) and centres it;
  - any other problem shows its file's code at the problem (F-208).
  - Files that have no workflow open in a new tab that shows only code (open point 5).
- **Keyboard and accessibility** for the panel and the status-bar buttons.
- **Oracle fixtures** with known lint results, and the end-to-end tests for both steps.

**Out of scope:**

| What | Owner |
|---|---|
| Drawing type-mismatch edges red, with the diagnostic on hover (UX-24) | F-302, whose step 2 tests it (open point 11) |
| Inline diagnostic markers in Monaco for the file's own diagnostics | F-304 |
| "Migrate to typed" for LA-35 suggestions | F-306 (UX-45) |
| Documentation suggestions and their "open the field" fixes | F-312 |
| The metro-map out-of-date notice in the panel (FI-52) | F-607 |
| Per-workflow suggestion counts and filtering out vendored modules | F-405 |
| Resizing or persisting the panel | open point 2 |
| A global shortcut that opens the panel | F-701 |
| Read-only mode below 1024 px | F-703 |

## 1. Findings

### 1.1 Spec and ADRs
- **UX-03:** "Status bar: problems count, suggestions count (separate, links to the problems panel), node and channel counts for the active canvas, language version."
  - The mockup (`docs/mockup/1-main.png`) shows "No problems" with a check icon, then an underlined "2 suggestions" link, then "7 nodes · 10 channels".
  - The mockup shows no panel at all, so where the panel goes is ours to decide.
- **Severities:**
  - LA-30 to LA-33 are errors. LA-33 is a warning for an unused output.
  - LA-34 and LA-37 are warnings.
  - LA-35 and LA-36 are suggestions.
  - "Every lint message says what to do. Mechanical fixes are offered as quick fixes."
- **AR-05 and ADR 0042:**
  - A quick fix is a list of text edits that becomes `ReplaceFileText` when applied.
  - "A fix is stale once the file changes."
  - Four codes are fixable: `deprecated-channel`, `implicit-it`, `publish-type-ignored` and `duplicate-name`.
  - **No suggestion code is fixable in v0.1.**
- **AR-30 and the architecture data flow:** "The UI keeps a read-only copy of the latest projection and diagnostics". File text never sits on the main thread (ADR 0045). ADR 0049 reads this as "excerpts, never a whole file".
- **ADR 0043:** the API list is extended by ADR 0049 (`details`) and will be extended by F-209 (`undo`, `redo`, `history`, and an `options` argument on `apply`).
- **ADR 0046:** "mismatch red is F-302's and F-309's". F-302's notes and its step 2 own the red edge.
- **ADR 0048 (F-208):**
  - The graph re-fits whenever its pane changes size.
  - Refusal markers use the owner `nf-builder-refusal`.
  - A refused draft is transient and lasts for the session only.
- **UX-20:** "Tabs above the canvas hold open workflows and open files." File tabs are therefore in the spec already, but nothing implements them yet.
- **F-210 note (from F-208):** "an entry file with no workflows gets no tab, so there is no toggle to reach its Code view".

### 1.2 Code as it stands

**Diagnoser** (`packages/engine/src/diagnostics/diagnose.ts`):
- `createDiagnoser({model, projector, catalogue, lints})` returns `{file(path), all()}`, memoised per file.
- Results are sorted by `compareDiagnostics` (path, then start, then code).
- `countDiagnostics` returns `{errors, warnings, suggestions}`.
- A fix comes out as `{title, path, edits}`.
- `applyTextEdits(text, edits)` is in `diagnostics/text-edits.ts`. It throws a `RangeError` on edits outside the text or on overlapping edits.

**Types:**
- `Diagnostic {path, range, severity, message, code, fix?}`.
- `Range {start, end}` are UTF-16 offsets; `line` and `column` are 1-based code points.
- `WorkflowRef {path, name, modelled, typed, range}` is on the main thread in `summary.workflows`.

**Service** (`service/service.ts`):
- `diagnostics()` returns `{revision, diagnostics: diagnoser.all()}`.
- The diagnoser and projector are dropped on every change. They share the projector snapshot, so a `project()` call made first warms the diagnoser.
- The service has no per-file change tracking and no fix API.

**Bridge:**
- `connectEngine` lists every method by hand.
- `withChangeEvents` announces `apply`, `applyPatches` and `writeFiles` to `onEngineChange`.
- F-202's `WorkspaceApi extends EngineApi`, so a new engine method must also be added to `workspace.ts` through `change()` (autosave). The compiler enforces this.

**Status bar and shell:**
- `app-shell.tsx` passes `problems={0} suggestions={0}`.
- `StatusBar` renders plain `<span>` elements using `formatCount`.
- The F-201 full-page baseline (no project) shows "No problems · No suggestions".
- The centre column is `main` (`TabStrip` then `CanvasHost`, or F-208's `TabPanel`).
- Baselines that target `.column-centre`: `canvas-rnaseq-nf-typed-*` and F-208's `view-modes-*`. Any element that is always visible in the centre column would change them.

**Canvas store** (`apps/web/src/canvas/canvas-store.ts`, main):
- F-206 added `selected`, `details` and `select(id)`.
- A non-quiet `load()` clears the selection, so `openWorkflow` on the tab that is already active reloads it and clears the selection.

**F-208 additions** (branch):
- `WorkflowTab.mode`, `session`, `lastChange` (paths only), `setMode`, and `apply(command, session?)`.
- `TabPanel`, `CodePane`, and the lazy `CodeEditor`, with one Monaco model per path.
- The editor follows a clean buffer and keeps a dirty one.

**F-209, as planned and settled:**
- History lives in the service.
- `apply(command, revision, options?: ApplyOptions {group?, label?})`.
- The store gets a serial queue for apply, undo and redo, plus `registerFlush`.
- `HistoryControls`, and the `e2e/history.ts` helpers `historyStatus(page)` and `pressUndo(page)`.
- Settled point 9 adds F-209 to F-309's `depends_on`.

**F-206 additions:**
- `DiagnosticList` with severity words and glyphs, both private to `details/diagnostic-list.tsx`.
- `spansWorkflow` in `details/declaration.ts`, a worker-side module.
- Colour tokens `--color-error`, `--color-warning` (5.85:1) and `--color-suggestion` (6.33:1).

### 1.3 Measurements
Unthrottled Node, pinned corpus, with the model already built. Section 8 has the scripts.

| Pin | Files | `diagnoser.all()` after a change (fresh projector) | Diagnostics | Payload (JSON) | Longest fix edit |
|---|---|---|---|---|---|
| sarek | 885 | 215–221 ms | 729 (131 warnings, 598 suggestions, in 210 files) | 238 kB | 0 chars |
| rnaseq | 900 | 148–153 ms | 506 (81 warnings, 425 suggestions) | 163 kB | 6 chars |
| rnaseq-nf | 35 | 1–2 ms | 9 suggestions | 2.7 kB | – |

- One file (`main.nf`) takes 2–3 ms.
- **What this means:** re-diagnosing the whole project after every change is affordable in the worker. It must not be part of `apply`'s result, because that would add about 200 ms to QA-04 on sarek.

### 1.4 Fixture probe
I drafted a fixture and checked it with the pinned Nextflow 26.10.7 (`lint -o json` and `run -stub`) and with the engine's diagnoser.

`f309-problems/main.nf`:
```
include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    numbers = Channel.of(1, 2)
    LEGACY_COUNT(numbers)
    LEGACY_COUNT.out.view { f -> "count: ${f}" }
}
```

`f309-problems/modules/local/legacy_count/main.nf`: identical to `tools/oracle/cases/f111-start-legacy/modules/local/legacy_count/main.nf`.

**Results:**
- **lint:** 0 errors and 1 warning: main.nf 4:15, "The use of `Channel` to access channel factories is deprecated -- use `channel` instead".
- **run -stub:** exit 0. The process has no stub, so the script ran, as in `f111-start-legacy`.
- **Engine diagnostics:** `{errors: 0, warnings: 1, suggestions: 2}`:
  - `deprecated-channel`: warning, main.nf 4:15, offsets 95–102, fix "Replace `Channel` with `channel`" with edit `{95, 102, "channel"}`;
  - `legacy-workflow`: suggestion, main.nf 3:1, offsets 70–78 (the `workflow` keyword);
  - `legacy-process`: suggestion, `modules/local/legacy_count/main.nf` 1:9, offsets 8–20.
- **Projection of main.nf's entry workflow** (range 70–188):
  - `main.nf#/numbers`, a factory at 95–111, which contains the warning;
  - `main.nf#/LEGACY_COUNT@1`, a call at 116–137;
  - `main.nf#/.view@1`, a chain at 142–186.
- **The three diagnostics cover all three navigation cases:**
  - the warning is inside a node;
  - `legacy-workflow` is inside the workflow but in no node;
  - `legacy-process` is in a file with no workflow.
- **Reading `.out`** avoids an `unused-output` warning. The form follows `f107-legacy-dataflow` (`ONE_UNNAMED.out.view()`, docs/workflow.mdx L608–L629).
- **Fixed variant** (`channel.of`):
  - lint is fully clean, with 0 warnings, so `lint.clean: true` holds;
  - the engine reports only the two suggestions;
  - `applyTextEdits(main.nf, fix.edits)` equals the fixed `main.nf` byte for byte.

## 2. Design

### 2.1 Where diagnostics come from (AR-30, ADR 0043)
- **Pull, per revision, for the whole project.**
  - `EngineApi.diagnostics()` is unchanged. It runs in the worker, is memoised per file within one revision snapshot, and returns `{revision, diagnostics}`.
  - `ProjectChange` stays as it is. Pushing diagnostics with every change would add the lint cost to every `apply` (QA-04).
- **When to pull:** a new `problemsStore` subscribes to the canvas store and pulls when:
  - `session` changes (a project is shown or gone);
  - `summary.revision` changes (from `onEngineChange` → `changed`, or a refusal that adopts a newer revision).
- **Ordering:** the pull is deferred by one macrotask (an injected `schedule`, `setTimeout(0)` by default). The canvas store's `project()` call therefore reaches the worker's serial queue first, and the diagnoser reuses that projector snapshot.
- **Coalescing:** at most one pull is in flight. A request made while one is in flight sets a flag and runs once it settles. A result whose revision isn't the store's current `summary.revision` is dropped and pulled again.
- **What the store holds:** diagnostics are plain data: message, range, code, and fix edits of a few characters at most. That is a read-only copy, not file text. A test guards it (2.8).
- **States:**
  - `idle`: no project; zero counts.
  - `loading`: no result yet for this project.
  - `ready`.
  - `refreshing`: the last counts are kept while a newer revision is pulled.
  - `failed`: carries the message.
- **Not done here:** carrying per-file results over between revisions. ADR 0034's direct-dependants rule doesn't cover inferred workflow emit types, which flow across two levels of includes. This goes to F-702 as a note.

### 2.2 Grouping, sorting and counts
- **Counts (UX-03):** `problems = errors + warnings` and `suggestions` separately, both from `countDiagnostics`.
- **Two tabs:** Problems (errors and warnings) and Suggestions. The tab labels carry their counts.
- **Groups:**
  - Within each tab, rows are grouped by file, in `compareDiagnostics` path order.
  - Each group has a header with the path and a count.
  - Groups don't collapse in v0.1.
- **Order within a group:**
  - Problems: errors before warnings, each in source order (`range.start`, then code).
  - Suggestions: source order.
- **Row contents:**
  - the severity word and glyph (QA-12), from a shared `severity.ts` that F-206's list also uses;
  - the full message, which already includes the ` -- <advice>`;
  - `line:column` (code points, as lint prints them), with a `title` of "Line 4, column 15";
  - the code as muted monospace text;
  - for a fixable row, a button labelled with `fix.title`.
- **Not used:** grouping by rule, and the pack's `lints.codes` on the main thread. Each diagnostic already carries its severity and fix (open point 7).
- **Suggestions** use the same row with `--color-suggestion` and the ◆ glyph. None carries a fix in v0.1. The Suggestions count button opens this tab.

### 2.3 Panel placement and status bar
- **Panel:**
  - `<section id="problems-panel" aria-label="Problems and suggestions">` at the bottom of the centre column (`main`), after the tab panel.
  - Fixed height, `clamp(160px, 30%, 280px)`.
  - Closed by default. While closed it renders nothing, so no `.column-centre` baseline changes.
  - Its open state lasts for the session, in the problems store. There is no resizing and no persistence (open point 2).
  - Opening it shrinks the canvas, and F-208's refit-on-resize re-fits the graph.
- **Status bar:**
  - **No project:** exactly today's spans, so the F-201 baseline is unchanged.
  - **Project open:**
    - two `<button className="status-link">` elements;
    - the problems button shows a glyph: the check icon at 0, the ✕ glyph if there are errors, otherwise ▲;
    - names "1 problem" and "2 suggestions", underlined when non-zero;
    - `aria-controls="problems-panel"`, and `aria-expanded` true when the panel is open on that button's tab;
    - the problems button has the `title` "0 errors, 1 warning".
  - **Activating a count button:**
    - it opens the panel on its tab and moves focus to that tab;
    - it closes the panel when the panel is already open on that tab.
  - **While loading:** one muted item, "Checking for problems…".
  - **State attribute for tests:** `data-diagnostics="loading|ready|refreshing|failed"`.
  - **Failure:** the item reads "Problems unavailable", with the message as its `title`.
  - **Node and channel counts:** hidden when the active tab is a file tab, because there is no canvas.

### 2.4 Navigation
- **Main-thread pure functions in the engine:**
  - `problemTarget(d, summary.workflows)`:
    - the modelled or unmodelled `WorkflowRef` in `d.path` whose range contains `d.range` gives `{kind: "workflow", inside: true}`;
    - otherwise, if the file has any workflow, the entry workflow (else the first) gives `inside: false`;
    - otherwise `{kind: "file"}`.
  - `nodeAtRange(projection, path, range)` returns the innermost node whose range contains the range. Nodes that span the whole workflow (`spansWorkflow`) are excluded.
- **`problemsStore.goTo(d)`:**
  1. **File target:** `openFile(path)` (2.5), then `revealCode(path, range)`.
  2. **Workflow target:** if the tab isn't active, `openWorkflow(path, workflow)`. An active tab is not reloaded, so its selection and viewport are kept.
  3. **Inside a node:** with a ready projection for the file and a node found, `select(node)` (F-206), then `focusOn(node)`. The canvas centres the node at its current zoom with `setCenter`. If the tab is in Split or Code mode, the code is also revealed.
  4. **Otherwise:** a Graph tab switches to Split, and the code is revealed.
- **Reveal:**
  - `reveal: {path, start, end, seq}` lives in the canvas store as offsets only.
  - The lazy `CodeEditor` handles any unseen `seq` for its path, on mount and on change:
    - `model.getPositionAt` for both offsets, clamped automatically;
    - `setSelection`, then `revealRangeInCenterIfOutsideViewport`;
    - `data-selection="L:C-L:C"` on `.code-editor-host` for the end-to-end tests.
- **Focus stays in the panel** (open point 6). The selection is visible in the unfocused editor.
- **Revision drift:** if the projection or buffer has moved on since the diagnosis, the target is the best available. A dirty F-208 draft keeps its text, and offsets are clamped.
- **Refused Code-view drafts (F-208)** are not diagnostics of the saved file. They are neither listed nor counted (open point 10).

### 2.5 File tabs (UX-20; open point 5)
- `WorkflowTab` gains `kind: "workflow" | "file"`.
- `fileTabFor(path)` gives:
  - id `file:<path>`;
  - `workflow: null`;
  - `mode: "code"`;
  - a label of the last two path segments when the file name is `main.nf` (for example `legacy_count/main.nf`), otherwise the file name;
  - `title` set to the full path.
- `openFile(path)`:
  - adds the tab once and activates it;
  - loads no projection; content is `empty`;
  - clears the selection.
- `changed()` doesn't re-project a file tab. `CodePane` follows `lastChange` as F-208 built it.
- `TabPanel` renders only `CodePane` for a file tab, and `TabStrip` shows no view-mode toggle for it.
- G, S and C do nothing on a file tab. The tablist label stays "Workflows" (note for F-210).
- F-209's tab re-pointing skips file tabs.

### 2.6 Quick fixes (ADR 0039, ADR 0042)
- **Engine API:** `applyFix(fix: QuickFix, revision: number, options?: ApplyOptions): Promise<ApplyOutcome>`, where `revision` is the revision of the diagnostics the fix came from. In the worker:
  1. **Stale check, per file (open point 4).**
     - `Open` keeps `openedAt` and `changedAt: Map<path, revision>`.
     - `changedAt` is updated wherever `files` are committed (`changed`, and F-209's `commitFiles`).
     - The `guarded` partial-change path sets `openedAt = revision`.
     - The fix is refused as `stale` when `revision < openedAt`, when `revision > current`, or when `changedAt.get(fix.path) > revision`.
     - The message names the file: "`main.nf` changed after its problems were checked (revision 7). Nothing was changed."
  2. **Text:** `text = model.file(fix.path)?.source.text`.
     - Missing file: refused with `not-found`.
     - A `RangeError` from `applyTextEdits`: refused with `invalid`.
  3. **Command:** `command = {kind: "replaceFileText", path, text: applyTextEdits(text, fix.edits)}`.
  4. **Apply path:** the same internal path as `apply`, with the AR-24 and LA-13 guards, `commit`, and F-209's `record`.
     - The step label is `options.label ?? fix.title`.
     - A result that doesn't parse is refused with `does-not-parse`. ADR 0042 says this can't happen; the test proves it.
- **Bridge:** added to `connectEngine`, `withChangeEvents` (announced) and `workspace.ts` (`change()`, so the fix is autosaved).
- **Store:** `canvasStore.applyFix(fix, revision, session?)`:
  - joins F-209's serial queue;
  - awaits the registered code-pane flushes first, so a pending edit lands first (the fix may then be refused as stale);
  - handles the outcome exactly as `apply` does.
- **`problemsStore.applyFix(d)`:**
  - calls it with `state.revision`;
  - sets `applying` to the row's key, which disables that button;
  - sets the notice to "Applied: Replace `Channel` with `channel`", or to the refusal message.
- **After a stale refusal** the store pulls again, with no automatic retry (as F-209 decided for undo).
- **Undo:** one F-209 step, labelled with the fix title. Ctrl+Z works with focus on a panel button, because F-209's handler ignores only editable targets.

### 2.7 Keyboard and accessibility (QA-10 to QA-13, UX-70)
- **Panel header:**
  - a `role="tablist"` "Problem kinds", with Left/Right arrows and automatic activation (the `left-column.tsx` pattern);
  - a polite `role="status"` notice;
  - a Close button, "Close problems panel".
- **List:**
  - `role="tabpanel"`; each file group is a `<section>` with an `<h3>` and a `<ul>`.
  - Each row `<li>` has a "go" button (severity, message, location, code) and an optional fix button.
  - The list is one Tab stop, with roving `tabindex`:
    - ArrowUp and ArrowDown move between rows across groups;
    - Home and End jump to the first and last row;
    - ArrowRight and ArrowLeft move between a row's go and fix buttons;
    - Enter or Space activates the focused button.
  - The keys are computed by a pure `nextRowFocus` function.
- **After a fix removes its row,** focus moves to the row now in its place, otherwise the row before, otherwise the tabpanel's empty message (`tabIndex=-1`).
- **Escape** inside the panel closes it and returns focus to the status-bar button that opened it (the problems button by default).
- **No global shortcut** (UX-70 lists none); a note for F-701.
- **Colour:** a severity word and glyph on every row, so colour is never the only cue. The tokens already meet QA-13. There is no animation, so `prefers-reduced-motion` is unaffected.

### 2.8 AR-30 guard
A test over the pack's lint fixtures checks that no fix edit carries more than 64 characters of replacement text. That keeps the main-thread copy free of file text. The observed maximum is 7 (`it -> `) on the fixtures and 6 on rnaseq.

### 2.9 Fixtures
- **`tools/oracle/cases/f309-problems/`:** the draft in 1.4.
  - `lint: { expect: ok }` (one warning);
  - `run: { expect: ok }`;
  - `spec: [F-309, UX-03, LA-34, LA-35]`.
- **`tools/oracle/cases/f309-problems-fixed/`:** the same tree with `channel.of`.
  - `lint: { expect: ok, clean: true }`;
  - `run: { expect: ok }`.
- **Sources:**
  - `docs/process.mdx` and `docs/workflow.mdx` (L608–L629, `.out`) at v26.10.7;
  - `docs/reference/channel.mdx`;
  - the pack fixture `deprecated-channel/positive`.
- The builder re-checks the syntax against the v26.10.7 docs and the oracle, and doesn't copy it from this plan unchecked.
- **Reused:** `tools/corpus/fixtures/bad-declaration.nf` (`openBadDeclaration`) for a syntax error (LA-30), and `f205-canvas` for the engine sweep.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/problems/types.ts` | `ProblemsView = "problems" \| "suggestions"`; `ProblemGroup {path; diagnostics: readonly Diagnostic[]}`; `ProblemCounts {errors; warnings; suggestions; problems}`; `ProblemSections {problems: readonly ProblemGroup[]; suggestions: readonly ProblemGroup[]; counts: ProblemCounts}`; `ProblemTarget = {kind: "workflow"; path; workflow: string \| null; inside: boolean} \| {kind: "file"; path}` (all readonly) |
| `packages/engine/src/problems/sections.ts` | `problemsView(d: Diagnostic): ProblemsView`; `problemCounts(list: readonly Diagnostic[]): ProblemCounts`; `problemSections(list: readonly Diagnostic[]): ProblemSections`; `problemKey(d: Diagnostic): string` (`path\0start\0end\0code\0message`, F-206's de-duplication key) |
| `packages/engine/src/problems/target.ts` | `problemTarget(d: Diagnostic, workflows: readonly WorkflowRef[]): ProblemTarget`; `nodeAtRange(projection: Projection, path: string, range: Range): string \| null` |
| `packages/engine/src/problems/index.ts` | re-exports |
| `packages/engine/src/details/node-range.ts` | `rangeContains(outer: Range, inner: Range): boolean`; `spansWorkflow(projection: Projection, node: GraphNode): boolean` (moved from `details/declaration.ts`, which re-imports it; no behaviour change) |
| `packages/engine/test/problems/{sections,target,fixture}.test.ts`, `packages/engine/test/service/apply-fix.test.ts` | section 4 |
| `tools/oracle/cases/f309-problems/**`, `tools/oracle/cases/f309-problems-fixed/**` | 2.9 |
| `apps/web/src/problems/problems-store.ts` | `DiagnosticsStatus = "idle" \| "loading" \| "ready" \| "refreshing" \| "failed"`; `ProblemsState {status; revision: number \| null; diagnostics: readonly Diagnostic[]; sections: ProblemSections; message: string \| null; open: boolean; view: ProblemsView; focus: string \| null; applying: string \| null; notice: string \| null}`; `ProblemsActions {refresh(): Promise<void>; show(view: ProblemsView, focus?: string \| null): void; toggle(view: ProblemsView): void; close(): void; goTo(d: Diagnostic): Promise<void>; applyFix(d: Diagnostic): Promise<ApplyOutcome \| null>}`; `createProblemsStore(o: {engine: () => EngineApi; workspace: StoreApi<WorkspaceState & WorkspaceActions>; schedule?: (fn: () => void) => void}): StoreApi<ProblemsState & ProblemsActions>`; `problemsStore`; `useProblems<T>(selector): T` |
| `apps/web/src/problems/problems-panel.tsx` | `ProblemsPanel(): JSX.Element \| null` (store-connected); `ProblemsPanelView(props: {sections; view; applying: string \| null; notice: string \| null; onView(v: ProblemsView): void; onClose(): void; onGo(d: Diagnostic): void; onFix(d: Diagnostic): void}): JSX.Element` |
| `apps/web/src/problems/problem-row.tsx` | `ProblemRow(props: {diagnostic; tabIndexGo: 0 \| -1; tabIndexFix: 0 \| -1; applying: boolean; onGo(); onFix()}): JSX.Element` |
| `apps/web/src/problems/problem-keys.ts` | `RowFocus {key: string; part: "go" \| "fix"}`; `nextRowFocus(rows: readonly {key: string; fixable: boolean}[], at: RowFocus \| null, key: string): RowFocus \| null`; `focusAfterRemoval(before: readonly string[], after: readonly string[], removed: string): string \| null` |
| `apps/web/src/problems/severity.ts` | `SEVERITY_WORDS: Record<DiagnosticSeverity, string>`; `SEVERITY_GLYPHS: Record<DiagnosticSeverity, string>` (moved from `details/diagnostic-list.tsx`) |
| `apps/web/src/problems/problems.css` | panel, rows, status links |
| `apps/web/test/{problems-store,problems-panel,problem-keys}.test.ts(x)` | section 4 |
| `e2e/problems.ts` | `F309_FIXTURE`, `F309_FIXED`; `openProblemsFixture(page)`; `problemsReady(page)` (`.status-bar[data-diagnostics="ready"]`); `statusCount(page, "problems" \| "suggestions"): Locator`; `problemsPanel(page)`; `problemRow(page, code): Locator`; `editorSelection(page): Promise<string \| null>` (reads `data-selection`); `engineDiagnostics(page)` (through `nfBuilderEngine.diagnostics()`) |
| `e2e/problems.spec.ts` | section 4 |

### 3.2 Change
- **`packages/engine/src/service/types.ts`:** `EngineApi.applyFix(fix: QuickFix, revision: number, options?: ApplyOptions): Promise<ApplyOutcome>`. If F-209 hasn't defined `ApplyOptions`, use `{label?: string}`.
- **`packages/engine/src/service/service.ts`:**
  - `Open.openedAt` and `Open.changedAt`;
  - `applyFix` (2.6), sharing `apply`'s accept and record path.
- **`packages/engine/src/details/declaration.ts`:** import `spansWorkflow` from `node-range.ts`.
- **`packages/engine/src/index.ts`:** export the `problems` module and its types.
- **`apps/web/src/workspace/workspace.ts`:** `applyFix: (fix, revision, options) => change(() => engine.applyFix(fix, revision, options))`.
- **`apps/web/src/engine/engine-client.ts`:** `applyFix` in `connectEngine` and in `withChangeEvents` (announced).
- **`apps/web/src/canvas/canvas-store.ts`:**
  - `WorkflowTab.kind`, `fileTabFor`, `openFile`;
  - `reveal` and `revealCode(path, range: {start; end})`;
  - `focusNode` and `focusOn(id)`;
  - `applyFix(fix, revision, session?)` in the F-209 queue;
  - `changed` and `load` skip file tabs.
- **`apps/web/src/canvas/{canvas-host.tsx, workflow-canvas.tsx}`:** pass `focus: {id; seq} | null`. An effect centres the node at the current zoom once the canvas is ready.
- **`apps/web/src/views/tab-panel.tsx`, `apps/web/src/shell/tab-strip.tsx`** (F-208): file tabs (2.5).
- **`apps/web/src/code/code-editor.tsx`** (F-208): handle `reveal`; set `data-selection`.
- **`apps/web/src/shell/status-bar.tsx`:**
  - props become `{diagnostics: StatusProblems | null; nodes: number | null; channels: number | null; languageVersion}`;
  - `StatusProblems {status: DiagnosticsStatus; counts: ProblemCounts; open: ProblemsView | null; onShow(view: ProblemsView): void}`;
  - `formatCount` is unchanged.
- **`apps/web/src/app-shell.tsx`:** status-bar wiring, `<ProblemsPanel/>` after the tab panel in `main`, and null counts on a file tab.
- **`apps/web/src/details/diagnostic-list.tsx`:** import `severity.ts`. If open point 12 is taken, a "Show in problems panel" button under a non-empty list (`problemsStore.show(view, problemKey(first))`).
- **`apps/web/src/styles.css`:** `.app-columns .column-centre` stays a flex column; the panel is `flex: 0 0 auto`.
- **`tools/oracle/cases/cases.yaml`:** the two cases.
- **`e2e/engine.ts`:** `EngineHook.diagnostics()` and `applyFix()`.
- **Unchanged:**
  - dependencies;
  - dependency-cruiser (`apps/web` still imports only the engine);
  - workflows;
  - stored and exported formats;
  - the AGENTS.md command table;
  - generated files;
  - F-201 and every `.column-centre` baseline.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **engine `test/problems/sections.test.ts`** (synthetic diagnostics) | |
| `F-309 UX-03 LA-34 LA-35: errors and warnings go to Problems and suggestions to Suggestions, each grouped by file in path order` | |
| `F-309: within a file, Problems lists errors before warnings, each in source order; Suggestions keep source order` | |
| `F-309 UX-03: problemCounts counts errors plus warnings as problems and suggestions apart` | agrees with `countDiagnostics` |
| `F-309: problemKey survives structuredClone and tells apart two diagnostics at one range with different codes` | |
| **`test/problems/target.test.ts`** | |
| `F-309 UX-30: a diagnostic inside a workflow's range targets that workflow with inside true` | including an unmodelled workflow |
| `F-309 UX-27: a diagnostic outside every workflow of a file with workflows targets the file's entry workflow, else its first, with inside false` | |
| `F-309 UX-20: a diagnostic in a file without workflows, or in a config file, targets a file tab` | |
| `F-309 UX-30: nodeAtRange gives the innermost node containing the range, never a params or output node spanning the workflow, and null for another path or no node` | |
| **`test/problems/fixture.test.ts`** | |
| `F-309 step 1 LA-34 LA-35: f309-problems has one fixable deprecated-channel warning in main.nf and the legacy-workflow and legacy-process suggestions; f309-problems-fixed has only the two suggestions` | exact codes, paths, line:column and severities (1.4) |
| `F-309 UX-03: the f309 targets: the warning selects main.nf#/numbers, legacy-workflow reveals main.nf's code, legacy-process opens a file tab` | |
| `F-309 AR-30 ADR-0042: no quick fix in the pack's lint fixtures carries more than 64 characters of replacement text` | |
| **`test/service/apply-fix.test.ts`** (real service) | |
| `F-309 step 2 ADR-0042 AR-05: applyFix applies the deprecated-channel fix as one ReplaceFileText; main.nf equals f309-problems-fixed byte for byte and the next diagnostics have no warning` | the change's `files` and revision + 1 |
| `F-309 ADR-0042: a fix is refused as stale once its file changed after the diagnosed revision, and still applies after a change to another file` | nothing changed on refusal |
| `F-309 ADR-0039 AR-24: a fix whose result doesn't parse is refused with does-not-parse and changes nothing` | synthetic fix |
| `F-309: applyFix refuses an unknown path (not-found), edits outside the text (invalid), a revision from before the open or after the current one (stale), and no project (no-project)` | |
| `F-309 F-209 AR-23: an applied fix is one undo step labelled with the fix title; undo restores main.nf byte for byte` | |
| `F-309 ADR-0003: applyFix results survive structuredClone` | |
| **web `workspace.test.ts`** (extend) | |
| `F-309 IO-01: applyFix is autosaved like apply; a refused fix saves nothing` | |
| **`engine-client.test.ts`** (extend) | |
| `F-309: the facade forwards applyFix and announces its change to onEngineChange listeners` | |
| **`problems-store.test.ts`** (fake engine and a real canvas store over it) | |
| `F-309 UX-03 AR-30: showing a project pulls the diagnostics after the projection request and keeps them with their revision` | call order recorded by the fake |
| `F-309: each new revision pulls again; one pull is in flight, the latest revision wins and an older result is dropped` | |
| `F-309: closing or switching the project resets the diagnostics and closes the panel` | |
| `F-309 ADR-0042: a fix is sent with the diagnostics' revision and announces its title; a stale refusal pulls again and announces the refusal, with no retry` | |
| `F-309 UX-03: toggle opens the panel on a tab, switches tabs, and closes it on the open tab` | |
| `F-309 UX-30: goTo selects the innermost node of a diagnostic inside a workflow, without reloading an active tab, and asks the canvas to centre it` | |
| `F-309 UX-27: goTo reveals a diagnostic outside every node in its file's code, switching a Graph tab to Split; a file without workflows opens a Code-only file tab` | |
| **`canvas-store.test.ts`** (extend) | |
| `F-309 UX-20: openFile adds one Code-only file tab per path; activating it loads no projection and clears the selection` | |
| `F-309: a change with a file tab active re-projects nothing` | |
| `F-309 F-209: applyFix runs in the store queue after the registered code-pane flushes, at the given revision, and adopts the result like apply` | |
| `F-309 AR-30: revealCode and focusOn record requests with rising sequence numbers, holding offsets and ids, never text` | |
| **`status-bar.test.tsx`** (extend) | |
| `F-201 F-309 UX-03: without a project the counts are plain text, as in F-201's baseline` | |
| `F-309 UX-03: with a project the problems and suggestions counts are buttons controlling the problems panel, with aria-expanded and the errors and warnings in the problems title` | |
| `F-309 UX-03: before the first result the bar reads "Checking for problems…"; node and channel counts are hidden for a file tab` | |
| **`problems-panel.test.tsx`** (static markup) | |
| `F-309 UX-03 QA-12: each row shows a severity word and glyph, the message, its line and column, and the code` | |
| `F-309 ADR-0042: a fixable row has a button named by the fix title, disabled while that fix is applying` | |
| `F-309 UX-03: the tabs show their counts, and an empty tab reads "No problems" or "No suggestions"` | |
| `F-309 QA-11: the list has exactly one tab stop` | one `tabindex="0"` |
| **`problem-keys.test.ts`** | |
| `F-309 UX-70 QA-11: ArrowUp and ArrowDown move between rows across files, Home and End go to the ends, ArrowRight and ArrowLeft move between a row's go and fix buttons` | |
| `F-309 QA-11: after a fix removes its row, focus goes to the row in its place, else the one before, else the list` | |
| **`tab-panel.test.tsx`** (extend) | |
| `F-309 UX-20: a file tab shows only the code pane, and the tab strip shows no view-mode toggle for it` | |
| **`details-pane.test.tsx`** (extend; only with open point 12) | |
| `F-309 F-206 UX-30: a node with problems offers "Show in problems panel"; a clean node doesn't` | |
| **e2e `e2e/problems.spec.ts`** (Chromium) | |
| `F-309 step 1 UX-03 LA-34 LA-35: the legacy fixture counts 1 problem and 2 suggestions separately, and the panel lists each under its own tab` | status-bar buttons "1 problem" and "2 suggestions"; tabs "Problems 1" and "Suggestions 2"; the warning only under Problems; the two suggestions under `main.nf` and `modules/local/legacy_count/main.nf` |
| `F-309 UX-03 AR-05: the panel lists exactly the engine's diagnostics` | row counts per severity equal `engineDiagnostics` on f309 and f205-canvas |
| `F-309 step 2 ADR-0042 AR-23: applying the Channel.of quick fix removes the warning and writes channel.of; one undo restores the file and the warning` | 1. Click "Replace `Channel` with `channel`".<br>2. Expect "No problems" and still "2 suggestions"; `readFile` equals `f309-problems-fixed/main.nf`.<br>3. Expect `historyStatus` undoCount + 1, with the fix title as its label.<br>4. Press Ctrl+Z with focus in the panel.<br>5. Expect `readFile` byte-identical to `f309-problems/main.nf`, "1 problem", the row back, and undoCount back.<br>Also: no CSP violation or console error (`watchForCspViolations`). |
| `F-309 UX-30: activating a problem inside a node selects and centres that node, and the details pane lists the problem` | pan away first; then `main.nf#/numbers` is selected and inside the canvas box |
| `F-309 UX-27: activating a problem outside every node shows its file's code in Split view with the problem selected` | legacy-workflow: `data-view-mode="split"`, `data-selection="3:1-3:9"`, focus still on the row |
| `F-309 UX-20: activating a problem in a file without a workflow opens a Code tab for that file at the problem` | legacy-process: the tab `legacy_count/main.nf` and `data-selection="1:9-1:21"` |
| `F-309 LA-30: a syntax error is listed under Problems as an error and opens the code at its position` | `openBadDeclaration` |
| `F-309 UX-70 QA-11: the status bar, the panel's tabs, rows and fix buttons work by keyboard, and Escape returns focus to the status bar` | |
| `F-309 UX-03: the problems panel and the status-bar counts match their approved baselines @visual` | `#problems-panel` on the Problems tab and `footer.status-bar`, for f309; baselines come from CI only |

## 5. Tasks

**Starting point:** branch `feat/F-309` from `main` once F-208 and F-209 have merged (open point 1). Run `pnpm check` before every commit. The end-to-end tests need `PW_CHROMIUM_EXECUTABLE` in the sandbox.

1. **Fixtures and pure problem views (engine).**
   - Files:
     - the two oracle cases and their `cases.yaml` entries;
     - `problems/{types,sections,target,index}.ts`;
     - the `node-range.ts` move;
     - the exports;
     - `test/problems/*`.
   - Done when these pass:
     - `pnpm oracle -- --case f309-problems --case f309-problems-fixed`;
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm check`.
2. **`applyFix` in the service.**
   - Files: `types.ts`, `service.ts` (`openedAt`, `changedAt`, the shared apply path with F-209's `record`), `test/service/apply-fix.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/service test/problems test/history` and `pnpm check` pass.
3. **Bridge and workspace.**
   - Files: `workspace.ts`, `engine-client.ts` (facade and announce), `e2e/engine.ts`, and their unit tests.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-113|F-202"` pass.
4. **Problems store and status-bar counts.**
   - Files:
     - `problems-store.ts` (pull, coalescing, panel state, `applyFix`; `goTo` stubbed to `show`);
     - the canvas store's `applyFix`;
     - the status-bar props and wiring in `app-shell.tsx`;
     - `severity.ts`;
     - the store and status-bar unit tests;
     - `e2e/problems.ts`, and the counts part of the step 1 end-to-end test.
   - Done when these pass:
     - `pnpm check`;
     - `pnpm test:e2e -- --grep "F-309 step 1|F-201|F-205"`.
5. **Panel, keyboard and quick fix.**
   - Files:
     - `problems-panel.tsx`, `problem-row.tsx`, `problem-keys.ts` and the CSS;
     - the panel inside `main`;
     - the unit tests;
     - the full step 1 test, the step 2 test, the sweep test and the keyboard end-to-end test.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-309|F-209|F-208|F-206|F-201"`;
     - `pnpm smoke`, in under 60 s.
6. **Navigation.**
   - Files:
     - file tabs (canvas store, `TabPanel`, `TabStrip`);
     - `revealCode` and `focusOn`;
     - the code editor's reveal and the canvas focus effect;
     - `goTo`;
     - the details link (open point 12);
     - their unit tests, and the four navigation end-to-end tests.
   - Done when the task 5 commands pass again.
7. **Visual tests.**
   - Files: the `@visual` test.
   - Done when `pnpm check` passes and the PR's Chromium job runs it. The orchestrator then views each `-actual.png` from the `playwright-chromium` artefact and commits it (ADR 0021). CI must then be green, with the F-201, F-205, F-206 and F-208 baselines unchanged.
8. **Records** (section 7).
   - Done when `pnpm check` and the Scope guard pass.

## 6. Open points (recommendations only; none decided here)

1. **Order and `depends_on`.**
   - Step 2 needs F-209's undo.
   - Navigation needs F-208's Code view and F-206's selection; F-206 has merged.
   - F-209 also rewrites `service.ts` and the store queue, so building the two in parallel would conflict.
   - **Recommend:** start F-309 after F-208 and F-209 merge. F-209's PR adds F-209 to F-309's `depends_on` (settled point 9). F-309's PR makes no other `depends_on` change, so it needs no `scope-change` label; F-206 is recorded in the notes. Rebase every F-209 name used here (`ApplyOptions`, `registerFlush`, `historyStatus`, `pressUndo`) on F-209 as built.
2. **Panel placement.** Decide and record; a persisted size would be a stored format.
   - **Recommend:** the bottom of the centre column, closed by default, fixed height, open state for the session only. The `nf-builder:layout` format is unchanged.
   - **Alternatives:**
     - a Details/Problems switch in the right column (narrow, hides the details, and changes the F-201 and F-206 baselines);
     - an overlay on the canvas (would cover React Flow's attribution and controls, against ADR 0046);
     - resizable and persisted (bumps ADR 0021's format; later, if wanted).
   - **Accepted cost:** opening the panel re-fits the graph (ADR 0048).
3. **Pull, per revision, for the whole project** (2.1). `diagnostics()` and `ProjectChange` are unchanged.
   - **Recommend:** accept.
   - **Note for F-702:** about 215 ms of worker time per change on sarek. A per-file carry-over needs a transitive dependency rule first, because inferred emit types cross two levels of includes.
4. **`EngineApi.applyFix` with a per-file stale check** (2.6). This amends ADR 0043's API list and clarifies ADR 0042's "stale once the file changes". Decide and record.
   - **Recommend:** accept. All four fixable codes depend only on their own file's text.
   - **Alternatives:**
     - the global revision (simpler, but refuses after a change to any file);
     - building `ReplaceFileText` on the main thread (moves file text to the main thread, against AR-30 and ADR 0045);
     - a new `EditCommand` kind (ADR 0042 and F-112 kept the command union unchanged).
5. **Code-only file tabs** (2.5). UX-20 already says tabs hold open files.
   - **Recommend:** add them, so every problem is reachable. F-210, F-605 and F-601 reuse `openFile`.
   - **Alternative:** problems in files without a workflow are listed but can't be activated until F-210. That leaves LA-35 module suggestions and config errors unreachable.
6. **Navigation rules** (2.4): select and centre a node; otherwise reveal the code (Split for a Graph tab, Code for a file tab); focus stays in the panel.
   - **Recommend:** accept, with a note for F-701 on moving focus to the editor.
   - **Alternative:** move focus to the editor on Enter. That makes stepping through problems by keyboard awkward.
7. **Grouping and sorting** (2.2): two tabs, file groups in path order, errors before warnings, source order, no collapsing, no grouping by rule, no `lints.codes` on the main thread.
   - **Recommend:** accept. F-405 may add filters for vendored modules.
8. **UX-03 reading:**
   - "problems" means errors plus warnings;
   - both counts open the panel;
   - the bar reads "Checking for problems…" before the first result;
   - with no project the counts stay plain text;
   - node and channel counts are hidden on a file tab.
   - **Recommend:** amend UX-03 to say so. This is spec behaviour, so record it in the ADR.
9. **Step 2 wording.** `deprecated-channel` is an LA-34 warning, and no v0.1 suggestion is fixable (ADR 0042).
   - **Recommend:** keep the step text (editing a step needs the label). Read "the suggestion disappears" as "the diagnostic disappears", record that in the ADR and F-309's notes, and have the test assert both that the warning disappears and that the suggestions count is unchanged.
10. **Refused Code-view drafts** (F-208) are neither listed nor counted.
    - **Recommend:** accept, as F-208 recorded.
11. **Mismatch-red edges.**
    - **Recommend:** F-302 does it; its step 2 tests it, and F-112's note already says how. F-309 provides the main-thread diagnostics through `useProblems`.
    - **Alternative:** do it here. That is beyond F-309's steps and description.
12. **Details-pane link** (F-206's note).
    - **Recommend:** one "Show in problems panel" button under a non-empty Problems list in the details pane, which opens the panel and focuses that node's first problem. It is small, and the F-206 baselines don't change, because TRIM has no problems.
    - **Alternative:** defer, with a note.
13. **Keyboard model** (2.7), with no global shortcut.
    - **Recommend:** accept, with notes for F-701 (a shortcut, and an audit of the roving list) and F-703 (hide fix buttons in read-only mode).
14. **AR-30 guard** (2.8): the 64-character cap on fix edits.
    - **Recommend:** accept. A pack fix that needs more text would be a different kind of fix (F-312).

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** none.
- **Package boundaries or dependency-cruiser rules:** none.
- **Stored or exported format:** none. Panel state is session-only (point 2).
- **Workflows:** none. The oracle job picks up the new cases.
- **`features.json` beyond `passes` and `notes`:** none in F-309's PR, if F-209's PR adds the dependency (point 1).
- **ADR interplay:** amends ADR 0043's API (point 4) and clarifies ADR 0042's staleness rule (point 4).
- **Spec behaviour:** UX-03 (point 8), and UX-20 file tabs (point 5).
- **Open questions:** none relevant.

## 7. Records (drafts for the orchestrator)

**ADR** (`Accepted (agent)`, the next free number at landing; F-207 and F-209 take the next ones):
- **Title:** "Problems panel: diagnostics pulled per revision into a bottom panel, with navigation, Code-only file tabs and quick fixes through EngineApi.applyFix".
- **It covers:** sections 2.1 to 2.8, points 2 to 10 and 12 to 14, and the measurements in 1.3.
- **It amends** ADR 0043's API list and clarifies ADR 0042.
- Add a row to `docs/adr/README.md`.

**Spec:**
- **`ux.md` UX-03:**
  - problems are errors plus warnings;
  - both counts open the problems panel at the bottom of the centre column;
  - a problem selects its node or shows its code;
  - fixable problems offer their quick fix (ADR …).
- **`ux.md` UX-20:** files without a workflow open in a Code-only tab (ADR …).

**`features.json` notes:**
- **F-309:** "Verified …: step 1 by `e2e/problems.spec.ts` and `test/problems/fixture.test.ts` on the f309-problems oracle case; step 2 by the quick-fix and undo end-to-end test and `test/service/apply-fix.test.ts`. The step's 'suggestion' is the `deprecated-channel` warning (LA-34); no v0.1 suggestion is fixable (ADR 0042). F-206 is a dependency in practice."
- **F-302:** `useProblems` holds the diagnostics at the canvas revision. Map `type-mismatch` to the edge through its port's argument range.
- **F-304:** use a marker owner other than `nf-builder-refusal` for the file's own diagnostics, fed from `problemsStore`.
- **F-306:** offer "Migrate to typed" on LA-35 rows.
- **F-312:** `QuickFix` holds only text edits. "Open the right field" needs a new fix kind, and the panel's fix button must dispatch on it.
- **F-405:** the status bar already counts suggestions; filter vendored modules in the panel.
- **F-607:** FI-52's notice needs a non-diagnostic panel item.
- **F-210, F-605 and F-601:** reuse `openFile`. The tablist is still labelled "Workflows". Config files open in Monaco until F-601.
- **F-701:** a shortcut for the panel; audit the roving list and focus on activation.
- **F-702:** about 215 ms of re-diagnosis per change on sarek; a carry-over needs transitive dependants.
- **F-703:** hide fix buttons in read-only mode.

**Other records:**
- **`progress.md` Decisions:** the ADR, `applyFix`, the panel placement, file tabs, the UX-03 and UX-20 amendments, the step 2 reading, and the new baselines.
- **`docs/plan/handoff/README.md`:** an F-309 row; delete this plan in the PR that merges F-309.

## 8. Evidence

The scratchpad is `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`. The probes ran with the node_modules and corpus of `/home/user/wt-F-206`; that worktree was removed after F-206 merged, and the results are saved below.

| Probe | Path | Result |
|---|---|---|
| `diagnoser.all()` timing and payload on sarek, rnaseq and rnaseq-nf | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/diagprobe/probe.test.ts`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/diagprobe/result.txt` | table in 1.3 |
| Draft fixture under the engine: diagnostics, fix, projection nodes and workflows | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/diagprobe/fixture.test.ts`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/diagprobe/fixture.txt` | 1.4 |
| Draft trees, linted and run with pinned Nextflow 26.10.7 (`/home/user/.nfcache/nextflow-26.10.7-dist`, oracle environment, a copied `NXF_HOME`) | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/nfprobe/f309-problems/`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/nfprobe/f309-fixed/` | problems: 0 errors, 1 warning (4:15), `run -stub` exit 0; fixed: 0 errors, 0 warnings |
| Pack evidence for the warning-only lint result | `packages/lang-2610/test/lints/fixtures.json` entry `deprecated-channel/positive` | `lint: []`, one warning |

**Files read for the design:**
- `apps/web/src/canvas/canvas-store.ts`, `app-shell.tsx` and `shell/status-bar.tsx` on `origin/main` at `942fada`;
- F-208's `canvas-store.ts`, `views/tab-panel.tsx`, `code/code-editor.tsx` and `e2e/code-view.ts` at `aed70ba`;
- `packages/engine/src/{diagnostics,service}/*` and `packages/lang-2610/src/lints/{codes,deprecated,legacy,calls}.ts` on main.