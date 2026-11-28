# Plan: F-301, add from the palette by drag and drop or keyboard; a new process or workflow in its own file

Written by the planner on 2026-11-27 from `main` at `beb703e` (F-309 and F-403 merged), with F-210 in progress on `feat/F-210` (`/home/user/wt-F-210`, at `d9f619c`: `CreateFile` landed, `listFiles` declared) and designed from `docs/plan/handoff/plan-F-210.md`. I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**In scope:**
- **Palette items become focusable and draggable** (UX-15, QA-11, UX-70 "add focused palette item (Enter)"). Keyboard users get each item's description (F-204 note).
- **Process:** dropping it on the canvas, or Enter on it, creates a typed process in `modules/local/<name>/main.nf` (LA-12, existing `CreateProcess`) and calls it in the active tab's workflow (`AddCall`), as one undo step (AR-23, ADR 0051 `group`).
- **Workflow:** the same with a new command **`CreateWorkflow`** (AR-21 lists it; it doesn't exist yet), writing `subworkflows/local/<name>/main.nf` (LA-12).
- **Placement:** a drop puts the node at the pointer; Enter puts it at the viewport centre (UX-15). The position is stored through `setLayout` before the node is first drawn, so ELK never places it (ADR 0052 consequence).
- **Step 3:** the resulting project passes `nextflow lint` (an oracle case, matched byte for byte by the e2e test; open point 9).

**Out of scope:**
- Dropping an operator on an edge (UX-15's second sentence; F-308).
- Adding any other palette item: Exec process, Agent, Include pipeline, factories, operators, params, output, record, enum, function, include, config (open point 1).
- Re-including an existing process under an alias (F-111 note); F-301 only creates new definitions (open point 15).
- Configuring the new node (F-303), registry modules (F-504), multi-select and paste (F-310).
- UX-04's read-only mode below 1024 px (not built anywhere yet; open point 16).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-15:** "Items are added by drag and drop onto the canvas, or by keyboard: focus the item, press Enter, and it is placed at the viewport centre."
- **LA-12:** "A new process or named workflow is written to its own file, with `nextflow.enable.types = true` at the top: `modules/local/<name>/main.nf` or `subworkflows/local/<name>/main.nf`. The app adds the `include` to the calling script. The directory is the name in lower case and the include path is explicit (ADR 0039)."
- **AR-21:** v1's minimum set includes `CreateProcess`, `CreateWorkflow` and `AddCall`. Only `CreateProcess` and `AddCall` exist (`packages/lang-core/src/edit.ts`); F-210 adds `CreateFile`.
- **AR-23 / ADR 0051:** a user action of several commands is one step; commands applied with the same `group` token form one step; a partial group rolls back with one undo.
- **ADR 0039:** `CreateProcess` writes the scaffold, script-only, and includes `<rel>/modules/local/<lower>/main.nf`. AddCall appends a bare `CALLEE()` and creates `main:` when absent; it refuses a second call of a process.
- **ADR 0052:** "F-301 sets a dropped node's position with `setLayout` before the canvas refreshes, so ELK doesn't move it." Viewport rule: "a new projection, a port-labels toggle and a pane resize re-fit" (conflicts with "placed at the viewport centre"; open point 5).
- **ADR 0036:** a bare call's key is `<path>#<workflow>/<CALLEE>@n`; a fresh callee's first call is `@1`.
- **No spec text** names the new definition, says what happens when the add fails halfway, or where focus goes after Enter.

### 1.2 Code on main
- `createProcess` (`packages/engine/src/edit/commands/create-process.ts`) checks the name, the caller (Nextflow script, no top-level statements), the target path and the caller's scope, then returns a `create` patch plus an include insertion. It generalises to workflows with a different directory and scaffold.
- `Scaffold` (lang-core) has only `process(name)`; `packages/lang-2610/src/scaffold.ts` is tested for parse, typed flag and printer fixed point (`packages/lang-2610/test/scaffold.test.ts`). A stub `Scaffold` sits in `packages/engine/test/palette.test.ts`.
- `EDIT_COMMAND_KINDS` drives the fast-check harness (`packages/engine/test/edit/harness.ts`, `properties.test.ts`) and `test/corpus/edit.corpus.ts`; each kind must be accepted at least once. Labels: `packages/engine/src/history/labels.ts`.
- Oracle goldens: `packages/engine/test/edit/oracle-goldens.test.ts` runs commands on a case tree and compares with another case directory (`f111-edits-*`).
- **Canvas store** (`apps/web/src/canvas/canvas-store.ts`): `apply(command, session, options)` goes through one queue (`send`). The engine client announces every apply to `changed` (`withChangeEvents`), which reloads the active tab quietly. `load` sets `content.positions` from `project()`. `save()` wraps `setLayout`; `pendingMove` re-sends a stale move. `registerFlush` is the precedent for a registered callback.
- **Canvas** (`workflow-canvas.tsx`): nodes without positions trigger `placeMissing` (ELK); a new view replaces the nodes, so `useNodesInitialized` re-fits. `useReactFlow` gives `screenToFlowPosition`. The palette lives outside the `ReactFlowProvider`, so it needs a bridge to the viewport.
- **Palette** (`apps/web/src/palette/palette-item-row.tsx`): rows are non-focusable `<li title=summary>`. Item keys: construct `process`, `workflow`; others `kind:name`. The F-204 e2e test finds category buttons by exact name and the search result by `palette(page).getByRole("status")`: a second `role="status"` in the palette would break strict mode.
- `canvasView(...)` (engine, pure) gives each node's estimated width and height; `formatNodeKey` and `parseNodeKey` are exported.
- e2e helpers: `createFromTemplate`, `canvasNodeIds` (`e2e/templates.ts`); `readSidecar`, `nodePosition`, `nodeBoxes` (`e2e/layout.ts`); `layoutSettled`, `viewportZoom`, `node` (`e2e/canvas.ts`); `storedFiles`, `historyStatus` (`e2e/history.ts`).
- Templates: `blank` has `workflow {\n}` as its entry workflow and is oracle case `template-blank` (lint clean, stub-runs).

### 1.3 F-210 interfaces F-301 relies on
- **Files panel refresh:** `filesStore` pulls `listFiles()` after every `onEngineChange` while visible, so step 1's module appears without extra work.
- **`filesStore.reveal(path)`** expands the ancestors and selects the path (plan-F-210 2.2); F-301 calls it after an add (open point 11).
- **Document drop guard** (plan-F-210 open point 18) acts on file drags only and must leave the palette's MIME type alone; F-301 adds a test.
- **`CreateFile`** isn't used by F-301, but both features append to `EDIT_COMMAND_KINDS`, `labels.ts`, the harness, `service/types.ts`, `engine-client.ts` and AR-21's text. Merge `main` after F-210 lands, before task 2.
- **Tab strip:** F-210 renames the tablist; nothing here depends on its label.

### 1.4 Nextflow syntax (not checked locally)
- No Nextflow release is cached in this checkout, so I ran no oracle. The grammar (`packages/lang-2610/grammar/ScriptParser.g4`, `workflowDef`) allows `workflow NAME {}` with no body and an implicit `main`; `nextflow-io/nextflow` `v26.10.7/docs/workflow-typed.mdx` shows typed named workflows with `take:`/`main:`/`emit:` (fetched to the scratchpad). Whether an empty named workflow lints clean **and** stub-runs when called is unverified: task 1 proves it with `pnpm oracle` (or the CI `oracle` job). Open point 3.

## 2. Design

### 2.1 Which items add what
`paletteAction(item: PaletteViewItem): PaletteAction | null` (engine, pure): `process` gives `{kind: "process"}`, `workflow` gives `{kind: "workflow"}`, everything else `null`. Items with `null` stay focusable (for their description) with `aria-disabled="true"`, aren't draggable, and Enter announces "<Label> can't be added from the palette yet." (open point 1).

### 2.2 Commands (engine)
- **`CreateWorkflow {kind: "createWorkflow"; name; caller}`**, the twin of `CreateProcess`: `subworkflows/local/<lower>/main.nf` from `scaffold.workflow(name)`, included as `<rel>/subworkflows/local/<lower>/main.nf`. Both are built by one shared `createDefinition(state, command, "process" | "workflow")` with the same checks and messages ("workflow" in place of "process").
- **Label:** `Create workflow <name>`.
- **A fresh name:** `freshDefinitionName(model, catalogue, {kind, caller})` returns `NEW_PROCESS` or `NEW_WORKFLOW`, then `_2`, `_3`, skipping a name that is: in the caller's scope (`model.lookup`), a builtin (`builtinNames`), or whose lower-cased directory already holds any path. It runs in the worker as `EngineApi.freshName(request)` because only the worker has the model (AR-30; open point 4).

### 2.3 The add, in the canvas store
`addFromPalette({item, tab, at}, session)`, run as **one** queued task (so no Code-view flush or other apply interleaves):
1. Refuse up front, with a message, when: no project; the active tab isn't a workflow tab; the session changed; the item has no action.
2. `freshName({kind, caller: tab.path})`.
3. Record `pendingPlacement = {session, tab: tab.id, key: formatNodeKey(<tab.path>#<tab.workflow>/<NAME>@1), at}` when `at` isn't null.
4. `apply(create, revision, {group, label})`, then `apply(addCall, revision', {group})`; label `Add process NEW_PROCESS` or `Add workflow NEW_WORKFLOW`. `group` is `palette-<session>-<counter>`, not `crypto.randomUUID()`, which needs a secure context (ADR 0044; open point 14).
5. If the second command is refused, `undo(revision'')` at once (it undoes only the group's first part) and return the refusal with "Nothing was changed." (open point 7).
6. On success: select the new node, `filesStore.reveal(<new path>)`, and return `{ok, name, path, node}`.

**Placement before first draw:** in `load`, when the projection holds `pendingPlacement.key` and the tab and session match, the node's top-left is `at − (estimated width / 2, estimated height / 2)` from `canvasView` (rounded), merged into `content.positions` in the **same** `set` as the projection, then saved with `save(tab, revision, {key: point}, false)`. The canvas therefore never sees the node unplaced, and ELK doesn't run. `pendingPlacement` is cleared when used, on refusal and on a session change. A stale `setLayout` reuses the existing `pendingMove` retry.

**Viewport:** the `load` that consumes a placement sets `content.refit = false`; `CanvasInner` skips its re-fit for that view (open point 5). The e2e test asserts the transform is unchanged.

### 2.4 Pointer and keyboard (web)
- **Palette rows:** `<li class="palette-item">` holding `<button type="button" class="palette-item-button" draggable aria-describedby>`; the description is a visually hidden span (the `title` stays for the mouse). Buttons are natively tabbable within open categories (open point 12). CSS keeps today's look apart from a focus ring, so no baseline should move (open point 17).
- **Drag:** `dragstart` writes `application/x-nf-builder-palette` = item key, `effectAllowed = "copy"`.
- **Drop target:** the canvas host div handles `dragover` (only when that MIME type is present: `preventDefault`, `dropEffect = "copy"`) and `drop`: `screenToFlowPosition({x: clientX, y: clientY})`, then `addFromPalette`.
- **Enter:** `activeViewport()?.centre()` (the canvas host's client-rect centre through `screenToFlowPosition`). With no mounted canvas (Code mode, a file tab), `at` is null and ELK places the node (open point 10).
- **Viewport bridge:** `registerViewport({tab, centre, toFlow})` from `CanvasInner`, unregistered on unmount; module-level in `apps/web/src/canvas/viewport.ts`, like `registerFlush`.
- **Feedback:** one `aria-live="polite"` region in the palette panel (not `role="status"`, see 1.2): "Added process NEW_PROCESS to the entry workflow." or the refusal. Focus stays on the palette item (open point 8).

### 2.5 Copy (British English, sentence case)
| When | Text |
|---|---|
| Added | "Added process NEW_PROCESS to the entry workflow." / "… to workflow ALIGN." |
| No project | "Open or create a project to add components." |
| File tab active | "Open a workflow tab to add components to it." |
| Not addable | "<Label> can't be added from the palette yet." |
| Refused | "Couldn't add <name>: <engine message> Nothing was changed." |

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/edit/commands/create-definition.ts` (replaces `create-process.ts`) | `createProcess(state: EditState, command: CreateProcess): TextPatch[]`; `createWorkflow(state: EditState, command: CreateWorkflow): TextPatch[]` |
| `packages/engine/src/edit/fresh-name.ts` | `FreshNameRequest {kind: "process" \| "workflow"; caller: string}`; `NEW_NAME_BASE: Record<FreshNameRequest["kind"], string>` (`NEW_PROCESS`, `NEW_WORKFLOW`); `definitionPath(kind, name): string`; `freshDefinitionName(model: ProjectModel, catalogue: ScriptCatalogue, request: FreshNameRequest): string` |
| `packages/engine/src/palette-actions.ts` | `PaletteAction = {kind: "process"} \| {kind: "workflow"}`; `paletteAction(item: Pick<PaletteViewItem, "key">): PaletteAction \| null` |
| `packages/engine/test/edit/create-workflow.test.ts`, `fresh-name.test.ts`; `packages/engine/test/palette-actions.test.ts` | section 4 |
| `tools/oracle/cases/f301-palette-adds/**` | the blank template plus `modules/local/new_process/main.nf` and `subworkflows/local/new_workflow/main.nf`, written by the golden test (case entry in `cases.yaml`: `lint: {expect: ok, clean: true}`, `run: {expect: ok}`, `spec: [F-301, LA-12, AR-21, UX-15]`) |
| `apps/web/src/canvas/viewport.ts` | `CanvasViewport {tab: string; centre(): Point; toFlow(client: {x: number; y: number}): Point}`; `registerViewport(v: CanvasViewport): () => void`; `activeViewport(tab: string): CanvasViewport \| null` |
| `apps/web/src/palette/palette-drag.ts` | `PALETTE_MIME = "application/x-nf-builder-palette"`; `writePaletteDrag(dt: DataTransfer, key: string): void`; `hasPaletteDrag(dt: DataTransfer): boolean`; `readPaletteDrag(dt: DataTransfer): string \| null` |
| `apps/web/src/palette/use-palette-add.ts` | `usePaletteAdd(): {add(key: string, at: Point \| null): Promise<void>; message: string \| null}` (reads `canvasStore`, formats 2.5's copy) |
| `apps/web/test/palette-item-row.test.tsx`, `palette-drag.test.ts`, `viewport.test.ts` | section 4 |
| `e2e/palette-add.ts` | `paletteItem(page, label): Locator`; `dragToCanvas(page, label, at: {x; y})` (Playwright `dragTo`, with a `DataTransfer` dispatch fallback); `paneCentre(page): Promise<Point>`; `viewportTransform(page): Promise<string>` |
| `e2e/palette-add.spec.ts` | section 4 |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`:** `CreateWorkflow`; add to `EditCommand` and append `"createWorkflow"` to `EDIT_COMMAND_KINDS` (after F-210's `createFile`); `Scaffold.workflow(name: string): string`.
- **`packages/lang-core/src/index.ts`:** export `CreateWorkflow`.
- **`packages/lang-2610/src/scaffold.ts`:** `workflow(name)` (candidate text in open point 3).
- **`packages/engine/src/edit/apply.ts`:** `createWorkflow` case; import from `create-definition.ts`.
- **`packages/engine/src/edit/names.ts`:** `subworkflowDirectory(name) = subworkflows/local/<lower>`.
- **`packages/engine/src/history/labels.ts`:** `case "createWorkflow": return \`Create workflow ${command.name}\``.
- **`packages/engine/src/service/types.ts`:** `FreshName {revision: number; name: string; path: string}`; `EngineApi.freshName(request: FreshNameRequest): Promise<FreshName | EngineRefusal>`.
- **`packages/engine/src/service/service.ts`:** `freshName` through `guarded`; refuses `not-found` for an unknown caller.
- **`packages/engine/src/index.ts`:** export `CreateWorkflow`, `FreshNameRequest`, `FreshName`, `paletteAction`, `PaletteAction`.
- **`packages/engine/test/edit/harness.ts`:** a `createWorkflow` case mirroring `createProcess`, and its structure check.
- **`packages/engine/test/edit/oracle-goldens.test.ts`:** the `template-blank -> f301-palette-adds` golden.
- **`packages/engine/test/palette.test.ts`:** the stub scaffold gains `workflow`.
- **`apps/web/src/engine/engine-client.ts`** and **`apps/web/src/workspace/{types,workspace}.ts`:** pass `freshName` through.
- **`apps/web/src/canvas/canvas-store.ts`:** `PaletteAdd {item: string; tab: string; at: Point | null}`; `PaletteAddOutcome = {ok: true; name: string; path: string; node: string} | {ok: false; message: string}`; `WorkspaceActions.addFromPalette(request: PaletteAdd, session?: number): Promise<PaletteAddOutcome>`; the ready `CanvasContent` gains `refit: boolean` (true everywhere else); `pendingPlacement` and its use in `load` (2.3).
- **`apps/web/src/canvas/workflow-canvas.tsx`:** `dragover`/`drop` on the host; `registerViewport`; skip the `initialized` re-fit when `refit` is false (prop from `canvas-host.tsx`).
- **`apps/web/src/canvas/canvas-host.tsx`:** pass `refit` and `onPaletteDrop(key, at)`.
- **`apps/web/src/palette/palette-item-row.tsx`, `palette-panel.tsx`, `palette.css`:** the button, description, drag start, Enter, live region.
- **`e2e/engine.ts`:** `EngineHook.freshName`.
- **Unchanged:** workflows, CSP and host allow-list, IndexedDB and sidecar formats, AGENTS.md command table (no new script), dependency-cruiser rules.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/lang-2610/test/scaffold.test.ts`** (extend) | |
| `F-301 LA-12 LA-11: the new-workflow template sets nextflow.enable.types = true and defines one named workflow` | for `HELLO`, `A`, `X_2`, `_x`: status modelled, no problems, body `["FeatureFlag", "Workflow"]`, name matches, `typesEnabled` |
| `F-301 LA-45 ADR-0032: the new-workflow template is a printer fixed point` | |
| **`packages/engine/test/edit/create-workflow.test.ts`** | |
| `F-301 step 2 LA-12 AR-21: CreateWorkflow writes subworkflows/local/<lower>/main.nf with the flag and adds an explicit include to the caller` | patches: one `create`, one `edit`; include source `./subworkflows/local/new_workflow/main.nf` |
| `F-301 LA-12: the include is relative from a caller in a subdirectory and resolves` | caller `subworkflows/local/a/main.nf` gets `../b/main.nf`; `model.lookup` resolves |
| `F-301 AR-21: CreateWorkflow refuses an invalid name, an existing path, a name in scope, and a caller with top-level statements` | codes and messages as CreateProcess's, with "workflow" |
| `F-301 AR-23: CreateWorkflow's inverse restores the exact bytes` | |
| **`packages/engine/test/edit/fresh-name.test.ts`** | |
| `F-301 LA-12: freshDefinitionName gives NEW_PROCESS, then NEW_PROCESS_2 when the name is in scope, its directory holds any file (any case), or it is a builtin` | |
| `F-301 LA-12: process and workflow names are fresh independently, and a CreateProcess with the name is accepted` | |
| **`packages/engine/test/palette-actions.test.ts`** | |
| `F-301 UX-15: process and workflow have an action; every other 26.10 palette item has none` | over the real palette view |
| **`packages/engine/test/edit/oracle-goldens.test.ts`** (extend) | |
| `F-301 step 3 LA-12: the blank template with a palette process and workflow equals oracle case f301-palette-adds` | `createProcess` + `addCall` + `createWorkflow` + `addCall`; no diagnostics |
| **`packages/engine/test/edit/properties.test.ts`, `test/corpus/edit.corpus.ts`** (existing, via the harness) | `createWorkflow` accepted at least once on the start trees and every pin |
| **`packages/engine/test/history/labels.test.ts`** (extend) | `F-301 AR-23: createWorkflow is labelled "Create workflow <name>"` |
| **`packages/engine/test/service/service.test.ts`** (extend) | |
| `F-301 AR-23 ADR-0051: createProcess and addCall under one group are one undo step that restores every file byte for byte` | and the same for createWorkflow |
| `F-301: freshName refuses with no project or an unknown caller, and its result survives structuredClone` | |
| **`apps/web/test/canvas-store.test.ts`** (extend, fake engine) | |
| `F-301 UX-15 AR-23: addFromPalette asks for a fresh name, then applies create and addCall under one group with the step label` | call order and options |
| `F-301 ADR-0052: the new node's position is in content.positions in the same update as the projection, and setLayout is called with it` | no snapshot without the position; centre-to-top-left from `canvasView` |
| `F-301 UX-15: a placed add sets refit false; a later change sets it true again` | |
| `F-301 AR-23: when addCall is refused after create, the store undoes once and returns the refusal` | |
| `F-301: addFromPalette refuses with no project, a file tab, an older session or an item with no action, and calls no engine method` | |
| `F-301: with at null no placement is recorded` | |
| **`apps/web/test/palette-item-row.test.tsx`** | |
| `F-301 QA-11 UX-15: an addable item is a focusable draggable button described by its summary; others are aria-disabled and not draggable` | |
| `F-301 UX-70: Enter on an item calls add with the viewport centre` | |
| **`apps/web/test/palette-drag.test.ts`, `viewport.test.ts`** | |
| `F-301 UX-15: a palette drag carries the item key under its MIME type; file drags aren't palette drags` | |
| `F-301 UX-15: activeViewport returns the registered viewport for its tab only, and nothing after unregistering` | |
| **`e2e/palette-add.spec.ts`** (Chromium) | |
| `F-301 step 1 UX-15 LA-12: dragging Process onto the canvas adds a node at the drop point; Files shows modules/local/new_process/main.nf; main.nf has the include and the call` | from the blank template; node `main.nf#/NEW_PROCESS@1` visible with its box containing the drop point; sidecar holds it; Files tab tree row `modules/local/new_process/main.nf`; `readFile("main.nf")` contains `include { NEW_PROCESS } from './modules/local/new_process/main.nf'` and `NEW_PROCESS()` |
| `F-301 step 2 UX-15 UX-70 QA-11: focusing Workflow and pressing Enter adds a node at the viewport centre` | Tab to the item; its accessible description is its summary; node box contains the pane centre; viewport transform unchanged; sidecar entry equals the rendered position; no "Laying out nodes…" |
| `F-301 step 3 LA-12: after both adds the project's files equal oracle case f301-palette-adds` | `storedFiles` minus `.nf-builder/` equal the case directory byte for byte; the CI `oracle` job lints and stub-runs it |
| `F-301 AR-23: one undo removes the process, its module file and the include; redo restores them` | `historyStatus`, `storedFiles` byte equality |
| `F-301 UX-15: an item with no action says so and changes nothing` | live region text; revision unchanged |
| `F-301 F-210: a palette drag over the canvas isn't taken by the Files drop guard` | |
| `F-301 QA-30: adding logs no CSP violation and no console error` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-301`, after F-210 merges (merge `main` first). Run `pnpm check` before every commit. Settle section 6 first.

1. **Workflow scaffold.** `Scaffold.workflow`, the 26.10 text, the scaffold tests and the engine stub.
   - Done when `pnpm --filter @nf-builder/lang-2610 test` and `pnpm check` pass, and a throwaway oracle case calling the scaffold workflow passes `pnpm oracle` locally (Java 17+; drop the case after) or a draft CI run's `oracle` job.
2. **`CreateWorkflow`.** lang-core type and kind; `create-definition.ts`; `subworkflowDirectory`; label; harness case; tests; the golden and oracle case `f301-palette-adds` with its `cases.yaml` entry.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm test:corpus` (after `pnpm corpus:fetch && pnpm corpus:lint`; `createWorkflow` accepted on every pin), `pnpm oracle` (or CI `oracle`) and `pnpm check` pass.
3. **Fresh names and palette actions.** `fresh-name.ts`, `palette-actions.ts`, `EngineApi.freshName`, service, engine client, workspace, `EngineHook.freshName`; their tests and the service group test.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
4. **Store.** `addFromPalette`, pending placement, `refit`, rollback; canvas-store tests.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
5. **Palette and canvas UI.** Buttons, descriptions, drag, Enter, live region; `viewport.ts`, `palette-drag.ts`, `use-palette-add.ts`; drop handling and no-refit in the canvas; unit tests.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-204|F-205|F-207|F-209"` pass (no visual baseline changes; if one does, stop and report).
6. **End-to-end.** `e2e/palette-add.ts` and `palette-add.spec.ts`.
   - Done when `pnpm test:e2e -- --grep F-301`, `pnpm smoke` (under 60 s) and `pnpm build && pnpm check:budget && pnpm check:hosts` pass.
7. **Records** (section 7). Done when `pnpm check` passes (ADR lint, `features.json` validation).

## 6. Open points (none decided here)

1. **Which items add something.** Only Process and Workflow have steps; AR-21's `AddFactory`, `AddChain`, `CreateRecord`, `CreateFunction`, `AddInclude`, `UpdateParams` and `UpdateOutputs` don't exist, and **no feature owns adding factories, records, enums, functions, includes, params, output, Exec process, Agent or Include pipeline from the palette** (F-308 owns operators on edges only). Spec gap.
   - **Recommend:** F-301 adds Process and Workflow only; the rest are focusable, described, `aria-disabled`, and say "can't be added yet". Add a new feature (M3, `scope-change`) "Add the remaining palette items" listing those commands; adding a feature is allowed under AGENTS.md but touches `features.json` beyond notes.
2. **`CreateWorkflow` and `Scaffold.workflow`** extend ADR 0039's command set and the pack interface (decide and record). **Recommend:** accept, mirroring CreateProcess exactly.
3. **The workflow scaffold text** (Nextflow syntax; must pass the oracle, not memory).
   - **Recommend** the shape of the blank template's entry workflow, which lints clean and stub-runs there: `nextflow.enable.types = true\n\nworkflow NAME {\n}\n`. If lint or a stub run rejects calling it, fall back to an explicit `main:` with a statement, chosen with the oracle. No doc comment (F-312 expects a fresh definition to raise a documentation suggestion).
4. **Default names and `EngineApi.freshName`.** The spec names nothing; the page lacks the model.
   - **Recommend:** `NEW_PROCESS` and `NEW_WORKFLOW` with `_2`, `_3`, renamed later through F-303's popup; a worker call `freshName` (amends ADR 0043's API list). **Alternative:** a name dialog before each add (adds a step to every drop; F-303 covers renaming).
5. **Viewport after an add.** ADR 0052 re-fits on every new projection, which would move the node away from where it was dropped or from the centre.
   - **Recommend:** an add that placed its node keeps the viewport; everything else re-fits as now. Amends ADR 0052's viewport rule.
6. **Placement point.** **Recommend:** the node's centre goes to the drop point or viewport centre, using `canvasView`'s estimated size, rounded, stored through `setLayout` in the same update that first shows the node.
7. **A group that fails halfway.** **Recommend:** the store undoes the applied part at once, so a refused add changes nothing, and says why. **Alternative:** leave the module and include for the user to undo.
8. **Focus and selection after an add.** **Recommend:** focus stays on the palette item (repeat adds by keyboard), the new node is selected (details pane shows it), and the live region announces it.
9. **Step 3's "exported".** Export is F-404, not a dependency. **Recommend:** read it as "the project's files", checked byte for byte against the oracle case the CI `oracle` job lints and stub-runs; note for F-404 to repeat it on a real export.
10. **Enter without a visible canvas** (Code mode, a Split pane at narrow width, a file tab). **Recommend:** a workflow tab in Code mode still adds, with ELK placing the node; a file tab refuses.
11. **Files view after an add.** **Recommend:** call `filesStore.reveal(path)` (F-210) without switching the left column to Files.
12. **Palette keyboard model.** **Recommend:** native buttons, each tabbable when its category is open, and Enter (and Space, which buttons give) adds. Roving tabindex is left to the F-701 audit.
13. **Drag data.** **Recommend:** custom MIME `application/x-nf-builder-palette`; F-210's document guard must ignore drags without `Files`.
14. **Group tokens.** **Recommend:** `palette-<session>-<counter>`, since `crypto.randomUUID` needs a secure context (ADR 0044).
15. **Adding an existing process again under an alias** (F-111 note). **Recommend:** out of scope (F-301 always creates new definitions); move the note to F-310 (paste) and F-504 (registry).
16. **UX-04 read-only mode** isn't built; when it is, palette adds must be disabled there. **Recommend:** a note on whichever feature builds UX-04 (F-701).
17. **Visual baselines.** **Recommend:** no baseline changes; if the app-shell or palette baseline moves, re-approve from CI (ADR 0021) and say so in the PR.

**AGENTS.md decide-and-record items:**
- **Spec or ADR changes:** points 2 and 4 (ADR 0039 command set, ADR 0043 API list), point 5 (ADR 0052 viewport rule), and the spec readings in points 1, 3, 4, 6, 7 and 9.
- **`features.json`:** point 1's new feature (`scope-change` label).
- **None:** runtime dependencies, package boundaries, dependency-cruiser rules, stored or exported formats (the sidecar format is unchanged), workflows, open questions.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number: "Add palette items as grouped commands with fresh names, positions set before the first draw, and the viewport kept". Covers 2.1 to 2.4 and points 1 to 8, 10, 12 to 14; amends ADR 0039 (`CreateWorkflow`, `Scaffold.workflow`), ADR 0043 (`freshName`) and ADR 0052 (viewport after an add). Row in `docs/adr/README.md`.
- **Spec:** AR-21 unchanged (it already lists `CreateWorkflow`); UX-15: "a new process or workflow is named `NEW_PROCESS` or `NEW_WORKFLOW` (then `_2`, …) and selected; the canvas keeps its viewport"; LA-12 unchanged.
- **`features.json`:**
  - **F-301:** `passes`, and a note: "Verified …: step 1 by `e2e/palette-add.spec.ts` (drag, Files view, include and call); step 2 by the keyboard test (viewport centre, viewport kept); step 3 by oracle case `f301-palette-adds` (CI `oracle`) matched byte for byte by the e2e test and the engine golden. Decisions in ADR …".
  - **F-303:** new definitions are called `NEW_PROCESS`/`NEW_WORKFLOW`; Configure is where they are renamed.
  - **F-308:** reuse `PALETTE_MIME`, `hasPaletteDrag` and `registerViewport`; operator drops onto edges need an edge hit test.
  - **F-310:** reuse `addFromPalette`'s group-and-rollback pattern; the alias note from F-111 moves here and to F-504.
  - **F-404:** repeat F-301 step 3 on an exported zip.
  - **F-701:** palette roving tabindex; disable palette adds in UX-04's read-only mode.
  - **New feature (point 1):** "Add the remaining palette items: factories, records, enums, functions, includes, params, output, Exec process, Agent, Include pipeline", with `AddFactory`, `CreateRecord`, `CreateFunction`, `AddInclude`, `UpdateParams`, `UpdateOutputs`.
- **`progress.md` Decisions:** the ADR, `CreateWorkflow`, `freshName`, the viewport amendment, the default names, the rollback, the new feature.

## 8. Evidence

- `nextflow-io/nextflow` `v26.10.7/docs/workflow-typed.mdx`: `/tmp/claude-0/-home-user-nf-builder/7eb86299-0303-577c-b405-f447f3050ce3/scratchpad/workflow-typed.mdx`.
- No local Nextflow run: no `.cache/nextflow/` in any checkout; task 1 runs the oracle.
