# @nf-builder/spec-extract

Build-time tool (ADR 0003, ADR 0020): generates a pack's catalogue from the pinned Nextflow language server jar. Standalone: it imports no workspace package.

- `pnpm gen:catalogue 26.10` runs `src/SpecExtract.java` (needs a JDK 17+) and writes `packages/lang-2610/catalogue/*.json`; `--check` compares. Never hand-edit those files.
- `node tools/spec-extract/src/docs-compare.ts 26.10` compares the catalogue with the reference docs at the pinned commit.
- The jar is downloaded to `.cache/language-server/` and checked against the SHA-256 in `upstream.json`.
