# 0060. Add palette items as grouped commands with fresh names, positions set before the first draw, and the viewport kept

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-15 says palette items are added by drag and drop onto the canvas, or by focusing an item and pressing Enter, which places it at the viewport centre. LA-12 says a new process or named workflow goes in its own typed file with an include in the calling script. AR-21 lists `CreateWorkflow`, but only `CreateProcess` and `AddCall` existed (ADR 0039). Before this decision palette rows were non-focusable list items with a `title` tooltip (F-204).

The spec doesn't name a new definition, say what happens when an add fails halfway, or where focus goes afterwards. ADR 0052 re-fits the viewport on every new projection, which would move a dropped node away from the drop point, and expected F-301 to set a dropped node's position before the canvas refreshes. ADR 0051 groups several commands into one undo step, but undoing a group leaves a redo step, so a rolled-back half add could be redone. Only the engine worker holds the project model (AR-30), so the page can't pick a free name itself. F-703 (ADR 0056) had merged when F-301 started, so adds must respect read-only.

No other palette item has a command yet: AR-21's `AddFactory`, `AddChain`, `CreateRecord`, `CreateFunction`, `AddInclude`, `UpdateParams` and `UpdateOutputs` don't exist, and no feature owned adding factories, records, enums, functions, includes, params, output, Exec process, Agent or Include pipeline from the palette (F-308 owns operators dropped on edges only).

Research: the [F-301 plan](https://github.com/ewels/nf-builder/blob/6dcbd39/docs/plan/handoff/plan-F-301.md).

## Decision

- **Which items add.** A pure engine function `paletteAction(item)` maps Process to `{kind: "process"}` and Workflow to `{kind: "workflow"}`; every other item gives `null`. Items with no action stay focusable, so keyboard users can read their description, but are `aria-disabled`, not draggable, and Enter says "<Label> can't be added from the palette yet." The other items move to a new feature, F-314.
- **`CreateWorkflow`** (amends ADR 0039 and AR-21). `{kind: "createWorkflow", name, caller}` is the twin of `CreateProcess`: one shared `createDefinition` makes the same checks with "workflow" in place of "process", writes `subworkflows/local/<lower>/main.nf` and includes it as `<rel>/subworkflows/local/<lower>/main.nf`. Its history label is "Create workflow <name>".
- **`Scaffold.workflow(name)`** (amends ADR 0039's pack interface). The 26.10 pack writes `nextflow.enable.types = true\n\nworkflow NAME {\n}\n`, with no doc comment, so F-312 can still suggest one. The typed-workflow docs don't show an empty named workflow verbatim; the evidence is oracle case `f301-palette-adds` (lint clean and `run -stub`, in CI's `oracle` job) and the blank template's entry workflow `workflow {\n}`, which already lints clean and stub-runs (`template-blank`).
- **Fresh names** (amends ADR 0043's API list). `EngineApi.freshName({kind, caller})` returns `{revision, name, path}` or a refusal. The name is `NEW_PROCESS` or `NEW_WORKFLOW`, then `_2`, `_3` and so on, skipping a name that is in the caller's scope, is a builtin, or whose lower-cased directory already holds any path. Renaming is F-303's Configure tab; there is no name dialog.
- **One add, one task.** The canvas store's `addFromPalette({item, tab, at}, session)` runs as one queued task, so no Code-view flush or other apply interleaves:
  - it refuses up front, calling no engine method, with no project or a changed session ("Open or create a project to add components."), in read-only (ADR 0056's "Editing needs a larger screen or a wider window."), on a file tab ("Open a workflow tab to add components to it.") and for an item with no action;
  - it asks for a fresh name, then applies the create command and `AddCall` under one `group` token `palette-<session>-<counter>` (not `crypto.randomUUID()`, which needs a secure context, ADR 0044), labelled "Add process NEW_PROCESS" or "Add workflow NEW_WORKFLOW";
  - on success it selects the new node, and the palette calls `filesStore.reveal(path)` without switching the left column to Files.
- **Rollback without a redo step** (amends ADR 0043's API and ADR 0051's history rules). `EngineApi.undo(revision, options?)` takes an optional `{discard: true}` that undoes the newest step and leaves no redo entry. When `AddCall` is refused, or throws, after the create was applied, the store undoes the half add with `discard`, so a failed add changes no file and Redo can't bring it back. The message is "Couldn't add <name>: <reason> Nothing was changed." Plain `undo(revision)` is unchanged.
- **Placement before the first draw** (as ADR 0052 expected). A drop gives the flow point under the pointer (`screenToFlowPosition`); Enter gives the centre of the mounted canvas through a viewport bridge, `registerViewport` in `apps/web/src/canvas/viewport.ts`, since the palette sits outside the React Flow provider. The store records a pending placement for the new node's key (`<path>#<workflow>/<NAME>@1`, ADR 0036). The `load` that first sees the key puts the node's centre on the point, using `canvasView`'s estimated size rounded to whole pixels, in the same update as the projection, and saves it with `setLayout`. ELK never places it. With no mounted canvas (a workflow tab in Code mode) the point is null and ELK places the node.
- **Viewport kept** (amends ADR 0052's viewport rule). An `addsPending` counter counts palette adds in flight; every view loaded while it is above zero, the intermediate one after the create included, carries `refit: false`, so the canvas keeps its viewport. Any other new projection still re-fits.
- **Pointer and keyboard.** Each palette row holds a native `<button>` that is tabbable when its category is open, draggable, and described by a visually hidden span (the `title` stays for the mouse). Enter and Space add; focus stays on the item so repeated adds work by keyboard. A drag carries the custom MIME type `application/x-nf-builder-palette` (`PALETTE_MIME`, with `hasPaletteDrag`), `effectAllowed = "copy"`; the canvas accepts only drags carrying it, and F-210's document drop guard still acts on `Files` drags only. Roving tabindex is left to F-701's audit.
- **Feedback.** One `aria-live="polite"` region in the palette panel (not `role="status"`, which F-204's test finds by role) says "Added process NEW_PROCESS to the entry workflow." or "… to workflow <NAME>.", or the refusal. A message equal to the last one gets a trailing no-break space, so screen readers announce a repeat.

## Consequences

- A user can build a pipeline's skeleton from the palette with the mouse or the keyboard, and every add is one undo step that restores exact bytes (AR-23).
- Step 3 is checked without F-404: the e2e test and the engine golden test compare the project's files after both adds with oracle case `f301-palette-adds` byte for byte, and CI lints and stub-runs that case. F-404 repeats the check on an exported zip.
- F-308 reuses `PALETTE_MIME`, `hasPaletteDrag` and the viewport bridge, and needs an edge hit test of its own. F-310 reuses the group-and-discard rollback. F-314 adds the remaining items through the same `paletteAction` switch.
- `discard` is the only way history loses a step besides a new apply clearing redo and file adds clearing everything (ADR 0055); it is used only for rollbacks the user never saw succeed.
- No stored or exported format changes: the layout sidecar is written as before. No runtime dependency, package boundary or dependency-cruiser rule changes. No visual baseline moved.
- Re-including an existing process under an alias (F-111's note) is not done here: F-301 always creates a new definition; the note moves to F-310 and F-504.

## Alternatives

- **Adding only Process and Workflow with the other items hidden:** keyboard users would lose their descriptions, and the palette would differ from UX-12.
- **A name dialog before each add:** an extra step on every drop; F-303 renames.
- **Choosing names on the page:** the page has no model (AR-30).
- **Leaving a half add for the user to undo:** a refused add would leave a module and an include behind.
- **Plain undo for the rollback:** leaves a redo step that brings back a half add.
- **Re-fitting after an add, or keeping the viewport only for the final view:** moves the node away from the drop point, or jumps once on the intermediate view.
- **Letting ELK place the node and moving it after:** the node would be drawn twice and could jump.
- **`text/plain` drag data:** any text drag would look like a palette drag.
- **Roving tabindex now:** more code for a keyboard model F-701 audits anyway.
