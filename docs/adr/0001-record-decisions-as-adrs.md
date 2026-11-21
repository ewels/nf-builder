# 0001. Record decisions as ADRs

- Status: Accepted
- Date: 2026-11-21

## Context

Agents build this project in short, separate sessions. Each needs to know what is settled and why, or it will quietly undo earlier choices.

## Decision

- One file per decision in `docs/adr/`, from `template.md`, listed in `README.md`.
- Statuses: `Proposed`, `Accepted`, `Accepted (agent)`, `Superseded by NNNN`. The maintainer accepts; in autonomous mode (ADR 0012) the agent accepts its own decisions as `Accepted (agent)`, and the maintainer may supersede them later.
- **Until the first code is merged to `main`:** rewrite ADRs in place.
- **After that:** change a decision by writing a new ADR that supersedes the old one, and update the old one's status line.
- **Spikes** append a dated `## Spike result` section to each ADR they test, linking their report. If the result changes the decision, they also write a superseding ADR.
- Agents write an ADR in the same PR (`Proposed`, or `Accepted (agent)` in autonomous mode) when they:
  - add a runtime dependency;
  - change a package boundary;
  - change a stored or exported format;
  - change behaviour the spec describes.

## Consequences

- History is the git log of `docs/adr/` plus the supersede links.
- CI checks numbering, status lines and the index.
