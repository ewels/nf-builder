# 0068. Open workflow definitions in tabs with a navigation breadcrumb, and add takes and emits without editing call sites

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-50 asks that opening a workflow node opens or focuses a canvas tab for its definition, with a breadcrumb from the entry workflow and back navigation. UX-51 asks that adding, removing or renaming takes and emits updates the ports of every call site. UX-40 makes workflow nodes the exception to the edit popup: double-click opens the workflow in a canvas tab. AR-21 lists `AddTake` and `AddEmit`. F-307's steps ask for opening, adding a take and breadcrumb back navigation; removing and renaming are not among them.

No spec text says what the breadcrumb shows when a workflow tab is opened other than from a canvas, what a new take's or emit's type and value are, what happens to call-site arguments, or which workflow tabs can be closed.

Earlier decisions this builds on:
- ADR 0043: the engine runs in a worker behind `EngineApi`, with a fixed list of calls.
- ADR 0046: the canvas is React Flow 13, with view logic in the engine; `zoomOnDoubleClick` was left at its default (on).
- ADR 0055: code-only file tabs close with Delete (`aria-keyshortcuts="Delete"`) and a pointer-only `aria-hidden` ×; "workflow tabs stay F-307's".
- ADR 0056: read-only mode below 1024 px refuses changes, and every visible control must be listed in `READ_ONLY_ALLOWED`.
- ADR 0066: double-click or Enter on an already selected node opens the edit popup; `popupTarget` returns `{kind: "workflow"}` for a workflow call and the popup does nothing with it.
- ADR 0039: commands reprint whole declarations; AR-22 keeps other declarations equivalent.

Behaviour checked with the pinned 26.10.7 dist:
- A new take with call sites left at the old arity: lint error "Workflow `ALIGN` expects 2 argument(s) but received 1", and the run fails to compile. Padding the call with `null` is lint clean but silently passes `null` at run time.
- `take:` with nothing after it is a parse error; `take:` followed by `main:` or `emit:` parses.
- A new emit `name: Channel<T> = null`, `name: Value<T> = null` or legacy `name = null` lints clean and stub-runs; with no value it is "not defined".
- Going from one emit to two breaks every caller that reads the single output directly (`x.view()` on a record; `x.bam` with one emit).
- An emit named `log` passes lint and fails the run with "No such variable: log" (`docs/research/upstream-bugs.md` #27).

Research: the F-307 plan (deleted in the PR that merged F-307; settled in `docs/plan/handoff/README.md`, "F-307", which accepts every recommendation of its section 6). Oracle cases `f307-workflow-tabs`, `f307-add-take`, `f307-add-emit`, `f307-add-emit-legacy` and `f307-add-emit-legacy-unnamed`.

## Decision

- **Opening a workflow** (UX-50, UX-40). One `openNode` handler serves double-click and Enter on an already selected node: a call of a resolved workflow or pipeline opens or focuses its definition's canvas tab; any other node opens F-303's popup. A selected workflow call node carries a hidden description, "Press Enter again to open this workflow". Opening works in read-only. A callee that can't be opened (unresolved, plugin, unparsed, a process) sets a canvas notice saying why, and nothing opens.
- **Engine calls** (amends ADR 0043's API list). `EngineApi.calleeWorkflow({path, workflow, node})` returns the definition's `WorkflowRef`, resolving aliases (`include { ALIGN as MAP }` opens `ALIGN`) and a pipeline call to its file's entry workflow, or a `not-found` refusal with the reason. `EngineApi.callPath(ref)` returns the shortest call path from the project's default workflow to `ref` (breadth first over call nodes, with a visited set), empty for the default workflow itself and for one it doesn't reach. Neither changes the projection type, so no projection snapshot moves.
- **One default-workflow rule.** The engine's `defaultWorkflowRef` (the entry workflow of `main.nf`, else any entry workflow, else the first workflow) picks the tab a project opens with, the root of `callPath` and the one tab that can't be closed.
- **Breadcrumb** (UX-50). Every workflow tab keeps a session-only trail of ancestors. Opening from a canvas appends the caller's tab to the caller's own trail (re-opening from another parent replaces it). Opening any other way (Files, the problems panel, `openPath`, the test hook) takes the trail from `callPath`. Renames carry and rename crumbs; a crumb whose workflow is gone is dropped. Above the canvas of every workflow tab, `<nav aria-label="Workflow path">` lists each ancestor as a button that opens or focuses its tab, then the current workflow with `aria-current="page"`. The entry crumb is labelled with its file name, a named workflow with its name. It is shown in read-only.
- **Closing workflow tabs** (amends ADR 0055). Workflow tabs close like file tabs, with Delete (`aria-keyshortcuts="Delete"`) and the pointer-only ×, except the default workflow's tab. Closing the active tab keeps F-210's rule (previous, else next).
- **Double-click on the pane** (amends ADR 0046). The canvas sets `zoomOnDoubleClick={false}`, so double-clicking a node doesn't move the viewport before the tab switches. Zoom keeps its buttons, wheel and keys.
- **`AddTake`** (AR-21). `{kind: "addTake", target, name, type}` appends `name: Type` (typed) or `name` (legacy) to `take:`, creating the section when absent, and reprints the declaration. Call sites are not edited: each call gains the new unfed input port through the projection, and Nextflow's arity error at each call site tells the user to connect it. Padding with `null` was rejected because it lints clean and passes `null` at run time, and touches other files.
- **`AddEmit`** (AR-21). `{kind: "addEmit", target, name, type}` appends `name: Type = null` (typed) or `name = null` (legacy) to `emit:`, creating it when absent. It is refused when the workflow has exactly one emit ("X's only emit is read directly at its call sites; adding a second one would break them."), and for the name `log` (upstream bug #27).
- **Shared refusals.** Both commands refuse the entry workflow, an invalid identifier, a name already used in the workflow, a Nextflow built-in, a type on a legacy workflow, no type on a typed workflow, and a type text that doesn't parse. `AddTake` also refuses a body with neither `main:` nor `emit:` ("Add a step or an emit to X first; Nextflow needs one after take."). Labels: "Add take N to WF", "Add emit N to WF".
- **Forms** (UX-31, UX-51). The workflow summary in the details pane gets Add take and Add emit buttons that open an inline form (Name, and Type for typed workflows), with refusals shown as alerts and success announced ("Added take index to ALIGN."). The forms are hidden for the entry workflow, for files without type information and in read-only.
- **Removing and renaming** takes and emits, and the workflow Configure popup (UX-46), are a separate feature (F-316).
- **Tests.** The edit property harness gives `addTake` a multi-step prelude (`createWorkflow`, then `addEmit`) so the new workflow has something after `take:`.

## Consequences

- Adding a take leaves every caller with a lint error until it is connected; the problems panel lists each call site. This is deliberate: the alternative hides a `null` argument.
- A workflow with one emit can't gain a second from the UI until a feature rewrites its direct readers.
- The breadcrumb row shortens the canvas pane, so 21 visual baselines (canvas node kinds, `canvas-rnaseq-nf-typed-*`, `connect-mismatch`, `template-hello-world`, `read-only-phone` and `view-modes-split*`) were re-approved from the CI artifact (ADR 0021).
- Double-click on the empty pane no longer zooms.
- Checked by `e2e/workflow-tabs.spec.ts` (all three steps, the Enter route, an aliased call, read-only and CSP), the oracle cases above with engine goldens in `packages/engine/test/edit/oracle-goldens.test.ts`, and unit tests in `packages/engine/test/{edit,navigation,canvas,service,history}` and `apps/web/test/`.

## Alternatives

- **Projection field for the definition** (`Callee.definition`) instead of `calleeWorkflow`: a lang-core type change that regenerates every projection snapshot.
- **Breadcrumb of only the current workflow** when not opened from a canvas: no engine call, but a weaker reading of "the path from the entry workflow".
- **Pad call sites with `null` on AddTake**, or **rewrite single-emit readers to `x.<emit>`** on AddEmit: multi-file edits that hide data-flow changes or grow the command.
- **"+" buttons beside the pills on the canvas**: more chrome on the canvas and more baselines.
- **Every workflow tab closable**: leaves "No files open" with the project's home tab gone; the breadcrumb root reopens it anyway, so keeping it was simpler.
