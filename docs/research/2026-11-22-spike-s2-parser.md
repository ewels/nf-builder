# Spike S2: a TypeScript parser and catalogue from Nextflow's own sources

2026-11-22, F-006, [ADR 0020](../adr/0020-parser-and-catalogue-generation.md). Can the nf-lang grammars become a TypeScript parser that accepts what `nextflow lint` accepts, fast enough for the app, and can the 26.10 catalogue be generated from the language server?

## Answer

- **Parser:** yes. The four grammars at v26.10.7, with 17 hand-ported lexer actions and one parser predicate, generate a TypeScript parser with antlr-ng 1.0.10 for the antlr4ng 3.0.16 runtime. It passes strict `tsc` without `@ts-nocheck`. It parses all 570 corpus files that `nextflow lint` 26.10.7 accepts (342 scripts and 228 configs across five pipelines).
- **Speed:** warm parsing is fast (sarek, 275 files: 1.1 s total, p95 12 ms per file). Cold parsing is not: 15.9 s for sarek in Node, because ANTLR builds its prediction DFA on first use. QA-03 (3 s for a sarek-sized project in a worker) is at risk; see Consequences.
- **Catalogue:** yes. `tools/spec-extract` reflects the language server jar into `catalogue/script.json` and `config.json`, deterministically. It matches the docs except for explained gaps.

## Setup and pins

All pins are in `packages/lang-2610/upstream.json`: nf-lang grammars at `v26.10.7` (commit `0ad848ef`), each file's SHA-256; language server `v26.10.2` (`language-server-all.jar`, SHA-256 `20326778…4b26`), which embeds nf-lang 26.10.4; the Nextflow dist used for lint (ADR 0019). The grammars are identical between 26.10.4 and 26.10.7.

## The port

- `grammar/port.ts` lists every upstream Java snippet (headers, `@members`, actions) next to its TypeScript replacement; `pnpm gen:grammar` fails if a snippet is missing or its count changed, or if Java is left in the grammar.
- `src/parser/` holds hand-ported base classes (`AbstractLexer`, `AbstractParser`, `SemanticPredicates`) and `java-character.ts`, Java 21's identifier rules, checked against 526 cases taken from jshell; the only differences from Java over all code points are characters Java 21 treats as unassigned.
- Lexer error messages and positions match `nextflow lint` for the cases tested (`1_`, `09`, a shebang on line 2, `@`, `$` in a GString).

## Corpus

| Pipeline | Files | Parsed | Stage-1 fallbacks | Lint accepted | Differences |
|---|---|---|---|---|---|
| rnaseq 3.28.0 | 253 | 253 | 0 | 253 | 0 |
| sarek 3.12.0 | 275 | 275 | 1 | 275 | 0 |
| fetchngs 1.13.0 | 28 | 28 | 1 | 28 | 0 |
| rnaseq-nf | 7 | 7 | 0 | 7 | 0 |
| rnaseq-nf (static-typing) | 7 | 7 | 0 | 7 | 0 |
| malformed fixtures | 9 | 4 | 5 | 1 | 3 |

The three fixture differences are files lint rejects after parsing, which a grammar parser accepts: `typed-legacy-mixed.nf` and `typed-without-flag.nf` (semantic checks), and `section-order.nf` (the out-of-order process body parses as a call to `process` with a closure; nf-lang's AST builder rejects it). They are listed with causes in `packages/lang-2610/test/corpus/known-differences.json`.

## Speed

The parse runs in two stages, as upstream does (`ScriptAstBuilder.java:169-197`): SLL with a bail-out error strategy, then full LL with error reporting. At first 199 of 275 sarek files failed stage 1, because SLL can't see the caller of `sep : (NL|SEMI)+` (a blank line before `emit:` makes it keep looping) or decide `QUESTION?` in `type` (a ternary after `instanceof`). Upstream's Java parser falls back on the same files. Stage 1 now predicts the decisions of `sep` and `type` with full LL and everything else with SLL. The corpus harness checks that its trees equal pure LL for every file of fetchngs, both rnaseq-nf branches and the fixtures, and a fixed sample of 20 sarek files; a one-off check during research covered all 342 scripts and 228 configs.

| Sarek, Node 22, 4 × Xeon 2.1 GHz | Before | After |
|---|---|---|
| Cold (first parse in the process) | 51.0 s, max 6.3 s per file | 15.9 s, max 3.0 s per file |
| Warm (second parse) | 37.8 s, p95 593 ms | 1.1 s, p95 12 ms |

The remaining cold time is DFA construction for real ambiguities in the grammar (whole declaration against statement, closure against command-call argument, `workflowBody` alternatives). Upstream Java pays it too (18 s cold for sarek's `.nf` files with stock-like settings).

## Catalogue

| Item | Docs (26.10.7) | Catalogue (26.10.4) | Docs only | Catalogue only |
|---|---:|---:|---|---|
| Process directives | 41 | 41 | none | none |
| Operators (operator.mdx, legacy-inclusive) | 47 | 31 | 17 legacy-only operators nf-lang doesn't model (`buffer`, `collate`, `concat`, the `count*` and `split*` families, `distinct`, `first`, `last`, `merge`, `randomSample`, `set`, `tap`) | `groupBy` |
| Typed operators (stdlib channel and value) | 13 | 13 | none | none |
| Channel factories | 11 | 10 | `fromSRA` | none |
| Feature flags | 5 | 6 | none | `nextflow.preview.recursion` |

Also generated: 7 agent directives, 10 constants, 15 functions, 4 namespaces, 16 types, process input and output qualifiers, and 42 config scopes (569 nodes). Operator names repeat across the `Channel` and `Value` receivers (`map`, `combine`, `flatMap`, `mix`, `subscribe`, `view`).

Causes of the other gaps, from the docs at the same commit: `fromSRA` is marked deprecated in 26.04 (`stdlib-namespaces/channel.mdx:198-202`) and nf-lang 26.10.4 no longer models it; `groupBy` is a typed operator documented in `stdlib-types/channel.mdx:72` but not in the legacy `operator.mdx`; `nextflow.preview.recursion` is modelled by nf-lang but missing from `feature-flags.mdx`.

## Limits

- One error per file, as upstream; message wording is matched for lexer errors only.
- Columns count code points, as nf-lang does (it reads input with `CharStreams.fromReader`): `nextflow lint` and the parser both report 2:16 for `v = "𝐀𝐀" + = 1` on the second line of a workflow block.
- Timings are raw parse in Node, outside a worker and without the model.

## Consequences

- F-101: steps 2 and 3 are delivered here. nf-lang has no lexer tests, so "ported lexer cases" means the parse cases of `ScriptAstBuilderTest` and `ConfigAstBuilderTest` (recorded when F-101 lands).
- F-102: comments are `NL` tokens on the default channel (`ScriptLexer.g4:855-867`), so the AST builder must recover their text from those tokens to attach them.
- F-104: the pre-scanner can rely on the parser accepting every corpus file lint accepts.
- F-109: the catalogue exists; F-109 adds `palette.yaml` and on-demand regeneration.
- F-113: QA-03 needs cold-start work: parse only open or changed files first, warm the parser on a small representative file at worker start, cache parse results, or move to a faster prediction strategy. Measure in a worker before choosing.

## How to re-run

`pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (report in `.cache/reports/parse-corpus.md`); `pnpm gen:grammar 26.10 --check`; `pnpm gen:catalogue 26.10 --check`; `node tools/spec-extract/src/docs-compare.ts 26.10`.
