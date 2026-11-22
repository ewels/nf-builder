# @nf-builder/lang-2610

Nextflow 26.10 pack (ADR 0006).

`grammar/` holds the vendored nf-lang grammars and their hand port (`port.ts`), `src/generated/` the parser that
`pnpm gen:grammar 26.10` generates from them, and `catalogue/` the generated catalogue (never hand-edit the last two).
`src/ast/` builds the AST and attaches comments; `src/printer/` ports nf-lang's formatter (ADR 0005). Both are internal.
`src/source/` is the declaration-level fallback (ADR 0033); `pack.loadParser()` loads it with the printer as one lazy chunk.
`src/includes/` holds the include resolution rules (`pack.includes`, ADR 0034), small and loaded eagerly.
May import: `@nf-builder/lang-core` only (ADR 0003).
