# Specification

What must be true of the app. The why lives in [ADRs](../adr/README.md); the order of work lives in the [plan](../plan/roadmap.md).

Load only the file your task needs. Requirement IDs (for example `UX-12`) are stable: features in `docs/plan/features.json` cite them, and so should tests and PRs.

| File | Covers |
|---|---|
| [product.md](product.md) | Purpose, users, goals, non-goals, principles |
| [ux.md](ux.md) | Layout, palette, canvas, details pane, edit popup, tabs, dialogs, shortcuts |
| [language.md](language.md) | Language packs, typed and legacy code, ports and types, lints |
| [architecture.md](architecture.md) | Packages, engine model, projection, edit commands, workers |
| [data-and-io.md](data-and-io.md) | Storage, import, export, registry, privacy |
| [files.md](files.md) | Editors for `nextflow.config`, `nextflow_schema.json`, `meta.yml` and other files |
| [quality.md](quality.md) | Performance budgets, accessibility, browser support, security |

Mockup (six screens): [docs/mockup](../mockup/README.md)

## Glossary

- **Project:** a set of text files making up one Nextflow pipeline, plus a layout sidecar.
- **Declaration:** a top-level item in a script: process, workflow, function, record, enum, `params` block, `output` block, include, feature flag.
- **Language pack:** everything version-specific for one Nextflow release (ADR 0006).
- **Catalogue:** generated list of directives, operators, factories, functions, types and config scopes for a pack (ADR 0005).
- **Projection:** the graph shown on a canvas, derived from one workflow's body.
- **Edit command:** a typed change request that the engine turns into text patches (ADR 0004).
- **Typed / legacy:** Nextflow 26.10 static-typing syntax vs DSL2 qualifier syntax (`val`, `path`, `tuple`).
- **Code node:** a statement the projection can't model, kept as text with inferred inputs and outputs (ADR 0004).
- **Chain node:** consecutive operator calls drawn as one node (ADR 0008).
- **Equivalent:** two versions of a file parse to the same AST (ignoring source positions and whitespace) and carry the same comments in the same order. Unparsed text is compared after normalising line endings and trailing whitespace. The standard for round trips and untouched code; byte identity is not required.
- **Suggestion:** lowest-severity lint that nudges towards modern syntax. Never blocks anything.
