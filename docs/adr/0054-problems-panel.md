# 0054. List problems in a panel pulled per revision, apply quick fixes through the engine, and open files in code-only tabs

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

UX-03 asks for problem and suggestion counts in the status bar. LA-30 to LA-36 ask for problems to be listed with their locations and quick fixes. ADR 0042 makes quick fixes text edits that go stale once their file changes. Diagnostics are computed in the engine worker (ADR 0043), and file text stays there (AR-30). Undo comes from ADR 0051, the Code view from ADR 0048 and the details pane from ADR 0049.

Some problems sit in files with no workflow, such as modules or configs. Reaching them needs a tab that shows code only. UX-20 already says that tabs hold open files.

Research: the [F-309 plan](https://github.com/ewels/nf-builder/blob/6291f4e/docs/plan/handoff/plan-F-309.md).

## Decision

- **Pulling diagnostics.**
  - The page pulls the whole project's diagnostics once per revision, after the projection, with one pull in flight at a time.
  - A result for an older revision or another project is dropped, and the next change pulls again.
  - The page keeps a read-only copy with no file text.
  - Cost: about 215 ms of worker time per change on sarek. Carrying results over between revisions would need a rule for transitive dependants, so it is left to F-702.
- **Panel.**
  - It sits at the bottom of the centre column. It is closed by default, has a fixed height, and its open state lasts for the session only, so there is no stored format.
  - It has two tabs, Problems (errors and warnings) and Suggestions.
  - Rows are grouped by file in path order. Errors come before warnings, then source order. There is no collapsing.
  - Refused Code-view drafts (ADR 0048) are neither listed nor counted.
- **Status bar (UX-03).**
  - "Problems" counts errors plus warnings.
  - With a project open, both counts are buttons that open and close the panel on their tab.
  - Before the first result the bar reads "Checking for problems…", and on a failure "Problems unavailable", with the reason reachable by keyboard.
  - With no project the counts are plain text.
  - On a file tab the node and channel counts are hidden.
- **Quick fixes.**
  - `EngineApi.applyFix(fix, revision, options?)` applies a fix's text edits through the same guards and history path as a command. It is one undo step labelled with the fix's title. It refuses with `stale`, `not-found`, `invalid`, `does-not-parse` or `no-project`, and it never retries automatically. This amends ADR 0043's API list.
  - Staleness is per file. A fix computed at revision R applies only if its file hasn't changed since R and R isn't from before the project was opened. This clarifies ADR 0042's "stale once the file changes".
  - The page flushes pending Code-view text before it queues a fix.
  - Fix edits are capped at 64 characters (AR-30), and a test over the pack's lint fixtures enforces the cap.
- **Navigation.** Activating a problem:
  - selects and centres its node when it lies inside one;
  - otherwise shows the code at the problem, in Split for a Graph tab or in a file tab for a file with no workflow.
  
  Focus stays in the panel. The details pane links a node's problems to the panel.
- **Code-only file tabs (UX-20).**
  - `openFile(path)` opens a tab with id `file:<path>` that shows the file in the Code view only.
  - The tab has no view-mode toggle, and G, S and C do nothing on it. It is labelled with the file name, or the last two segments for `…/main.nf`.
  - A `.nf` file with a workflow opens that workflow's canvas tab instead.
  - A file tab closes when its file is deleted.
  - F-210, F-605 and F-601 reuse `openFile`.
- **Step 2.** "The suggestion disappears" is read as "the diagnostic disappears". `deprecated-channel` is an LA-34 warning, and no v0.1 suggestion has a fix. The test checks that the warning goes and that the suggestion count is unchanged.

## Consequences

- Every problem the engine reports can be reached from the panel.
- Mismatch red on edges (F-302) reads the same diagnostics copy.
- F-703 hides the fix buttons in read-only mode.
- F-701 audits the panel's keyboard model and may add a shortcut for it.

## Alternatives

- **Deltas pushed on every change:** they would couple every edit to the panel and miss changes the panel doesn't see.
- **Staleness by the global revision:** a change to any file would refuse every fix.
- **Building the fix's text edit on the main thread:** it would move file text to the page.
- **A new edit command kind for fixes:** ADR 0042 kept the command set unchanged.
- **The panel in the right column or as an overlay:** too narrow, or it would cover React Flow's controls and attribution.
