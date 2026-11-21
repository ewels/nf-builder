# 0005. Use Nextflow's own grammar, definitions and formatter

- Status: Accepted
- Date: 2026-11-21

## Context

Parsing, the palette, forms, hover help and generated code all need to match Nextflow exactly. Hand-maintained copies drift, and agents writing them from memory will invent things. Nextflow publishes everything we need:
- **Grammar:** ANTLR grammars in `modules/nf-lang` (Apache-2.0).
- **Definitions:** the language server jar bundles `spec/definitions.json` (config scopes) and the annotated DSL classes (directives, operators, types, feature flags).
- **Formatting:** `nextflow lint -format`.

See [research](../research/2026-11-21-nextflow-language-and-tooling.md).

## Decision

- **Grammar:**
  - Vendor the four `.g4` files into each language pack, recording the upstream commit.
  - Generate a TypeScript parser with antlr-ng and antlr4ng.
  - Hand-port the lexer base class and its embedded actions (about 30).
  - Build our own AST with ranges and comments.
- **Catalogue:**
  - `tools/spec-extract` (Java, CI only) reads the language server jar for the pack's version and writes `catalogue/config.json` and `catalogue/script.json`.
  - The output is committed and never hand-edited.
  - A small `palette.yaml` adds grouping, icons, defaults and docs links. It may only name things the catalogue contains.
- **Formatting:** the pack's printer emits what `nextflow lint -format` would. The CI oracle (ADR 0011) checks it.

## Consequences

- What parses here parses in Nextflow, and vice versa.
- The palette is complete and current, and output never churns under the official formatter.
- The hand-ported lexer actions need re-checking on each Nextflow release. CI diffs the vendored grammar against upstream.
- A small Java tool lives in the repo. It runs only in CI.

## Alternatives

- Hand-written parser: a second grammar that drifts.
- tree-sitter-nextflow: not authoritative.
- Scraping the docs: brittle.
- House formatting style: diffs the moment someone runs the official formatter.
