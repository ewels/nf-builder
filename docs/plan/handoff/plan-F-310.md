# Plan: F-310, multi-select, delete, copy and paste of nodes within and across projects

Written by the planner on 2026-11-28 from `origin/main` at `240369b`, designed against `feat/F-302` at `041d3a4` (PR #62, ADR 0064). I changed nothing except this file. Paths are relative to the repository root. Build on `feat/F-310` branched from `main` after F-302 merges.

## 0. Scope

**Steps:** (1) "Copy two connected processes to another project: both module files and the connection come across"; (2) "Delete a multi-selection: one undo step restores all".

**In scope (UX-26 and the feature's notes):**
- Shift-click and marquee multi-select on the canvas (F-206 note), node and edge selection exclusive (F-302 note).
- Delete of one or several nodes as one command and one undo step (F-209 note, AR-23), cleaning up assignments nothing reads any more, on node delete and on Disconnect (F-302 note, ADR 0064 consequence).
- Copy and paste of call nodes (processes and workflows) with their definitions and the connections between them, within a workflow, across workflows and across projects; one undo step; a half-applied paste rolled back with `discard` (F-301 note, ADR 0060).
- Offer to re-include an already-called process under an alias on paste (F-111 note).
- Details pane for several nodes (F-206 note); "Auto-layout selected nodes" reachable, with its e2e test (F-207 note).
- Read-only: delete and paste refused, keys inert, controls not rendered (F-703 note, ADR 0056).

**Out of scope (each needs a decision, section 6):** copying operator, factory, chain, params, take/emit and code nodes (open point 3); cut (not in UX-26); keyboard multi-select and port connection (F-701); a system-clipboard format (open point 1); node moves as undo steps (ADR 0051).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-26** lists "marquee and shift-click multi-select, delete, copy and paste (within and across projects), undo and redo, auto-layout (ELK) for all or selected nodes". Nothing else in the spec says what a copy carries, where a paste lands, what happens to inputs fed from outside the selection, or name and path conflicts. Decided here or listed in section 6.
- **AR-23:** one user action applying several commands is one step (F-310 named). **AR-30:** project content lives only in the engine and IndexedDB, never in Zustand stores; so copied file text can't sit in a page store (shapes the clipboard choice). **AR-21** already lists `AddInclude` and `DeleteNode`.
- **ADR 0039:** DeleteNode removes the statement and clears the direct arguments it fed; AddCall refuses a process the workflow already calls and its message already suggests `include { X as X_2 }`; new variables are the callee lower-cased (Connect writes `x = P()`); missing earlier positional inputs are `null`.
- **ADR 0051:** groups are sequences of parts; undo applies inverses newest first; `no-history` refusal; history in the worker.
- **ADR 0052:** a one-part step that deletes passes its deleted ids as `inserted` on undo, so positions come back byte for byte; "F-301 and F-310 should keep groups that delete nodes to one part"; F-310 switches on Auto-layout selected.
- **ADR 0060:** `undo(revision, {discard: true})`, `addsPending` keeps the viewport, pending placement before the first draw, group token `<kind>-<session>-<counter>` (no `crypto.randomUUID`, secure-context only).
- **ADR 0064:** edge selection is canvas-local, `deleteKeyCode` null, `edgeKeyAction` in `apps/web/src/canvas/edge-keys.ts`; F-310's node Delete shares the key handler.
- **ADR 0056:** `send` refuses with `read-only`; Delete is off; `READ_ONLY_ALLOWED` e2e allow-list; selection still works in read-only.
- **ADR 0044:** inside an iframe the async Clipboard API needs the embedder's `allow="clipboard-read; clipboard-write"`; features degrade when refused.

### 1.2 Code (F-302 branch)
- `packages/lang-core/src/edit.ts`: command union; `CreateFile {path}` writes an empty file; no `AddInclude`, no multi-node delete.
- `packages/engine/src/edit/commands/delete-node.ts`: one node per command, reprints the declaration once. `create-definition.ts`: `includeOf(name, source)` with `alias: null`, `includeInsertion`, the "statements outside a workflow" refusal. `add-call.ts`: `callsAlready`. `names.ts`: `freshName`, `relativeSource`, `definitionPath`. `workflow.ts`: `clearArgument`, `mentionedNames`, `assignedNames`.
- `packages/engine/src/layout/carry.ts` `carryHints(command)` maps `deleteNode` to `{deleted: [node]}`; `history/history.ts` uses a one-part step's `deleted` as undo's `inserted`; `history/labels.ts` labels per kind.
- `packages/engine/src/service/service.ts` and `types.ts`: `EngineApi` (apply, undo with `UndoOptions`, setLayout, freshName, connectionTargets…).
- **Bug found:** `apps/web/src/workspace/workspace.ts` line 223 (also on `main` line 222) is `undo: (revision) => change(() => engine.undo(revision))`, dropping `options`, so F-301's `discard` never reaches the engine in the app (the store tests use a fake engine). F-310 relies on it; fix first (task 1).
- `apps/web/src/canvas/canvas-store.ts`: `selected: string | null` (single); `addFromPalette` shows the queue, group, discard and `addsPending` pattern; `rewire` for connect and disconnect; `canvasNotice`.
- `apps/web/src/canvas/workflow-canvas.tsx`: `multiSelectionKeyCode={null}`, `selectionKeyCode={null}`, `deleteKeyCode={null}`; `onNodesChange` forwards only one pick; `chosen`/`several` already drive "Auto-layout selected nodes" (`layout/layout-flow.ts` `autoLayout` handles ≥2 selected).
- `apps/web/src/history/history-keys.ts`: platform-aware shortcut parsing with `ignoredByShortcuts` (text fields, editor, dialogs).
- `apps/web/src/details/details-pane.tsx`: "Nothing selected" or one node's details; `workflow-summary.tsx`.
- Template `samplesheet-multiqc`: FASTQC and MULTIQC are linked through a chain node (`fastqc.flatMap{…}.collect()`), so they aren't "two connected processes" for step 1; a fixture is needed (section 4.4).

## 2. Design

### 2.1 Selection (web)
- Store state `selection: readonly string[]` (node ids of the active tab, order of selection). `selected` stays as "the one selected node" (`selection.length === 1 ? selection[0] : null`) so details, problems and every current reader keep working. Actions: `select(id | null)` unchanged (replaces the selection); new `selectNodes(ids: readonly string[])`; new `toggleSelected(id)`.
- React Flow: `multiSelectionKeyCode` Shift (plus Meta/Control, open point 7), `selectionKeyCode` Shift for the marquee, `selectionMode` partial or full (open point 7). `onNodesChange` forwards every select change as one `selectNodes` call. Selecting nodes clears the edge selection; selecting an edge clears nodes (F-302 note). A new view keeps the ids still present.
- Details pane with 2+ nodes: heading "N nodes selected", a list of their labels and kinds (each a button that selects that node alone), and Copy and Delete buttons (not in read-only). Single-node details gain Copy and Delete in the header (open point 8). With nothing selected and a non-empty clipboard, the workflow summary shows "Paste N nodes".

### 2.2 Delete
- **`DeleteNodes {kind: "deleteNodes", target, nodes: readonly string[]}`** (lang-core), one command, one part: resolves every id on the same projection, clears the direct arguments the deleted nodes fed (skipping arguments of nodes also being deleted), removes their statements, reprints the declaration once. Refuses as DeleteNode does (interface nodes, nested too deeply, empty `main` that the workflow needs) naming the first offending node. `deleteNode` becomes `deleteNodes([node])` internally; the `DeleteNode` kind stays for compatibility with tests and the hook.
- **Unused assignment cleanup** (F-302 note): after DeleteNodes or Disconnect, an assignment `x = CALL(...)` whose name was read before the command and is read nowhere in the declaration after it (main, emit, publish) becomes the bare statement `CALL(...)`. Only names the command made unread; only right-hand sides that are calls of a process or workflow (open point 5 for others).
- Carry hints: `deleteNodes` gives `{deleted: nodes}`; label "Delete <LABEL>" for one, "Delete N nodes" for several.
- Store `deleteSelection(session?)`: refuses in read-only without calling the engine; one `send`, `addsPending` raised so the viewport stays; clears the selection on success; refusal into `canvasNotice` ("Couldn't delete: …").

### 2.3 Clipboard and copy
- **The clipboard lives in the engine worker** (AR-30), outside the open project's state, so it survives `close`/`open` (project switches) and dies with the worker. The page store keeps only `clipboard: {nodes: number; connections: number; labels: readonly string[]; languageVersion: string} | null`. Open point 1.
- **`EngineApi.copy({path, workflow, nodes})`** at the current revision returns `{revision, summary}` or a refusal; replaces the clipboard. It builds a `NodeFragment` (engine-internal, not exported):
  - `languageVersion`; `nodes: {source: id; callee; definition: string; kind: "process" | "workflow"; offset: {x, y}}[]` (offset from the selection's top-left, from the sidecar or the projection's placed position the page sends with the request);
  - `edges`: projection edges whose both ends are copied call nodes, as `{from: {node, port}, to: {node, port}}` by port id; edges into or from other nodes are dropped;
  - `files: {path; text}[]`: each definition's file and, transitively, every project-local file it includes, at their project paths; plus the rest of the definition's directory when the file is `<dir>/main.nf` under `modules/` or `subworkflows/` (open point 4). Text is read from the model; limits as IO-12 (1 MB per file) and a total cap (open point 9).
- Refusals: a non-call node is named ("FASTQC.out.flatMap can't be copied yet: only process and workflow calls can.", open point 3); a definition in the workflow's own file, when the paste later targets another file or project (refused at paste time, open point 4); a callee from a plugin or pipeline include.
- Flush pending Code-view edits before copying (as undo does); copy runs in the store's queue.

### 2.4 Paste
- **`EngineApi.planPaste({target})`** returns `{revision, aliases: {name, alias, reason: "called" | "taken"}[]}` or a refusal: which callees need an alias in the target workflow (`called`: a process the workflow already calls, ADR 0039; `taken`: the name is bound in the target file to another definition). Alias from `freshName(\`${name}_2\`…)` against the file's scope and builtins.
- If any aliases, the page asks once: dialog "Paste with new names?", listing "FASTQC is already called in this workflow. It will be included again as FASTQC_2.", buttons "Paste" and "Cancel" (F-111 note: offer, not silent). Open point 6.
- **`EngineApi.paste({target, aliases, at}, revision)`**: one worker call, one undo step, labelled "Paste N nodes". Inside the service, under one group token, parts in order:
  1. `CreateFile {path, text}` for each fragment file not in the target project; a path present with identical text is reused; a path present with different text refuses the paste ("modules/local/fastqc/main.nf already exists with different content.", open point 4).
  2. `AddInclude {caller, name, alias, source}` for each definition not already bound under the name to use (source from `relativeSource`). Same-file definitions need none.
  3. `AddCall` per node (alias as callee).
  4. `Connect` per fragment edge, resolving the new node ids from the projection after step 3 (ids change once Connect assigns, so they are resolved per edge).
  Then the new nodes' positions are written with the service's own `setLayout` (`at` plus each node's offset; `at` null leaves them to ELK) before the change is announced, so they are drawn in place (ADR 0060's intent). Any refused part: `undo(discard)` of the group, refusal "Couldn't paste: <reason> Nothing was changed.". One `ProjectChange` is announced for the whole paste.
- **Inputs fed from outside the selection are left unconnected** (bare call or `null` placeholders per ADR 0039), open point 2.
- `at`: the pointer's flow position when the paste key is pressed over the canvas, else the canvas centre through the viewport bridge (`viewport.ts`); the selection's bounding box centre lands on it.
- A pasted fragment of another `languageVersion` is refused ("These nodes were copied from a Nextflow X project; this project uses Y.").
- Store `paste(session?)`: refuses in read-only, with no project or on a file tab; flush, `planPaste`, optional dialog, `paste` in the queue; `addsPending` raised; selects the pasted nodes; live message "Pasted 2 nodes and 1 connection.".

### 2.5 Keys (UX-70)
- Replace `edge-keys.ts` by `canvas-keys.ts`: `canvasKeyAction(event, {readOnly, apple, edgeSelected, nodesSelected})` returns `"disconnect" | "select-edge" | "clear" | "delete-nodes" | "copy" | "paste" | null`. Delete/Backspace: the focused or selected edge if any, else the node selection. Ctrl/⌘+C and Ctrl/⌘+V (platform rule of `history-keys.ts`); not in text fields, the code editor or dialogs (`ignoredByShortcuts`), and Ctrl+C yields to a non-empty document text selection. Copy and paste keys are handled at document level while a workflow canvas tab is active, so a paste after switching projects works without first focusing a node. In read-only only `clear` and `select-edge` act (open point 10 for copy).

### 2.6 Feedback
One polite live region in the canvas notices area announces "Copied N nodes.", "Pasted …", "Deleted N nodes." and refusals (repeats get a trailing no-break space, as ADR 0060).

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/edit/commands/delete-nodes.ts` | `deleteNodes(state: EditState, command: DeleteNodes): TextPatch[]` |
| `packages/engine/src/edit/commands/add-include.ts` | `addInclude(state: EditState, command: AddInclude): TextPatch[]` |
| `packages/engine/src/edit/unread.ts` | `dropUnreadAssignments(before: WorkflowDef, after: WorkflowDef, isCallable: (name: string) => boolean): WorkflowDef` |
| `packages/engine/src/clipboard/fragment.ts` | `interface NodeFragment`, `interface ClipboardSummary {nodes: number; connections: number; labels: readonly string[]; languageVersion: string}`, `buildFragment(state: EditState, request: CopyRequest, positions: Positions): NodeFragment` (throws `EditRefusal`), `summarise(f: NodeFragment): ClipboardSummary` |
| `packages/engine/src/clipboard/paste.ts` | `interface PastePlan {aliases: readonly PasteAlias[]}`, `interface PasteAlias {name: string; alias: string; reason: "called" \| "taken"}`, `planPaste(state: EditState, fragment: NodeFragment, target: WorkflowTarget): PastePlan`, `pasteCommands(...)` step builders used by the service |
| `packages/engine/test/edit/delete-nodes.test.ts`, `add-include.test.ts`, `unread.test.ts`; `packages/engine/test/clipboard/fragment.test.ts`, `paste.test.ts`; `packages/engine/test/service/clipboard.test.ts` | section 4 |
| `apps/web/src/canvas/canvas-keys.ts` (replaces `edge-keys.ts`) | `type CanvasKeyAction`, `canvasKeyAction(e: CanvasKeyEvent, context: {readOnly: boolean; apple: boolean; edgeSelected: boolean; nodesSelected: boolean}): CanvasKeyAction \| null` |
| `apps/web/src/canvas/use-clipboard-keys.ts` | `useClipboardKeys(): void` (document listener, as `use-history-keys.ts`) |
| `apps/web/src/details/selection-summary.tsx` | `SelectionSummary(props: {nodes: readonly {id: string; label: string; kind: string}[]; onSelect(id: string): void; onCopy?(): void; onDelete?(): void})` |
| `apps/web/src/canvas/paste-dialog.tsx` | `PasteAliasDialog(props: {aliases: readonly PasteAlias[]; onPaste(): void; onCancel(): void})` |
| `apps/web/test/canvas-keys.test.ts` (from `edge-keys.test.ts`, every existing case kept), `selection-summary.test.tsx`, `paste-dialog.test.tsx`, `clipboard-store.test.ts` | section 4 |
| `e2e/clipboard.spec.ts`, `e2e/clipboard.ts` (`shiftClick(page, id)`, `marquee(page, from, to)`, `pressCopy(page)`, `pressPaste(page)`, `F310_SOURCE`, `F310_TARGET`) | section 4 |
| `tools/oracle/cases/f310-*` | section 4.4 |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`:** add `DeleteNodes {kind: "deleteNodes"; target: WorkflowTarget; nodes: readonly string[]}`, `AddInclude {kind: "addInclude"; caller: string; name: string; alias: string | null; source: string}`; `CreateFile` gains `text?: string` (open point 11); both kinds in `EditCommand` and `EDIT_COMMAND_KINDS`.
- **`packages/engine/src/edit/apply.ts`:** dispatch the two kinds. **`commands/delete-node.ts`:** delegate to `deleteNodes`. **`commands/connect.ts` `disconnect`:** apply `dropUnreadAssignments`. **`commands/create-file.ts`:** write `text`. **`edit/nodes.ts`:** `includeOf(name, source, alias?: string | null)`.
- **`packages/engine/src/layout/carry.ts`:** `carryHints` for `deleteNodes`. **`history/labels.ts`:** labels for `deleteNodes`, `addInclude`, and the paste group label.
- **`packages/engine/src/service/service.ts`, `types.ts`:** `EngineApi` gains `copy(request: CopyRequest): Promise<{revision: number; summary: ClipboardSummary} | EngineRefusal>`, `clipboard(): Promise<ClipboardSummary | null>`, `planPaste(request: {target: WorkflowTarget}): Promise<{revision: number; aliases: readonly PasteAlias[]} | EngineRefusal>`, `paste(request: PasteRequest, revision: number): Promise<ChangeResult | EngineRefusal>` where `CopyRequest {path; workflow: string | null; nodes: readonly string[]; positions: Positions}` and `PasteRequest {target: WorkflowTarget; aliases: readonly PasteAlias[]; at: Point | null}`; `ChangeResult` carries `pasted: readonly string[]` (new node ids). `close()` keeps the clipboard.
- **`apps/web/src/workspace/workspace.ts`, `types.ts`:** forward `undo`'s options (bug fix); `copy`, `clipboard`, `planPaste` pass through; `paste` through `change(...)` for autosave. **`apps/web/src/engine/expose.ts`, `engine-client.ts`:** add the calls (`paste` through `announced`).
- **`apps/web/src/canvas/canvas-store.ts`:** `selection`, `clipboard`, `selectNodes`, `toggleSelected`, `deleteSelection`, `copySelection`, `paste`, `pendingPaste` (aliases awaiting the dialog), `clipboardNotice`.
- **`apps/web/src/canvas/workflow-canvas.tsx`, `canvas-host.tsx`, `flow-elements.ts`:** multi-select props, selection sync, key handler via `canvasKeyAction`, pointer position for paste.
- **`apps/web/src/details/details-pane.tsx`, `details-header.tsx`, `workflow-summary.tsx`:** section 2.1.
- **`e2e/read-only.ts` `READ_ONLY_ALLOWED`:** unchanged if the new buttons are not rendered in read-only (assert so).
- **`e2e/layout.spec.ts`:** add the Auto-layout selected test.
- **Docs:** UX-26 (what copy carries), UX-30 (several nodes), UX-70 (copy, paste keys), AR-21 (`DeleteNodes`); new ADR (section 7).
- **Unchanged:** runtime dependencies, dependency-cruiser rules, stored formats (sidecar v1, IndexedDB v1), workflows.

## 4. Tests (write first)

### 4.1 Engine (`pnpm --filter @nf-builder/engine test`)
- `delete-nodes.test.ts`: "F-310 UX-26 AR-23: DeleteNodes removes every selected statement in one reprint"; "F-310 ADR-0039: arguments fed by deleted nodes are cleared, except those of other deleted nodes"; "F-310: an interface node in the selection refuses the whole command, naming it"; "F-310: deleting every statement of a workflow that needs main refuses"; "F-310 ADR-0039: deleteNode equals deleteNodes of one node (golden bytes on the f111 fixtures)".
- `unread.test.ts`: "F-310 ADR-0064: delete of the only reader turns `x = P()` into `P()`"; "F-310 ADR-0064: Disconnect of the only reader does the same"; "F-310: a name still read by emit or publish keeps its assignment"; "F-310: an assignment already unread before the command is untouched"; "F-310: a non-call right-hand side is untouched" (pending open point 5).
- `add-include.test.ts`: "F-310 AR-21: AddInclude inserts `include { X as X_2 } from '<rel>'` at an item boundary"; "F-310: refuses a name or alias already bound in the caller, a source outside the project, and a caller with top-level statements".
- `create-file.test.ts` (extend): "F-310 ADR-0055: CreateFile with text writes it; an existing path refuses".
- `fragment.test.ts`: "F-310 UX-26: copying two connected calls carries both definition files, the edge by port id, and offsets"; "F-310: edges to unselected nodes are dropped"; "F-310: transitive local includes and the module directory come along"; "F-310: a chain or factory node refuses, naming it"; "F-310 IO-12: a file over 1 MB refuses".
- `paste.test.ts`: "F-310 ADR-0039: a process the workflow already calls needs an alias `X_2` (`called`)"; "F-310: a name bound to another definition needs an alias (`taken`)"; "F-310: identical files are reused, different ones refuse".
- `service/clipboard.test.ts`: "F-310 UX-26: copy, close, open another project, paste: files, includes, calls and connection match oracle case f310-paste-across byte for byte"; "F-310 AR-23: the paste is one undo step and undo restores exact bytes"; "F-310 ADR-0060: a refused part rolls back with no redo step and no file changed"; "F-310 ADR-0052: positions of pasted nodes are written before the change is announced"; "F-310 ADR-0052: undo of a multi-node delete restores the sidecar byte for byte"; "F-310: a fragment of another language version refuses"; "F-310: the clipboard survives close".
- `oracle-goldens.test.ts` (extend): the f310 cases' edited trees equal the engine's output.
- `history/labels.test.ts` (extend): "F-310: Delete N nodes, Paste N nodes".

### 4.2 Web (`pnpm --filter @nf-builder/web test`)
- `workspace.test.ts`: "F-310 ADR-0060: undo forwards `{discard: true}` to the engine" (fails today).
- `canvas-keys.test.ts`: every `edge-keys` case kept; "F-310 UX-70: Delete acts on the edge when one is selected, else on the nodes"; "F-310 UX-70: Ctrl+C/Ctrl+V and ⌘C/⌘V by platform"; "F-310: ignored in text fields, the editor, dialogs, and with a text selection for copy"; "F-310 ADR-0056: delete and paste are null in read-only".
- `canvas-store.test.ts` (extend): "F-310 UX-26: selectNodes keeps several ids and `selected` is null with two"; "F-310 F-302: selecting nodes clears the edge and vice versa"; "F-310 AR-23: deleteSelection sends one deleteNodes"; "F-310 ADR-0056: deleteSelection and paste are refused in read-only with no engine call"; "F-310: paste with aliases waits for the dialog; Cancel sends nothing"; "F-310 ADR-0060: views during a paste or delete keep the viewport"; "F-310 AR-30: the store's clipboard holds no file text" (summary shape only).
- `selection-summary.test.tsx`: "F-310 UX-30: two nodes show 'N nodes selected', the labels, Copy and Delete"; "F-310 ADR-0056: no buttons in read-only".
- `paste-dialog.test.tsx`: "F-310 ADR-0039: lists each alias and pastes or cancels".
- `flow-elements.test.ts`, `details-pane.test.tsx` (extend) for multi-selected nodes.

### 4.3 End-to-end (`pnpm test:e2e -- --grep F-310`)
`e2e/clipboard.spec.ts`:
- "F-310 step 1 UX-26: copy two connected processes to another project: both module files and the connection come across": store `f310-copy-source`, create a Blank project in the UI, switch to the source, click one node and shift-click the other, Ctrl/⌘+C, switch to the Blank project, Ctrl/⌘+V; the project's files equal `f310-paste-across` byte for byte, the canvas shows both nodes and one edge between them; one Undo restores the Blank project's bytes.
- "F-310 F-111 ADR-0039: pasting a process into the workflow that calls it offers `X as X_2`; Paste adds the include and call; Cancel changes nothing".
- "F-310 step 2 UX-26 AR-23: delete a multi-selection: one undo step restores all": a stored fixture (section 4.4), marquee-select two nodes, Delete; both gone and the label reads "Undo Delete 2 nodes"; one Undo: files and `.nf-builder/layout.json` byte-equal to before, history counts back.
- "F-310 F-207 UX-26: Auto-layout selected nodes moves only the selection" (add to `e2e/layout.spec.ts`).
- "F-310 ADR-0056: read-only: Delete and paste keys change nothing and no new control is visible" (`READ_ONLY_ALLOWED` unchanged).
- "F-310 ADR-0044: copy and paste work in a cross-origin iframe without clipboard permissions".

### 4.4 Oracle cases (`pnpm oracle`; CI job `oracle`)
Write the Nextflow only after checking `packages/lang-2610/catalogue/*.json` and the docs; model typed modules on `templates/samplesheet-multiqc`.
- `f310-copy-source`: typed project, two processes in `modules/local/<x>/main.nf`, the first with no inputs and the second taking the first's output directly. `lint.clean`, `run: ok`.
- `f310-paste-across`: the Blank template plus both modules and the pasted entry workflow as the engine writes it. `lint.clean`, `run: ok`.
- `f310-paste-alias`: a process included twice, `include { X }` and `include { X as X_2 }` from the same source in separate statements, both called in one workflow. Checks that 26.10 accepts it (lint and run); if it doesn't, the alias offer must change (record in `docs/research/upstream-bugs.md` if lint and run disagree).
- `f310-delete-multi` and `f310-delete-unread`: the step 2 fixture before and after DeleteNodes, and a Disconnect/delete leaving `x = P()` turned into `P()`: `lint.clean` (no unused-variable warning), `run: ok`.

## 5. Tasks

Branch `feat/F-310` after F-302 merges. `pnpm format` and `pnpm check` before every commit. Settle section 6 first.

1. **Undo options bug.** Forward `undo`'s options in `workspace.ts`; `workspace.test.ts`. Done: `pnpm --filter @nf-builder/web test`, `pnpm check`.
2. **Oracle cases** f310-* (section 4.4). Done: `pnpm oracle` green locally (Java 17 to 26) or in CI.
3. **DeleteNodes and unread cleanup** in lang-core and engine, Disconnect change, carry hints, labels, tests. Done: `pnpm --filter @nf-builder/engine test`, `pnpm test:corpus` (edit corpus), `pnpm check`.
4. **AddInclude and CreateFile text.** Done: engine tests, `pnpm check`.
5. **Fragment and paste planning** (`clipboard/`), tests. Done: engine tests.
6. **Service API** `copy`, `clipboard`, `planPaste`, `paste` with group, discard and positions; goldens against f310 cases. Done: engine tests, `pnpm check`.
7. **Workspace and client wiring** (`workspace.ts`, `expose.ts`, `engine-client.ts`). Done: web tests.
8. **Selection** in the store and canvas (multi-select, marquee, exclusivity), details summary. Done: web tests, `pnpm test:e2e -- --grep "F-206|F-302|F-207"`.
9. **Delete UI and keys** (`canvas-keys.ts`, `deleteSelection`). Done: web tests, `pnpm test:e2e -- --grep "F-302|F-703"`.
10. **Copy and paste UI** (store actions, document keys, dialog, buttons, live region). Done: web tests.
11. **End-to-end** (`e2e/clipboard.spec.ts`, layout test). Done: `pnpm test:e2e -- --grep F-310` with `PW_CHROMIUM_EXECUTABLE`, `pnpm smoke` under 60 s, `pnpm build && pnpm check:budget`.
12. **Records** (section 7). Done: `pnpm check`.

## 6. Open points (none decided here)

1. **Clipboard mechanism.** (a) Async Clipboard API: secure context only, needs `allow="clipboard-read; clipboard-write"` in frames (ADR 0044), `readText` prompts or shows a paste menu in Chromium, Firefox and Safari, and its text is a new exported format other tabs and versions would read (ADR needed). (b) In-app clipboard in the engine worker: works in every context and frame, keeps file text out of page stores (AR-30), survives project switches, but not other browser tabs or a reload. (c) Also writing JSON to the system clipboard from `copy`/`paste` DOM events (synchronous, no permission) for cross-tab use: an exported format. **Recommend (b)** for v0.1; UX-26's "across projects" is met within one tab. Record (c) as a later option.
2. **Inputs fed from outside the selection.** **Recommend:** leave them unconnected (same state as Disconnect; F-112 reports). **Alternative:** keep the original argument text when pasting into the same workflow (refs may be invalid elsewhere).
3. **Which nodes can be copied.** UX-26 says "nodes"; the steps need only process calls. **Recommend:** process and workflow calls in F-310; split operator, factory, chain and code nodes into a new feature (allowed, `scope-change` label; never dropped). **Alternative:** copy their expression text too (rewiring channel names is much more work).
4. **Which files a copy carries, and conflicts.** **Recommend:** the definition file plus transitive project-local includes at their own paths, plus the rest of the directory for `modules/**/main.nf` and `subworkflows/**/main.nf` (nf-core `meta.yml`, `environment.yml`, `templates/`, `resources/`); root `bin/` not copied (say so in the message). Same path and same text: reused; same path, different text: refuse. A definition inside the workflow's own file: same-project paste only; across files or projects refused with "Move X to its own module to copy it". **Alternatives:** copy to suffixed directories (`fastqc_2/`) with aliases; extract inline definitions into new module files.
5. **Unread assignments with non-call right-hand sides** (`x = ch.map { … }`). **Recommend:** leave them (lint's warning stays; a bare channel expression may itself warn: check with the oracle). **Alternative:** remove the whole statement.
6. **Alias offer UX.** **Recommend:** one dialog per paste listing every alias, Paste or Cancel. **Alternatives:** paste silently with aliases and say so in the live region; refuse.
7. **React Flow keys.** **Recommend:** `multiSelectionKeyCode` `["Shift", "Meta", "Control"]`, `selectionKeyCode` `"Shift"`, `selectionMode` `Partial`; the researcher to confirm Shift works for both in the pinned React Flow before building.
8. **Mouse affordances.** **Recommend:** Copy and Delete in the details pane (one or several nodes), "Paste N nodes" in the workflow summary when nothing is selected; no new canvas control (no canvas baseline moves). Single-node details header baselines may move: re-approve from CI (ADR 0021). **Alternative:** a canvas context menu.
9. **Clipboard size cap.** **Recommend:** IO-12's 1 MB per file and 200 files or 5 MB total per copy, refusing above. **Alternative:** no total cap.
10. **Copy in read-only.** **Recommend:** the copy key works (writes nothing to the project), buttons hidden. **Alternative:** inert, like Export (ADR 0056).
11. **`CreateFile` with text vs a new command.** **Recommend:** optional `text` on `CreateFile` (amends ADR 0055's empty-file rule). **Alternative:** a separate internal command not in `EditCommand`.
12. **Worker-side vs page-side paste orchestration.** The F-301 note says reuse `addFromPalette`'s page-side pattern. **Recommend:** worker-side `paste` (one call, one announced change, node ids re-resolved after each Connect, clipboard already there), using the same group and discard mechanics. **Alternative:** page-side, as F-301, with a `project()` read between parts.
13. **Redo of a paste** brings nodes back without their pasted positions (ADR 0052 restores removed positions only on undo); ELK places them. **Recommend:** accept for v0.1.

**AGENTS.md decide-and-record items:** spec changes (UX-26, UX-30, UX-70, AR-21); ADR 0039 (DeleteNodes, AddInclude, unread cleanup, Disconnect change), ADR 0043 API list, ADR 0055 (CreateFile text), ADR 0052 (paste positions), ADR 0064 consequence; a `features.json` split if point 3 is taken (Scope guard, `scope-change`); an exported format only if point 1 picks (a) or (c). None: runtime dependencies, package boundaries, dependency-cruiser, workflows, IndexedDB or sidecar formats.

## 7. Records (drafts for the orchestrator)
- **ADR** `Accepted (agent)`: "Select several nodes, delete them as one command, and copy and paste call nodes through a clipboard in the engine worker". Amends ADRs 0039, 0043, 0052, 0055, 0064 as above; row in `docs/adr/README.md`.
- **`features.json`:** F-310 notes "Verified <date>: steps by `e2e/clipboard.spec.ts` … ADR 00xx", `passes: true`; F-301 note on the fixed `discard` forwarding; F-701 note for keyboard multi-select; new feature for point 3 if taken.
- **`progress.md`:** entry with the ADR, the undo-options bug fix, spec changes, any `@visual` re-approvals.

## 8. Evidence
- `docs/plan/features.json` F-310 (notes from F-111, F-011, F-206, F-209, F-207, F-703, F-301, F-302); `docs/spec/ux.md` UX-26 (UX-04, UX-30, UX-70 for context), `docs/spec/architecture.md` AR-21, AR-23, AR-30.
- ADRs 0039, 0044, 0051, 0052, 0056, 0060 on `main`; 0064 on `feat/F-302`.
- Code at the commits above, files in section 1.2.
