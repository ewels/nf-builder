# Plan: F-207, layout sidecar and ELK auto-layout in a worker; positions persist and survive re-parse

Planner output, 2026-11-22. I changed nothing in the repo.

**What I read:**
- `/home/user/wt-main`: `main` at `006d570`.
- F-113: `origin/feat/F-113` at `7526d72`.
- The F-202 and F-205 plans in `docs/plan/handoff/`.
- elkjs 0.12.1: the tarball the F-205 planner left in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/elk/package/`. I read it as text only.
- `npm view elkjs`, checked today.

## 0. Scope

**In scope:**
- **Engine (pure):**
  - the sidecar format v1, with parse, canonical format and migrations;
  - carrying node keys across changes by diffing projections;
  - the ELK input graph, and placing nodes that have no position.
- **Engine service** (F-113). While a project is open, the service owns the sidecar:
  - `project()` returns the stored positions;
  - a new `setLayout` call;
  - keys are carried on every change;
  - the sidecar's new text goes into the change's `files`, so F-202 autosaves it.
- **Web:**
  - elkjs in its own lazily started worker;
  - the canvas lays out unplaced nodes;
  - dragging (mouse and keyboard) persists;
  - an "Auto-layout" control (UX-26);
  - layout notices;
  - a store `apply(command)` that refreshes the canvas, plus `window.nfBuilderWorkspace.apply` (needed for step 3).
- **Re-approval** of the F-205 baselines that ELK changes.

**Out of scope:**
- undo of moves and auto-layout (F-209 covers edit commands; open point 11);
- marquee and shift-click multi-select (F-310);
- drop positions for palette adds (F-301);
- a rename UI (F-303);
- the export checkbox (F-404);
- how the Files view shows the sidecar (F-210);
- persisting the viewport or chain expansion (no spec row).

## 1. Findings

### 1.1 Spec and ADRs
- **ADR 0008:**
  - layout lives in `.nf-builder/layout.json`, with keys taken from the code;
  - "Renames made in the app carry their keys along";
  - nodes without a position get an ELK layout;
  - export includes the sidecar;
  - the worst case for an orphaned key is that the node is re-placed.
- **ADR 0036:**
  - the key grammar is `path#workflow/local`, with `var`, `var~n`, `callee@n`, `:code@n`, `:take:`, `:emit:`, `:params` and `:output`;
  - a key changes only when the node's variable, its callee, or its order among same-callee unassigned nodes changes;
  - `parseNodeKey` inverts `formatNodeKey`;
  - the sidecar makes this grammar a stored format.
- **IO-02:** the sidecar path. **IO-01:** autosave after each applied command. **IO-20 and UX-62:** the sidecar is optional in export (F-404).
- **UX-26:** "auto-layout (ELK) for all or selected nodes". F-205's plan leaves this to F-207.
- **ADR 0003:** names ELK.js and Comlink; apps/web may import engine, never a pack.
  - There is **no ELK spike or ELK ADR**. S2 was the parser spike. So the dependency is new: decide and record.
- **ADR 0014 and ADR 0040:** `script-src 'self'`, `worker-src 'self'`, no `unsafe-eval`.
- **ADR 0021:** visual baselines come from CI only.
- **ADR 0039 misattributes work:** it says "History is F-207's" and "Undo, redo and autosave (F-207)". Undo is F-209's and autosave is F-202's. 0039's body can't be edited, so the F-207 ADR should clarify this.
- **Notes left for F-207:**
  - **F-111:** ids change after variable introduction, a statement move or a rename, so diff the projections.
  - **F-202 plan:** "`layout.json` written through `writeFiles` is autosaved". This plan uses `setLayout` instead (open point 3).
  - **F-205 plan:**
    - replace `layeredLayout`;
    - enable dragging;
    - ELK goes in a worker with a licences row;
    - re-approve the corpus baselines;
    - the per-kind test asserts zoom 1.

### 1.2 Code facts
- **F-113 service:**
  - it is a serial queue;
  - `apply`, `applyPatches` and `writeFiles` each advance the revision and drop the projector;
  - `apply` and `applyPatches` refuse a stale revision;
  - `ProjectChange.files` is what F-202 autosaves.
- **The projector is not really a snapshot.** `createProjector` reads the live model lazily, and `project()` rebuilds the graph on every call. So "before" projections must be taken **before `commit`**.
- **`.json` files are `json` language.** `setFile` on the sidecar is cheap and re-models only that file.
- **F-111 rename** edits identifiers in the declaring file and in includers that don't alias the name.
- **Workflow-body commands reprint the whole declaration.** Node offsets can't be mapped through the patches, so diffing projections is the only route.
- **AddCall refuses a second call of a process** (ADR 0039), so process callees are unique within a workflow.
- **Reusable test helpers:** `packages/engine/test/edit/harness.ts` (`buildCommand`, sequences), `helpers.ts` (`stateFor`) and `test/projection/whitespace.ts` (`perturbWhitespace`).
- **Fixture `tools/oracle/cases/f111-start-typed`** (oracle-clean already):
  - its entry workflow has `reads`, `more`, `COUNT(channel.fromPath(...))` and `more.view()`, and includes `ALIGN`, `COUNT` and `PAIR`;
  - expected keys: `main.nf#/reads`, `main.nf#/more`, `main.nf#/COUNT@1`, `main.nf#/channel.fromPath@1`, `main.nf#/.view@1` (the builder confirms them from the projection);
  - renaming `COUNT` changes `COUNT@1`, so step 3 needs **no new oracle case**.
- **`scripts/check-hosts.ts`** scans every `.js` file in dist and reports unused ignore entries.

### 1.3 elkjs 0.12.1
- Latest on npm (modified 2026-10-28).
- Licence `EPL-2.0 OR GPL-3.0-or-later`. No dependencies.
- `elk-worker.min.js` is 1.63 MB (about 477 kB gzipped, per F-205). `elk-api.js` is 9.8 kB.
- **It takes over its worker's messages.** `lib/elk-worker.js:81861-81863` sets `self.onmessage` to its dispatcher whenever it runs with no `document` and with `self` defined. The dispatcher answers with `{id, error}`. So ELK **must not share the Comlink engine worker**: it would reply to Comlink's messages.
- No `eval` and no `new Function`, so it is safe under the CSP.
- It embeds namespace URIs that `check:hosts` will flag:
  - `http://www.w3.org/2001/XMLSchema`;
  - `http://www.eclipse.org/emf/2002/Ecore`;
  - `http://www.eclipse.org/emf/2003/XMLType`;
  - `http://www.eclipse.org/elk/ElkGraph`.
- `elk-api` accepts `workerUrl` (a classic worker using ELK's own protocol) or `workerFactory`.

### 1.4 Unbuilt names this plan relies on (rebase on the built versions before tasks 3 to 6)

| From | Names |
|---|---|
| F-113 (branch) | `EngineApi`, `ProjectionResult`, `ProjectSummary`, `ProjectChange`, `Applied`, `EngineRefusal`, `createEngineService`, `connectEngine`, `getEngine`, `window.nfBuilderEngine`, `e2e/engine.ts` |
| F-202 (plan) | `WorkspaceApi` (`createProject`, `openProject`, `readFile`, `flush`), `createWorkspace` autosaving the change methods, `e2e/projects.ts` (`saveState`, `readStoredDatabase`), reopening the latest project after a reload |
| F-205 (plan) | `canvasView`, `CanvasView`, `CanvasNodeView`, `CANVAS_METRICS`, `layeredLayout`, the workspace store (`content`, `open`, `openWorkflow`), `WorkflowCanvas`, `toFlowNodes`, `window.nfBuilderWorkspace`, `e2e/canvas.ts` (`openProject`, `canvasReady`, `node`) |

## 2. Design

### 2.1 Sidecar format v1 (a stored format, needs an ADR)

```json
{
  "version": 1,
  "nodes": {
    "main.nf#/COUNT@1": { "x": 272, "y": 40 },
    "main.nf#/reads": { "x": 12, "y": 12 }
  }
}
```

- **What it is:** `.nf-builder/layout.json` is an ordinary project file. It is stored in IndexedDB, exported and readable like any other.
- **`nodes`:** maps an ADR 0036 key to the node's top-left corner in canvas coordinates (React Flow `position`).
- **Canonical text** (`formatLayout`):
  - 2-space indent;
  - one node per line;
  - keys sorted by UTF-16 code unit;
  - coordinates rounded to integers;
  - a trailing newline.

  The same document always gives the same bytes, so there are no spurious autosaves and git diffs stay small.
- **Lenient reading:**
  - an entry is dropped (and counted) when `parseNodeKey` rejects its key, or when `x` or `y` is not finite or lies outside ±1e6;
  - unknown fields are ignored, and v1 doesn't keep them on rewrite.
- **Versioning:**
  - `version` is an integer;
  - additive optional fields don't bump it;
  - a change of meaning bumps it and adds `LAYOUT_MIGRATIONS[n]` (from n to n+1), run in order on read;
  - a shipped migration is never edited;
  - writes always use the current version.
- **Status values:**

  | Status | When | Effect |
  |---|---|---|
  | `absent` | no file | |
  | `ok` | readable | |
  | `invalid` | not JSON, wrong shape, or version missing or below 1 | Positions are ignored, and the next layout write replaces the file. Notice: "The layout file couldn't be read (…). Nodes are laid out automatically, and the file will be replaced when the layout is saved." |
  | `newer` | version above the current one | Positions are ignored and the file is **never written**. Notice: "The layout file comes from a newer nf-builder. Reload to update; until then, positions aren't saved." |

- **What gets stored:** every node of a workflow, once its canvas has been shown (lazily, per workflow).
- **Pruning:**
  - entries are removed when the carry finds the node gone, or when the workflow or file is gone;
  - entries of an unmodelled (Unparsed) workflow are kept.

### 2.2 Where layout runs and how it reaches the canvas

```
engine worker (service)                         main thread (lazy canvas chunk)            ELK worker
 sidecar doc + status ──── project() ─────────► store: projection + positions
 carry on apply/applyPatches/writeFiles           unplaced? canvasView sizes → elkGraph ──► elk-worker.min.js
 setLayout(write) ◄──── positions to save ─────── placeNodes (engine, pure) ◄── positions ──
 files += sidecar text → F-202 autosave
```

**Engine service:**
- The service is the **only writer** of the sidecar. It parses the file at `open`.
- **`project(path, workflow)`** returns `positions`: the stored entries for that projection's node ids.
- **`setLayout({path, workflow, positions, replace})`:**
  - checks that every id is a node of that workflow's current projection and that the coordinates are finite, and refuses with `invalid` otherwise;
  - merges the positions, or replaces that workflow's entries;
  - writes the canonical text into the model;
  - returns `{revision, files, layout}`, where `files` is the sidecar or empty (empty when nothing changed or the status is `newer`);
  - does **not** advance the revision or drop the projector (open point 4).
- **Commands never touch the sidecar:**
  - `apply` and `applyPatches` refuse patches that touch `LAYOUT_PATH`, with "nf-builder keeps .nf-builder/layout.json up to date itself. Move nodes on the canvas instead.";
  - `writeFiles` may write it (imports and backups): the written text replaces the document, and that write skips the carry;
  - command patches and inverses never include the sidecar.

**ELK worker:**
- It starts lazily from the canvas chunk: `elk-api.js` with `workerUrl` from `import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url"`.
- That is a classic worker speaking ELK's own protocol: no Comlink, and the GWT output isn't re-bundled.
- **Fallback** if `?url` misbehaves: a module worker that only imports `elk-worker.min.js`.

**Canvas:**
- **When some nodes have no position:**
  1. `canvasView(projection, {portLabels: true})` (full sizes, so turning labels off never causes overlaps);
  2. `elkGraph`, then ELK, then `placeNodes`;
  3. the store takes the positions and the canvas renders;
  4. `setLayout` saves **only the new positions**.

  `data-canvas-state="ready"` waits for all of this.
- **If ELK fails:** F-205's `layeredLayout` positions are used and not saved. Notice: "Automatic layout isn't available (…). Nodes are placed in columns."
- **Dragging:**
  - nodes become draggable, and changes apply locally (`applyNodeChanges`);
  - on drag stop, and for keyboard moves (position changes without `dragging`), the rounded positions go to `store.moveNodes`, then `setLayout`.
- **Auto-layout control** (UX-26), one Controls button:
  - with two or more nodes selected it reads "Auto-layout selected nodes": ELK runs on the induced subgraph, translated so the selection keeps its top-left corner;
  - otherwise it reads "Auto-layout all nodes", with `replace: true`.

### 2.3 Carrying keys (ADR 0008, the F-111 note)

The carry runs in `apply`, `applyPatches` and `writeFiles`. It is skipped when the write includes the sidecar, or when the status is `newer`.

1. **Before `commit`:** find the tracked workflows, those with entries whose file is among the changed paths (only a file's own text decides its keys). Project each one, using a new per-revision projection memo.
2. **Commit**, then list the workflows.
3. **Pair workflows:**
   - same path and name;
   - otherwise a `renameDeclaration` hint for that workflow;
   - otherwise exactly one vanished and one new workflow in the same file (this covers `ReplaceFileText` and undo).

   A vanished workflow with no pair loses its entries. One that is present but unmodelled is left alone.
4. **Match nodes** with `matchNodes(before, after, renames)`:
   - entries move to the new ids;
   - unmatched old entries are removed, and remembered in the session memo (open point 6);
   - unmatched new nodes stay unplaced, and the canvas places them.
5. **If the canonical text changed:** `setFile(LAYOUT_PATH)`, and append the sidecar to `files`.
6. **On a carry error:** the document stays unchanged and the command still succeeds (the worst case is re-placement).

**`matchNodes`** is deterministic. Each pass works on the nodes still unmatched, in projection order.

| Pass | Signature | Pairing |
|---|---|---|
| 1 | Strong: kind; name (callee, chain operators, `namespace.factory`, take or emit name, role, code text); assigned variable (from the key); sorted variables of incoming edges | unique on both sides, any order |
| 2 | Strong | longest common subsequence |
| 3 | Name, with rename hints applied to old callees (`callee.path === hint.path && callee.name === hint.from`) | unique on both sides |
| 4 | Name | longest common subsequence |
| 5 | Kind | longest common subsequence |

Process callees are unique within a workflow, so pass 3 settles almost every call node.

**Expected results:**
- a whitespace-only re-parse maps every node to itself;
- `COUNT@1` becomes `TALLY@1`;
- a workflow rename moves the workflow part of every key;
- Connect's new variable turns `FOO@1` into `foo`, and a moved statement keeps every node's position;
- DeleteNode of `FOO@1` moves the old `FOO@2` entry to `FOO@1`;
- undo carries the keys back.

### 2.4 Placement (engine, pure, runs in the canvas chunk)

- **`elkGraph(view, only?)`:**
  - one child per node, with its width and height;
  - ports at fixed positions from `CANVAS_METRICS` (inputs WEST, outputs EAST, in order);
  - one edge per view edge;
  - root options: layered, direction RIGHT, model order kept, about 24 between nodes and 64 between layers (F-205's gaps), take and params in the first layer, emit and output in the last.
  - **Check every option name against the ELK reference (eclipse.dev/elk). Don't write them from memory.**
- **`placeNodes(view, stored, elk)`:**
  - stored positions never move;
  - with nothing stored, it returns ELK's positions;
  - otherwise each unplaced node goes to `anchor + (elk(u) − elk(anchor))`, where the anchor is its first placed neighbour (sources first);
  - a node with no placed neighbour goes below the bounding box of the placed nodes, keeping ELK's x;
  - finally, nodes are pushed down until nothing overlaps (gap 24).
- **`layoutSelection(view, current, ids, elk)`:** moves only `ids`, keeping their top-left corner.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/layout/types.ts` | `LAYOUT_PATH = ".nf-builder/layout.json"`; `LAYOUT_VERSION = 1`; `Point {x; y}`; `Positions = Readonly<Record<string, Point>>`; `LayoutDocument {version: 1; nodes: Positions}`; `LayoutState = "absent"\|"ok"\|"invalid"\|"newer"`; `LayoutStatus {state; message: string\|null}`; `LayoutWrite {path; workflow: string\|null; positions: Positions; replace: boolean}`; `LayoutChange {revision: number; files: readonly FileText[]; layout: LayoutStatus}`. All readonly. |
| `packages/engine/src/layout/sidecar.ts` | `EMPTY_LAYOUT`; `LayoutMigrations = Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>>`; `LAYOUT_MIGRATIONS: LayoutMigrations = {}`; `ParsedLayout = {ok: true; document: LayoutDocument; dropped: number} \| {ok: false; state: "invalid"\|"newer"; message: string}`; `parseLayout(text: string, migrations?: LayoutMigrations): ParsedLayout`; `formatLayout(doc: LayoutDocument): string`; `workflowPositions(doc, path: string, workflow: string\|null, ids?: Iterable<string>): Positions`; `writePositions(doc, write: LayoutWrite): LayoutDocument`; `trackedWorkflows(doc): readonly {path: string; workflow: string\|null}[]` |
| `packages/engine/src/layout/carry.ts` | `RenameHint {path; from; to}`; `matchNodes(before: Projection, after: Projection, renames?: readonly RenameHint[]): ReadonlyMap<string, string>`; `WorkflowPair {before: Projection; after: Projection\|null}`; `pairWorkflows(before: readonly WorkflowRef[], after: readonly WorkflowRef[], changed: ReadonlySet<string>, renames: readonly RenameHint[]): ReadonlyMap<string, WorkflowRef\|null>`; `class RemovedPositions {remember(workflowKey: string, signature: string, p: Point): void; take(workflowKey: string, signature: string): Point\|null}` (bounded to 500); `carryLayout(doc, pairs: readonly WorkflowPair[], renames: readonly RenameHint[], removed?: RemovedPositions): LayoutDocument` |
| `packages/engine/src/layout/place.ts` | `ElkGraphIn`, `ElkNodeIn`, `ElkPortIn`, `ElkEdgeIn`, `ElkGraphOut` (structural JSON with no elkjs import); `ELK_LAYOUT_OPTIONS`; `elkGraph(view: CanvasView, only?: ReadonlySet<string>): ElkGraphIn`; `elkPositions(out: ElkGraphOut): Positions`; `unplaced(view, stored: Positions): readonly string[]`; `placeNodes(view, stored: Positions, elk: Positions): Positions`; `layoutSelection(view, current: Positions, ids: ReadonlySet<string>, elk: Positions): Positions`; `withPositions(view, positions: Positions): CanvasView` |
| `packages/engine/src/layout/index.ts` | re-exports |
| `apps/web/src/layout/elk-client.ts` | `ElkRunner = (graph: ElkGraphIn) => Promise<ElkGraphOut>`; `runElk: ElkRunner` (lazy worker; rejects on a worker error); `disposeElk(): void` |
| `apps/web/src/layout/layout-flow.ts` | `PlaceResult {positions: Positions; added: Positions; notice: string\|null}`; `placeMissing(projection: Projection, stored: Positions, elk: ElkRunner): Promise<PlaceResult>`; `autoLayout(projection, current: Positions, selected: readonly string[], elk: ElkRunner): Promise<{positions: Positions; replace: boolean}>` |
| `e2e/layout.ts` | `LAYOUT_FIXTURE` (`tools/oracle/cases/f111-start-typed`) and the key constants; `openStoredProject(page, dir, extra?)` (F-202 `createProject` and `openProject` through the hook, then wait for canvas ready); `nodePosition(page, id): Promise<Point>` (parses the node's `transform`); `nodeBoxes(page)`; `dragNode(page, id, dx, dy)`; `readSidecar(page)`; `waitSaved(page)` |
| Test files | `packages/engine/test/layout/{sidecar,carry,carry-properties,place}.test.ts`, `packages/engine/test/service/layout.test.ts`, `apps/web/test/{elk-client,layout-flow}.test.ts`, `e2e/layout.spec.ts` |

### 3.2 Change

- **`packages/engine/src/service/types.ts`:**
  - `ProjectionResult.positions: Positions`;
  - `ProjectSummary.layout: LayoutStatus`;
  - `EngineApi.setLayout(write: LayoutWrite): Promise<LayoutChange | EngineRefusal>`.
- **`packages/engine/src/service/service.ts`:**
  - layout state on `Open`, parsed at `open`;
  - the per-revision projection memo;
  - the carry in `accept` and `writeFiles`;
  - the sidecar guard in `apply` and `applyPatches`;
  - `setLayout`;
  - `RemovedPositions` per open project.
- **`packages/engine/src/index.ts`:** export the layout module.
- **`apps/web/src/engine/engine-client.ts`:** `setLayout` in the facade.
- **F-202's worker workspace:** `setLayout` becomes a queued, autosaved change method.
- **F-205's workspace store:**
  - `content` gains `positions`, `placing` and `notice`;
  - new actions `moveNodes(positions)`, `placeNodes(added)`, `autoLayout()` and `apply(command): Promise<ApplyOutcome>`;
  - `apply` refreshes the tab and makes a renamed workflow's tab follow the rename;
  - `WorkspaceHook` gains `apply`.
- **F-205's `workflow-canvas.tsx`:**
  - nodes are draggable with controlled positions;
  - drag-stop and keyboard moves are saved;
  - the Auto-layout `ControlButton`;
  - a `role="status"` notice;
  - `ready` is set after placement.
- **F-205's view and layout:** `layeredLayout` stays, used only as the ELK fallback (open point 7).
- **`apps/web/package.json`:** `"elkjs": "0.12.1"`.
- **`scripts/non-fetched-urls.ts`:** exact entries for each URL that `check:hosts` reports in the ELK asset, with the reason "namespace URI inside elkjs; an identifier, never fetched".
- **`docs/licences.md`:** an elkjs row.
- **The F-205 baselines ELK changes:** re-approved from CI.
- **Not changed:**
  - dependency-cruiser (elkjs is an external package of apps/web, and the engine has no elkjs import);
  - lang-core;
  - `.github/workflows/`;
  - the AGENTS.md commands (no new script);
  - generated files.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`sidecar.test.ts`** | |
| `F-207 IO-02 ADR-0008: formatLayout writes version 1, sorted keys one per line, integer coordinates and a trailing newline; parseLayout reads it back` | exact bytes |
| `F-207 IO-02 ADR-0036: format and parse round-trip any node keys and positions` | fast-check over `formatNodeKey` inputs |
| `F-207 IO-02: invalid JSON, a wrong shape and a missing or zero version are invalid; a higher version is newer; nothing throws` | |
| `F-207 IO-02: entries with unparseable keys or non-finite or out-of-range coordinates are dropped and counted` | |
| `F-207 IO-02: migrations run in order from the file's version and the result is written at the current version` | injected table |
| `F-207 ADR-0008: writePositions merges, or replaces only the given workflow's entries` | |
| **`carry.test.ts`** (real F-111 commands through `stateFor`) | |
| `F-207 AR-11 ADR-0036: a whitespace-only re-parse maps every node to itself` | `perturbWhitespace` |
| `F-207 step 3 ADR-0008: renaming a process carries its unassigned call key (COUNT@1 to TALLY@1); an aliased include's call keeps its key` | |
| `F-207 ADR-0008: renaming a workflow carries every key of that workflow` | |
| `F-207 F-111: Connect's new variable carries FOO@1 to its variable key; a moved statement keeps every node's position` | |
| `F-207 F-111: deleting the first of two calls moves the second's entry to the shifted key and removes the deleted one` | |
| `F-207 F-111: AddCall leaves exactly the new node unplaced` | |
| `F-207 AR-23: undoing a rename, a connect and a delete carries keys back and restores the deleted node's position` | removed-positions memo |
| `F-207: a ReplaceFileText that edits a code statement keeps its position` | |
| `F-207 ADR-0008: a vanished workflow drops its entries; an unmodelled one keeps them; one vanished and one new workflow in the same file pair up` | |
| **`carry-properties.test.ts`** | |
| `F-207 ADR-0008: over random F-111 command sequences, matching is injective and kind-preserving, and a rename maps every node` | harness `buildCommand`, seed 207 |
| **`place.test.ts`** | |
| `F-207 ADR-0008: elkGraph has one node per view node with its size, inputs west and outputs east in port order, and one edge per view edge` | |
| `F-207 ADR-0008: take and params are constrained to the first layer, emit and output to the last` | |
| `F-207 ADR-0008: placeNodes returns ELK positions when nothing is stored and never moves a stored node` | |
| `F-207 ADR-0008: a new node keeps its ELK offset from a placed neighbour; a node with no placed neighbour goes below; nothing overlaps` | |
| `F-207 UX-26: layoutSelection moves only the selected nodes and keeps their top-left corner` | |
| **`service/layout.test.ts`** (real `createEngineService`) | |
| `F-207 step 1 IO-02: open without a sidecar reports absent and no positions; setLayout writes .nf-builder/layout.json and returns its text in files` | |
| `F-207 step 2 IO-02: positions saved with setLayout come back from project() in a new service opened with the written files` | simulated reload |
| `F-207 step 3 ADR-0008: apply(renameDeclaration) returns the rewritten sidecar in files, and project() gives the old position under the new key` | |
| `F-207: setLayout keeps the revision and refuses ids outside the workflow's projection and non-finite coordinates` | |
| `F-207 IO-02: commands and patches touching the sidecar are refused; writeFiles of the sidecar replaces the layout without carrying` | |
| `F-207 IO-02: an invalid sidecar is reported and replaced at the next write; a newer one is reported and never written` | |
| `F-207 ADR-0003: every layout result survives structuredClone` | |
| **Web** | |
| F-202 workspace test: `F-207 IO-01: setLayout's sidecar text is autosaved like a command's files` | |
| `engine-client.test.ts`: `F-207 ADR-0003: setLayout crosses the Comlink bridge` | |
| `elk-client.test.ts`: `F-207 ADR-0008: ELK lays out the f111-start-typed entry workflow deterministically, with no overlaps and every edge left to right` | `elkjs/lib/elk.bundled.js` as the runner in Node |
| `layout-flow.test.ts`: `F-207 ADR-0008: only nodes without positions are laid out, and only they are returned for saving` | fake runner |
| `layout-flow.test.ts`: `F-207: when ELK fails, columns are used, nothing is saved and a notice says so` | |
| `layout-flow.test.ts`: `F-207 UX-26: with two or more selected nodes only the selection is laid out; otherwise all nodes, replacing the workflow's entries` | |
| `workspace-store.test.ts`: `F-207 step 2: a drag updates positions locally and sends one setLayout with rounded coordinates` | |
| `workspace-store.test.ts`: `F-207 step 3: apply refreshes the open tab's projection and positions; renaming the open workflow keeps its tab` | |
| `workspace-store.test.ts`: `F-207: a placement for a superseded revision or tab is dropped` | |
| **E2E `e2e/layout.spec.ts`** (F-202 stored project, fixture `f111-start-typed`) | |
| `F-207 step 1 ADR-0008 IO-02 QA-30: opening a project without a sidecar lays out every node without overlap and writes the sidecar with every node's position @smoke` | DOM positions equal the sidecar's; edges run left to right; after "Saved", IndexedDB holds the file; no CSP violation or console error |
| `F-207 step 2 IO-02 IO-01: a moved node is at the same position after reload` | |
| `F-207 step 3 ADR-0008 AR-11: renaming a process through the app keeps its node's position, and every other node's, across a reload` | `window.nfBuilderWorkspace.apply({kind: "renameDeclaration", path: "modules/local/count/main.nf", name: "COUNT", newName: "TALLY"})`; `TALLY@1` sits at `COUNT@1`'s old position; the sidecar no longer has `COUNT@1` |
| `F-207 ADR-0008: with a partial sidecar, stored nodes keep their positions and only the others are placed, without overlap` | |
| `F-207 UX-26: Auto-layout all nodes puts a moved node back at its ELK position and saves it` | |
| `F-207 IO-02: an unreadable sidecar shows the notice and is replaced` | |
| `F-207 QA-01 ADR-0003: ELK is only in a worker asset, not in the initial JavaScript` | Vite manifest, as in F-205 |

**`@visual`:** no new test. F-205's `rnaseq-nf-typed` canvases, and any per-kind clip whose padding shows edges, change with ELK. Re-approve them from CI (ADR 0021). The per-kind test's zoom-1 assertion must still pass. If it doesn't, raise it rather than changing the assertion.

## 5. Tasks (branch `feat/F-207`; tasks 1 and 2 need only `main`)

1. **Sidecar format:** `types.ts`, `sidecar.ts`, the exports and `sidecar.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/layout/sidecar.test.ts` and `pnpm check` pass.
2. **Key carry:** `carry.ts` (with `RemovedPositions`), `carry.test.ts` and `carry-properties.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/layout` and `pnpm check` pass.
3. **Placement:** `place.ts` and `place.test.ts` (needs F-205's canvas types).
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/layout` and `pnpm check` pass.
4. **Service, bridge and autosave:** the service changes, the client facade, F-202's workspace recording `setLayout`, and their tests.
   - Done when these pass: `pnpm --filter @nf-builder/engine exec vitest run test/service test/layout`, `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-113|F-202"`.
   - Run `pnpm bench` and report the edit p95 next to F-113's 271 ms in the PR (QA-04 is reported, not a gate).
5. **ELK worker:**
   - `pnpm --filter @nf-builder/web add elkjs@0.12.1`;
   - `elk-client.ts` and `elk-client.test.ts`;
   - the non-fetched URLs and the licences row;
   - the QA-01 e2e test.
   - Done when these pass: `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts`, `pnpm audit --audit-level high` and `pnpm test:e2e -- --grep "F-207 QA-01"`.
6. **Canvas wiring:**
   - `layout-flow.ts`, the store, the canvas (drag, keyboard, Auto-layout, notice);
   - `e2e/layout.ts` and the rest of `layout.spec.ts`;
   - the web tests.
   - Done when these pass: `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts`, `pnpm test:e2e -- --grep "F-207|F-205|F-202"`, and `pnpm smoke` (under 60 s).
   - Record ELK's time on `rnaseq-nf-typed` and on sarek's largest workflow for the ADR.
7. **CI and baselines** (orchestrator):
   - push;
   - download `playwright-chromium`, view each changed F-205 `-actual.png`, and commit it (ADR 0021).
   - Done when every job of `CI`, `Deploy check` and `Scope guard` is green (with the `scope-change` label if open point 10 is taken).
8. **Records** (section 7).
   - Done when `pnpm check` passes.

## 6. Open points (each has a recommendation; none is decided here)

1. **elkjs 0.12.1 as a runtime dependency of `@nf-builder/web` only** (decide and record).
   - **Recommendation:** pin it exactly and distribute it under the EPL-2.0 option.
   - Add a licences row: unmodified, source at github.com/kieler/elkjs, notices page in F-704.
   - About 477 kB gzipped, but in a worker asset outside QA-01.
2. **ELK in its own worker rather than the engine worker.**
   - **Recommendation:** its own worker. It takes over `self.onmessage` (1.3), it would block the engine queue, and it loads only when a node needs placing.
3. **`setLayout` rather than `writeFiles` for the sidecar.** This departs from F-202's note.
   - **Recommendation:** `setLayout`. The main thread holds only one workflow's positions and can't safely write the whole file. F-202's workspace records `setLayout` for autosave.
4. **Layout writes don't advance the revision.** This clarifies ADR 0043.
   - **Recommendation:** accept. Node ids are unchanged, so a command in flight isn't refused as stale, and the projector isn't rebuilt on every drag.
   - **Alternative:** advance the revision. The cost is stale refusals and a re-projection after each drag.
5. **The sidecar can't be a command target, and patches never include it.**
   - **Recommendation:** accept. Otherwise undo offsets break after layout writes. Note this for F-208 and F-210: show the sidecar read-only.
6. **A session-only memo of removed positions** (bounded to 500), restored when a node with the same strong signature comes back in the same workflow.
   - **Recommendation:** yes. Undoing a DeleteNode then leaves the sidecar byte-identical, which F-209 step 1 needs.
7. **Keep `layeredLayout` as the fallback when ELK fails.** This amends the interim clause of F-205's ADR.
   - **Recommendation:** accept. It's resilient, and no tests are deleted.
8. **Lay out each workflow lazily, when its canvas first shows,** not every workflow at open.
   - **Recommendation:** accept. Step 1 is met by the default tab.
9. **Step 3 "through the app"** means the store's `apply`, called through `window.nfBuilderWorkspace`, until F-303's name field exists. This mirrors F-202 step 1.
   - **Recommendation:** accept, and note in F-303 that its e2e test repeats step 3 through the popup.
   - **Alternative:** a minimal rename UI now (scope creep).
10. **Step 2 needs F-202's persistence, but F-207's `depends_on` lists only F-205.**
    - **Recommendation:** add F-202 to `depends_on`. That is a `features.json` change, so it needs the `scope-change` label and a record.
11. **Moves and auto-layout aren't undoable in v0.1,** because F-209 covers edit commands.
    - **Recommendation:** accept, and add a note to F-209.
12. **The invalid and newer policies and their wording** (2.1).
    - **Recommendation:** accept as written.
13. **"Selected nodes"** works with React Flow's own selection now. The shift-click and marquee e2e test is F-310's.
    - **Recommendation:** accept, and add a note to F-310.
14. **Layout always uses the sizes with port labels shown,** so the toggle never causes overlaps.
    - **Recommendation:** accept.
15. **The partial-placement rule** (2.4).
    - **Recommendation:** accept. The alternative, ELK's interactive layering, doesn't keep exact positions.

**Decide-and-record items (AGENTS.md):**
- **New runtime dependency:** elkjs (1).
- **Stored format:** the sidecar v1 (2.1).
- **Package boundaries:** none.
- **Workflows:** none.
- **`features.json` beyond `passes` and `notes`:** only if 10 is taken.
- **ADR interplay:**
  - clarifies ADR 0043 (4);
  - amends the interim clause of F-205's ADR (7);
  - corrects ADR 0039's attribution (1.1).
- **Open questions:** none.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing; 0042 and 0043 are taken, and F-202 and F-205 land first): "Store canvas positions in `.nf-builder/layout.json` v1, carry keys by diffing projections, and run ELK in its own worker". It covers:
  - the 2.1 format, versioning, migrations, and the invalid and newer policies;
  - the service as sole writer, `setLayout`, and that the sidecar is excluded from commands and patches;
  - the carry algorithm;
  - placement;
  - elkjs (licence, worker, measurements);
  - open points 2 to 9 and 11 to 15;
  - that undo and history are F-209's and autosave F-202's.

  Add it to `docs/adr/README.md`.
- **Spec:**
  - `data-and-io.md` IO-02 gains "(ADR NNNN)";
  - `architecture.md` Data flow gains one line: the engine worker owns the sidecar, and ELK runs in its own worker.
- **`features.json` notes:**
  - **F-207:** "Verified …";
  - **F-209:** the sidecar is carried, not patched; the removed-positions memo;
  - **F-301:** set the drop position with `setLayout` for the new, unplaced key;
  - **F-303:** repeat step 3 through the popup;
  - **F-310:** the e2e test for selected-node auto-layout;
  - **F-404:** filter `LAYOUT_PATH` for the checkbox;
  - **F-208 and F-210:** the sidecar is read-only;
  - **F-702:** the carry's QA-04 cost and the projection memo.
- **`progress.md` Decisions:** the ADR, elkjs, the revision rule, the dependency change (if taken), and the baseline re-approval.

## 8. Evidence

- **elkjs, read as text** in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/elk/package/`:
  - `package.json` (licence, no dependencies);
  - `lib/elk-worker.js:81842-81863` (FakeWorker and the `self.onmessage` takeover);
  - a grep for `eval(` and `new Function` (none);
  - a grep for URLs in `lib/elk-worker.min.js`;
  - `lib/elk-api.js:36-55` (`workerUrl` and `workerFactory`).
- **`npm view elkjs`:** 0.12.1, modified 2026-10-28, EPL-2.0 OR GPL-3.0-or-later.
- **Repository:**
  - ADRs 0003, 0008, 0036, 0039 and 0043 (branch);
  - `docs/spec/{data-and-io,ux,architecture}.md`;
  - `packages/engine/src/{projection/keys.ts,projection/project.ts,model/project.ts,edit/apply.ts,edit/commands/rename.ts}`;
  - F-113 `service/{types,service}.ts` and `apps/web/src/engine/*`;
  - `scripts/{non-fetched-urls,check-hosts}.ts`;
  - `tools/oracle/cases/f111-start-typed`.
