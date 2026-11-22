# 0046. Render projections with React Flow 13 in a lazily loaded canvas, with view logic in the engine and an interim layered layout

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

UX-20 to UX-26 describe the canvas: node kinds, colours and anatomy, ports, edge styles and controls. ADR 0003 names React Flow. AR-31 keeps node components presentational, and QA-01 caps the initial JavaScript. ADR 0008 places nodes without a stored position with ELK, but ELK and the layout sidecar belong to F-207. F-205's step 1 asked for "each template", yet templates arrive with F-203, which itself needs this canvas. Research: the [F-205 plan](https://github.com/ewels/nf-builder/blob/9db5fcf/docs/plan/handoff/plan-F-205.md).

## Decision

- **React Flow.** `@xyflow/react` 13.0.2 is pinned as a runtime dependency of `@nf-builder/web`; its dependencies are MIT, ISC and BSD-3-Clause, and Zustand 5 is shared. The fallback is 12.12.1. It uses `forceColorMode="light"`, keeps the attribution visible at bottom centre, and has sentence-case `ariaLabelConfig` strings.
- **Lazy canvas.** The canvas is a lazily loaded chunk, about 84 kB gzipped, outside QA-01. An end-to-end test guards that it never enters the initial JavaScript. If the chunk fails to load, an error boundary shows "The canvas couldn't load. Reload the page."
- **View logic in the engine.** `canvasView` (`packages/engine/src/canvas/`) maps a projection to presentational node and edge views: appearance, title, subtitle, badge, port labels and types, and pill widths. It runs on the main thread from the projection the worker returns. Node components only render that view (AR-31).
- **Interim layout.** `layeredLayout` places nodes in longest-path columns in O(N+E). Takes and params come first, and emits and outputs come after every other node. It applies until F-207 adds ELK and stored positions, and departs from ADR 0008's "ELK for nodes without a position" in the meantime without superseding it.
- **UX-22 readings:**
  - **Grey nodes:** take and emit are grey pills, and code nodes are grey.
  - **Problem callees:** an unparsed callee is a grey card with a 2 px error outline, a warning glyph and "could not be parsed". An unresolved callee draws the same way, with "not found".
  - **Subtitles:** a registry module's subtitle is its registry name. A pipeline draws as a workflow, subtitled "pipeline".
  - **Agents:** an agent draws as a process card with its own glyph.
  - **Typed badge:** a call has the typed badge when `callee.typed === true`.
- **UX-24 readings:**
  - **Line styles:** channel edges are solid, value edges dashed and plain values dotted. Edges of unknown type are solid, muted and thinner, so colour is never the only cue (QA-12).
  - **Tooltip:** hovering an edge shows `<type> · <variable or source>`, or "Unknown type".
  - **Deferred:** the selection highlight is F-206's, and mismatch red is F-302's and F-309's.
- **UX-21:** card titles are monospace. The port-labels toggle lasts for the session, so it adds no stored format, and it has a fixed label with `aria-pressed`. Fit view never zooms past 1.
- **Projects.** The canvas store (`apps/web/src/canvas/canvas-store.ts`) shows the default workflow of every project F-202 opens. It resets when no stored project is current, and re-projects the open tab after each engine change. `window.nfBuilderWorkspace` is a test hook in production builds, as F-113's is.
- **Step 1.** F-205 step 1 is reworded to: open fixture projects covering every node kind and a corpus pipeline; visual snapshots per node kind match baselines. The template check moves to F-203, which now depends on F-205. It is moved, not dropped.
- **Fixtures and CI.**
  - The `f205-canvas` oracle case covers every node kind except an agent callee, which `run -stub` can't run without a runner plugin; a synthetic projection covers that one.
  - The Chromium end-to-end leg in `ci.yml` restores the corpus first.
  - Visual baselines clip each node kind at zoom 1, and show the rnaseq-nf-typed canvases. They are approved from CI (ADR 0021). F-207 re-approves them when ELK changes placement.
- **IO-41.** Four React Flow namespace and documentation URLs are listed in `scripts/non-fetched-urls.ts`.

## Consequences

- The canvas can be replaced or upgraded without touching the engine's view.
- The interim layout is simple and deterministic, but it doesn't preserve positions across edits. F-207 fixes that.
- Several deferred items are recorded in the notes of the features that own them: F-206, F-207, F-208, F-302, F-307, F-309 and F-701.

## Alternatives

- **React Flow 12:** kept as the fallback; 13.0.2 works.
- **View logic in components:** goes against AR-31 and is harder to test.
- **ELK now:** belongs to F-207, together with the stored positions.
- **An eager canvas:** would push React Flow into the initial bundle.
