# 0020. Generate the parser with antlr-ng and the catalogue from the language server jar

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0005 uses Nextflow's own ANTLR grammars and definitions. Spike S2 (F-006) has to turn the 26.10 grammars into a TypeScript parser, check it against the corpus and `nextflow lint`, and generate the 26.10 catalogue. The grammars carry Java actions and `@members` that need a hand port. nf-lang isn't published to Maven Central; the newest 26.10 language server (v26.10.2) embeds nf-lang 26.10.4, while the oracle pins Nextflow 26.10.7 (ADR 0019); the grammar files are identical between the two. Upstream is Apache-2.0 with a NOTICE file. Research: [spike S2 report](../research/2026-11-22-spike-s2-parser.md).

## Decision

- **Dependencies:** `antlr4ng` 3.0.16 (BSD-3-Clause) is a runtime dependency of `@nf-builder/lang-2610`; `antlr-ng` 1.0.10 (MIT, no Java) is a dev dependency. Both are pinned exactly and move together in one Renovate group, because antlr-ng pins the runtime it generates for.
- **Generation:** `pnpm gen:grammar <version>` applies the hand port (`packages/lang-<pack>/grammar/port.ts`, each upstream Java snippet next to its TypeScript replacement) to the vendored `.g4` files and writes `src/generated/`. The generated parser is committed, carries a do-not-edit header naming the upstream tag and commit, and gets `// @ts-nocheck` only if it fails strict `tsc`; hand-written code stays strict. `--check` regenerates and compares.
- **Pins:** `packages/lang-2610/upstream.json` holds the grammar file hashes and the language server tag, commit, nf-lang version, URL and SHA-256, beside the Nextflow pins (ADR 0019). The 26.10 pack's language server is v26.10.2 (nf-lang 26.10.4); the catalogue's `source` records that.
- **Catalogue:** `tools/spec-extract` is a single-file Java program run with `java -cp <jar> File.java` (JDK 17 or later; no Gradle or Maven) against the pinned jar. It may run locally (ADR 0018); CI's `catalogue` job regenerates and compares on every PR.
- **Corpus comparison:** `pnpm corpus:lint` caches `nextflow lint -o json` results in `.cache/corpus-lint/` (not committed); `pnpm test:corpus` parses every corpus file and compares with lint. A difference passes only when it is listed with its cause.
- **CI:** two new jobs in `ci.yml`, `corpus-parse` and `catalogue`, both blocking, with `actions/setup-java` pinned by SHA.
- **Licensing:** `packages/lang-2610/grammar/` keeps upstream's `NOTICE` and the Apache-2.0 `LICENSE`; ported files keep attribution headers; `docs/licences.md` lists the vendored grammars, generated parser, ported classes, catalogue text and antlr4ng. A third-party notices page in the app is F-704's.
- **Hosts:** build-time only (ADR 0017's rule): `github.com` release downloads (redirecting to `release-assets.githubusercontent.com` or `objects.githubusercontent.com`) and `raw.githubusercontent.com`.

## Consequences

- The parser follows upstream by regenerating; a grammar bump means re-checking each port entry, which `gen:grammar` enforces by exact-match counts.
- Both ANTLR packages last released in 2025, so there is a maintenance risk; the generated code and runtime are small enough to vendor if they stall.
- The catalogue lags the grammar by three patch releases until a newer language server ships; the docs comparison shows any gap.

## Alternatives

- `antlr4` (the official JavaScript runtime) with the Java ANTLR tool: needs Java to generate and has weaker TypeScript output.
- A hand-written parser: drifts from upstream, against ADR 0005.
- Building nf-lang 26.10.7 from source for the catalogue: a Gradle build in CI for a skew the grammar doesn't have.
