# Plan: F-102, script AST with source ranges and attached comments

Planner output, 2026-11-22. Read-only: no repo or worktree was changed. Based on `main` at `902f1f7`: F-101 (#18), F-109 and F-007 merged while this was planned; the F-101 parts this plan uses (`DescriptiveErrorStrategy`, `ParseError` with `endLine`/`endColumn`, `test/ported/cases.json` with 31 owner-F-102 cases) were re-checked on `main`. F-101 did **not** add an oracle re-run for its ported inputs; AGENTS.md exempts them instead (open point 13).

Drafts the builder copies (never retypes) are in `docs/plan/handoff/F-102-draft/` (section 10 says how they were made).

## 0. Scope in one paragraph

F-102 turns the F-006/F-101 parse tree into our own typed AST (AR-02): one node kind per construct in the 26.10 syntax reference, typed and legacy (LA-10). Every node has a range (UTF-16 offsets plus 1-based line and code-point column), and every comment is attached to a node. The node types live in `lang-core`; the builder lives in `lang-2610` and is a port of nf-lang's `ScriptAstBuilder.java` (v26.10.7), with comments attached by a port of nf-lang's `CommentAttacher`. The builder also reports the errors nf-lang's AST builder raises, because `nextflow lint` rejects those files and F-104's malformed fixtures depend on them; warnings stay with F-112. Step 1 is one Vitest file snapshot per construct fixture (54 lint-clean fixtures). Step 2 is a property checker run on every fixture in `pnpm check` and on the whole corpus in `pnpm test:corpus`: each node's range is token-aligned, nested, and its slice re-parses on its own into the same node.

## 1. Findings

### 1.1 Upstream (nextflow-io/nextflow v26.10.7, commit 0ad848ef)

- `modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java` (2,296 lines) is the mapping from parse tree to AST. Its sections: declarations L233-L1110, statements L1112-L1358, expressions L1360-L2024, parameters and types L2026-L2146. It uses `instanceof` on context classes; our generated parser has no visitor class either (`src/generated/` holds lexer and parser only), so the port does the same. Context labels are fields with a leading underscore (`ProcessDefContext._name`, `WorkflowBodyContext._main`).
- Node classes (`script/ast/*.java`): `ProcessNodeV1` (legacy: directives, inputs and outputs as statement blocks) and `ProcessNodeV2` (typed: `Parameter[]` inputs, stagers, outputs, topics) are chosen by whether `nextflow.enable.types = true` appeared **before** the process (`ScriptNode.isTypingEnabled`, `ScriptAstBuilder.java#L321-L325`). Workflows are one class; typing only changes which takes and emits are errors.
- Ranges upstream: `PositionConfigureUtils.ast(node, ctx)` spans `ctx.start` to `ctx.stop`. Contexts that end in `sep?` or `nls` (for example `blockStatements`) stop on an `NL` token, so upstream block ranges run into the next line. Ours trim leading and trailing `NL` tokens (section 4.2).
- Comments: `formatter/Comments.java` collects them from the token stream (comments are `NL` tokens on the default channel, `ScriptLexer.g4:855-867`; a token is a comment when its text starts with `//`, `/*` or `#!`). `formatter/CommentAttacher.java` (600 lines) attaches each one as **leading** (before a child, or hoisted from inside it), **trailing** (end of line after a child) or **dangling** (in a container with no child after it). Containers: the module, each declaration, statement blocks with boundaries between if/else and try/catch branches (using the `else` keyword position), closures, lists, maps, parenthesised call arguments, and the links of a method chain with two or more links. `nextflow lint -format` prints from these attachments, so F-110 needs ours to match.
- `EscapeUtils.java` reports invalid escapes at the exact character (UTF-16 columns, like Java). Groovy's `Numbers.parseInteger` and `parseDecimal` raise number-range errors, which upstream throws at the end of `compilationUnit` (`#L289-L290`).
- AST-builder error sites: 50 `collectSyntaxError` call sites, 5 parse-failing `throw`s (`#L1327`, `#L1336`, `#L1881`, `#L2022`, number range `#L289`), 9 internal "Invalid/Unrecognized ..." throws that the grammar makes unreachable, 8 `collectWarning`s (`#L597`, `#L619`, `#L634`, `#L695`, `#L824`, `#L836`, `#L977`, `#L1059`).
- Reparse (`#L251-L260`, `#L304-L320`): a top-level statement whose expression is a call named `agent`, `process`, `workflow` or `output` is parsed again from its first token as `scriptDeclaration` (LL, `DescriptiveErrorStrategy`). The first syntax error is reported. If there is none, "Invalid <name> definition -- check for missing or out-of-order section labels" is reported. The statement becomes an `InvalidDeclaration`.

### 1.2 The syntax reference and lint-validated fixtures

`docs/reference/syntax.mdx` at the pinned commit (1,022 lines) has 43 construct sections. They are listed in section 6.1, and the coverage test hardcodes them with the commit. Every fixture was checked with `nextflow lint -o json` 26.10.7 (`NXF_SYNTAX_PARSER=v2`, `NXF_OFFLINE=true`, run under `unshare -rn` so it had no network).
- **54 fixtures, 0 errors** in one run of the whole directory (40 warnings, which are allowed). Each fixture is either a reference snippet made into a complete script, or a lint-validated script for a construct the reference names without an example (legacy qualifiers, `record()`/`tuple()` inputs, Groovy-style catch, labelled closure statements, registry include, legacy `|`/`.out`/`set`/`tap`). `fixtures.json` cites `syntax.mdx#Lx-Ly` for each one and says what was adjusted.
- Three reference snippets fail lint as written:
  - `catch( e: FileNotFoundException | AccessDeniedException )`: "`AccessDeniedException` is not defined". The fixture uses `java.nio.file.AccessDeniedException`.
  - The typed process example has no `nextflow.enable.types = true`, so lint rejects its typed inputs. The fixture adds the flag.
  - `include { params as ...; workflow as ... }` needs the types flag in the including script. The fixture adds it.
- **Registry include:** `nextflow lint` downloads the module from `registry.nextflow.io` into `modules/nf-core/fastqc/` (it did so once here, despite `NXF_OFFLINE`). It fails offline on a hand-written stub ("Module nf-core/fastqc is corrupted (missing required files)"). It passes offline when the downloaded directory, including `.module-info`, is present. The draft fixtures include that directory (open point 6).
- The F-101 parser parses all 54. Two use LL fallback: `process-exec.nf` and `process-legacy-io.nf`.

### 1.3 Builder errors, checked with lint

- 31 cases in F-101's `test/ported/cases.json` have owner F-102: 4 reparse and 27 ast-builder.
- 46 new inputs cover every other reachable error site (`F-102-draft/errors/`, `errors.json`): every `collectSyntaxError` call site and parse-failing throw except `#L853` ("Missing `prompt:` section", which the grammar makes unreachable) and `#L446` (inline, see below). Linted in one run, they reproduce the per-file results exactly.
- Upstream quirks found:
  - A legacy `params.x = ...` with types enabled **crashes lint** (NPE "Cannot read field "value" because "node" is null"). `paramDeclarationV1` returns null and `addParamV1(null)` fails later. Test this inline, not as a file the oracle lints (open point 5).
  - "Typed output is not allowed in legacy workflow" (`#L1022`) and "Named workflow cannot have an onError section" (`#L942`, which passes the onComplete block) are printed at **-1:-1**. The drafts expect the real node position (open point 5).
  - Resolver errors ("`x` is not defined") appear next to builder errors in 3 new inputs and 2 F-101 cases (L499, L545). The builder's expected list is the lint list without them.

### 1.4 Positions

- antlr4ng's `CharStream.fromString` stores code points: `token.start`, `token.stop` and `token.column` count code points, and `token.text` is a JS string. Lines advance on `\n` only, and CRLF is one `NL` token. Checked with `𝐀` and CRLF against the generated lexer. So `text.slice()` needs a code-point to UTF-16 map, which is the identity when the text has no surrogates.
- `parseScript` returns only the tree. The builder needs the token stream for trimming, comments and reparse, so the `ok` outcome gains `tokens` (task 1).

### 1.5 An oracle for comment attachment

The pinned dist `.cache/nextflow/nextflow-26.10.7-dist` is a zip with nf-lang 26.10.7's classes, including `CommentAttacher`. A single-file Java program (`F-102-draft/DumpComments.java`, run with `java -cp <dist> DumpComments.java <files>`) prints each comment's slot, anchor node class and anchor range.
- Over the whole corpus it took 18 s and found 3,923 comments in 342 scripts. About 95% anchor on declarations, statements and workflow takes.
- For the 54 fixtures: 45 comments (`F-102-draft/fixtures-comments.upstream.txt`).

## 2. Requirements and what F-102 must deliver

- **AR-02**: "our own typed tree built from the ANTLR parse tree. Every node has a source range. Comments are attached to the following node." Delivered by the lang-core types, the builder and `attachComments`. Upstream also attaches end-of-line comments as trailing and end-of-block comments as dangling, so AR-02's last sentence needs a wording update (open point 3).
- **AR-01**: F-102 supplies the AST, the comment map (`ScriptAst.comments`, every comment in source order) and the parse status (`ScriptParseResult`) that a `SourceFile` will hold. The `SourceFile` type itself is engine model, F-104/F-105 (open point 9).
- **LA-10**: typed and legacy processes and workflows both build; a coverage test asserts both appear.
- **Step 1**: one file snapshot per fixture; a coverage test proves all 43 sections and every node kind are covered.
- **Step 2**: `checkRanges` (section 6.2) on every fixture and ported case in `pnpm check`, and on the corpus in `pnpm test:corpus`.
- **ADR-0005** ("what parses here parses in Nextflow, and vice versa"): builder errors make the three AST-level fixture differences in `known-differences.json` agree at AST level (those rows stay, since the grammar still accepts the files). No ADR change.

## 3. Files

Paths are relative to the repo root.

### 3.1 Create in `packages/lang-core/src/ast/` (types plus one walker; no imports)

**`range.ts`**
```ts
/** Half-open source range. `text.slice(start, end)` is the node's exact source text. */
export interface Range {
  readonly start: number;      // UTF-16 offset of the first character
  readonly end: number;        // UTF-16 offset just past the last character
  readonly line: number;       // 1-based; lines end at "\n" only (as ANTLR counts them)
  readonly column: number;     // 1-based, in code points (nf-lang and `nextflow lint` columns)
  readonly endLine: number;
  readonly endColumn: number;  // 1-based column just past the last character, in code points
}
export type CommentKind = "line" | "block" | "doc" | "shebang";   // doc: starts with "/**" (nf-lang GroovydocManager)
export interface Comment {
  readonly kind: CommentKind;
  readonly text: string;       // exact source text with delimiters; equals the slice of `range`
  readonly range: Range;
  readonly ownLine: boolean;   // first token on its line (nf-lang Comment.ownLine)
}
export interface CommentSlots {
  readonly leadingComments?: readonly Comment[];
  readonly trailingComments?: readonly Comment[];
  readonly danglingComments?: readonly Comment[];
}
export interface NodeBase<K extends string> extends CommentSlots {
  readonly kind: K;
  readonly range: Range;
}
```

**`script.ts`**: the node union. Kind strings are PascalCase. Field order is source order wherever the grammar fixes it.
```ts
export interface Identifier extends NodeBase<"Identifier"> { readonly name: string }
export interface ScriptAst extends NodeBase<"Script"> {          // range: the whole text, [0, text.length)
  readonly shebang: Comment | null;
  readonly body: readonly ScriptItem[];                           // declarations and top-level statements, source order
  readonly comments: readonly Comment[];                          // AR-01 comment map: every comment but the shebang, source order
  readonly typesEnabled: boolean;                                 // `nextflow.enable.types = true` appears
}
export type ScriptItem = Declaration | Statement | InvalidDeclaration;
export type Declaration = FeatureFlag | Include | ImportDeclaration | ParamsBlock | LegacyParam | RecordDef | EnumDef
  | ProcessDef | AgentDef | WorkflowDef | OutputBlock | FunctionDef | IncompleteDeclaration;

export interface FeatureFlag extends NodeBase<"FeatureFlag"> { readonly name: Identifier; readonly value: Expression }  // name "nextflow.enable.types"
export interface Include extends NodeBase<"Include"> { readonly entries: readonly IncludeEntry[]; readonly source: StringLiteral }
export interface IncludeEntry extends NodeBase<"IncludeEntry"> { readonly name: Identifier; readonly alias: Identifier | null }
export interface ImportDeclaration extends NodeBase<"Import"> { readonly name: string }   // always an error (#L339)
export interface ParamsBlock extends NodeBase<"ParamsBlock"> { readonly params: readonly Param[] }
export interface Param extends NodeBase<"Param"> { readonly name: Identifier; readonly type: TypeRef | null; readonly defaultValue: Expression | null }
export interface LegacyParam extends NodeBase<"LegacyParam"> { readonly target: PropertyExpr; readonly value: Expression }  // params.a.b = value
export interface RecordDef extends NodeBase<"Record"> { readonly name: Identifier; readonly fields: readonly TypedName[] }
export interface EnumDef extends NodeBase<"Enum"> { readonly name: Identifier; readonly constants: readonly Identifier[]; readonly trailingComma: boolean }

export type SectionLabel = "input" | "stage" | "output" | "topic" | "when" | "script" | "shell" | "exec" | "stub"
  | "prompt" | "take" | "main" | "emit" | "publish" | "onComplete" | "onError";
export interface Section<T> extends NodeBase<"Section"> {
  readonly label: SectionLabel | null;     // null: directives, implicit workflow main, implicit process script body
  readonly labelRange: Range | null;       // `input:`, label to colon
  readonly items: readonly T[];
}
interface ProcessCommon {
  readonly name: Identifier;
  readonly directives: Section<ExpressionStatement> | null;
  readonly when: Section<Expression> | null;
  readonly exec: Section<Statement> | null;        // null only for an empty body (#L518)
  readonly stub: Section<Statement> | null;
}
export interface LegacyProcess extends NodeBase<"Process">, ProcessCommon {
  readonly typed: false;
  readonly inputs: Section<ExpressionStatement> | null;    // calls: val(x), tuple(val(a), path(b)), path x, stageAs: 'y'
  readonly outputs: Section<ExpressionStatement> | null;
}
export interface TypedProcess extends NodeBase<"Process">, ProcessCommon {
  readonly typed: true;
  readonly inputs: Section<ProcessInput> | null;
  readonly stage: Section<ExpressionStatement> | null;
  readonly outputs: Section<NamedOutput | ExpressionStatement> | null;
  readonly topics: Section<ExpressionStatement> | null;    // each a `>>` BinaryExpr
}
export type ProcessDef = LegacyProcess | TypedProcess;
export type ProcessInput = TypedName | RecordInput | TupleInput;
export interface RecordInput extends NodeBase<"RecordInput"> { readonly fields: readonly TypedName[]; readonly trailingComma: boolean }
export interface TupleInput extends NodeBase<"TupleInput"> { readonly components: readonly TypedName[]; readonly trailingComma: boolean }
export interface NamedOutput extends NodeBase<"NamedOutput"> { readonly name: Identifier; readonly type: TypeRef | null; readonly value: Expression | null }
export interface AgentDef extends NodeBase<"Agent"> {
  readonly name: Identifier;
  readonly directives: Section<ExpressionStatement> | null;
  readonly inputs: Section<ProcessInput> | null;
  readonly outputs: Section<NamedOutput | ExpressionStatement> | null;
  readonly prompt: Section<Statement> | null;               // null only for an empty body (#L851)
}
export interface WorkflowDef extends NodeBase<"Workflow"> {
  readonly name: Identifier | null;                         // null: entry workflow
  readonly typed: boolean;                                  // types enabled when it was built
  readonly takes: Section<TypedName> | null;
  readonly main: Section<Statement> | null;
  readonly emits: Section<NamedOutput | ExpressionStatement> | null;
  readonly publishers: Section<NamedOutput> | null;
  readonly onComplete: Section<Statement> | null;
  readonly onError: Section<Statement> | null;
}
export interface OutputBlock extends NodeBase<"OutputBlock"> { readonly outputs: readonly OutputDecl[] }
export interface OutputDecl extends NodeBase<"Output"> { readonly name: Identifier; readonly type: TypeRef | null; readonly body: Block }
export interface FunctionDef extends NodeBase<"Function"> {
  readonly name: Identifier; readonly def: boolean; readonly params: readonly Parameter[];
  readonly returnType: TypeRef | null;              // `-> T`
  readonly legacyReturnType: LegacyType | null;     // `String f()`, `def String f()`
  readonly body: Block;
}
export interface IncompleteDeclaration extends NodeBase<"IncompleteDeclaration"> { readonly text: string }   // `foo.bar.` (error)
export interface InvalidDeclaration extends NodeBase<"InvalidDeclaration"> {             // reparse (#L251-L260)
  readonly keyword: "agent" | "process" | "workflow" | "output"; readonly statement: Statement;
}

// statements; `labels` holds `name:` labels inside a closure with labels, and the range starts at the first label
interface StatementBase<K extends string> extends NodeBase<K> { readonly labels?: readonly Identifier[] }
export type Statement = Block | ExpressionStatement | VariableDeclaration | Assignment | IfStatement | TryCatch
  | ReturnStatement | ThrowStatement | AssertStatement | EmptyStatement;
export interface Block extends StatementBase<"Block"> { readonly statements: readonly Statement[] }   // range includes the braces
export interface ExpressionStatement extends StatementBase<"ExpressionStatement"> { readonly expression: Expression }
export interface VariableDeclaration extends StatementBase<"VariableDeclaration"> {
  readonly def: boolean; readonly legacyType: LegacyType | null;
  readonly targets: readonly TypedName[]; readonly multiple: boolean;    // `def (a, b) = ...`
  readonly initializer: Expression | null;
}
export type AssignmentOperator = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "&=" | "|=" | "^=" | "<<=" | ">>=" | ">>>=" | "?=";
export interface Assignment extends StatementBase<"Assignment"> {
  readonly target: Expression | TupleTarget; readonly operator: AssignmentOperator; readonly value: Expression;
}
export interface TupleTarget extends NodeBase<"TupleTarget"> { readonly names: readonly Variable[] }   // `(a, b) = ...`, `(a) = ...`
export interface IfStatement extends StatementBase<"If"> {
  readonly condition: Expression; readonly then: Statement; readonly else: Statement | null; readonly elseRange: Range | null;
}
export interface TryCatch extends StatementBase<"TryCatch"> { readonly body: Statement; readonly catches: readonly CatchClause[] }
export interface CatchClause extends NodeBase<"Catch"> {
  readonly variable: Identifier; readonly types: readonly TypeRef[]; readonly legacy: boolean; readonly body: Statement;  // legacy: `catch (T e)`
}
export interface ReturnStatement extends StatementBase<"Return"> { readonly value: Expression | null }
export interface ThrowStatement extends StatementBase<"Throw"> { readonly value: Expression }
export interface AssertStatement extends StatementBase<"Assert"> { readonly condition: Expression; readonly message: Expression | null }
export interface EmptyStatement extends StatementBase<"EmptyStatement"> {}

// expressions
export type Expression = Variable | NumberLiteral | StringLiteral | BooleanLiteral | NullLiteral | GString | ListExpr | MapExpr
  | Closure | PropertyExpr | IndexExpr | MethodCall | CallExpr | NewExpr | UnaryExpr | BinaryExpr | CastExpr | TypeTestExpr
  | TernaryExpr | ElvisExpr | Parenthesized | IncompleteExpression;
export type Navigation = "." | "*." | "?.";
export interface Variable extends NodeBase<"Variable"> { readonly name: string }          // also a built-in type used as a value
export interface NumberLiteral extends NodeBase<"Number"> { readonly text: string; readonly integer: boolean }   // verbatim, suffix kept
export interface StringLiteral extends NodeBase<"String"> {
  readonly text: string; readonly value: string; readonly quote: "'" | '"' | "'''" | '"""' | "/";  // text verbatim; value unescaped
}
export interface BooleanLiteral extends NodeBase<"Boolean"> { readonly value: boolean }
export interface NullLiteral extends NodeBase<"Null"> {}
export interface GString extends NodeBase<"GString"> { readonly quote: '"' | '"""'; readonly parts: readonly (GStringText | Interpolation)[] }
export interface GStringText extends NodeBase<"GStringText"> { readonly text: string; readonly value: string }
export interface Interpolation extends NodeBase<"Interpolation"> { readonly braced: boolean; readonly expression: Expression }  // range includes `$` / `${ }`
export interface ListExpr extends NodeBase<"List"> { readonly elements: readonly Expression[]; readonly trailingComma: boolean }
export interface MapExpr extends NodeBase<"Map"> { readonly entries: readonly MapEntry[]; readonly trailingComma: boolean }
export interface MapEntry extends NodeBase<"MapEntry"> { readonly key: Identifier | Expression; readonly value: Expression }  // Identifier: bare name or keyword
export interface Closure extends NodeBase<"Closure"> { readonly params: readonly Parameter[] | null; readonly body: readonly Statement[] }  // null: no `->`
export interface PropertyExpr extends NodeBase<"Property"> { readonly object: Expression; readonly navigation: Navigation; readonly property: Identifier | StringLiteral }
export interface IndexExpr extends NodeBase<"Index"> { readonly object: Expression; readonly indices: readonly Expression[] }
export type Argument = Expression | NamedArgument;
export interface NamedArgument extends NodeBase<"NamedArgument"> { readonly name: Identifier | StringLiteral; readonly value: Expression }
interface CallArguments {
  readonly args: readonly Argument[];        // source order (upstream moves named arguments first; we don't)
  readonly parens: boolean;                  // false: command call `foo a, b`, or closure only `foo { }`
  readonly trailingComma: boolean;
  readonly closures: readonly Closure[];     // written after the parentheses, or alone
}
export interface MethodCall extends NodeBase<"MethodCall">, CallArguments {
  readonly receiver: Expression | null; readonly navigation: Navigation | null;   // null: implicit this
  readonly method: Identifier | StringLiteral;
}
export interface CallExpr extends NodeBase<"Call">, CallArguments { readonly callee: Expression }   // `<expr>(...)`, upstream `.call`
export interface NewExpr extends NodeBase<"New"> { readonly type: TypeRef; readonly args: readonly Argument[]; readonly trailingComma: boolean }
export type UnaryOperator = "!" | "~" | "+" | "-";
export interface UnaryExpr extends NodeBase<"Unary"> { readonly operator: UnaryOperator; readonly operand: Expression }
export type BinaryOperator = "**" | "*" | "/" | "%" | "+" | "-" | "<<" | ">>" | ">>>" | ".." | "..<" | "<" | ">" | "<=" | ">="
  | "in" | "!in" | "==" | "!=" | "<=>" | "=~" | "==~" | "&" | "^" | "|" | "&&" | "||";
export interface BinaryExpr extends NodeBase<"Binary"> { readonly operator: BinaryOperator; readonly left: Expression; readonly right: Expression }
export interface CastExpr extends NodeBase<"Cast"> { readonly operand: Expression; readonly type: TypeRef }
export interface TypeTestExpr extends NodeBase<"TypeTest"> { readonly operator: "instanceof" | "!instanceof"; readonly operand: Expression; readonly type: TypeRef }
export interface TernaryExpr extends NodeBase<"Ternary"> { readonly condition: Expression; readonly then: Expression; readonly else: Expression }
export interface ElvisExpr extends NodeBase<"Elvis"> { readonly condition: Expression; readonly else: Expression }
export interface Parenthesized extends NodeBase<"Parenthesized"> { readonly expression: Expression }
export interface IncompleteExpression extends NodeBase<"IncompleteExpression"> { readonly object: Expression; readonly navigation: Navigation }  // error

// names and types
export interface TypedName extends NodeBase<"TypedName"> { readonly name: Identifier; readonly type: TypeRef | null }
export interface Parameter extends NodeBase<"Parameter"> {
  readonly name: Identifier; readonly def: boolean; readonly type: TypeRef | null; readonly legacyType: LegacyType | null;
  readonly defaultValue: Expression | null;
}
export interface TypeRef extends NodeBase<"TypeRef"> {
  readonly name: string;                                     // as written without spaces: "Path", "java.nio.file.Path", "int"
  readonly typeArguments: readonly (TypeRef | Wildcard)[]; readonly nullable: boolean;
}
export interface Wildcard extends NodeBase<"Wildcard"> {}
export interface LegacyType extends NodeBase<"LegacyType"> { readonly type: TypeRef; readonly dimensions: number }   // String[]

export type ScriptNode = ScriptAst | ScriptItem | Expression | Section<unknown> | /* every interface above */ Identifier;
export const SCRIPT_NODE_KINDS: readonly ScriptNode["kind"][];   // every kind once; a type test proves it's exhaustive
export const BINARY_OPERATORS: readonly BinaryOperator[];
export const ASSIGNMENT_OPERATORS: readonly AssignmentOperator[];
```
Notes for the builder:
- Directive-like statements are normalised as upstream's `checkDirective` (`#L772-L807`): a bare name (`stdout`, `stdin`) becomes a `MethodCall` with no arguments and `parens: false`; `cpus -1` becomes `cpus(Unary(-, 1))`, and the `UnaryExpr` range starts at the `-`. This applies to process directives, legacy inputs and outputs, stage directives and agent directives.
- Like upstream, invalid items are dropped (with an error): a legacy input in a typed process, a typed input in a legacy process, an invalid emit, take or publisher. F-104 keeps any declaration with an error as raw text. `stage:` and `topic:` in a legacy process are reported and dropped.
- Top-level statements stay in `body`. A statements-only script is an implicit entry workflow for F-105 and F-106 (upstream's "code snippet"); no synthetic workflow node is created.

**`parse-result.ts`**
```ts
export interface ParseProblem {               // F-101's ParseError is assignable to this
  readonly source: "lexer" | "parser" | "builder";
  readonly message: string;                  // nf-lang wording, as `nextflow lint` prints it
  readonly line: number; readonly column: number; readonly endLine: number; readonly endColumn: number;  // 1-based, code points, end exclusive
}
export type ScriptParseResult =
  | { readonly ok: true; readonly ast: ScriptAst; readonly errors: readonly ParseProblem[] }  // collected errors, sorted; [] when lint's parse phase passes
  | { readonly ok: false; readonly errors: readonly ParseProblem[] };                        // lexer, parser or fatal builder error, plus errors collected before it
```

**`walk.ts`**
```ts
/** Child nodes in field order. Ranges, comment slots and `ScriptAst.comments`/`shebang` are not nodes. */
export function childNodes(node: ScriptNode): ScriptNode[];
/** Depth-first, parents first; return false from `visit` to skip a subtree. */
export function walk(node: ScriptNode, visit: (node: ScriptNode, parent: ScriptNode | null) => void | false): void;
```

**`index.ts`** re-exports these. **Change `packages/lang-core/src/index.ts`** to `export * from "./ast/index.ts"`. Update `packages/lang-core/README.md` (one line).

### 3.2 Create in `packages/lang-2610/src/ast/` (the builder; not exported from the pack entry)

Each ported file gets an attribution header like `abstract-lexer.ts`'s (Apache-2.0, `../../grammar/NOTICE`, upstream path and tag). The tree is never mutated after `parseScriptAst` returns. Inside the builder, use a `Mutable<T>` cast where `attachComments` fills the slots.

| File | Exports | Ports (ScriptAstBuilder.java unless noted) |
|---|---|---|
| `index.ts` | `parseScriptAst(text: string): ScriptParseResult`: `parseScript`, then build, then attach; errors sorted by line and column | `buildAST` `#L209-L219` |
| `positions.ts` | `class PositionIndex { constructor(text: string); offset(codePoint: number): number; position(codePoint: number): { line: number; column: number }; range(startCodePoint: number, endCodePoint: number): Range }`; `tokenRange(first: Token, last: Token, index: PositionIndex): Range`; `contextRange(ctx: ParserRuleContext, tokens: TokenStream, index: PositionIndex): Range` (trims `NL` tokens at both ends); `spanRanges(first: Range, last: Range): Range` | `PositionConfigureUtils` |
| `comments.ts` | `collectComments(tokens: readonly Token[], index: PositionIndex): { shebang: Comment \| null; comments: Comment[] }` | `formatter/Comments.collect` (text kept exact, not normalised) |
| `attach-comments.ts` | `attachComments(script: ScriptAst, comments: readonly Comment[]): void` | `formatter/CommentAttacher` (containers and slots mapped to our kinds; compare with offsets, not packed line/column) |
| `reparse.ts` | `reparseDeclaration(at: StatementContext, tokens: CommonTokenStream): ParseProblem \| null` | `#L304-L320`, with F-101's `DescriptiveErrorStrategy` |
| `build/context.ts` | `class BuildContext { constructor(text: string, tokens: CommonTokenStream); readonly index: PositionIndex; readonly tokens: CommonTokenStream; typesEnabled: boolean; readonly errors: ParseProblem[]; range(ctx: ParserRuleContext): Range; tokenRange(token: Token): Range; error(message: string, at: Range): void; fatal(message: string, at: Range): never }`; `class FatalBuildError extends Error { readonly problem: ParseProblem }` | `collectSyntaxError`, `createParsingFailedException` |
| `build/script.ts` | `buildScript(tree: CompilationUnitContext, cx: BuildContext): ScriptAst` | `compilationUnit` `#L237-L293`, `scriptDeclaration` `#L320-L404` |
| `build/declarations.ts` | `scriptDeclaration(ctx: ScriptDeclarationContext, cx): Declaration \| null`; `featureFlag`, `include`, `paramsBlock`, `param`, `legacyParam`, `recordDef`, `enumDef`, `outputBlock`, `outputDecl`, `functionDef` (each `(ctx, cx)`) | `#L407-L513`, `#L1065-L1110` |
| `build/process.ts` | `processDef(ctx: ProcessDefContext, cx): ProcessDef`; `agentDef(ctx: AgentDefContext, cx): AgentDef`; `processInput(ctx: ProcessInputContext, cx): ProcessInput \| null`; `namedOutput(ctx: ProcessOutputContext \| WorkflowEmitContext, cx): NamedOutput \| ExpressionStatement \| null`; `directive(stmt: Statement, message: string, cx): ExpressionStatement \| null` | `#L515-L907` |
| `build/workflow.ts` | `workflowDef(ctx: WorkflowDefContext, cx): WorkflowDef` | `#L914-L1063` |
| `build/statements.ts` | `statement(ctx: StatementContext, cx): Statement`; `blockStatements(ctx: BlockStatementsContext \| undefined, cx): Statement[]`; `statementOrBlock(ctx, cx): Statement`; `statementOrLabeled(ctx, cx): Statement` | `#L1114-L1358`, `#L1860-L1877` |
| `build/expressions.ts` | `expression(ctx: ExpressionContext, cx): Expression`; `primary(ctx: PrimaryContext, cx): Expression`; `closure(ctx: ClosureContext \| ClosureWithLabelsContext, cx): Closure`; `namedArgument(ctx: NamedArgContext, cx)`; `mapEntry(ctx: MapEntryContext, cx)` | `#L1362-L1630`, `#L1834-L2024` |
| `build/literals.ts` | `stringLiteral(ctx: StringLiteralContext, cx): StringLiteral`; `gstring(ctx: GstringContext, cx): GString`; `numberLiteral(ctx: IntegerLiteralAltContext \| FloatingPointLiteralAltContext, cx): NumberLiteral`; `checkEscapes(text: string, line: number, column: number, slashy: boolean): { message: string; line: number; column: number }[]`; `unescape(text: string, slashy: boolean): string`; `numberError(text: string, integer: boolean): string \| null` | `#L1642-L1832`; `EscapeUtils.java`; apache/groovy `GROOVY_4_0_33` `StringUtils` (`replaceEscapes`, `removeCR`, `trimQuotations`) and `Numbers` (`parseInteger`, `parseDecimal` range checks only) |
| `build/types.ts` | `identifier(ctx: IdentifierContext, cx): Identifier`; `typeRef(ctx: TypeContext, cx): TypeRef`; `legacyType(ctx: LegacyTypeContext, cx): LegacyType`; `typedName(ctx: NameTypePairContext, cx): TypedName`; `parameter(ctx: FormalParameterContext, cx): Parameter`; `checkVariableName(name: string, at: Range, cx): void` | `#L1278-L1309`, `#L2028-L2146` |

### 3.3 Change

- **`packages/lang-2610/src/parser/parse.ts`** (task 1): the `ok` branch of `ParseOutcome<T>` gains `tokens: CommonTokenStream`. Signatures otherwise unchanged; existing callers read `tree`, `mode` and `error` only.
- **`packages/lang-2610/README.md`**: one line on `src/ast/`.
- **`packages/lang-2610/test/corpus/`**: add `ast.corpus.ts` (task 6); `known-differences.json` unchanged.
- **`tools/oracle/`** (task 6, open point 13): new `src/trees.ts`. It copies a directory tree into `.cache/oracle/trees/<name>/` (keeping relative paths: the fixtures use relative includes and `modules/nf-core/fastqc/`), runs `nextflow lint -o json .` once, and compares each file's errors (line, column, message) with a manifest's recorded `lint` list. It is used for `test/ast/fixtures.json` (every list `[]`) and `test/ast/errors.json`. Exports: `type TreeManifest = { name: string; dir: string; files: { file: string; lint: { line: number; column: number; message: string }[] }[] }`; `loadTreeManifest(file: string, name: string): TreeManifest`; `runTree(manifest: TreeManifest, options: { exec: Exec; cacheDir: string; log?: (line: string) => void }): CheckResult[]`. `cli.ts` runs it alongside the corpus fixtures. New paths in `src/paths.ts`: `AST_FIXTURES_FILE` and `AST_ERRORS_FILE` ("read by path, never imported"). `parseLintJson` in `check.ts` must also return `filename`, `startLine` and `startColumn`; widen it without breaking callers.
- **`tools/corpus/`** (task 6, if open point 7 is accepted): `src/CommentDump.java` (from `F-102-draft/DumpComments.java`, printing JSON). `pnpm corpus:lint` also writes `.cache/corpus-lint/<id>.comments.json` for each pipeline and the fixtures. No new script.
- **Docs, written by the orchestrator** (task 7): `docs/spec/architecture.md` AR-02 wording (open point 3), `AGENTS.md` (oracle wording for `packages/lang-*/test/ast/errors/`, open point 13), `docs/licences.md`, `docs/plan/features.json` (notes only), `docs/plan/progress.md`.

**No change:** the pack entry `src/index.ts`, `LanguagePack`, the engine, the generator and generated files, dependency-cruiser rules, workflows (`corpus-parse` already runs `corpus:lint` and `test:corpus` with Java; `oracle` runs `pnpm oracle`), `package.json` scripts.

### 3.4 Test files (created in the tasks below)

`packages/lang-2610/test/ast/`:
- `fixtures/` (54 `.nf`, from the draft, including `some/`, `pipelines/` and `modules/nf-core/fastqc/` with its `.module-info`)
- `fixtures.json`
- `snapshots/<fixture>.txt`
- `errors/` (46 `.nf`) and `errors.json`
- `fixtures-comments.upstream.txt`
- helpers: `print-ast.ts`, `check-ranges.ts`, `parse-rule.ts`, `shape.ts`
- test files: `snapshot.test.ts`, `ranges.test.ts`, `coverage.test.ts`, `comments.test.ts`, `errors.test.ts`, `ported-builder.test.ts`, `positions.test.ts`, `collect-comments.test.ts`

## 4. How the builder works

### 4.1 One visitor per construct group

`parseScriptAst(text)`:
1. Call `parseScript(text)`. On failure, return `{ ok: false, errors: [error] }`.
2. Create a `BuildContext` over `text` and `outcome.tokens`, then call `buildScript(tree, cx)`. This walks `scriptDeclarationOrStatement` in order. `nextflow.enable.types = true` sets `cx.typesEnabled` for what follows. Each declaration is dispatched by context class to the file for its group (table 3.2).
3. Run the post-pass of `#L251-L293`: reparse top-level calls named agent/process/workflow/output; mixed statements and declarations; params or output block without an entry workflow; the deferred number error.
4. Call `collectComments`, then `attachComments`.
5. A `FatalBuildError` becomes `{ ok: false, errors }`.

Upstream line references are in table 3.2. Port the logic, not the Groovy node shapes.

### 4.2 Ranges (so each slices back exactly)

- `PositionIndex` precomputes, once per file:
  - the code-point to UTF-16 offset map (identity when `!/[\uD800-\uDFFF]/.test(text)`);
  - line starts on `\n` in code points.
- A context's range runs from its first non-`NL` token's `start` to its last non-`NL` token's `stop + 1`, converted to offsets. Line and column come from the code-point index.
- Compose ranges as upstream does, but from tokens:
  - path elements: object start to element end (`#L1502-L1523`);
  - a trailing closure extends its call;
  - `thisMethodCall`: the method `Identifier` is the variable's token.
- Ranges that come from inside a token:
  - GString paths `$a.b`: the `Interpolation` covers `$a.b`, the `Variable` `a` and the property `b` cover their identifiers;
  - the unary minus added by `directive()`;
  - shift operators made of two or three tokens.
- `Block` ranges include braces. `Section` ranges run from the label (or first item) to the last item. `Script` is `[0, text.length)`.
- Builder errors are reported at the node upstream reports at; the start position must equal lint's. For the publish, onComplete and onError section errors, upstream uses the block (first statement), not the label.

### 4.3 Comments

`collectComments` walks the filled token stream: `NL` tokens whose text starts with `//`, `/*` (doc if `/**`) or `#!` (the first token only: the shebang). `ownLine` is true when no code token precedes the comment on its line. `attachComments` ports `CommentAttacher`:
- Same containers, in the same order. For each comment, the innermost container that contains it is chosen, then: trailing after the preceding child on the same line, then leading on the enclosing child, then leading on the following child, then trailing, then hoisted or dangling on the container.
- `IfStatement.elseRange` plays the part of `ELSE_POSITION`.
- `Section` nodes are never containers or slots: their items are children of the declaration's container, as upstream's are. Otherwise a comment after a label (`script: // or exec:`, line 13 of `process-legacy.nf`) would lead the section instead of the first script statement, where nf-lang puts it (`fixtures-comments.upstream.txt`).
- Every comment ends in exactly one slot.

### 4.4 Errors (what F-102 reports, and what it leaves)

| Kind | F-102 | Elsewhere |
|---|---|---|
| Lexer and parser errors (F-101) | passed through as `ok: false` | |
| 50 collected `ScriptAstBuilder` error sites, `EscapeUtils`, reparse | `errors` with `source: "builder"` (reparse syntax errors keep `source: "parser"`), AST still returned | F-112 turns them into AR-05 diagnostics (severity, quick fixes) |
| 5 parse-failing throws (assignment target, nested parens, `[,]`, duplicate named argument, number range) | `ok: false` with the collected errors plus the fatal one | |
| 8 warnings (missing type annotations, one output, `when`, `shell`, typed publish) | not reported; the AST keeps what they need (`TypedName.type === null`, section labels) | F-112 (LA-34 and lints) |
| Resolver errors (8 F-101 cases with layer `resolve`; "is not defined") | not reported | F-112 / F-105 |
| Config builder errors (7 F-101 cases) | | F-103 |

## 5. Snapshot format (test helper, not product code)

`printAst(node, text)` prints one line per node, indented two spaces per level:
- Each line is `<field>[<i>] <Kind> <scalars k=v> <line:col-endLine:endCol>`, followed for leaf kinds by the JSON-escaped slice.
- Children come in `childNodes` order. Null fields and empty arrays are omitted.
- Comments print as pseudo-children: `leadingComments[i] <kind> <range> "<text>"`.
- Snapshots are written with `await expect(printAst(...)).toMatchFileSnapshot("snapshots/<fixture>.txt")`. In CI a missing snapshot fails, so snapshots are committed.

Example (from `process-legacy.nf`):
```
Script 1:1-23:1
  body[0] Process typed=false 1:1-22:2
    name Identifier 1:9-1:14 "greet"
    directives Section 3:5-4:34
      items[0] ExpressionStatement 3:5-3:26
        leadingComments[0] line 2:5-2:18 "// directives"
        expression MethodCall parens=false 3:5-3:26
          method Identifier 3:5-3:18 "errorStrategy"
          args[0] String quote="'" 3:19-3:26 "'retry'"
```

## 6. Tests (write before the implementation)

Test names cite IDs: `F-102 step 1 AR-02 LA-10: ...`, `F-102 step 2 AR-02: ...`, `F-102 LA-30 ADR-0005: ...`.

### 6.1 Step 1: snapshot tests cover each construct in the syntax reference

`test/ast/snapshot.test.ts`: one `it` per `fixtures.json` entry:

| Test name | Asserts |
|---|---|
| `` `F-102 step 1 AR-02 LA-10: ${file} (${sections}) matches its AST snapshot` `` | `parseScriptAst(text)` is `ok`, `errors` is `[]` (the fixture is lint-clean), and `printAst` equals `snapshots/${file}.txt` |

`test/ast/coverage.test.ts`:

| Test name | Asserts |
|---|---|
| `F-102 step 1: the fixtures cover every construct section of the 26.10 syntax reference` | The union of `sections` equals this list (docs/reference/syntax.mdx at 0ad848ef): Comments, Script declarations, Shebang, Feature flag, Include, Params block, Parameter (legacy), Workflow, Workflow (typed), Process, Process (typed), Agent, Function, Enum type, Record type, Output block, Statements, Variable declaration, Assignment, Expression statement, assert, if/else, return, throw, try/catch, Variable, Number, Boolean, Null, String, Dynamic string, List, Map, Closure, Index expression, Property expression, Function call, Constructor call, Unary expressions, Binary expressions, Ternary expression, Parentheses, Precedence (43) |
| `F-102 step 1 AR-02: every script AST node kind appears in a fixture snapshot` | The kinds seen across all fixture ASTs equal `SCRIPT_NODE_KINDS`, except `Import`, `IncompleteDeclaration`, `InvalidDeclaration` and `IncompleteExpression` (error-only; asserted in `errors.test.ts`) |
| `F-102 step 1: every binary and assignment operator appears` | Sets of operators seen equal `BINARY_OPERATORS` and `ASSIGNMENT_OPERATORS`; every `SectionLabel` appears |
| `F-102 LA-10: typed and legacy processes and workflows both build` | Fixtures contain a `Process` with `typed: true`, one with `typed: false`, and the same for `Workflow`; every `Process` in a file with `typesEnabled` is typed |
| `F-102: the manifest lists every fixture file, cites the pinned docs and records an empty lint result` | Files on disk equal `fixture` entries; `upstream.commit` equals `upstream.json` `nextflow.commit`; each `source` matches `/^docs\/reference\/syntax\.mdx#L\d+(-L\d+)?$/` or the entry has a `note`; `lint` is `[]` |

### 6.2 Step 2: every AST node's range slices back to its exact source text

`test/ast/check-ranges.ts`: `checkRanges(ast: ScriptAst, text: string, options?: { reparse?: "all" | "declarations" | "none" }): string[]` returns problems (`[]` means pass). It checks:
1. **Consistent**: `line`, `column`, `endLine`, `endColumn` equal those computed from `start` and `end` by a separate, naive routine (count `\n` and code points), not `PositionIndex`.
2. **Token-aligned and tight**: every node except `Script` starts at the start, and ends at the end, of a non-`NL` token from a fresh lex of `text`. Inside GString path tokens, identifier boundaries count. `start < end`.
3. **Nested**: each child lies inside its parent. Siblings, sorted by `start`, don't overlap.
4. **Leaf text**: the slice equals the leaf:
   - `Identifier.name` and `Variable.name` (whitespace removed, for dotted feature-flag names);
   - `Number.text`, `String.text`, `GStringText.text`;
   - `Boolean` gives `true`/`false`, `Null` gives `null`;
   - `TypeRef`: the slice without whitespace starts with `name`, and ends with `?` if nullable;
   - `labelRange` slices to `<label>:`; `elseRange` to `else`.
5. **Re-parse** (the strong part): the slice, parsed alone by the node's own grammar rule to EOF (`parse-rule.ts`, pure LL with `BailErrorStrategy`) and built by the same builder function, deep-equals the node with every offset shifted by `node.range.start`, ignoring line, column and comments (`shape.ts`). Rules by kind:
   - `scriptDeclaration`: declarations, with `typesEnabled` from the node or script;
   - `statement` or `statementOrLabeled`: statements, normalised by `directive()` inside directive-like sections;
   - `expression`: expressions; a command-call `MethodCall` uses `expressionStatement`;
   - `processInput`, `processRecordInput`, `processTupleInput`, `processOutput`, `workflowEmit`, `nameTypePair`, `formalParameter`, `paramDeclaration`, `namedArg`, `mapEntry`, `catchClause`, `includeName`, `outputDeclaration`, `variableNames`, `type`, `legacyType`;
   - `statementOrBlock`: `Block` with braces;
   - the process `Section` rules (`processInputs`, ...).
   Not re-parsed: `Script`, workflow and agent sections (no rule of their own), `Interpolation`, `GStringText`, `Wildcard` and `InvalidDeclaration`. These are listed in the checker.
6. **Comments**: each comment's slice equals its `text`. `ScriptAst.comments` equals the comment tokens of a fresh lex, in order. Every comment is in exactly one slot.

| File and test name | Asserts |
|---|---|
| `ranges.test.ts`: `` `F-102 step 2 AR-02: every node's range in ${file} slices back to its exact source text` `` (54) | `checkRanges(ast, text, { reparse: "all" })` is `[]` |
| `ranges.test.ts`: `F-102 step 2 AR-02: ranges count code points in columns and UTF-16 units in offsets` | `workflow {\n    v = "𝐀𝐀" + w\n}\n`: the `Binary` has range 2:9-2:17 with offsets 19-29, and its `text.slice` is `"𝐀𝐀" + w`; the `w` `Variable` has column 16 and offset 28 |
| `ranges.test.ts`: `F-102 step 2: CRLF files keep exact slices and count one line per CRLF` | A CRLF version of `process-legacy.nf` gives the same shape as LF, with offsets shifted and lines equal |
| `ranges.test.ts`: `F-102 step 2: ranges built inside tokens and across tokens are exact` | `"$name.first"` gives `Interpolation`, `Variable` and `Identifier` slices `$name.first`, `name`, `first`; `cpus -1` in a process gives a `Unary` slice `-1`; `a >>> b` gives a `Binary` slice `a >>> b`; `(1 + 2) * 3` gives a `Parenthesized` slice `(1 + 2)` whose inner slice is `1 + 2` |
| `ranges.test.ts`: `F-102 step 2: the range checker rejects a range one character too wide or too narrow` | On a built AST, widening a call argument to include `)` and shrinking an `Identifier` by one each give a non-empty problem list (proves the checker isn't vacuous) |
| `ranges.test.ts`: `F-102 step 2 ADR-0005: every ported nf-lang case that builds has exact ranges` | `checkRanges` is `[]` for each `test/ported/cases.json` script case whose result is `ok` |
| `test/corpus/ast.corpus.ts` (task 6), under `pnpm test:corpus` | See 6.5 |

### 6.3 AR-02 comments and AR-01

`test/ast/comments.test.ts` and `collect-comments.test.ts`:

| Test name | Asserts |
|---|---|
| `F-102 AR-02: comments are attached as nf-lang 26.10.7 attaches them, for every fixture` | For each comment in `fixtures-comments.upstream.txt` (45, from `CommentDump`), our slot equals upstream's, and our anchor matches upstream's by start position and kind family (`ExpressionStatement` to our statements, `*Expression` to our expressions, `Parameter` to `TypedName`/`Param`/`Parameter`, process/workflow/function nodes to declarations, `BlockStatement` to a `Block` or `Section` whose first item starts there). Any difference is listed in the test with its cause; the draft expects none |
| `F-102 AR-02: leading, trailing and dangling comments in comments-attachment.nf` | The doc comment leads `Process HELLO` with kind `doc`; `// one is enough` trails the `cpus 1` statement; `// dangling at the end of the script section` dangles on the process; `// a comment between chain links` leads the `.map` call; `// before else` leads the else block; `// dangling at the end of the file` dangles on `Script` |
| `F-102 AR-01: the parse result carries the AST, the comment map and the parse status` | `comments.nf`: `ast.comments` has 2 comments in source order with exact texts; `shebang.nf`: `ast.shebang.kind === "shebang"` and it isn't in `comments`; a file with a builder error is `ok` with `errors` non-empty; a parser error gives `ok: false` |
| `F-102: comment collection keeps exact text, marks own-line comments and handles CRLF and code points` | Unit cases for `collectComments`: `// a` after code (`ownLine` false), `/* b */` alone (`ownLine` true), `/** d */` (kind `doc`), a CRLF file, an astral character before a comment |

### 6.4 Builder errors (LA-30, ADR-0005)

`test/ast/errors.test.ts`, one `it` per `errors.json` case, plus inline cases:

| Test name | Asserts |
|---|---|
| `` `F-102 LA-30 ADR-0005: ${id} reports ${expect[0].message} at ${line}:${column}` `` (46) | `parseScriptAst(text)`: `ok` is `!fatal`; the `{ line, column, message }` of `errors` equals `expect`; `checkRanges` is `[]` when `ok` |
| `F-102 LA-30: a legacy parameter with types enabled reports the params-block message (nextflow lint 26.10.7 crashes on it)` | Inline `nextflow.enable.types = true\n\nparams.input = 'x'\n` gives the error "Legacy parameter is not allowed with `nextflow.enable.types = true` -- use the `params` block instead" at 3:1 (`#L446`), and the `LegacyParam` isn't in `body` |
| `F-102 LA-30: invalid escapes are reported at the escape, in UTF-16 columns as nf-lang does` | `checkEscapes` unit cases from `EscapeUtils`: `\q` gives an error, `\u00e9` doesn't, `\uZZZZ` reports `\u`, escapes aren't checked in slashy strings, a newline after the backslash advances the line |
| `F-102: unescaped string values follow Groovy` | `unescape` turns each escape in syntax.mdx L721-L739 into its documented character; triple-quoted strings drop `\r`; slashy strings turn only `\/` into `/` |
| `F-102: the errors manifest lists every input, cites the builder line, and expects lint's errors minus resolver errors` | Files on disk equal entries; every `upstream` matches `ScriptAstBuilder.java#L...`; `expect` equals `lint` without messages ending "is not defined", except the two `note`d -1:-1 cases, where only the position differs |

`test/ast/ported-builder.test.ts` (reads F-101's `test/ported/cases.json`; F-101's own test is untouched):

| Test name | Asserts |
|---|---|
| `` `F-102 LA-30 ADR-0005: ${id} (${test}) reports nf-lang's ${layer} error` `` (31 cases with owner F-102) | `errors` (`line`, `column`, `message`) equals the case's `lint` without resolver errors |
| `F-102 ADR-0005: every other ported script case builds with no builder errors` | Grammar-level accepts and owner-F-112 cases: `ok` with `errors` `[]`. Grammar-level rejects: `ok: false` with F-101's `expect` |
| `F-102 ADR-0005: the AST builder rejects the three corpus fixtures nextflow lint rejects after parsing` | `tools/corpus/fixtures/` (read by path): `section-order.nf` gives `[8:10 Unexpected input: ':']` and an `InvalidDeclaration` for `LATE_INPUT`; `typed-legacy-mixed.nf` gives `[19:5 Invalid input declaration in typed process]`; `typed-without-flag.nf` gives `[4:5 Typed input declaration is not allowed in legacy process -- set ...]` |

### 6.5 Corpus (`pnpm test:corpus`, task 6)

`packages/lang-2610/test/corpus/ast.corpus.ts`, same harness as `parse.corpus.ts`:

| Test name | Asserts |
|---|---|
| `F-102 ADR-0005: every corpus script nextflow lint accepts builds with no builder errors` | 342 scripts plus fixtures: `ok` and `errors` `[]` for lint-accepted files; lint-rejected script fixtures fail or report errors |
| `F-102 step 2 AR-02: every node in every corpus script slices back to its exact source text` | `checkRanges` with `reparse: "declarations"` on every file, and `reparse: "all"` on rnaseq-nf, rnaseq-nf-typed, fetchngs, fixtures and the same 20-file sarek sample `parse.corpus.ts` uses |
| `F-102 AR-02: every comment in the corpus is attached once and slices back exactly` | Check 6 of `checkRanges` on every file |
| `F-102 AR-02: corpus comment attachment matches nf-lang 26.10.7` (open point 7) | Against `.cache/corpus-lint/<id>.comments.json`; differences pass only if listed with a cause in `test/corpus/known-comment-differences.json` |
| report | Appends node, comment and builder-error counts and build time to `.cache/reports/parse-corpus.md` |

### 6.6 Positions and walker (task 1)

| File and test name | Asserts |
|---|---|
| `lang-core/test/ast.test.ts`: `F-102 AR-02: SCRIPT_NODE_KINDS lists every node kind once` | Runtime: no duplicates, length equals a type-level count. Type level: `Exclude<ScriptNode["kind"], (typeof SCRIPT_NODE_KINDS)[number]>` is `never` |
| `lang-core/test/ast.test.ts`: `F-102 AR-02: walk visits children in field order and skips ranges and comments` | A hand-built `Process` with a leading comment: the visit order is as expected, and no `Comment` or `Range` is visited |
| `lang-2610/test/ast/positions.test.ts`: `F-102 step 2: PositionIndex maps code points to UTF-16 offsets, lines and columns` | ASCII identity; `𝐀` gives offset +1 after it; CRLF counts one line; a lone `\r` doesn't advance the line; `contextRange` trims leading and trailing `NL` tokens (a `blockStatements` that ends in a newline and a comment) |

### Not needed

- Playwright: no UI. Q13 applies, so the unit tests plus the CI `corpus-parse` and `oracle` jobs are the evidence. Say so in the notes.

## 7. Tasks (in order; one builder run each)

The builder works on `feat/F-102` from current `main` (F-101 is merged). Run `pnpm install` first if `antlr4ng` is missing from `node_modules` (the lockfile changed with F-006). Each task writes its tests first, sees them fail, implements, then runs the proof. Commit messages: `feat(lang-core): ...`, `feat(lang-2610): ...`, `test(lang-2610): ...`.

**Task 1: AST types, positions, comment collection, test helpers.**
- Files: `packages/lang-core/src/ast/{range,script,parse-result,walk,index}.ts`, `packages/lang-core/src/index.ts`, `packages/lang-core/test/ast.test.ts`; `packages/lang-2610/src/ast/{positions,comments}.ts`; the `parse.ts` `tokens` field; `packages/lang-2610/test/ast/{positions.test.ts,collect-comments.test.ts,print-ast.ts,check-ranges.ts,parse-rule.ts,shape.ts}`.
- Tests: 6.6, the collection test from 6.3. `check-ranges.ts` and `print-ast.ts` get tests on hand-built nodes in task 2.
- Done when:
```
pnpm --filter @nf-builder/lang-core test
pnpm --filter @nf-builder/lang-2610 test
pnpm check
```

**Task 2: builder for statements and expressions (and the script root).**
- Files: `src/ast/index.ts`, `src/ast/build/{context,script,statements,expressions,literals,types}.ts`.
- Fixtures: copy from the draft the 21 statements-only fixtures: `comments.nf`, `shebang.nf`, `stmt-{separators,variable-declaration,assignment,expression,assert,if-else,throw,try-catch,try-catch-legacy,empty}.nf`, `expr-{literals,strings,gstrings,collections,closures,index-property,calls,constructor,operators}.nf`. `stmt-return.nf`, `stmt-labelled.nf`, `expr-types.nf` and `legacy-dataflow.nf` contain declarations and wait for task 3. Copy the matching `fixtures.json` entries; the full manifest lands in task 3.
- Tests: `snapshot.test.ts` and `ranges.test.ts` (6.1, 6.2) for these fixtures, the unescape test (6.4), and the checker-self test. Review each snapshot by reading it against the fixture before committing it.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast   # all pass; snapshots written once, then stable on a re-run
pnpm check
```

**Task 3: builder for declarations (typed and legacy).**
- Files: `src/ast/build/{declarations,process,workflow}.ts`.
- Copy the rest of `F-102-draft/fixtures/` with `cp -r`, including `modules/nf-core/fastqc/` and its hidden files, and the full `fixtures.json`.
- Tests: all of 6.1 (54 snapshots, coverage), ranges for all fixtures, and the ported-case range test.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast   # 54 snapshot + 54 range tests + coverage pass
ls packages/lang-2610/test/ast/fixtures/modules/nf-core/fastqc/.module-info
pnpm check
```

**Task 4: comment attachment.**
- Files: `src/ast/attach-comments.ts`, wired in `index.ts`; `test/ast/comments.test.ts`; `test/ast/fixtures-comments.upstream.txt` (from the draft; its header gives the command that produced it).
- Re-run the snapshots with `-u` and review the diff: only comment lines may be added.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast
git diff --stat -- packages/lang-2610/test/ast/snapshots   # only files whose fixture has comments
pnpm check
```

**Task 5: builder errors.**
- Files: error collection at every site in table 4.4; `src/ast/reparse.ts` (uses F-101's `DescriptiveErrorStrategy`); `checkEscapes`, `numberError`, and the fatal path in `context.ts`.
- Tests: copy `F-102-draft/errors/` and `errors.json`. Write `errors.test.ts`, `ported-builder.test.ts` and the AR-01 test (6.3, 6.4).
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/ast test/ported   # 46 + 31 + inline + F-101's 94 pass
pnpm check
```

**Task 6: corpus property test and oracle.**
- `test/corpus/ast.corpus.ts` (6.5).
- `tools/oracle/src/trees.ts` (3.3): lint `test/ast/fixtures/` (expect `[]`) and `test/ast/errors/` (expect `errors.json`'s `lint`) as directory trees, with tests using a fake `Exec` (as in `fixtures.test.ts`):
  - `F-102 ADR-0019: the oracle lints the AST fixtures as one tree and expects no errors`;
  - `F-102 ADR-0019: an AST error input whose lint errors differ is a mismatch naming the file`.
- If open point 7 is accepted: `tools/corpus/src/CommentDump.java` plus its call in `lint.ts`, with a unit test of the JSON reader.
- Done when:
```
pnpm --filter @nf-builder/oracle test && pnpm --filter @nf-builder/corpus test
pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus   # Java 21 and .cache/nextflow present (AGENTS.md); else CI corpus-parse
pnpm oracle                                                   # exit 0; report lists the AST fixtures and error inputs as matched
pnpm check
```

**Task 7: records (orchestrator, not the builder).**
- AR-02 wording (open point 3).
- `AGENTS.md` "Nextflow knowledge": if open point 13's recommendation is taken, add that in `packages/lang-*/test/ast/errors/` the oracle reproduces the `lint` lists recorded in `errors.json`. Otherwise, exempt them as F-101 did.
- `docs/licences.md` rows:
  - ported `ScriptAstBuilder`, `CommentAttacher`, `Comments`, `EscapeUtils` and Groovy `StringUtils`/`Numbers` logic (Apache-2.0);
  - syntax-reference snippets in the fixtures (Apache-2.0);
  - vendored nf-core/fastqc module (MIT).
- `features.json` notes (section 9), `progress.md`, and the PR from the template.
- Done when `pnpm check` passes, and the Scope guard passes without `scope-change` (only `passes` and `notes` change).

## 8. Open points (each with a recommendation; none decided here)

1. **Where the AST types live.**
   - **Recommendation:** `lang-core` (`src/ast/`), with the builder in the pack. The engine (F-104 to F-106) must consume the tree but may import only `lang-core` and pack entries (ADR 0003, Q10). ADR 0003 already gives `lang-core` the "model types", so this is not a boundary change and dependency-cruiser is unchanged.
   - Record in `progress.md` Decisions.
2. **Is the AST a stored or exported format?**
   - **Recommendation:** no. It is built in memory from file text and never written to IndexedDB, the layout sidecar (ADR 0008 keys), zip export or GitHub. The snapshot text is a test artefact.
   - So no ADR is needed. Say so in the PR and in Decisions.
3. **AR-02 "Comments are attached to the following node".**
   - **Recommendation:** amend the spec text to match upstream, which F-110 must reproduce: "Comments are attached as nf-lang 26.10's formatter attaches them: leading on the following node, trailing on the node an end-of-line comment follows, or dangling on the enclosing block when nothing follows."
   - This is a spec clarification with no user-visible change. Record it in Decisions.
4. **Which builder errors F-102 reports.**
   - **Recommendation:** all of `ScriptAstBuilder`'s errors (table 4.4), including the 31 F-101 cases and 46 new lint-validated inputs. Reasons: F-104's fixtures need three of them; ADR 0005 says what Nextflow rejects we reject; each is one line at the node being built.
   - Leave warnings, resolver errors and the diagnostic wrapper to F-112.
   - Alternative: only the 31 F-101 cases plus the three fixtures, with the remaining sites listed on F-112. That gives a half-ported builder whose errors F-112 must add inside F-102's code.
5. **Upstream bugs.**
   - (a) Legacy `params.x =` with types enabled crashes lint. **Recommendation:** report `#L446`'s message, tested inline and kept out of the oracle-linted inputs.
   - (b) Two errors printed at -1:-1. **Recommendation:** report at the real node (the drafts say where), with a `note` in `errors.json`.
   - Optionally file both upstream later. Record in Decisions.
6. **Registry include fixture.**
   - **Recommendation:** commit the module directory exactly as lint installed it (`main.nf`, `meta.yml`, `environment.yml`, `.module-info`, `.conda-lock/`). Lint then resolves `include { FASTQC } from 'nf-core/fastqc'` offline, and the oracle needs no new host (`registry.nextflow.io` is not on any build-time list). It also adds a real legacy nf-core module to the snapshots. Licence MIT, add a row in `docs/licences.md`.
   - Alternative: an inline test string with no oracle check (the F-006 tests' practice), which loses the lint guarantee.
7. **Comment-attachment oracle over the corpus.**
   - **Recommendation:** add it in task 6: `tools/corpus/src/CommentDump.java`, a single-file Java program like spec-extract, run by `pnpm corpus:lint` against the pinned dist (ADR 0019). It costs about 18 s for the whole corpus. No new script or workflow edit is needed, since `corpus-parse` already has Java and the dist. It checks 3,923 real comments, which F-110's formatter parity depends on.
   - Alternative: defer it to F-110 and rely on the 45 fixture comments.
8. **Pack API.**
   - **Recommendation:** keep `parseScriptAst` internal to `lang-2610`, as spike S2 did for `parseScript` (bundle size). Define `ScriptParseResult` in `lang-core` now.
   - F-104, the first engine consumer, adds a lazy `LanguagePack.loadParser(): Promise<{ parseScript(text: string): ScriptParseResult }>` (dynamic import, keeping QA-01).
9. **`SourceFile` (AR-01).**
   - **Recommendation:** don't add it in F-102. It is engine model, and F-103's config result is part of its union. F-102's share of AR-01 (AST, comment map, parse status) is tested. Add a note on F-104.
10. **Position units.**
    - **Recommendation:** offsets in UTF-16 (JS slicing); columns in code points (nf-lang and lint parity; F-101's `ParseError` uses the same); ends exclusive.
    - Monaco (UTF-16 columns) converts from offsets later.
    - Builder error end columns are ours (code points). Upstream's are UTF-16, and lint prints only the start.
11. **Shape choices that mirror upstream:**
    - directive normalisation;
    - invalid items dropped with an error;
    - typed or legacy decided by the flag seen before the declaration;
    - top-level statements kept as statements;
    - number literals kept as verbatim text (no numeric value; avoids bigint and precision questions).
    **Recommendation:** as in section 3.1. Each is internal and can change before F-104 depends on it.
12. **Snapshot churn inside the branch.** Snapshots from tasks 2 and 3 gain comment lines in task 4. **Recommendation:** accept it. Snapshots are new in this feature, and the reviewer sees the final set.

13. **Oracle for the F-102 fixtures and error inputs.** AGENTS.md says fixtures must pass the oracle. F-101 exempted its upstream inputs ("recorded and checked for consistency, not re-run") rather than extend the oracle.
    - **Recommendation:** extend the oracle with `tools/oracle/src/trees.ts` (3.3, task 6). The 54 snapshot fixtures are our own lint-clean code, so they fall under the rule without exception. The 46 error inputs reuse the same runner with their recorded lists, so they need no AGENTS.md exception. One lint run per tree took about 5 s here. No workflow edit is needed.
    - Alternative: follow F-101 for the error inputs only (exempt them in AGENTS.md, recorded and consistency-checked), and still lint the snapshot fixtures.

## 9. Records to write when F-102 lands (drafts for the orchestrator)

**`features.json` notes to append** (no scope change):
- F-102: "Verified <date>: step 1 by test/ast/snapshot.test.ts (54 lint-clean fixtures; coverage.test.ts proves all 43 syntax.mdx sections at 0ad848ef, every node kind and operator); step 2 by test/ast/ranges.test.ts on every fixture and ported case and test/corpus/ast.corpus.ts on the corpus (CI corpus-parse). Builder errors: 31 F-101 ported cases plus 46 inputs in test/ast/errors (oracle re-checks lint). No Playwright test (Q13)."
- F-104: "From F-102: parseScriptAst (lang-2610, internal) returns ScriptParseResult; declarations with builder errors are listed in errors by range; section-order.nf gives an InvalidDeclaration. Add LanguagePack.loadParser and SourceFile (AR-01) here."
- F-110: "From F-102: comments are attached by a port of nf-lang 26.10.7's CommentAttacher, checked against it on the fixtures (and the corpus, if open point 7 was accepted). The AST keeps quote style, verbatim numbers, trailing commas, Parenthesized, labels and elseRange for the formatter."
- F-112: "From F-102: AST-builder errors come with nf-lang wording in ScriptParseResult.errors (source builder or parser); warnings (#L597, #L619, #L634, #L695, #L824, #L836, #L977, #L1059) and resolver errors are F-112's."

**`progress.md` Decisions:** open points 1, 2, 3, 4, 5, 6, 7, 8 and 13 as settled. Also: the AST is not a stored format; there is no new dependency (antlr4ng is already a runtime dependency of the pack).

## 10. How the evidence was produced (to repeat it)

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/5a04e27b-26df-5c7b-af9e-9c0f6a532353/scratchpad/`. A cleanup may clear it.
- **Upstream:**
  - `f102-upstream/syntax.mdx` (raw.githubusercontent.com at 0ad848ef).
  - `f102-upstream/nf/` is a sparse, blobless clone at v26.10.7 (formatter, ast, parser, docs).
  - `upstream/ScriptAstBuilder.java` is identical to the clone's copy.
- **Lint:**
  - `f102-bin/lint.sh <dir>` and `f102-bin/lint-one.sh <dir>` run `.cache/nextflow/nextflow-26.10.7-dist lint -o json .` under `unshare -rn` with `NXF_HOME=.cache/nextflow/home NXF_OFFLINE=true NXF_SYNTAX_PARSER=v2`.
  - Fixtures: `f102-fixtures/` (0 errors).
  - Errors: one directory per input in `f102-errors-each/`, plus `f102-errors-num/` and `f102-errors-extra/`. The combined re-run in `f102-lintcheck/` matched exactly.
- **Parser:** `f102-src/parse-fixtures.ts` (imports the F-101 worktree's `parse.ts` by path). `f102-src/tokens.ts` shows code-point token positions.
- **Comment oracle:** `f102-java/DumpComments.java` was run with `java -cp .cache/nextflow/nextflow-26.10.7-dist`. Output: `f102-java/fixtures-comments.txt` (54 files, 45 comments) and `f102-java/corpus-comments.txt` (342 corpus scripts from `/home/user/wt-F-101/.cache/corpus`, 3,923 comments, 18 s).
- **Drafts:** `f102-src/build_drafts.py` writes `plans/F-102-draft/`:
  - `fixtures/` and `fixtures.json`: 54 fixtures;
  - `errors/` and `errors.json`: 46 inputs (`invalid-definition`, `directive-not-call` and `directive-with-receiver` were appended afterwards; a combined lint run in `f102-lintcheck2/` matched all 46);
  - `DumpComments.java`;
  - `fixtures-comments.upstream.txt`.
