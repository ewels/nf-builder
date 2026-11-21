# Open questions

Questions for the maintainer. Agents: if your task depends on one of these, stop and ask rather than guessing. When a question is answered, record the answer and date here, and move any resulting decision into an ADR.

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | Final app name. Personal project (Phil's account), so no "Nextflow" in the name; it should read as Nextflow the way nf-docs does. Ruled out: Nextflow Composer, Nextflow Studio, nf-blocks (Rob Syme's lineage explorer), nf-studio. Unclaimed on GitHub (exact repo name), npm, PyPI and the legacy plugin index as of 2026-11-21: nf-builder, nf-canvas, nf-loom, nf-weave, nf-wire, nf-sketch, nf-draw, nf-forge, nf-scaffold. Affects the sidecar folder name (ADR 0008) and the Pages URL. | Final name only | Answered 2026-11-21: **nf-builder**. Repo `ewels/nf-builder`, Pages `https://ewels.github.io/nf-builder/`, sidecar folder `.nf-builder/`. Not checked: the new Nextflow registry and a GitHub user or org of that name |
| Q2 | Accept, amend or reject each Proposed ADR: 0003, 0004, 0005, 0008, 0009, 0010, 0011, 0012. | F-001 | Answered 2026-11-21: all accepted as written. 0009 and 0010 stand until spikes S4 and S3 confirm or supersede them |
| Q3 | Is CheerpJ's licence (free for FOSS, commercial software) acceptable as an optional dependency? | F-007 outcome | Open |
| Q4 | Keep the preview `agent` block in the palette (with a `preview` badge), or hide preview features until stable? | F-204 | Open; default is shown with badge |
| Q5 | Who reviews and merges agent PRs besides Phil, if anyone? | ADR 0012 | Open |
| Q6 | Which templates ship in v0.1? Proposed: Hello world, Samplesheet to MultiQC, nf-core-style skeleton, Pipeline composition. | F-203 | Open |
| Q7 | Licence for the project (MIT, Apache-2.0, other)? Vendored grammars are Apache-2.0. | F-001 | Answered 2026-11-21: MIT. `LICENSE` added; copyright holder "Phil Ewels and contributors" until Q1 settles the repo home |
| Q8 | nf-docs gaps for ADR 0013. | Not blocking | Filed 2026-11-21: ewels/nf-docs #17 (workflow takes and emits), #18 (pin language server), #19 (extra pages) |
| Q9 | Look at StageNest before M0, and check whether nf-schema-builder's editor can be embedded (FI-10)? See [prior art](../research/2026-11-21-prior-art.md). | M0 | Open |
