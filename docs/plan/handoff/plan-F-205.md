# Plan: F-205, the canvas renders projections (node kinds, ports, edges, badges, minimap, zoom and fit)

Planner output, 2026-11-22. I changed nothing in the repo: `/home/user/wt-main` is clean on `main` at `d2d3d6a`. I took measurements in a throwaway clone at `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/rf`, and section 8 lists the probes. The F-106 names come from `/home/user/wt-F-106` (PR #32).

## 0. Scope

**In scope:**
- **Engine:** a pure canvas view built from a `Projection`. Each node gets its appearance, title, subtitle, badge and ports. Edges get a dataflow style and tooltip text. Positions come from an interim deterministic layered layout, which F-207 replaces.
- **Web:**
  - a workspace store holding the open project summary, the workflow tabs and the active tab's projection (the UI's read-only copy);
  - a tab strip of workflow tabs (UX-20);
  - a lazily loaded React Flow canvas with:
    - card and pill node components;
    - one edge component;
    - a hover tooltip;
    - Controls with a port-labels toggle;
    - MiniMap, zoom and fit.
  - node and channel counts in the status bar (UX-03);
  - a `window.nfBuilderWorkspace` hook for e2e.
- **Tests:**
  - an oracle-checked fixture tree, `tools/oracle/cases/f205-canvas`;
  - e2e DOM tests for steps 2 and 3;
  - `@visual` tests for step 1;
  - in CI, the Chromium e2e leg restores the corpus.

**Out of scope:**
- dragging and position persistence, ELK and auto-layout (F-207);
- the details pane, selection-driven highlighting of edges (UX-24, first clause) and the workflow summary (F-206);
- view modes (F-208);
- connecting (F-302);
- type-mismatch red (F-302/F-309);
- closing tabs, double-click to open, the breadcrumb (F-307);
- chain expand (F-308);
- delete and multi-select (F-310);
- the `F` shortcut, keyboard tooltip parity and axe (F-701);
- loading-progress UI (F-202, per the F-113 plan's point 9);
- a dark theme (no spec).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-20:** one canvas per workflow; tabs above the canvas.
- **UX-21:** node anatomy:
  - a kind icon tile, the name in monospace, one subtitle line (the kind, or the registry name), then one row per port;
  - inputs on the left, outputs on the right;
  - a "port labels" toggle.
- **UX-22:** kinds and colours:
  - process and module are green (a module shows its registry name);
  - workflow is blue with an offset shadow;
  - a chain is an amber pill;
  - factory and params are purple; output is pink;
  - take and emit are grey pills;
  - code is grey with a monospace first line;
  - unparsed is grey with an error outline.
- **UX-23:** a `typed` badge on the top edge; no badge means legacy.
- **UX-24:** queue channels are solid and value channels dashed; hover shows "type and source". Selection highlight and mismatch red are other features' (section 0).
- **UX-26:** F-205 covers pan, zoom, fit and minimap; the rest belongs to F-207, F-209 and F-310.
- **QA-12:** edge kinds differ by dash pattern and node kinds by icon.
- **QA-13:** contrast of at least 4.5:1, and reduced motion is honoured.
- **QA-01:** at most 450 kB gz of initial JS.
- **QA-30:** strict CSP.
- **AR-30:** UI state lives in Zustand.
- **AR-31:** nodes are thin presentational components keyed by projection id.
- **The architecture sketch:** the UI keeps a read-only copy of the projection.
- **ADR 0003:** React Flow (`@xyflow/react`) and ELK are named; apps/web imports engine, never a pack.
- **ADR 0008:** chains are one node (e.g. `mix → collect`), and nodes without a position get an ELK auto-layout. F-207 owns ELK.
- **ADR 0014:** `style-src 'self'`; React `style` props (CSSOM) are allowed, injected `<style>` elements are not.
- **ADR 0021:** baselines are rendered only in CI on `ubuntu-24.04` Chromium, with `updateSnapshots: "none"`, and approved by committing the CI `-actual.png`. The F-201 shell baseline must not change.
- **ADR 0036 (F-106):**
  - node ids are the layout keys;
  - `FlowType.dataflow` is `channel`, `value`, `plain` or `null`;
  - `callee.status` is `modelled`, `unparsed` or `unresolved`;
  - `callee.typed` and `callee.module` exist;
  - projections are plain data.
- **Spec gaps:**
  - the edge style for `plain` and unknown types;
  - how an unresolved callee looks;
  - whether the port-labels toggle persists;
  - the React Flow attribution.

  These are open points 8 to 12.

### 1.2 Measurements (sandbox, Chromium headless shell 1243)

| What | Result |
|---|---|
| `@xyflow/react` | 13.0.2, MIT, latest; 13.0.0 shipped 2026-11-16 and 13.0.2 on 2026-11-17. The last v12 is 12.12.1 (2026-11-02). |
| v13 transitive dependencies | `@xyflow/system` 1.0.0 (MIT), `classcat` (MIT), `react-compiler-runtime` 1.0.0 (MIT), d3 color/dispatch/drag/interpolate/selection/timer/transition/zoom (ISC), `d3-ease` (BSD-3-Clause). Zustand 5.1.0 is **shared** with ours; v12 would add Zustand 4. `pnpm audit --audit-level high`: no findings. |
| Bundle, canvas behind `React.lazy` | initial JS unchanged at **77.5 kB gz**. Lazy chunk: **v13 247 kB raw / 83.5 kB gz** (React Compiler output); v12 184 kB / 58.7 kB gz. CSS chunk 11.7 kB / 2.2 kB gz. |
| Production CSP (`vite preview` of the build with the meta policy, ADR 0040) | 0 violations, 0 console errors, no `<style>` elements; React Flow CSS arrives as a `<link>`. |
| `pnpm check:hosts` on that build | **fails on 4 URLs** in the lazy chunk: `http://www.w3.org/1999/xhtml` and `http://www.w3.org/2000/xmlns/` (d3 namespaces), `https://reactflow.dev?utm_source=attribution` (the attribution link), and `https://reactflow.dev/` (error help links). They need `scripts/non-fetched-urls.ts` entries. |
| Default a11y strings | Title case ("Zoom In", "Fit View", "Mini Map", "Control Panel"); node and edge descriptions mention "Press delete to remove it". Override them with `ariaLabelConfig`. |
| v13 colour mode | follows `prefers-color-scheme` by default. Use `forceColorMode="light"`, since the app has no dark tokens. |
| Build log | rolldown warns about the `"use no memo"` directive in react-compiler-runtime. Harmless. |
| Hovering an edge in Playwright | a horizontal edge's `<g>` has a 0-height box, so `locator.hover()` times out with "not visible". Hover by coordinates at the interaction path's midpoint instead. |
| elkjs 0.12.1 (for F-207) | 1.6 MB minified / **477 kB gz**; licence **EPL-2.0 OR GPL-3.0-or-later**. It must live in a worker and needs a licences row. Not for F-205. |
| Corpus `rnaseq-nf-typed` (Apache-2.0) | F-106 snapshots show `main.nf`: params, code, a workflow call, a chain, a process call, output. `RNASEQ`: take ×2, process calls, a chain, emit. Channel, value and plain edges all occur. The CI e2e job does not restore the corpus today (63 MB cache). |

### 1.3 Code facts
- **apps/web:**
  - `AppShell` renders the placeholder "No project open" over a CSS dot background;
  - `TabStrip` is static ("No files open");
  - `StatusBar` takes `nodes` and `channels` props, which are 0 today;
  - web unit tests use `renderToStaticMarkup`, so effects never run;
  - the tablist pattern in `shell/left-column.tsx` can be reused;
  - tone colours are in `palette/palette.css` (`.tone-green` and the rest);
  - glyph paths are in `palette/palette-glyph.tsx`;
  - there are no dark tokens.
- **F-106 as built:**
  - code-node label: the first line, at most 60 characters;
  - chain label: `.flatMap.collect`, with `steps[].operator`;
  - edge id: `` `${from.node}[${from.port}] -> ${to.node}[${to.port}]` ``;
  - port ids are unique within a node;
  - `formatFlowType` is exported by the engine, as are the projection types.
- **Fixtures:**
  - `tools/corpus/fixtures/bad-declaration.nf` has an entry workflow calling a modelled `FIRST` and an unparsed `SECOND`, and is already oracle-reproduced;
  - `s1-typed-calls-legacy` has a typed entry calling a legacy process and a legacy workflow.

### 1.4 Unbuilt names this plan relies on

| From | Name |
|---|---|
| F-113 (plan) | `EngineApi.open(request, onProgress?)` and `EngineApi.project(path, workflow)`; `OpenRequest {version, files}`; `ProjectSummary {revision, version, files, workflows: WorkflowRef[]}`; `ProjectionResult {revision, projection: Projection \| null}`; `EngineRefusal {ok: false, code, message}`; `getEngine()` in `apps/web/src/engine/engine-client.ts`; `window.nfBuilderEngine`; `e2e/engine.ts` `readProject(dir)` |
| F-106 (PR #32) | lang-core `Projection`, `GraphNode`, `GraphNodeKind`, `GraphEdge`, `Port`, `Callee`, `FlowType`, `Dataflow`, `WorkflowRef`; engine `formatFlowType`, `createProjector`; the test helpers `packages/engine/test/projection/open.ts` and `whitespace.ts` |

## 2. Design

### 2.1 View logic in the engine (AR-31)

`canvasView(projection, {portLabels})` is pure and runs on the main thread inside the lazy chunk. The worker returns only the `Projection`, so the port-labels toggle needs no round trip.

| Node | Appearance | Shape | Title | Subtitle |
|---|---|---|---|---|
| call to a process or agent, module null | `process` | card | `node.label` | `process` or `agent` |
| call with `callee.module` | `module` | card | label | the module (e.g. `nf-core/x`) |
| call to a workflow or pipeline | `workflow` | card | label | `module ?? "workflow"` or `"pipeline"` |
| callee `unparsed` or `unresolved` | `unparsed` | card | label | "could not be parsed" or "not found" |
| chain | `chain` | pill | operators joined by ` → ` | none |
| factory | `factory` | card | `channel.of` | "channel factory" |
| params | `params` | card | `params` | "pipeline inputs" |
| output | `output` | card | `output` | "publish" |
| take or emit | `take` or `emit` | pill | name | "take" or "emit" (shown as an uppercase prefix) |
| code | `code` | card | first line, monospace | "code" |

- **Badge:** `"typed"` when `kind === "call" && callee.typed === true`; otherwise null (legacy and unknown).
- **Ports:** `{id, label, type: formatFlowType(type) | null}`.
- **Edge dataflow:** `type.dataflow ?? "unknown"`.
- **Edge tooltip:** `` `${typeText} · ${variable ?? `${sourceTitle} ${sourcePortLabel}`}` ``, where `typeText` is "Unknown type" when both fields are null. For example `Value<Path> · params.fasta`, as in the mockup.
- **Node `ariaLabel`:** e.g. "GREET, process, typed, 1 input, 1 output".
- **Sizes:** deterministic, from `CANVAS_METRICS`:
  - a card is a fixed width (about 208 px), a header, plus `max(inputs, outputs)` rows of `rowHeight`; `rowHeight` is 20 with labels and 10 without;
  - a pill's width comes from its title length, clamped;
  - node components set `width`, `height` and `--port-row` through React `style` (CSSOM, CSP-safe), so CSS and layout can't drift;
  - long text is truncated with an ellipsis and has a `title` attribute.

### 2.2 Interim layout (replaced by F-207)

`layeredLayout(nodes, edges)` is deterministic and O(N+E):
1. Assign ranks by longest path using Kahn's algorithm, breaking ties by projection order. On a cycle, take the earliest remaining node and ignore its unprocessed in-edges.
2. Pin take nodes to rank 0, and emit and output nodes to the last rank.
3. Order nodes within a column by projection order.
4. Use a column gap of about 64 and a row gap of about 24, centring each column vertically.

`canvasView` places the nodes with it. F-207 swaps in sidecar or ELK positions.

### 2.3 Web
- **Workspace store** (Zustand, AR-30), with an injected engine getter so it can be tested with a fake:
  - **Fields:** `opening`, `summary`, `tabs`, `activeTab`, `content` (`loading` / `ready {revision, projection}` / `unavailable {message}`), `portLabels` (session only), `error`.
  - **`open(request)`:**
    1. calls `getEngine().open(request)`;
    2. sets one tab for the default workflow: the entry workflow of `main.nf`, else the first entry workflow, else the first named one, else none;
    3. loads that tab's projection.
  - **`openWorkflow` and `selectTab`:** load the projection with `project(path, workflow)`. A result for a superseded tab or revision is dropped. A refusal or a null projection becomes `unavailable`.
- **Tab labels:** the entry workflow shows its file name, a named workflow its name. The strip is a `tablist` with the arrow-key pattern from `left-column.tsx`.
- **`CanvasHost`:**
  - eager; a `tabpanel`;
  - with no project it renders exactly today's placeholder, so the F-201 baseline is unchanged;
  - otherwise "Opening project…", the unavailable message, or `<Suspense>` around `lazy(() => import("./workflow-canvas"))`, keyed by tab id.
- **`WorkflowCanvas`** (lazy chunk; imports `@xyflow/react/dist/style.css`, which in v13 sits in `@layer xyflow` so our unlayered CSS wins). `ReactFlow` with:
  - `forceColorMode="light"`;
  - `fitView`, with `fitViewOptions={{ maxZoom: 1 }}`;
  - `nodesDraggable={false}`, `nodesConnectable={false}`, `deleteKeyCode={null}`;
  - sentence-case `ariaLabelConfig` with no delete wording;
  - `<Background variant="dots">`;
  - `<Controls showInteractive={false}>` plus a `ControlButton`, "Hide port labels" / "Show port labels" with `aria-pressed`;
  - `<MiniMap ariaLabel="Minimap" nodeClassName={appearance class}>`;
  - `attributionPosition` per open point 12;
  - `onEdgeMouseEnter`, `onEdgeMouseMove` and `onEdgeMouseLeave` driving one `EdgeTooltip` (`role="tooltip"`) at the pointer, outside the zoomed viewport so it stays readable;
  - edges carry `ariaLabel = tooltip`;
  - `data-canvas-state="ready"` once `useNodesInitialized()` and the first `fitView()` have resolved (the e2e wait).
- **Handles:** `in:<port>` and `out:<port>`. The edge type is `flow`, using `getBezierPath` and `BaseEdge` with class `edge-<dataflow>`.
- **Styles:**

  | Edge | Stroke |
  |---|---|
  | channel | solid |
  | value | dashed `6 4` |
  | plain | dotted `1 4`, round caps |
  | unknown | solid, muted |

  Hover thickens the stroke in the accent colour.
- **CSS:**
  - tone tokens move to `:root` in `styles.css` (`--tone-<t>-fg/-bg/-border`), and `palette.css` uses them with identical values;
  - `canvas.css` styles `.canvas-node.is-<appearance>`;
  - the workflow gets an offset `box-shadow`;
  - unparsed gets a 2 px `--color-error` (#9b1c1c) outline plus a warning glyph (QA-12);
  - the `typed` badge is an absolute pill straddling the top edge.
- **Glyph paths** move to `apps/web/src/glyphs.ts`, shared by the palette and the canvas. The palette markup stays identical. New glyphs: module (cube), take, emit, code, unparsed (warning).
- **AppShell:** `StatusBar nodes={projection.nodes.length} channels={projection.edges.length}` when `content.status === "ready"`.
- **`main.tsx`:** defines a getter for `window.nfBuilderWorkspace` returning `{open, openWorkflow}`, as F-113 does for `window.nfBuilderEngine`.

### 2.4 Fixtures and visual strategy
- **New oracle case `f205-canvas`** (lint ok, `run -stub` ok). The builder writes it with the syntax reference, the vendored skills and the oracle, modelled on `s1-typed-calls-legacy(-module)` and rnaseq-nf-typed, never from memory. Its typed entry workflow has:
  - a params block, an output block and a code statement;
  - a channel factory feeding a typed local process;
  - a legacy local process;
  - a chain ending in a value result;
  - a typed named workflow with take and emit, fed a value and a plain `params` path;
  - a legacy named workflow;
  - a registry-shaped legacy module under `modules/nf-core/<name>/` with `meta.yml`, written for the fixture rather than copied.

  It yields channel, value and plain edges.
- **Unparsed:** `tools/corpus/fixtures/bad-declaration.nf` (`SECOND`).
- **Per-kind snapshots:** clipped screenshots of one node of each appearance (padding 16 px):
  - process, process-legacy, module, workflow, workflow-legacy, chain, factory, params, output, code, take, emit, unparsed, process-compact;
  - taken at viewport 2560×1440, where fit stays at **zoom 1**; the test asserts the zoom is 1, so a later layout change fails loudly instead of silently rescaling.
- **Corpus pipeline:** whole-centre-column screenshots of `rnaseq-nf-typed` (entry and `RNASEQ`), covering edges, minimap and controls in context.
- **All baselines** come from CI artefacts only (ADR 0021).

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/canvas/types.ts` | `type CanvasAppearance = "process"\|"module"\|"workflow"\|"chain"\|"factory"\|"params"\|"output"\|"take"\|"emit"\|"code"\|"unparsed"`; `type EdgeDataflow = Dataflow \| "unknown"`; `CanvasPortView {id; label; type: string\|null}`; `CanvasNodeView {id; kind: GraphNodeKind; appearance; shape: "card"\|"pill"; title; subtitle: string\|null; badge: "typed"\|null; inputs; outputs; ariaLabel; x; y; width; height; rowHeight}`; `CanvasEdgeView {id; source; sourcePort; target; targetPort; dataflow: EdgeDataflow; tooltip}`; `CanvasView {nodes; edges}`; `CanvasViewOptions {portLabels: boolean}`. All fields readonly. |
| `packages/engine/src/canvas/metrics.ts` | `CANVAS_METRICS` (card width, header height, row heights with and without labels, pill height and width clamp, gaps) |
| `packages/engine/src/canvas/layout.ts` | `LayoutNode {id; kind: GraphNodeKind; width; height}`; `layeredLayout(nodes: readonly LayoutNode[], edges: readonly {source: string; target: string}[]): ReadonlyMap<string, {x: number; y: number}>` |
| `packages/engine/src/canvas/view.ts` | `canvasView(projection: Projection, options: CanvasViewOptions): CanvasView` |
| `packages/engine/src/canvas/index.ts` | re-exports |
| `packages/engine/test/canvas/{view,layout,fixture}.test.ts` | section 4 |
| `tools/oracle/cases/f205-canvas/**` | the fixture tree (2.4) |
| `apps/web/src/workspace/workspace-store.ts` | `WorkflowTab {id; path; workflow: string\|null; label}`; `CanvasContent`; `WorkspaceState`; `WorkspaceActions {open(r: OpenRequest): Promise<ProjectSummary>; openWorkflow(path, workflow: string\|null): Promise<void>; selectTab(id): Promise<void>; setPortLabels(v: boolean): void}`; `createWorkspaceStore(engine: () => EngineApi): StoreApi<WorkspaceState & WorkspaceActions>`; `workspaceStore`; `useWorkspace<T>(selector: (s) => T): T`; `defaultWorkflow(ws: readonly WorkflowRef[]): WorkflowRef\|null`; `tabFor(ref: WorkflowRef): WorkflowTab`; `WorkspaceHook`; `declare global { interface Window { nfBuilderWorkspace?: WorkspaceHook } }` |
| `apps/web/src/canvas/canvas-host.tsx` | `CanvasHost(): JSX.Element` |
| `apps/web/src/canvas/workflow-canvas.tsx` | `default function WorkflowCanvas(props: {projection: Projection; portLabels: boolean; onPortLabelsChange(v: boolean): void}): JSX.Element`; `CANVAS_ARIA_LABELS` |
| `apps/web/src/canvas/flow-elements.ts` | `type CanvasNodeData = {view: CanvasNodeView; portLabels: boolean}`; `type CanvasFlowNode = Node<CanvasNodeData, "card"\|"pill">`; `type CanvasEdgeData = {dataflow: EdgeDataflow; tooltip: string}`; `type CanvasFlowEdge = Edge<CanvasEdgeData, "flow">`; `inputHandle(port)`, `outputHandle(port)`; `toFlowNodes(view, portLabels): CanvasFlowNode[]`; `toFlowEdges(view): CanvasFlowEdge[]` |
| `apps/web/src/canvas/canvas-nodes.tsx` | `CardNode`, `PillNode` (`NodeProps<CanvasFlowNode>`, presentational); `NODE_TYPES` |
| `apps/web/src/canvas/flow-edge.tsx` | `FlowEdge(props: EdgeProps<CanvasFlowEdge>)`; `EDGE_TYPES` |
| `apps/web/src/canvas/edge-tooltip.tsx` | `EdgeTooltip({text, x, y})` |
| `apps/web/src/canvas/canvas.css` | node, pill, badge, edge and tooltip styles |
| `apps/web/src/glyphs.ts` | `type GlyphName = PaletteIcon \| CanvasAppearance`; `GLYPH_PATHS: Record<GlyphName, string>` |
| `apps/web/test/{workspace-store,flow-elements}.test.ts` | section 4 |
| `e2e/canvas.ts` | local `WorkspaceHook`; `openProject(page, dir)`, using F-113's `readProject` and the version from the version combobox; `openWorkflow(page, path, workflow)`; `canvasReady(page)`; `node(page, id)`; `edge(page, id)`; `hoverEdge(page, id)`, which moves the mouse to `getPointAtLength(len/2)` of `.react-flow__edge-interaction` through `getScreenCTM`; `viewportZoom(page)`; `nodeClip(page, id, pad?)`; `F205_FIXTURE` and the node and edge id constants |
| `e2e/canvas.spec.ts` | section 4 |

### 3.2 Change
- **`apps/web/package.json`:** `"@xyflow/react": "13.0.2"`, then `pnpm install`.
- **`app-shell.tsx`:** `CanvasHost`, and status-bar counts from the store.
- **`shell/tab-strip.tsx`:** workflow tabs.
- **`main.tsx`:** the hook.
- **`styles.css`:** tone tokens.
- **`palette/palette.css` and `palette-glyph.tsx`:** use the tokens and `glyphs.ts`. No visual change.
- **`packages/engine/src/index.ts`:** export `canvasView`, `layeredLayout`, `CANVAS_METRICS` and the types.
- **`tools/oracle/cases/cases.yaml`:** the `f205-canvas` case, `spec: [F-205, UX-22, UX-23, UX-24]`, `lint` and `run` `expect: ok`.
- **`scripts/non-fetched-urls.ts`:** exact entries for the 4 URLs in 1.2, each with its reason. The `https://reactflow.dev/` entry is a prefix entry.
- **`.github/workflows/ci.yml`** (e2e job): `- uses: ./.github/actions/corpus` with `if: matrix.browser == 'chromium'`, after setup and before `pnpm smoke`.
- **`test/workflows.test.ts`:** its case.
- **Not changed:**
  - dependency-cruiser (external packages are allowed; apps/web still imports only engine);
  - lang-core;
  - F-106 and F-113 code;
  - the F-201 and F-204 baselines;
  - the AGENTS.md command table (no new script).

## 4. Tests (written before the implementation)

| File: test name | Asserts |
|---|---|
| **engine `test/canvas/view.test.ts`** (synthetic projections) | |
| `F-205 UX-21 UX-22: each node kind and callee variant maps to its appearance, shape, title and subtitle` | the table in 2.1, including agent and pipeline |
| `F-205 UX-22: a registry callee's subtitle is its module name` | |
| `F-205 UX-22: unparsed and unresolved callees draw as unparsed, subtitled "could not be parsed" and "not found"` | |
| `F-205 UX-23 ADR-0007: only a call whose callee is typed carries the typed badge` | `typed` false or null gives no badge; non-call nodes have no badge |
| `F-205 UX-22 ADR-0008: a chain's title lists its operators joined by arrows` | `flatMap → collect` |
| `F-205 UX-24 LA-28: edge dataflow comes from the type; null is unknown` | |
| `F-205 UX-24: the tooltip is the formatted type and the variable, or the source node and port` | including "Unknown type" |
| `F-205 UX-21: without port labels every port is kept and nodes are shorter` | |
| `F-205 AR-11 AR-31: view ids are projection keys, edges reference existing ports, and the view survives structuredClone` | |
| **`test/canvas/layout.test.ts`** | |
| `F-205: every edge's target is in a later column than its source` | |
| `F-205 UX-51: take nodes are in the first column; emit and output nodes in the last` | |
| `F-205: nodes in a column keep projection order and don't overlap` | |
| `F-205 AR-11: the layout is deterministic, terminates on a cycle, and is unchanged by a whitespace-only re-parse` | uses F-106's `whitespace.ts` |
| **`test/canvas/fixture.test.ts`** | |
| `F-205 step 1 step 2: the f205-canvas fixture projects every appearance the e2e tests screenshot, with the expected badges and edge dataflows` | the ids, appearances, badges and at least one channel, value and plain edge |
| **web `workspace-store.test.ts`** (fake `EngineApi`) | |
| `F-205 UX-20: opening a project opens main.nf's entry workflow as the only tab and loads its projection` | |
| `F-205 UX-20: the default tab falls back to another entry workflow, then the first named one; none gives no tab` | |
| `F-205 UX-20: openWorkflow adds a tab once and focuses it; selectTab loads that tab` | |
| `F-205: a projection for a superseded tab or revision is ignored` | |
| `F-205 IO-14: a refusal or a null projection shows an unavailable message` | |
| `F-205 UX-20: entry tabs are labelled with the file name, named workflows with their name` | |
| **web `flow-elements.test.ts`** | |
| `F-205 AR-31: toFlowNodes keeps ids, positions and sizes and passes the view as data` | |
| `F-205 UX-24: toFlowEdges maps ports to handle ids and sets aria labels from tooltips` | |
| **web `app-shell.test.tsx`** (extend) | |
| `F-205 UX-03: the status bar counts the active canvas's nodes and channels` | |
| `F-205 F-201: with no project the shell renders the "No project open" placeholder and no tabs` | |
| **root `test/workflows.test.ts`** | |
| `F-205 step 1 ADR-0011: the Chromium e2e leg restores the corpus before the tests` | |
| **e2e `e2e/canvas.spec.ts`** | |
| `F-205 step 1 UX-20 AR-10 QA-30: opening a fixture shows the entry workflow tab with one node per projection node and one edge per edge, and no CSP violation or console error @smoke` | counts from `window.nfBuilderEngine.project`; the status bar matches. Runs on Firefox and WebKit too. |
| `F-205 UX-20 QA-11: opening a named workflow adds a selected tab; the arrow keys and clicks switch canvases` | |
| `F-205 UX-21 UX-22: each node shows its icon, title and subtitle, inputs on the left edge and outputs on the right` | handle x against the node centre; the module subtitle |
| `F-205 step 2 UX-23 ADR-0007: typed processes and workflows show the typed badge; legacy processes, workflows and modules show none` | |
| `F-205 step 2 UX-24 QA-12 LA-28: value edges are dashed, channel edges solid, plain edges dotted` | computed `stroke-dasharray` |
| `F-205 step 3 UX-24: hovering an edge shows its type and source` | `hoverEdge` gives a tooltip with `Value<…> · <variable>` and `Channel<…> · …`; leaving hides it |
| `F-205 UX-21: the port labels toggle hides and restores labels and node height` | `aria-pressed` |
| `F-205 UX-26: zoom in and out change the zoom, fit view brings every node into view, and the minimap shows every node` | |
| `F-205 UX-22: an unparsed callee draws with an error outline and "could not be parsed"` | `bad-declaration.nf` |
| `F-205 QA-01 ADR-0003: React Flow is only in a lazy chunk` | the Vite manifest: the canvas module is a dynamic entry and is not reachable from `index.html`'s static imports |
| `F-205 step 1 UX-21 UX-22 UX-23: each node kind matches its approved baseline @visual` | 2.4 clips, zoom 1 asserted |
| `F-205 step 1 UX-20 UX-24 UX-26: the rnaseq-nf-typed corpus pipeline's canvases match their approved baselines @visual` | entry and `RNASEQ`; fails with "run pnpm corpus:fetch" if the corpus is missing |

## 5. Tasks (in order; one builder run each; branch `feat/F-205` after F-106 and F-113 merge)

1. **Fixture.**
   - Files: `tools/oracle/cases/f205-canvas` and its `cases.yaml` entry; `fixture.test.ts` at projection level (kinds, callee status, `typed`, `module`, dataflows).
   - Done when `pnpm oracle -- --case f205-canvas`, `pnpm --filter @nf-builder/engine exec vitest run test/canvas` and `pnpm check` pass.
2. **Engine view and layout.**
   - Files: `canvas/*`, the exports, `view.test.ts` and `layout.test.ts`; the appearance asserts in `fixture.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
3. **Wiring and canvas skeleton.**
   - Files:
     - the dependency;
     - `workspace-store`, the tab strip and `CanvasHost`;
     - the lazy `WorkflowCanvas` with React Flow, Controls, MiniMap, fit, `ariaLabelConfig`, `forceColorMode` and a basic card;
     - `flow-elements`;
     - the status-bar counts and the hook;
     - the non-fetched URLs;
     - `e2e/canvas.ts`;
     - the @smoke, tabs, zoom/fit/minimap and lazy-chunk e2e tests;
     - the web unit tests.
   - Done when:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts` pass;
     - `pnpm audit --audit-level high` passes;
     - `pnpm test:e2e -- --grep "F-205|F-201|F-204|F-113"` passes;
     - `pnpm smoke` stays under 60 s.
4. **Node anatomy.**
   - Files: card and pill per appearance, glyphs, tone tokens, badge, unparsed outline, workflow shadow, the port-labels toggle; the e2e tests for UX-21/22, step 2 badges, the toggle and unparsed.
   - Done when `pnpm test:e2e -- --grep "F-205|F-204|F-201"` and `pnpm check` pass. The palette markup and F-201 baseline must be unchanged; CI's @visual run checks the baseline.
5. **Edges.**
   - Files: `FlowEdge` with the dash classes, the hover tooltip, aria labels; the step 2 dash and step 3 hover e2e tests.
   - Done when `pnpm test:e2e -- --grep F-205` and `pnpm check` pass.
6. **Visual tests and CI.**
   - Files: both `@visual` tests, the ci.yml corpus step and its `workflows.test.ts` case.
   - Done when `pnpm check` passes and the PR's `Playwright all tests (chromium)` job runs them. Then the orchestrator downloads `playwright-chromium`, views each `-actual.png` against UX-22 and the mockup, and commits them under `e2e/__screenshots__/canvas.spec.ts/`. CI must then be green.
7. **Records** (orchestrator, section 7).
   - Done when `pnpm check` and the Scope guard pass (with `scope-change` if open point 1 B is taken).

## 6. Open points (each with a recommendation; none decided here)

1. **Step 1's "each template" can't be met in F-205.** F-203 hasn't been built, Q6 is open, and F-203's own step 1 ("the canvas shows the expected nodes") needs this canvas: a cycle. F-207 is *not* needed.
   - **Recommendation B:**
     - F-205 step 1 becomes "Open fixture projects covering every node kind and a corpus pipeline; visual snapshots per node kind match baselines".
     - F-203 step 1 gains "…; each template's canvas matches its approved visual baseline". F-203's plan adds one whole-canvas `@visual` row per template.
     - F-203 `depends_on` adds F-205.
     - The check moves rather than being dropped, which needs an ADR and the `scope-change` label.
     - Order: F-113 → F-202 ∥ F-205 → F-203 ∥ F-206 ∥ F-207 → F-208.
   - **C (no text change):** F-205 merges built but not passing (as F-501 did), and F-203's PR adds the template rows and sets F-205 passing. F-206 to F-208 then wait for F-202 and F-203. F-203 must *not* list F-205 in `depends_on`, or the two deadlock.
   - **Not recommended, A** (pass on fixtures with a note): it reads as weakening the step.
2. **React Flow version (decide and record: new runtime dependency).**
   - **Recommendation:** 13.0.2, pinned exactly. It is the current major (ADR 0003's keep-current policy, and Renovate would otherwise open a major bump straight away). Zustand 5 is shared, styles sit in `@layer`, and it was clean under the CSP. Cost: 83.5 kB gz versus 58.7 kB in a lazy chunk, with no QA-01 impact.
   - **Fallback:** 12.12.1 if the builder hits a v13 defect; record it.
   - Licences: MIT/ISC/BSD-3. No `docs/licences.md` row needed under its own rule ("terms beyond a standard permissive npm licence").
3. **Lazy canvas.**
   - **Recommendation:** yes. The initial JS stays at 77.5 kB gz, and the shell without a project, including the F-201 baseline, is untouched.
4. **Interim layered layout against ADR 0008's "ELK for nodes without a position".**
   - **Recommendation:** record it in the F-205 ADR as an interim that F-207 replaces. ADR 0008's end state is unchanged, so there is no supersede.
   - Not ELK now: 477 kB gz, an EPL-2.0/GPL licence, and it needs a worker; all F-207's.
5. **View logic in the engine, run on the main thread.**
   - **Recommendation:** accept (AR-31). It is cheap, and the toggle is instant.
6. **Corpus pipeline in CI e2e (decide and record: workflow edit).**
   - **Recommendation:** restore the corpus action in the Chromium e2e leg. ADR 0011 makes the corpus the single source, and the cache restore is quick.
   - **Alternative:** vendor rnaseq-nf-typed (Apache-2.0, with a licences row) into `e2e/fixtures/`.
7. **Test hook `window.nfBuilderWorkspace`.**
   - **Recommendation:** accept, with the same rationale as F-113's point 7. No user path opens a project until F-202, F-203 or F-401.
8. **Spec gap, UX-24 edge styles** (clarify UX-24 in `ux.md` via the ADR):
   - plain values dotted;
   - unknown solid and muted, with the tooltip "Unknown type".

   **Recommendation:** accept.
9. **Spec gap, unresolved callee.**
   - **Recommendation:** draw it as unparsed (grey, error outline) with the subtitle "not found"; clarify UX-22.
10. **Badge rule.**
    - **Recommendation:** `callee.typed === true` for any call: process, workflow, agent or pipeline.
11. **Port-labels toggle persistence.**
    - **Recommendation:** session-only in the workspace store. Persisting it would add a localStorage format (decide and record) for little gain.
12. **React Flow attribution.**
    - **Recommendation:** keep it visible (the authors ask non-Pro users to; MIT allows hiding), placed so it doesn't overlap the minimap or F-208's top-right toggle, e.g. `bottom-center`.
    - Its URLs need `non-fetched-urls.ts` entries either way.
13. **UX-24 highlight on selection.**
    - **Recommendation:** F-206, which owns selection; add to its notes. React Flow selection is left enabled.
14. **Status-bar counts.**
    - **Recommendation:** wire them in F-205, since UX-03 would otherwise read "0 nodes" over a full canvas.
15. **F-202 coordination.** Both features need "the open project in the UI".
    - **Recommendation:** whichever lands first owns `apps/web/src/workspace/`. F-202 then calls `workspaceStore.open()` after its IndexedDB read and adds the progress UI (F-113 point 9). Add this to F-202's notes.

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** `@xyflow/react` (2).
- **Workflow edit:** the `ci.yml` e2e corpus step (6).
- **`features.json` beyond `passes` and `notes`:** only if 1 B is taken.
- **ADR conflict:** ADR 0008 interim (4).
- **Spec behaviour:** UX-22 and UX-24 clarifications (8, 9).
- **Stored or exported format:** none, since node keys are already ADR 0036's (11).
- **Package boundaries:** none.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number): "Render projections with React Flow 13 in a lazily loaded canvas, with view logic in the engine and an interim layered layout". It covers points 1 to 12 and the 1.2 measurements, including the CSP result and the IO-41 entries.
- **Spec:** `ux.md` UX-22 (unresolved callee) and UX-24 (plain dotted, unknown solid), citing the ADR.
- **`features.json` notes:**
  - **F-205:** "Verified …: step 1 by `e2e/canvas.spec.ts` @visual (per-kind clips from `tools/oracle/cases/f205-canvas` and `bad-declaration.nf`; rnaseq-nf-typed canvases), step 2 and step 3 by the DOM tests".
  - **F-206:** selection highlight; the store's `content`; node ids.
  - **F-207:**
    - replace `layeredLayout` in `canvasView`;
    - enable dragging;
    - ELK is 477 kB gz with an EPL-2.0/GPL licence (worker plus licences row);
    - re-approve the corpus canvas baselines;
    - the per-kind test asserts zoom 1.
  - **F-208:** tabs gain a mode.
  - **F-302/F-309:** mismatch red over `edge-<dataflow>`.
  - **F-307:** close tabs, breadcrumb, double-click via `openWorkflow`.
  - **F-701:** the `F` shortcut, keyboard tooltip parity, verifying the a11y strings.
  - **F-202:** point 15.
  - **F-203:** point 1.
- **`progress.md` Decisions:** the ADR, the dependency, the ci.yml step, the hook, the IO-41 entries, the step-1 resolution.

## 8. Evidence

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`.

| Probe | Path |
|---|---|
| Clone with the lazy probe (`apps/web/src/canvas/canvas-probe.tsx`, `app-shell.tsx` edited, v13 installed); `pnpm build && pnpm check:budget && pnpm check:hosts` | `rf/` |
| CSP, console, a11y labels and edge-geometry probe against `vite preview --port 4191` | `rfpw/probe.mjs` (needs `PW_CHROMIUM_EXECUTABLE`) |
| Tarballs and the CHANGELOG (from raw.githubusercontent.com) | `xyf13/`, `xyf12/`, `elk/` |
