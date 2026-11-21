# 0008. Canvas model: fixed node kinds, chain nodes, layout in a sidecar

- Status: Proposed. The fixed node kinds were decided by Phil; the rest awaits review.
- Date: 2026-11-21

## Context

Nodes must stay minimal so large pipelines remain readable. Positions must survive reloads and re-imports without polluting the code.

## Decision

- **Node kinds are fixed.** There is no control to change a node's kind. Delete it and add a new one.
- **Operator chains are one node.** Consecutive operator calls with no assignment in between draw as one amber pill listing the operators (for example `mix → collect`).
  - It expands in place on click.
  - Operators with channel arguments get extra input ports.
  - Closure bodies live in the details pane and the popup, not on the canvas.
  - Dropping an operator on an edge inserts it into that edge's chain.
- **Layout lives in `.nf-builder/layout.json`.**
  - Keys come from the code: `<file>#<workflow>/<assigned variable>`, or `<callee>@<n>` when nothing is assigned.
  - Renames made in the app carry their keys along.
  - Nodes without a position get an ELK auto-layout.
  - Export includes the sidecar by default.

## Consequences

- Graphs look like the process diagrams people draw by hand.
- Swapping a node's kind loses its wiring. That is rare and predictable.
- Hand edits made outside the app can orphan layout keys. The worst case is a node being re-placed automatically.

## Alternatives

- One node per operator: cluttered.
- Positions stored in code comments: pollutes pipelines.
- Positions only in IndexedDB: lost on export.
