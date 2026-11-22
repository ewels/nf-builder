# Plan: F-103, config AST with source ranges and comments

Planner output, 2026-11-22. Read-only planning; no repo or worktree was changed. Base: `main` at `5d205d6` (F-101 merged: `DescriptiveErrorStrategy`, `ParseError` ranges, `test/ported/`). F-102 (script AST) is being planned in parallel; section 2 proposes the conventions both ASTs share. **If F-102's plan defines any of them first, reuse F-102's version** and treat the matching part of this plan as a checklist of what configs need from it (section 2.4).

## 0. Scope in one paragraph

F-103 turns a config parse tree (`parseConfig`, F-101) into our own typed AST: config statements (assignments with dotted paths, blocks, `withName:`/`withLabel:` selectors, the `plugins` apply block, `includeConfig`, incomplete and invalid statements), with values as expression nodes, a source range on every node, and every comment collected and attached. Profiles, `params` and `env` are blocks syntactically, in nf-lang and here; the AST stays syntactic and F-601 maps it to the catalogue. The builder also reports nf-lang's `ConfigAstBuilder` errors, including the 7 ported inputs F-101 handed over. Step 1 is snapshot tests over every corpus config; step 2 is a property test that every node's range slices back to its exact source. Nothing here is user-visible: no UI, no Playwright test (Q13).

## 1. Findings

### 1.1 The config grammar (`packages/lang-2610/grammar/ConfigParser.g4`)

Statement layer (all of it config-only):
- `compilationUnit : nls (configStatement (sep configStatement)* sep?)? EOF`
- `configStatement`: `configInclude` | `configAssign` | `configBlock` | `configApplyBlock` | `configIncomplete` | `invalidStatement`.
- `configBlockStatement`: the same plus `configSelector` (selectors only inside a block; never top level).
- `configInclude : INCLUDE_CONFIG expression`
- `configAssign : configAssignPath nls ASSIGN nls expression`; `configAssignPath : configPrimary (DOT configPrimary)*`
- `configPrimary : identifier | stringLiteral | builtInType` (so names may be quoted, `'foo-bar'`, or a primitive type name, `int`).
- `configBlock : configPrimary nls LBRACE nls (configBlockStatement (sep configBlockStatement)* sep?)? RBRACE`
- `configSelector : kind=Identifier COLON target=configPrimary nls LBRACE ... RBRACE`. Any identifier is accepted as the kind (`withFoo:` lints clean, probe p11).
- `configApplyBlock : configPrimary nls LBRACE nls (configApply (sep configApply)* sep?)? RBRACE`; `configApply : identifier argumentList`.
- `configIncomplete : configPrimary (DOT configPrimary)* DOT?`
- `invalidStatement : ifElseStatement | tryCatchStatement | variableDeclaration`.
- Empty `name { }` matches both `configBlock` and `configApplyBlock`; ANTLR takes the first alternative, so an empty `plugins { }` is a block, here as upstream.

Expression and statement layer: identical to `ScriptParser.g4` except the script-only `incompleteExprAlt`, nullable types (`QUESTION?`), typed formal parameters, wildcard type arguments, script keyword identifiers, and the config shapes of `variableDeclaration`, `variableNames` and `catchClause`. The two grammars share 53 labelled alternatives (every non-config `#...Alt`), checked by script during planning. So config values need the same expression AST as scripts.

Comments: `ML_COMMENT` and `SL_COMMENT` are `-> type(NL)` on the default channel (`ConfigLexer.g4:818-829`), so every comment is a terminal in the parse tree, consumed by `nls`/`sep`. No hidden channel; whitespace and `\`-newline are skipped. There is no shebang rule in the config lexer.

### 1.2 Upstream (nf-lang v26.10.7, commit `0ad848ef`)

Fetched from raw.githubusercontent.com into the scratchpad (`f103-up/`): `config/parser/ConfigAstBuilder.java` (1451 lines), `config/ast/*.java`, `script/formatter/{Comment,Comments,CommentAttacher}.java`, `script/parser/{EscapeUtils,PositionConfigureUtils}.java`, `config/formatter/ConfigFormattingVisitor.java`, the `ConfigFormatterTest` and runtime `ConfigParserV2Test` tests, and Groovy 4.0.33's `StringUtils.java` (Nextflow 26.10.7 pins `groovyVersion=4.0.33`).

- **AST shape** (`config/ast`): `ConfigNode` (module) holds `ConfigStatement`s: `ConfigAssignNode(names: List<String>, value)`, `ConfigBlockNode(kind, name, statements)` (selectors are blocks with a `kind`), `ConfigApplyBlockNode(name, statements: List<ConfigApplyNode>)`, `ConfigIncludeNode(source)`, `ConfigIncompleteNode(text)`. Invalid statements are reported and dropped.
- **Positions**: `PositionConfigureUtils.ast(node, ctx)` sets start from `ctx.start` and end from `ctx.stop` (multi-line stop tokens handled). Path elements (`a.b`, `a()`, `a[0]`) take their start from the receiver: `ast(result, expression, pathElementCtx)`.
- **Comments**: `Comments.collect(tokens, NL)` keeps NL tokens whose text starts with `//` or `/*`, with CRLF normalised and trailing whitespace stripped; `ownLine` is true when no code token ended on that line before it. `CommentAttacher` (600 lines) then attaches each comment through a tree of containers (file, blocks, selectors, apply blocks, closures, lists, maps, parenthesised argument lists, if/try branches) and slots (statements, apply calls, list elements, map entries, arguments, chain links). The rules: an end-of-line comment after a child trails it; a comment inside a child's extent becomes leading on that child; a comment before a child leads it; otherwise it dangles on the container. The 26.10.7 formatter (`nextflow lint -format`) prints from these attachments.
- **Errors**: the 7 F-101 cases plus everything else `ConfigAstBuilder` reports; see 1.4.

### 1.3 Positions and slicing

- antlr4ng's `CharStream.fromString` stores code points, so `Token.start`/`Token.stop` are code-point indices and `Token.column` counts code points, as nf-lang does (spike S2). JavaScript strings and Monaco use UTF-16 offsets. A range that slices JS text therefore needs a code point to UTF-16 map (identity when the text has no surrogate pairs).
- ANTLR counts lines on `\n` only; a lone `\r` is a column character. The line index must do the same so positions agree with `Token.line`.
- The corpus configs have no astral characters and no CR (checked), and 3 files have non-ASCII BMP characters. So the CRLF and astral cases must be unit tests with inline strings.

### 1.4 AST-builder errors, verified with `nextflow lint` 26.10.7

The 7 F-101 inputs (`packages/lang-2610/test/ported/cases.json`, owner F-103) and the recorded lint errors. Ranges follow upstream: an invalid statement spans its context; an escape spans 2 characters from the backslash.

| Id | Input | Lint (line:col message) | Range |
|---|---|---|---|
| ConfigAstBuilderTest-L059 | top-level if/else | 1:1 If statements cannot be mixed with config statements | 1:1-6:2 |
| ConfigAstBuilderTest-L076 | if/else inside `withName: 'HELLO'` | 3:9 If statements cannot be mixed with config statements | 3:9-8:10 |
| ConfigAstBuilderTest-L097 | top-level try/catch | 1:1 Try-catch blocks cannot be mixed with config statements | 1:1-5:2 |
| ConfigAstBuilderTest-L113 | try/catch around `includeConfig` | 1:1 Try-catch blocks cannot be mixed with config statements | 1:1-5:2 |
| ConfigAstBuilderTest-L129 | `def trace_timestamp = ...` | 1:1 Variable declarations cannot be mixed with config statements | 1:1-1:63 |
| ConfigAstBuilderTest-L163 | `params.x = 'a\.b'` | 1:14 Invalid escape sequence: '\.' | 1:14-1:16 |
| ConfigAstBuilderTest-L175 | `params.x = "${params.y}/res\q.txt"` | 1:28 Invalid escape sequence: '\q' | 1:28-1:30 |

The other errors in `ConfigAstBuilder.java` were probed with real `nextflow lint -o json` 26.10.7 (`NXF_SYNTAX_PARSER=v2`, offline) on 2026-11-22. Inputs and output: scratchpad `f103-probe/cases/`, `cases2/`, `lint.json`, `lint2.json`.

| Probe | Input | Lint | Producer | Kind |
|---|---|---|---|---|
| p01 | `process {\n    cpus 4\n}` | 1:1 Config settings must be assigned with an equals sign (`=`) | ConfigAstBuilder.java#L259-L260 | collected |
| p02 | `process.cpus` | 1:1 Incomplete statement | #L342-L346 | collected |
| p03 | `process {\n    cpus\n}` | 2:5 Incomplete statement | #L342-L346 | collected |
| p04 | `process.` | 1:1 Incomplete statement | #L342-L346 | collected |
| p05 | `process.ext.args = { def goto = 1; goto }` | 1:26 and 1:36 `goto` is not allowed as an identifier because it is a Groovy keyword | #L523-L526 | collected |
| p06 | `process.ext.args = { foo() = 1 }` | 1:22 Invalid assignment target -- must be a variable, index, or property expression | #L547 | fatal |
| p07 | `params.x = [,]` | 1:13 Empty list literal should not contain any comma(,) | #L1055 | fatal |
| p08 | `params.x = foo(a: 1, a: 2)` | 1:22 Duplicated named argument 'a' found | #L1196 | fatal |
| p09 | `process.ext.args = { ((a)) = 1 }` | 1:22 Nested parenthesis is not allowed in multiple assignment, e.g. ((a)) = b | #L538 | fatal |
| p10 | `params.x = 99999999999i` | 1:12 Number of value 99999999999 does not fit in the range of int, but int was enforced. | #L860-L873, #L213-L214 (Groovy `Numbers.parseInteger`) | deferred to the end |
| p17 | `params.x = 'a\qb' + "c\.d"` | 1:14 '\q'; 1:23 '\.' | EscapeUtils | collected |
| p18 | `if( true ) { ... }\ndef x = 1` | 1:1 If statements...; 2:1 Variable declarations... | #L348-L359 | collected |
| p19 | p06 then `params.y = [,]` | only 1:22 Invalid assignment target | fatal aborts the build | abort |
| q01 | p10 then `params.y = 'a\qb'` | 1:12 Number of value...; 2:14 Invalid escape | number error thrown after all statements | deferred |
| q02 | escape, then p06, then another escape | 1:14 escape; 2:22 Invalid assignment target (the later escape is not reported) | | abort |

Lint-clean probes, so not AST errors: p11 `withFoo:` selector; p12 a selector inside `docker`, which only the runtime rejects; p14 `plugins`; p15 quoted and built-in-type names; p16 `'!FOO|BAR'` and `withLabel: big`. p13 (`includeConfig` inside `process`) fails in the resolver, not the AST builder ("Config includes are only allowed at the top-level or in a profile", plus "Invalid include source"), so it belongs to F-105 or F-112.

Error policy to mirror: collected errors accumulate; the first fatal error is recorded and then nothing more is collected; a number-format error is held and appended after all statements unless a fatal error came first. The AST is still built in full either way (ADR 0004).

### 1.5 Corpus survey (scratch script over the F-101 parser, all 228 lint-checked `.config` files)

- Files: 228 (rnaseq 147, sarek 65, fetchngs 14, rnaseq-nf 1, rnaseq-nf-typed 1), 498 KB. All parse; lint accepts all (spike S2).
- Step 1's set: 72 files named `nextflow.config` plus 112 under a `conf/` directory (`conf/` and `conf/modules/`) = 184. The other 44 are module and subworkflow test configs (`tests/*.config`).
- Statements: 4,349. Top level: 599 blocks, 46 assignments, 104 includes, 3 `plugins` apply blocks. Nested: 2,425 assignments, 94 blocks, 1,057 selectors (1,027 `withName`, 30 `withLabel`), 21 includes (in profiles). No incomplete or invalid statements. Assignment paths have 1 to 3 elements. 950 names are quoted strings. 117 includes take a plain path; 8 take a ternary.
- Values: 11,979 expression contexts (1,120 closures, 1,273 GStrings, 2,163 map entries, 560 ternaries, 3,580 property accesses). Closure bodies hold if/else (71), return (50), `def` (40) and expression statements (1,128).
- Comments: 770, of which 125 are inside an expression's extent (list elements, maps, closures).
- Snapshot size: a statement-level format (5.2) comes to 5,355 lines and 249 KB in total, largest 22 KB (`sarek/nextflow.config`). One line per node would be about 88k parse-rule contexts, roughly 2 MB.

### 1.6 Consumers

- **F-104** (round trip, declaration-level fallback): config "declarations" are top-level statements. `tools/corpus/fixtures/fixtures.yaml` names them `assign <path>` and `block <name>`, which `ConfigAssign.path` and `ConfigBlock.name` give directly. Equivalence ("same AST ignoring positions and whitespace, same comments in order") needs values as real nodes, `raw` text for literals, and the ordered comment list. F-104 may add an unparsed-chunk statement kind. Keep `ConfigStatement` a plain union so that can be added later.
- **F-601** (config editor). The AST stays syntactic; F-601 maps it to `catalogue/config.json` (42 scopes; node kinds `scope`, `option`, `placeholder`, `dsl`):
  - A top-level `ConfigBlock` name, or the first name of a top-level `ConfigAssign.path`, is a catalogue scope. An unknown one is kept and flagged (FI-03).
  - Nested block names and later path names walk `children`. A `placeholder` scope consumes one free name (for example `azure.batch.pools.<name>`); `dsl` (`plugins`) corresponds to `ConfigApplyBlock`.
  - `ConfigSelector` under `process` or `agent` is the selector form. The target is a name or a pattern (`|`, `!` and regular expressions, per `docs/config.mdx#L185-L255` at v26.10.7); FI-06 matching is F-601's.
  - Each child block of `profiles` is a profile whose statements re-root at the top level. `params` and `env` are scopes with no catalogue children (free keys).
  - Literal values feed typed forms; other expressions are kept as code.
  - FI-05 links come from `ConfigInclude.source` when it is a `StringLiteral` (decoded `value`), or from each literal branch of a ternary; F-105 resolves paths relative to the including file.
- **F-112**: surfaces `AstError`s as LA-30 diagnostics. They are `{ message, range }` with lint's start line and column.

## 2. Shared conventions with F-102 (proposal; reuse F-102's if it defines these first)

### 2.1 Where things live

- **Types** in `packages/lang-core/src/ast/`, re-exported from `src/index.ts`. The engine and app may import only lang-core and a pack's entry (ADR 0003), so AST types must be in lang-core:
  - `base.ts`: positions, comments, node base, errors, parse result.
  - `expression.ts`: expressions and code statements, shared.
  - `config.ts`: F-103.
  - `script.ts`: F-102.
- **Logic** in `packages/lang-2610/src/ast/`. ADR 0006: shared code moves to lang-core only once a second pack exists. dependency-cruiser already allows this.
- Don't name anything `ConfigNode`: lang-core already exports `ConfigNode` for the catalogue (`src/catalogue.ts`). The config AST union is `ConfigAstNode`.

### 2.2 Base types (`packages/lang-core/src/ast/base.ts`)

```ts
/** A point in a source file. `offset` is the UTF-16 index (JavaScript slicing, Monaco getPositionAt); `line` and
 *  `column` are 1-based, the column counted in code points, as nf-lang and `nextflow lint` report. Lines break at `\n`
 *  only, as ANTLR counts them. */
export type Position = { readonly offset: number; readonly line: number; readonly column: number };
/** Half-open: `end` is just after the last character. `text.slice(start.offset, end.offset)` is the node's source. */
export type Range = { readonly start: Position; readonly end: Position };

export type Comment = {
  readonly style: "line" | "block";
  /** Exact source text. A line comment's trailing whitespace is outside the comment (nf-lang strips it too). */
  readonly text: string;
  readonly range: Range;
  /** The first thing on its line (nf-lang Comment.ownLine); false for an end-of-line comment. */
  readonly ownLine: boolean;
};

/** Where nf-lang's CommentAttacher puts a comment. Every comment is attached exactly once. */
export type CommentPlacement = {
  readonly leadingComments?: readonly Comment[];
  readonly trailingComments?: readonly Comment[];
  /** Comments inside a container (file, block, closure, list, map, argument list) with no child to attach to. */
  readonly danglingComments?: readonly Comment[];
};

export type NodeBase<K extends string> = CommentPlacement & { readonly kind: K; readonly range: Range };

/** An error found while building the AST (nf-lang's AST builders and EscapeUtils). The file is still modelled. */
export type AstError = { readonly source: "ast"; readonly message: string; readonly range: Range };

/** The first lexer or parser error. Moved unchanged from lang-2610's parse.ts (F-101), which re-exports it. */
export type ParseError = {
  source: "lexer" | "parser"; message: string; line: number; column: number; endLine: number;
  /** Exclusive. As nf-lang: the start column plus the offending token's length in UTF-16 units. */
  endColumn: number;
};

/** AR-01's parse status and AST. A file that fails the grammar has no AST (F-104 handles the fallback). */
export type ParseResult<A> =
  | { readonly status: "parsed"; readonly ast: A; readonly errors: readonly AstError[] }
  | { readonly status: "failed"; readonly error: ParseError };
```

Conventions:
1. `kind` is a PascalCase discriminant. Config statement nodes are prefixed `Config`.
2. A node's range runs from the first character of its first token to just after its last token. It never starts or ends on a newline or comment token: no node takes its range from `nls`, `sep` or `blockStatements` contexts. Property, call and index nodes start at their receiver, as upstream.
3. The root node carries `comments: readonly Comment[]`, all comments in source order (AR-01's comment map). Each comment is also attached to exactly one node, in that node's `leadingComments`, `trailingComments` or `danglingComments`. Storing them on nodes survives structured cloning to and from the worker; an identity map wouldn't.
4. Fields are `readonly`. Builders construct mutable objects internally.
5. Builders throw only on internal bugs (an unknown context class). Source problems become `AstError`s.

### 2.3 Shared logic (`packages/lang-2610/src/ast/`)

| File | Exports | Shared? |
|---|---|---|
| `source-text.ts` | `class SourceText` (code points to UTF-16, line index, positions, ranges from tokens) | yes |
| `comments.ts` | `collectComments` (port of `Comments.collect`), `attachConfigComments` (port of `CommentAttacher`: core, `ExpressionWalker`, statement containers, config statements). F-102 adds `attachScriptComments` on the same core | core shared; config entry point is F-103's |
| `escapes.ts` | `checkEscapes` (port of `EscapeUtils`) | yes |
| `strings.ts` | `quoteOf`, `decodeStringLiteral` (nf-lang `stringLiteral()` with Groovy 4.0.33 `StringUtils`) | yes |
| `errors.ts` | `class ErrorSink` (the error policy in 1.4) | yes |
| `expression-builder.ts` | `type GrammarBinding`, `class ExpressionBuilder` | yes (open point 1) |
| `config-grammar.ts` | `configGrammar: GrammarBinding` (ConfigParser's classes) | F-103 |
| `visit.ts` | `childrenOf`, `walk`, `CHILD_KEYS` | yes |
| `config-builder.ts`, `parse-config.ts` | F-103 entry points | F-103 |

### 2.4 What configs need from the shared expression layer

If F-102 owns the expression layer, F-103 needs all of the following from it:
- Every one of the 53 shared labelled alternatives, built from ConfigParser contexts. That means a builder parametrised by the grammar's context classes (`GrammarBinding`), or a second builder; see open point 1.
- Command-style calls in expression statements (`includeConfig 'x'` inside a try block, ConfigAstBuilderTest-L113).
- The config shapes of `variableDeclaration` (`(DEF | legacyType | DEF legacyType) identifier ...`, `DEF variableNames ...`), `catchClause` (`catchTypes? identifier`) and `formalParameter` (legacy form only).
- `type` without `QUESTION`, and `identifier` including `INCLUDE_CONFIG`.
- The error checks in 1.4 that live in the expression and statement code: Groovy keywords, invalid assignment target, nested parentheses, empty list with a comma, duplicated named argument, escapes, number format.
- An `IfStatement.elseKeyword` range, which `CommentAttacher` needs (upstream's `ELSE_POSITION`).

Proposed expression layer (`packages/lang-core/src/ast/expression.ts`). Each kind is `NodeBase<Kind> & {...}`; it mirrors the grammar, not Groovy's desugared AST:
- **Literals**:
  - `StringLiteral { raw; value; quote: "'" | '"' | "'''" | '"""' | "/" }`
  - `IntegerLiteral { raw }`, `FloatLiteral { raw }`
  - `BooleanLiteral { value }`, `NullLiteral`
- **Strings**: `GString { quote: '"' | '"""'; parts: (GStringText | Expression)[] }` with `GStringText { raw; value }`. `$a.b` paths become `Variable`/`Property` nodes positioned as upstream's `gstringPath`.
- **Names**:
  - `Variable { name; builtInType: boolean }` (identifier and built-in-type primaries)
  - `Identifier { name }` (declared names: parameters, variables, catch variables, labels)
  - `PropertyName { name; form: "identifier" | "string" | "keyword" }`
- **Collections**:
  - `ListLiteral { elements; trailingComma }`
  - `MapLiteral { entries; trailingComma }` with `MapEntry { key: PropertyName | Expression; value }`. A bare label is a `PropertyName`.
- **Paths**:
  - `Property { object; name: PropertyName; operator: "." | "?." | "*." }`
  - `Index { object; index: Expression[] }`
  - `Call { callee; arguments: Argument[]; parens: boolean; trailingComma; closures: Closure[] }`: `foo(1)`, `foo { }`, `foo(1) { }`, `x.each { }`, and command calls `foo bar`.
  - `Argument = Expression | NamedArgument { name: PropertyName; value }`
- **Operators**:
  - `Unary { operator: "!" | "~" | "+" | "-"; operand }`
  - `Binary { operator; left; right }`: arithmetic, `**`, shifts, `..`/`..<`, relational, `in`/`!in`, equality, `<=>`, `=~`/`==~`, bitwise, logical.
  - `Cast { expression; type }` (`as`); `InstanceOf { expression; type; negated }`
  - `Ternary { condition; then; else }`; `Elvis { condition; else }`
  - `Paren { expression }`, kept for fidelity
  - `New { type; arguments; trailingComma }`
- **Closures**: `Closure { parameters: Parameter[]; arrow: boolean; body: Statement[]; labelled: boolean }` with `Parameter { name: Identifier; type?: TypeRef; defaultValue? }`.
- **Types**: `TypeRef { name; arguments: TypeRef[]; dimensions: number }`, plus `nullable` for scripts only.
- **Statements**:
  - `Block { statements }`
  - `IfStatement { condition; then; else?; elseKeyword?: Range }`
  - `TryStatement { body; catches: CatchClause[] }` with `CatchClause { types: TypeRef[]; name: Identifier; body }`
  - `ReturnStatement { value? }`, `ThrowStatement { value }`, `AssertStatement { condition; message? }`
  - `VariableDeclaration { names: Identifier[]; type?: TypeRef; def: boolean; initializer? }`
  - `AssignmentStatement { targets: Expression[]; operator; value }`, covering multiple assignment
  - `ExpressionStatement { expression }`, `EmptyStatement`, `LabeledStatement { label: Identifier; statement }`
- **Unions**: `Expression`, `Statement`, `ExpressionNode` (all of the above).

## 3. Files

Paths are from the repo root. "(Tn)" is the task that creates or changes the file.

### Create

**`packages/lang-core/src/ast/base.ts`** (T1). The types in 2.2.

**`packages/lang-core/src/ast/expression.ts`** (T2). The types in 2.4, or F-102's.

**`packages/lang-core/src/ast/config.ts`** (T3):
```ts
import type { Comment, NodeBase, ParseResult } from "./base.ts";
import type { Argument, Expression, IfStatement, TryStatement, VariableDeclaration } from "./expression.ts";

/** A name in a config path, block header or selector: `docker`, `'foo-bar'` (value decoded), `int`. */
export type ConfigName = NodeBase<"ConfigName"> & { readonly name: string; readonly form: "identifier" | "string" | "builtInType" };
/** `docker.enabled = true` (nf-lang ConfigAssignNode). */
export type ConfigAssign = NodeBase<"ConfigAssign"> & { readonly path: readonly ConfigName[]; readonly value: Expression };
/** `name { ... }`: a scope, `profiles`, a profile, `params`, `env`; syntactically the same (nf-lang ConfigBlockNode, no kind). */
export type ConfigBlock = NodeBase<"ConfigBlock"> & { readonly name: ConfigName; readonly statements: readonly ConfigStatement[] };
/** `withName: 'FOO' { ... }` inside a block (nf-lang ConfigBlockNode with a kind). `selector` is the identifier as written. */
export type ConfigSelector = NodeBase<"ConfigSelector"> & {
  readonly selector: ConfigName; readonly target: ConfigName; readonly statements: readonly ConfigStatement[];
};
/** `plugins { id 'nf-schema@2.1.0' }` (nf-lang ConfigApplyBlockNode). Any name but `plugins` is an AstError. */
export type ConfigApplyBlock = NodeBase<"ConfigApplyBlock"> & { readonly name: ConfigName; readonly statements: readonly ConfigApply[] };
export type ConfigApply = NodeBase<"ConfigApply"> & { readonly name: ConfigName; readonly arguments: readonly Argument[] };
/** `includeConfig <expression>` (FI-05). */
export type ConfigInclude = NodeBase<"ConfigInclude"> & { readonly source: Expression };
/** `process.cpus` or `process.` with no value: "Incomplete statement". */
export type ConfigIncomplete = NodeBase<"ConfigIncomplete"> & { readonly path: readonly ConfigName[]; readonly trailingDot: boolean };
/** An if, try or `def` among config statements. nf-lang reports and drops it; we keep it (ADR 0004). */
export type ConfigInvalid = NodeBase<"ConfigInvalid"> & { readonly statement: IfStatement | TryStatement | VariableDeclaration };
export type ConfigStatement =
  | ConfigAssign | ConfigBlock | ConfigSelector | ConfigApplyBlock | ConfigInclude | ConfigIncomplete | ConfigInvalid;
export type ConfigFile = NodeBase<"ConfigFile"> & {
  readonly statements: readonly ConfigStatement[];
  /** Every comment in source order (AR-01's comment map); each is also attached to exactly one node. */
  readonly comments: readonly Comment[];
};
export type ConfigAstNode = ConfigFile | ConfigStatement | ConfigApply | ConfigName;
export type ConfigParseResult = ParseResult<ConfigFile>;
```

**`packages/lang-2610/src/ast/source-text.ts`** (T1):
```ts
export class SourceText {
  constructor(text: string);
  readonly text: string;
  /** The position of a code-point index into the ANTLR char stream (Token.start, or Token.stop + 1). */
  at(codePointIndex: number): Position;
  atOffset(offset: number): Position;
  /** From the first character of `start` to just after the last character of `stop` (stop defaults to start). */
  span(start: Token, stop?: Token | null): Range;
  between(start: Position, end: Position): Range;
  slice(range: Range): string;
}
```

**`packages/lang-2610/src/ast/comments.ts`** (T1 collect, T3 attach). Apache-2.0 attribution header like `abstract-lexer.ts`.
```ts
/** Port of nf-lang Comments.collect: NL tokens starting with // or /*; line comments end before trailing whitespace. */
export function collectComments(tokens: readonly Token[], nlType: number, source: SourceText): Comment[];
/** Port of nf-lang CommentAttacher for config files (config statements, ExpressionWalker, if/try containers). Mutates placements. */
export function attachConfigComments(file: ConfigFile, comments: readonly Comment[]): void;
```

**`packages/lang-2610/src/ast/escapes.ts`** (T1):
```ts
/** Port of nf-lang EscapeUtils.checkEscapes. `raw` is the token text starting at `start`. Ranges cover the 2 characters
 *  from the backslash. Columns are code points; nf-lang adds UTF-16 units, which differs only after an astral character. */
export function checkEscapes(raw: string, start: Position, slashy: boolean, source: SourceText): AstError[];
```

**`packages/lang-2610/src/ast/strings.ts`** (T1). Attribution header for Groovy (Apache-2.0).
```ts
export type Quote = "'" | '"' | "'''" | '"""' | "/";
export function quoteOf(raw: string): Quote;
/** nf-lang ConfigAstBuilder.stringLiteral(text): removeCR (triple-quoted and slashy), trimQuotations, then Groovy 4.0.33
 *  StringUtils.replaceEscapes (standard, octal and unicode escapes and line escapes; `\/` only in slashy strings). */
export function decodeStringLiteral(raw: string): string;
```

**`packages/lang-2610/src/ast/errors.ts`** (T1):
```ts
export class ErrorSink {
  constructor(source: SourceText);
  /** Collected (nf-lang collectSyntaxError). Ignored once a fatal error is recorded. */
  add(message: string, range: Range): void;
  /** nf-lang createParsingFailedException: record it, then ignore everything after it. */
  fatal(message: string, range: Range): void;
  /** nf-lang numberFormatError: kept and appended by finish() unless a fatal error came first. Only the first is kept. */
  deferNumberFormat(message: string, range: Range): void;
  finish(): AstError[];
}
```

**`packages/lang-2610/src/ast/expression-builder.ts`** (T2):
```ts
type Ctor<T> = abstract new (...args: never[]) => T;
/** The labelled-alternative context classes of one grammar (the 53 shared by ConfigParser and ScriptParser, plus
 *  incompleteExprAlt for scripts). Operators are read from token text, never from token type numbers, which differ
 *  between the two vocabularies. */
export type GrammarBinding = { readonly grammar: "config" | "script"; readonly alt: { readonly [label: string]: Ctor<ParserRuleContext> } };
export class ExpressionBuilder {
  constructor(grammar: GrammarBinding, source: SourceText, errors: ErrorSink);
  expression(ctx: ParserRuleContext): Expression;
  statement(ctx: ParserRuleContext): Statement;
  argumentList(ctx: ParserRuleContext | null): Argument[];
  /** `string(ctx)` upstream: StringLiteral with escapes checked. */
  stringLiteral(ctx: ParserRuleContext): StringLiteral;
}
```
In practice, type `alt` as a precise object (one named key per label), so `instanceof` narrows to accessor shapes. The builder writes small structural interfaces (`PathExprAltLike`, ...) that both grammars' generated classes satisfy.

**`packages/lang-2610/src/ast/config-grammar.ts`** (T2): `export const configGrammar: GrammarBinding` (imports from `../generated/ConfigParser.ts`).

**`packages/lang-2610/src/ast/visit.ts`** (T2 for expressions, T3 for config kinds):
```ts
export type AstNode = ConfigAstNode | ExpressionNode;   // F-102 adds ScriptAstNode
/** Child field names per kind, in source order. `satisfies Record<AstNode["kind"], readonly string[]>` keeps it exhaustive. */
export const CHILD_KEYS: Readonly<Record<AstNode["kind"], readonly string[]>>;
export function childrenOf(node: AstNode): AstNode[];   // in source order
export function walk(node: AstNode, visit: (node: AstNode, parent: AstNode | undefined, key: string | undefined) => void): void;
```

**`packages/lang-2610/src/ast/config-builder.ts`** (T3). Port of `ConfigAstBuilder`'s config-statement layer, with an attribution header.
```ts
/** Builds the config AST from a parse tree that parsed. Never throws for source problems; see ErrorSink for the error policy. */
export function buildConfigAst(source: SourceText, tree: CompilationUnitContext, tokens: readonly Token[]): { ast: ConfigFile; errors: AstError[] };
```

**`packages/lang-2610/src/ast/parse-config.ts`** (T3):
```ts
/** parseConfig (F-101), then buildConfigAst, collectComments and attachConfigComments. */
export function parseConfigFile(text: string): ConfigParseResult;
```

**Tests and test support** (section 4): `packages/lang-2610/test/ast/*.test.ts`, `test/config-ast/*.test.ts`, `test/config-ast/snapshots/*.ast`, `test/support/{ast-snapshot,range-invariants,strip}.ts`, `test/corpus/config-ast.corpus.ts`, `test/corpus/config-snapshots.test.ts`, `test/corpus/snapshots/config/<pipeline>/<path>.ast` (228 files).

**Oracle cases** (T3; open point 8). They are ordinary lint-checked fixtures, so AGENTS.md's oracle rule holds without a new exception:
- `tools/oracle/cases/config-constructs/` (`lint: { expect: ok }`):
  - `assignments.config`: docs `config.mdx#L29-L45`; quoted names; `int { }`.
  - `blocks.config`: `#L47-L77`, including the three `executor.retry.maxAttempt` forms.
  - `selectors.config`: `#L185-L286`, including `'hello|bye'`, `'!hello'`, `'!align.*'`, `'aloha:bye'`, `agent` selectors and `withFoo:`.
  - `profiles.config`: `#L319-L357`, with mixed dot and block syntax and `includeConfig` in a profile.
  - `includes.config` with `conf/base.config`, `conf/a.config`, `conf/b.config`: `#L79-L95`, plain and ternary sources.
  - `values.config`: every expression and statement kind in 2.4 under `params.*` and `process.ext.*`.
  - `env-params.config`: `#L97-L167`, `env { }`, `env('X')` and nested params.
  - `process-ext.config`: `publishDir` map with closures, `ext.args` closures and `when`, after `#L287-L317`.
  - `plugins.config`: ConfigParserV2Test#L60-L82.
  - `comments.config`: ConfigFormatterTest#L102-L141, comments in lists, maps and closures, and between `if` and `else`.
  - `workflow.config`: `#L359-L380`, `workflow.onComplete` and `workflow.output.mode`.
  - `manifest.config`: `manifest { contributors = [[...]] }` and `nextflow.enable.configProcessNamesValidation`.

  Each file starts with a comment citing its source at v26.10.7.
- `tools/oracle/cases/config-ast-errors/` (`lint: { expect: error, errors: [...] }`, one message per probe): probe files p01 to p09, p17, p18, p19, q02, plus p10 and q01 if open point 5 includes number-format errors.

  `tools/oracle/cases/cases.yaml` gains both entries with `spec: [F-103, FI-01, FI-05]` and `sources` (docs and upstream test URLs at v26.10.7).

### Change

**`packages/lang-core/src/index.ts`** (T1, T2, T3): `export type { ... } from "./ast/base.ts"`, likewise `./ast/expression.ts` and `./ast/config.ts`. `LanguagePack` doesn't change (open point 9).

**`packages/lang-2610/src/parser/parse.ts`** (T1):
- `ParseOutcome`'s ok branch gains `tokens: readonly Token[]` (`tokens.fill()` then `tokens.getTokens()`, EOF included).
- `ParseError` becomes `import type { ParseError } from "@nf-builder/lang-core"` plus `export type { ParseError }`.

Both changes are additive. The callers keep working unchanged: `test/corpus/parse.corpus.ts` reads fields; `test/ported/ported.test.ts` maps outcomes to `{ ok: true }` or `{ ok: false, ...error }`; `test/parse.test.ts` and `test/descriptive-error-strategy.test.ts` use `toMatchObject`.

**`.gitattributes`** (T4): add `packages/lang-2610/test/corpus/snapshots/** -text` and `packages/lang-2610/test/config-ast/snapshots/** -text`, so snapshots compare byte for byte on every platform.

**Records (orchestrator, T5)**:
- `docs/licences.md`. Extend the "Ported nf-lang classes" row with `Comments`, `CommentAttacher`, `EscapeUtils` and `ConfigAstBuilder` (`packages/lang-2610/src/ast/`). Add rows:
  - "Groovy 4.0.33 `StringUtils` escape handling (`src/ast/strings.ts`), Apache-2.0".
  - "Corpus-derived config AST snapshots (`packages/lang-2610/test/corpus/snapshots/`): names, include paths and selector patterns from nf-core/rnaseq, sarek, fetchngs (MIT) and nextflow-io/rnaseq-nf (Apache-2.0); no other source text".
- `AGENTS.md` `pnpm test:corpus` row: "also the config AST snapshots and range checks (F-103); `pnpm test:corpus config-ast -u` rewrites snapshots after an intended AST change or a pin bump".
- The ADR and the AR-02 amendment (open point 3).
- `docs/plan/features.json` (`passes`, `notes` only) and `docs/plan/progress.md`.

**No change**:
- The generated parser, the grammar and `port.ts`.
- Workflows: `corpus-parse` already runs `pnpm test:corpus`, whose include `packages/*/test/**/*.corpus.ts` picks up the new file, and `oracle` runs every case.
- `engine`, `apps/web`, dependency-cruiser rules.
- Dependencies: no new runtime or dev dependency.

## 4. Tests (write before the implementation)

Names cite IDs: `F-103 step N <REQ>: ...`. Unit tests run in `pnpm check`; `*.corpus.ts` runs in `pnpm test:corpus` and CI's `corpus-parse` job.

### 4.1 Shared base (T1): `packages/lang-2610/test/ast/`

| File | Test name | Asserts |
|---|---|---|
| `source-text.test.ts` | `F-103 step 2 AR-01: positions count lines at \n and columns in code points, offsets in UTF-16` | For `"a = '𝐀𝐀'\nb = 1\n"`, the token `b` has offset 11 (two surrogate pairs), line 2, column 1. The string token `'𝐀𝐀'` runs from 1:5 (offset 4) to 1:9 (offset 10). `slice` returns `'𝐀𝐀'`. |
| `source-text.test.ts` | `F-103 step 2 AR-01: CRLF and a lone CR are counted as ANTLR counts them` | For `"a = 1\r\nb = 2"`, `b` is 2:1 at offset 7. With a lone `\r` (`"a = 1\rb = 2"`), `b` is 1:7. Both agree with `Token.line` and `Token.column + 1` from `ConfigLexer`. |
| `source-text.test.ts` | `F-103 step 2: span covers multi-line tokens` | A `'''` string over 3 lines ends at line 3, just after the closing quotes. A block comment likewise. |
| `comments.test.ts` | `F-103 AR-01: collectComments keeps every // and /* comment in order with ownLine as nf-lang's Comments.collect` | In `"// a\nx = 1 // b\n/* c\n d */\ny = [1, // e\n 2]\n"`: 4 comments; texts exact; `ownLine` is true, false, true, false; line comment ranges exclude trailing spaces. `params.url = "${params.host}//path"` has no comments (ConfigFormatterTest#L133). |
| `escapes.test.ts` | `F-103 FI-01: checkEscapes reports nf-lang's message and position for each invalid escape` | The L163, L175 and p17 inputs give the 1.4 ranges and messages. Valid escapes (`\b\t\n\f\r\s\"\'\\\$`, octal `\0` to `\7`, `é`, backslash-newline) give none. Slashy strings give none. `\uZZZZ` gives `'\u'`. |
| `strings.test.ts` | `F-103 FI-05: decodeStringLiteral returns the value nf-lang gives each quote style` | `'conf/base.config'` gives `conf/base.config`; `"a\tb"` has a tab; `'''x\r\ny'''` gives `x\ny`; `/a\/b/` gives `a/b`; `'é'` gives `é`; `'a\\b'` gives `a\b`. |
| `errors.test.ts` | `F-103 FI-01: the error sink stops after the first fatal error and appends a number-format error last, as nf-lang does` | Sequences reproduce p19, q01 and q02: collected, fatal, then collected gives 2 errors; deferred plus collected gives collected first and deferred last (`finish()` order); fatal then deferred drops the deferred error. |
| `test/parse.test.ts` (extend) | `F-103 AR-01: a successful parse returns every token, comments included, ending with EOF` | `parseConfig("x = 1 // c\n").tokens` maps to types `[Identifier, ASSIGN, IntegerLiteral, NL, NL, EOF]`; the first NL's text is `// c`. |

### 4.2 Expression layer on config values (T2): `packages/lang-2610/test/ast/expression-builder.test.ts`

Each input is `params.x = <expr>` or `process.ext.args = { <statements> }`, built through `configGrammar`. Assertions are on `stripPositions`, with ranges checked by `checkRanges` (4.5).

| Test name | Asserts |
|---|---|
| `F-103 FI-01: config values build literal nodes keeping raw text` | Integers (`1`, `0x1F`, `1_000`, `10L`), floats (`1.5e3`, `2.0d`), `true`, `null`, and strings in all five quote styles give `raw` and `value`. |
| `F-103 FI-01: 8.GB and 1.h are property accesses on number literals` | `Property { object: IntegerLiteral 8, name GB, operator "." }`. |
| `F-103 FI-01: GStrings keep text parts and interpolations, including $a.b paths` | `"${params.outdir}/x_$meta.id"` gives `[Property, GStringText "/x_", Property(Variable meta, id)]` with upstream gstringPath ranges. |
| `F-103 FI-01: lists and maps keep trailing commas and label keys` | `[1, 2,]`; `[name: 'x', (k): 1, 'y': 2]`; `[:]`. |
| `F-103 FI-01: calls cover parentheses, trailing closures, named arguments and receivers` | `env('X')`; `foo { }`; `foo(1) { }`; `x.each { it }`; `foo(a: 1, 2)`; `new java.util.Date().format('y')`. |
| `F-103 FI-01: operators follow the grammar's precedence and associativity` | `a + b * c`; `a ?: b ?: c`; `c ? a : b ? d : e` (right-associative); `!a && b`; `a =~ /x/`; `1..<3`; `x as Integer`; `x !instanceof List`; `(a)` is kept as `Paren`. |
| `F-103 FI-01: closure bodies build every statement kind` | if/else (with `elseKeyword`), try/catch with multiple types, return, throw, assert, `def a = 1`, `def (a, b) = l`, `String s`, `x += 1`, `(a, b) = l`, a command call, `;`, `label: stmt` (closureWithLabels). |
| `F-103 FI-01: expression errors match nextflow lint 26.10.7` | p05 to p09 (and p10 if open point 5) give the 1.4 messages at lint's line and column. Each AST is still complete. |

### 4.3 Config AST (T3): `packages/lang-2610/test/config-ast/`

**`config-ast.test.ts`**:

| Test name | Asserts |
|---|---|
| `F-103 AR-01: parseConfigFile returns the parse status, the AST and the file's comments in order` | Parsed: `status: "parsed"`, `ast.kind === "ConfigFile"`, `ast.comments` in source order, `errors: []`. `"process {\n"` gives `status: "failed"` with F-101's EOF error, unchanged. |
| `F-103 FI-01: dotted and nested assignments keep their path names` | `docker.enabled = true` gives path `[docker, enabled]`. `'foo-bar'.x = 1` gives `form: "string"`, name `foo-bar`. `int { y = 3 }` gives `form: "builtInType"`. |
| `F-103 FI-01: the three equivalent forms of executor.retry.maxAttempt give the same full path` | A test helper joins enclosing block names with the assignment path; all three forms (docs `#L64-L77`) give `executor.retry.maxAttempt`. |
| `F-103 FI-01: selectors keep their kind and target, quoted or not` | `withLabel: big_mem`, `withName: 'PARENT:hello'`, `withLabel: '!hello'`, `withName: '.*:FOO'`, `withFoo: x` (kept, no error). Selectors nest inside `process` and `agent` blocks. |
| `F-103 FI-01: profiles are blocks of blocks, and include statements inside them are kept` | `profiles { test { includeConfig 'conf/test.config'; params.x = 1 } }`. |
| `F-103 FI-05: includeConfig lines are kept with their source expression and the decoded path` | Top-level `includeConfig 'conf/base.config'` gives `ConfigInclude { source: StringLiteral value "conf/base.config" }` with the range of the whole statement. A ternary source gives `Ternary` with two `StringLiteral` branches; a GString source gives `GString`. |
| `F-103 FI-01: plugins is an apply block; any other apply block is kept and reported` | `plugins { id 'nf-schema@2.1.0' }` gives `ConfigApplyBlock`, no error. p01 gives `ConfigApplyBlock process` plus the p01 error. Empty `plugins { }` is a `ConfigBlock` (first alternative, as nf-lang). |
| `F-103 FI-01: incomplete and invalid statements are kept in the AST and reported (ADR-0004)` | p02 to p04 give `ConfigIncomplete` (path, `trailingDot`) and an error. p18 gives two `ConfigInvalid` (IfStatement, VariableDeclaration) and two errors. |
| `F-103 FI-01: an unknown scope is kept as a block` | `tools/corpus/fixtures/unknown-scope.config`, read by path, gives 3 statements, `block notAScope`, `errors: []`. |
| `F-103 step 1 FI-01 FI-05: each construct fixture matches its full AST snapshot` | For each `tools/oracle/cases/config-constructs/**/*.config`: `renderConfigAst(..., "full")` passes `toMatchFileSnapshot("snapshots/<path>.ast")` with `errors: []`. |
| `F-103 step 2 AR-01: every node and comment of each construct fixture slices back to its exact source` | `checkRanges` returns `[]` for each fixture, for the CRLF and astral inline cases, and for the unit inputs above. |

**`comments.test.ts`** (attachment; inputs from ConfigFormatterTest#L102-L131 and the corpus):

| Test name | Asserts |
|---|---|
| `F-103 AR-01: comments attach as nf-lang's CommentAttacher: leading, trailing and dangling in blocks and apply blocks` | The `#L102` input: `// about the process scope` leads `process`; `// how many` trails `cpus = 2`; `// dangling` dangles on `process`; the same on `plugins` and `id`; the end-of-file comment dangles on `ConfigFile`. |
| `F-103 AR-01: an include keeps its leading and trailing comments` | The `#L123` input. |
| `F-103 AR-01: comments inside lists, maps, argument lists and closures attach to their elements` | The rnaseq `process.shell = [ "bash", "-C", // ... ]` shape: each end-of-line comment trails its element, and the last one trails `"pipefail"`. A comment before a map entry leads the entry. A comment in a closure body leads the next statement or dangles on the closure. |
| `F-103 AR-01: a comment between an if branch and else leads the else branch` | The CommentAttacher `ELSE_POSITION` rule in a closure. |
| `F-103 AR-01: every comment is attached exactly once and ast.comments lists them in source order` | For every construct fixture: the comments gathered by walking placements equal `ast.comments` as a multiset, and none appears twice. |

**`errors.test.ts`**:

| Test name | Asserts |
|---|---|
| `` `F-103 FI-01: ${probe} reports nextflow lint 26.10.7's errors` `` (one per file in `tools/oracle/cases/config-ast-errors/`) | `errors.map(e => ({ line: e.range.start.line, column: e.range.start.column, message: e.message }))` equals the 1.4 table, recorded in the test with the date and Nextflow version. |

**`ported-config.test.ts`** (reads `test/ported/cases.json`):

| Test name | Asserts |
|---|---|
| `` `F-103 FI-01: ${id} (${test}): the config AST builder reports ${message} at ${line}:${column}` `` (7 cases) | `parseConfigFile(file)` gives `status: "parsed"`, and its errors (start line, column, message) equal the case's `lint` list. Ends equal the 1.4 "Range" column. L059 to L129 keep a `ConfigInvalid` statement. |
| `F-103: exactly the seven ConfigAstBuilderTest inputs are owned by F-103` | The ids with `owner === "F-103"` are L059, L076, L097, L113, L129, L163 and L175. |

### 4.4 Step 1 on the corpus (T4): `packages/lang-2610/test/corpus/config-ast.corpus.ts`

It reads `.cache/corpus/<id>` for each id in `tools/corpus/corpus.yaml`, with `listSources` from `corpus-files.ts`, configs only. It doesn't need `.cache/corpus-lint`.

| Test name | Asserts |
|---|---|
| `F-103 step 1: every pinned pipeline is present` | Each `.cache/corpus/<id>` exists; otherwise fail with "run pnpm corpus:fetch". |
| `F-103 step 1 FI-01: every corpus config builds an AST with no AST errors` | 228 files, all `status: "parsed"` with `errors: []` (lint accepts them all). If `.cache/corpus-lint/<id>.json` exists, also assert lint reports no error for the file. |
| `F-103 step 1 FI-01 FI-05: each corpus config matches its committed statement-level snapshot` | `await expect(renderConfigAst(ast, text, "statements")).toMatchFileSnapshot("snapshots/config/<id>/<path>.ast")` for all 228 files. In CI (`CI=true`), vitest sets `updateSnapshot: "none"` (`vitest/dist/chunks/index.*.js`), so a missing or changed snapshot fails. |
| `F-103 step 1: every nextflow.config and conf/ config in the corpus is snapshotted, and no snapshot is stale` | The snapshotted set contains every path matching `(^\|/)nextflow\.config$` or `(^\|/)conf/.+\.config$` (184 at today's pins). Every file under `snapshots/config/` corresponds to a current corpus config. The failure message names stale files and says to delete them. |

### 4.5 Step 2 on the corpus (T4): same file, plus `test/support/range-invariants.ts`

`checkRanges(text, file, { reparse }): string[]` returns problems (empty when all hold). For every node from `walk(file)`, and every comment:
1. `0 <= start.offset < end.offset <= text.length`. `line` and `column` equal an independent recount: lines split at `\n`, columns counted as code points with `[...text.slice(lineStart, offset)].length + 1`.
2. The slice doesn't start or end with whitespace (space, tab, `\r`, `\n`). A node other than a comment doesn't start at a comment's start or end at a comment's end.
3. Leaf slices are exact:
   - `ConfigName`: the identifier, or the quoted literal whose decoded value is `name`.
   - `StringLiteral`, `IntegerLiteral`, `FloatLiteral`: the slice equals `raw`.
   - `Variable` and `Identifier`: the slice equals `name`.
   - `BooleanLiteral` and `NullLiteral`: `true`/`false` and `null`.
   - `Comment`: the slice equals `text`.
4. Children lie inside their parent's range; siblings are in source order and don't overlap.
5. Token accounting at the config level. Remove the child, name and comment ranges from a node's range; the non-whitespace characters left, `;` excluded, must be exactly:
   - `ConfigFile`: nothing.
   - `ConfigBlock` and `ConfigApplyBlock`: `{}`.
   - `ConfigSelector`: `:{}`.
   - `ConfigAssign`: `.` repeated `path.length - 1` times, then `=`.
   - `ConfigInclude`: `includeConfig`.
   - `ConfigIncomplete`: the dots.

   This proves no source text falls outside the statement layer.
6. With `reparse` on (corpus): each config statement's slice, parsed alone, gives an equal node under `stripPositions`. Top-level statements are parsed as they are; block-level ones wrapped in `__wrap__ {\n...\n}`; selectors in `process {\n...\n}`; `ConfigApply` in `plugins {\n...\n}`. Each `ConfigAssign.value` and `ConfigInclude.source` slice, parsed as `x = <slice>`, gives an equal value. That shows the range holds exactly the source of that node. Estimated cost: about 6.8k small parses, under 10 s warm.

| Test name | Asserts |
|---|---|
| `F-103 step 2 AR-01: every node and comment range of every corpus config slices back to its exact source` | `checkRanges(text, ast, { reparse: true })` is `[]` for all 228 files. The failure lists `<id>/<path> <kind> <range>: <problem>`, first 50. |
| `F-103 step 2: comments are all attached and the root list is in order on the corpus` | 770 comments at today's pins; the 4.3 attachment invariant holds for every file. |

**`packages/lang-2610/test/corpus/config-snapshots.test.ts`** (unit, in `pnpm check`):

| Test name | Asserts |
|---|---|
| `F-103 step 2: checkRanges flags a range that is one character off, a child outside its parent, and text outside every statement` | Hand-built broken ASTs from a small input each give the matching problem. A correct AST gives `[]`. |
| `F-103 step 1: the statement-level snapshot prints one line per config statement and comment, with value kinds and ranges` | `renderConfigAst` on a 6-line input equals an inline expected string (format in 5.2). |
| `F-103 step 1: snapshotPath maps a corpus file to test/corpus/snapshots/config/<id>/<path>.ast` | Path mapping, including nested `conf/modules/` paths. |

### 4.6 Not needed

- Playwright: no UI (Q13). The evidence is unit tests plus the CI `corpus-parse` and `oracle` jobs; the feature notes say so.
- fast-check: step 2 is exhaustive over the corpus and the construct fixtures rather than generated input. ADR 0011 names fast-check for edit commands.

## 5. Snapshot format and location

### 5.1 Two levels

- **Full** (construct fixtures, about 12 small files): one line per node of every kind, children indented with their field name (`value: Binary + 3:12-3:30`). This pins the shape of expressions and statements.
- **Statement level** (corpus, 228 files): one line per config statement and comment. Values appear only as their top node kind. This keeps the corpus snapshots to about 250 KB in total. One line per node would be about 2 MB and unreviewable, which ADR 0011's "committing the corpus bloats the repo" argues against. Expression structure on the corpus is covered by 4.5's re-parse check, and its exact shape by the full construct snapshots.

### 5.2 Statement-level format

Grammar: `<indent><Kind> <summary> <startLine>:<startCol>-<endLine>:<endCol>`. Two spaces per depth; end is exclusive; columns in code points.

```
ConfigFile 1:1-536:1
  #dangling block 1:1-7:3
  ConfigBlock params 10:1-161:2
    #leading line 9:1-9:34
    ConfigAssign input = NullLiteral 13:5-13:36
      #leading line 12:5-12:21
    ConfigAssign hisat2_build_memory = StringLiteral 82:5-82:46
      #trailing line 82:48-82:120
  ConfigAssign process.shell = ListLiteral 316:1-323:2
    #trailing line 318:19-318:79 -> StringLiteral
  ConfigInclude StringLiteral 'conf/base.config' 180:1-180:32
  ConfigBlock profiles 182:1-300:2
    ConfigBlock test 241:5-250:6
      ConfigInclude StringLiteral 'conf/test.config' 242:9-242:40
  ConfigBlock process 3:1-40:2
    ConfigSelector withName: '.*:BAM_RSEQC:RSEQC_BAMSTAT' 12:5-20:6
  ConfigApplyBlock plugins 1:1-3:2
    ConfigApply id (1 argument) 2:5-2:27
!error 1:1-6:2 If statements cannot be mixed with config statements
```

Summaries:
- `ConfigAssign`: the path, string-form names in single quotes, then `=` and the value kind.
- `ConfigBlock` and `ConfigApplyBlock`: the name.
- `ConfigSelector`: `<selector>: <target>`.
- `ConfigInclude`: the source kind, then the decoded value when it is a `StringLiteral`.
- `ConfigIncomplete`: the path plus a trailing `.` if any.
- `ConfigInvalid`: the statement kind.
- Comments: `#<leading|trailing|dangling> <line|block> <range>`, as children of their node. A comment attached to a node below this level gets `-> <Kind>`, so every comment appears exactly once.
- `!error` lines: last, in `errors` order.

Comment text and values are not copied into snapshots. Only names, selector targets and literal include paths are.

### 5.3 Location

Committed per file, mirroring corpus paths:
- `packages/lang-2610/test/corpus/snapshots/config/<id>/<path>.ast` (228 files, about 249 KB).
- Full snapshots: `packages/lang-2610/test/config-ast/snapshots/<fixture path>.ast`.

Why committed despite the corpus living in `.cache/` only: a baseline only in `.cache` can't fail CI. Per-file snapshots keep diffs reviewable and tie each snapshot to a pinned commit (corpus pins move only in their own PR, ADR 0011). On a pin bump, run `pnpm test:corpus config-ast -u` and delete the stale files the 4.4 test names. Biome ignores `.ast` files.

## 6. Tasks (in order; one builder run each)

The builder works on branch `feat/F-103` in its own worktree from `main` (5d205d6 or later). `pnpm install` first. If F-102 has merged shared pieces by then (open points 1 and 2), the task takes those and only adds what 2.4 lists as missing.

**T1: shared base.** Files:
- `lang-core/src/ast/base.ts` and the `index.ts` exports.
- `lang-2610/src/ast/{source-text,comments (collect only),escapes,strings,errors}.ts`.
- The `parse.ts` additions (`tokens`, `ParseError` from lang-core). No existing test needs changing (section 3).

Write the 4.1 tests first and see them fail. Port with attribution headers.

Commit: `feat(lang-2610): shared AST base: positions, comments, escapes and string decoding (F-103)`.

Done when:
```
pnpm --filter @nf-builder/lang-core test
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast test/parse.test.ts test/ported
pnpm check
```

**T2: expression layer for config values.** Files:
- `lang-core/src/ast/expression.ts`.
- `lang-2610/src/ast/{expression-builder,config-grammar,visit}.ts`.
- `test/ast/expression-builder.test.ts`.
- `test/support/{strip,range-invariants}.ts`: the per-node checks 1 to 4; 5 and 6 come in T3 and T4.

If F-102 has landed a script-only builder, refactor it to take a `GrammarBinding` without changing its outputs: F-102's snapshots must stay byte-identical. Then add `configGrammar`. If it landed a binding, add only `configGrammar` and the tests. If nothing landed, build it per 2.4 (open point 1). If the run gets too big, split it: T2a covers literals, strings, collections, paths and calls; T2b covers operators, closures, statements and errors.

Commit: `feat(lang-2610): expression and statement AST for config values (F-103)`.

Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast/expression-builder.test.ts
pnpm check
```

**T3: config AST, comments and construct fixtures.** Files:
- `lang-core/src/ast/config.ts`.
- `lang-2610/src/ast/{config-builder,parse-config}.ts`, `comments.ts` (`attachConfigComments`), the `visit.ts` config keys.
- `test/support/ast-snapshot.ts`, with the full and statement levels.
- `test/config-ast/{config-ast,comments,errors,ported-config}.test.ts` and `test/config-ast/snapshots/`.
- `tools/oracle/cases/{config-constructs,config-ast-errors}/` and the two `cases.yaml` entries.

Write the fixtures first and run the oracle on them before writing the builder, so the fixtures are known to be valid Nextflow. Then write the tests and see them fail, then implement. Review the generated full snapshots by eye against the fixture text before committing them; first-run snapshots are written, not checked.

Commit: `feat(lang-2610): config AST with ranges, comments and nf-lang's config errors (F-103)`.

Done when:
```
pnpm oracle --case config-constructs --case config-ast-errors   # both matched (Java 21; pinned dist via pnpm nextflow)
pnpm --filter @nf-builder/lang-2610 exec vitest run test/config-ast
pnpm --filter @nf-builder/oracle test
pnpm check
```

**T4: corpus snapshots and range property test (steps 1 and 2).** Files:
- `test/corpus/config-ast.corpus.ts`, `test/corpus/config-snapshots.test.ts`.
- `test/support/range-invariants.ts` (checks 5 and 6).
- The 228 snapshot files.
- `.gitattributes`.

Write `config-snapshots.test.ts` first, including the broken-range cases, and see it fail. Then the corpus test. Generate the snapshots with `-u`, spot-check 5 of them against their sources (`rnaseq/nextflow.config`, `sarek/conf/modules/markduplicates.config`, `fetchngs/conf/base.config`, `rnaseq-nf/nextflow.config`, a module `tests/nextflow.config`), then run again without `-u`. Negative check: shift one node's end by one in a scratch edit, see step 2 fail with that node named, and revert.

Commit: `test(lang-2610): config AST snapshots and range checks over the corpus (F-103)`.

Done when:
```
pnpm corpus:fetch
pnpm test:corpus config-ast -u && pnpm test:corpus config-ast      # second run: 0 failures, no files written
CI=true pnpm test:corpus config-ast                                  # passes; would fail on a missing snapshot
find packages/lang-2610/test/corpus/snapshots/config -name '*.ast' | wc -l   # 228
du -sh packages/lang-2610/test/corpus/snapshots                      # about 250 KB
pnpm check
```
With `.cache/corpus-lint` present (`pnpm corpus:lint`, Java 21), also run plain `pnpm test:corpus`, which includes F-006's parse test. CI's `corpus-parse` job is the authority.

**T5: records (orchestrator, not the builder).**
- The ADR (open point 3) and the `docs/adr/README.md` row.
- The `docs/spec/architecture.md` AR-02 wording (open point 3).
- `docs/licences.md` and the `AGENTS.md` row (section 3).
- `docs/plan/features.json`: F-103 `passes: true` and `notes`; `notes` on F-104 and F-601 (section 8).
- `docs/plan/progress.md`, and the PR from the template.

Done when `pnpm check` (including `check:adr` and `check:features`) passes and the Scope guard passes without the `scope-change` label.

## 7. Open points (each with a recommendation; none decided here)

1. **Who builds the shared expression and statement layer, and how both grammars use it.** Config values need the same 53 alternatives as script expressions. F-102's scratch fixtures (`expr-*.nf`) suggest F-102 plans its own expression builder.
   - **Recommendation:** one shared layer: types in `lang-core/src/ast/expression.ts`, and one builder parametrised by a `GrammarBinding` of context classes. Operators are read from token text, since token type numbers differ between vocabularies.
   - If F-102's plan owns it, F-103's T2 shrinks to `configGrammar` plus tests, and F-103 builds after F-102's expression task merges.
   - If F-103 starts first, T2 builds it and F-102 adds `scriptGrammar`.
   - Avoid two builders: about 600 near-identical lines that would drift.
   - Package boundaries are unchanged either way.
2. **Shared base conventions (2.2).** Position as offset (UTF-16) plus line and column (code points); half-open ranges; comments on nodes plus a root list; `NodeBase`, `AstError`, `ParseResult`.
   - **Recommendation:** adopt 2.2 unless F-102's plan already fixes them. Reuse F-102's if so, and check them against 2.4.
   - Alternative: offsets only, with a line index for line and column. Smaller, but then every consumer needs the index, and `nextflow lint` parity needs the column in code points.
3. **Comment attachment and AR-02.** AR-02 says "Comments are attached to the following node". nf-lang 26.10.7's `CommentAttacher`, which `nextflow lint -format` prints from, attaches end-of-line comments to the preceding node and leftovers to the container (1.2). F-110's printer must reproduce lint's comment placement (ADR 0005).
   - **Recommendation (decide and record):** port `CommentAttacher` and amend AR-02 to: "Comments are attached as nf-lang's formatter attaches them: an end-of-line comment trails the node before it; any other comment leads the node after it in its block, list, map or argument list, or belongs to that container if no node follows."
   - Record it in one ADR, "AST conventions: positions, comments, shared expression layer", marked `Accepted (agent)`, shared with F-102, at the next free number when it lands (0022 to 0024 and 0026 are taken; 0025 may be taken by F-109). Whichever of F-102 and F-103 lands first writes it.
   - Equivalence (glossary) is unaffected: same comments, same order.
4. **Invalid statements kept as `ConfigInvalid`.** nf-lang drops them after reporting.
   - **Recommendation:** keep them (ADR 0004: code is never lost; F-104 needs their ranges). This follows an accepted ADR, so no new ADR; mention it in the PR.
5. **Number-format errors** (p10, q01). Reproducing them needs Groovy's `Numbers.parseInteger` rules: radix prefixes, underscores, and suffixes `i`/`l`/`g` with int and long ranges.
   - **Recommendation:** include integer literals in F-103 (messages verified in 1.4). Leave decimal literals to F-112 unless a lint probe shows a message.
   - Alternative: defer both to F-112, and note it in F-112's notes.
6. **Which corpus configs are snapshotted.** Step 1 names `nextflow.config` and `conf/*.config` (184 files); lint checks 228.
   - **Recommendation:** all 228 (same harness, `listSources`), asserting the 184 are included. Read `conf/*.config` as any file under a `conf/` directory, including `conf/modules/` (76 files).
7. **Snapshot format and location (5).** Statement-level, committed per file, about 250 KB; full snapshots only for construct fixtures.
   - It is an internal test artefact, not a persisted or exported project format, so no ADR is needed. Record it under Decisions in `progress.md`, and add the `docs/licences.md` row for corpus-derived names.
   - Alternative: one file per pipeline (5 files, the largest about 100 KB). Fewer files, worse diffs.
8. **Where construct and error fixtures live.** AGENTS.md: "Nextflow code in templates and fixtures must pass the oracle".
   - **Recommendation:** make them oracle cases (`tools/oracle/cases/config-constructs` with `expect: ok`, `config-ast-errors` with `expect: error` and messages), read by path from the lang-2610 tests, as `parse.corpus.ts` already reads `tools/corpus/fixtures/`. No new AGENTS.md exception and no workflow edit.
   - Positions in `config-ast-errors` are checked by the unit test against the recorded 2026-11-22 lint run; the oracle checks messages only.
   - Alternative: inline inputs with recorded results, like F-101's `test/ported/` exception.
9. **API exposure.** `apps/web` imports `@nf-builder/engine`, which imports the `pack` object. Adding `parseConfig` to `pack` would pull antlr4ng and the generated parser into the initial web bundle and risk QA-01 (`pnpm check:budget`).
   - **Recommendation:** keep `parseConfigFile` internal to the pack in F-103 (tests import `src/ast/parse-config.ts`, as F-101 did with `parse.ts`). Leave `LanguagePack` unchanged. F-104 or F-105 wires `parseConfig` into the engine worker behind a lazy import.
   - Exporting the types from lang-core is fine: types only.
10. **`ParseOutcome.tokens` and moving `ParseError` to lang-core.** Additive changes to F-101's in-memory types, needed by both AST builders.
    - **Recommendation:** do both in whichever of F-102 and F-103 lands T1 first.
    - Alternative for tokens: collect terminals by walking the tree. Every token is a terminal, since there is no hidden channel. Slower, and leaves `parse.ts` untouched.
11. **New ported sources.** nf-lang `Comments`, `CommentAttacher`, `EscapeUtils`, and the relevant parts of `ConfigAstBuilder`, plus Groovy 4.0.33 `StringUtils` (Apache-2.0).
    - **Recommendation:** attribution headers and `docs/licences.md` rows (section 3). No new dependency.
12. **Scope: values as full nodes.** F-103's description lists scopes, assignments, selectors, profiles and includes, but not values.
    - **Recommendation:** full expression nodes. AR-02 asks for a typed tree, the glossary's equivalence ignores whitespace inside values, and F-601's forms need literal values.
    - Alternative: opaque values (range plus text). Smaller, but pushes the work to F-104 and F-601 and makes equivalence whitespace-sensitive.
13. **`SourceFile` (AR-01).** F-103 delivers parse status, AST and comment map for configs. The `SourceFile` record (path, text, language) belongs to the engine.
    - **Recommendation:** leave it to F-104 or F-105; say so in the notes.
14. **Column edge cases.**
    - Escape-error and F-101 parse-error end columns follow nf-lang's UTF-16 arithmetic. AST positions are pure code points. They differ only after an astral character on the same line.
    - **Recommendation:** accept it and note it for F-112's lint parity. No corpus file is affected.
15. **Semantic config checks are out of scope:** selectors outside `process`/`agent`, includes outside the top level or a profile, include sources that don't resolve. They come from the resolver or runtime, not the AST builder (p12, p13).
    - **Recommendation:** note them on F-112 (and F-105 for includes) when F-103 lands.
16. **Number of comments inside values.** 125 of 770 corpus comments sit inside expressions; they rely on the expression-level containers of `CommentAttacher`. Covered by T3's attacher port; nothing to decide, listed so T2 and T3 don't drop it.

## 8. Records to write when F-103 lands (drafts for the orchestrator)

**`features.json` notes to append** (no scope change):
- F-103: "Verified <date>:
  - step 1 by test/corpus/config-ast.corpus.ts in pnpm test:corpus (CI corpus-parse): statement-level snapshots of all 228 lint-checked corpus configs, which include every nextflow.config and conf/ config (184), committed under packages/lang-2610/test/corpus/snapshots/config/;
  - step 2 by the same file's range checks (exact slices, nesting, token accounting, re-parse of every statement and value) and the unit tests on the construct fixtures (oracle cases config-constructs and config-ast-errors).

  nf-lang's ConfigAstBuilder errors, including the 7 ported inputs, match nextflow lint 26.10.7. No Playwright test (Q13). The parse API stays internal to the pack until the engine wires it (QA-01)."
- F-104: "From F-103: parseConfigFile (packages/lang-2610/src/ast/parse-config.ts) gives top-level ConfigAssign/ConfigBlock/ConfigInclude/ConfigApplyBlock statements with ranges (fixtures.yaml names: assign <path>, block <name>), ConfigInvalid and ConfigIncomplete kept, and every comment attached once with the root list in order."
- F-601: "From F-103: the config AST is syntactic. Profiles, params and env are ConfigBlocks; selectors are ConfigSelector with any kind as written; plugins is ConfigApplyBlock; mapping to catalogue/config.json is F-601's (plan section 1.6)."
- F-112 (if open points 5 and 15 are taken as recommended): "From F-103: AST errors are AstError { message, range }; selector placement, include placement and include resolution are resolver checks (lint 26.10.7 probes p12, p13); decimal number-format errors not ported."

**`progress.md` Decisions:**
- Shared AST conventions and comment attachment ported from nf-lang `CommentAttacher`; AR-02 amended (ADR NNNN).
- Config AST types in lang-core; builders in lang-2610; the parse API not on `pack` yet (QA-01).
- Snapshot format and location.
- Construct and error fixtures as oracle cases.
- Licences rows.
- Invalid statements kept (ADR 0004).

## 9. Evidence and how to repeat it

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/5a04e27b-26df-5c7b-af9e-9c0f6a532353/scratchpad/`. It may be cleared.
- **Upstream sources** (raw.githubusercontent.com, commit `0ad848ef3c3a22824cd9eb2ca14568385867702d`): `f103-up/`. Groovy's `StringUtils.java` came from tag `GROOVY_4_0_33`.
- **Docs at v26.10.7:** `f103-docs/` (`docs/config.mdx`, `docs/reference/config.mdx`, `docs/reference/syntax.mdx`).
- **Lint probes:** `f103-probe/cases/`, `cases2/`, `lint.json`, `lint2.json`. Nextflow 26.10.7 `-dist` run with `NXF_HOME=<scratch>/home NXF_OFFLINE=true NXF_SYNTAX_PARSER=v2 lint -o json <dir>`. The dist is now cached in the main checkout at `.cache/nextflow/nextflow-26.10.7-dist`.
- **Corpus survey and snapshot size:** `f103-proto/survey.ts` and `f103-proto/size.ts`. They ran against the F-101 worktree (since removed) with its `.cache/corpus`. To repeat: point the imports at `main`, run `pnpm install` and `pnpm corpus:fetch`, then `node <script>`.
