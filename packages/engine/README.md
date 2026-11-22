# @nf-builder/engine

Parse, model, projection, edits, printing. No DOM; runs in a worker.
`src/source/` builds, prints and compares source files (ADR 0033); `src/model/` is the incremental project model (ADR 0034);
`src/projection/` projects workflows into graphs with node keys and Channel/Value types (ADR 0036); `src/edit/` applies edit commands as text patches with inverses (ADR 0039); `src/service/` is the API the worker exposes (ADR 0043).

May import: `@nf-builder/lang-core`; language packs only through the interface (ADR 0003).
