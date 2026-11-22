# @nf-builder/engine

Parse, model, projection, edits, printing. No DOM; runs in a worker.
`src/source/` builds, prints and compares source files (ADR 0033); `src/model/` is the incremental project model (ADR 0034).

May import: `@nf-builder/lang-core`; language packs only through the interface (ADR 0003).
