# Plan: F-104, lossless round trip with declaration-level fallback

Planner output, 2026-11-22. Read-only: no repo or worktree was changed. Based on `main` at `ce703a0` (F-204 merged), `feat/F-102` at `ade6c6c` plus its uncommitted task-5 work (the whole-script checks in `src/ast/build/script.ts`), and `feat/F-103` at `202e9e7` (stacked on F-102's `83511c3`). F-104 starts only after both have merged (`depends_on`); every F-102/F-103 name below was checked against those branches, and section 1.5 lists what may still move.

## 0. Scope in one paragraph

F-104 turns the F-102/F-103 ASTs into a lossless per-file model. A pack parser parses each file whole. When that fails, a hand-written, brace-aware pre-scanner splits the text into top-level chunks; each chunk is parsed on its own and its ranges are shifted back to file positions; a chunk that still fails becomes an `Unparsed` node holding its exact text. A file where nothing can be modelled is kept verbatim. Items that parse but carry builder errors become `Unparsed` too, so the model never holds a declaration the builder changed or dropped. The engine wraps the result in a `SourceFile` (AR-01) and adds `printSourceFile` (each untouched item from its source slice, so an unedited file prints byte for byte) and `equivalent` (the spec glossary's definition). The parser reaches the engine only through a lazy `LanguagePack.loadParser()`, so it stays out of the initial bundle. Step 1 is a corpus test over all 570 corpus files plus the fixtures. Step 2 is a fixture test over `tools/corpus/fixtures/fixtures.yaml`, backed by corpus properties showing the pre-scanner is right on real code. Nothing is user-visible; one Playwright assertion checks that the parser stays in a lazy chunk.

## 1. Findings

### 1.1 Spec and ADRs
- **ADR 0004** (Accepted): files are authoritative. What can't be modelled is kept: a whole file "(fails the strict grammar)" as verbatim text, shown with an error badge in the Code tab only; one declaration as "raw text, isolated by a brace-aware pre-scanner", shown as an "unparsed" node. Untouched code stays *equivalent*; byte identity is not required.
- **Glossary, "Equivalent"**: same AST ignoring source positions and whitespace, and the same comments in the same order. Unparsed text is compared after normalising line endings and trailing whitespace.
- **IO-14**: import never fails because of code the app can't model. Only I/O errors and limit breaches (1 MB per text file, IO-12) abort an import.
- **IO-20**: exported files the user didn't change are equivalent to what was imported. Export itself is F-404, which builds on F-104's print and equivalence.
- **AR-01**: `SourceFile` holds path, text, language (`nextflow`, `config`, `json`, `yaml`, `markdown`, `text`), parse status, AST and comment map. F-102 and F-103 both left `SourceFile` to F-104 (their plans' open points 9 and 13).
- **ADR 0027** (on `feat/F-102`): AST types live in lang-core and builders in the pack. Ranges are UTF-16 offsets with 1-based lines and code-point columns. The AST is in memory only. "The parser and builders stay off the pack entry until the engine worker loads them (F-104, F-113)."
- **ADR 0028**: `LanguagePack.loadCatalogue()` uses a dynamic import, so the catalogue is a lazy chunk. The engine memoises per pack (`loadPalette`). F-104 copies this pattern.
- **ADR 0003 and Q10**: the engine may import only lang-core and a pack's `src/index.ts`. A pack may import only lang-core. A dynamic import inside the pack entry is the pack importing itself, which dependency-cruiser allows.
- **LA-02**: no Nextflow version literals outside `packages/lang-*`. Declaration keywords and nf-lang messages are pack knowledge, so the scanner and the isolation rules live in the pack.

### 1.2 The fixtures and what `nextflow lint` 26.10.7 says (`.cache/corpus-lint/fixtures.json` in `wt-F-103`)

| Fixture | Lint (first error) | Whole-file parse | Expected (fixtures.yaml) | Mechanism |
|---|---|---|---|---|
| `unclosed-comment.nf` | 2:1 Unexpected input: '/' | fails | `wholeFile: true` | pre-scanner sees no declaration outside the comment |
| `bad-declaration.nf` | 23:18 Unexpected input: '=' | fails | unparsed `process SECOND`; modelled `process FIRST`, `workflow` | chunking |
| `section-order.nf` | 8:10 Unexpected input: ':' | **ok** (grammar), builder: reparse gives `InvalidDeclaration` + 8:10 | unparsed `process LATE_INPUT`; modelled `process ON_TIME` | builder-error isolation |
| `unclosed-brace.nf` | 17:1 Unexpected end of file | fails | unparsed `workflow`; modelled `process SAY_HELLO` | chunking (chunk runs to EOF) |
| `typed-legacy-mixed.nf` | 19:5 Invalid input declaration in typed process (+2 resolver errors) | **ok**, builder error 19:5 | unparsed `process GOODBYE`; modelled `featureFlag nextflow.enable.types`, `process HELLO` | builder-error isolation |
| `typed-without-flag.nf` | 4:5 Typed input declaration is not allowed in legacy process ... (+1 resolver) | **ok**, builder error 4:5 | unparsed `process HELLO`; modelled `process GOODBYE` | builder-error isolation |
| `unknown-scope.config` | ok | ok | all three modelled | none |
| `bad-config-block.config` | 6:1 Unexpected input: '}' | fails | unparsed `block process`; modelled `assign docker.enabled`, `assign params.outdir` | chunking |
| `unclosed-config-block.config` | 8:1 Unexpected end of file | fails | unparsed `block profiles`; modelled `assign params.outdir` | chunking |

So the fallback has two tiers: (a) when the grammar fails, chunk; (b) when the grammar accepts the file, isolate the items that carry builder errors. Tier (b) needs F-102's builder errors (its task 5: reparse into `InvalidDeclaration`, plus the typed/legacy input errors). F-102's plan already tests these three fixtures (`ported-builder.test.ts`).

**Why the scanner is hand-written.** The generated lexer doesn't treat an unclosed `/*` as a comment: `ML_COMMENT` needs `*/`, so `/*` lexes as `/` then `*` (hence lint's "2:1 Unexpected input: '/'"). A token-based scanner would then find `process SAY_HELLO` at line start and model it, which contradicts `wholeFile: true`. A hand-written scanner treats an unterminated block comment as running to the end of the file, as the fixture's author intended. It also never throws, has no recursion (deep nesting is safe), and needs no ANTLR.

### 1.3 Corpus
- 5 pins: rnaseq 253, sarek 275, fetchngs 28, rnaseq-nf 7, rnaseq-nf-typed 7, so 570 `.nf`/`.config` files plus 9 fixtures. All 570 corpus files are lint-clean and parse whole (F-006 report; `known-differences.json` lists only the 3 fixtures above). So step 1 runs mostly through the whole-file path. The fallback is checked on real code by forcing the chunk path on every corpus file (5.6).
- Timing: sarek takes 18.1 s cold and 1.2 s warm per pass in Node. `vitest.corpus.config.ts` runs each `packages/*/test/**/*.corpus.ts` in its own fork, so each new corpus file pays the cold start once. The `corpus-parse` job (20 min timeout) runs `pnpm corpus:lint && pnpm test:corpus` unchanged. No workflow edit is needed.

### 1.4 Code facts
- `parseScriptAst(text): ScriptParseResult` and `parseConfigAst(text): ConfigParseResult` live in `packages/lang-2610/src/ast/index.ts`, not on the pack entry. Both return `{ok:true, ast, errors}` or `{ok:false, errors}` (`lang-core/src/ast/parse-result.ts`). `ScriptAst = { kind:"Script", shebang, body: ScriptItem[], comments, typesEnabled, range }` and `ConfigAst = { kind:"ConfigFile", statements, comments, range }`. F-103's config comments are collected into `ast.comments`; slot attachment is a TODO until F-102's attacher is reused. F-104 compares the ordered list only, so this doesn't block.
- `buildScript` (F-102, uncommitted task 5) makes whole-script checks that depend on other declarations, not the node itself: "Output block defined more than once", "Params block defined more than once", "Params block cannot be mixed with legacy parameter declarations", "Legacy parameter declarations cannot be mixed with the params block", "Entry workflow defined more than once", "Statements cannot be mixed with script declarations ...", and "Params/Output block cannot be defined without an entry workflow". It also **drops** a legacy parameter when types are enabled (`scriptDeclaration` returns null, error at the node), so that text belongs to no item.
- `BuildContext.typesEnabled` starts `false` and is set by the feature flag (`declarations.ts:121`). `ScriptAst.typesEnabled` is the final value.
- Positions: antlr4ng counts code points and advances lines on `\n` only. `PositionIndex` (`src/ast/positions.ts`) maps code points to UTF-16 offsets. A chunk that starts right after `\n` has its first line start at column 1, so moving it to file positions only shifts offsets and lines; columns don't change.
- The engine's `tsconfig.json` has no `node` types (lang-2610's has, for its corpus tests). An engine corpus test needs them (open point 12).
- `packages/engine/src/palette.ts` is the memoisation pattern (`WeakMap<LanguagePack, Promise<...>>`; a rejected load is forgotten).
- antlr4ng's dist has one URL, in a comment (minification removes it). The generated parser has none. `pnpm check:hosts` must still be run on the new lazy chunk (task 3a).
- `tools/corpus/test/fixtures.test.ts` (F-009) already validates `fixtures.yaml` and its declaration names. F-104 only consumes it.

### 1.5 What may still move in F-102/F-103 before F-104 starts
- F-102 task 5 (builder errors, the reparse) is uncommitted at `ade6c6c`. F-104's tier (b) depends on its messages and positions for the three grammar-accepted fixtures.
- F-102's `coverage.test.ts` excludes the error-only kinds (`Import`, `IncompleteDeclaration`, `InvalidDeclaration`, `IncompleteExpression`). F-104 adds `Unparsed` to that set (3.2, open point 3).
- F-103's comment slots (its TODO) may land with or after F-102's merge. Nothing here depends on them.

## 2. What "print" and "equivalent" mean here (confirmed)

- **Print** serialises the model back to text: each top-level item is emitted from its source slice (an `Unparsed` item from its kept text), and the trivia between items comes from the file text. With no edits, the output is the input byte for byte, which is stronger than equivalence. F-110's printer is not involved: it prints only new or edited declarations, which F-111 will splice in. ADR 0004 ("files are the source of truth") makes source slices the right output for untouched code. Step 1 is achievable without F-110.
- Byte identity on its own would be close to vacuous, so step 1 also checks three things:
  - the printed text, parsed again, is `equivalent` to the original model (the glossary check, which F-111's AR-22 property tests and F-404's IO-20 export test will reuse);
  - the model accounts for every character: outside item ranges there is only whitespace, `;` and comments from the comment map;
  - every lint-clean file is fully modelled.
- **Equivalent** (`engine/src/source/equivalent.ts`):
  - Same language and the same status family: both modelled or partial, or both verbatim, or both plain.
  - Verbatim and plain files compare `normaliseText(text)`: `\r\n` and lone `\r` become `\n`, trailing spaces and tabs are stripped from every line, and trailing newlines at the end are removed.
  - Modelled and partial files compare their ASTs by deep equality after:
    - dropping every Range-shaped value (`range`, `labelRange`, `elseRange`, and any future one, detected structurally) and the comment slots, `comments` and `shebang`;
    - comparing `Unparsed` nodes by `normaliseText(text)` and `head`, ignoring `problems`;
    - normalising `\r\n` and lone `\r` to `\n` inside every other string field. Groovy removes CR from multi-line strings, so a CRLF checkout stays equivalent.
  - Comments compare as the ordered list `[shebang?, ...comments]` of `(kind, normaliseText(text))`. Slots are not compared: the glossary asks only for "same comments in the same order", and whitespace changes can move a comment between trailing and leading.
  - The result carries a reason naming the first differing path (for test messages).
  - These interpretations go in the ADR (open point 6).

## 3. Design

### 3.1 Where things live, and how the parser stays off the main thread

| Piece | Package | Why |
|---|---|---|
| `Unparsed`, `DeclarationHead`, `SourceFile` family, `SourceParser`, `SourceParse<Ast>`, `ParseStatus`, `SourceLanguage`, `LanguagePack.loadParser` | `lang-core` | Model types (ADR 0003); engine and pack both need them |
| Pre-scanner, chunk parsing, offset shifting, builder-error isolation, gap repair | `lang-2610` (`src/source/`) | Grammar- and version-specific (LA-02); needs the internal builders |
| `languageOf`, `loadParser`, `createSourceFile`, `printSourceFile`, `equivalent`, `verifyModel` | `engine` (`src/source/`) | Version-independent model, printing and comparison (ADR 0003: engine does "parse, model ... printing") |

**Lazy entry.** `pack.loadParser = async () => (await import("./source/index.ts")).parser`. The pack entry keeps no static import of `./ast`, `./parser`, `./source`, `./generated` or `antlr4ng`; a unit test reads `src/index.ts` and checks this, and an e2e test checks the built manifest. The engine's `loadParser(version)` memoises per pack, as `loadPalette` does. Nothing on the main thread calls it in F-104 (no UI uses it yet). F-113 calls it inside the worker, unchanged: `createSourceFile` is synchronous once it has a parser, and its result is plain data. This replaces the architecture sketch's synchronous `parseScript`/`parseConfig` on `LanguagePack`, which is marked "to be fixed in M1"; the sketch is updated and recorded in the ADR (open point 2).

### 3.2 `SourceFile` model (AR-01), in memory only

```ts
// packages/lang-core/src/ast/unparsed.ts
/** What the pre-scanner recognised at the start of a top-level item. */
export interface DeclarationHead {
  /** Scripts: featureFlag, include, import, params, param, record, enum, agent, process, workflow, output, function.
   *  Configs: assign, block, includeConfig, invalid. */
  readonly keyword: string;
  /** "SECOND", "nextflow.enable.types", "docker.enabled", "profiles"; null for an entry workflow, params/output blocks, includes. */
  readonly name: string | null;
}
/** A top-level declaration or statement the pack could not model, kept as its exact text (ADR 0004). Never built by the AST builders. */
export interface Unparsed extends NodeBase<"Unparsed"> {
  /** Exact source text: `text.slice(range.start, range.end)`. */
  readonly text: string;
  readonly head: DeclarationHead | null;
  /** Why: the chunk's parse errors, or the builder errors inside the item. */
  readonly problems: readonly ParseProblem[];
}
```
- `script.ts`: `ScriptItem = Declaration | Statement | InvalidDeclaration | Unparsed`. `SCRIPT_NODE_KINDS` gains `"Unparsed"` (its type test forces this).
- `config.ts`: new `ConfigItem = ConfigStatement | Unparsed`; `ConfigAst.statements: readonly ConfigItem[]`. Nested `ConfigBlock.statements` stay `ConfigStatement[]`.
- `parse-result.ts`: `ParseProblem.source` gains `"internal"` (a caught exception, open point 9). It also gains `readonly scope?: "file"`, set by F-102's whole-script checks, so they never isolate a declaration (open point 4).

```ts
// packages/lang-core/src/source-file.ts
export type SourceLanguage = "nextflow" | "config" | "json" | "yaml" | "markdown" | "text";
/** modelled: every top-level item is in the AST. partial: some are Unparsed. verbatim: nothing could be modelled and the text is kept as is (ADR 0004, first row). plain: not a Nextflow file, so not parsed. */
export type ParseStatus = "modelled" | "partial" | "verbatim" | "plain";
export type SourceParse<Ast> =
  | { readonly status: "modelled" | "partial"; readonly ast: Ast; readonly problems: readonly ParseProblem[] }
  | { readonly status: "verbatim"; readonly ast: null; readonly problems: readonly ParseProblem[] };
export type ScriptSourceParse = SourceParse<ScriptAst>;
export type ConfigSourceParse = SourceParse<ConfigAst>;
/** A pack's parser with declaration-level fallback (ADR 0004). Never throws, whatever the input (IO-14). */
export interface SourceParser {
  parseScript(text: string): ScriptSourceParse;
  parseConfig(text: string): ConfigSourceParse;
}
interface SourceFileBase {
  readonly path: string;                        // project-relative POSIX path
  readonly text: string;                        // exact text, authoritative (ADR 0004)
  readonly problems: readonly ParseProblem[];   // the whole-file parse's errors (lint parity); [] for plain files
  readonly comments: readonly Comment[];        // AR-01 comment map: ast.comments, [] when ast is null
}
export interface ScriptSourceFile extends SourceFileBase { readonly language: "nextflow"; readonly status: Exclude<ParseStatus, "plain">; readonly ast: ScriptAst | null }
export interface ConfigSourceFile extends SourceFileBase { readonly language: "config"; readonly status: Exclude<ParseStatus, "plain">; readonly ast: ConfigAst | null }
export interface PlainSourceFile extends SourceFileBase { readonly language: "json" | "yaml" | "markdown" | "text"; readonly status: "plain"; readonly ast: null }
export type SourceFile = ScriptSourceFile | ConfigSourceFile | PlainSourceFile;
```
`LanguagePack` gains `loadParser(): Promise<SourceParser>`. Invariants for every non-null AST:
- top-level items are sorted and don't overlap;
- each `Unparsed.text` equals its slice;
- every comment in `ast.comments` lies outside all `Unparsed` ranges and sits in exactly one slot;
- outside item ranges there is only whitespace, `;` and those comments.

`createSourceFile` checks these with `verifyModel`; a failure downgrades the file to verbatim with an `internal` problem.

### 3.3 The algorithm (`packages/lang-2610/src/source/parse-source.ts`)

```
parseScriptSource(text):
  try whole = parseScriptAst(text)                          // exceptions caught: whole = failed with an "internal" problem
  if whole.ok: return finish(isolate(whole.ast.body, whole.errors), whole.errors, failed = false)
  return parseScriptChunks(text, whole.errors)

parseScriptChunks(text, problems):
  typesEnabled = false; items = []; comments = []; shebang = null; dangling = []
  for chunk in prescan(text, "script").chunks:
    slice = text.slice(chunk.start, chunk.end)
    try r = parseScriptAst(slice, { fragment: true, typesEnabled })   // catch: r = failed, "internal"
    if r.ok:
      ast = shiftPositions(r.ast, { offset: chunk.start, line: chunk.line - 1 })
      (its, cs) = isolate(ast.body, shiftPositions(r.errors, ...), text, "script", ast.comments)
      items += its; comments += cs; typesEnabled = ast.typesEnabled
      shebang ??= ast.shebang; dangling += ast.danglingComments ?? []
    else:
      items += Unparsed{ range: [chunk.codeStart, last non-whitespace in chunk), text, head: chunk.head,
                         problems: shifted r.errors, leadingComments: chunk.leadingComments }
      comments += chunk.leadingComments
  modelled = count of items that are not Unparsed
  status = statusOf(modelled, unparsed, failed = true)       // verbatim when modelled == 0
  verbatim -> { status, ast: null, problems }
  else     -> { status, ast: { kind: "Script", range: whole text, shebang, body: items, comments (by start),
                               typesEnabled, danglingComments: dangling }, problems }
```
- `statusOf(m, u, failed)`: `"verbatim"` if `m === 0 && (u > 0 || failed)`; else `"partial"` if `u > 0`; else `"modelled"`. An empty or comment-only file that parses is `modelled`. `unclosed-comment.nf` gives a comment-only chunk 0 plus an `Unparsed` tail, so it is `verbatim`. A file whose items all have builder errors is also `verbatim`.
- Configs use the same flow with `parseConfigAst`; they have no `typesEnabled` and no shebang.
- **Whole first, chunks only on failure.** A whole parse keeps exact upstream semantics (whole-script checks, comment attachment, lint-parity errors). The cost is at most two parses of a failing file. The file's `problems` stay the whole-file errors (lint reports one syntax error); each `Unparsed` keeps its own chunk errors.
- **Slicing plus shifting, not masking** (open point 7). Parsing each chunk sliced keeps the total cost linear. Masking everything outside the chunk would give file positions for free but cost O(n x chunks), up to tens of GB of lexing for a 1 MB file of one-line includes. `shiftPositions` copies the result with a memo map, so shared objects (comments referenced from both `comments` and a slot) stay shared and nothing is shifted twice. Every Range-shaped object gets `start/end += offset` and `line/endLine += line`; every ParseProblem gets `line/endLine += line`. Columns don't change because chunks start right after `\n`.
- **Fragment mode** (`parseScriptAst(text, { fragment: true, typesEnabled })`, a change to F-102's code):
  - seeds `cx.typesEnabled`;
  - skips the whole-script checks (they depend on the other chunks; open point 8);
  - keeps the reparse into `InvalidDeclaration`, every per-node error, and the deferred number-format failure.
- **typesEnabled** carries forward from modelled chunks only. If the feature-flag chunk is broken, later typed processes build as legacy, report builder errors and become `Unparsed`. Nextflow wouldn't enable types either.
- **Exceptions.** Any exception from the parser or builder (for example `RangeError` from 20k nested parentheses in antlr4ng's recursive descent) becomes that chunk's `Unparsed` with a problem `{ source: "internal", message: "The parser could not process this text: <message>" }`. The pre-scanner is iterative and can't overflow.

### 3.4 Isolation and gap repair (`packages/lang-2610/src/source/isolate.ts`)

`isolate(items, problems, text, grammar, comments)` returns `{ items, comments }`:
1. An item becomes `Unparsed` when it is an `InvalidDeclaration`, or when a problem without `scope: "file"` starts inside its range (problem line and column compared with the range's). The replacement keeps `range` and gets `text = slice`, `head = scanHead(text, range.start, grammar)` (so `section-order.nf` gives `process LATE_INPUT`), `problems` = those inside, and the replaced node's `leadingComments` and `trailingComments`. Its dangling and inner comments lie inside the range and stay in the text.
2. **Gap repair.** Between consecutive items, and before the first and after the last, `codeSpan(text, from, to, grammar)` finds any code that isn't whitespace, `;` or a comment. This is text the builder dropped, such as a legacy parameter with types enabled. Each such span becomes an `Unparsed` with the problems inside it. This makes the losslessness invariant hold by construction.
3. Root `comments` keeps only comments outside every `Unparsed` range.

The same function serves the whole-file path and each chunk that parses with builder errors.

### 3.5 The pre-scanner (`packages/lang-2610/src/source/prescan.ts`)

A single pass over UTF-16 units with an explicit stack (`(`, `[`, `{`, `${` returning to `"` or `"""`). It never throws, never recurses, and is linear apart from bounded slashy lookahead. Chunks tile `[0, text.length)` with no gaps. Each chunk start is 0 or just after a `\n`.

**Lexical states** (from `ScriptLexer.g4`, whose string rules are identical in `ConfigLexer.g4`):
- `//` runs to the line end, excluding `\r` and `\n`.
- `/* ... */`, including `/**`; unterminated, it runs to EOF.
- A shebang `#!` at offset 0 runs to the line end, as do immediately following `#!` lines (SH_COMMENT).
- `'...'` and `"..."` can't span lines: unterminated, they end at the line terminator. `\` escapes.
- `'''...'''` and `"""..."""` span lines. In a run of n >= 3 quotes the last three close (the lexer's `TsqStringCharacter`/`TdqStringCharacter` predicates); unterminated, they run to EOF.
- GString `${` pushes a code frame; the matching `}` resumes the string. `$name.path` is plain text; `\$` is an escape.
- **Slashy** `/.../` only when a regex is allowed, which the lexer's `isRegexAllowed` decides from the last default-channel token. A regex is *not* allowed after `}`, `]`, `)`, a closing quote, `null`, `true`/`false`, a number, or a non-keyword identifier. It is allowed after newlines, comments, operators and keywords. `/` followed by `/` or `*` is a comment. The scan stops at an unescaped `/` (a string), and treats the `/` as an operator if it hits `$` followed by an identifier start, `\u0000` or EOF, as the lexer does (`SlashyStringCharacter`). Slashy strings may span lines.
- `\` followed by a newline in code is a line escape (WS), so the next line isn't a line start.
- Line terminators: `\r\n`, `\n`, lone `\r` (`LineTerminator`). Only positions just after `\n`, or 0, may be chunk starts.
- Mismatched closers pop to the matching opener if one is on the stack; otherwise they are ignored. An extra `}` at depth 0 is ignored.

**Boundaries in scripts.** A new chunk starts at `lastCodeLineEnd`: the position after the first line terminator in code state that follows the last code character. Comment-only and blank lines between declarations therefore go to the next chunk as leading trivia, matching nf-lang's `CommentAttacher` (a module-level comment leads the following declaration), and a same-line trailing comment stays with the previous chunk. A boundary is placed:
- **(S1)** after a line whose last code token is a `}` that brought the depth to 0 (only `;`, whitespace or comments after it on that line), unless the next code line starts with a continuation token;
- **(S2)** before a line whose first token at depth 0 is a starter, unless the previous code line ends with a continuation token. The starter keywords are `process`, `workflow`, `agent`, `record`, `enum`, `output`, `params`, `include`, `import`, `nextflow` and `def`, followed by whitespace, `{` or EOF; `params` and `nextflow` may also be followed by `.`, and `workflow` never by `.`. A legacy-typed function head also counts: `Type Word (`, where `Type` is a capitalised or primitive word with optional `.parts`, `<...>` and `[]`;
- **(S3)** before an unterminated block comment that starts at depth 0 as the first token on its line, so a truncated doc comment doesn't sink the declaration before it.

Never at a lone `\r`, and never before a line starting with `#` (a mid-file `#!` would otherwise parse as a shebang in its chunk).

**Boundaries in configs.**
- **(C1)** before a line whose first token at depth 0 is a word (identifier, built-in type, `includeConfig`, `if`, `try`, `def`) or a quote, unless one of the continuation guards below applies;
- **(C3)** the same as S3.

**Continuation guards.**
- The previous code line ends with an operator-like token: any binary or assignment operator, `,`, `.`, `?.`, `*.`, `?`, `:`, `?:`, `->`, `!`, `~`, or a keyword (`in`, `as`, `instanceof`, `new`, `return`, `else`, ...).
- The next line starts with `.`, `?.`, `*.`, `?`, `:`, `*` (not `*/`), `%`, `&`, `|`, `^`, `<`, `>`, `=`, `!=`, `!in`, `!instanceof`, `..`, `{`, or one of the words `else`, `catch`, `finally`, `in`, `as`, `instanceof`.
- This follows where `ScriptParser.g4` allows `nls`. `+`, `-` and `**` take no newline before them, and a `/` at line start lexes as a slashy string. Neither is a continuation.

**Heads** (`scanHead(text, at, grammar)`), used for chunks and for isolated items:
- scripts: `process NAME`, `agent NAME`, `record NAME`, `enum NAME`, `workflow` or `workflow NAME`, `output`, `params` (block) or `param params.a.b` (legacy), `include`, `import NAME`, `featureFlag nextflow.enable.types` (dotted, whitespace removed), `function NAME` (`def NAME (` or `Type NAME (`), otherwise `null`;
- configs: the path is words and quoted names joined by `.`. Next comes `=` (not `==`) for `assign PATH`, or `{` for `block PATH`. `includeConfig`, `if`/`try`/`def` give `invalid`, otherwise `null`.
- Words follow Java identifier rules via `src/parser/java-character.ts`.

**Chunk fields.** `codeStart` (the first code character), `leadingComments` (depth-0 comments in `[start, codeStart)`, as lang-core `Comment`s with code-point columns and `ownLine`) and `line` (the 1-based line of `start`).

**Why S1 as well as S2:**
- S1 isolates a truncated or partial starter (`proc`, `String fo`) from the declaration before it.
- S1 also gives top-level statements in a script their own chunk.
- S2 separates one-line declarations (runs of includes, feature flags, legacy params).

**Why a script line after `}` isn't split when it starts with `else`, `catch`, `.` and so on:** those continue the statement (the guards).

**Accepted limitation:** in a broken statements-only script, a brace-less `if (x)` with its body on the next line can't be split wrongly because it doesn't end in `}`. A config `if (x)` followed by `a = 1` can be, which models the assignment as unconditional in an already-invalid config. The corpus property (5.6) is the safety net for valid code.

### 3.6 Engine (`packages/engine/src/source/`)

`createSourceFile(path, text, parser)`:
1. Calls `languageOf(path)`. Plain languages return status `plain`.
2. Otherwise calls `parser.parseScript` or `parser.parseConfig` inside try/catch; an exception gives verbatim with an `internal` problem (defence in depth for IO-14).
3. Builds the file, then runs `verifyModel`; any problem downgrades it to verbatim with an `internal` problem.

`printSourceFile(file)` concatenates the trivia (`text.slice(prev, item.range.start)`) and each item (an `Unparsed`'s `text`, otherwise its slice), then the tail. For a null AST it returns `file.text`. It throws if the items aren't sorted and in bounds; `createSourceFile` guarantees they are. `equivalent` uses an iterative deep comparison, so deep ASTs can't overflow the stack.

## 4. Files

### 4.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/ast/unparsed.ts` | `interface DeclarationHead`, `interface Unparsed` (3.2) |
| `packages/lang-core/src/source-file.ts` | `type SourceLanguage`, `type ParseStatus`, `type SourceParse<Ast>`, `type ScriptSourceParse`, `type ConfigSourceParse`, `interface SourceParser`, `interface ScriptSourceFile`, `interface ConfigSourceFile`, `interface PlainSourceFile`, `type SourceFile` |
| `packages/lang-2610/src/source/prescan.ts` | `type Grammar = "script" \| "config"`; `interface Chunk { start; end; line; codeStart; head: DeclarationHead \| null; leadingComments: readonly Comment[] }`; `interface Prescan { chunks: readonly Chunk[]; open: readonly ("(" \| "[" \| "{" \| "${" \| "string" \| "comment")[] }`; `function prescan(text: string, grammar: Grammar): Prescan`; `function scanHead(text: string, at: number, grammar: Grammar): DeclarationHead \| null`; `function codeSpan(text: string, from: number, to: number, grammar: Grammar): { start: number; end: number } \| null`; `const SCRIPT_STARTERS: readonly string[]` |
| `packages/lang-2610/src/source/shift.ts` | `function shiftPositions<T>(value: T, by: { readonly offset: number; readonly line: number }): T` |
| `packages/lang-2610/src/source/isolate.ts` | `function isolate<I extends AstNode>(items: readonly I[], problems: readonly ParseProblem[], text: string, grammar: Grammar, comments: readonly Comment[]): { items: (I \| Unparsed)[]; comments: Comment[] }` |
| `packages/lang-2610/src/source/parse-source.ts` | `function parseScriptSource(text: string): ScriptSourceParse`; `function parseConfigSource(text: string): ConfigSourceParse`; `function parseScriptChunks(text: string, problems?: readonly ParseProblem[]): ScriptSourceParse`; `function parseConfigChunks(text: string, problems?: readonly ParseProblem[]): ConfigSourceParse`; `function statusOf(modelled: number, unparsed: number, failed: boolean): "modelled" \| "partial" \| "verbatim"` |
| `packages/lang-2610/src/source/index.ts` | `const parser: SourceParser` (the lazily loaded module) |
| `packages/engine/src/source/language.ts` | `function languageOf(path: string): SourceLanguage` |
| `packages/engine/src/source/parser.ts` | `function loadParser(version: string, packs?: readonly LanguagePack[]): Promise<SourceParser>` (memoised per pack; rejection forgotten; unknown version rejects) |
| `packages/engine/src/source/source-file.ts` | `function createSourceFile(path: string, text: string, parser: SourceParser): SourceFile` |
| `packages/engine/src/source/items.ts` | `type TopLevelItem = ScriptItem \| ConfigItem`; `function topLevelItems(file: SourceFile): readonly TopLevelItem[]` |
| `packages/engine/src/source/verify.ts` | `function verifyModel(file: SourceFile): string[]` (`[]` = invariants hold) |
| `packages/engine/src/source/print.ts` | `function printSourceFile(file: SourceFile): string` |
| `packages/engine/src/source/equivalent.ts` | `type Equivalence = { readonly equivalent: true } \| { readonly equivalent: false; readonly reason: string }`; `function equivalent(a: SourceFile, b: SourceFile): Equivalence`; `function normaliseText(text: string): string` |
| `e2e/parser-chunk.spec.ts` | Playwright test (5.7, open point 13) |

### 4.2 Change

- `packages/lang-core/src/ast/script.ts`: `ScriptItem` += `Unparsed`; `SCRIPT_NODE_KINDS` += `"Unparsed"`.
- `packages/lang-core/src/ast/config.ts`: `ConfigItem`; `ConfigAst.statements: readonly ConfigItem[]`.
- `packages/lang-core/src/ast/parse-result.ts`: `source` += `"internal"`; `scope?: "file"`.
- `packages/lang-core/src/ast/index.ts`, `src/index.ts`: export the new types. `LanguagePack` += `loadParser(): Promise<SourceParser>`.
- `packages/lang-2610/src/index.ts`: `loadParser: async () => (await import("./source/index.ts")).parser`, with the same "dynamic import only" comment as `loadCatalogue`.
- `packages/lang-2610/src/ast/index.ts` (F-102): `export interface ScriptBuildOptions { readonly typesEnabled?: boolean; readonly fragment?: boolean }`; `parseScriptAst(text: string, options?: ScriptBuildOptions): ScriptParseResult`. Existing callers are unchanged.
- `packages/lang-2610/src/ast/build/context.ts`: the constructor takes the options and seeds `typesEnabled`. It gains `fileError(message: string, at: Range): void`, which pushes `{ ...problem, scope: "file" }` and is a no-op when `fragment` is set.
- `packages/lang-2610/src/ast/build/script.ts`: the eight whole-script checks call `cx.fileError`.
- `packages/lang-2610/test/ast/coverage.test.ts` (F-102): add `"Unparsed"` to the `errorOnly` set, with the comment "built only by F-104's fallback; tested in test/source/". This is additive and the builder-kind check keeps its strength.
- Typecheck may flag exhaustive switches in F-102/F-103 test helpers (`print-ast.ts`, `shape.ts`, `renderConfigAst`). Handle `"Unparsed"` there; the builder never produces it.
- `packages/lang-2610/package.json`: devDependency `"yaml": "2.9.1"` (the root's version) for reading `fixtures.yaml` (open point 12).
- `packages/engine/src/index.ts`: export `createSourceFile`, `printSourceFile`, `equivalent`, `normaliseText`, `languageOf`, `loadParser`, `topLevelItems`, `verifyModel`, and re-export the `SourceFile` types.
- `packages/engine/tsconfig.json`: `"compilerOptions": { "types": ["node"] }` (open point 12).
- Docs (orchestrator, task 7): `docs/spec/architecture.md` (pack interface sketch); the AR-01 wording only if open point 6 says so; the ADR and `docs/adr/README.md`; `packages/{engine,lang-core,lang-2610}/README.md` one line each; the AGENTS.md `pnpm test:corpus` row text ("parse and round-trip every corpus file"; new time); `features.json`; `progress.md`.

**No change:** dependency-cruiser rules, workflows, root `package.json` scripts, generated files, `tools/corpus/fixtures/` (open point 15).

## 5. Tests (write before the implementation)

Test names cite IDs: `F-104 step 1 ...`, `F-104 step 2 ...`, plus `ADR-0004`, `IO-14`, `IO-20`, `AR-01`.

### 5.1 lang-core (task 1): `packages/lang-core/test/source-file.test.ts`

| Test | Asserts |
|---|---|
| `F-104 AR-01: SourceFile carries path, text, language, parse status, AST and comment map` | Type-level: each variant has those fields; `status` and `ast` narrow by `language`; `ast` is null when `status` is `verbatim` or `plain` (a `satisfies` and `@ts-expect-error` set) |
| `F-104 ADR-0004: Unparsed is a script item and a top-level config item, and a node kind` | `SCRIPT_NODE_KINDS` includes `"Unparsed"`; `childNodes` of an `Unparsed` is `[]` (its `head` and `problems` are not nodes) |

### 5.2 Pre-scanner unit tests (task 2): `packages/lang-2610/test/source/prescan.test.ts`

Each case is an inline string asserting chunk starts, heads and `codeStart`. A helper `chunkTexts(text, grammar)` makes failures readable.

| Test | Asserts |
|---|---|
| `F-104 step 2 ADR-0004: each kind of script declaration starts a chunk with its head` | process, entry and named workflow, `def` and legacy-typed function, include runs, feature flag, params block, legacy param, record, enum, output, agent, import |
| `F-104 step 2: leading comments and blank lines go with the next declaration; a same-line trailing comment stays` | `} // end` stays; `/** doc */` lands in the next chunk's `leadingComments` with exact text, `kind: "doc"` and `ownLine: true` |
| `F-104 step 2: braces inside strings don't count` | `'}'`, `"{"`, `'''}\n}'''`, `"""}"""`, and `"""a""""` (four quotes: the last three close) |
| `F-104 step 2: braces inside comments don't count` | `// }`, `/* { */`, `/** } */` |
| `F-104 step 2: GString interpolation is balanced inside strings` | `"${ xs.collect { it } }"`; `"${ "}" }"`; `"""${ x ? '{' : '}' }"""`; `"$a.b }"`; `"\${x} }"` (an escaped dollar isn't interpolation) |
| `F-104 step 2: slashy strings follow the lexer's regex rule` | `x = /a}b/` is a string; in `a / b }`, `/` after identifiers is division so `}` counts; `/` at line start is slashy; `//` and `/*` are comments; `/foo$bar/` is not slashy (the `}` after it counts); a multi-line slashy |
| `F-104 step 2: a shebang is a comment only at offset 0 and a line starting with # never starts a chunk` | |
| `F-104 step 2: CRLF text gives the same chunks and heads at the same lines; a lone CR is never a chunk start` | |
| `F-104 step 2: a line escape joins two lines` | `foo \`+newline+`process X {` gives no boundary |
| `F-104 step 2: continuation lines never start a chunk` | previous line ends with `+`, `?:`, `=`, `,`; next starts with `.`, `?.`, `?:`, `else`, `catch` |
| `F-104 step 2: a declaration not at line start does not start a chunk` | `foo(); process X {` |
| `F-104 step 2: keywords inside longer words or followed by a dot are not starters` | `processes {`, `workflowFoo`, `workflow.onComplete {}` (no S2; S1 still splits after a `}` line); `params.x = 1` and `nextflow.enable.types = true` are starters |
| `F-104 step 2 ADR-0004: an unclosed brace runs its chunk to the end of the text` | `open` ends with `{`; earlier chunks unchanged |
| `F-104 step 2: unterminated strings and comments are bounded as the lexer would` | `'abc` ends at newline; `"""abc` and `/* abc` run to EOF; S3 splits before an own-line unterminated `/*`; extra `}` and mismatched `)` are ignored without throwing |
| `F-104 step 2: config statements are chunks named assign PATH and block NAME` | top-level assignments, blocks (`profiles`, `'foo-bar'`), `includeConfig`, `plugins {}`, nested assignments not split, multi-line closures, lists, maps and triple-quoted values, `?:` and trailing `=` continuations, `if`/`try`/`def` give `invalid` |
| `F-104 step 2: identifiers follow Java rules and columns count code points` | `process Ünïcødé {` head; a comment after `𝐀𝐀` has the code-point column of `PositionIndex` |
| `F-104 step 2: chunks tile the text and start at line starts, for every AST fixture and malformed fixture` | For `test/ast/fixtures/**/*.nf`, `tools/oracle/cases/config-constructs/*.config` and `tools/corpus/fixtures/*` (read by path): contiguous, cover `[0, len)`, each start 0 or after `\n` |
| `F-104 IO-14: the pre-scanner never throws and stays linear on hostile input` | 300 seeded random strings over ``{}()[]'"/*$\`#\n\r`` plus letters; 200,000 nested `{`; a 1 MB file of one-line includes finishes (no timing assertion, just completes within the test timeout) |
| `F-104 LA-02: the script starter keywords are lexer keywords of the 26.10 grammar` | each of `SCRIPT_STARTERS` appears quoted in `ScriptLexer.literalNames` |

### 5.3 Isolation and whole-file path (task 3a): `packages/lang-2610/test/source/isolate.test.ts`

| Test | Asserts |
|---|---|
| `F-104 ADR-0004: a file that parses with no errors is fully modelled and its AST is the builder's` | `parseScriptSource(t).ast` deep-equals `parseScriptAst(t).ast`; status `modelled`; problems `[]` (and the same for a config) |
| `F-104 step 2 ADR-0004: a declaration with a builder error becomes Unparsed with its exact text, head and problems` | `typed-without-flag.nf` (by path): `body[0]` is `Unparsed` with `head {process, HELLO}`, `text` equal to the slice from `process HELLO` to its `}`, the 4:5 problem; `body[1]` is the modelled `Process GOODBYE` |
| `F-104: an InvalidDeclaration is Unparsed and named by the pre-scanner` | `section-order.nf`: `head {process, LATE_INPUT}` |
| `F-104: comments move with the item they belong to` | an isolated process with a leading doc comment and an inner comment: the doc comment is in `leadingComments` and in `ast.comments`; the inner comment is only in `text` |
| `F-104: whole-script checks never isolate a declaration` | duplicate params block, params without an entry workflow, a statement among declarations: items stay modelled; problems carry `scope: "file"` |
| `F-104 ADR-0004: text the builder dropped is kept as Unparsed` | `nextflow.enable.types = true\n\nparams.input = 'x'\n`: `body[1]` is `Unparsed` with text `params.input = 'x'` and head `param params.input` |
| `F-104: statusOf distinguishes modelled, partial and verbatim` | the truth table in 3.3, including empty and comment-only files |

`packages/lang-2610/test/index.test.ts`, added:

| Test | Asserts |
|---|---|
| `F-104 ADR-0027 ADR-0028: the pack loads its parser on demand` | `await pack.loadParser()` has `parseScript` and `parseConfig`; a second call gives an equal object |
| `F-104 ADR-0027 QA-01: the pack entry imports no parser module statically` | `src/index.ts` source has no static `import` from `./ast`, `./parser`, `./source`, `./generated` or `antlr4ng` (the only reference is inside `import(...)`) |

### 5.4 Chunked path (task 3b): `packages/lang-2610/test/source/parse-source.test.ts`

| Test | Asserts |
|---|---|
| `F-104 step 2: on every AST fixture and config construct fixture, the chunk path stitches back the whole-file AST` | `parseScriptChunks(t).ast` deep-equals `parseScriptAst(t).ast`, ranges and comment slots included, for the 54 F-102 fixtures; the same with `parseConfigChunks` on the F-103 construct fixtures |
| `F-104 step 2: shifted ranges are exact after astral characters and CRLF` | a broken declaration after a line with `𝐀𝐀`: the modelled item's offsets slice back exactly; columns equal the whole-file parse of the repaired text; a CRLF variant |
| `F-104 step 2: types enabled in an earlier chunk apply to later chunks` | flag, then a typed process, then a broken process: the typed process is `typed: true` with no errors |
| `F-104 step 2: a broken include among includes is isolated` | |
| `F-104 IO-14: a parser exception turns only its chunk into Unparsed with an internal problem` | 20,000 nested `(` inside one process between two good ones: the outer two are modelled, the middle is `Unparsed` with `source: "internal"`; no throw |
| `F-104 ADR-0004: when no declaration can be modelled the file is verbatim` | a single broken process; `unclosed-comment.nf`: status `verbatim`, `ast` null, problems equal the whole-file error |

`packages/lang-2610/test/source/malformed-fixtures.test.ts` (**step 2**), reading `tools/corpus/fixtures/fixtures.yaml` with `yaml` by path, one `it` per entry:

| Test | Asserts |
|---|---|
| `` `F-104 step 2 ADR-0004: ${file} keeps ${unparsed or "the whole file"} as text and models ${modelled}` `` (9) | `wholeFile`: status `verbatim`, `ast` null. Otherwise the in-order labels of the `Unparsed` items (`labelOf`, from `head`) equal `expect.unparsed`, and the labels of the modelled top-level items equal `expect.modelled` exactly. Each `Unparsed.text` is its slice and starts with the bad declaration's keyword. Each `Unparsed` has non-empty `problems`. Each modelled item's slice, parsed alone (fragment, with the file's `typesEnabled` before it) and shifted, deep-equals the item. The tiling and coverage check (test helper `checkTiling`) passes. Status is `partial` when `unparsed` is non-empty, else `modelled` |
| `F-104 step 2: every fixture in fixtures.yaml is tested` | the entry count equals the files in `tools/corpus/fixtures/` minus the YAML |

Helpers in `packages/lang-2610/test/source/`:
- `labels.ts`: `labelOf(item: ScriptItem | ConfigItem): string`. For `Unparsed` it uses `head`. Otherwise `process NAME`, `workflow [NAME]`, `featureFlag NAME`, `function NAME`, `include`, `params`, `param params.x`, `record NAME`, `enum NAME`, `output`, `agent NAME`, `import NAME`, `assign a.b`, `block NAME`, `includeConfig`, and `statement` for script statements.
- `tiling.ts`: `checkTiling(text, ast): string[]`.

`packages/lang-2610/test/source/truncation.test.ts`:

| Test | Asserts |
|---|---|
| `` `F-104 IO-14 ADR-0004: cutting ${file} anywhere keeps every earlier complete declaration modelled and loses no text` `` | For each F-102 AST fixture and F-103 construct fixture, cut points are every chunk start ±1 plus 8 seeded offsets. Parsing the prefix never throws, and `checkTiling` is `[]`. Every whole-file item in a chunk that starts before the chunk holding the cut is modelled and deep-equal to the whole-file item |

### 5.5 Engine (task 4): `packages/engine/test/source/`

| File and test | Asserts |
|---|---|
| `language.test.ts`: `F-104 AR-01: languageOf maps paths to the AR-01 languages` | `main.nf` and `modules/x/main.nf` give nextflow; `nextflow.config` and `conf/base.config` give config; `nf-test.config` gives text (open point 10); `main.nf.test` text; `.json` json; `.yml`/`.yaml` yaml; `.md` markdown; `LICENSE` and `Dockerfile` text; the case of the extension is respected (`.NF` is text) |
| `parser.test.ts`: `F-104 ADR-0027 ADR-0028: loadParser loads the pack's parser once and memoises it; an unknown version rejects and a failed load is retried` | fake packs as in `palette.test.ts`; the real pack via `pack.version` |
| `source-file.test.ts`: `F-104 AR-01: createSourceFile holds path, text, language, parse status, AST and comment map` | real parser: a script, a config, a plain JSON file, a partial file, a verbatim file |
| `source-file.test.ts`: `F-104 IO-14: createSourceFile never throws, even when the pack parser does` | a stub `SourceParser` that throws gives verbatim with an `internal` problem |
| `source-file.test.ts`: `F-104 IO-14: a model that doesn't account for its text is downgraded to verbatim` | a stub returning overlapping items, or a code gap, gives verbatim with an `internal` problem |
| `source-file.test.ts`: `F-104 IO-14: hostile input never throws and prints back exactly` | real parser: 200 seeded random strings, a BOM, NUL, lone surrogates `\uD800`, 20,000 nested `{`, an empty file; `printSourceFile(f) === text` and `verifyModel(f)` is `[]` |
| `print.test.ts`: `F-104 IO-20 ADR-0004: an unedited file prints back byte for byte whatever its status` | modelled, partial (CRLF), verbatim and plain |
| `equivalent.test.ts`: `F-104 ADR-0004: whitespace, indentation, blank lines, CRLF and trailing whitespace changes are equivalent` | pairs parsed with the real parser |
| `equivalent.test.ts`: `F-104 ADR-0004: a change to code or comments is not equivalent` | changed literal, identifier, operator, trailing comma, quote style; a comment added, removed, reordered or edited; and the reason names the first differing path |
| `equivalent.test.ts`: `F-104 ADR-0004: unparsed text is compared after normalising line endings and trailing whitespace only` | CRLF and trailing spaces in an `Unparsed` are equivalent; an indentation change inside it is not |
| `equivalent.test.ts`: `F-104: a different status or language is never equivalent; plain files compare normalised text` | |

### 5.6 Corpus (task 5), under `pnpm test:corpus` and the CI `corpus-parse` job

`packages/engine/test/corpus/round-trip.corpus.ts` (**step 1**). It has its own small file lister with nextflow lint's excludes (a copy of `listSources`; the count test keeps it honest) and reads `.cache/corpus`, `.cache/corpus-lint` and `tools/corpus/fixtures` by path:

| Test | Asserts |
|---|---|
| `F-104 step 1: every pinned pipeline and the fixtures are present, with as many files as nextflow lint checked` | per pipeline, the count equals lint's `filesChecked` |
| `F-104 step 1 IO-20 ADR-0004: every corpus file prints back byte for byte and equivalent with no edits` | for all 570 + 9 files: `printSourceFile(f) === text`, and `equivalent(f, createSourceFile(path, printed, parser))` is equivalent; no allow-list, 100% |
| `F-104 step 1 ADR-0004: every file's model accounts for every character` | `verifyModel(f)` is `[]` and no file was downgraded |
| `F-104 IO-14 ADR-0005: every file nextflow lint accepts is fully modelled, and every file it rejects still imports` | lint-clean files have status `modelled` and problems `[]`; lint-rejected fixtures are `partial` or `verbatim` and never throw |
| report | appends a "Round trip (F-104)" section to `.cache/reports/parse-corpus.md`: files per status, total time |

`packages/lang-2610/test/corpus/fallback.corpus.ts`, step 2 on real code:

| Test | Asserts |
|---|---|
| `F-104 step 2: the pre-scanner splits every corpus file into chunks that parse alone and stitch back into the whole-file AST` | all 342 scripts and 228 configs: `parseScriptChunks`/`parseConfigChunks` give no `Unparsed`, and the AST deep-equals the whole-file AST, ranges and comment slots included |
| `F-104 step 2: the pre-scanner names every corpus declaration as the AST does` | for each chunk, `labelOf` of its head equals `labelOf` of its first modelled item |
| `F-104 IO-14 step 2: cutting corpus files keeps earlier declarations modelled` | every file of rnaseq-nf, rnaseq-nf-typed and fetchngs plus the 20-file sarek sample `parse.corpus.ts` uses, 5 seeded cuts each, with the 5.4 truncation property |

### 5.7 End to end (task 6): `e2e/parser-chunk.spec.ts`

| Test | Asserts |
|---|---|
| `F-104 QA-01 ADR-0027: the parser loads in a lazy chunk, outside the initial JavaScript` | Like F-204's catalogue test: from `apps/web/dist/.vite/manifest.json` and `initialJsFiles`, no initial JS file contains `check for an unclosed brace, bracket, parenthesis, or string` (a `DescriptiveErrorStrategy` message), and some lazy chunk does |

## 6. Tasks (in order; one builder run each)

Branch `feat/F-104` from `main` after F-102 and F-103 have merged. Run `pnpm install` (the lockfile changes in task 3a for `yaml`). Each task writes its tests first, sees them fail, implements, then runs its proof. Commits: `feat(lang-core): ...`, `feat(lang-2610): ...`, `feat(engine): ...`, `test(...)`.

**Task 1: lang-core model types.**
- Files: `lang-core/src/ast/unparsed.ts`, `src/source-file.ts`; changes to `script.ts`, `config.ts`, `parse-result.ts`, `ast/index.ts`, `src/index.ts` (no `loadParser` yet); `lang-core/test/source-file.test.ts`; the `coverage.test.ts` exception; any exhaustive switch in the F-102/F-103 test helpers.
- Tests: 5.1.
- Done when:
```
pnpm --filter @nf-builder/lang-core test && pnpm --filter @nf-builder/lang-2610 test
pnpm check
```

**Task 2: pre-scanner.**
- Files: `lang-2610/src/source/prescan.ts`, `test/source/prescan.test.ts`. Pure; no parser import except `java-character.ts`. `ScriptLexer` may be imported only in the test.
- Tests: 5.2.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/source/prescan.test.ts
pnpm check
```

**Task 3a: whole-file path, isolation, pack entry.**
- Files: `src/source/{isolate,parse-source,index}.ts`. In `parse-source.ts`, a whole-file failure gives `verbatim` for now; the chunk path comes in 3b. Also: the `scope: "file"` and `fileError` change in F-102's `context.ts`/`script.ts`; `LanguagePack.loadParser`; `pack.loadParser`; `yaml` devDependency.
- Tests: 5.3. `malformed-fixtures.test.ts` for the 5 entries this path already satisfies: section-order, typed-legacy-mixed, typed-without-flag, unknown-scope, unclosed-comment.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/source test/index.test.ts test/ast
pnpm check
pnpm build && pnpm check:budget && pnpm check:hosts   # the new lazy chunk passes IO-41 and stays out of QA-01's initial set
```

**Task 3b: chunked path.**
- Files: `src/source/shift.ts`; `parseScriptChunks`/`parseConfigChunks` in `parse-source.ts`; `ScriptBuildOptions` (`typesEnabled`, `fragment`) in F-102's `src/ast/index.ts` and `context.ts`; `codeSpan` gap repair in `isolate.ts`; exception catching.
- Tests: 5.4, the remaining 4 fixture entries, truncation.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/source test/ast test/ported   # F-102's tests still pass unchanged
pnpm check
```

**Task 4: engine.**
- Files: `engine/src/source/*`, `engine/src/index.ts`, `engine/tsconfig.json` (node types), `engine/test/source/*`.
- Tests: 5.5.
- Done when:
```
pnpm --filter @nf-builder/engine test
pnpm check
```

**Task 5: corpus tests.**
- Files: `engine/test/corpus/round-trip.corpus.ts`, `lang-2610/test/corpus/fallback.corpus.ts`.
- Tests: 5.6. Any wrong split the property finds is fixed in `prescan.ts` with a 5.2 unit case, never by an allow-list.
- Done when:
```
pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus   # needs Java 21 and .cache/nextflow (AGENTS.md); else CI corpus-parse is the proof
pnpm check
```

**Task 6: lazy-chunk end-to-end test** (if open point 13 is accepted).
- Files: `e2e/parser-chunk.spec.ts`.
- Done when:
```
export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
pnpm test:e2e -- --grep F-104 --project chromium
pnpm check
```

**Task 7: records (orchestrator, not the builder).**
- The ADR (open points 1 to 9), its `docs/adr/README.md` row, and the architecture.md pack sketch.
- READMEs, the AGENTS.md `test:corpus` row text, `features.json` (`passes`, notes as in section 8), `progress.md`, and the PR from its template.
- Done when `pnpm check` passes, and the Scope guard passes without `scope-change` (only `passes` and `notes` change).

## 7. Open points (each with a recommendation; none decided here)

1. **Where things live** (3.1). **Recommendation:** types in lang-core; scanner, chunking and isolation in the pack; `SourceFile` construction, print and equivalence in the engine. No boundary change and no dependency-cruiser change. Record in Decisions.
2. **Pack API.**
   - **Recommendation:** `LanguagePack.loadParser(): Promise<SourceParser>` via a dynamic import, which replaces the sketch's synchronous `parseScript`/`parseConfig`; the engine has `loadParser(version)`, memoised.
   - This is the ADR 0028 pattern and keeps ADR 0027's bundle promise; F-113 calls it inside the worker, unchanged.
   - Record in a new ADR, `Accepted (agent)`, numbered 0029 unless F-103 takes it first. Update the architecture.md sketch.
3. **`Unparsed` inside the AST unions.**
   - **Recommendation:** add it to `ScriptItem` and to a new top-level `ConfigItem`. That gives one tree type for F-105, F-106 and F-111, and the `SCRIPT_NODE_KINDS` type test forces every exhaustive consumer to handle it.
   - Cost: `"Unparsed"` joins F-102's `errorOnly` coverage exception. That is additive, not a weakened test.
   - Alternative: a separate `ScriptModel` type wrapping `ScriptAst` with a wider `body`. No F-102 test edit, but two near-identical root types.
4. **Which builder errors isolate a declaration.** **Recommendation:**
   - Any error that starts inside a top-level item isolates it, and so does an `InvalidDeclaration`. This is conservative: the builder drops invalid items, so a node with an error may be lossy.
   - The exception is the eight whole-script checks (1.4), which F-102 tags `scope: "file"` through `cx.fileError`. They stay file problems for F-112.
   - Alternative: match on message strings in the pack. That is brittle across nf-lang updates.
5. **Verbatim rule.** **Recommendation:** verbatim when something failed and no item is modelled (`statusOf`). This matches `wholeFile: true` ("no declaration can be isolated") and ADR 0004's first row. A file of two broken declarations is also verbatim; the error badge and Code tab are the right UI when nothing is modelled.
6. **Equivalence details** (section 2). **Recommendation:**
   - CRLF is normalised inside string fields.
   - Comments are compared as the ordered `(kind, normalised text)` list, without slots.
   - "Trailing whitespace" means at every line end and at the end of the text.
   - Record these in the ADR as the glossary's interpretation. A one-sentence glossary clarification is optional and has no behaviour change.
7. **Chunk parsing by slice and shift** (3.3). **Recommendation:** slice. Masking is simpler but O(n x chunks), with a pathological 1 MB case of tens of GB lexed.
8. **Whole-script checks in fragment mode.** **Recommendation:** skip them in chunks and don't recompute them on the stitched model. The file already has a parse error (its `problems`), and F-112 can derive structure diagnostics from the model later.
9. **`ParseProblem.source: "internal"`** for caught exceptions and model-check failures. **Recommendation:** add it, so F-112 can say "internal error, please report" rather than blame the user's code. It is in-memory, so not a format change.
10. **`languageOf` details.** **Recommendation:**
    - by extension (`.nf`, `.config`, `.json`, `.yml`/`.yaml`, `.md`/`.markdown`, case-sensitive);
    - `nf-test.config` is `text`, because it isn't a Nextflow config and lint excludes it;
    - `*.nf.test` is `text`.
11. **What "every file" in step 1 covers.** **Recommendation:** the 570 `.nf`/`.config` files lint checks, plus the 9 fixtures. Other text files are plain (no parse, print is the identity), covered by a unit test. Including them would need binary detection, which belongs to import (F-401/F-403).
12. **Test plumbing.** **Recommendation:**
    - `yaml` 2.9.1 as a lang-2610 *dev*dependency (already a root dev dependency; not a runtime dependency, so not decide-and-record gated; mention in the PR);
    - `"types": ["node"]` in `engine/tsconfig.json`, following lang-2610's precedent;
    - alternative: a separate `engine/test/tsconfig.json`, which keeps Node types out of engine `src`.
13. **Playwright.** F-104 has no UI, so Q13 applies (unit tests plus CI `corpus-parse` as evidence). **Recommendation:** still add the 5.7 lazy-chunk test. It is cheap, directly guards ADR 0027 and QA-01, and gives `pnpm test:e2e -- --grep F-104` something to run.
14. **`SourceFile` persistence.** **Recommendation:** in memory only; IndexedDB and exports keep file text (ADR 0004). Not a stored or exported format, so no format ADR. Record a Decisions line. No new runtime dependency.
15. **New malformed fixtures.** **Recommendation:** none. Inline unit cases (5.2 to 5.4) cover the edge cases. New files under `tools/corpus/fixtures/` would need recorded `nextflow lint` results (oracle), `parse.corpus.ts` handling, and a cache bust of `corpus-lint/fixtures.json`.
16. **Statement chunks in broken statements-only scripts** (3.5, accepted limitation). **Recommendation:** accept S1 splitting after `}` lines with the guards. The forced-chunk corpus property must pass on all 570 files, which is the safety net. A merge-and-retry of adjacent failed chunks is a possible later refinement, not needed for the steps.
17. **Dependency timing.** F-104 must start from a `main` where F-102 task 5 has landed: the reparse, the typed/legacy input errors and the `null` return for dropped legacy params. F-103's comment-slot TODO doesn't block. **Recommendation:** check `ported-builder.test.ts`'s three-fixture test is green on `main` before task 3a.

## 8. Records to write when F-104 lands (drafts for the orchestrator)

**features.json notes** (no scope change):
- F-104: "Verified <date>: step 1 by packages/engine/test/corpus/round-trip.corpus.ts (all 570 corpus files plus 9 fixtures print back byte-identical and equivalent; every model accounts for every character; lint-clean files fully modelled; CI corpus-parse). Step 2 by packages/lang-2610/test/source/malformed-fixtures.test.ts against fixtures.yaml, with fallback.corpus.ts (the pre-scanner's chunks parse alone and stitch back into the whole-file AST on every corpus file) and truncation tests (IO-14). Parser loads lazily (e2e/parser-chunk.spec.ts). Print emits untouched items from their source slices; F-110's printer is only for edited declarations (F-111)."
- F-105: "From F-104: SourceFile (lang-core) with status modelled/partial/verbatim/plain; top-level Unparsed items keep their text and a DeclarationHead (keyword, name); engine createSourceFile(path, text, await loadParser(version))."
- F-111: "From F-104: printSourceFile and equivalent (engine/src/source/) are the base for AR-22: replace an item's slice with printer output and check every other item stays equivalent."
- F-112: "From F-104: whole-script checks carry scope 'file' and never isolate a declaration; Unparsed.problems hold the chunk's own errors; source 'internal' marks caught exceptions."
- F-113: "From F-104: LanguagePack.loadParser() is a dynamic import; call it in the worker. A failing file is parsed at most twice (whole, then per chunk)."
- F-404: "From F-104: untouched files export as printSourceFile output (byte-identical); IO-20 checks use engine equivalent()."

**progress.md Decisions:** open points 1 to 10, 12 to 14 and 16 as settled; the ADR; the architecture.md sketch update; "SourceFile is in memory only; no new runtime dependency".

**ADR outline** ("Declaration-level fallback and the SourceFile model"):
- Context: ADR 0004's table and the fixtures.
- Decision: the two tiers; the pre-scanner rules S1 to S3 and C1; slice and shift; isolation and `scope: "file"`; status rule; print semantics; the equivalence interpretation; lazy `loadParser`; `Unparsed` in the unions.
- Consequences: at most two parses of a failing file; F-111 reuses print and equivalence.
- Alternatives: lexer-based scanner (contradicts `unclosed-comment.nf`); masking; a separate model type; always chunking.

## 9. Evidence and how to repeat it

- Lint results: `/home/user/wt-F-103/.cache/corpus-lint/*.json` (fixtures: 11 errors in 8 files; the 5 pinned pipelines: 0 errors over 570 files).
- Corpus parse report: `/home/user/wt-F-103/.cache/reports/parse-corpus.md` (timings, fallbacks).
- Upstream `compilationUnit` post-pass: scratchpad `f102-upstream/nf/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java` L237-L320.
- Lexer rules cited: `packages/lang-2610/grammar/ScriptLexer.g4`:
  - regex check L88-L111;
  - strings L142-L238;
  - line terminator L651;
  - brackets L733-L740;
  - WS, NL and comments L846-L872.
- Config string rules are identical: `diff` of the `StringLiteral`..keywords sections of the two lexers.
- `nls` placement: `ScriptParser.g4` `expression` and `pathElement` (L510-L600).
- F-102 whole-script checks: `/home/user/wt-F-102/packages/lang-2610/src/ast/build/script.ts` (working tree at planning time).
