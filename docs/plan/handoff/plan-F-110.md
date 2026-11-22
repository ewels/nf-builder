# Plan: F-110, printer for typed declarations matching `nextflow lint -format`

Planner output, 2026-11-22. Read-only: no repo or worktree was changed. Based on `main` at `c0853bf` and the F-102 worktree (`/home/user/wt-F-102`, branch `feat/F-102`, AST types committed in `83511c3`, comment attachment uncommitted but present). F-110 starts from `main` **after F-102 merges** (it depends on F-102's AST types, builder and `attachComments`).

Evidence was produced with the pinned dist (`.cache/nextflow/nextflow-26.10.7-dist`, `NXF_SYNTAX_PARSER=v2`, `NXF_OFFLINE=true`, under `unshare -rn`) in the scratchpad; section 10 says how to repeat it.

## 0. Scope in one paragraph

F-110 ports nf-lang 26.10.7's formatter (`Formatter.java`, `ScriptFormattingVisitor.java`, the type-name and blank-line parts of `Types.java` and `Comments.java`) to TypeScript in `packages/lang-2610/src/printer/`, over F-102's AST and F-102's port of `CommentAttacher`. `printScript(ast, { layout })` and `printDeclaration(node, { layout })` return what `nextflow lint -format` writes, except for three listed upstream bugs. The printer is pure, has no new dependency, and is not exported from the pack entry (a later feature wires a lazy loader). Evidence: golden files. Nextflow writes `formatted*/`; the printer must reproduce them (Vitest, `pnpm check`). The CI oracle (`pnpm oracle`, existing `oracle` job, no workflow edit) re-formats the inputs and requires the same bytes (parity). It also re-formats everything the printer printed and requires no change and no lint error (steps 1 and 2). LA-14: a tuple argument for a legacy input prints as `tuple(a, b, ...)`, checked by a lint-clean oracle fixture.

## 1. Findings

### 1.1 Upstream formatter (nextflow-io/nextflow v26.10.7, commit 0ad848ef)

Files in `modules/nf-lang/src/main/java/nextflow/script/formatter/` (sparse clone in the scratchpad, `f102-upstream/nf`):
- `ScriptFormattingVisitor.java` (810 lines): declarations. `visit()` L93-L158: shebang; code snippet (statements only) L104-L109; declarations in source order (`sortDeclarations` false) L116-L118; dispatch L132-L155; script dangling comments L157. Per declaration: feature flag L166, include L176-L215, params block L223-L252, legacy param L254-L267, workflow L275-L328, typed inputs L330-L385, typed outputs and publishers L387-L486, agent L488-L518, typed process L520-L598, legacy process L600-L653, function L655-L675, record L677-L709, enum L711-L731, output block L733-L798, directives L800-L808.
- `Formatter.java` (1,032 lines): buffer, indentation and comment output L98-L300 (`appendLeadingComments` L123, `appendCommentsBefore` L139, `appendDanglingComments` L150, `appendTrailingComment` L161, `appendBlankLines` L210, `appendComment` L218, `beginStatement` and `reindentString` L246-L288). Statements L304-L462. Expressions L468-L934. Wrapping helpers L938-L1024.
- `FormattingOptions.java`: `(tabSize, insertSpaces, harshilAlignment, maheshForm, sortDeclarations)`.
- `Comments.java`: `blankLinesBefore` L89-L94 counts the lines with no token directly above a line. A multi-line string or comment token marks every line it spans as content. `startsLine` L76-L79. `collect` L102-L145 (CRLF to LF, `stripTrailing`). `textsOf` L155-L170 (sorted, normalised comment texts, used to prove no comment was lost).
- `Comment.normalize` (whitespace runs to one space, stripped). `CommentAttacher.getMissingComments` L153-L157.
- `nextflow/script/dsl/Types.java`: `getName` L277-L294, `typeName` L337-L372, `getName("Object") == "?"` L398-L402, `TYPE_ALIASES` L437-L474, `normalize` L481-L515 (walks the Java class hierarchy).
- Tests: `src/test/groovy/nextflow/script/formatter/ScriptFormatterTest.groovy` (1,593 lines, 58 tests). It has 85 `checkFormat` calls (5 use Harshil alignment) and 3 direct `format` assertions. `checkFormat` asserts `format(input) == output` and `format(output) == output`.

The formatter reads source layout as well as the AST:
- blank lines before every leading comment and every node it calls `appendLeadingComments` on (`blankLinesBefore(line)`, no cap);
- wrapping when a node spans lines: include L178, method-call arguments L997-L1003, method chains L1005-L1024, ternary L638, closure bodies L698;
- multi-line string re-indentation by the statement's column change (L246-L288);
- trailing commas (lists, maps, call arguments).

A node with no position (upstream line -1) gets no blank lines and never wraps unless it has a trailing comma.

### 1.2 `nextflow lint -format` (checked by running it, and with `javap` on `nextflow/cli/CmdLint.class` in the dist; no Groovy source exists at the tag path `modules/nextflow/src/main/groovy/nextflow/cli/CmdLint.groovy`)

- Invocation: `nextflow lint -format [-o json] <paths>`. It **formats in place** and writes a file only when its text changes. There is no output-path option; `-o` is the error report mode.
- `-format -o json .` works together: the JSON summary has `filesFormatted`, and `errors`/`warnings` carry `filename`, `startLine`, `startColumn` and `message`.
- Defaults: `spaces = 4` when neither `-spaces` nor `-tabs` is given. Options: `FormattingOptions(spaces, !tabs, harshilAlignment, false, sortDeclarations)`. Other flags: `-harshil-alignment`, `-sort-declarations`, `-tabs`, `-spaces N`.
- It formats only files with **no errors at all**, including resolver and type-checker errors (an unresolved include source, `Function fromPath ... incorrect argument types`). Warnings don't block. Exit status 1 when any file has errors, else 0.
- It skips a file with a warning "Not formatting <file> -- N comment(s) would be lost" when `getMissingComments()` is non-empty. This never happened on the corpus.
- Output is LF (CRLF input gets LF). Tabs become 4 spaces. Trailing blank lines at end of file are dropped, and a file ends with one `\n`.
- **Stability:**
  - Formatting the whole formatted corpus a second time changed **no script** (342 scripts; only 3 rnaseq `conf/modules/*.config` files changed, and configs are outside F-110).
  - On F-102's 56 fixture files it is stable except `expr-call-value.nf` (`f(1)(2)` prints as a wrapped `.call(`, and the second pass wraps again).
- **Speed:** the whole corpus takes about 33 s (rnaseq-nf 2 s, rnaseq-nf-typed 1 s, fetchngs 3 s, rnaseq 10 s, sarek 17 s); a fixture tree takes about 2 s.

### 1.3 Upstream behaviour the port must reproduce (all verified on 26.10.7)

These are valid code that is stable under a second pass:
- Directives are printed as command calls: `debug(true)` gives `debug true`; `name [..]` gives `name([..])`.
- Calls elsewhere always get parentheses: `println 'x'` gives `println('x')`. Positional arguments come before named ones: `file(checkIfExists: true, 'a')` gives `file('a', checkIfExists: true)`. `each() { }` gives `each { }`.
- Every interpolation is braced: `"$x.y"` gives `"${x.y}"`. Ranges get no spaces: `1 .. 3` gives `1..3`. Several indices become a list: `l[0, 1]` gives `l[[0, 1]]`.
- A bare `return` gives `return null`. `catch (A | B e)` becomes two catch clauses. `catch (T e)` gives `catch (e: T)`.
- `if` and `else` always get braces, with `else` on its own line.
- An explicit `->` with no parameters is dropped. A closure stays on one line only if it was on one line and holds one expression statement with no comments.
- Legacy type annotations become modern: `Integer x` gives `x: Integer`, `def int u` gives `def u: int`, `String s = 'x'` gives `def s: String = 'x'`. `Object` and array types are dropped. A legacy type's text keeps no whitespace.
- A legacy function return type becomes `-> T`, and functions always start with `def`.
- Enum constants go one per line, each with a comma. Typed process `record(...)` inputs always wrap; `tuple(...)` inputs never wrap.
- Workflows:
  - `main:` is printed only when another section exists. When it is printed, a blank line precedes it even if there is no `take:`, so an entry workflow with `publish:` prints `workflow {` + blank line + `main:`.
  - Publish targets drop their type: `b: Channel<String> = ch` gives `b = ch`.
- Process sections come in canonical order with one blank line after each section. An implicit process body gets the label `script:`.
- Includes print as `include { A ; B as C } from '<source as written>'`. An include that spans lines in the source puts one entry per line, each followed by ` ;` except the last.
- Blank-line quirks come from source lines:
  - `record R{a:String;b:Path}` on one line after a blank line gets a blank line before **each** field;
  - `def f(a) { a }` after a blank line gets a blank line inside the body;
  - the same applies to enum constants.
- Block-comment continuation lines are stripped and re-indented, and a line that starts with `*` gets one leading space. A trailing comment follows one space, with any newline in it replaced by a space.
- A wrapped list, map or argument list gets a trailing comma only when it has more than one element: `greeting: 'hi', // c` gives `greeting: 'hi' // c`.
- In a wrapped chain, a namespace receiver (`channel`, `log`, `nextflow`, `workflow`) keeps its first link on the same line. `Channel` (the legacy class) and other receivers don't.
- A chain whose innermost receiver spans lines (`workflow\n.projectDir\n...`) collapses onto one line.

### 1.4 Upstream bugs (proposed known differences, open point 1)

1. **Type renaming (`type-rename`).** The formatter prints resolved types through `Types.getName`, which normalises them through the Java class hierarchy. Examples: `int` gives `Integer`, `Long` gives `Integer`, `Double` gives `Float`, `ArrayList` gives `List`, `LinkedHashMap` gives `Map`, `Tuple2<A,B>` gives `List<A, B>`, `java.util.List<String>` gives `List<String>`. It does this for annotations, `new`, casts, `instanceof` and class receivers. Results:
   - code that fails lint: `new ArrayList<String>()` gives `new List<String>()` ("`java.util.List` is an abstract type", F-102 `expr-constructor.nf`; also rnaseq `subworkflows/local/multiqc_rnaseq/main.nf` L472-L473, `new LinkedHashMap(...)`);
   - code that passes lint but means something else: `Long.MAX_VALUE` gives `Integer.MAX_VALUE`; `Double.parseDouble('1.0')` gives `Float.parseDouble('1.0')`; `[1] as TreeMap`-style casts and `instanceof ArrayList` widen;
   - annotations are not erased at runtime: `nextflow run` on `def x: TreeMap = [b: 1, a: 2]` prints `java.util.TreeMap [a:2, b:1]`, and a function parameter typed `TreeMap` rejects a `LinkedHashMap` argument ("Missing process or function f(...)"). Renaming an annotation can therefore change behaviour.
2. **Catch type package (`catch-package`).** `catch` prints `getNameWithoutPackage()`. So `catch (java.nio.file.AccessDeniedException e)` gives `catch (e: AccessDeniedException)`, which fails lint ("`AccessDeniedException` is not defined", F-102 `stmt-try-catch.nf`).
3. **Call expression wrap (`call-wrap`).** `f(1)(2)` prints as `f(1).call(\n    2\n)` because the synthetic `call` method has no position (`-1 < lastLine`). A second pass wraps again (F-102 `expr-call-value.nf`). It isn't idempotent.

### 1.5 What F-102 provides, and what the printer derives

- Types in `@nf-builder/lang-core` `src/ast/` (ADR 0027): `ScriptAst`, the declaration, statement and expression nodes, `Range`, `Comment`, comment slots (`leadingComments`, `trailingComments`, `danglingComments`), `walk` and `childNodes`.
- The tree keeps what the formatter needs:
  - `trailingComma` on lists, maps, calls, record and tuple inputs and enums;
  - `parens` and `closures` on calls;
  - verbatim `Number.text`, `String.text` and `GStringText.text`;
  - `quote`, `Parenthesized`, statement `labels`, `IfStatement.elseRange`, `FunctionDef.legacyReturnType`, `VariableDeclaration.legacyType`, `Closure.params` (`null` for no arrow, `[]` for a bare arrow), and `CatchClause.types[]`.
- Comment slots follow nf-lang's containers. Upstream nodes map to ours: `ExpressionStatement` to our statement kinds, `Parameter` to `TypedName`/`Param`/`FormalParameter`, and a `BlockStatement` to its declaration or `Block`. `Section` nodes are never slots. The printer reads the slots on the nodes where upstream's `Formatter` asks `comments.leading/trailing/dangling(node)`.
- The printer derives three positions the AST doesn't store:
  - the line of a call's `)`: the first trailing closure's start line, because the grammar allows no newline between `arguments` and `closure` (`ScriptParser.g4` `pathElement`), else the call's end line;
  - the method-name line: the `method` node's line;
  - "starts its own line": from the layout.
- Not in the AST: `contentLines` and `firstColumns`. The printer re-lexes the text (`createLayout`).

## 2. Requirements and what F-110 delivers

- **ADR-0005** ("the pack's printer emits what `nextflow lint -format` would. The CI oracle (ADR 0011) checks it"): a port of the formatter. Parity goldens come from real Nextflow. CI re-formats inputs and printer outputs. The three bugs of 1.4 are deviations that need an ADR (open point 1).
- **LA-45** ("Code is formatted as `nextflow lint -format` would"): the same evidence. LA-45 doesn't say which code. Per F-104 and F-111, it is new or edited declarations and new files; untouched declarations keep their source slices.
- **Step 1** ("Oracle job formats every printer fixture with Nextflow 26.10 and finds no difference"):
  - oracle check `fixed-point`: Nextflow re-formats every file the printer printed and changes nothing;
  - plus `format`: Nextflow's formatting of every fixture input equals the committed golden, which the printer reproduces byte for byte in `pnpm check`.
- **Step 2** ("Printed fixtures pass `nextflow lint` with no errors"): the same `fixed-point` run must report `errors: []` and exit 0.
- **F-005 note / LA-14**:
  - a lint-clean fixture in which a typed workflow calls a legacy process from another file with `tuple(meta, reads)`;
  - a synthesised tree doing the same;
  - a unit test that a `tuple` call argument prints as a call with one argument per component, never a list literal.
- **AR-20 and the architecture sketch's `printer: Printer`**: a `ScriptPrinter` interface in lang-core, implemented by the pack. The pack hook comes later (open point 6).

## 3. Files

Paths are relative to the repo root. Ported files get an attribution header like `src/parser/abstract-lexer.ts` (Apache-2.0, `../../grammar/NOTICE`, upstream path, tag and line ranges).

### 3.1 `packages/lang-core` (types and one sentinel; no imports outside lang-core)

**Change `src/ast/range.ts`** (open point 2):
```ts
/** The range of a node an edit created, until the file is re-parsed. It slices nothing; the printer gives such nodes no blank lines and no source-driven wrapping (nf-lang: line -1). */
export const NO_RANGE: Range;            // { start: -1, end: -1, line: -1, column: -1, endLine: -1, endColumn: -1 }
/** nf-lang `Comment.hasPosition`: line > 0. */
export function hasPosition(range: Range): boolean;
```

**Create `src/printer.ts`**, re-exported from `src/index.ts`:
```ts
import type { Comment } from "./ast/range.ts";
import type { Declaration, ScriptAst } from "./ast/script.ts";

/** What the printer needs from the text a tree was parsed from (nf-lang `Comments`). */
export interface SourceLayout {
  /** Lines with no token directly above `line` (1-based; a multi-line string or comment counts as content on every line it spans). 0 when line < 1. */
  blankLinesBefore(line: number): number;
  /** Whether the first token on `line` starts at `column` (1-based, code points). */
  startsLine(line: number, column: number): boolean;
}
export interface PrintOptions {
  /** Layout of the text the tree's positioned nodes were parsed from. Omit it for a synthesised tree. Nodes with `NO_RANGE` always use the fresh layout (section 4.3). */
  readonly layout?: SourceLayout;
}
export interface PrintResult {
  readonly text: string;
  /** Attached comments the printer didn't emit (nf-lang `getMissingComments`). Empty unless the printer has a bug; never write `text` when it isn't. */
  readonly missingComments: readonly Comment[];
}
/** The printer of one language pack (ADR 0005, AR-20). Prints only trees whose parse reported no errors in the printed part, as `nextflow lint -format` formats only error-free files. */
export interface ScriptPrinter {
  createLayout(text: string): SourceLayout;
  /** The whole file: shebang, declarations or a code snippet, and the script's dangling comments. "" for an empty script. */
  printScript(ast: ScriptAst, options?: PrintOptions): PrintResult;
  /** One declaration: its leading comments (no blank lines before the first), the declaration, its trailing comment and a final "\n". */
  printDeclaration(node: Declaration, options?: PrintOptions): PrintResult;
}
export class PrintError extends Error {
  readonly node: { readonly kind: string };
}
```
`PrintError` is thrown for the error-only kinds (`Import`, `IncompleteDeclaration`, `InvalidDeclaration`, `IncompleteExpression`) and for a script that mixes top-level statements and declarations (upstream reports an error and won't format it).

### 3.2 `packages/lang-2610/src/printer/` (off the pack entry; nothing in `src/index.ts` imports it)

| File | Exports | Ports |
|---|---|---|
| `index.ts` | `createLayout(text: string): SourceLayout`; `printScript(ast: ScriptAst, options?: PrintOptions): PrintResult`; `printDeclaration(node: Declaration, options?: PrintOptions): PrintResult`; `export const scriptPrinter = { createLayout, printScript, printDeclaration } satisfies ScriptPrinter` | `ScriptFormattingVisitor.visit` L93-L162 |
| `layout.ts` | `createLayout(text)`: lexes with the generated `ScriptLexer` (code points, as F-102's tokens), builds `contentLines` and `firstColumns` as `Comments.collect` does, and returns a `SourceLayout`. `FRESH_LAYOUT: SourceLayout` (always 0 and false) | `Comments.java` L76-L145 |
| `formatter.ts` | `class Formatter { constructor(layout: SourceLayout); toString(): string; readonly emitted: Set<Comment>; append(text: string): void; appendIndent(): void; appendNewLine(): void; incIndent(): void; decIndent(): void; appendLeadingComments(node: AstNode | null): void; appendCommentsBefore(node: AstNode): void; appendDanglingComments(node: AstNode): void; appendTrailingComment(node: AstNode): void; hasTrailingComment(node: AstNode): boolean; statement(node: Statement): void; statements(nodes: readonly Statement[], danglingOwner: AstNode | null): void; expression(node: Expression): void; directive(owner: AstNode, call: MethodCall): void; arguments(args: readonly Argument[], wrap: boolean): void; parameters(params: readonly FormalParameter[]): void; typeAnnotation(type: TypeRef): void; legacyTypeAnnotation(type: LegacyType): void }` | `Formatter.java` (all but `CommentAligner`, which is a no-op without Harshil alignment) |
| `script-formatter.ts` | `class ScriptFormatter { constructor(fmt: Formatter); script(ast: ScriptAst): void; declaration(node: Declaration, previous: ScriptItem | null): void }`. Private methods keep upstream's names (`featureFlag`, `include`, `params`, `paramV1`, `workflow`, `typedInputs`, `structuredInput`, `typedOutputs`, `workflowPublishers`, `agent`, `processV2`, `processV1`, `func`, `record`, `enumDef`, `outputs`, `output`, `outputBody`, `directives`) | `ScriptFormattingVisitor.java` L166-L808 |
| `types.ts` | `typeName(type: TypeRef): string`; `hasType(type: TypeRef \| null): boolean`; `legacyTypeText(type: LegacyType): string`; `hasLegacyType(type: LegacyType \| null): boolean`; `catchTypeName(type: TypeRef): string`; `NAMESPACES: ReadonlySet<string>` (`channel`, `log`, `nextflow`, `workflow`) | `Types.getName` and `typeName` as far as they don't rename (4.5), `Formatter.hasType` L966-L987, `Types.isNamespace` |
| `positions.ts` | `line(node)`, `lastLine(node)`, `column(node)`: the range values, or -1 for `NO_RANGE`. `argumentsLastLine(call: MethodCall \| CallExpr): number` (1.5). `methodLine(call): number` | `ASTNode.getLineNumber` semantics |
| `comments.ts` | `commentText(comment: Comment): string` (CRLF and CR to LF, `stripTrailing`, as `Comments.collect`); `normaliseComment(text: string): string` (`Comment.normalize`); `attachedComments(node: AstNode): Comment[]` (every slot in the subtree, for `missingComments`) | `Comments.collect` L119, `Comment.normalize` |

Nothing else in the pack changes. `README.md` gets one line on `src/printer/`.

### 3.3 `tools/oracle` (standalone; reads pack files by path, ADR 0019)

- **Create `src/format.ts`:**
  ```ts
  export type FormatFileKind = "parsed" | "support" | "synthesised" | "edited";
  export type FormatTree = { name: string; input: string | null; formatted: string; printed: string };   // absolute dirs
  export type FormatFile = { tree: string; path: string; kind: FormatFileKind; knownDifference: string | null };
  export type FormatManifest = { file: string; trees: FormatTree[]; files: FormatFile[]; knownDifferences: Record<string, string> };
  export function loadFormatManifest(file?: string): FormatManifest;           // collects every problem, throws one Error
  export type FormatRunOptions = { exec: Exec; formatDir: string; write?: boolean; log?: (line: string) => void };
  export function runFormatTrees(manifest: FormatManifest, options: FormatRunOptions): CheckResult[];
  ```
  - `runFormatTrees`, per tree:
    - **`format` check.** Copy `input/` to `<formatDir>/<tree>/input/` and run `nextflow lint -format -o json .`. Require exit 0 and `errors: []` ("a printer fixture input must be lint-clean"). Every resulting file must equal `formatted/<path>` byte for byte. With `write: true`, write `formatted/` instead.
    - **`fixed-point` check (steps 1 and 2).** Compose `<formatDir>/<tree>/expected/` from `formatted/` overlaid with every file in `printed/`. Run the same command. Require exit 0, `errors: []`, `summary.filesFormatted === 0` and every file unchanged.
  - Mismatches name the file and the first differing line, and write a unified diff to the check's log.
- **Change:**
  - `src/check.ts`: `CheckKind` becomes `"lint" | "run" | "format" | "fixed-point"`; add `parseFormatJson(stdout): { summary: { errors: number; filesFormatted: number }; errors: { filename: string; startLine: number; startColumn: number; message: string }[] } | null`.
  - `src/paths.ts`: `PRINTER_FIXTURES_FILE = ${REPO_ROOT}/packages/lang-2610/test/printer/fixtures.json` ("read by path, never imported").
  - `src/cli.ts`: run the format trees by default, as with the corpus fixtures; `--case` skips them. New flag `--write-format` regenerates `formatted*/` (exit 2 when an input has lint errors). `USAGE` is updated.
  - `src/report.ts`: annotations for `printer:` rows point at `fixtures.json`.
  - `README.md`: one paragraph.

### 3.4 `tools/corpus` (open point 8)

- **Change `src/lint.ts` and `src/lint-cli.ts`:** after linting each pipeline, `formatPipeline(id)` copies `.cache/corpus/<id>` without `.git` to `.cache/corpus-format/<id>/`. It runs `nextflow lint -format -o json .` there and writes `.cache/corpus-format/<id>.json` (summary and errors), cached per pin and Nextflow version like the lint results. No new script.
- **Test:** `test/format.test.ts`, with the JSON reader and a fake spawn.

### 3.5 Test files (created by the tasks)

`packages/lang-2610/test/printer/`:
- `fixtures.json`, the manifest (section 5.1);
- the trees `input/`, `formatted/` and `printed/`, plus `formatted-ast/` and `printed-ast/` for F-102's `test/ast/fixtures/`, reused by path;
- helpers: `synth.ts` (synthesised and edited trees, keyed by path), `structure.ts`, `comment-texts.ts`;
- tests: `fixtures.test.ts`, `manifest.test.ts`, `layout.test.ts`, `synthetic.test.ts`, `types.test.ts`, `errors.test.ts`.

Also:
- `packages/lang-2610/test/ported/formatter/`: `cases.json`, `cases/<id>.in.nf`, `cases/<id>.out.nf`, `formatter.test.ts`, and `transcribe.py`, which keeps F-101's transcription approach (Groovy unescape and `stripIndent`);
- `packages/lang-2610/test/corpus/`: `print.corpus.ts` and `known-format-differences.json`;
- `packages/lang-core/test/printer.test.ts`;
- `tools/oracle/test/format.test.ts`.

**Change `.gitattributes`:** `packages/lang-2610/test/printer/** -text` and `packages/lang-2610/test/ported/formatter/cases/** -text`. The goldens are byte-exact, and one ported input is CRLF.

**No change:** workflows (the `oracle` job already runs `pnpm oracle`, and `corpus-parse` already runs `pnpm corpus:lint` and `pnpm test:corpus` with Java), `package.json` scripts, dependency-cruiser rules, generated files, the pack entry and `LanguagePack`.

## 4. How the printer works

### 4.1 A line-by-line port

`Formatter` and `ScriptFormatter` keep upstream's method structure and order, with upstream line references in comments. Where the trees differ, the port maps them as below:

| Upstream | Ours |
|---|---|
| `DeclarationExpression` | `VariableDeclaration` (`def` always printed; `multiple` gives `def (a, b) = ...`) |
| `BinaryExpression` with an assignment operator | `Assignment`; a `TupleTarget` prints as a tuple expression |
| `BinaryExpression` `[` | `IndexExpr`; several indices print as one list `a[[i, j]]` |
| `RangeExpression` | `BinaryExpr` `..` or `..<`, printed with no spaces |
| `NotExpression`, `UnaryMinus/Plus`, `BitwiseNegation` | `UnaryExpr` |
| `MethodCallExpression` (`NamedArgumentListExpression` first) | `MethodCall`: positional `args` first, then `NamedArgument`s, then `closures` (the last closure after a space); `parens` is ignored outside directive positions |
| implicit `.call` | `CallExpr`: `<callee>.call(args)` (known difference `call-wrap`, 4.6) |
| `ConstantExpression` `VERBATIM_TEXT` | `Number.text`, `String.text` (triple-quoted texts re-indented) |
| `GStringExpression` | `GString`: `quote`, `GStringText.text`, and `${...}` for every `Interpolation` |
| `INSIDE_PARENTHESES_LEVEL` | `Parenthesized` |
| `ClassExpression`, `CastExpression`, `instanceof`, `ConstructorCallExpression` | built-in type `Variable`, `CastExpr`, `TypeTestExpr`, `NewExpr`; type names as written (4.5) |
| `CatchStatement` per type | one `catch` per entry of `CatchClause.types`, with the body printed for each |
| `ReturnStatement` with no value | `return null` |
| `EmptyStatement` | nothing |

Directive positions, where a call prints as `name args` through `directive()`:
- process, agent and legacy-process directives;
- legacy inputs and outputs;
- `stage:`;
- output-block statements and `index { }` bodies.

### 4.2 Layout from the source

- `blankLinesBefore` and `startsLine` come from `createLayout(text)`, a port of `Comments.collect`:
  - a line is content when any non-newline token, comment included, starts on it or spans it;
  - columns are in code points, like `Range.column`;
  - CRLF is one line break.
- The printer calls `layout.blankLinesBefore(line(node))` exactly where upstream calls `appendBlankLines`. It prints nothing while the buffer is empty.
- Wrapping uses `line`/`lastLine` from ranges, exactly as upstream's `shouldWrapExpression`, `shouldWrapMethodCall` (method-name line against `argumentsLastLine`) and `shouldWrapMethodChain` (`currentRootExpr`, chain depth >= 2, innermost receiver on one line; any link comment forces it).
- `beginStatement`: `delta = 4 * indent - (column - 1)` when the statement starts its line, else 0.

### 4.3 Synthesised and edited trees (open point 3)

- A node an edit creates carries `NO_RANGE`. For it, `line()` is -1, so it gets no source blank lines, no source-driven wrap and no string re-indent. A synthesised triple-quoted string must already carry its final indentation. A trailing comma still asks for a wrap.
- The **fresh layout** adds one rule upstream doesn't have (upstream would put no blank line anywhere). A top-level declaration with `NO_RANGE` gets one blank line before it (before its first leading comment, if any), unless:
  - it is the first item;
  - it is an `Include` after an `Include`;
  - it is a `FeatureFlag` after a `FeatureFlag`.
  Its leading comments and everything inside it get none. This keeps the CreateProcess shape (`nextflow.enable.types = true`, a blank line, a doc comment, then `process`) and is stable under `lint -format`, which keeps existing blank lines. The oracle's `fixed-point` check proves it on every synthesised fixture.
- An **edited** tree mixes positioned nodes (from the old text, with that text's layout) and `NO_RANGE` nodes. Each node uses its own rule.
- A synthesised `StringLiteral` must set `text` (quotes included), because the printer prints `text`.

### 4.4 Formatting rules (summary; the port and the goldens win where this differs)

- **General:**
  - 4 spaces per level and LF. Each declaration ends with `\n`. The script's dangling comments come last. An empty script prints `""`.
  - Blank lines are as in the source (4.2), or the fresh layout (4.3).
  - Fixed blank lines:
    - process and agent: after each section except the last (directives, `input:`, `stage:`, `output:`, `topic:`, `when:`);
    - workflow: before `main:` (when printed), `emit:`, `publish:`, `onComplete:` and `onError:`.
- **Comments:**
  - leading comments go on their own lines at the node's indent, re-indented as in 1.3;
  - a trailing comment follows one space;
  - dangling comments go before the container's closing brace (in a wrapped call, list or map, before the closer);
  - the shebang is the first line.
- **Declarations:** as upstream (1.3), in source order (`sortDeclarations` is off).
- **Statements and expressions:** as in 1.3 and the table in 4.1.
- **Literals:** numbers, single-quoted and slashy strings are verbatim. A triple-quoted string's interior lines shift by the statement's indentation change, never past a line's first non-space character.

### 4.5 Type names (open point 1)

- A `TypeRef` prints as written, with `<a, b>` separators normalised to `", "` and a trailing `?` when nullable.
- An `Object` argument inside `<...>` prints as `?`, as upstream. A wildcard prints as `?`.
- An annotation is omitted when the type is `Object` (`hasType`). A legacy annotation is omitted when it is `Object` or an array.
- A legacy annotation becomes `name: <text without whitespace>`, as upstream.
- A catch type drops its package only when the package is a default import: `java.lang`, `java.util`, `java.io`, `java.net`, `groovy.lang`, `groovy.util`, or the classes `java.math.BigInteger` and `java.math.BigDecimal`. Upstream drops it always; dropping it only for those keeps the same class.
- Nothing is renamed through the class hierarchy. That is known difference `type-rename`.

### 4.6 Known differences (deviations from `lint -format`; each has a parsed fixture with `knownDifference`)

| Id | Upstream | Printer | Fixture |
|---|---|---|---|
| `type-rename` | renames resolved types (1.4.1): fails lint or changes meaning | type names as written (4.5) | `ast/expr-constructor.nf`, `input/known/type-names.nf` (also `int`, `Long`, `Double`, `ArrayList` annotations, `Long.MAX_VALUE`, casts and `instanceof`, in a script without the types flag) |
| `catch-package` | drops every package in `catch`: `AccessDeniedException` not defined | keeps it unless default-imported | `ast/stmt-try-catch.nf`, `input/known/catch.nf` (`java.io.IOException` stripped, so it agrees; `java.nio.file.AccessDeniedException` kept) |
| `call-wrap` | `f(1)(2)` gives `f(1).call(\n 2\n)`, not idempotent | `f(1).call(2)`; wraps only for a trailing comma, comments, or arguments that end on a later line than the callee | `ast/expr-call-value.nf` |

For a parsed fixture with a known difference:
- `formatted/` holds Nextflow's output and records the bug; the oracle notices if upstream fixes it;
- `printed/` holds ours, which must be a fixed point and lint-clean.
The rnaseq corpus file in 1.4.1 goes in `known-format-differences.json`.

### 4.7 Legacy constructs (open point 4)

Recommended: port the whole visitor, including legacy processes (`processV1`), legacy params (`paramV1`), legacy workflows (the same code as typed ones), agents, enums and code snippets. The statement and expression code is shared, and the extra visitors are about 60 lines. This lets F-102's 56-file tree (legacy files and a vendored nf-core module included) and the whole corpus (mostly legacy) serve as parity evidence. It also lets F-111 edit legacy workflows (LA-10).

If the maintainer-level call is "typed only":
- `printDeclaration` throws `PrintError("legacy process ...")` for `LegacyProcess` and `LegacyParam`;
- the legacy files in the trees are checked only by the oracle;
- the corpus test drops to rnaseq-nf-typed (7 files).

## 5. The oracle extension and the fixtures

### 5.1 Manifest `packages/lang-2610/test/printer/fixtures.json`

```json
{
  "about": "Printer fixtures (F-110, ADR 0005, LA-45). formatted*/ is what nextflow lint -format writes for input/ (regenerate with pnpm oracle --write-format; never edit). printed*/ is what the printer prints where it differs from formatted*/ (knownDifference) or has no input (synthesised, edited); Vitest writes it, the oracle checks it.",
  "upstream": { "tag": "v26.10.7", "commit": "0ad848ef3c3a22824cd9eb2ca14568385867702d", "formatter": "modules/nf-lang/src/main/java/nextflow/script/formatter" },
  "formattedWith": "nextflow lint -format -o json ., Nextflow 26.10.7, NXF_SYNTAX_PARSER=v2",
  "trees": [
    { "name": "printer", "input": "input", "formatted": "formatted", "printed": "printed" },
    { "name": "ast", "input": "../ast/fixtures", "formatted": "formatted-ast", "printed": "printed-ast" }
  ],
  "knownDifferences": { "type-rename": "...", "catch-package": "...", "call-wrap": "..." },
  "files": [
    { "tree": "printer", "path": "typed/process.nf", "kind": "parsed", "spec": ["LA-45"], "covers": ["Process (typed)", "comments"], "source": "docs/reference/syntax.mdx#L301-L360" },
    { "tree": "printer", "path": "la14/modules/local/fastqc_legacy/main.nf", "kind": "support" },
    { "tree": "printer", "path": "synth/create-process/main.nf", "kind": "synthesised", "spec": ["LA-12", "LA-50", "LA-45"] },
    { "tree": "ast", "path": "expr-constructor.nf", "kind": "parsed", "knownDifference": "type-rename" }
  ]
}
```

### 5.2 The `printer` tree (`input/`; each file lint-clean)

Each file has comments in leading, trailing and dangling positions and some untidy spacing, so formatting changes something. Start from the scratchpad drafts in section 10.

| Path | Covers |
|---|---|
| `typed/process.nf` | typed process:<br>- directives, including one with a list argument and one wrapped by a comment;<br>- `input:` with `TypedName`, `tuple(...)` and `record(...)` (with a trailing comma);<br>- `stage:`;<br>- `output:` with a typed named output and `stdout()`;<br>- `topic:`, `when:`, `script:` with a re-indented string, `stub:`;<br>- doc comment, dangling comment |
| `typed/process-exec.nf` | `exec:` section, record output, implicit `script:` label |
| `typed/workflow.nf` | named typed workflow (`take:`, `main:`, `emit:`); entry workflow with `publish:` (the typed target loses its type), `onComplete:`, `onError:` |
| `typed/workflow-main-only.nf` | entry workflow whose `main:` label is dropped |
| `typed/record.nf` | records with nullable and generic types; a one-line record (the blank-line quirk) |
| `typed/function.nf` | typed parameters with defaults, `-> T`, a legacy return type converted, closure parameters |
| `typed/params.nf` | params block with types, defaults and comments |
| `typed/output.nf` | output block with typed outputs, an `index { }` block and a list directive |
| `typed/include.nf` (+ `typed/lib/*.nf` support) | single include, several entries, an alias, a multi-line include, a double-quoted source |
| `typed/feature-flags.nf` | flags |
| `typed/expressions.nf` | wrapped chains (namespace receiver, comments between links), closures on one and several lines, trailing comma, named arguments reordered, wrapped ternary |
| `typed/blank-lines.nf` | several blank lines kept, comments separated by blank lines, a header comment |
| `la14/main.nf` (+ `la14/modules/local/fastqc_legacy/main.nf`) | LA-14: a typed workflow calls a legacy `tuple val(meta), path(reads)` process with `tuple(meta, reads)` |
| `known/type-names.nf`, `known/catch.nf` | known differences (4.6) |

Synthesised and edited files (`printed/` only; built in `synth.ts`):

| Path | Tree |
|---|---|
| `synth/create-process/modules/local/count_lines/main.nf` | CreateProcess shape: types flag, LA-50 doc comment, typed process (record input, typed output, script), record |
| `synth/create-process/main.nf` | **edited**: `input/synth-base/main.nf` parsed, plus a new `Include` after the existing ones and a new `COUNT_LINES(...)` call statement in `main:` |
| `synth/workflow/main.nf` | params block, named typed workflow, entry workflow, output block, two includes (fresh-layout rules) |
| `synth/la14/main.nf` | typed workflow calling the legacy support module with a synthesised `tuple(meta, reads)` |

### 5.3 The `ast` tree

F-102's `packages/lang-2610/test/ast/fixtures/` is reused by path: 56 `.nf` files, all listed in F-102's `fixtures.json` at the time of writing, all lint-clean, covering all 43 syntax-reference sections. They include `some/module.nf`, `pipelines/rnaseq.nf` and the vendored `modules/nf-core/fastqc/main.nf`. `include-registry.nf` needs that module at the project root, which is why trees are linted from their own root.

`lint -format` changes 39 of them (scratchpad `f110-astfx2/` is what `formatted-ast/` will hold). Three are known differences (4.6).

## 6. Tests (write before the implementation)

Test names cite IDs: `F-110 step 1 LA-45 ...`, `F-110 step 2 ...`, `F-110 LA-14 ...`.

### 6.1 Step 1: no difference under Nextflow's formatter

`packages/lang-2610/test/printer/fixtures.test.ts`: one `it` per manifest file.

| Test name | Asserts |
|---|---|
| `` `F-110 step 1 LA-45 ADR-0005: ${tree}/${path} prints as nextflow lint -format formats it` `` (parsed, no known difference) | `printScript(parseScriptAst(input).ast, { layout: createLayout(input) }).text` equals `formatted/<path>`. The parse has `errors: []` and `missingComments` is `[]` |
| `` `F-110 step 1 ADR-0005: ${tree}/${path} differs from lint -format only as ${knownDifference} says` `` | the printed text matches `printed/<path>` (`toMatchFileSnapshot`) and differs from `formatted/<path>` (a known difference that no longer differs must be removed) |
| `` `F-110 step 1 LA-45: ${tree}/${path} (synthesised or edited) prints printed/${path}` `` | `printScript(synth[path]())` matches the file snapshot; `missingComments` `[]` |
| `` `F-110 LA-45: printing ${tree}/${path} again changes nothing` `` | for each file X of the composed expected tree (`formatted/` overlaid with `printed/`): `print(parse(X), { layout }) === X` |
| `` `F-110 LA-45: ${tree}/${path} keeps every comment` `` | the sorted, normalised comment texts (`comment-texts.ts`, a port of `Comments.textsOf`) of the input and of the printed text are equal |
| `F-110 LA-45: printDeclaration prints each declaration of every expected file as printScript does` | for each declaration of each expected file, `printDeclaration(decl, { layout })` equals the slice of the expected file from the declaration's first leading comment to the end of its line |

`tools/oracle/test/format.test.ts` (fake `Exec` that writes chosen bytes into the run directory, as in `fixtures.test.ts`):

| Test name | Asserts |
|---|---|
| `F-110 step 1 ADR-0019: the oracle formats each printer tree's input and its composed expected tree and reports no difference` | Two `nextflow lint -format -o json .` calls per tree, in `<formatDir>/<tree>/input` and `/expected`. Matched when the formatted input equals `formatted/` and nothing in `expected/` changes |
| `F-110 step 1: a formatted input that differs from formatted/ is a mismatch naming the file and first differing line` | `matched: false`; the problem names the path and line; the log has a unified diff |
| `F-110 step 1: an expected file that Nextflow reformats is a fixed-point mismatch` | `summary.filesFormatted: 1` or changed bytes give `matched: false` |
| `F-110 step 2: an expected file with a lint error is a fixed-point mismatch` | `errors` non-empty or exit 1 gives `matched: false`, quoting the message |
| `F-110: a printer fixture input with lint errors is a format mismatch, and --write-format refuses to write` | exit 2 from `main(["--write-format"])` |
| `F-110: --write-format rewrites formatted/ from Nextflow's output` | files written; nothing else touched |
| `F-110: the format manifest loader reports every problem at once` | an unknown key, a missing tree directory, a parsed file without input, a `knownDifference` not in `knownDifferences`, a support file with `knownDifference` |
| `F-110 ADR-0019: pnpm oracle runs the printer trees by default and --case skips them` | `main([])` with fakes runs them; `main(["--case", id])` doesn't |

### 6.2 Step 2: printed fixtures pass lint

- The oracle's `fixed-point` check (6.1) requires `errors: []` and exit 0 on every expected file. The fake-exec test above proves a lint error fails it.
- `fixtures.test.ts`: `` `F-110 step 2: ${tree}/${path} as printed parses with no errors` ``: `parseScriptAst(printed).errors` is `[]` (the AST-level part, in `pnpm check`).

### 6.3 LA-14 and the F-005 note

`synthetic.test.ts`:

| Test name | Asserts |
|---|---|
| `F-110 LA-14: a tuple argument for a legacy input prints as tuple(...) with one argument per component, never a list literal` | a synthesised `MethodCall` `tuple` with 2 and 3 `Variable` components, as a call argument, prints `PROC(tuple(meta, reads))` and `tuple(a, b, c)`. With `trailingComma`, it wraps one component per line and stays a `tuple(` call. The output contains no `[` |
| `F-110 LA-14: the synthesised typed workflow calling a legacy module prints printed/synth/la14/main.nf` | covered by 6.1; the oracle lints it with the support module, with no errors and no change |

The parsed `la14/main.nf` fixture is formatted by Nextflow without a difference (6.1), and its lint has no errors.

### 6.4 Round trip and synthesised trees

`synthetic.test.ts` (helpers `synth.ts` and `structure.ts`). `structure(node)` drops ranges, `labelRange`, `elseRange` and comment slots. It also normalises the flags the printer derives: `parens` on calls, `braced` on interpolations, `trailingComma`, and `Closure.params` `[]` against `null`.

| Test name | Asserts |
|---|---|
| `` `F-110 LA-45: parse(print(t)) has the structure of t for ${name}` `` (every tree in `synth.ts`) | `structure(parseScriptAst(printScript(t).text).ast)` deep-equals `structure(t)`; the comment texts are equal and in order |
| `F-110 LA-45: parse(print(parse(x))) has the structure of parse(x) for every expected file` | over the composed expected trees |
| `F-110: a NO_RANGE tree gets the fresh layout` | no blank lines inside declarations; one blank line between top-level declarations except include runs and flag runs; nothing wraps without a trailing comma; a `NO_RANGE` triple-quoted string is not re-indented |
| `F-110: in an edited tree, positioned nodes keep their source blank lines and new nodes get none` | `synth/create-process/main.nf` around the inserted call |

### 6.5 Layout, types and errors

| File and test name | Asserts |
|---|---|
| `layout.test.ts`: `F-110 LA-45: createLayout counts blank lines as nf-lang's Comments does` | Unit cases: whitespace-only lines are blank. Lines inside a triple-quoted string or a block comment are content. CRLF counts one line. `startsLine` uses code-point columns (`𝐀` before a token). Line < 1 gives 0 |
| `types.test.ts`: `F-110 ADR-0005: type annotations print as written, Object becomes ? inside type arguments and is dropped as an annotation` | `Map<String,List<Integer>>` gives `Map<String, List<Integer>>`; `Integer?`; `java.nio.file.Path`; legacy `Map<String, Integer>` gives `Map<String,Integer>`; `String[]` is dropped |
| `types.test.ts`: `F-110: catch types drop only a default-imported package` | `java.io.IOException` gives `IOException`; `java.nio.file.AccessDeniedException` is kept |
| `types.test.ts`: `F-110 LA-02: the namespace receivers are the catalogue constants of a Namespace type` | `NAMESPACES` equals `catalogue/script.json` `constants` whose return type ends in `Namespace` (`channel`, `log`, `nextflow`, `workflow`) |
| `errors.test.ts`: `F-110: printing refuses error-only nodes and scripts that mix statements and declarations` | `PrintError` for `Import`, `IncompleteDeclaration`, `InvalidDeclaration` and `IncompleteExpression`, and for a mixed body |
| `errors.test.ts`: `F-110: a comment on a node the printer never prints is reported as missing` | a leading comment hand-attached to a process's name `Identifier` appears in `missingComments` (proves the check isn't vacuous) |
| `lang-core/test/printer.test.ts`: `F-110: NO_RANGE has no position` | `hasPosition(NO_RANGE)` is false; a parsed range is true |

### 6.6 Ported upstream tests (LA-45, ADR-0005)

`test/ported/formatter/formatter.test.ts`: 83 cases from `ScriptFormatterTest.groovy` at v26.10.7. These are the 80 non-Harshil `checkFormat` calls and the 3 direct `format` checks: L213 asserts `contains`, L522 is the sort default, and L1210 is the CRLF input. The 5 Harshil cases are recorded in `cases.json` as `excluded` with a reason (not a `lint -format` default, open point 5).

| Test name | Asserts |
|---|---|
| `` `F-110 LA-45 ADR-0005: nf-lang ScriptFormatterTest "${test}" (L${line}) formats as upstream` `` | `print(parse(in)) === out` and `print(parse(out)) === out` |
| `F-110: the ported formatter cases cite the pinned test file and cover every non-Harshil case` | the count and line references match the upstream file at the pinned commit |

These inputs fall under AGENTS.md's existing exception for `packages/lang-*/test/ported/`: kept as nf-lang wrote them, checked for consistency, not re-run. Some don't pass lint (undefined variables); upstream's test only runs the resolver.

### 6.7 Corpus (`pnpm test:corpus`, CI `corpus-parse`; open point 8)

`packages/lang-2610/test/corpus/print.corpus.ts`, the same harness as `parse.corpus.ts`:

| Test name | Asserts |
|---|---|
| `F-110 LA-45 ADR-0005: every corpus script nextflow lint formats prints as it formats it` | For each corpus `.nf` file without lint errors: `printScript(parse(orig), { layout })` equals `.cache/corpus-format/<id>/<path>`. A file may differ only if it is listed in `known-format-differences.json` with a known-difference id and a cause (initially rnaseq `subworkflows/local/multiqc_rnaseq/main.nf`, `type-rename`). Listed files that no longer differ fail |
| `F-110 LA-45: printing every formatted corpus script again changes nothing` | `print(parse(formatted)) === formatted`, except listed files |
| report | appends counts (files, equal, listed) and print time to `.cache/reports/parse-corpus.md` |

### Not needed

Playwright: there is no UI. Q13 applies; the evidence is the unit tests plus the CI `oracle` and `corpus-parse` runs (named in the notes).

## 7. Tasks (in order; one builder run each)

Branch `feat/F-110` from `main` after F-102 has merged. Run `pnpm install` if `node_modules` is stale. Each task writes its tests first, sees them fail, implements, then runs the proof. Commit scopes: `feat(lang-core)`, `feat(lang-2610)`, `feat(oracle)`, `feat(corpus)`, `test(lang-2610)`. Local Nextflow runs need Java 21 and `.cache/nextflow` (AGENTS.md); `pnpm nextflow -- -version` fetches the pinned dist.

**Task 1: lang-core printer types and `NO_RANGE`.**
- Files: `packages/lang-core/src/printer.ts`, `src/ast/range.ts`, `src/index.ts`, `test/printer.test.ts`, `README.md` (one line).
- Done when:
```
pnpm --filter @nf-builder/lang-core test
pnpm check
```

**Task 2: oracle format trees.**
- Files: `tools/oracle/src/{format,check,paths,cli,report}.ts`, `tools/oracle/test/format.test.ts`, `tools/oracle/README.md`.
- Also add `packages/lang-2610/test/printer/fixtures.json` with the `ast` tree and an empty `printer` tree (`input/` holding only `typed/feature-flags.nf`). Generate `formatted*/` with `pnpm oracle --write-format`, and add the `.gitattributes` lines.
- Done when:
```
pnpm --filter @nf-builder/oracle test
pnpm oracle --write-format && git status --short packages/lang-2610/test/printer   # formatted-ast/ and formatted/ written
pnpm oracle            # exit 0: format checks matched. fixed-point also matches, since printed*/ is still empty
pnpm check
```

**Task 3: layout, comments, types, and the expression and statement formatter (code snippets and functions).**
- Files: `src/printer/{layout,comments,types,positions,formatter}.ts`, and `src/printer/index.ts` with `printScript` for code snippets and `FunctionDef` only (other declarations throw `PrintError("not ported yet")` until task 4).
- Tests:
  - `layout.test.ts` and `types.test.ts`;
  - `fixtures.test.ts`, run over the `ast` files that are code snippets or functions (`stmt-*`, `expr-*`, `comments.nf`, `shebang.nf`, `function.nf`), with an explicit list in the test until task 4;
  - the ported STATEMENTS, EXPRESSIONS and COMMENTS cases (`transcribe.py` writes all 83; filter to those sections for now).
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/printer test/ported/formatter
pnpm check
```

**Task 4: declarations, `printDeclaration` and the missing-comment check.**
- Files: `src/printer/script-formatter.ts`, `index.ts`.
- Covers every visitor in 3.2, `PrintError` and `missingComments`.
- Tests:
  - write `input/typed/*`, `input/la14/*` and `input/known/*` (5.2);
  - regenerate `formatted/` with `pnpm oracle --write-format`;
  - `fixtures.test.ts` over every parsed file, with the explicit list removed;
  - `printed*/` snapshots for the 3 known differences (review each by eye against 4.6);
  - all 83 ported cases, `errors.test.ts`, `manifest.test.ts`.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/printer test/ported/formatter
pnpm oracle            # exit 0; report lists printer:printer and printer:ast format and fixed-point rows as matched
pnpm check
```

**Task 5: synthesised and edited trees, fresh layout, round trip, LA-14.**
- Files: `test/printer/{synth,structure,comment-texts}.ts`, `synthetic.test.ts`, `input/synth-base/main.nf`, the four `printed/synth/**` snapshots, and their manifest entries. The fresh-layout rule goes in `script-formatter.ts`.
- Done when:
```
pnpm --filter @nf-builder/lang-2610 exec vitest run test/printer
pnpm oracle            # fixed-point rows include synth/*: no change, no lint error
pnpm check
```

**Task 6: corpus parity** (if open point 8 is accepted).
- Files: `tools/corpus/src/{lint,lint-cli}.ts`, `tools/corpus/test/format.test.ts`, `packages/lang-2610/test/corpus/{print.corpus.ts,known-format-differences.json}`.
- A difference that isn't an upstream bug is a port bug: fix it in the printer, or in F-102's attacher if a comment slot differs (with a unit test). Don't list it.
- Done when:
```
pnpm --filter @nf-builder/corpus test
pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus   # Java 21 and .cache/nextflow; else CI corpus-parse
pnpm check
```

**Task 7: records (orchestrator, not the builder).**
- The ADR for open points 1 to 3 (and 4 and 5 as decided). List it in `docs/adr/README.md`.
- `AGENTS.md`:
  - `pnpm oracle` row: add "and `nextflow lint -format` on the printer fixtures (`packages/lang-2610/test/printer/fixtures.json`); `--write-format` regenerates their `formatted*/` goldens";
  - "Generated files": `packages/lang-*/test/printer/formatted*/**`, regenerated with `pnpm oracle --write-format`;
  - "Nextflow knowledge": printer fixtures must be lint-clean, their printed form must be a fixed point, and the ported exception also covers formatter outputs.
- `docs/licences.md` rows: the ported `Formatter`, `ScriptFormattingVisitor`, and parts of `Types` and `Comments` (Apache-2.0); the ported `ScriptFormatterTest` cases (Apache-2.0, test data).
- `features.json` notes, `progress.md` and the PR from the template.
- Done when `pnpm check` passes, CI `oracle` and `corpus-parse` are green, and the Scope guard passes without `scope-change` (only `passes` and `notes` change).

## 8. Open points (decide and record; each with a recommendation)

1. **Upstream formatter bugs against ADR 0005** ("emits what `nextflow lint -format` would"; ADR 0005 is maintainer-Accepted, so its body can't change).
   - **Recommendation:** a new ADR, `Accepted (agent)`, that refines ADR 0005's formatting bullet. The printer equals `lint -format` except where `lint -format` produces code that fails lint, isn't a fixed point, or changes what the code does. Those are `type-rename`, `catch-package` and `call-wrap` (1.4, 4.6), each pinned by a fixture whose `formatted/` records upstream's output. ADR 0005's goal ("never churns under the official formatter") still holds for everything the app writes, because app-made code uses canonical type names.
   - Optionally report the bugs upstream (needs GitHub access to nextflow-io/nextflow: maintainer or a `maintainer` issue).
   - Alternative: full parity, porting `Types.normalize` with a class-hierarchy table. Then an edit to one statement could silently turn `Long.MAX_VALUE` into `Integer.MAX_VALUE` elsewhere in the declaration, and two F-102 fixtures would fail F-110 step 2.
2. **`NO_RANGE` for nodes an edit creates** (amends ADR 0027, "every node has a range that slices back").
   - **Recommendation:** in the same ADR. Nodes created by edit commands carry `NO_RANGE` until the file is re-parsed. This mirrors upstream's line -1 and needs no registry that structured cloning would lose. The AST stays in-memory only (not a stored format).
3. **Fresh layout for synthesised declarations** (behaviour upstream doesn't define).
   - **Recommendation:** 4.3's rule: one blank line between top-level declarations except include runs and flag runs; none elsewhere. Record it in the same ADR; the oracle proves each synthesised fixture is a fixed point.
   - Alternative: no blank lines at all (upstream's literal behaviour). F-111 would then have to splice blank lines itself.
4. **Legacy declarations.** F-110 lists only typed ones.
   - **Recommendation:** port the whole visitor (4.7). Reasons: small cost; F-102's fixture tree and the corpus become parity evidence; LA-10 and F-111 edit legacy workflows.
   - Alternative: `PrintError` for `LegacyProcess` and `LegacyParam`.
   - Not a scope change: the feature gains coverage, and no step is weakened.
5. **Formatting options.**
   - **Recommendation:** defaults only (4 spaces, no tabs, no Harshil alignment, no sorting), because LA-45 means `nextflow lint -format` with no flags. Don't port `CommentAligner` or `maheshForm`. Record it in Decisions; revisit if a user setting is ever specified.
6. **Pack API and lazy loading.**
   - **Recommendation:** F-110 adds the `ScriptPrinter` interface (lang-core) and the implementation (`src/printer/`) but nothing on the pack entry, as F-102 did for the parser. F-104, the first engine consumer of the parser, adds a lazy loader. Prefer one dynamic import (for example `LanguagePack.loadScriptTools(): Promise<{ parseScript; printer: ScriptPrinter }>`), since `createLayout` shares the generated lexer; F-111 uses it. The QA-01 budget is unaffected (nothing imports the printer yet). Record it in Decisions and the F-104 and F-111 notes.
   - Alternative: add `loadPrinter()` now, with a bundle test that it stays a separate chunk.
7. **Oracle extension shape** (ADR 0019 already foresees "`lint -format` diffs").
   - **Recommendation:**
     - committed goldens (`formatted*/` from Nextflow, `printed*/` from the printer), because `tools/oracle` may not import the pack (`tools-standalone` rule);
     - two checks per tree (`format`, `fixed-point`), run by default in `pnpm oracle`;
     - `--write-format` to regenerate.
   - No workflow edit and no new script. AGENTS.md wording as in task 7. No ADR beyond a line in Decisions; it is within ADR 0019's decision.
8. **Corpus parity in `corpus-parse`.**
   - **Recommendation:** yes (task 6). It costs about 35 s of CI, needs no workflow edit (it is inside `pnpm corpus:lint`), and checks 342 real scripts and about 3,900 comments. That is the strongest evidence that the port, and F-102's attacher, match upstream.
   - Alternative: fixtures and ported cases only.
9. **Reuse F-102's fixture tree by path** rather than copying it.
   - **Recommendation:** reuse. A change to an F-102 fixture then fails F-110's golden test until `pnpm oracle --write-format` is re-run, which is the intended coupling.
10. **Statement-level printing for F-111** (for example `printStatement(stmt, { indent, layout })` for AddCall).
    - **Recommendation:** not in F-110. `printDeclaration` reprints a whole edited declaration, which normalises more than whitespace inside it: `println 'x'` becomes `println('x')` and `return` becomes `return null`. AR-22 allows that for targeted declarations, but users may prefer statement-level patches. Add a note on F-111 so it decides.
11. **fast-check.**
    - **Recommendation:** none in F-110; the deterministic synthesised trees cover the round trip. F-111 adds fast-check for its property tests (ADR 0011). No new dependency here.
12. **Spec gaps to record** (no behaviour change):
    - LA-45 doesn't say which code is formatted (new or edited declarations and new files, per F-104 and F-111);
    - F-110's list of declarations omits feature flags (needed for CreateProcess), enums, agents and code snippets; the plan prints them all;
    - "printer fixture" is undefined; the manifest defines it.
    Add a sentence to LA-45 ("...for new and edited declarations; untouched declarations keep their source text (F-104)")? Optional; a user-visible clarification, recorded in Decisions.

## 9. Records to write when F-110 lands (drafts for the orchestrator)

**`features.json` notes:**
- F-110: "Verified <date>.
  - Step 1: CI `oracle` `format` and `fixed-point` rows over `packages/lang-2610/test/printer/fixtures.json` (the printer tree plus F-102's 56-file AST tree). `test/printer/fixtures.test.ts` proves the printer reproduces Nextflow's goldens byte for byte, and the 83 ported `ScriptFormatterTest` cases pass.
  - Step 2: the same `fixed-point` run reports no lint errors on every printed file.
  - LA-14: `la14/` and `synth/la14/` fixtures.
  - Known differences (ADR 00xx): `type-rename`, `catch-package`, `call-wrap`.
  - Corpus: `print.corpus.ts` in CI `corpus-parse`.
  - No Playwright test (Q13)."
- F-104 / F-111: "From F-110: `printScript`, `printDeclaration` and `createLayout` live in `packages/lang-2610/src/printer/` (not on the pack entry). Wire one lazy loader with the parser. Nodes an edit creates carry `NO_RANGE`; synthesised triple-quoted strings carry their final indentation, and `StringLiteral.text` must be set. Never write a print whose `missingComments` is non-empty. `printDeclaration` reprints and normalises the whole declaration; decide whether AddCall needs statement-level printing."

**`progress.md` Decisions:** open points 1 to 9 as settled. No new dependency, no workflow edit, no new script. The AST is still not a stored format.

## 10. How the evidence was produced (to repeat it)

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/5a04e27b-26df-5c7b-af9e-9c0f6a532353/scratchpad/`. A cleanup may clear it.

- **Upstream sources:**
  - `f102-upstream/nf/` (sparse clone at v26.10.7: `formatter/`, `ast/`, `parser/`, formatter tests);
  - `f110-up/` (`Types.java`, `ScriptNode.java`, `Comment.java`, `ASTUtils.java`, `ASTNodeMarker.java` from raw.githubusercontent.com at 0ad848ef);
  - `f110-up/cls/` (`CmdLint*.class` extracted from the dist; `javap -c -p` shows the defaults and the in-place write).
- **Lint and format runs:** `cd <dir> && NXF_HOME=/home/user/nf-builder/.cache/nextflow/home NXF_OFFLINE=true NXF_SYNTAX_PARSER=v2 NXF_DISABLE_CHECK_LATEST=true NXF_ANSI_LOG=false unshare -rn /home/user/nf-builder/.cache/nextflow/nextflow-26.10.7-dist lint -format -o json .`
  - `f110-lint/in/` to `run1/` and `run2/`: typed process, workflow, params, output, record and function drafts, with the record blank-line quirk; the second run changed nothing;
  - `f110-lint/t2-in/` to `t2/`: expression and type normalisations; `t3/`: type renames (lint errors after formatting); `t5/`: wrap and re-indent; `t6/`: `return null`, ranges, enum; `t7/`: class-receiver renames; `t8/`: `nextflow run` showing annotations coerce at runtime; `t9/`: namespace receivers;
  - `f110-lint/t4-in/` to `t4/`: CreateProcess shape module, legacy tuple module, LA-14 typed workflow with CRLF, tabs and comments. All lint-clean; the modules are already fixed points. These are starting drafts for `input/typed/` and `input/la14/`.
  - `f110-astfx-orig/` to `f110-astfx2/` to `f110-astfx3/`: F-102's fixtures formatted once (39 changed, 0 errors), then twice (only `expr-call-value.nf` changed; `expr-constructor.nf` and `stmt-try-catch.nf` then fail lint).
  - `f110-corpus-orig/` to `f110-corpus/` to `f110-corpus2/`: the corpus formatted once (about 33 s; rnaseq's `multiqc_rnaseq/main.nf` then fails lint), then twice (no script changed; 3 rnaseq configs did).
