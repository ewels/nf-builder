# 0052. Store node positions in a layout sidecar owned by the engine, and place new nodes with ELK in its own worker

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

ADR 0008 keeps node positions in a sidecar, `.nf-builder/layout.json`, keyed by ADR 0036's node keys. Nodes with no stored position are placed by ELK. IO-02 asks for positions that persist and survive re-parsing, and UX-26 asks for auto-layout of all or selected nodes. F-205 shipped an interim layered layout until this feature (ADR 0046).

Node keys change when code changes: a call is renamed, or one of several identical calls is deleted. The positions therefore have to move with the nodes. Undo (ADR 0051) has to restore them exactly.

The engine owns file text and writes (ADR 0043, ADR 0045). ELK is a large GWT-compiled library.

Research: the [F-207 plan](https://github.com/ewels/nf-builder/blob/ce1c450/docs/plan/handoff/plan-F-207.md).

## Decision

- **Format v1.** The sidecar is `{ "version": 1, "nodes": { "<node key>": { "x": int, "y": int } } }`.
  - **Positions:** the top-left corner of each node in React Flow coordinates.
  - **Canonical text:** two-space indent, one entry per line, keys in UTF-16 order, integers (−0 written as 0) and a trailing newline.
  - **Reading is lenient.** Entries whose key isn't a valid node key, or whose coordinates are missing, non-finite or beyond ±1,000,000, are dropped. A notice says how many were dropped. Unknown fields aren't kept.
  - **Versions:** a file of a newer version is never written, and a notice says so. Older versions migrate through one step per version up to `LAYOUT_VERSION`, and a test checks that every step exists.
  - **Unreadable files** are replaced at the next save. A notice says so, first in the future tense and then in the past tense once replaced.
  - Positions are stored for every node of each workflow, written lazily per workflow, and pruned when nodes disappear.
- **Ownership.** The engine service is the only writer.
  - **`setLayout`:**
    - it takes `{path, workflow, revision, positions}` and validates the node ids and coordinates;
    - it refuses a write for an older revision as `stale`. The page re-sends a refused move once, after the next refresh, if its nodes still exist; otherwise it says the move couldn't be saved;
    - it doesn't advance the revision;
    - it neither records nor clears undo history.
  - **Commands and patches never touch the sidecar.** Commands that would change it are refused with a message, and so are patches.
  - **`writeFiles` of the sidecar** replaces the layout without carrying.
  - **Autosave:** the workspace records layout writes for autosave (IO-01).
  - **ADR 0043's API list** gains `setLayout`, `ProjectSummary.layout` and `ProjectionResult.positions`.
- **Carry.** On every change (a command, undo, redo or raw patches), the service matches the old projection of each tracked workflow to the new one and moves the keys with the nodes.
  - **Matching:** it pairs workflows, then nodes, in five passes: exact key, rename hint, name, kind and order, then whatever is left.
  - **Hints:** commands give hints.
    - A rename hint follows `renameDeclaration`.
    - A delete hint leaves the deleted node, and the unassigned nodes that only fed it, out of matching. The survivor of two identical calls therefore keeps its own position.
    - Undo passes the hints reversed, newest part first, with the step's deleted ids as inserted ones. Redo passes them as recorded, oldest first.
    - Rename chains within one group are composed.
    - History steps record these hints. `StepPart` gains `renames` and `deleted`, which amends ADR 0051.
  - **Removed positions:** these are remembered for the session, up to 500 entries, newest first per signature. Only an undo restores them, to the nodes its hints name, so the sidecar comes back byte for byte.
  - **Failures:** a carry error leaves the layout unchanged and never fails the command.
  - **Cost:** two projections per tracked workflow in each changed file.
- **Placement.** Nodes with no stored position are placed by ELK, with options checked against elkjs 0.12.1:
  - layered, left to right;
  - node spacing 24, layer spacing 64;
  - model order considered;
  - fixed port order;
  - takes and params first, emits and outputs last.
  
  Sizes are measured with port labels shown. Placed nodes stay where they are; new nodes go beside them without overlapping. A placement never overrides a move made while ELK was running.
  - **While ELK runs:** placed nodes keep drawing and "Laying out nodes…" is shown. On a first open with nothing stored, the canvas waits for ELK.
  - **Timeout:** after 30 seconds, or on a worker error, the worker is stopped and every call waiting on it is rejected. The layered layout of ADR 0046 is used, unsaved, with a notice, and the next call starts a new worker. This amends ADR 0046's interim clause: the layered layout is now the fallback.
- **elkjs 0.12.1**, pinned, is a runtime dependency of `@nf-builder/web` only.
  - **Licence:** EPL-2.0 OR GPL-3.0-or-later, used under EPL-2.0.
  - **Worker:** `elk-worker.min.js` is shipped unmodified as its own classic worker (475 kB gzipped), started on first use from the canvas chunk. `elk-api` is in a lazy chunk.
  - **QA-01 and CSP:** both stay outside QA-01. A 0.6 kB Rolldown runtime chunk enters the initial JavaScript because elk-api is CommonJS. ELK uses no `eval`, so the policy is unchanged.
  - **IO-41:** six URL entries are listed in `scripts/non-fetched-urls.ts`.
  - **Timings:**
    - In Node, `rnaseq-nf-typed` takes 70 to 190 ms.
    - Sarek's `PREPARE_GENOME` (224 nodes) takes 0.3 to 1.2 s.
    - Sarek's `SAREK` (173 nodes, 303 edges) takes 3.8 to 8.7 s under load.
- **UI.**
  - **Moving nodes:** drag, and arrow keys on a selected node, move nodes and save on drag stop and on each key press. Moves aren't undoable in v0.1 (ADR 0051). Node descriptions mention the arrow keys.
  - **Auto-layout:** a control lays out all nodes. Laying out the selected nodes arrives with F-310's multi-select.
  - **Notices** appear in the canvas's status region.
  - **Viewport:** a new projection, a port-labels toggle and a pane resize re-fit. A drag doesn't. Auto-layout re-fits once. This answers the F-206 and F-208 notes and ADR 0048's "F-207 may refine this".
  - **Background:** the screen-fixed dot grid behind React Flow's own grid is removed, and the canvas baselines are re-approved (ADR 0021).
  - **Edge routes:** ELK's routes are discarded, and React Flow draws its own curves, which can pass behind nodes.
- **Attribution.** ADR 0051 already corrects ADR 0039's attribution: history is F-209's and autosave F-202's.

## Consequences

- Positions survive edits, renames, deletes and undo, and a project exported with its sidecar keeps its layout.
- F-301 sets a dropped node's position with `setLayout` before the canvas refreshes, so ELK doesn't move it.
- F-310 switches on "Auto-layout selected nodes".
- F-404 can leave the sidecar out of an export.
- F-702 measures the carry on a project with a sidecar, and ELK on large workflows.
- Undoing a multi-part group restores positions as best it can: its hints carry no inserted ids, and redo's deleted ids for later parts refer to the group's intermediate states. F-301 and F-310 should keep groups that delete nodes to one part where they can.

## Alternatives

- **`writeFiles` for layout writes:** it would clear undo history on every drag and advance the revision.
- **Advancing the revision on layout writes:** every drag would invalidate pending commands.
- **ELK in the engine worker:** 475 kB in the worker everyone loads, and long layouts would block the engine.
- **ELK's interactive layering:** less predictable on small edits than placing only the new nodes.
- **Positions only in IndexedDB:** they would be lost on export and differ between copies of a project.
- **Keeping ELK's edge routes:** they would need recomputing on every move.
- **Mapping positions through patches:** patches don't know about nodes.
- **No timeout:** a stuck worker would leave the canvas waiting for ever.
