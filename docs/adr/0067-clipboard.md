# 0067. Select several nodes, delete them as one command, and copy and paste call nodes through a clipboard in the engine worker

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-26 asks for "marquee and shift-click multi-select, delete, copy and paste (within and across projects)" and auto-layout of selected nodes. Nothing in the spec says what a copy carries, where a paste lands, what happens to inputs fed from outside the selection, or how name and path conflicts are handled. AR-23 makes one user action one undo step, naming F-310. AR-30 keeps project content out of page stores. AR-21 lists `AddInclude` and `DeleteNode`; only `DeleteNode` existed, for one node.

Earlier decisions this builds on:
- ADR 0039: `DeleteNode` removes a statement and clears the arguments it fed; `AddCall` refuses a process the workflow already calls, and its message suggests `include { X as X_2 }`; Connect writes `x = P()`.
- ADR 0043: the engine runs in a worker behind `EngineApi`.
- ADR 0044: inside an iframe the async Clipboard API needs the embedder's `allow="clipboard-read; clipboard-write"`.
- ADR 0051 and ADR 0060: groups of parts are one undo step; a half-applied group is taken back with `undo(revision, {discard: true})`.
- ADR 0052: commands never touch the layout sidecar; positions go through `setLayout` and the carry; a one-part step that deletes passes its deleted ids to undo, so positions come back.
- ADR 0055: `CreateFile` writes an empty file.
- ADR 0056: read-only mode below 1024 px refuses changes.
- ADR 0064: Disconnect after a Connect that wrote `x = P()` leaves `x` assigned and unread, which lint reports.

The async Clipboard API works only in a secure context, needs permissions in frames, prompts or shows a paste menu on read in Chromium, Firefox and Safari, and would make the copied text a new exported format that other tabs and versions read.

Research: the F-310 plan (deleted in the PR that merged F-310; settled in `docs/plan/handoff/README.md`, "F-310", which accepts every recommendation of its section 6). Every Nextflow form below was checked with the pinned 26.10 dist through oracle cases `f310-copy-source`, `f310-paste-across`, `f310-paste-alias`, `f310-delete-start`, `f310-delete-multi` and `f310-delete-unread`.

## Decision

- **Selection** (UX-26, UX-30). The canvas store keeps `selection`, the node ids of the active tab in the order they were picked, alongside the single `selected`, which is the one node when exactly one is selected and null otherwise. F-206's readers of `selected` are unchanged. Shift-click (also Meta and Control) adds or removes a node, and Shift-drag draws a marquee with partial selection (React Flow 13.0.2: `multiSelectionKeyCode`, `selectionKeyCode` and `SelectionMode.Partial`). Node and edge selection are exclusive (ADR 0064). With several nodes, the details pane shows "N nodes selected", each node's label and kind as a button that selects it alone, and Copy and Delete. A single node's details also get Copy and Delete. With nothing selected and a non-empty clipboard, the workflow summary offers "Paste N nodes".
- **`DeleteNodes`** (AR-21, extends ADR 0039). `{kind: "deleteNodes", target, nodes}` resolves every id against one projection, clears the arguments the deleted nodes fed (except arguments of other deleted nodes), removes the statements and reprints the declaration once. It is one part, so one undo step whose undo restores positions (ADR 0052). It refuses as `DeleteNode` does, naming the first node that can't go. `DeleteNode` now delegates to it with one node. Labels: "Delete node" for one, "Delete N nodes" for several.
- **Unread assignments** (amends ADR 0039 and ADR 0064). After `DeleteNodes` and after `Disconnect`, an assignment `x = P(...)` whose name was read before the command and is read nowhere in the declaration afterwards becomes the bare call `P(...)`. Reads include closures and string interpolations. Only names the command made unread are touched, and only when the right-hand side is a call of a process or workflow. Other right-hand sides are left as written.
- **Clipboard in the engine worker** (amends ADR 0043's API list). `EngineApi.copy(request)` puts the selected call nodes of a workflow on a clipboard held in the worker, replacing it; `clipboard()` returns its summary (`nodes`, `connections`, `labels`, `languageVersion`) or null. The clipboard is keyed by the numeric id of the open it was copied from, survives `close` and the next `open`, and dies with the worker. The page store holds the summary only, never file text (AR-30). This works in every context and frame without permissions (ADR 0044) and adds no exported format. The system clipboard is not used; copying across browser tabs is a later option that would need its own ADR.
- **What a copy carries.** Process and workflow calls only. Operator, factory, chain and code nodes are refused by name ("X can't be copied yet: only process and workflow calls can."); copying them is a separate feature. For each copied call, the fragment holds:
  - the definition's file, and transitively every project file it includes;
  - for a `main.nf` under `modules/` or `subworkflows/` (two or more folders deep, so `modules/main.nf` doesn't count), the rest of its directory, such as `meta.yml`, `environment.yml` and `templates/`;
  - the connections whose both ends are copied, by port id; connections to other nodes are dropped, and inputs fed from outside the selection are left unconnected;
  - each node's offset from the selection's top left.

  Limits: 1 MB per file (IO-12), and 200 files and 5 MB per copy; above them the copy is refused. A callee from a plugin or pipeline include, or one not defined in a project file, is refused.
- **Paste.** `planPaste({target})` returns the aliases a paste needs: `called` for a process the target workflow already calls (ADR 0039), and `taken` for a name already bound to another definition in the target file. If there are any, the page asks once: "Paste with new names?", listing each one ("MAKE is already called in this workflow. It will be included again as MAKE_2."), with Paste and Cancel. `paste({target, aliases, at}, revision)` then runs in the worker as one undo step labelled "Paste N nodes", under one group:
  1. `CreateFile` with text for each fragment file the target lacks. A file already present with identical text is reused; one with different text refuses the paste.
  2. `AddInclude` for each definition not already bound under the name it will use, for example `include { MAKE as MAKE_2 } from './modules/local/make/main.nf'`.
  3. `AddCall` per node, under its alias if it has one.
  4. `Connect` per copied connection, with node ids re-resolved after each part.

  A definition that lived in the copied workflow's own file can be pasted only into that file; elsewhere the paste is refused with "Move X to its own module to copy it." A fragment copied from another language version is refused. Any refused part discards the group (ADR 0060), and the refusal ends "Nothing was changed."
- **Positions** (amends ADR 0052). The pasted nodes' positions (`at` plus each offset, `at` being the pointer's flow position when the paste key is pressed over the canvas, or the canvas centre) are written through the layout path (`setLayout` and the carry) before the change is announced, so they are drawn in place. Commands never touch the sidecar. Undo drops the pasted keys through the carry. Redo of a paste lets ELK place the nodes again, which is accepted for v0.1.
- **New commands** (amends ADR 0055). `AddInclude {caller, name, alias, source}` adds `include { name }` or `include { name as alias }` at an item boundary, and refuses a name or alias already bound, a source outside the project and a caller with top-level statements; labels "Include X" or "Include X as Y". `CreateFile` takes an optional `text`; without it the file is empty, as before.
- **Keys** (UX-70). Delete and Backspace delete the selected nodes when no edge is selected (edge keys stay in `edge-keys.ts`, ADR 0064). Ctrl+C and Ctrl+V, ⌘C and ⌘V on Apple platforms, copy and paste while a workflow canvas tab is active. Keys are ignored in text fields, Monaco and dialogs, and the copy key yields to a non-empty text selection. A polite live region says "Copied N nodes.", "Pasted N nodes and M connections.", "Deleted N nodes." or the refusal.
- **Read-only** (ADR 0056). Copy is allowed, since it writes nothing to the project. Delete and paste are refused without calling the engine, their keys are inert, and the Copy, Delete and Paste buttons are not rendered, so `READ_ONLY_ALLOWED` is unchanged.
- **Auto-layout selected nodes** (ADR 0052, F-207) is reachable now. `placeNodes` lays out and saves only the selected nodes.

## Consequences

- UX-26's copy and paste "across projects" works within one browser tab, in any frame and without permissions. It doesn't reach another tab or survive a reload.
- Deleting or disconnecting no longer leaves an unused-variable warning behind for call results.
- Pasted modules keep their nf-core layout. A different file at the same path blocks the paste instead of overwriting it.
- `deleteNode` and `deleteNodes([node])` give the same bytes (unit test on the f111 fixtures).
- The edit property harness adds `removeConfigPlugin` before `addConfigPlugin` in its fixed examples, because the new kinds shifted the seeded choices so the fixed example picked a plugin the config already declared, which is refused. No assertion changed.
- Checked by `e2e/clipboard.spec.ts`, the F-310 test in `e2e/layout.spec.ts`, the oracle cases above with engine goldens, and unit tests in `packages/engine/test/{edit,clipboard,service,history,layout}/` and `apps/web/test/`.

## Alternatives

- Async Clipboard API: secure context and frame permissions only, read prompts, and a new exported format.
- Also writing JSON to the system clipboard from `copy` and `paste` DOM events for cross-tab use: an exported format; kept as a later option.
- Reconnecting inputs fed from outside the selection by keeping the original argument text: the references are often invalid in the target.
- Copying operator, factory and code nodes as expression text now: rewiring channel names is much more work; split into its own feature.
- Copying into suffixed directories (`make_2/`) or extracting inline definitions into new modules: more moving parts than refusing.
- Pasting silently under aliases, or refusing: the user should see the new names before they are written.
- Page-side paste orchestration (as F-301's palette add): one worker call announces one change and keeps the file text in the worker.
- A separate internal command for files with text instead of `CreateFile`'s optional `text`: two commands for one operation.
