# Plan: F-206, the details pane (read-only details for every node kind; workflow summary when nothing is selected)

Planner output, 2026-11-22. I changed nothing. Sources:
- `/home/user/wt-main` on `main` at `006d570`;
- `origin/feat/F-113` at `7526d72` (`EngineApi`, the service, `apps/web/src/engine/`);
- `origin/feat/F-112` at `d36c3c6` (diagnoser, ADR 0042);
- `docs/plan/handoff/plan-F-205.md`, with its settled points in `handoff/README.md`.

F-206 cites UX-30, UX-31 and UX-32 and depends on F-205. It also takes the UX-24 highlight of edges touching the selected node, which F-205's settled point 13 hands to it.

## 0. Scope

**In scope:**
- Selection:
  - single-node selection held in the workspace store (AR-30);
  - clicking a node selects it, and clicking the empty canvas clears the selection;
  - edges touching the selected node are highlighted (UX-24, first clause).
- A details pane for every node kind (UX-30):
  - the parts that come from the projection, worked out on the main thread;
  - the declaration details and diagnostics, which come from the worker through a new `EngineApi.details`.
- A workflow summary when nothing is selected (UX-31).
- Edit and Code header buttons (UX-32), rendered disabled until the popup exists (open point 1).

**Out of scope:**

| What | Owner |
|---|---|
| The popup, so enabled Edit and Code buttons | F-303, F-304 |
| Registry version, upstream link, "update available" (UX-32, second sentence) | F-506 |
| Per-port descriptions and the `Inputs:`/`Outputs:` doc style (UX-46, LA-51) | F-311 |
| % modelled | F-405 |
| Multi-select | F-310 |
| Metro map in the summary (FI-55) | F-607 |
| Quick-fix actions | F-309 |
| Read-only layout | F-703 |
| Keyboard shortcuts and announcements | F-701 |

## 1. Findings

### 1.1 Spec and ADRs
- **UX-30** lists what a selected node shows: name, kind, file, description, inputs and outputs with types and connections, key directives, topics, a short script preview, and diagnostics.
- **UX-31:** the open workflow's take, emit, calls and registry modules.
- **UX-32:** the Edit and Code buttons, and registry extras (F-506).
- **LA-20:** topic emissions are not ports; they are listed in details.
- **ADR 0008:** closure bodies live in the details pane.
- **AR-30:** selection lives in Zustand.
- **AR-31:** nodes are presentational.
- **ADR 0036:** node ids are stable keys.
- **ADR 0038:** a legacy port can have several incoming edges.
- **ADR 0042:** name-resolution checks are deferred, so "no diagnostics" is not "valid".
- **F-112 note on F-206:** find a node's diagnostics by range containment.

### 1.2 Code facts
- **Projection** (`lang-core/src/projection.ts`):
  - every node has `label`, `inputs` and `outputs`, where each port has `type: FlowType | null`, `argument` and `argumentType`;
  - every node also has `range` and `guards`;
  - `CallNode.callee` has `{name (the in-scope name), kind, status, typed, path, module}`;
  - `ChainNode.steps[] {operator, known}`, `FactoryNode {namespace, factory}`, `CodeNode.text`;
  - edges have `{from, to, type, variable}`.
- **What the projection lacks:** description, directives, topics and script. They need the callee's AST, which lives only in the worker.
- **`params` and `output` node ranges fall back to the whole workflow's range** when there is no block (`projection/project.ts` L346 and L405). Plain containment would then pull in every diagnostic of the workflow; section 2.3 excludes this case.
- **Callee lookup:** `model.lookup(path, callee.name)` gives a `Binding`. A declaration binding is the declaration itself. An include binding gives `{include, entry.declaration, target}`.
- **Doc comments** are the `doc`-kind entries of a declaration's `leadingComments` (ADR 0027).
- **Catalogue:** `ScriptCatalogue.operators` and `factories` carry Markdown descriptions. `palette-view.ts` has `plainText`, `firstParagraph`, and private `operatorDescription` and `factoryDescription` that take a full `Catalogue`.
- **F-113 service:**
  - `project(path, workflow)` returns `{revision, projection}`;
  - `diagnostics()` returns `model.diagnostics()`, which holds only the include codes;
  - **the F-112 diagnoser is not wired in** (that work is F-113's note on the F-112 branch).
- **`connectEngine`** lists its methods one by one, so a new API method must be added there.
- **F-112 diagnoser:**
  - `createDiagnoser({model, projector, catalogue, lints})` returns `{file(path), all()}`, memoised per file;
  - `loadLints(version)`;
  - `legacy-process` and `legacy-workflow` are suggestions placed at the declaration name;
  - a syntax error in `bad-declaration.nf`'s `SECOND` falls inside that `Unparsed` declaration.
- **Shell:** the right `SideColumn` has header `<h2 class="column-title">Details</h2>` and body `<p class="muted">Nothing selected</p>`. The F-201 baseline and the `app-shell.test.tsx` landmarks depend on both.
- **Existing tokens:** `--color-ok` and `--color-accent`. F-205 adds `--color-error`.

### 1.3 What F-205's plan doesn't provide yet (F-206 adds it)
1. **No selection anywhere.**
   - `WorkspaceState` has no `selected` field.
   - `WorkflowCanvas` props are only `{projection, portLabels, onPortLabelsChange}`.
   - There is no `onNodeClick`, `onPaneClick` or `onNodesChange`.
   - `toFlowNodes(view, portLabels)` and `toFlowEdges(view)` take no selection.
2. **No exported node title.** Titles are computed inside `canvasView`. F-206 needs the same names for connection text ("to ALIGN.reads", "to mix → collect"), so it extracts `nodeTitle(node)`. This is a refactor with no visual change.
3. **No styles for a selected node or a highlighted edge.** React Flow's `.selected` is unstyled.
4. **Edges are selectable by default.** F-206 makes them non-selectable, so clicking an edge leaves the selection alone.
5. **Multi-select and marquee stay at React Flow defaults.** F-206 turns them off (`multiSelectionKeyCode={null}`, `selectionKeyCode={null}`) until F-310 defines several selected nodes.
6. **No helper to click the empty pane or select a node in `e2e/canvas.ts`.** `EngineHook` in `e2e/engine.ts` has no `details` method.
7. **The store never re-projects after an engine change,** so details are tied to the projection's revision. A mismatch is shown as unavailable, never as stale data.
8. **React Flow's default `elementSelectionKeys` include Enter.** UX-40 later wants Enter on a selected node to open the popup. This is a note for F-303.
9. **Not F-205's gap, but a prerequisite: the diagnoser wiring above.** See task 0.

## 2. Design

### 2.1 Where the data comes from
Two sources: **P** is the projection, read on the main thread, pure and instant. **W** is the worker's `EngineApi.details(path, workflow, nodeId)`, which reads the AST (A), the catalogue (C) and the diagnoser (D).

| Kind | Name (P) | Kind label (P) | File (P, line W) | Description (W) | Directives / topics (A) | Operators (C) | Preview (A) | Diagnostic scopes (D) |
|---|---|---|---|---|---|---|---|---|
| call to a modelled process | `label` | "Typed process" or "Legacy process" | `callee.path`, line of the declaration | doc comment of `ProcessDef` | the `directives` section; topics from the typed `topic:` section (`expr >> 'name'`) and legacy output lines' `topic:` option | none | body of `script:`, `shell:` or `exec:` | node range in the workflow file, plus the declaration range in `callee.path` |
| call to an agent | `label` | "Agent" | as above | doc comment | agent directives | none | body of `prompt:` | as above |
| call to a workflow | `label` | "Typed workflow" or "Legacy workflow" | as above | doc comment | none | none | none | as above |
| call to a pipeline | `label` | "Pipeline" | as above | doc comment of the entry `WorkflowDef` | none | none | none | node range, plus the entry `WorkflowDef` range (never a whole-file `ScriptAst` or `ParamsBlock`) |
| call, callee unparsed | `label` | "<Kind> (could not be parsed)" | `callee.path` | none | none | none | the `Unparsed` declaration text | node range, the `Unparsed` range, and the include statement that binds it |
| call, callee unresolved | `label` | "Unresolved call" | "Not found" | none | none | none | none | node range and the binding include statement |
| chain | operators joined by ` → ` | "Operator chain" | workflow path and `range.line` | none | none | each step: first paragraph of the catalogue description; "legacy" when `known` is false or every entry is deprecated | the chain's source text, which includes its closures (ADR 0008) | node range |
| factory | e.g. `channel.of` | "Channel factory" | as for chain | first paragraph of the catalogue description | none | none | source text | node range |
| take, emit | `name` | "Take" or "Emit" | as for chain | none (F-311) | none | none | none | node range |
| params, output | `params` or `output` | "Params block" or "Output block" | as for chain | none | none | none | the block text, only when the node range is the block's | the block range only; none when the range equals `projection.workflow.range` |
| code | first line | "Code" | as for chain | none | none | none | `CodeNode.text` | node range |

- **Registry modules:** when `callee.module` is set, the kind label gains " · registry module <module>".
- **Ports (P):** for each input and output port, show `label` and `type`. The type is `formatFlowType`, or null (shown as "Unknown type") when the type is null or both its fields are null.
- **Connections, inputs (P):** each incoming edge reads "from <`edge.variable`>", or "from <source title>.<port label>" when the variable is null. Several edges each get a row (ADR 0038).
- **Connections, outputs (P):** each outgoing edge reads "to <target title>.<port label>".
- **Port label in connections:** left out when the other node has only one port on that side, so a chain reads "to mix → collect".
- **Ports with no edge:**
  - an input fed by an inline argument reads "Inline argument" (plus the argument type when known);
  - any other unfed input reads "Not connected";
  - an unused output reads "Not used".
- **Description:** the last `doc` leading comment of the declaration. Strip the `/**`, `*/` and leading `*`, keep the text before the first `@tag`, `Inputs:` or `Outputs:` line, and pass it through `plainText`.
- **Directive and topic rows:** `{name, value}`, where `value` is the argument source text collapsed to one line and cut at 60 characters with "…". All directives are shown, in source order (open point 2).
- **Preview:** dedented, at most 8 lines, with `truncated: true` when cut. The title is "Script", "Shell", "Exec", "Prompt" or "Source".

### 2.2 Workflow summary (P, `workflowSummary(projection)`)
- **Header:** `{name, path, typed}`, where `name` is the workflow name or "Entry workflow".
- **`takes` and `emits`:** each `{node, name, type}`.
- **`calls`:** in projection order, each `{node, name, callee, kindLabel, module, status}`.
- **`modules`:** unique by `callee.module`, each with the labels of its calls.
- **Entry workflow:** take and emit are always empty there, so it shows `params` (from the params node's outputs) and `outputs` (from the output node's inputs) instead (open point 6). Named workflows leave both empty.

### 2.3 Diagnostics for a node (W)
- `diagnosticsWithin(all, scopes)` keeps a diagnostic `d` when, for some scope, `d.path === scope.path`, `d.range.start >= scope.range.start` and `d.range.end <= scope.range.end`.
- Duplicates are removed, and the order is `compareDiagnostics` (F-112).
- The scopes for each kind are in the table in 2.1.
- Each file's diagnostics come from `diagnoser.file(path)`, which is memoised, so a click costs at most two files' lint runs.
- **Display:** a severity word ("Error", "Warning", "Suggestion") plus a glyph, so colour isn't the only cue (QA-12), then the message.
- **Empty list:** "No problems found" (open point 5).

### 2.4 Selection and highlight (web)
- **Store:** F-205's `workspace-store.ts`, or F-202's if F-202 landed first (handoff decision), gains:
  - `selected: string | null`;
  - `details: DetailsContent`;
  - `select(id)`.
- **`select(id)`:**
  - sets `selected`;
  - for a non-null id, calls `engine().details(tab.path, tab.workflow, id)`;
  - drops a result if the selection or tab has changed since;
  - a result whose revision isn't `content.revision` becomes `unavailable` with the message "The project changed. Select the node again.";
  - a refusal also becomes `unavailable`;
  - a null result means the node is gone, so the selection is cleared.
- **Clearing:** `open`, `openWorkflow` and `selectTab` clear the selection.
- **Canvas:**
  - selection is controlled: `toFlowNodes(view, portLabels, selected)` sets `selected`;
  - `onNodeClick` selects the node, `onPaneClick` clears the selection, and `onNodesChange` forwards only `select` changes (React Flow's keyboard select and deselect);
  - edges have `selectable: false`;
  - `toFlowEdges(view, selected)` sets `data.highlighted` and a raised `zIndex`;
  - `FlowEdge` adds `is-highlighted`, an accent stroke 2 px wide;
  - a selected node gets an accent outline.
- **Pane:**
  - `DetailsPane` reads the store;
  - with no project it renders exactly today's `<p class="muted">Nothing selected</p>`, so the F-201 baseline holds;
  - with a project and no selection it renders `WorkflowSummaryView`;
  - with a selection it renders `NodeDetailsView`, whose P sections appear at once and whose W sections show "Loading details…" until the worker answers;
  - `data-details-state="summary|loading|ready|unavailable"` is the e2e wait.
- **`DetailsHeader`:**
  - keeps the same `<h2>`;
  - only while a node is selected, adds `<button disabled>` Edit and Code with `title` "Opens the edit popup (not available yet)" and "Opens the code popup (not available yet)" (open point 1);
  - this follows the precedent of F-201's disabled Templates, Import and Export.
- **Headings and copy:** sentence-case headings "File", "Inputs", "Outputs", "Directives", "Topics", "Operators", "Script" (or the preview title), "Problems"; in the summary, "Take", "Emit", "Calls", "Registry modules", "Parameters", "Outputs"; "None" for an empty list.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/details/types.ts` | `PortConnection {direction: "from"\|"to"; node: string\|null; text: string}`; `PortDetail {id; label; type: string\|null; connections: readonly PortConnection[]; unconnected: "not-connected"\|"inline"\|"unused"\|null; argumentType: string\|null}`; `NodeView {id; kind: GraphNodeKind; name; kindLabel; module: string\|null; path: string\|null; line: number\|null; inputs; outputs}`; `SummaryPort {node; name; type: string\|null}`; `SummaryCall {node; name; callee; kindLabel; module: string\|null; status: Callee["status"]}`; `SummaryModule {module; calls: readonly string[]}`; `WorkflowSummary {name; path; typed: boolean\|null; takes; emits; params; outputs; calls; modules}`; `DetailRow {name; value}`; `OperatorDetail {name; description: string\|null; legacy: boolean}`; `Preview {title: "Script"\|"Shell"\|"Exec"\|"Prompt"\|"Source"; text; truncated: boolean}`; `DeclarationDetails {path: string\|null; line: number\|null; description: string\|null; directives; topics; operators; preview: Preview\|null}`; `NodeDetails {node: string; declaration: DeclarationDetails; diagnostics: readonly Diagnostic[]}`; `PREVIEW_LINES = 8`; `VALUE_CHARS = 60`. All fields readonly and plain data. |
| `packages/engine/src/details/node-view.ts` | `nodeView(projection: Projection, id: string): NodeView \| null`; `kindLabel(node: GraphNode): string`; `portTypeText(type: FlowType \| null): string \| null` |
| `packages/engine/src/details/summary.ts` | `workflowSummary(projection: Projection): WorkflowSummary` |
| `packages/engine/src/details/declaration.ts` | `CalleeDeclaration {declaration: IncludableDeclaration \| null; path: string \| null; include: Include \| null}`; `resolveCallee(model: ProjectModel, path: string, name: string): CalleeDeclaration \| null`; `docSummary(comments: readonly Comment[] \| undefined): string \| null`; `previewText(text: string, range: Range, lines?: number): {text: string; truncated: boolean}`; `oneLine(text: string, max?: number): string`; `DetailsInput {model: ProjectModel; catalogue: ScriptCatalogue; projection: Projection}`; `declarationDetails(input: DetailsInput, node: GraphNode, callee: CalleeDeclaration \| null): DeclarationDetails` |
| `packages/engine/src/details/diagnostics.ts` | `DiagnosticScope {path: string; range: Range}`; `nodeDiagnosticScopes(projection: Projection, node: GraphNode, callee: CalleeDeclaration \| null): DiagnosticScope[]`; `diagnosticsWithin(diagnostics: readonly Diagnostic[], scopes: readonly DiagnosticScope[]): Diagnostic[]` |
| `packages/engine/src/details/details.ts` | `nodeDetails(input: DetailsInput & {diagnostics(path: string): readonly Diagnostic[]}, id: string): NodeDetails \| null` (used by the worker) |
| `packages/engine/src/details/index.ts` | re-exports |
| `packages/engine/test/details/{node-view,summary,declaration,diagnostics,fixture}.test.ts`, `packages/engine/test/corpus/details.corpus.ts` | section 4 |
| `tools/oracle/cases/f206-details/**` | fixture (2.5) |
| `apps/web/src/details/details-pane.tsx` | `DetailsPane(): JSX.Element` (store-connected) |
| `apps/web/src/details/details-header.tsx` | `DetailsHeader(): JSX.Element` |
| `apps/web/src/details/node-details.tsx` | `NodeDetailsView(props: {view: NodeView; details: DetailsContent}): JSX.Element` (presentational) |
| `apps/web/src/details/workflow-summary.tsx` | `WorkflowSummaryView(props: {summary: WorkflowSummary}): JSX.Element` |
| `apps/web/src/details/port-list.tsx` | `PortList(props: {title: string; ports: readonly PortDetail[]}): JSX.Element` |
| `apps/web/src/details/diagnostic-list.tsx` | `DiagnosticList(props: {diagnostics: readonly Diagnostic[]}): JSX.Element` |
| `apps/web/src/details/details.css` | pane styles |
| `apps/web/test/details-pane.test.tsx` | section 4 |
| `e2e/details.ts` | `F206_FIXTURE`; `DETAILS_EXPECTED: Record<string, {name; kind; file; inputs: {label; type; connections: string[]}[]; outputs: …}>`, one entry per node kind in `f205-canvas` and `bad-declaration.nf`; `detailsPane(page)`; `detailsReady(page)` |
| `e2e/details.spec.ts` | section 4 |

### 3.2 Change
- **`packages/engine/src/canvas/view.ts`:** export `nodeTitle(node: GraphNode): string`, extracted from `canvasView` with no behaviour change.
- **`packages/engine/src/palette-view.ts`:** export `operatorDescription(script: ScriptCatalogue, name)` and `factoryDescription(script, name)`, which now take a `ScriptCatalogue`; the palette output is unchanged.
- **`packages/engine/src/service/types.ts`:** `NodeDetailsResult {revision: number; details: NodeDetails \| null}`; `EngineApi.details(path: string, workflow: string \| null, node: string): Promise<NodeDetailsResult \| EngineRefusal>`.
- **`packages/engine/src/service/service.ts`:** `details` through `guarded`, using `projectorOf(open)`, `state.catalogue` and the diagnoser.
- **`packages/engine/src/index.ts`:** export the details types and functions.
- **`apps/web/src/engine/engine-client.ts`:** add `details` to the `connectEngine` facade.
- **`apps/web/src/workspace/workspace-store.ts`:**
  - `DetailsContent = {status: "idle"} | {status: "loading"; node} | {status: "ready"; node; revision; details: NodeDetails} | {status: "unavailable"; node; message}`;
  - state `selected` and `details`;
  - action `select(id: string \| null): Promise<void>`;
  - clearing in `open`, `openWorkflow` and `selectTab`.
- **`apps/web/src/canvas/{workflow-canvas.tsx, flow-elements.ts, flow-edge.tsx, canvas-host.tsx, canvas.css}`:**
  - props `selected` and `onSelect(id: string \| null)`;
  - `toFlowNodes(view, portLabels, selected)`, `toFlowEdges(view, selected)`, `CanvasEdgeData.highlighted`;
  - the selected and highlighted styles.
- **`apps/web/src/app-shell.tsx`:** `header={<DetailsHeader/>}`, body `<DetailsPane/>`.
- **`apps/web/src/styles.css`:** `--color-warning` and `--color-suggestion`, each at least 4.5:1 on white (QA-13).
- **`tools/oracle/cases/cases.yaml`:** the `f206-details` case, `spec: [F-206, UX-30, LA-20]`, with `lint` and `run` both `{ expect: ok }` (warnings allowed).
- **`e2e/canvas.ts`:** `clickEmptyCanvas(page)`, which clicks `.react-flow__pane` at 8,8, clear of the controls, minimap and attribution; and `selectNode(page, id)`.
- **`e2e/engine.ts`:** `EngineHook.details`.
- **Unchanged:**
  - dependency-cruiser (apps/web still imports only engine; types come through engine);
  - `package.json` dependencies;
  - workflows;
  - the F-201, F-204 and F-205 baselines;
  - the AGENTS.md command table.

### 2.5 Fixture `f206-details`
Write it with the vendored skills, the syntax reference and the oracle, never from memory. It holds:
- **A typed entry `main.nf`** with:
  - a typed params block with a default;
  - a factory feeding `TRIM`;
  - a chain with a closure;
  - an output block;
  - a call to `LEGACY_VERSIONS`.
- **`modules/local/trim/main.nf`, a typed `TRIM`** with:
  - a `/** … */` doc comment that has text plus `@param` and `@return` lines;
  - the `tag`, `label` and `cpus` directives, plus a `container` value longer than 60 characters;
  - `input:` and `output:`;
  - a `topic:` section using `tuple(...) >> 'versions'` (the form in `.claude/skills/nf-pipeline-design`);
  - a `script:` of more than 8 lines;
  - a `stub:`.
- **`modules/local/legacy_versions/main.nf`, a legacy process** with an output line ending `topic: versions` (the form in `.claude/skills/migrate-nextflow-code`). It yields the `legacy-process` suggestion.
- **Optionally, one `Channel.of` in `main.nf`,** for a node-range `deprecated-channel` warning, if lint reports it only as a warning.

The step-1 sweep reuses F-205's `f205-canvas` (every appearance) and `bad-declaration.nf` (unparsed `SECOND`).

## 4. Tests (written before the implementation in each task)

| File: test name | Asserts |
|---|---|
| **engine `test/details/node-view.test.ts`** (synthetic projections) | |
| `F-206 UX-30: every node kind and callee variant has its name, kind label and file` | the 2.1 table: process typed, legacy, agent, workflow typed, legacy, pipeline, module, unparsed, unresolved, plus chain, factory, take, emit, params, output, code |
| `F-206 UX-30 LA-28: ports carry their formatted type and connections, from the variable or the source node and port` | "from params.input", "to ALIGN.reads" |
| `F-206 UX-30 ADR-0038: a legacy input fed by several edges lists every source` | |
| `F-206 UX-30: an unfed input is "not connected", an inline argument "inline", an unused output "unused"; the port is omitted for a single-port target` | |
| `F-206 UX-30 ADR-0036: an unknown id gives null; the view survives structuredClone` | |
| **`test/details/summary.test.ts`** | |
| `F-206 UX-31: takes and emits with types, calls in projection order, and each registry module once with its calls` | |
| `F-206 UX-31: the entry workflow summary lists parameters and published outputs` | |
| **`test/details/declaration.test.ts`** (in-memory projects through `test/projection/open.ts`) | |
| `F-206 UX-30 LA-50: a description is the doc comment text before the first tag, as plain text` | also `Inputs:` and undocumented cases |
| `F-206 UX-30: directives are listed in source order with one-line values cut at 60 characters` | |
| `F-206 UX-30 LA-20: topics list a typed process's topic emissions and a legacy output's topic option` | |
| `F-206 UX-30: the script preview is the script section's body, dedented, at most 8 lines, marked when cut` | including the shell and exec variants |
| `F-206 UX-30: an agent shows its directives and prompt; a workflow or pipeline callee has no preview` | |
| `F-206 UX-30 ADR-0008: a chain lists its operators with catalogue descriptions, flags legacy operators, and previews its closures` | |
| `F-206 UX-30: a factory shows its catalogue description; a code node previews its statement text` | |
| `F-206 UX-30: an unparsed callee previews its declaration text; an unresolved callee has no declaration` | |
| `F-206 UX-30: a params node without a block previews nothing` | |
| **`test/details/diagnostics.test.ts`** | |
| `F-206 UX-30 AR-05: a node's diagnostics are those inside its range in the workflow file` | |
| `F-206 UX-30: a call also gets the diagnostics inside its callee's declaration, in the callee's file` | |
| `F-206 UX-30 AR-03: an unresolved or unparsed callee also gets the diagnostics of the include binding it` | |
| `F-206: a diagnostic that only overlaps a node is excluded; a params or output node spanning the workflow gets none; a ScriptAst pipeline declaration is not a scope` | |
| **`test/details/fixture.test.ts`** | |
| `F-206 step 1: every node of the f205-canvas and bad-declaration projections has a name, kind label, file and one row per port` | |
| `F-206 UX-30: f206-details TRIM has its description, four directives, the versions topic, a cut script, and LEGACY_VERSIONS has a legacy-process suggestion` | |
| **`test/service/service.test.ts`** (extend) | |
| `F-206 AR-04: details returns the node's declaration details and diagnostics at the current revision` | |
| `F-206: details for an unknown node is null; without a project it is a no-project refusal; the result survives structuredClone` | |
| **`test/canvas/view.test.ts`** (extend) | |
| `F-206 F-205: nodeTitle equals each canvas node's title` | |
| **`test/corpus/details.corpus.ts`** (`pnpm test:corpus`) | |
| `F-206 IO-14: every node of every pinned corpus workflow gets details without throwing` | |
| **web `workspace-store.test.ts`** (extend, fake engine) | |
| `F-206 UX-30 AR-30: selecting a node stores it and loads its details` | |
| `F-206 UX-31: clearing the selection drops pending details` | |
| `F-206: a details result for an older selection, tab or revision is ignored or marked unavailable; a null result clears the selection` | |
| `F-206: opening a project, opening a workflow or switching tabs clears the selection` | |
| **web `flow-elements.test.ts`** (extend) | |
| `F-206 UX-24: edges touching the selected node are highlighted and raised; edges are not selectable` | |
| `F-206 UX-30: only the selected node is marked selected` | |
| **web `details-pane.test.tsx`** (`renderToStaticMarkup`) | |
| `F-206 UX-30: node details show name, kind, file, description, inputs and outputs with types and connections, directives, topics, script preview and problems` | |
| `F-206 UX-30: sections with nothing to show are omitted; "Loading details…" until the worker answers` | |
| `F-206 UX-30 QA-12: problems show a severity word; none shows "No problems found"` | |
| `F-206 UX-31: the summary shows take, emit, calls and registry modules` | |
| `F-206 UX-32: a selected node's header has disabled Edit and Code buttons; with no selection there are none` | |
| **web `app-shell.test.tsx`** (extend) | |
| `F-201 F-206: with no project the details column still reads "Nothing selected" under the Details heading` | |
| **web `engine-client.test.ts`** (extend) | |
| `F-206: the facade forwards details` | |
| **e2e `e2e/details.spec.ts`** (Chromium) | |
| `F-206 step 1 UX-30: clicking each node kind shows its name, kind, file, and ports with types and connections` | `DETAILS_EXPECTED` over `f205-canvas`, both the entry and the named workflow (via `openWorkflow`), plus `bad-declaration` `SECOND`; no CSP violation or console error (`watchForCspViolations`) |
| `F-206 step 1 UX-30: every node's details list one row per projected port` | a sweep against `window.nfBuilderEngine.project` |
| `F-206 UX-30 LA-20: a typed process shows its description, directives, topics and a short script preview` | `f206-details` `TRIM` |
| `F-206 UX-30 AR-05: a node's problems show in its details` | the `LEGACY_VERSIONS` suggestion, `SECOND`'s syntax error, "No problems found" on `TRIM` |
| `F-206 UX-24: edges touching the selected node are highlighted until the selection clears` | class and computed stroke |
| `F-206 step 2 UX-31: clicking empty canvas shows the workflow summary with take, emit, calls and registry modules` | entry (calls and modules) and named workflow (take and emit) |
| `F-206 UX-32: Edit and Code show, disabled, only while a node is selected` | |
| `F-206 UX-30 UX-32: a typed process's details match the approved baseline @visual` | the Details column for `TRIM` |
| `F-206 UX-31: the entry workflow summary matches the approved baseline @visual` | the Details column for the `f205-canvas` entry |

## 5. Tasks (in order, one builder run each; branch `feat/F-206` after F-205 merges)

0. **Diagnoser in the service.** Only if `main` still returns `model.diagnostics()` from `EngineApi.diagnostics()`.
   - Load `loadLints(version)` at open.
   - Keep one `createDiagnoser` per snapshot next to the projector, and drop it with the projector on change.
   - `diagnostics()` returns `diagnoser.all()`.
   - Test: `F-112 F-113 AR-05: diagnostics() returns the pack lint codes and is recomputed after a change`.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm check` and `pnpm test:e2e -- --grep F-113` pass.
1. **Fixture.**
   - `f206-details` and its `cases.yaml` entry.
   - The projection-level part of `fixture.test.ts`.
   - Done when `pnpm oracle -- --case f206-details`, `pnpm --filter @nf-builder/engine exec vitest run test/details` and `pnpm check` pass.
2. **Engine, main-thread views.**
   - `nodeTitle` extraction, `details/types.ts`, `node-view.ts`, `summary.ts`, the exports.
   - Tests: `node-view.test.ts`, `summary.test.ts`, the `view.test.ts` extension and the step-1 part of `fixture.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
3. **Engine, worker details.**
   - `declaration.ts`, `diagnostics.ts` and `details.ts`.
   - The `palette-view` refactor.
   - `EngineApi.details` and the service.
   - The `connectEngine` facade and `EngineHook`.
   - Their tests, plus `details.corpus.ts`.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:corpus` pass (`pnpm test:corpus` needs `pnpm corpus:fetch`).
4. **Selection and highlight.**
   - Store `selected`, `details` and `select`.
   - The canvas wiring, the selection and edge flags in `flow-elements`, and the CSS.
   - `e2e/canvas.ts` helpers.
   - Tests: the store and flow-elements unit tests, and the UX-24 e2e test.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-206|F-205"` pass.
5. **Pane.**
   - The `details/*` components, `DetailsHeader`, the app-shell integration and the tokens.
   - `details-pane.test.tsx` and the app-shell test.
   - `e2e/details.ts` and every non-visual e2e test in section 4.
   - Done when `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts` pass, `pnpm test:e2e -- --grep "F-206|F-205|F-201"` passes, and `pnpm smoke` stays under 60 s.
6. **Visual tests.**
   - Write the two `@visual` tests.
   - Done when `pnpm check` passes and the PR's `Playwright all tests (chromium)` job runs them. The orchestrator then downloads `playwright-chromium`, views each `-actual.png` against UX-30, UX-31 and mockup `1-main.png`, and commits them under `e2e/__screenshots__/details.spec.ts/` (ADR 0021). CI must then be green, with the F-201 and F-205 baselines unchanged.
7. **Records** (orchestrator, section 7).
   - Done when `pnpm check` and the Scope guard pass. No `scope-change` label is needed: only `passes` and `notes` change.

## 6. Open points (each with a recommendation; none decided here)

1. **UX-32 buttons before the popup exists** (F-303 and F-304 build it).
   - **Recommendation:** render Edit and Code disabled, only while a node is selected, with explanatory titles. This follows F-201's disabled header buttons.
   - Add notes to F-303 (enable Edit, and settle Enter-selects against Enter-opens) and F-304 (enable Code).
   - **Alternative:** omit the buttons and note UX-32 under F-303. That leaves UX-32 with no owner for the buttons.
2. **"Key directives" is undefined.**
   - **Recommendation:** every directive, in source order, as name plus a one-line value cut at 60 characters. nf-core processes have about four directives.
   - **Alternative:** a fixed list (label, tag, cpus, memory, time, container, conda).
3. **Script preview.**
   - **Recommendation:** at most 8 lines, dedented:
     - process: the `script:`, `shell:` or `exec:` body;
     - agent: `prompt:`;
     - chain, factory, code, params and output: their source text;
     - unparsed callee: its declaration;
     - workflow and pipeline callees: none.
4. **Description before F-311.**
   - **Recommendation:** the doc-comment text before the first tag or `Inputs:` line, as plain text.
   - Per-port descriptions and nf-docs parsing stay F-311's; add a note there.
5. **Diagnostics.**
   - **Recommendation:** the containment scopes of 2.1 and 2.3, including the callee declaration and, for unparsed or unresolved callees, the binding include.
   - The include part slightly over-reports when one include statement has several entries, which is accepted.
   - The empty state reads "No problems found", not the mockup's "Valid for Nextflow 26.10", because ADR 0042 defers name resolution.
6. **Entry-workflow summary.** Take and emit are always empty there.
   - **Recommendation:** also show Parameters (params node) and Outputs (output node) for the entry workflow.
   - FI-55's metro map joins later (F-607 note).
7. **Where details are computed.**
   - **Recommendation:**
     - the projection-derived parts (step 1's whole content, and the summary) run on the main thread, so they are instant;
     - the AST, catalogue and diagnostics parts run in the worker through one new `EngineApi.details`. The AST never crosses the boundary (AR-04, AR-31).
   - **Alternatives:**
     - all in the worker: one round trip per click and per deselect;
     - shipping the AST to the UI: large, and against the "read-only projection copy" sketch.
8. **Diagnoser wiring.**
   - **Recommendation:** whichever of F-112 and F-113 merges second wires it, per F-113's note on the F-112 branch.
   - If neither has when F-206 starts, task 0 does it.
9. **Selection model.**
   - **Recommendation:**
     - single selection in the workspace store;
     - multi-select and marquee off until F-310 (add a note there);
     - edges not selectable;
     - selection cleared on tab or project change;
     - React Flow's default Enter, Space and Escape keyboard selection kept (notes for F-303 and F-701).
10. **Connection and kind wording** as in 2.1.
    - **Recommendation:** accept.
11. **Guards** (`if` conditions a node sits under). UX-30 doesn't list them.
    - **Recommendation:** leave them out.
12. **Fixtures.**
    - **Recommendation:** reuse `f205-canvas` and `bad-declaration.nf` for step 1, and add the `f206-details` oracle case for UX-30's extras.
    - If lint reports `Channel.of` as more than a warning, drop it from the fixture; the unit tests cover node-range containment either way.

**AGENTS.md "Ask first" / decide-and-record items:**
- **New runtime dependency:** none. Descriptions are plain text; no Markdown renderer.
- **Package boundaries or dependency-cruiser rules:** none.
- **Stored or exported format:** none. Details and selection are in memory; selection is not persisted.
- **Workflows:** none. The oracle job picks up the new case, and F-205 already restores the corpus.
- **`features.json` beyond `passes` and `notes`:** none.
- **Open questions:** none relevant.
- **Spec behaviour:** UX-30, UX-31 and UX-32 readings (points 1 to 6), recorded by an ADR.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing; F-205 and F-202 will have taken the next ones): "Show node details from the projection on the main thread and declaration details and diagnostics from the worker". It covers points 1 to 7 and 9, the containment rule, and `EngineApi.details`.
- **`ux.md`:** one clause each, citing the ADR:
  - UX-30: what "key directives" and "script preview" mean;
  - UX-31: the entry workflow's parameters and outputs;
  - UX-32: the buttons stay disabled until the popup exists.
- **`features.json` notes:**
  - **F-206:** "From F-205: owns the UX-24 selection highlight". At landing, "Verified …: step 1 by e2e/details.spec.ts (each kind in f205-canvas and bad-declaration, port sweep), step 2 by the summary test; UX-30 extras on f206-details; @visual pane baselines approved from CI".
  - **F-303:** enable Edit; React Flow's Enter selects.
  - **F-304:** enable Code.
  - **F-310:** re-enable multi-select and define the pane for several nodes.
  - **F-311:** `docSummary` and per-port descriptions.
  - **F-405:** add % modelled to `workflowSummary` (`projectionCoverage`).
  - **F-506:** registry rows show only `callee.module`.
  - **F-607:** FI-55 map in the entry summary.
  - **F-701:** announce selection changes.
  - **F-703:** hide Edit and Code in read-only mode.
  - **F-309:** the pane could link problems to the panel.
- **`progress.md` Decisions:** the ADR, `EngineApi.details`, task 0 if it was run, and the two new baselines.
- **`docs/plan/handoff/README.md`:** an F-206 row; delete this plan in the PR that merges F-206.
