# Plan: F-006 (spike S2), parser and catalogue from Nextflow's own sources

Planned against `main` plus `feat/F-009` (tools/corpus, ADR 0017, ADR 0018). Cites ADR-0005; touches ADR 0003, 0006, 0011, 0017, 0018, QA-03, LA-02.
The planner changed nothing in the repo. Every upstream fact below was checked on 2026-11-21 from the sandbox; probe copies are in the scratchpad under `up/`, `ls/`, `ng/` and `lint/`.

## 0. Facts established while planning (the builder should not re-derive these)

**Nextflow and grammar**
- nextflow-io/nextflow `v26.10.7` is an annotated tag. It peels to commit `0ad848ef3c3a22824cd9eb2ca14568385867702d`.
- The four grammars are at `modules/nf-lang/src/main/antlr/{ScriptLexer,ScriptParser,ConfigLexer,ConfigParser}.g4`. Their SHA-256 values:
  - ScriptLexer `c0ec421338ddaf5fd5bc3e8405af1261d88202bf5029c61ca1181b454bfc130c`
  - ScriptParser `b632d132a8883bff72ed4471eb7579beef708feb701855db41928a779b151cc1`
  - ConfigLexer `2400a9e2968dfe576b6cf004d6acc67717ee025a13713fcd6f300b91acde0a92`
  - ConfigParser `fa1a8ea9a8412919f57b14ebb75037d7c99b8049c63837110117e11d99644f69`
- The grammar files are byte-identical at v26.10.4 (`691b8210…`) and v26.10.7 (checked with `diff`).

**Embedded Java and base classes**
- `superClass = AbstractLexer` / `AbstractParser`. These are nf-lang classes in `nextflow.script.parser`, 31 lines each: they extend the ANTLR Lexer/Parser and implement Groovy's `SyntaxErrorReportable`.
- `SemanticPredicates.java` (128 lines) provides `isFollowedBy`, `isFollowedByJavaLetterInGString`, `isFollowedByWhiteSpaces` (unused by the grammars) and `isValidDirective` (a Script overload and a Config overload).
- Each lexer has an `@header` (Java imports), an `@members` block (about 65 lines: `emit` override recording `tokenIndex`/`lastTokenType`, `REGEX_CHECK_ARRAY`, `isRegexAllowed`, `getErrorLine`/`getErrorColumn`, and `isJavaIdentifier*AndNotIdentifierIgnorable`), and 18 action or predicate sites (15 distinct).
- Each parser has `@header`, `@members` (error-position overrides) and one predicate, `{ isValidDirective($expression.ctx) }?`.
- In total there are about 40 sites and about 17 distinct snippets, which fits ADR 0005's "about 30 actions".
- `require(cond, msg, offset, attachPos)` comes from Groovy 4.0.33's `SyntaxErrorReportable`. It throws `GroovySyntaxError` at `(getErrorLine(), getErrorColumn() + offset)`.
- Comments lex as `-> type(NL)`: comment text stays on the default channel as NL tokens. This matters for F-102.

**How nf-lang drives the parser** (`ScriptAstBuilder.buildCST`)
- It parses with SLL first and `DescriptiveErrorStrategy`, which extends `BailErrorStrategy`, so it stops at the first error.
- If that throws, it rethrows lexer errors as they are. Otherwise it does `seek(0)` and parses again with LL, with error listeners attached.
- So nf-lang reports one syntax error per file at the grammar stage.
- Some errors come later, from the AST builder or semantic checks. That code is not in scope here.

**antlr-ng**
- npm `antlr-ng@1.0.10` (MIT, pure TypeScript, no Java) pins `antlr4ng@3.0.16` exactly (BSD-3-Clause, last published 2025-03-03).
- `antlr-ng -Dlanguage=TypeScript -l false -v false -o <dir> <4 grammars>` runs in about 1.7 s.
- Output size: ScriptParser.ts 444 KB, ConfigParser.ts 276 KB, the two lexers 62 KB and 52 KB.
- It also writes `.interp` and `.tokens` files. Drop those; the ATN is serialised inside the `.ts` files.
- No timestamp in the output.
- The output is erasable TypeScript: no enums, namespaces or parameter properties.
- **Java actions are copied verbatim**, including `@header` Java imports, `_input.LA(1)`, `(char)` casts and `getText()`. A Java-to-TypeScript rewrite before generation is therefore mandatory.
- `$expression.ctx` is translated by antlr-ng to `localContext._expression`, where `localContext` is typed `… | null`.
- Generated classes `extends AbstractLexer` / `AbstractParser` by name.

**Language server**
- Tags for the 26.10 line are `v26.10.0`, `v26.10.1` and `v26.10.2`. `v26.10.2` is commit `32601171ad37c813c988e5e33b7bc93df93a1ffe`, built 2026-10-27.
- Release asset `https://github.com/nextflow-io/language-server/releases/download/v26.10.2/language-server-all.jar`: 10,015,752 bytes, SHA-256 `20326778651c5c5e5f40a570c2275d1f520419941624386a2b1a111f1dfa4b26`.
- Its `build.gradle` depends on `io.nextflow:nf-lang:26.10.4`, and builds `spec/definitions.json` with `SpecWriter` from the Nextflow **26.10.4** runtime plus plugins (nf-amazon 3.12.1, nf-azure 1.24.2, nf-google 1.29.1, nf-k8s 1.6.1, nf-seqera 0.26.0, nf-tower 1.32.1, nf-wave 1.22.3, nf-lineage 26.10.4).
- **Version skew:** the grammar is pinned at 26.10.7, the catalogue comes from 26.10.4.
- nf-lang is not on Maven Central (404 for both 26.10.4 and 26.10.7).
- `spec/definitions.json` holds 36 top-level entries (63 `ConfigScope`, 442 `ConfigOption`, 2 `ConfigPlaceholderScope` in total). Its shape is `{type, spec:{name, description, children | type, additionalTypes | placeholderName, scope}}`.
- It does **not** contain `process`, `env`, `params`, `plugins`, `profiles` or `nextflow`. Those come from nf-lang's `SpecNode.ROOT`:
  - `Config` scope fields;
  - `process` and `agent` built from `ProcessDsl.DirectiveDsl`;
  - `nextflow.enable/preview/retryPolicy` built from `FeatureFlagDsl` and `RetryPolicyConfig`.
- The language server merges the two in `nextflow.lsp.spec.ConfigSpecFactory.defaultScopes()`: `SpecNode.ROOT.children().putAll(fromCoreDefinitions())`.
- `SpecNode` is a sealed interface with records `Scope(description, Map children)`, `Option(description, List<Type> types)`, `Placeholder(description, placeholderName, Scope scope)` and `DslOption(description, Class dsl)`. All are in the jar.
- Script-side classes in the jar:
  - `nextflow.script.dsl.{ProcessDsl$DirectiveDsl, ProcessDsl$InputDslV1, ProcessDsl$OutputDslV1, ProcessDsl$OutputDslV2, ProcessDsl$StageDsl, AgentDsl$DirectiveDsl, ScriptDsl, FeatureFlagDsl, …}`;
  - `nextflow.script.namespaces.{ChannelNamespace, LogNamespace, WorkflowNamespace, NextflowNamespace, ManifestNamespace}`;
  - `nextflow.script.types.*` (Channel, Value, Bag, Duration, MemoryUnit, Record, Tuple, …, plus a `shim/` subpackage).
- `@Description`, `@Operator`, `@FeatureFlag` and `@Constant` have RUNTIME retention, so reflection can read them.
- nf-lang is compiled with `-parameters`, so real parameter names are available through reflection.
- In nf-lang, `@Deprecated @Operator` on `Channel`/`Value` means "discouraged from use with static typing" (`TypeCheckingVisitor`). That is the legacy-only flag UX-13 and F-204 need.

**`nextflow lint` 26.10.7** (local run, `-o json`)
- Output shape: `{summary:{errors, filesWithErrors, filesWithoutErrors, warnings, …}, errors:[{filename, startLine, startColumn, message}], warnings:[…]}`.
- `filename` is relative to the linted directory.
- Default excludes: `.git, .lineage, .nextflow, .nf-test, nf-test.config, work`. Lint checks `*.nf` and `*.config`.
- Lint wrote no files into the pipeline directories.
- Per-pipeline results (all accepted, no errors):

  | Pipeline | Files checked | Errors | Lint time |
  |---|---|---|---|
  | rnaseq-nf | 7 | 0 | 1.5 s |
  | rnaseq-nf-typed | 7 | 0 | 1.5 s |
  | fetchngs | 28 | 0 | 2.2 s |
  | rnaseq | 253 | 0 | 9.1 s |
  | sarek | 275 | 0 | 14.8 s |

  - **That is 570 files, every one accepted by lint.** Each count equals `*.nf` plus `*.config` minus `nf-test.config`.
- Malformed fixtures (copied to the scratchpad and linted): 8 errors and 1 ok, matching `fixtures.yaml`.
  - `typed-legacy-mixed.nf` and `typed-without-flag.nf` fail on **semantic** checks ("Invalid input declaration in typed process", "Typed input declaration is not allowed in legacy process", "`x` is not defined").
  - A grammar-only parser will accept those two. That is an expected, explainable difference.
  - The other six are syntax errors ("Unexpected input", "Unexpected end of file").
- The release has no `.sha256` asset. The local dist jar `.cache/nextflow/nextflow-26.10.7-dist` has SHA-256 `c54cd4b7be058e8954180b378a8efa6d61085bc433d7d9b06ec2cad2ad6580a6`.

**Docs sources** (nextflow-io/nextflow at v26.10.7, `docs/reference/`; docs.seqera.io is unreachable from the sandbox)

| Item | Docs page | Docs count | nf-lang 26.10.7 source | Gap |
|---|---|---|---|---|
| Directives | `process/directives.mdx` table | 41 | 41 in `ProcessDsl.DirectiveDsl` | None found by name (provisional) |
| Operators, full legacy list | `operator.mdx`, `## name` headings | 47 | `Channel`: about 12 typed `@Operator` plus 18 `@Deprecated @Operator`; `Value`: 7 `@Operator` | See below |
| Typed operators | `stdlib-types/channel.mdx` | 13 | | |
| Channel factories | `stdlib-namespaces/channel.mdx`, `##### \`name(` headings | 11 (includes `fromSRA`) | `ChannelNamespace` | |
| Feature flags | `feature-flags.mdx` | 5 `nextflow.enable.*` | 6 in `FeatureFlagDsl` | `previewRecursion` is extra |
| Config scopes | `config/*.mdx` | 33 pages, including `unscoped.mdx` | | |

- Operator gaps:
  - 18 operators are documented in `operator.mdx` but absent from nf-lang: buffer, collate, concat, countFasta, countFastq, countJson, countLines, distinct, first, join\*, last, merge, randomSample, set, splitFasta, splitFastq, splitJson, tap.
  - `groupBy` is in nf-lang but not in `operator.mdx`.
  - \*`join` is on the typed page. My regex may have missed its annotation, so recount properly.
- These numbers are provisional and from source at 26.10.7. Task 3 recounts them against the **jar** (26.10.4) and the docs.

**nf-lang upstream tests**
- At v26.10.7 there are **no lexer tests**. There are `ScriptAstBuilderTest.groovy` (21 cases), `ConfigAstBuilderTest.groovy` and `AgentParserTest.groovy`. See open point O11; this affects F-101.

## 1. Files

### 1.1 Vendored grammar and pins: `packages/lang-2610/`

| File | Content |
|---|---|
| `grammar/ScriptLexer.g4`, `ScriptParser.g4`, `ConfigLexer.g4`, `ConfigParser.g4` | Verbatim from upstream at `0ad848ef…`, licence headers intact. Never edited; a test checks SHA-256. |
| `grammar/SOURCE.md` | Human record (see the list below this table). |
| `grammar/port.ts` | The hand port: every Java snippet next to its TypeScript replacement. Data only, imports nothing. |
| `grammar/NOTICE`, `grammar/LICENSE` | Only if O7 is decided that way. |
| `upstream.json` | Machine-readable pins for this pack. Hand-written, not generated. It is **not** in `catalogue/`, because AGENTS.md says `catalogue/*.json` is generated. |

`grammar/SOURCE.md` records:
- the upstream repo, tag `v26.10.7` and commit;
- the path `modules/nf-lang/src/main/antlr/`;
- the licence (Apache-2.0, with BSD portions from the ANTLR Java grammar);
- that the files are verbatim;
- how to update: download at the new tag, update `upstream.json` hashes, run `pnpm gen:grammar 26.10`, re-check each `port.ts` entry against upstream `@members` and actions;
- that the language server pin lives in `upstream.json`.

`grammar/port.ts`:
```ts
export type GrammarName = "ScriptLexer" | "ScriptParser" | "ConfigLexer" | "ConfigParser";
/** One upstream Java snippet and its TypeScript port. `java` is the exact upstream text (whitespace-sensitive). */
export type PortEntry = { java: string; ts: string; occurrences: number; note?: string };
export type GrammarPort = { header: PortEntry; members: PortEntry; actions: readonly PortEntry[] };
export const PORT: Readonly<Record<GrammarName, GrammarPort>>;
```
- The `header` replacement contains TypeScript imports, with `.ts` extensions. Examples: `import { AbstractLexer } from "../parser/abstract-lexer.ts";` and the predicate helpers.
- The `members` replacement is kept minimal: logic lives in the hand-written base classes. Lexers provide `regexCheckTokenTypes`, built from `ScriptLexer.RBRACE`, etc. Parsers provide `isValidDirective(ctx)` as a member, so it can use this file's context classes without a circular import.
- `superClass = AbstractLexer` stays unchanged, because the TypeScript base classes use the same names.

`upstream.json`:
```json
{
  "nextflow": { "version": "26.10.7", "tag": "v26.10.7", "commit": "0ad848ef3c3a22824cd9eb2ca14568385867702d" },
  "grammar": {
    "path": "modules/nf-lang/src/main/antlr",
    "files": { "ScriptLexer.g4": "c0ec42…", "ScriptParser.g4": "b632d1…", "ConfigLexer.g4": "2400a9…", "ConfigParser.g4": "fa1a8e…" }
  },
  "languageServer": {
    "tag": "v26.10.2", "commit": "32601171ad37c813c988e5e33b7bc93df93a1ffe", "nfLang": "26.10.4",
    "url": "https://github.com/nextflow-io/language-server/releases/download/v26.10.2/language-server-all.jar",
    "sha256": "20326778651c5c5e5f40a570c2275d1f520419941624386a2b1a111f1dfa4b26"
  },
  "nextflowDist": {
    "url": "https://github.com/nextflow-io/nextflow/releases/download/v26.10.7/nextflow-26.10.7-dist",
    "sha256": "c54cd4b7be058e8954180b378a8efa6d61085bc433d7d9b06ec2cad2ad6580a6"
  }
}
```
- Write the full hashes from section 0 into the file; they are shortened here.
- `nextflowDist` is only included if F-005 hasn't already provided a pin. See O6.

### 1.2 Generator: `scripts/gen-grammar.ts` (root, version-agnostic, so no LA-02 literal) and `pnpm gen:grammar <version> [--check]`

```ts
export type GenOptions = { version: string; check: boolean; repoRoot?: string };
export function packDir(version: string, repoRoot?: string): string;   // "26.10" -> packages/lang-2610; unknown -> Error listing packs that have grammar/
export function readUpstream(packDir: string): Upstream;              // JSON.parse + shape checks, actionable messages
export function applyPort(grammar: string, port: GrammarPort, file: string): string;
//   For each entry: the exact `java` text must occur exactly `occurrences` times, else throw "<file>: port entry not found or count changed: …".
//   After replacement, throw "<file>:<line>: Java left in grammar: …" if any of /_input\b|\(char\)|Character\.|getText\(\)|import java|package nextflow/ remain.
export function generatedHeader(i: { grammarFile: string; tag: string; commit: string; antlrNg: string; noCheck: boolean }): string;
//   "// Generated by `pnpm gen:grammar <v>` with antlr-ng <x> from nextflow-io/nextflow <tag> (<commit>) <path>/<grammarFile>.\n// Do not edit: change packages/lang-2610/grammar/ and regenerate. Licence: Apache-2.0 (see grammar/SOURCE.md).\n"
//   plus "// @ts-nocheck\n" only if the output does not type-check under the pack tsconfig (O9).
export function generate(o: GenOptions): Promise<{ written: string[] }>;  // temp dir, run antlr-ng, keep *.ts only, prepend header, LF endings, then replace src/generated atomically
export function checkGenerated(o: GenOptions): Promise<{ differences: string[] }>; // generate to temp, compare file list and bytes with src/generated
export function main(argv: readonly string[]): Promise<number>;      // 0 ok, 1 differences (--check) with "run pnpm gen:grammar <v>", 2 usage
```
- Run antlr-ng from the installed `antlr-ng` binary: `spawnSync(process.execPath, [<resolved antlr-ng/dist/cli/runner.js>, …])` or `pnpm exec antlr-ng`. Flags: `-Dlanguage=TypeScript -l false -v false -o <tmp>`.
- Output goes to `packages/lang-2610/src/generated/{ScriptLexer,ScriptParser,ConfigLexer,ConfigParser}.ts`. These are generated files (AGENTS.md); Biome already excludes them.

### 1.3 Hand-ported runtime: `packages/lang-2610/src/parser/`

Each file carries an attribution header: "Ported from nextflow-io/nextflow v26.10.7 nf-lang `<Class>.java` (Apache-2.0)" or "from apache/groovy GROOVY_4_0_33 `SyntaxErrorReportable`".

- `abstract-lexer.ts`
  ```ts
  export class LexerSyntaxError extends Error { readonly line: number; readonly column: number; }
  export abstract class AbstractLexer extends Lexer {           // antlr4ng
    protected errorIgnored: boolean; protected tokenIndex: number; protected lastTokenType: number; protected invalidDigitCount: number;
    protected abstract readonly regexCheckTokenTypes: ReadonlySet<number>;
    // override antlr4ng's emit hook (check the antlr4ng d.ts: emitToken(token) vs emit()), mirroring upstream @members emit()
    protected isRegexAllowed(): boolean;
    protected require(condition: boolean, message: string, offset: number, attachPosition: boolean): void; // Groovy SyntaxErrorReportable semantics; message suffix format from Groovy PositionInfo.toString (fetch the source, don't guess)
    protected getErrorLine(): number; protected getErrorColumn(): number;  // getLine(), getCharPositionInLine()+1
  }
  ```
- `abstract-parser.ts`: `export abstract class AbstractParser extends Parser {}`. Optionally add error line and column helpers from the upstream `@members`.
- `semantic-predicates.ts`: `isFollowedBy(cs: CharStream, ...chars: string[]): boolean` and `isFollowedByJavaLetterInGString(cs: CharStream): boolean`. `isValidDirective` is in parser members; see `port.ts`.
- `java-character.ts`: `isJavaIdentifierStart(cp)`, `isJavaIdentifierPart(cp)`, `isIdentifierIgnorable(cp)`, `isUpperCase(cp)` and `toCodePoint(high, low)`.
  - Implement from the Java SE 21 `Character` javadoc definitions (Unicode categories), not from memory.
  - The test fixture is produced by running Java (jshell) locally.
- `parse.ts`
  ```ts
  import type { CompilationUnitContext } from "../generated/ScriptParser.ts";
  import type { CompilationUnitContext as ConfigUnitContext } from "../generated/ConfigParser.ts";
  export type ParseError = { source: "lexer" | "parser"; message: string; line: number; column: number };
  export type ParseOutcome<T> =
    | { ok: true; tree: T; mode: "SLL" | "LL" }
    | { ok: false; error: ParseError; mode: "SLL" | "LL" };
  export function parseScript(text: string): ParseOutcome<CompilationUnitContext>;
  export function parseConfig(text: string): ParseOutcome<ConfigUnitContext>;
  ```
  - This mirrors nf-lang: parse with SLL and `BailErrorStrategy` with no listeners.
  - On `LexerSyntaxError`, return a lexer error and do not retry.
  - Otherwise `seek(0)`, then parse with LL and `BailErrorStrategy`, with one listener capturing the first error.
  - Error wording parity with Groovy's `DescriptiveErrorStrategy` is out of scope (F-104/F-112).
- `src/index.ts`: also `export { parseScript, parseConfig } from "./parser/parse.ts"` and `export type { ParseError, ParseOutcome }`. F-101/F-113 wrap these in the `LanguagePack`.
- `package.json`: `"dependencies": { "antlr4ng": "3.0.16" }`, an exact pin equal to antlr-ng's pin. Root `devDependencies`: `"antlr-ng": "1.0.10"`.
- `tsconfig.json`: `include` gains `"grammar"`.
- `README.md`: one line naming `grammar/`, `src/generated/` and `catalogue/`. Keep it to 10 lines or fewer, still containing "Nextflow 26.10 pack (ADR 0006)".
- `renovate.json`: add a packageRule grouping `antlr-ng` and `antlr4ng` ("move together; then `pnpm gen:grammar 26.10`; test/gen-grammar.test.ts fails until regenerated").

### 1.4 Corpus lint and parse harness

**`tools/corpus/src/lint.ts`** (new; standalone, as ADR 0003 requires)
```ts
export type LintError = { filename: string; startLine: number; startColumn: number; message: string };
export type LintResult = { id: string; sha: string; nextflowVersion: string; filesChecked: number; errors: LintError[] };
export const LINT_CACHE_DIR: string;                                   // <repo>/.cache/corpus-lint
export function parseLintJson(stdout: string): { filesChecked: number; errors: LintError[] }; // filesChecked = filesWithErrors + filesWithoutErrors
export function nextflowVersion(launcher: string): string;             // from `<launcher> -version` ("version 26.10.7 build …")
export function lintDir(launcher: string, dir: string): { filesChecked: number; errors: LintError[] };
//   spawn `<launcher> lint -o json .` with cwd=dir, env NXF_HOME=<repo>/.cache/nextflow/home, NXF_OFFLINE=true;
//   exit 0 or 1 with parseable JSON = result; anything else = Error with the stderr tail
export function isCached(file: string, sha: string, version: string): boolean;
export function lintCorpus(o: { launcher: string; manifest: Manifest; cacheDir: string; fixturesDir: string; force?: boolean; log: (l: string) => void }): LintResult[];
//   one result per pipeline plus id "fixtures" (sha = SHA-256 over the sorted fixture files' names and bytes); writes .cache/corpus-lint/<id>.json
```

**`tools/corpus/src/lint-cli.ts`**: `pnpm corpus:lint [--nextflow <launcher>] [--force]`.
- The launcher comes from `--nextflow`, else env `NXF_LAUNCHER`, else (once F-005 lands) `pnpm nextflow`.
- If none is given, exit 2 with: "pass --nextflow <path to nextflow-<version>-dist> (see AGENTS.md)".
- If a pipeline is missing from the cache, exit 2 with "run pnpm corpus:fetch".
- A second run with the same pins and version prints "up to date" and does not start Java.
- There is no Nextflow version literal in `tools/`.

**`packages/lang-2610/test/corpus/`** (runs only under `pnpm test:corpus`; reads `.cache/` and `tools/corpus/fixtures/` by **path**, never imports `tools/*`)
- `corpus-files.ts` (pure helpers; unit-tested in `pnpm check`):
  ```ts
  export const LINT_EXCLUDES: readonly string[];   // [".git", ".lineage", ".nextflow", ".nf-test", "nf-test.config", "work"]
  export function listSources(dir: string): { path: string; kind: "script" | "config" }[]; // *.nf -> script, *.config -> config, sorted, relative POSIX paths
  export type KnownDifference = { pipeline: string; file: string; lint: "error" | "ok"; parser: "error" | "ok"; cause: string };
  export function loadKnownDifferences(file: string): KnownDifference[]; // validates shape; cause must be non-empty
  export function compare(files, parsed, lint, known): { unexpected: Diff[]; stale: KnownDifference[]; listed: Diff[] };
  ```
- `known-differences.json`: starts with the two semantic fixtures, each with a cause; for example "Nextflow rejects this in its semantic checks (typed/legacy rules), not in the grammar". Add rows only from observed results.
- `parse.corpus.ts`:
  - Parse sarek **first**, for a cold timing.
  - Then parse the other pipelines and the fixtures.
  - Then parse sarek again, for a warm timing.
  - Record per file: ok, mode, ms.
  - Write `.cache/reports/parse-corpus.json` and `.cache/reports/parse-corpus.md`. The Markdown table has: pipeline, files, parsed, pass rate, SLL to LL fallbacks, lint-accepted, differences; plus sarek total, p95 and max per file, both cold and warm, and Node and CPU info.

**Root files**
- `vitest.corpus.config.ts`: `include: ["packages/*/test/**/*.corpus.ts"]`, a long `testTimeout`, a single fork. Add it to the root `tsconfig.json` include.
- `package.json` scripts:
  - `"corpus:lint": "node tools/corpus/src/lint-cli.ts"`
  - `"test:corpus": "vitest run --config vitest.corpus.config.ts"`
  - `"gen:grammar": "node scripts/gen-grammar.ts"`
  - `"gen:catalogue": "node tools/spec-extract/src/cli.ts"`
- AGENTS.md Commands rows for each, added in the same commit as the script; `test/agents-md.test.ts` enforces this. The exact text is in the tasks.

### 1.5 Catalogue

**`tools/spec-extract/`** (new tool)
- `package.json` (`@nf-builder/spec-extract`, scripts `typecheck` and `test`, devDependency `@types/node`), `tsconfig.json` (copy `tools/corpus`'s).
- `README.md`: 10 lines or fewer, containing "Build-time tool (ADR 0003, ADR 0005)".

**`tools/spec-extract/src/SpecExtract.java`**
- A single-file Java program, so there is no Gradle or Maven. Run it as `java -cp <language-server-all.jar> tools/spec-extract/src/SpecExtract.java <outDir>`. This needs a JDK 17 or later.
- Load classes with `Class.forName(name, false, loader)`, so script-side reflection runs no static initialisers.
- Config is taken from `nextflow.lsp.spec.ConfigSpecFactory.defaultScopes()`, exactly what the language server uses: `SpecNode.ROOT` plus `definitions.json`. This does run the jar's own code; the jar is pinned by SHA-256.
- Write compact JSON with `groovy.json.JsonOutput.toJson` (in the jar) to `<outDir>/script.raw.json` and `<outDir>/config.raw.json`. The TypeScript side normalises it.
- Script sections (one generic method dumper: name, `@Description`, `@Deprecated`, overload signatures with generic parameter names and types and return type, varargs):
  - `directives` ← `ProcessDsl$DirectiveDsl`
  - `processSections.inputs` ← `ProcessDsl$InputDslV1`
  - `processSections.outputs` ← `ProcessDsl$OutputDslV1`
  - `processSections.typedOutputs` ← `ProcessDsl$OutputDslV2`
  - `processSections.stage` ← `ProcessDsl$StageDsl`
  - `agentDirectives` ← `AgentDsl$DirectiveDsl`
  - `operators` ← methods of `nextflow.script.types.Channel` and `Value` where any overload has `@Operator`, with `receiver`
  - `factories` ← `ChannelNamespace`
  - `constants` ← `ScriptDsl` methods with `@Constant` (name = the annotation value)
  - `functions` ← other `ScriptDsl` methods
  - `namespaces` ← `Log`, `Workflow`, `Nextflow` and `Manifest` namespaces with their members
  - `types` ← classes under `nextflow/script/types/` and `shim/` with `@Description`, enumerated from jar entries
  - `featureFlags` ← `FeatureFlagDsl` fields: `@FeatureFlag` value, `@Description`, field type, `preview = value.startsWith("nextflow.preview.")`
- Type names: simple class names; `List<String>`, `Map<String, ?>`, `E`, `String...`.

**`tools/spec-extract/src/cli.ts`**: `pnpm gen:catalogue <version> [--check] [--jar <path>]`
```ts
export function packDir(version: string, repoRoot?: string): string;   // same mapping as gen-grammar (copied; tools may not import scripts/)
export function readPin(packDir: string): { tag: string; nfLang: string; url: string; sha256: string };  // reads <pack>/upstream.json by path
export function ensureJar(pin, cacheDir: string): string;   // .cache/language-server/<tag>/language-server-all.jar; download with `curl -fsSL` (honours the proxy); verify SHA-256; mismatch -> Error naming both hashes
export function runExtractor(jar: string, outDir: string): void; // spawn java; ENOENT -> "install a JDK 17+ (java on PATH)"
export function normalise(raw: unknown, source: CatalogueSource): ScriptCatalogue | ConfigCatalogue; // sort by name at every level, trim descriptions, stable signature order
export function serialise(value: unknown): string;          // JSON.stringify(v, null, 2) + "\n"
export function main(argv: readonly string[]): number;     // writes <pack>/catalogue/{script,config}.json; --check compares and exits 1 with
                                                            // "catalogue/<file> differs from the generator output; never hand-edit it, run pnpm gen:catalogue <v>"
```

**`tools/spec-extract/src/docs-compare.ts`**: `node tools/spec-extract/src/docs-compare.ts <version> [--ref <commit>]`
- Fetches the pinned docs pages with `curl` from raw.githubusercontent.com at `upstream.json` `nextflow.commit` into `.cache/docs/<commit>/`.
- Prints a Markdown table: item, docs count, catalogue count, docs-only names, catalogue-only names.
```ts
export function directivesFromTable(mdx: string): string[];    // rows "| [`name`]…"
export function operatorsFromHeadings(mdx: string): string[];  // "## name"
export function callablesFromHeadings(mdx: string): string[];  // "##### `name(" (factories; typed channel and value operators)
export function featureFlagsFromHeadings(mdx: string): string[];
export function compare(docs: readonly string[], catalogue: readonly string[]): { docsOnly: string[]; catalogueOnly: string[]; both: number };
```
- Pages:
  - `docs/reference/process/directives.mdx`
  - `docs/reference/operator.mdx`
  - `docs/reference/stdlib-types/channel.mdx`, and `value.mdx` if it exists
  - `docs/reference/stdlib-namespaces/channel.mdx`
  - `docs/reference/feature-flags.mdx`
  - optionally `docs/reference/config/*.mdx` for scope names

**`packages/lang-core/src/catalogue.ts`** (exported from `lang-core`'s index; types only, so F-109/F-204/FI-01/F-112 share one contract)
```ts
export type CatalogueSource = { generator: "tools/spec-extract"; languageServer: string; nfLang: string; jarSha256: string };
export type Parameter = { name: string; type: string };
export type Signature = { parameters: Parameter[]; returns: string; varargs: boolean; deprecated: boolean };
export type CatalogueEntry = { name: string; description: string; deprecated: boolean; signatures: Signature[] }; // deprecated = every signature deprecated
export type OperatorEntry = CatalogueEntry & { receiver: "Channel" | "Value" };  // deprecated = discouraged with static typing (legacy-only)
export type NamedGroup = { name: string; description: string; members: CatalogueEntry[] };
export type FeatureFlagEntry = { name: string; description: string; type: string; preview: boolean };
export type ScriptCatalogue = {
  source: CatalogueSource;
  directives: CatalogueEntry[];
  processSections: { inputs: CatalogueEntry[]; outputs: CatalogueEntry[]; typedOutputs: CatalogueEntry[]; stage: CatalogueEntry[] };
  agentDirectives: CatalogueEntry[];
  operators: OperatorEntry[]; factories: CatalogueEntry[];
  constants: CatalogueEntry[]; functions: CatalogueEntry[];
  namespaces: NamedGroup[]; types: NamedGroup[]; featureFlags: FeatureFlagEntry[];
};
export type ConfigNode =
  | { kind: "scope"; name: string; description: string; children: ConfigNode[] }
  | { kind: "option"; name: string; description: string; types: string[] }
  | { kind: "placeholder"; name: string; description: string; placeholderName: string; children: ConfigNode[] }
  | { kind: "dsl"; name: string; description: string; dsl: string };
export type ConfigCatalogue = { source: CatalogueSource; scopes: ConfigNode[] };
```

**Generated output:** `packages/lang-2610/catalogue/script.json` and `config.json`. These are generated files; AGENTS.md already lists them. `packages/lang-2610/src/catalogue.ts` imports them with `with { type: "json" }` and exports `scriptCatalogue: ScriptCatalogue` and `configCatalogue: ConfigCatalogue`, but not from `index.ts` yet (F-109).

### 1.6 CI: `.github/workflows/ci.yml` (two jobs, added by tasks 2 and 3)

**`corpus-parse`**, named "Corpus parse vs nextflow lint (F-006, ADR 0005)", `timeout-minutes: 20`:
1. checkout
2. `./.github/actions/setup`
3. `./.github/actions/corpus`
4. `actions/setup-java@<sha> # vX` (temurin, 21)
5. Nextflow:
   - either F-005's composite action, if merged,
   - or a step that downloads `nextflowDist.url` to `.cache/nextflow/` and checks `sha256sum -c` from `upstream.json`, with `actions/cache` keyed on that sha
6. `run: pnpm corpus:lint -- --nextflow "$NXF_LAUNCHER"`
7. `run: pnpm test:corpus`
8. `actions/upload-artifact` of `.cache/reports/`, with `if: always()`

**`catalogue`**, named "Catalogue regenerates without a diff (ADR 0005)", `timeout-minutes: 10`:
1. checkout
2. setup
3. setup-java 21
4. `actions/cache` on `.cache/language-server`, keyed on `hashFiles('packages/lang-*/upstream.json')`
5. `run: pnpm gen:catalogue 26.10 --check`

Pin every action to a full SHA with a `# vN` comment: `test/workflows.test.ts` enforces this. Find SHAs with `git ls-remote https://github.com/actions/setup-java 'refs/tags/v*'`.

## 2. Tests (write first; each fails before its implementation)

Test names carry the IDs. "pc" means the test is in `pnpm check`; "tc" means it runs under `pnpm test:corpus` only.

| # | File | Test name | Asserts |
|---|---|---|---|
| T1 | `test/gen-grammar.test.ts` (pc) | `F-101 step 2 ADR-0005: pnpm gen:grammar 26.10 regenerates packages/lang-2610/src/generated byte-identically` | `checkGenerated` finds no differences (same file list, same bytes) |
| T2 | same | `F-101 step 3 ADR-0005: every generated file starts with a do-not-edit header naming the upstream tag and commit` | Header lines equal `generatedHeader(...)` with `upstream.json` values |
| T3 | same | `ADR-0005: the generator stops when a Java action has no TypeScript port, naming the grammar file` | Temp pack with an extra `{ foo(); }` action makes `applyPort` throw with the file name |
| T4 | same | `ADR-0005: the generator stops when a port entry no longer matches the grammar` | Changed `java` text or occurrence count throws "not found or count changed" |
| T5 | same | `ADR-0005: gen:grammar rejects a version without a pack and lists the packs` | `packDir("99.99")` throws a message containing `26.10` |
| T6 | `packages/lang-2610/test/upstream.test.ts` (pc) | `ADR-0005: vendored grammar files match the SHA-256 in upstream.json` | Hashes match |
| T7 | same | `ADR-0005: grammar/SOURCE.md names the tag and commit recorded in upstream.json` | String containment |
| T8 | `packages/lang-2610/test/java-character.test.ts` (pc) | `ADR-0005: Java Character ports agree with Java 21 on sampled code points` | Fixture `test/fixtures/java-character.json`, generated by a jshell snippet recorded in the fixture's `"generatedBy"` field: ASCII, `$`, `_`, digits, Latin-1, Greek, CJK, emoji, `​`, controls |
| T9 | `packages/lang-2610/test/lexer.test.ts` (pc) | `ADR-0005: a slash after an identifier or closing bracket is division, elsewhere it starts a slashy string` | Token types for `a / b` and `x = /ab+c/` (isRegexAllowed) |
| T10 | same | `ADR-0005: "/*" never starts a slashy string` | `x = /* c */ 1` lexes the comment as NL |
| T11 | same | `ADR-0005: in a GString, "$" starts a path only before a Java letter or "{"` | `"a $b"`, `"a ${b}"`, `"cost $ 5"` |
| T12 | same | `ADR-0005: triple-quoted and empty strings follow the upstream quotation predicates` | `""`, `"""x"""`, `''`, `'''x'''` |
| T13 | same | `ADR-0005: "!in" and "!instanceof" are operators only before whitespace or a bracket` | `a !in b` gives NOT_IN; `!inside` gives NOT plus Identifier |
| T14 | same | `ADR-0005: capitalised and Unicode identifiers lex per Java identifier rules` | `Foo` gives CapitalizedIdentifier; `foo` and `café` give Identifier |
| T15 | same | `ADR-0005: lexer errors from require() carry upstream messages and positions` | `1_` "Number ending with underscores is invalid"; `09` "Invalid octal number"; `#!` on line 2 "Shebang comment should appear at the first line"; a stray control char "Unexpected character" (all with line and column) |
| T16 | same | `ADR-0005: comments are NL tokens that keep their text` | `// x` and `/* y */` |
| T17 | same | `ADR-0005: the config lexer applies the same ported actions` | Representative subset of T9 to T15 on `ConfigLexer` |
| T18 | `packages/lang-2610/test/parse.test.ts` (pc) | `ADR-0005: parseScript accepts typed and legacy processes, workflows, functions and feature flags` | Snippets copied from corpus files; the builder lints any new snippet locally with `nextflow lint` |
| T19 | same | `ADR-0005: a directive without parentheses parses only after an identifier or property path` | `cpus 4` ok; `foo() 4` error (isValidDirective) |
| T20 | same | `ADR-0005: parseScript stops at the first syntax error with line and column, like nf-lang` | `bad-declaration.nf` content inlined; `ok:false`, `source:"parser"`, line 23 |
| T21 | same | `ADR-0005: parseConfig accepts scopes, assignments, selectors, profiles and includeConfig` | Snippet copied from a corpus `nextflow.config` |
| T22 | same | `ADR-0005: a lexer error is reported without an LL retry` | `mode: "SLL"`, `source: "lexer"` |
| T23 | `packages/lang-2610/test/corpus-files.test.ts` (pc) | `F-006 step 2: corpus file listing mirrors nextflow lint's default excludes` | Temp tree containing `.git`, `.nf-test`, `work`, `nf-test.config`, `x.nf.test` |
| T24 | same | `F-006 step 2: compare reports unexpected and stale differences, and requires a cause` | Pure `compare` and `loadKnownDifferences` |
| T25 | `tools/corpus/test/lint.test.ts` (pc) | `F-006 step 2: parseLintJson reads nextflow lint -o json output` | Fixture from the real 26.10.7 output (trimmed rnaseq-nf and fixtures JSON) |
| T26 | same | `F-006 step 2: a cached lint result is reused only when the pin SHA and Nextflow version match` | |
| T27 | same | `F-006: corpus:lint without a launcher exits 2 and says how to provide one` | |
| T28 | same | `F-006: lint output that is not JSON is a failure that shows the stderr tail` | Fake launcher script in a temp dir |
| T29 | `packages/lang-2610/test/corpus/parse.corpus.ts` (tc) | `F-006 step 1: every pinned pipeline and its lint result are present` | Actionable "run pnpm corpus:fetch / corpus:lint" message |
| T30 | same | `F-006 step 1: each pipeline's file list matches the number of files nextflow lint checked` | |
| T31 | same | `F-006 step 1: writes the parse report with pass rate per pipeline and sarek cold and warm parse time` | Report files exist; 5 pipelines plus fixtures; timings > 0 |
| T32 | same | `F-006 step 2 ADR-0005: every file nextflow lint accepts parses, apart from listed differences` | `unexpected` is empty; on failure it lists file, first error and line |
| T33 | same | `F-006 step 2: every listed difference still occurs and states a cause` | `stale` is empty |
| T34 | same | `F-006 step 2: each malformed fixture lint rejects is rejected by the parser or listed with a cause` | |
| T35 | `tools/spec-extract/test/cli.test.ts` (pc) | `ADR-0005: gen:catalogue maps 26.10 to packages/lang-2610 and reads the language server pin` | |
| T36 | same | `ADR-0005: a jar whose SHA-256 differs from the pin is rejected, naming both hashes` | |
| T37 | same | `ADR-0005: normalise and serialise are deterministic (sorted, two-space JSON, trailing newline)` | Shuffled input gives identical bytes |
| T38 | same | `ADR-0005: --check fails on a hand edit and says to regenerate, never hand-edit` | |
| T39 | same | `ADR-0005: a missing java gives an actionable message` | PATH without java |
| T40 | `tools/spec-extract/test/docs-compare.test.ts` (pc) | `F-006 step 3: directives, operators, factories and feature flags are counted from docs reference pages` | Inline MDX samples in the real heading and table formats |
| T41 | same | `F-006 step 3: compare lists names only in the docs and only in the catalogue` | |
| T42 | `packages/lang-2610/test/catalogue.test.ts` (pc) | `ADR-0005: script.json has directives, operators and factories with unique names` | Non-empty arrays, unique names, every operator has a receiver |
| T43 | same | `ADR-0005: config.json has the process, params, profiles, env, plugins and nextflow scopes and the definitions.json scopes` | For example `docker`, `wave` and `aws` |
| T44 | same | `ADR-0005: the catalogue source matches the language server pin in upstream.json` | |
| T45 | same | `F-006 step 3 UX-13: operators discouraged with static typing are flagged deprecated` | At least one operator with `deprecated: true` and at least one without; `map` not deprecated |
| T46 | `test/workflows.test.ts` (pc), extend the existing F-003 test | Job list gains `corpus-parse` (task 2) and `catalogue` (task 3); `blocks.length` becomes 9, then 10; commands list gains `pnpm test:corpus` and `pnpm gen:catalogue 26.10 --check` | Extension, not weakening |
| T47 | same, new | `F-006 step 2 ADR-0005: the corpus-parse job sets up Java and Nextflow, runs corpus:lint then test:corpus, and uploads the report` | Order of steps |
| T48 | same, new | `F-006 ADR-0005: the catalogue job sets up Java, caches the language server jar and fails on a catalogue diff` | |

How each feature step is covered:
- **Step 1:** T29 to T31, plus the report written by the orchestrator.
- **Step 2:** T23 to T28 and T32 to T34.
- **Step 3:** T40 to T45, plus `docs-compare` output in the report.
- **ADR-0005:** T1 to T22, T35 to T39 and T42 to T44.

## 3. Tasks (builder runs, in order; one builder at a time)

### Task 1: vendored grammar, port, generator and parse API

- Vendor the four `.g4` files from `raw.githubusercontent.com/nextflow-io/nextflow/0ad848ef…/modules/nf-lang/src/main/antlr/`. Write `grammar/SOURCE.md` and `upstream.json` from section 0.
- Write tests T1 to T22 first.
- Then implement `grammar/port.ts`, `src/parser/*` and `scripts/gen-grammar.ts`, and run the generator.
- Add dependencies, the tsconfig include, the README line, the Renovate group and the `src/index.ts` exports.
- Fetch the Groovy sources (`SyntaxErrorReportable`, `PositionInfo`) and the nf-lang sources (`AbstractLexer`, `SemanticPredicates`) at their pinned tags from raw.githubusercontent.com before porting. Don't port from memory.
- Check antlr4ng's `.d.ts` for the names of `emit`/`emitToken`, `inputStream`, `text`, `line` and `column`.
- If the generated files fail the pack's strict tsc, have the generator add `// @ts-nocheck`. Hand-written files stay strict.
- Add an AGENTS.md Commands row: `` | `pnpm gen:grammar 26.10` | After changing `packages/lang-2610/grammar/` (vendored `.g4` or `port.ts`): regenerate `src/generated/`; `--check` only compares | ``
- Proof:
  ```
  pnpm install && pnpm gen:grammar 26.10 && git status --porcelain packages/lang-2610/src/generated && pnpm gen:grammar 26.10 --check && pnpm --filter @nf-builder/lang-2610 test && pnpm audit --audit-level high && pnpm check
  ```

### Task 2: corpus lint and parse harness, plus the `corpus-parse` CI job

- Write tests T23 to T28, T46 (count 9) and T47 first.
- Then implement `tools/corpus/src/lint.ts`, `lint-cli.ts`, `packages/lang-2610/test/corpus/*`, `vitest.corpus.config.ts`, the root scripts, and the CI job.
- Add two AGENTS.md rows:
  - `` | `pnpm corpus:lint -- --nextflow <launcher>` | After `pnpm corpus:fetch`: `nextflow lint -o json` on each pinned pipeline and the malformed fixtures into `.cache/corpus-lint/` (needs Java; cached per pin and Nextflow version) | ``
  - `` | `pnpm test:corpus` | After `corpus:lint`, and when touching the parser, model, projection or printer: parse every corpus file, compare with lint, write `.cache/reports/parse-corpus.{json,md}` | ``
- Run the harness. If the port causes failures, add a failing lexer or parse unit test per cause and fix it.
- Only add `known-differences.json` rows for differences that are real and caused by something outside the grammar. Each row needs its cause.
- Proof:
  ```
  pnpm corpus:fetch && pnpm corpus:lint -- --nextflow .cache/nextflow/nextflow-26.10.7-dist && pnpm corpus:lint -- --nextflow .cache/nextflow/nextflow-26.10.7-dist | grep -q "up to date" && pnpm test:corpus && cat .cache/reports/parse-corpus.md && pnpm check
  ```

### Task 3: spec-extract, catalogue and docs comparison, plus the `catalogue` CI job

- Write tests T35 to T45 and T48 first, and T46 again (count 10).
- Then implement `tools/spec-extract/*`, `packages/lang-core/src/catalogue.ts`, `packages/lang-2610/src/catalogue.ts`, the generated `catalogue/*.json` and the CI job.
- Use `javap -cp <jar>` to confirm the class names in **this jar** (26.10.4) before writing the Java code.
- Add an AGENTS.md row: `` | `pnpm gen:catalogue 26.10` | Regenerate `packages/lang-2610/catalogue/*.json` from the pinned language server jar (needs a JDK 17+); `--check` compares; CI job `catalogue` runs it on every PR | ``
- Proof:
  ```
  pnpm gen:catalogue 26.10 && git status --porcelain packages/lang-2610/catalogue && pnpm gen:catalogue 26.10 --check && node tools/spec-extract/src/docs-compare.ts 26.10 && pnpm check
  ```

### Task 4 (only if needed): fix-ups from tasks 2 and 3 or from the reviewer

- Examples: port bugs the corpus exposed that task 2 couldn't finish, or catalogue gaps with a fixable cause.
- Each fix comes with a test that failed first.
- Proof: `pnpm test:corpus && pnpm gen:catalogue 26.10 --check && pnpm check`

### Orchestrator steps (not builder work)

1. **Before task 1:**
   - settle O1 to O7 and O9;
   - start `feat/F-006` (after F-009 merges, rebase on `main`).
   - The ADR(s) can be drafted now and finished with the results.
2. **After each task:**
   - run `pnpm check` yourself, then commit (`feat(lang-2610): …`, `feat(corpus): …`, `feat(spec-extract): …`);
   - AGENTS.md rows go into the same commit as their scripts.
3. **After task 2:**
   - keep `.cache/reports/parse-corpus.md`;
   - check the sarek cold and warm timings;
   - if any file fails, ask `researcher` for the cause before task 4.
4. **After task 3:** keep the `docs-compare` table output.
5. **Write the docs:**
   - **Report:** `docs/research/2026-11-21-spike-s2-parser.md` (or dated on completion). Cover setup and pins; the port (number of actions, approach); a parse table per pipeline; sarek time (cold and warm, Node and CPU; note QA-03 is measured in F-113 inside a worker with the model); the lint comparison with fixture rows and causes; catalogue counts against docs, with each gap explained (legacy operators missing from nf-lang, `groupBy`, `previewRecursion`, `fromSRA` if deprecated, the 26.10.4 vs 26.10.7 skew); limits (one error per file, message wording not matched); follow-ups for F-101, F-102 (comments are NL tokens), F-104 and F-109.
   - **ADR 0005:** append a `## Spike result` section.
   - **New ADR(s), `Accepted (agent)`:** see O1 to O6.
   - **`docs/adr/README.md`:** add the new ADR(s).
   - **`docs/licences.md`:** add rows for the generated parser, the ported base classes, the catalogue text and antlr4ng (see O7).
   - **AGENTS.md:** "Still to come" paragraph.
   - **progress.md:** add the entry with its Decisions.
   - **features.json:** F-006 `passes` and `notes`. Notes should say that F-101 steps 2 and 3 are already covered by T1 and T2.
6. **PR:** use the template and cite ADR-0005; watch CI with `gh pr checks --watch`. Then run `reviewer`, then `simplifier`, and merge when CI is green and the review raises nothing blocking.

## 4. Open points

### Need a recorded decision (AGENTS.md "Decide and record")

- **O1. New runtime dependency.**
  - `antlr4ng@3.0.16` (BSD-3-Clause) in `@nf-builder/lang-2610`, and dev dependency `antlr-ng@1.0.10` (MIT, no Java).
  - Pin both exactly: antlr-ng pins the runtime, so they move together (Renovate group).
  - Both last released in 2025, so there is a maintenance risk; record it.
  - You said you'll write this ADR.
- **O2. Workflow edits:** two new `ci.yml` jobs (`corpus-parse`, `catalogue`), with `actions/setup-java` pinned by SHA.
  - Should both block merges? I recommend yes, since they are cheap: about 1 minute and about 2 to 3 minutes.
  - `workflow_dispatch` regeneration stays with F-109.
- **O3. Catalogue version skew.**
  - The latest 26.10 language server, v26.10.2, embeds nf-lang **26.10.4** and the Nextflow 26.10.4 runtime and plugins. Grammar and lint use **26.10.7**.
  - The grammar is identical between the two (verified). nf-lang is not on Maven Central, so there is no cheap 26.10.7 route.
  - Recommendation: accept v26.10.2 as "the language server for the 26.10 pack", record both pins in `upstream.json` and the catalogue's `source`, and amend ADR 0005's "for the pack's version" in the spike result.
- **O4. spec-extract build and run.**
  - It is a single-file Java program run with `java -cp jar File.java`: no Gradle or Maven, needs a JDK 17 or later.
  - Script-side reflection uses `initialize=false`. Config deliberately calls the language server's own `ConfigSpecFactory.defaultScopes()`, which runs jar code; the jar is pinned by SHA-256.
  - ADR 0005 says "CI only"; ADR 0018 already allows local runs. Record it.
- **O5. Build-time network hosts** (ADR 0017: "recorded in the ADR that adds them"):
  - GitHub release downloads: `github.com` redirecting to `release-assets.githubusercontent.com` or `objects.githubusercontent.com`, for the language server jar and the Nextflow dist;
  - `raw.githubusercontent.com`, for docs-compare and the grammar update procedure.
- **O6. Where version pins live, and coordination with F-005.**
  - The plan puts the Nextflow version, grammar, language server and dist pins in `packages/lang-2610/upstream.json` (pack-owned, for LA-02 and ADR 0006).
  - F-005, being planned, adds a `pnpm nextflow` wrapper and "pins the version". Agree one home before either is built.
  - Recommendation: `upstream.json`, with F-005's wrapper reading it. Whichever feature lands first creates it.
  - Until F-005 lands, `corpus:lint` takes `--nextflow`/`NXF_LAUNCHER`, and the CI job downloads the dist itself.
  - If F-005 merges first, reuse its wrapper and action instead.

### Licensing (`docs/licences.md`)

- **O7. Apache-2.0 obligations.**
  - Upstream ships a `NOTICE` file. Apache-2.0 §4(d) applies to redistributed derivative works: the vendored grammars, the generated parser, the ported base classes, and the catalogue (Nextflow's own description text).
  - Proposal: add `packages/lang-2610/grammar/NOTICE` (upstream copy) and `LICENSE` (Apache-2.0 text), keep attribution headers in ported files, and add licences.md rows for the generated parser, ported classes, catalogue and antlr4ng.
  - Later, the shipped web bundle will need a third-party notices page; say which feature owns it.
  - A licence or format decision is yours to make.

### Undecided in the spec, or worth confirming

- **O8. Committing the generated parser.** It is about 830 KB of TypeScript. F-101 step 2 implies it is committed. It is not in the web bundle until the engine worker uses it (QA-01 excludes workers until F-702). Confirm.
- **O9. `// @ts-nocheck` on generated files** if antlr-ng output fails `strict` (`localContext` may be null, and so on). Hand-written code stays strict, and lexer and parse tests cover the actions. Accept as a generator rule?
- **O10. Scope overlap with F-101.**
  - This plan delivers F-101 steps 2 and 3 now (T1 and T2) because they cost little.
  - F-101 keeps `passes: false` until its own step 1.
  - F-006's notes say so.
- **O11. F-101 is under-specified.** It says "lexer tests ported from upstream nf-lang tests", but nf-lang v26.10.7 has **no lexer tests**: only `ScriptAstBuilderTest` (21 cases), `ConfigAstBuilderTest` and `AgentParserTest`. Before F-101 is planned, decide what "ported lexer cases" means. Options: the parse cases from those three, Groovy's lexer tests, or our T9 to T17.
- **O12. What step 2 means in practice.**
  - Lint 26.10.7 accepts all 570 corpus files, so step 2 is "570/570 parse", or each exception is listed with a cause.
  - The converse comparison uses the malformed fixtures. Two of them (`typed-legacy-mixed.nf`, `typed-without-flag.nf`) are semantic rejections that a grammar parser should accept.
  - `section-order.nf` may also be rejected only after the grammar stage; the harness will show.
  - The plan treats listed-with-cause differences as passing step 2.
  - Confirm that a spike with a parse rate below 100% still counts as F-006 done when every failure is explained. I'd say yes for a spike, but say so in `notes`.
- **O13. Which docs pages count for step 3.**
  - Operators have two reference pages: `operator.mdx` (47, legacy-inclusive) and `stdlib-types/channel.mdx` (13 typed).
  - Recommendation: report both. The catalogue is expected to equal nf-lang's model (typed plus deprecated-legacy), and the 18 legacy-only operators that nf-lang doesn't model are the explained gap.
  - Docs are read from the GitHub sources at v26.10.7. This assumes docs.seqera.io renders those sources, which can't be checked from the sandbox.
- **O14. QA-03.**
  - The spike measures raw parse time in Node, not in a worker and without the model. QA-03's 3 s budget stays with F-113.
  - If sarek cold parse alone is already near 3 s, flag it in the report as a risk for M1.
- **O15. Lint results are cached, not committed** (`.cache/corpus-lint/`), regenerated in CI in about 30 s.
  - Alternative: commit a lint snapshot as a new generated file, which would let `test:corpus` run without Java.
  - Recommendation: cache. That adds no new generated-file category.
- **O16. The preview `agent` block.** The catalogue includes `agentDirectives` and the `agent` config scope. Whether the palette shows them is still Q4 (F-204); nothing is decided here.
