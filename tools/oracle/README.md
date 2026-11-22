# @nf-builder/oracle

Build-time tool (ADR 0011, ADR 0019): runs the pinned Nextflow release as an oracle, locally and in CI. Standalone: it imports no workspace package.

- `packages/lang-2610/upstream.json`: the Nextflow version and the SHA-256 of its `nextflow-<version>-dist` release asset. The tool reads it by path; bump it in its own PR.
- `pnpm nextflow -- <args>`: downloads the asset once into `.cache/nextflow/`, checks its SHA-256 and runs it offline (needs Java 17 to 26). Relative paths resolve from the directory you ran pnpm in.
- `cases/cases.yaml`: one directory per case, with the expected `nextflow lint` and `nextflow run -stub` outcomes and the sources the code follows.
- `pnpm oracle [--case <id>] [--manifest <file>]`: runs each case in a fresh copy under `.cache/oracle/runs/<id>/`, then writes `.cache/oracle/report.md` and `results.json`.

- `pnpm oracle` also runs `nextflow lint -format` on the printer fixture trees (`packages/lang-2610/test/printer/fixtures.json`, F-110): a `format` check against the committed `formatted*/` goldens and a `fixed-point` check on `formatted*/` overlaid with `printed*/`. `pnpm oracle --write-format` regenerates `formatted*/` (exit 2 if an input has lint errors); `--case` skips the format trees.
