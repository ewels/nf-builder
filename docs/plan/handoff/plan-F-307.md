# Plan: F-307, workflow tabs: double-click a workflow node opens its canvas tab with a breadcrumb; editing take or emit updates ports at every call site

Written by the planner on 2026-11-28 from `origin/main` at `d0cea22` (F-605 merged), with F-301 in review on `feat/F-301` (`/home/user/wt-F-301`, committed head `e292d42`, which adds `CreateWorkflow`, `freshName`, `addFromPalette` and `CanvasContent.refit`). I changed nothing except this file. Paths are relative to the repository root. Nextflow syntax below was checked with the pinned 26.10.7 dist in `.cache/nextflow/` (section 8), not from memory.

## 0. Scope

**In scope:**
- **Open a workflow** (UX-50, UX-40's exception): double-click a call node whose callee is a resolved workflow or pipeline, or press Enter on such a node once it is selected, opens or focuses the canvas tab of its **definition** (aliases resolved), in read-only too (F-703 note).
- **Breadcrumb** (UX-50): above a workflow tab's canvas, the path from the entry workflow to this one; each ancestor is a button that opens or focuses its tab ("back navigation").
- **Take and emit editing** (UX-51, AR-21): two new commands, `AddTake` and `AddEmit`, reached from the Take and Emit sections of the workflow summary in the details pane (UX-31). Call sites gain the port through the projection; hidden in read-only (F-703 note).
- **Closing workflow tabs** (F-210 note): `closeTab` and Delete extend to workflow tabs (open point 6).
- Take and emit pills on the left and right already exist (F-106 projection, F-205 layout puts `take` first and `emit` last); step 1 only asserts them.

**Out of scope (spec gaps, open point 1):**
- **Removing and renaming** takes and emits. UX-51 asks for them; the steps don't; `DeleteNode` refuses take and emit on purpose; no feature owns a workflow Configure popup (F-303 is typed processes only; UX-46 names take and emit rows).
- Setting a take's or emit's type after creation, doc comments on them (UX-46, F-312).
- Opening unresolved, unparsed or plugin callees (they say why instead, 2.1).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-50:** "Opening a workflow node opens or focuses a canvas tab for its definition. A breadcrumb shows the path from the entry workflow, with back navigation."
- **UX-51:** take pills left, emit pills right; "Adding, removing or renaming them updates the ports of every call site."
- **UX-40:** "Double-clicking a node (or Enter on a selected node) opens a modal … Workflow nodes are the exception: double-click opens the workflow in a canvas tab." I read Enter on a selected workflow node as the keyboard route (UX-70; F-701 note: Enter and Space select a focused node, so the second Enter opens).
- **UX-04 / ADR 0056:** switching workflow tabs works read-only; `READ_ONLY_ALLOWED` (`e2e/read-only.ts`) must list every new visible control or the test fails.
- **ADR 0055:** "workflow tabs stay F-307's"; file tabs close with Delete (`aria-keyshortcuts="Delete"`) and a pointer-only `aria-hidden` ×.
- **AR-21** lists `AddTake` and `AddEmit`; **AR-22** keeps undeclared targets equivalent; **AR-24** refuses output that doesn't parse; **ADR 0039** patches whole declarations through `reprintDeclaration`; **LA-13** refuses mixed typed and legacy.
- **No spec text** says what the breadcrumb shows when a workflow is opened other than from a canvas, what a new take's or emit's type and value are, what happens to call-site arguments, or which tabs can close.

### 1.2 Code on main
- `canvasStore.openWorkflow(path, workflow)` = `openTab(tabFor(...))`; nothing in the canvas calls it (only the problems store and the test hook). `closeTab` returns early for workflow tabs; `TabStripView`'s Delete handler only closes file tabs.
- `changed()` re-keys renamed workflow tabs (`renamedTabs`) and rebuilds them with `tabFor`, keeping only `mode`; anything F-307 adds to `WorkflowTab` must be carried there.
- `WorkflowCanvas` (`@xyflow/react` 13.0.2) has `onNodeClick` but no double-click handler; `zoomOnDoubleClick` is at its default (on).
- `Callee.name` is the **local** name (an alias stays an alias); `Callee.path` is the defining file; `kind` is `workflow` or `pipeline` (a pipeline's definition is the entry workflow of `path`). `resolveCallee(model, path, name)` (`packages/engine/src/details/declaration.ts`) gives the declaration in the worker.
- `WorkflowSummaryView` (`apps/web/src/details/workflow-summary.tsx`) already shows Take and Emit sections ("None" when empty) for named workflows.
- `WorkflowDef.takes: Section<TypedName> | null`, `emits: Section<NamedOutput | ExpressionStatement> | null`. `DeleteNode` notes that Nextflow rejects an empty `main:` and that `take:` needs `main:` or `emit:` after it.
- The pack lint `packages/lang-2610/src/lints/calls.ts` already reports "Workflow `X` expects N argument(s) but received M", so call sites left short show in the problems panel.
- `Connect` pads missing positional arguments with `null` and fills an unfed port; `Disconnect` writes `null` (LA-33). So an unfed trailing port is connectable today.
- No fixture has a workflow `ALIGN`; `tools/oracle/cases/f205-canvas/workflows.nf` (`SHOUT`) is the nearest. F-307 adds its own case.

### 1.3 Nextflow behaviour (checked against 26.10.7, section 8)
1. A typed take `index: Channel<String>` added to `ALIGN`, call `ALIGN(reads)` unchanged: lint **error** `Workflow \`ALIGN\` expects 2 argument(s) but received 1` plus warning "Parameter was not used"; `run -stub` fails "Script compilation failed".
2. The same call padded `ALIGN(reads, null)` or `ALIGN(reads, channel.empty())`: lint clean apart from the unused-parameter warning; stub run succeeds.
3. An untyped take in a typed workflow: warning "Typed workflow input should have a type annotation".
4. A workflow with `take:` and nothing after it: **parse error** ("Unexpected input: '}'"). `take:` + `main:` or `take:` + `emit:` parse and run.
5. New emit: `extra: Channel<String> = channel.empty()`, `extra: Channel<String> = null`, `extra: Value<String> = null` and `extra = null` all lint clean and stub-run; `extra: Value<String> = channel.empty()` is a type **error**; `extra: Channel<String>` with no value is "`extra` is not defined".
6. **Going from one emit to two breaks direct consumers:** with `bam` and `extra`, `aligned = ALIGN(reads); aligned.view()` fails lint ("Unrecognized method `view` for type Record { bam: … }"); with one emit, `aligned.bam` fails instead. (Open point 4.)

## 2. Design

### 2.1 Opening a workflow
- **Engine:** `EngineApi.calleeWorkflow({path, workflow, node})` returns the definition's `WorkflowRef` (from `summary.workflows`) or a refusal: `not-found` with "X isn't defined in this project, so it has no canvas." (unresolved, plugin), "X couldn't be parsed, so there is no canvas to show." (unparsed), "X is a process." (not a workflow). It uses `resolveCallee`, so aliases open the definition (`include { ALIGN as A }` opens `ALIGN`). No projection type change, so no snapshot churn (open point 2).
- **Store:** `openCallee(node: string): Promise<OpenCalleeOutcome>` on the active workflow tab: calls `calleeWorkflow`, then opens or focuses `tabFor(ref)` with `trail = [...active.trail, crumbOf(active)]` (2.2). A refusal goes to a `navigationNotice` the canvas shows in its existing `role="status"` notices.
- **Canvas:** `onNodeDoubleClick={(_, n) => onOpen(n.id)}` only when `n.data.view.opens` (a new pure flag from `canvasView`: call node with callee kind `workflow` or `pipeline`); `zoomOnDoubleClick={false}` so the viewport doesn't jump (open point 9). Enter on a focused node that is already selected and `opens` calls `onOpen`; the node description gains "Press Enter again to open this workflow." for such nodes. Works read-only.

### 2.2 Breadcrumb
- `WorkflowTab` gains `trail: readonly Crumb[]`, `Crumb = {path: string; workflow: string | null; label: string}`, ancestors from the entry workflow down, empty for the entry. Session-only, like `mode`.
- **Set by:** `openCallee` (the path the user took; re-opening a tab from another parent replaces its trail); `openWorkflow`, `openFile`, `openPath` and the problems panel use `EngineApi.callPath(ref)`, the shortest call path from the project's default workflow found by a breadth-first search over call nodes in the worker, or `[]` when the workflow isn't reachable (open point 3).
- **Kept current:** `changed()` carries `trail` through renames (crumbs mapped through `renamedTabs`) and drops crumbs whose workflow is gone.
- **UI** (`apps/web/src/canvas/breadcrumb.tsx`): in the tab panel above the canvas, for workflow tabs only (Graph and Split; not in Code mode, which has no canvas). `<nav aria-label="Workflow path"><ol>`: each crumb a `<button type="button">` calling `openWorkflow(crumb.path, crumb.workflow)` (which keeps that tab's own trail), separated by an `aria-hidden` "›"; the current workflow last as text with `aria-current="page"`. The entry crumb's label is its file name (`main.nf`), a named one its workflow name. A tab with an empty trail shows only itself. Shown read-only.

### 2.3 Commands (engine)
- **`AddTake {kind: "addTake"; target: WorkflowTarget; name: string; type: string | null}`**: appends `name: <type>` (typed) or `name` (legacy) to `take:`, creating the section when absent, through `reprintDeclaration`. Refuses: the entry workflow ("The entry workflow has no take; use params."); an invalid identifier or a name already used in the workflow (`namesInWorkflow`) or a builtin; a type on a legacy workflow; a typed workflow with no type (1.3.3; open point 5); a type text that doesn't parse as a type; a body with no `main:` and no `emit:` (1.3.4: "Add a step or an emit to X first; Nextflow needs one after take."). **Call sites are not edited** (open point 4): the projection gives each call the new unfed input port; Nextflow and the pack lint report the short argument list until the user connects it.
- **`AddEmit {kind: "addEmit"; target; name; type: string | null}`**: appends `name: <type> = null` (typed) or `name = null` (legacy, open point 5) to `emit:`, creating it when absent. Same name and type checks. **Refuses when the workflow has exactly one emit** ("X's only emit is read directly at its call sites; adding a second one would break them.", 1.3.6; open point 4). The emit pill's input is then connectable with `Connect` (it already targets emit nodes).
- Labels: `Add take <name> to <WF>`, `Add emit <name> to <WF>`. Both in `EDIT_COMMAND_KINDS` after F-301's `createWorkflow`, so the fast-check harness and `test:corpus` exercise them.

### 2.4 Take and emit forms (web)
- `WorkflowSummaryView` gains, under Take and Emit for a named workflow (not the entry, not read-only, not an unparsed or legacy-mixed file): an "Add take" / "Add emit" button opening an inline form: Name (text), Type (text, typed workflows only, placeholder `Channel<Path>`), Add and Cancel. Enter submits, Escape cancels; focus returns to the button.
- Submit calls `canvasStore.apply({kind: "addTake", target: tab, name, type}, session)`; a refusal shows its message under the form (`role="alert"`), success closes the form and announces "Added take index to ALIGN." in a polite live region (open point 7).

### 2.5 Closing workflow tabs
`closeTab` accepts workflow tabs except the tab of the project's default workflow (open point 6); the strip gives closable workflow tabs the same `aria-keyshortcuts="Delete"` and pointer-only ×. Closing the active tab keeps F-210's rule (previous, else next).

### 2.6 Copy (British English, sentence case)
| When | Text |
|---|---|
| Node description (opens) | "Press enter or space to select this node, then Enter again to open this workflow." |
| Not openable | see 2.1 |
| Form labels | "Add take", "Add emit", "Name", "Type", "Add", "Cancel" |
| Added | "Added take index to ALIGN." / "Added emit log to ALIGN." |
| Breadcrumb | `nav` "Workflow path"; crumbs as labels |

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/edit/commands/take-emit.ts` | `addTake(state: EditState, command: AddTake): TextPatch[]`; `addEmit(state: EditState, command: AddEmit): TextPatch[]` |
| `packages/engine/src/navigation.ts` | `calleeWorkflow(model: ProjectModel, projection: Projection, node: string, workflows: readonly WorkflowRef[]): WorkflowRef \| CalleeRefusal`; `callPath(model: ProjectModel, project: (ref: WorkflowRef) => Projection \| null, from: WorkflowRef, to: WorkflowRef): WorkflowRef[] \| null` (BFS, visited set, ancestors only) |
| `packages/engine/test/edit/take-emit.test.ts`, `packages/engine/test/navigation.test.ts` | section 4 |
| `tools/oracle/cases/f307-workflow-tabs/**` | `main.nf` (typed entry: `reads = channel.of('a', 'b')`, `aligned = ALIGN(reads)`, `aligned.view()`), `subworkflows/local/align/main.nf` (typed `ALIGN`: take `reads: Channel<String>`, `main:` calls `SORT`, emit `bam: Channel<String>`), `subworkflows/local/sort/main.nf` (typed `SORT`, one take, two emits `sorted` and `log`), plus `include { ALIGN as MAP } …` and a second call `MAP(reads)` for the alias test. `cases.yaml`: `lint: {expect: ok, clean: true}`, `run: {expect: ok, args: ["-stub"]}`, `spec: [F-307, UX-50, UX-51]` |
| `tools/oracle/cases/f307-add-take/**` | written by the golden test: the case above after `AddTake index: Channel<String>` on `ALIGN`. `lint: {expect: error, errors: ["Workflow \`ALIGN\` expects 2 argument(s) but received 1"]}`, `run: {expect: error, output: ["Script compilation failed"]}` (1.3.1; open point 4 changes this) |
| `tools/oracle/cases/f307-add-emit/**` | the first case after `AddEmit extra: Channel<String>` on `SORT`, which has **two** emits (`sorted`, `log`; ALIGN reads `SORT(...).sorted`), so the refusal in 2.3 doesn't apply; lint clean, stub ok |
| `apps/web/src/canvas/breadcrumb.tsx` | `Breadcrumb({tab, onOpen}: {tab: WorkflowTab; onOpen(crumb: Crumb): void}): JSX.Element \| null`; `crumbLabel(crumb: Crumb): string` |
| `apps/web/src/details/port-form.tsx` | `PortForm({role, typed, onSubmit, onCancel}: {role: "take" \| "emit"; typed: boolean; onSubmit(name: string, type: string \| null): Promise<string \| null>; onCancel(): void}): JSX.Element` (resolves to an error message or null) |
| `apps/web/test/breadcrumb.test.tsx`, `apps/web/test/port-form.test.tsx` | section 4 |
| `e2e/workflow-tabs.ts` | `openAlignFixture(page)`; `breadcrumb(page): Locator`; `inputPorts(page, nodeId): Promise<string[]>` |
| `e2e/workflow-tabs.spec.ts` | section 4 |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`** (+ `index.ts`): `AddTake`, `AddEmit` (fields in 2.3); add to `EditCommand`; append `"addTake", "addEmit"` to `EDIT_COMMAND_KINDS`.
- **`packages/engine/src/edit/apply.ts`**: two cases. **`history/labels.ts`**: two labels.
- **`packages/engine/src/canvas/view.ts`** (+ `types.ts`): `NodeView.opens: boolean`.
- **`packages/engine/src/service/types.ts`**: `CalleeRequest {path: string; workflow: string | null; node: string}`; `EngineApi.calleeWorkflow(request: CalleeRequest): Promise<WorkflowRef | EngineRefusal>`; `EngineApi.callPath(ref: {path: string; workflow: string | null}): Promise<{revision: number; trail: readonly WorkflowRef[]} | EngineRefusal>`. **`service.ts`**: both through `guarded`. **`index.ts`**: exports.
- **`packages/engine/test/edit/harness.ts`**: `addTake` and `addEmit` generators (typed and legacy named workflows in the start trees) and structure checks. **`oracle-goldens.test.ts`**: the two goldens.
- **`apps/web/src/engine/engine-client.ts`**, **`apps/web/src/workspace/{types,workspace}.ts`**, **`e2e/engine.ts`**: pass the two calls through.
- **`apps/web/src/canvas/canvas-store.ts`**: `Crumb`; `WorkflowTab.trail`; `tabFor(ref, trail = [])`; `openCallee(node: string): Promise<{ok: true; tab: string} | {ok: false; message: string}>`; `navigationNotice: string | null` (cleared on the next load); trail from `callPath` in `openWorkflow`/`openFile`/`openPath`; `changed()` carries and remaps trails; `closeTab` for workflow tabs (2.5); the doc comments on `openWorkflow` and `closeTab`.
- **`apps/web/src/canvas/workflow-canvas.tsx`**, **`canvas-host.tsx`**, **`flow-elements.ts`**: `onOpen` prop, double-click, Enter-on-selected, `zoomOnDoubleClick={false}`, the node description, `navigationNotice` in the notices.
- **`apps/web/src/views/tab-panel.tsx`** (+ `views.css`): the breadcrumb above the visual pane.
- **`apps/web/src/shell/tab-strip.tsx`**: Delete and × for closable workflow tabs (`closable(tab, summary)`).
- **`apps/web/src/details/workflow-summary.tsx`**, **`details-pane.tsx`**: the forms (2.4), hidden read-only.
- **`e2e/read-only.ts`**: `visibleControls` collapses crumb buttons to a `breadcrumb` descriptor (like `switcher`); `/^breadcrumb$/` joins `READ_ONLY_ALLOWED`.
- **`apps/web/src/main.tsx`**: expose `openCallee` on the test hook.
- **Unchanged:** workflows, CSP and host allow-list, IndexedDB, sidecar and export formats, dependency-cruiser rules, AGENTS.md command table, runtime dependencies.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/engine/test/edit/take-emit.test.ts`** | |
| `F-307 step 2 UX-51 AR-21: AddTake appends a typed take and every call site's projection gains the input port` | ALIGN's file reprinted, other declarations equivalent (AR-22); re-projected `main.nf` entry: `aligned` node inputs `["reads", "index"]`, `index.argument === null`; `MAP@`/`map` alias node too |
| `F-307 UX-51: AddTake creates take: when absent, before main:; legacy workflows get an untyped take` | exact text |
| `F-307 AR-21 AR-24: AddTake refuses the entry workflow, a bad or taken name, a builtin, a type on legacy, no type on typed, an unparsable type, and a body with neither main nor emit` | code `invalid`, messages from 2.3; no patches |
| `F-307 UX-51 AR-21: AddEmit appends name: Type = null (typed) or name = null (legacy); the call's output ports gain it` | |
| `F-307 UX-51: AddEmit refuses a workflow with exactly one emit` | message 2.3 |
| `F-307 AR-23: AddTake and AddEmit inverses restore the exact bytes` | |
| **`packages/engine/test/edit/oracle-goldens.test.ts`** (extend) | `F-307 step 2 UX-51: f307-workflow-tabs plus AddTake equals oracle case f307-add-take`; `… plus AddEmit equals f307-add-emit` |
| **`properties.test.ts`, `test/corpus/edit.corpus.ts`** (via the harness) | `addTake`, `addEmit` each accepted at least once on the start trees and every pin |
| **`packages/engine/test/history/labels.test.ts`** | `F-307 AR-23: addTake and addEmit are labelled "Add take <n> to <WF>" / "Add emit <n> to <WF>"` |
| **`packages/engine/test/navigation.test.ts`** | |
| `F-307 UX-50: calleeWorkflow gives the definition of a workflow call, an aliased call and a pipeline call (its entry workflow)` | `ALIGN`, `MAP`→`ALIGN`, f205 `UPPER`→`pipelines/upper.nf` entry |
| `F-307 UX-50: calleeWorkflow refuses processes, unresolved, unparsed and plugin callees with their messages` | |
| `F-307 UX-50: callPath gives entry → ALIGN → SORT, null when unreachable, and terminates on recursion` | |
| **`packages/engine/test/canvas/view.test.ts`** (extend) | `F-307 UX-22 UX-50: opens is true for resolved workflow and pipeline calls only` |
| **`packages/engine/test/service/service.test.ts`** (extend) | `F-307: calleeWorkflow and callPath refuse with no project or an unknown node; results survive structuredClone` |
| **`apps/web/test/canvas-store.test.ts`** (extend, fake engine) | |
| `F-307 UX-50: openCallee opens the definition's tab once with the caller's trail, and focuses it the second time` | |
| `F-307 UX-50: openWorkflow and openPath set the trail from callPath; an unreachable workflow gets an empty trail` | |
| `F-307 UX-50: a refused openCallee sets navigationNotice and opens nothing; the next load clears it` | |
| `F-307 F-209: a rename keeps the tab's trail and renames crumbs; a deleted ancestor's crumb is dropped` | |
| `F-307 F-210 ADR-0055: closeTab closes a named workflow tab (previous, else next) and refuses the default workflow's tab` | |
| `F-307 UX-04 ADR-0056: openCallee works read-only; apply of addTake is refused read-only` | |
| **`apps/web/test/breadcrumb.test.tsx`** | `F-307 UX-50 QA-11: a nav labelled Workflow path lists ancestor buttons in order and the current workflow with aria-current=page; clicking a crumb calls onOpen with it`; `nothing for a file tab` |
| **`apps/web/test/port-form.test.tsx`** | `F-307 UX-51 UX-70: the form submits on Enter, shows a refusal as an alert, cancels on Escape and returns focus`; `typed shows Type, legacy doesn't` |
| **`apps/web/test/tab-strip.test.tsx`** (extend) | `F-307 ADR-0055: Delete closes a closable workflow tab and has aria-keyshortcuts; the default workflow's tab has neither` |
| **`apps/web/test/workflow-summary.test.tsx`** (extend) | `F-307 UX-51 UX-04: Add take and Add emit show for a named workflow, not for the entry workflow or read-only` |
| **`e2e/workflow-tabs.spec.ts`** (Chromium) | |
| `F-307 step 1 UX-50 UX-51: double-clicking ALIGN opens its tab with take and emit pills` | from `f307-workflow-tabs`; tab `ALIGN` selected; nodes `…align/main.nf#ALIGN/:take:reads` and `…/:emit:bam` visible, take pill left of emit pill; viewport zoom unchanged on the main tab before the switch |
| `F-307 step 2 UX-51: adding a take in ALIGN gives the ALIGN node in main.nf a new input port` | form: Name `index`, Type `Channel<String>`; back on main.nf `aligned` node has input handles `reads`, `index`; problems panel lists "Workflow `ALIGN` expects 2 argument(s)…" at main.nf (open point 4); one undo removes it byte for byte |
| `F-307 step 3 UX-50: the breadcrumb's main.nf returns to main.nf` | in SORT (opened from ALIGN) the crumbs read `main.nf › ALIGN › SORT`; clicking `ALIGN` then `main.nf` selects those tabs |
| `F-307 UX-70 UX-40: Enter on a selected workflow node opens it; on a process it doesn't` | keyboard only |
| `F-307 UX-50: an aliased call opens the definition's tab once` | `MAP` then `ALIGN` give one tab |
| `F-307 UX-04 ADR-0056: read-only, double-click opens a workflow tab and the breadcrumb works; no Add take` | uses `READ_ONLY_ALLOWED` |
| `F-307 QA-30: opening tabs and adding a take log no CSP violation and no console error` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-307` after F-301 merges (merge `main` first: both append to `EDIT_COMMAND_KINDS`, `labels.ts`, the harness, `service/types.ts`, `engine-client.ts` and `canvas-store.ts`). Settle section 6 first. `pnpm check` before every commit.

1. **Fixture.** `tools/oracle/cases/f307-workflow-tabs/` and its `cases.yaml` entry.
   - Done when `pnpm oracle` (local dist present) or the CI `oracle` job passes the case lint-clean and stub-run ok, and `pnpm check` passes.
2. **`AddTake` and `AddEmit`.** lang-core types; `take-emit.ts`; apply and labels; harness; tests; goldens and cases `f307-add-take`, `f307-add-emit`.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm oracle` (or CI), `pnpm test:corpus` (after `pnpm corpus:fetch && pnpm corpus:lint`; both kinds accepted on every pin) and `pnpm check` pass.
3. **Navigation in the engine.** `navigation.ts`, `NodeView.opens`, `calleeWorkflow`, `callPath`, service, client, workspace, `e2e/engine.ts`; tests.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
4. **Store.** `trail`, `openCallee`, `navigationNotice`, trails in `changed()`, `closeTab` for workflow tabs; store tests.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
5. **Canvas, breadcrumb, tab strip.** Double-click, Enter, `zoomOnDoubleClick`, breadcrumb, closable workflow tabs, `READ_ONLY_ALLOWED`; unit tests.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-205|F-206|F-208|F-210|F-309|F-703"` pass; if a `@visual` baseline moves, stop and report (ADR 0021).
6. **Take and emit forms.** `port-form.tsx`, summary changes; unit tests.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
7. **End-to-end.** `e2e/workflow-tabs.ts`, `workflow-tabs.spec.ts`.
   - Done when `pnpm test:e2e -- --grep F-307`, `pnpm smoke` (under 60 s) and `pnpm build && pnpm check:budget && pnpm check:hosts` pass.
8. **Records** (section 7). Done when `pnpm check` passes.

## 6. Open points (none decided here)

1. **Remove and rename take and emit** (UX-51) aren't in the steps, `DeleteNode` refuses them, and no feature owns a workflow Configure popup (UX-46). **Recommend:** F-307 ships add only; add a feature (M3, `scope-change` label) "Remove and rename workflow takes and emits, and the workflow Configure popup", with `RemoveTake`/`RemoveEmit` that also drop the matching argument at every call site.
2. **Resolving the callee's definition.** **Recommend:** a worker call `calleeWorkflow` (amends ADR 0043's API list). **Alternative:** add `Callee.definition` to the projection (a lang-core type change, regenerates every projection snapshot).
3. **Breadcrumb when not opened from a canvas** (problems panel, Files, `openPath`, the hook). **Recommend:** the shortest call path from the default workflow (`callPath`, worker BFS), empty when unreachable. **Alternative:** show only the workflow itself (no engine call; weaker reading of "path from the entry workflow").
4. **Call sites after AddTake, and AddEmit from one emit** (1.3.1, 1.3.2, 1.3.6). **Recommend:** AddTake edits only the definition (AR-22; the step asks only for the port) and the lint error at each call site tells the user to connect it; AddEmit refuses when the workflow has exactly one emit. **Alternatives:** pad every call site with `null` (lint clean, but silently passes `null` at run time, and touches other files); rewrite single-emit consumers to `x.<emit>` (multi-file, larger).
5. **New take and emit types and values** (1.3.3, 1.3.5). **Recommend:** typed workflows require a type text for both (no default); emits get `= null` as their placeholder value until connected, verified clean for `Channel<…>`, `Value<…>` and untyped. Legacy `name = null` emit is unverified: task 2's case `f307-add-emit` or a legacy variant must run it through the oracle before it is relied on.
6. **Which workflow tabs close.** **Recommend:** every tab but the default workflow's (the project's home; the breadcrumb root reopens it anyway). **Alternative:** all, leaving "No files open".
7. **Where take and emit are added.** **Recommend:** the details pane's workflow summary (UX-31 already lists them). **Alternative:** "+" buttons on the canvas next to the pills (more chrome on the canvas, more baselines).
8. **Keyboard open.** **Recommend:** Enter on an already selected workflow node (UX-40's reading); revisit with F-303, which settles Enter against the popup.
9. **`zoomOnDoubleClick={false}`** changes double-click on the empty pane, which zooms today. **Recommend:** accept (no requirement relies on it; zoom has buttons, wheel and keys).
10. **Visual baselines.** The breadcrumb adds a row above the canvas; `app-shell-default`, `view-modes-*`, `read-only-*` and `canvas-rnaseq-*` may move. **Recommend:** re-approve from the CI artifact (ADR 0021) and list each in the PR.
11. **Fixture naming.** The step says "ALIGN in a fixture"; none exists. **Recommend:** the new case `f307-workflow-tabs` above rather than renaming `SHOUT` in `f205-canvas` (which has baselines).

**AGENTS.md decide-and-record items:**
- **Spec or ADR changes:** points 2 and 3 (ADR 0043 API list), point 4 (AR-21/UX-51 reading), point 6 (amends ADR 0055's "workflow tabs stay F-307's"), point 9 (ADR 0046 canvas behaviour), and the readings in 5, 7 and 8.
- **`features.json`:** point 1's new feature (`scope-change` label).
- **None:** runtime dependencies, package boundaries, dependency-cruiser rules, stored or exported formats (tabs and trails are session-only; the sidecar is unchanged), workflows, open questions in `open-questions.md`.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number at merge: "Open workflow definitions in tabs with a navigation breadcrumb, and add takes and emits without editing call sites". Covers 2.1 to 2.5 and points 2 to 9; amends ADR 0043 (two calls), ADR 0055 (workflow tabs close), ADR 0046 (double-click). Row in `docs/adr/README.md`.
- **Spec:** UX-50 "…opened from a canvas, the breadcrumb is the path taken; otherwise the shortest call path; the default workflow's tab can't be closed"; UX-51 "a new take leaves call sites unfed (Nextflow reports them) … a second emit is refused while one is read directly" (or whatever point 4 settles).
- **`features.json`:** F-307 `passes` and a verification note naming `e2e/workflow-tabs.spec.ts` and the three oracle cases; F-303 note "Enter on a selected workflow node opens its tab (F-307); keep that when Enter opens the popup"; F-312 note "new takes and emits have no doc comment"; F-701 note "audit the breadcrumb, the Enter-again description and the inline take/emit form"; the new feature from point 1.
- **`progress.md` Decisions:** the ADR, the two commands, the two engine calls, the call-site rule, closable tabs, `zoomOnDoubleClick`.
- **`docs/research/upstream-bugs.md`:** nothing found; the 1.3 behaviours match the docs (`workflow-typed.mdx` doesn't say a single emit is exposed directly; consider a doc-gap entry for 1.3.6 if the researcher confirms it isn't documented elsewhere).

## 8. Evidence

- Probes with `.cache/nextflow/26.10.7/nextflow-26.10.7-dist` (`lint .` and `run main.nf -stub`, `NXF_OFFLINE=true`) in `/tmp/claude-0/-home-user-nf-builder/7eb86299-0303-577c-b405-f447f3050ce3/scratchpad/probe307/`: `m` (1.3.1), `c`, `d` (1.3.2), `b` (1.3.3), `h`, `i`, `j` (1.3.4), `e`, `f`, `g`, `em*` (1.3.5), `k` (1.3.6).
- `nextflow-io/nextflow` `v26.10.7/docs/workflow-typed.mdx` (take and emit syntax): `/tmp/claude-0/-home-user-nf-builder/7eb86299-0303-577c-b405-f447f3050ce3/scratchpad/workflow-typed.mdx`.
