# 0049. Show node details from the projection on the main thread, with declarations and diagnostics from the worker

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

UX-30 asks for a node's details when it is selected: summary, inputs and outputs with types and connections, key directives, a script preview and its diagnostics. UX-31 asks for a workflow summary when nothing is selected, and UX-24 for the selected node's edges to be highlighted. AR-31 keeps components presentational, and AR-30 keeps file text out of the main-thread store. The projection is already on the main thread (ADR 0046), but declarations, directives and scripts are in the worker's syntax trees (ADR 0043, ADR 0045). Research: the [F-206 plan](https://github.com/ewels/nf-builder/blob/f3cfc1c/docs/plan/handoff/plan-F-206.md).

## Decision

- **Split.**
  - `nodeView` and `workflowSummary` (`packages/engine/src/details/`) work from the projection on the main thread: titles, kinds, ports with types and connection text, and the summary's parameters, outputs, takes, emits, calls and registry modules.
  - `EngineApi.details(path, workflow, nodeId)` runs in the worker and returns the node's declaration details and diagnostics. This amends ADR 0043's API list.
- **AR-30 reading.** `details` returns excerpts, never a whole file:
  - a preview of at most 8 lines, each cut at 200 characters;
  - directive and topic values cut at 60 characters;
  - the node's own diagnostics.
  The canvas store holds the selection and these excerpts only.
- **Selection.**
  - Only one node is selected at a time: no multi-select or marquee, and edges can't be selected. Keyboard selection uses React Flow's Enter and Space, and Escape clears.
  - The selection clears when the project, workflow or tab changes, when the node is gone, and when the file stops parsing. It is kept across a refresh after an engine change, and its details reload.
  - A details answer for an older selection or revision is dropped.
  - Selecting keeps the viewport. A refresh or a port-labels toggle re-fits, as in ADR 0046.
- **UX-24 highlight.** The selected node gets an outline. Its edges are drawn in the accent colour, about 3 px wide, painted after other edges but below every node. Mismatch red (F-302) will take precedence over it.
  - React Flow 13 marks edges that are neither selectable nor clickable as `inactive`, with `pointer-events: none`. `canvas.css` restores `visibleStroke` so F-205's edge tooltips still work.
- **UX-30 readings.**
  - **Description:** the doc comment's text before its first tag. F-311 takes over with the comment parser. For a catalogue callee, it is the first paragraph of the catalogue description; unknown operators are marked "legacy".
  - **Key directives:** every directive in source order.
  - **Script preview:** the first 8 lines of the script, shell, exec or body, dedented, with "Showing the first lines only" when cut.
  - **Diagnostics for that node:** the diagnostics whose range falls inside the node's call or declaration. A clean node says "No problems found", not the mockup's "Valid for Nextflow 26.10" (ADR 0042 reports lint results, not validity).
- **UX-31 reading.**
  - The entry workflow has no takes or emits. It lists Parameters and Outputs instead, each when it has any.
  - A named workflow lists Take and Emit, with "None" when empty.
- **UX-32 reading.** Edit and Code show, disabled, while a node is selected; F-303 and F-304 enable them.
- **Colour tokens.** `--color-warning` (#8a5300) and `--color-suggestion` (#1f5f8b) give 5.85:1 and 6.33:1 on the details column's background (QA-13). Every problem also carries a word, so colour is never the only cue (QA-12).

## Consequences

- The pane renders immediately from the projection, and the worker fills in declarations. Reprojecting per click takes 10 to 38 ms on sarek's largest workflow, unthrottled (F-702 measures it).
- F-303, F-304 and F-309 extend the pane: the Edit popup, the Code jump, and problem actions.
- The engine's public API exports only the main-thread view functions and the data types. Worker-side helpers stay internal.

## Alternatives

- **Everything from the worker:** a round trip before anything shows, for data the main thread already has.
- **Everything from the projection:** the projection carries no declarations or scripts, and adding them would put file text on the main thread.
- **Multi-select now:** no feature needs it yet; F-303 and F-702 can revisit.
