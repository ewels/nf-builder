# 0001. Record decisions as ADRs

- Status: Accepted
- Date: 2026-11-21

## Context

Agents build this project in short, separate sessions. Each needs to know what is settled and why, or it will quietly undo earlier choices.

## Decision

- One file per decision in `docs/adr/`, from `template.md`, listed in `README.md`.
- Statuses: `Proposed`, `Accepted`, `Superseded by NNNN`. Only the maintainer accepts.
- **Until the first code is merged to `main`:** rewrite ADRs in place.
- **After that:** change a decision by writing a new ADR that supersedes the old one, and update the old one's status line.
- Agents write a `Proposed` ADR in the same PR when they:
  - add a runtime dependency;
  - change a package boundary;
  - change a stored or exported format;
  - change behaviour the spec describes.

## Consequences

- History is the git log of `docs/adr/` plus the supersede links.
- CI checks numbering, status lines and the index.
