# Vendored Nextflow grammar

Where the `.g4` files in this directory come from, and how to update them.

- Upstream: https://github.com/nextflow-io/nextflow, tag `v26.10.7`, commit `0ad848ef3c3a22824cd9eb2ca14568385867702d`.
- Path in the upstream repository: `modules/nf-lang/src/main/antlr/`.
- Files: `ScriptLexer.g4`, `ScriptParser.g4`, `ConfigLexer.g4`, `ConfigParser.g4`.
- Licence: Apache-2.0, with BSD portions from the ANTLR Java grammar (see the headers of the files, `NOTICE` and `LICENSE`
  in this directory; `NOTICE` and `LICENSE` are copies of `NOTICE` and `COPYING` at the pinned commit).
- The `.g4` files are verbatim copies and are never edited. `../upstream.json` records their SHA-256 values and
  `test/upstream.test.ts` checks them. The embedded Java actions are not edited either: `port.ts` holds each upstream
  snippet next to its TypeScript replacement, and `pnpm gen:grammar 26.10` applies it to a copy before running antlr-ng.
- The language server pin (the source of the catalogue) lives in `../upstream.json` too.

## Updating

1. Download the four files at the new tag from raw.githubusercontent.com and replace them.
2. Update the tag, commit and SHA-256 values in `../upstream.json`.
3. Run `pnpm gen:grammar 26.10`. It stops if a `port.ts` entry no longer matches or a Java action has no entry.
4. Re-check each `port.ts` entry against the upstream `@members` blocks and actions, and the base classes in
   `../src/parser/` against upstream `AbstractLexer.java` and `SemanticPredicates.java`.
5. Run `pnpm check` and commit the regenerated `../src/generated/`.
