# @nf-builder/lang-2610

Nextflow 26.10 pack (ADR 0006).

`grammar/` holds the vendored nf-lang grammars and their hand port (`port.ts`), `src/generated/` the parser that
`pnpm gen:grammar 26.10` generates from them, and `catalogue/` the generated catalogue (never hand-edit the last two).

`src/printer/` is the printer, a port of nf-lang's formatter (ADR 0005, F-110). It is not exported from the pack entry.

May import: `@nf-builder/lang-core` only (ADR 0003).
