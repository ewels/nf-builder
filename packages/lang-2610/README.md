# @nf-builder/lang-2610

Nextflow 26.10 pack (ADR 0006).

`grammar/` holds the vendored nf-lang grammars and their hand port (`port.ts`), `src/generated/` the parser that
`pnpm gen:grammar 26.10` generates from them, and `catalogue/` the generated catalogue (never hand-edit the last two).
`src/ast/` builds the script AST and attaches comments to it; it is internal to the pack.

May import: `@nf-builder/lang-core` only (ADR 0003).
