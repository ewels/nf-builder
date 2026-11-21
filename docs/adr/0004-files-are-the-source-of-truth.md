# 0004. Files are the source of truth, and code is never lost

- Status: Proposed
- Date: 2026-11-21

## Context

Projects start blank, from templates, or from real pipelines, and end up in Git. A graph that regenerates code wholesale drifts from the text, drops comments, and can't represent everything Nextflow allows. Imports will contain code the visual model can't express.

## Decision

- **Files are authoritative.** The engine parses them into a model. Each canvas is a projection of one workflow.
- **Edits.**
  - Every canvas or form change is a typed edit command. The engine turns it into text patches on the declarations it targets, then re-parses those files.
  - Everything else stays *equivalent*: same AST ignoring positions and whitespace, same comments in the same order. Whitespace next to an edit may change. Byte identity is not required.
  - Undo restores the previous file snapshot.
- **Keep what we can't model:**

| Can't model | Kept as | Shown as |
|---|---|---|
| A whole file (fails the strict grammar) | Verbatim text | Files tree with an error badge; Code tab only |
| One declaration | Raw text, isolated by a brace-aware pre-scanner | An "unparsed" node |
| A workflow statement | A code node holding the text | Ports inferred from the variables it reads and assigns |
| Non-Nextflow files | Plain files | Files tree, generic editor |

## Consequences

- Import and export are trivial, and code edits and canvas edits share one path.
- Edit commands need per-declaration printers and tests that untouched code stays equivalent.
- Some imported workflows will be partly code nodes. The workflow summary shows how much is modelled.

## Alternatives

- Graph JSON as truth, generate code: lossy for imports, noisy diffs.
- Two-way sync between graph and code: two truths, endless conflicts.
