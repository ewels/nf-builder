# 0056. Make the app read-only below 1024 px with a width media query, canvas and details only, and refusals in the page's stores

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-04 says that below 1024 px wide the app is read-only: canvas and details only, with a note that editing needs a larger screen. ADR 0003 expects this, and ADR 0021 left the small-screen layout to F-703. Before this decision the shell had no narrow layout.

A probe of the production build in Chromium measured the problem:
- **At 390×844 with no project** the document is 713 px wide, so the page scrolls sideways. The left column is 256 px, the centre 161 px and the right 296 px. The header's actions alone take 415 px. At 320×640 the document is also 713 px wide.
- **At the boundary** `matchMedia("(min-width: 1024px)")` is false at 1023 px and true at 1024 px, with `innerWidth` equal to the viewport.
- **The header without its actions** still needs about 352 px, so it has to truncate and tighten at 320 px.
- **With a project open at 1440 px** the status bar needs at least about 455 px, the minimap is 200×150 px, every node is draggable, and the controls include Auto-layout.
- **React Flow 13.0.2** filters keyboard moves of selected nodes with the same rule as pointer drags, so `nodesDraggable={false}` turns off both.

Editing reaches the project through several paths: commands, undo and redo (ADR 0051), node moves and sidecar writes (ADR 0052), quick fixes (ADR 0054) and project create, rename and delete (ADR 0045). Hiding controls alone would leave keyboard shortcuts and later features able to write.

Research: the [F-703 plan](https://github.com/ewels/nf-builder/blob/ce092d7/docs/plan/handoff/plan-F-703.md).

## Decision

- **Detection.**
  - One media query, `(min-width: 1024px)`; the app is read-only when it doesn't match. 1024 px is editable and 1023 px is read-only, and fractional widths between them are read-only.
  - A `change` listener on the media query, not a resize listener. It fires only on a crossing, agrees with CSS, and measures the frame's own viewport inside an iframe (ADR 0044).
  - Width only: no pointer, height or user-agent checks. Browser zoom changes CSS pixels, so a desktop zoomed far enough turns read-only.
  - The value is read when the module loads, so the first render is already right and a phone never mounts the palette, the registry section or Monaco. With no `matchMedia` the app is editable.
- **State and transition.**
  - A vanilla Zustand store in `apps/web/src/read-only/` holds `{readOnly}`.
  - **Narrowing** first sends any pending Code-view edit (the canvas store's `flushEdits`, shared with undo and redo), then turns read-only if the window is still narrow, then closes an open project dialog. No timeout: each send settles. Text typed during the flush is refused but stays in the session's Monaco model and is sent again when the editor mounts on widening (ADR 0048).
  - **Widening** turns editable at once, cancels a narrowing still flushing, and restores the editing controls and each tab's view mode.
- **What read-only shows.**
  - The header with the app name, the project switcher (switching only) and the save state, plus the storage notice when present; the note; the workflow tabs; the canvas in Graph mode with Zoom in, Zoom out, Fit view and Port labels; the details column; the status bar.
  - **Not rendered**, so nothing loads and nothing stays focusable: the left column and separators; the header actions, including Export and the version select; the switcher's New, Rename and Delete; dialogs; the view-mode toggle and history controls; the Code pane and Monaco; the details header's Edit and Code; Auto-layout and the minimap; the problems panel's fix buttons.
  - Each tab keeps its stored view mode but is shown as Graph. A code-only file tab (ADR 0054) shows "This file opens in the code view on screens 1024 px or wider." and the code view stays unmounted.
  - Selection, details, pan, zoom, fit and switching projects and tabs still work. Activating a problem selects its node but never changes a tab's view mode or reveals code.
  - With no stored projects the switcher's panel reads "No projects in this browser."
- **Refusals in the page's stores.**
  - The canvas store's `send` queue refuses every command, undo, redo and quick fix with the new refusal code `read-only`, checked when the command runs. `moveNodes` and `save` return at once, so placements and Auto-layout results are shown but never written.
  - The project store's `create`, `rename` and `remove` throw before reaching the workspace; `open` is unchanged and still sets `openedAt` (metadata, ADR 0045). Import goes through `create`.
  - The engine's `EngineRefusalCode` gains `"read-only"`. It is type-only: the worker never returns it and no `EngineApi` method changes (ADR 0043).
  - The worker, the `nfBuilderEngine` test hook, view actions and autosave's flush are not guarded.
  - The refusal message is "Editing needs a larger screen or a wider window."
- **Writes.** Read-only writes nothing to the project. Positions placed on a read-only open stay in memory, and the sidecar is written at the next wide open.
- **Layout.**
  - A new `auto` shell row holds the note. It is 0 px high while editable, so no existing baseline moves.
  - From 640 to 1023 px the canvas and a fixed 296 px details column sit side by side; below 640 px they stack 3:2, canvas first. 640 px is a layout-only CSS breakpoint. The details column isn't collapsible, and the stored layout isn't touched.
  - The header and status bar wrap and truncate, so there is no horizontal page scroll down to 320 px with a project open, the storage notice shown and a 40-character project name. The canvas is excepted as two-dimensional content (WCAG 1.4.10).
- **The note.** "Read-only view: editing needs a larger screen or a wider window." It is not dismissible, sits in a polite `role="status"` region right after the header, and is first in reading order after the banner. When turning read-only removes the focused control, focus moves to the note.
- **Keyboard.** The view-mode and history shortcuts return before `preventDefault`, so the browser's own keys still work. Delete is already off, and arrow keys don't move nodes. Enter, Space and Escape still select and clear.
- **Touch.** React Flow pans with one finger and zooms with a pinch; a tap selects a node and shows its details.
- **Tests.** An end-to-end allow-list of visible controls (`READ_ONLY_ALLOWED`) fails when a later feature adds a control without read-only handling; each feature either hides it or adds it to the list in its own PR. One quick test is tagged `@smoke` so it runs on all three browsers. Two `@visual` baselines, `read-only-phone` (390×844) and `read-only-narrow` (1000×768), are approved from CI (ADR 0021).
- **F-202's multi-tab note** isn't UX-04: ADR 0045's last-write-wins per file stands for v0.1, with no Web Locks.

## Consequences

- A phone visitor can open a stored project and read it without loading the editor or about 900 kB of Monaco.
- Later features that edit go through the canvas store's queue or the project store and are refused for free; features that add controls must hide them with `useReadOnly()` or extend the allow-list, and CI checks that.
- **WCAG 1.4.4 (QA-10):** zooming to 200% on a 1280 to 2047 px screen gives a viewport under 1024 CSS px, so editing goes away. This is accepted for v0.1 as UX-04 states; F-701 decides on a session-only "Edit anyway" override.
- Export stays hidden in read-only for v0.1 (F-404 and F-406), even though it only reads.
- Edge types on touch, where there is no hover, are left to F-701; the palette and template prefetch still run on phones (F-702).

## Alternatives

- **Monaco with `readOnly: true` below 1024 px:** contradicts "canvas and details only", Split is unusable at 390 px, and the shared model would show a refused draft.
- **Creating projects from templates in read-only:** goes beyond "canvas and details only".
- **Allowing automatic placement writes:** shows "Saving…" on a view-only screen.
- **Always stacked, or a bottom sheet:** wastes width at 1000 px, or needs more code.
- **Keeping the minimap:** it takes half the canvas width at 390 px.
- **A worker-side `setReadOnly`:** would also block the test hook but changes ADR 0043's API.
- **A web-only refusal union:** ripples through the text sync and hook types.
- **Guarding before the flush on narrowing:** a pending edit would wait for the next wide visit and be lost on a reload.
- **Naming the threshold in the note:** longer, and the number means little to most visitors.
- **Resize listeners or user-agent checks:** fire on every resize, or misjudge frames, tablets and zoomed desktops.
