# @nf-builder/oracle

Build-time tool (ADR 0011, ADR 0019): runs the pinned Nextflow release as an oracle, locally and in CI. Standalone: it imports no workspace package.

- `packages/lang-2610/upstream.json`: the Nextflow version and the SHA-256 of its `nextflow-<version>-dist` release asset. The tool reads it by path; bump it in its own PR.
- `pnpm nextflow -- <args>`: downloads the asset once into `.cache/nextflow/`, checks its SHA-256 and runs it offline (needs Java 17 to 26). Relative paths resolve from the directory you ran pnpm in.
- `pnpm oracle`: arrives in Task 2 (cases and report).
