# Plan: F-302, connect and disconnect ports with type checking; invalid targets dim while dragging; mismatches produce diagnostics

Written by the planner on 2026-11-28 from `main` at `d0cea22` (F-605 merged), with F-301 in review on `feat/F-301` (`/home/user/wt-F-301`: `refit`, `viewport.ts`, `addFromPalette`, `onPaletteDrop`), designed against that branch. I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**In scope:**
- **Connect by drag** (UX-25): drag from an output handle to an input handle of the same canvas; the drop applies F-111's `Connect` through `canvasStore.apply`, one undo step. Connecting to a fed input rewrites its argument.
- **Dim invalid targets while dragging** (UX-25): the worker answers, for the dragged output, every input port's status: `ok`, `mismatch` (LA-29: allowed, but an error once connected) or `refused` (Connect would refuse). Refused targets dim and won't accept the drop; mismatched ones dim with a different cue and still accept it (open point 1).
- **Mismatch red** (UX-24, LA-32): an edge into a port whose argument carries a `type-mismatch` (or `tuple-arity`) diagnostic at the canvas's revision is drawn red, above the selection highlight, with the message in its hover tooltip.
- **Disconnect** (step 3): select an edge (click, or focus it with Tab) and press Delete or Backspace: F-111's `Disconnect` (removes a trailing argument, writes `null` for an earlier one, ADR 0039).
- **LA-14 tuple arity** (F-005, F-112 notes; ADR 0042 "goes to F-302 and F-504"): a new pack rule `tuple-arity` for a typed script's call to a legacy process whose `tuple` input gets a `tuple(...)` with the wrong number of components, or a channel of `Tuple<…>` of known, different arity (open point 6).
- **Read-only** (ADR 0056, F-703 note): `nodesConnectable` stays false, no edge selection or Delete.

**Out of scope:**
- Keyboard port connection (QA-11 names it; F-701 owns "keyboard port connection").
- Dropping onto an edge (F-308), deleting nodes (F-310), reconnecting an edge end by dragging it (`edgesReconnectable` stays off).
- Ports of nodes added from the palette: F-301's scaffolds have no inputs or outputs; F-303 adds them. The steps run on a fixture.
- Registry modules (F-504 reuses `tuple-arity` and the dry run).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-25:** "Connecting: drag from an output port to an input port. Invalid targets dim while dragging. Connecting creates or rewrites the call's argument (ADR 0004)."
- **LA-29:** "Connecting two ports with incompatible known types is allowed but produces an error diagnostic. Unknown types never block a connection."
- **LA-32:** "Type mismatch on an edge or call argument", error.
- **UX-24** (via notes): "A type mismatch is drawn red, with the diagnostic on hover." **QA-12:** colour is never the only signal (so red needs a second cue; open point 4).
- **LA-14:** "`nextflow lint` doesn't check a legacy input's shape, so the connection check compares the tuple's arity with the legacy declaration." Oracle case `s1-typed-legacy-tuple-arity` (lint ok, run fails "Input tuple does not match tuple declaration").
- **ADR 0039:** Connect moves a later source above its target when safe, else refuses; Disconnect removes a trailing positional argument and writes `null` for an earlier one.
- **ADR 0042:** `PackLints.connection(source, node, port, isRecord)` is LA-29's check; `type-mismatch` is lint-origin, typed scripts only; the v0.1 code set has 30 codes; tuple arity is deferred to F-302 and F-504.
- **ADR 0046 / F-205, F-206 notes:** mismatch red goes over the `edge-<dataflow>` class and after the `.is-highlighted` rule in `canvas.css` (the CSS comment there already reserves the spot).
- **ADR 0052:** "a new projection … re-fit[s]"; F-301 keeps the viewport for palette adds. A connect would re-fit on every drop (open point 3). Carry (`layout/carry.ts`) moves positions when Connect introduces a variable (`TOUCH()` becomes `touch = TOUCH()`, a new key).
- **ADR 0056:** keep `nodesConnectable` and edge drops off in read-only; `canvasStore.apply` already refuses `read-only`.
- **No spec text** says what "invalid" covers (refused only, or also mismatched), how an edge is selected for deletion, or what the canvas shows when a drop is refused.

### 1.2 Code on main
- **Commands:** `connect` and `disconnect` (`packages/engine/src/edit/commands/connect.ts`) are done and property-tested (F-111). `connect` mixes cheap checks (self, statement order, cycles, reassignment, target kind) with the reprint; there is no dry run. Labels are plain "Connect" and "Disconnect" (`history/labels.ts`).
- **Types:** `connection` and `typeMismatch` (`packages/lang-2610/src/lints/types.ts`). A process input compares elements, with records structural (`Sample` against `Path` is incompatible; against another record, unknown). Mismatch ranges: `port.argument` for calls, the `emit`/`publish` item (containing the argument) for emits and outputs. **No lint fixture covers a record type**, so nobody has checked against the pinned lint that `Path` into a `Sample` input is reported.
- **Legacy tuple ports** (`projection/signature.ts`): type `Tuple` with no arguments, label `tuple(meta, reads)`; the component count isn't on the `Port`. `projection/inline.ts` infers nothing for `tuple(...)`.
- **Canvas:** `nodesConnectable={false}`, `deleteKeyCode={null}`, edges `selectable: false` (asserted in `apps/web/test/flow-elements.test.ts`); the edge description "A channel between two nodes; hover to see its type." is asserted in `e2e/details.spec.ts`. Handles have ids `in:<port>` / `out:<port>`. Edge tooltip from `CanvasEdgeView.tooltip`. React Flow 13.0.2 exposes `onConnectStart`, `onConnectEnd`, `onConnect`, `isValidConnection`, `onBeforeDelete`, `edgesFocusable` and `useConnection` (checked in `node_modules`).
- **Diagnostics in the page:** `problemsStore` pulls `diagnostics()` once per revision, always (status bar counts), keyed by `revision`. `CanvasContent.revision` is the projection's.
- **Engine API:** no call answers per-port connectability; pack lints load only in the worker (QA-01), so the check must run there (AR-30).
- **e2e:** `openStoredFixture` is hard-wired to `f111-start-typed`; `portRef`, `applyThroughStore`, `storedFiles`, `historyStatus` (`e2e/history.ts`), `engineDiagnostics` (`e2e/problems.ts`), `canvasReady`, `layoutSettled`, `node` (`e2e/canvas.ts`).
- **Fixtures:** `samplesheet-multiqc` (template, oracle-clean) has `record Sample` and `params { input: Channel<Sample> }` but FASTQC destructures the record, so no input is typed `Sample`. A new fixture is needed.

### 1.3 Nextflow syntax (not run locally)
No Nextflow release is cached here, so I ran no oracle. Record declarations, `include { Sample } from './types.nf'`, `params { input: Channel<Sample> }` and process inputs typed by a record are all in committed oracle-clean files (`samplesheet-multiqc`, `f605-library/lib/samples.nf`, `packages/engine/test/edit/rename.test.ts` inputs). Whether lint reports `Path` into `Sample` with the message `typeMismatch` produces is **unverified**: task 1 records it.

## 2. Design

### 2.1 Fixture `f302-connect` (oracle cases)
Modelled on `samplesheet-multiqc` (its config and samplesheet approach for `params.input`):
- `types.nf`: `record Sample { id: String; reads: Path }` (field set chosen by the builder, oracle-checked).
- `modules/local/describe/main.nf`: typed `DESCRIBE`, input `sample: Sample`, one output.
- `modules/local/touch/main.nf`: typed `TOUCH`, no inputs, one `Path` output (`file('touched.txt')`).
- `main.nf`: `params { input: Channel<Sample> }`; entry workflow calls `TOUCH()` and `DESCRIBE()`.

Cases (`tools/oracle/cases/cases.yaml`, `spec: [F-302, UX-25, LA-29, LA-32]`):
- `f302-connect-start`: as above; `lint: {expect: error}` recording the one `call-arity` error at `DESCRIBE()`.
- `f302-connect-typed`: start plus step 1 (`DESCRIBE(params.input)`); `lint: {expect: ok, clean: true}`, `run: {expect: ok}`. Written by the engine golden test.
- `f302-connect-mismatch`: start plus step 2 (TOUCH's output into DESCRIBE); `lint: {expect: error}` recording the type error. Written by the golden test.
- Step 3's golden: Disconnect on `f302-connect-typed` gives `f302-connect-start` byte for byte (the start tree is written in printed form).

### 2.2 Dry run of targets (engine)
- **Split `connect`:** `planConnect(state, command): ConnectPlan` does every check and decision that doesn't print (locate, ports, self, cycles, statement order, reassignment, target kind, emit/output item, positional slot) and throws the same `EditRefusal`s with the same messages; `connect` = `planConnect` + rewrite + reprint. No behaviour change (the harness and corpus prove it).
- **`connectionTargets(state, lints, target, from): ConnectionTarget[]`**, for every input port of every other node of the workflow:
  - `planConnect` throws: `refused` with its message;
  - else `lints.connection(from port type, node, port, isRecord)` is `incompatible`, or the tuple arity differs (2.4): `mismatch` with a message in the diagnostic's wording;
  - else `ok`. Unknown types are `ok` (LA-29).
  - Refusals that only the full apply finds (a new parse problem, LA-13 mixing) aren't predicted; the drop then reports the refusal (open point 2).
- **`EngineApi.connectionTargets(request)`** in the service, at the current revision, through `guarded`; amends ADR 0043's API list.

### 2.3 Mismatch edges (engine, pure)
`edgeMismatches(projection, diagnostics): ReadonlyMap<string, string>`, edge id to message: for each edge, the target port's `argument`; a diagnostic with code `type-mismatch` or `tuple-arity` in `projection.workflow.path` whose range equals that argument (calls) or contains it (emit and output items). Every edge into that port is marked (an indirect edge's argument is the whole inline expression).

### 2.4 `tuple-arity` (pack, LA-14)
- `Port` gains `readonly components?: number` (lang-core projection, plain data, not stored): the declared component count of a legacy `tuple` input, set in `legacyProcessSignature`.
- Rule `tupleArity` (`packages/lang-2610/src/lints/tuples.ts`), typed scripts only, calls to a modelled legacy process: the argument at `port.argument` is a `tuple(...)` call with a different positional count, or its single direct source's element is `Tuple<…>` with a known, different argument count. Message: "Tuple with N components is passed to the `tuple` input `<label>` of `<PROCESS>`, which declares M -- pass one argument per declared component" (open point 7). Code `tuple-arity`: severity error, origin `ours`, spec `[LA-14, LA-32]`, `lintPattern: null`.
- Exported as `tupleArityOf(source: FlowType | null, port: Port): {expected: number; actual: number} | null` for the dry run.

### 2.5 Canvas (web)
- **Store** (`canvas-store.ts`): `connect(from: PortRef, to: PortRef, session?)` builds `Connect` for the active workflow tab and applies it; `disconnect(port: PortRef, session?)` likewise; `connectionTargets(from, session?)` calls the worker and drops a result for an older session or revision. A refusal sets `canvasNotice` (shown in the existing `.canvas-notices` status region, cleared by the next change): "Couldn't connect: <engine message>" / "Couldn't disconnect: <message>". A view that follows a connect or disconnect keeps the viewport (F-301's `refit: false`; open point 3).
- **Dragging** (`workflow-canvas.tsx`): `nodesConnectable={!readOnly}`; `connectionMode` strict; input handles `isConnectableStart={false}`, output handles `isConnectableEnd={false}`. `onConnectStart` asks for targets; while they are pending every target looks normal. `isValidConnection` accepts an `out:` to `in:` pair on different nodes unless the target is `refused`. `onConnectEnd` clears the state.
- **Dimming:** a `ConnectTargetsContext` (node id to port id to status) read by `Handles` and `PortRows` in `canvas-nodes.tsx`: classes `is-target-refused` (opacity, `not-allowed`) and `is-target-mismatch` (opacity plus a dashed red ring), and `is-dimmed` on a card with no `ok` or `mismatch` input. Each class sets `title` to the status message. Statuses come from the engine; the components only map them to classes (AR-31).
- **Edge selection and Delete** (open point 5): canvas-local `selectedEdge`; clicking an edge selects it (and clears node selection); `Enter` on a focused edge selects it; Delete or Backspace on the selected or focused edge calls `disconnect(edge.to)`; Escape or a pane click clears. React Flow's own `selectable` stays false and `deleteKeyCode` stays null (no local removal: the projection is the truth). The selected edge gets `is-selected` (accent, 3 px, like the highlight). Each edge's `ariaLabel` becomes "<tooltip>. Press Delete to disconnect." outside read-only; the shared edge description is unchanged.
- **Mismatch red:** `CanvasHost` reads `problemsStore` and passes `mismatches = edgeMismatches(projection, diagnostics)` only when `problems.revision === content.revision`, else none. `toFlowEdges(view, selected, mismatches)` sets `data.mismatch`; `FlowEdge` adds `is-mismatch` and draws a small error glyph at the midpoint with `EdgeLabelRenderer` (QA-12's second cue; `pointer-events: none`). The tooltip reads "<type> · <source>\n<diagnostic message>". CSS rule after `.is-highlighted`: `stroke: var(--color-error)` (defined in `styles.css`), `stroke-width: 3`.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/edit/connection-targets.ts` | `ConnectionStatus = "ok" \| "mismatch" \| "refused"`; `ConnectionTarget {node: string; port: string; status: ConnectionStatus; message: string \| null}`; `connectionTargets(state: EditState, lints: PackLints, target: WorkflowTarget, from: PortRef): ConnectionTarget[]` |
| `packages/engine/src/canvas/mismatch.ts` | `MISMATCH_CODES: readonly string[]`; `edgeMismatches(projection: Projection, diagnostics: readonly Diagnostic[]): ReadonlyMap<string, string>` |
| `packages/lang-2610/src/lints/tuples.ts` | `tupleArityOf(source: FlowType \| null, port: Port): {expected: number; actual: number} \| null`; `tupleArity: LintRule` |
| `packages/lang-2610/test/lints/fixtures/tuple-arity/{positive,negative}/**` | positive from `s1-typed-legacy-tuple-arity`, negative from `s1-typed-calls-legacy-module` |
| `packages/lang-2610/test/lints/fixtures/type-mismatch/{positive,negative}/record.nf` | `Path` into a `Sample` input; `Channel<Sample>` into it |
| `tools/oracle/cases/f302-connect-start/**`, `f302-connect-typed/**`, `f302-connect-mismatch/**` | 2.1 |
| `apps/web/src/canvas/connect-targets.ts` | `ConnectTargetsContext`; `TargetStatusMap = ReadonlyMap<string, ReadonlyMap<string, ConnectionStatus>>`; `targetStatusMap(targets: readonly ConnectionTarget[]): TargetStatusMap`; `portRefOfHandle(node: string, handle: string): PortRef \| null` |
| `apps/web/src/canvas/edge-keys.ts` | `edgeKeyAction(key: string, readOnly: boolean): "disconnect" \| "select" \| "clear" \| null` |
| `packages/engine/test/edit/connection-targets.test.ts`, `packages/engine/test/canvas/mismatch.test.ts`, `packages/lang-2610/test/lints/tuples.test.ts`, `apps/web/test/connect-targets.test.ts`, `apps/web/test/edge-keys.test.ts` | section 4 |
| `e2e/connect.ts` | `F302_START`, `F302_TYPED` (fixture dirs); `handle(page, node, handleId): Locator`; `dragConnection(page, from: {node; handle}, to: {node; handle}, during?: () => Promise<void>)` (mouse down, move in steps, optional check, up); `edgeInto(page, node, port): Locator` |
| `e2e/connect.spec.ts` | section 4 |

### 3.2 Change
- **`packages/lang-core/src/projection.ts`:** `Port.components?: number`.
- **`packages/engine/src/projection/signature.ts`:** set `components` on legacy `tuple` inputs (projection snapshots gain nothing visible; check `pnpm test:corpus`).
- **`packages/engine/src/edit/commands/connect.ts`:** `ConnectPlan` and `planConnect(state: EditState, command: Connect): ConnectPlan`; `connect` uses it.
- **`packages/engine/src/service/{types,service}.ts`:** `ConnectionTargetsRequest {path: string; workflow: string | null; from: PortRef}`; `ConnectionTargetsResult {revision: number; from: PortRef; targets: readonly ConnectionTarget[]}`; `EngineApi.connectionTargets(request): Promise<ConnectionTargetsResult | EngineRefusal>`.
- **`packages/engine/src/index.ts`:** export the new types and functions.
- **`packages/lang-2610/src/lints/{codes,index}.ts`:** code `tuple-arity`; rule registered. **`packages/lang-2610/test/lints/fixtures.json`:** the new fixtures' recorded lint lists.
- **`apps/web/src/engine/engine-client.ts`, `apps/web/src/workspace/{types,workspace}.ts`, `e2e/engine.ts`:** pass `connectionTargets` through.
- **`apps/web/src/canvas/canvas-store.ts`:** `connect`, `disconnect`, `connectionTargets`, `canvasNotice: string | null` in `WorkspaceState`; `refit: false` for the view after a connect or disconnect.
- **`apps/web/src/canvas/workflow-canvas.tsx`:** 2.5 (connect handlers, context provider, edge selection and keys, `mismatches` prop).
- **`apps/web/src/canvas/canvas-nodes.tsx`:** handle start/end flags and target classes.
- **`apps/web/src/canvas/flow-elements.ts`, `flow-edge.tsx`:** `mismatch`, `selected` edge data; classes; midpoint glyph; aria label.
- **`apps/web/src/canvas/canvas-host.tsx`:** mismatches from `problemsStore`; `canvasNotice` into `notices`.
- **`apps/web/src/canvas/canvas.css`:** target classes, `is-selected`, `is-mismatch` (after `.is-highlighted`), glyph.
- **`e2e/history.ts`:** `openStoredFixture(page, name, dir = HISTORY_FIXTURE)`.
- **Unchanged:** workflows, CSP and host allow-list, IndexedDB and sidecar formats, dependency-cruiser rules, AGENTS.md command table (no new script), runtime dependencies.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/engine/test/edit/connect.test.ts`** (extend) | |
| `F-302 UX-25 AR-21: planConnect refuses exactly what connect refuses, with the same message` | over the F-111 start trees, every (output, input) pair |
| **`packages/engine/test/edit/properties.test.ts`** (extend) | |
| `F-302 UX-25: a target the dry run marks refused is refused by apply; one apply accepts is never marked refused` | fast-check over fixture trees |
| **`packages/engine/test/edit/connection-targets.test.ts`** | |
| `F-302 step 1 LA-29: Channel<Sample> into a Sample input is ok` | on `f302-connect-start` |
| `F-302 step 2 LA-29 LA-32: a Path output into a Sample input is a mismatch, not refused, with the type message` | |
| `F-302 UX-25: the source's own inputs, a code node's inputs and a cycle are refused with Connect's messages` | |
| `F-302 LA-29: an unknown source type, a legacy callee and an untyped script are never mismatches` | |
| `F-302 LA-14: a Channel<Tuple<A>> output into a two-component legacy tuple input is a mismatch` | |
| **`packages/engine/test/service/service.test.ts`** (extend) | |
| `F-302: connectionTargets refuses with no project or an unknown workflow or port, answers at the current revision, and survives structuredClone` | |
| **`packages/engine/test/edit/oracle-goldens.test.ts`** (extend) | |
| `F-302 step 1 UX-25: Connect params.input to DESCRIBE.sample on f302-connect-start equals f302-connect-typed, with no diagnostics` | |
| `F-302 step 2 LA-32: Connect TOUCH's output to DESCRIBE.sample equals f302-connect-mismatch, with one type-mismatch error at the argument` | |
| `F-302 step 3: Disconnect DESCRIBE.sample on f302-connect-typed equals f302-connect-start byte for byte, parses, and has the call-arity error only` | |
| **`packages/engine/test/canvas/mismatch.test.ts`** | |
| `F-302 UX-24 LA-32: a type-mismatch at a call argument marks every edge into that port; other codes, other files and other ports mark nothing` | |
| `F-302 UX-24: emit and output mismatches mark the edge whose argument the item contains` | |
| `F-302 LA-14: a tuple-arity diagnostic marks its edge` | |
| **`packages/lang-2610/test/lints/tuples.test.ts`** | |
| `F-302 LA-14: a one-component tuple(...) to a two-component legacy input is an error at the argument; the right count, a legacy caller and a typed callee are not` | |
| `F-302 LA-14: tupleArityOf compares a known Tuple<…> source and returns null when either count is unknown` | |
| **`packages/lang-2610/test/lints/types.test.ts`** (extend) | `F-302 LA-32: Path into a Sample process input is incompatible; Channel<Sample> into it is compatible` (through `connection` with the real `isRecord`) |
| **`packages/engine/test/diagnostics/fixtures.test.ts`** (existing) | the new `type-mismatch` record and `tuple-arity` fixtures pass, `type-mismatch` matching recorded lint |
| **`packages/engine/test/projection/legacy/signature.test.ts`** (extend) | `F-302 LA-14 LA-21: a legacy tuple input carries its component count` |
| **`apps/web/test/canvas-store.test.ts`** (extend, fake engine) | |
| `F-302 UX-25: connect applies Connect for the active workflow tab with the session; disconnect applies Disconnect` | |
| `F-302 UX-25: a refused connect sets canvasNotice with the engine message; the next change clears it` | |
| `F-302: connectionTargets drops a result for an older session or revision` | |
| `F-302 ADR-0052: the view after a connect or disconnect has refit false` | |
| `F-302 ADR-0056: connect and disconnect are refused read-only without calling the engine` | |
| **`apps/web/test/connect-targets.test.ts`** | `F-302 UX-25: handle ids map to port refs; targets map by node and port` |
| **`apps/web/test/flow-elements.test.ts`** (extend) | `F-302 UX-24: a mismatched edge carries its message and class, which wins over the highlight; edges stay not selectable for React Flow` |
| **`apps/web/test/edge-keys.test.ts`** | `F-302 UX-70: Delete and Backspace disconnect, Enter selects, Escape clears; nothing read-only` |
| **`apps/web/test/canvas-nodes.test.tsx`** (new or extend) | `F-302 UX-25: inputs aren't connection starts and outputs aren't ends; target statuses give the dim classes and titles` |
| **`e2e/connect.spec.ts`** (Chromium) | |
| `F-302 step 1 UX-25 LA-29: dragging params input onto DESCRIBE sample updates main.nf with no diagnostics` | stored `f302-connect-start`; drag; `main.nf` equals `f302-connect-typed`'s; `engineDiagnostics` empty; status bar shows no problems; edge present, not `is-mismatch` |
| `F-302 UX-25: while dragging from DESCRIBE's output, its own input dims as refused and the drop there changes nothing` | class mid-drag; revision unchanged after release |
| `F-302 step 2 UX-24 LA-32: dragging TOUCH's output onto DESCRIBE sample turns the edge red with the diagnostic on hover` | mid-drag the target has `is-target-mismatch`; after drop the edge has `is-mismatch`, stroke is the error colour, glyph visible; hover tooltip contains the lint message; Problems lists one `type-mismatch` error; files equal `f302-connect-mismatch` |
| `F-302 UX-24: mismatch red wins over the selection highlight` | select DESCRIBE; edge still red |
| `F-302 step 3 UX-70: clicking an edge and pressing Delete removes the argument; the code still parses` | from `f302-connect-typed`; `main.nf` equals `f302-connect-start`'s; main.nf parse status `modelled`; one undo restores it byte for byte |
| `F-302 UX-70 QA-11: Tab to an edge and press Delete disconnects it` | |
| `F-302 ADR-0052: connecting keeps the viewport` | transform unchanged |
| `F-302 ADR-0056 F-703: read-only, handles don't start a connection and Delete on an edge changes nothing` | at 900 px |
| `F-302 QA-30: connecting and disconnecting log no CSP violation and no console error` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-302`, after F-301 merges (merge `main` first: `refit`, `canvas-store.ts` and `workflow-canvas.tsx` both change). Run `pnpm check` before every commit. Settle section 6 first.

1. **Lint fixtures and oracle cases.** `type-mismatch` record fixtures, `f302-connect-start` and hand-written drafts of the two result cases; record lint lists in `fixtures.json` and `cases.yaml`.
   - Done when `pnpm oracle` (Java 17+, or a draft PR's CI `oracle` job) passes and confirms lint reports `Path` into `Sample` with `typeMismatch`'s wording; if it doesn't, stop and report (open point 8).
2. **`planConnect` and the dry run.** Split `connect`; `connection-targets.ts`; property and unit tests.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass and `pnpm test:corpus` shows no change in the edit corpus.
3. **LA-14 `tuple-arity`.** `Port.components`, signature, the rule and code, `tupleArityOf` in the dry run, fixtures.
   - Done when `pnpm --filter @nf-builder/lang-2610 test`, `pnpm --filter @nf-builder/engine test`, `pnpm test:corpus` (after `pnpm corpus:fetch && pnpm corpus:lint`; no new `tuple-arity` on the corpus unless genuine, listed in the PR), `pnpm oracle` and `pnpm check` pass.
4. **Engine API.** `connectionTargets` in service, client, workspace and `e2e/engine.ts`; service tests; goldens writing `f302-connect-typed` and `f302-connect-mismatch`.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm oracle` and `pnpm check` pass.
5. **`edgeMismatches` and the store.** `mismatch.ts`; canvas-store actions, `canvasNotice`, `refit`; tests.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
6. **Canvas UI.** Connect handlers, context and dim classes, edge selection and keys, mismatch class and glyph, CSS, host wiring; unit tests.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-205|F-206|F-207|F-301|F-309|F-703"` pass with no baseline change (if one moves, stop and report).
7. **End-to-end.** `e2e/connect.ts`, `connect.spec.ts`, `openStoredFixture` parameter.
   - Done when `pnpm test:e2e -- --grep F-302`, `pnpm smoke` (under 60 s) and `pnpm build && pnpm check:budget && pnpm check:hosts` pass.
8. **Records** (section 7). Done when `pnpm check` passes.

## 6. Open points (none decided here)

1. **What "invalid target" covers.** LA-29 allows a mismatched connection, but the F-112 note dims through `lints.connection`.
   - **Recommend:** two states: refused targets dim and reject the drop; mismatched targets dim with a dashed red ring and accept it (then the edge is red). **Alternative:** dim only refused targets and show mismatch only after the drop.
2. **Dry run depth.** Running the full apply (reprint, reparse, AR-24, LA-13) per port is too slow for large workflows (QA-04).
   - **Recommend:** `planConnect` only, so the dry run never marks too much; the rare parse or mixing refusal shows at the drop. Amends ADR 0043's API list with `connectionTargets`.
3. **Viewport after a connect or disconnect.** ADR 0052 re-fits on a new projection. **Recommend:** keep the viewport, as F-301 does for palette adds (amends ADR 0052 again).
4. **QA-12 cue for mismatch.** Red plus 3 px matches the highlight's width. **Recommend:** a small error glyph at the edge midpoint, plus the tooltip and aria label. **Alternative:** a distinct dash pattern, but dashes already mean value channels.
5. **Edge selection and deletion.** Edges are `selectable: false` and the F-206 tests assert it and the edge description.
   - **Recommend:** canvas-local edge selection, independent of React Flow's, so both F-206 assertions stand; Delete or Backspace on the selected or focused edge; the per-edge aria label names Delete. Node and edge selection are exclusive; the details pane shows the workflow summary while an edge is selected.
   - **Alternative:** React Flow edge selection with `onBeforeDelete`, which changes the F-206 test (not allowed without an ADR).
6. **LA-14 in F-302.** Not in F-302's spec list, but F-005, F-112 and ADR 0042 assign it here. **Recommend:** include (task 3), as a pack rule `tuple-arity` (origin `ours`, error), raising ADR 0042's code count to 31; F-504 reuses it. **Alternative:** leave it to F-504 and drop task 3.
7. **`Port.components`** extends lang-core's projection type (plain data, not stored). **Recommend:** accept; record in the ADR. The `tuple-arity` wording is ours (lint has none); confirm the message.
8. **Lint parity for records.** If the pinned lint doesn't report `Path` into a `Sample` input, `type-mismatch` (lint origin) would disagree with lint. **Recommend:** decide after task 1: either the code stays lint-origin with a narrower `assignable`, or record mismatches become an `ours` code; record it in `upstream-bugs.md` if lint misses it.
9. **Refused-drop feedback.** **Recommend:** the canvas notices region, "Couldn't connect: <engine message>", cleared by the next change. **Alternative:** the history live region.
10. **Connect labels.** Undo shows "Connect" and "Disconnect". **Recommend:** keep (no label change); a richer label ("Connect params.input to DESCRIBE") can come with F-701.
11. **Visual baseline.** **Recommend:** add one `@visual` baseline of a red edge with its glyph (`connect-mismatch`), approved from CI (ADR 0021); no existing baseline should move.
12. **Drag direction.** **Recommend:** start only from outputs (UX-25); dragging from an input does nothing.

**AGENTS.md decide-and-record items:**
- **ADR changes:** points 2 (ADR 0043 API), 3 (ADR 0052 viewport), 6 and 8 (ADR 0042 code set), 7 (lang-core `Port`), and the spec readings in 1, 4, 5 and 9.
- **Open questions file:** none depended on.
- **None:** runtime dependencies, package boundaries, dependency-cruiser rules, stored or exported formats, workflows.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number: "Connect by drag with a worker dry run of targets; mismatch edges red from diagnostics; disconnect with Delete; LA-14 tuple arity as a pack rule". Amends ADR 0042 (code `tuple-arity`), ADR 0043 (`connectionTargets`), ADR 0052 (viewport after a connect). Row in `docs/adr/README.md`.
- **Spec:** UX-25: "Refused targets dim and can't be dropped on; mismatched targets dim with a red ring and can (LA-29)." UX-24: "… drawn red with an error mark, with the diagnostic on hover. Select an edge and press Delete to disconnect it." LA-14 unchanged (now implemented).
- **`features.json`:**
  - **F-302:** `passes`, and a note: "Verified …: step 1 by `e2e/connect.spec.ts` and oracle case `f302-connect-typed`; step 2 by the mismatch e2e test, `edgeMismatches` and `f302-connect-mismatch`; step 3 by the Delete e2e tests and the Disconnect golden. LA-14 by `tuple-arity`. Decisions in ADR …".
  - **F-504:** use `connectionTargets` for inserted modules and `tuple-arity` for legacy tuple inputs.
  - **F-701:** keyboard port connection (QA-11); a richer Connect label; audit edge selection, the edge aria label and the dim states.
  - **F-308:** an edge drop must not collide with edge selection.
  - **F-310:** node Delete shares the canvas key handler; keep edge and node deletes apart.
- **`progress.md` Decisions:** the ADR, the dry run, mismatch red and its glyph, edge selection, `tuple-arity`, the viewport rule, the record-parity outcome of task 1.
