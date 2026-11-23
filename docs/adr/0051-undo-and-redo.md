# 0051. Keep undo and redo history in the engine worker, one step per command

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

AR-23 makes every command one undo step that restores exact bytes. UX-70 asks for platform undo and redo shortcuts. Commands already return patches and their inverses (ADR 0039). File text lives in the engine worker (AR-30, ADR 0043), and projects autosave from there (ADR 0045). ADR 0039 said history was F-207's, but it is F-209's, and autosave is F-202's. Several later features, such as F-301 and F-310, will apply several commands for one user action, and those must undo as one step. Research: the [F-209 plan](https://github.com/ewels/nf-builder/blob/990b3e9/docs/plan/handoff/plan-F-209.md).

## Decision

- **History in the worker.**
  - The engine service keeps the history of the open project.
  - `EngineApi` gains `undo(revision)`, `redo(revision)` and `history()`. `apply(command, revision, options?)` takes `{group, label}`.
  - Every change result carries `history: {undo, redo, undoCount, redoCount}`, where `undo` and `redo` are labels.
  - A new refusal code, `no-history`, reads "There is nothing to undo." or "There is nothing to redo.".
  - This amends ADR 0043's API list.
  - `applyPatches` becomes a raw write that clears the history. That replaces the F-113 note's "undo by applying the inverse patches".
- **Steps.**
  - Each applied command is one step, labelled from the command (for example "Add call to ALIGN").
  - Commands applied under the same `group` token are one step. A group is a sequence of parts, not concatenated inverses, because `applyPatches` refuses two patches to one path.
  - A refusal or a no-op command doesn't close an open group. Undo, redo and any other apply do.
  - Undo applies a step's inverses newest first, and redo its patches oldest first. Each advances the revision once.
  - A stale undo or redo is refused like a stale command, with no retry.
  - A patch that no longer applies refuses with `internal` and clears the history.
- **Clearing and limits.**
  - Raw writes (`writeFiles`, `applyPatches`), opening or closing a project, and a throw after a write has started all clear the history.
  - It keeps at most 100 steps and 8,000,000 UTF-16 code units of patch text, dropping the oldest first. A single step over the limit is still kept.
  - It lives in memory only, so a reload starts empty.
- **Autosave.** Undo and redo go through the workspace's change path, so they autosave like commands (IO-01).
- **The page.**
  - The canvas store holds only the history labels and counts (AR-30).
  - One queue runs apply, undo and redo in order.
  - Before an undo or redo, the store flushes pending Code-view text.
  - Undo and redo capture the project session when they are pressed, so a press can't act on a project opened in the meantime.
  - A failed worker call gives a notice, not an unhandled rejection.
- **Shortcuts (UX-70).**
  - Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y; ⌘Z and ⇧⌘Z on Apple platforms. ⌘Y is left alone, because it is Safari's History shortcut.
  - The shortcuts don't fire in text fields, the code editor or dialogs. Monaco keeps its own undo, and a Monaco edit becomes an "Edit <path>" step once it is sent.
- **Controls.** Undo and Redo buttons sit in the tab strip in every view mode. Their titles name the step and the shortcut. A live region that stays mounted announces "Undone: …" and "Redone: …".
- **Node moves** (F-207) are not undoable in v0.1 and stay out of the history.
- **Test hook.** `window.nfBuilderWorkspace.apply` now takes `(command, options?)` instead of `(command, session?)`, and the hook gains `history()`.

## Consequences

- F-301 and F-310 apply several commands under one `group`, so a partial group rolls back with one undo. F-303's Apply is one command or one group. A quick fix from F-309 is one `ReplaceFileText`, so it is one step.
- F-210's raw writes clear the history.
- F-304's popup editor keeps its own undo, and it must register its flush with the store.
- F-207 carries layout keys on undo and redo too. A move is never a step.
- The tab-strip baselines are re-approved because the controls appear there (ADR 0021).

## Alternatives

- **History on the main thread:** it would hold file text in the UI (AR-30).
- **Concatenated inverses for a group:** `applyPatches` refuses two patches to one path.
- **Undoable raw writes:** imports and uploads replace whole files, and a step that size would crowd out everything else.
- **React Flow's own controls:** they know nothing of file edits.
- **Retrying a stale undo:** it could undo something other than what the user saw.
- **Keeping history across a reload:** a stored format for little gain.
