# Plan: F-111, core edit commands with property tests

Planner output, 2026-11-22. I changed nothing in the repo or any worktree. The plan is based on `main` at `cbb24e2`, where F-102, F-103, F-104 and F-110 are merged. F-105 and F-106 are planned but not built (`docs/plan/handoff/plan-F-105.md`, `plan-F-106.md`), and section 1.4 lists every name from them that this plan uses. I checked the Nextflow facts against the pinned 26.10.7 (`/home/user/wt-F-105/.cache/nextflow/26.10.7/nextflow-26.10.7-dist`, `NXF_OFFLINE=true`, a scratch `NXF_HOME`). Section 8 has the probes.

## 0. Scope

F-111 adds:
- **The command union** (AR-20). Seven of AR-21's commands, as plain data in lang-core: CreateProcess, AddCall, Connect, Disconnect, DeleteNode, RenameDeclaration and ReplaceFileText.
- **A pure `applyCommand`** in the engine. It returns text patches plus their inverse, and the inverse restores exact bytes (AR-23).
- **Two guards on every result:**
  - a result with a new parse problem is refused before anything is written (AR-24);
  - a result that would mix typed and legacy definitions in one script is refused with an explanation (LA-13).
- **Property tests with fast-check** on fixture trees (in `pnpm check`) and on the corpus (in `pnpm test:corpus`, CI job `corpus-parse`).
- **Oracle cases** that lint and stub-run the template and real command outputs (CI job `oracle`).

How each step is checked:
- **Step 1:** `test/edit/properties.test.ts` and `test/corpus/edit.corpus.ts`.
- **Step 2:** `create-process.test.ts`, plus the oracle cases `f111-edits-typed` and `f111-edits-legacy`.
- **Step 3:** `guards.test.ts`, the LA-13 property, and oracle case `f111-mixed-after-flag`.

There is no UI, so there is no Playwright test (Q13).

**Out of scope:**
- the other AR-21 commands;
- an undo or redo stack (F-209);
- grouping several commands into one undo step (F-301 and F-310);
- layout-key carry-over (F-207);
- type checks on connections (F-302 and F-112);
- the worker (F-113).

## 1. Findings

### 1.1 Spec and ADRs

- **AR-20:** the commands are a discriminated union in lang-core, with a pure `apply(model) → TextPatch[]` in the engine built on the pack's printer.
- **AR-23:** each command is one undo step, and undo restores exact bytes. ADR 0004 says the same thing ("restores the previous file snapshot").
- **AR-22:**
  - declarations a command doesn't target stay equivalent, except for added includes and new files;
  - whitespace next to the edit may change;
  - this must be a property test (ADR 0011: "each result must parse, untargeted declarations stay equivalent, undo restores the snapshot").
- **LA-45 and ADR 0032:** "new and edited declarations are formatted; declarations an edit didn't touch are printed from their source text". So reprinting a whole targeted declaration is within the spec. Statement-level printing is not required. This answers F-110's note.
- **AR-24:** a command whose code would fail to parse is rejected before it touches a file. UX-44 and F-208 agree: an invalid Code-tab edit is not applied.
- **LA-12:** a new process goes in its own file with `nextflow.enable.types = true`, at `modules/local/<name>/main.nf`, and the app adds the include. LA-13: the app never mixes typed and legacy definitions in one script, and refuses with an explanation. LA-14: calls across styles are fine.
- **UX-25:** connecting "creates or rewrites the call's argument". F-302 adds "delete an edge: the call argument is removed and the code still parses".
- **LA-02:** version-specific text, such as the types flag and the template, lives in the pack.

### 1.2 Nextflow 26.10.7 facts (pinned lint and run; probes in section 8)

| Probe | Result |
|---|---|
| A legacy process, then `nextflow.enable.types = true`, then a typed process, in one script | `lint`: 0 errors. `run -stub`: both processes run. **The typed/legacy split depends on position, and lint does not enforce LA-13.** LA-13 needs its own check, and its "because Nextflow forbids it" is only true of the docs (`static-typing.mdx` L50). |
| Mixing after the flag, or a typed process without the flag | Builder errors. The existing cases `s1-mixed-types-on`/`off` and the fixtures `typed-legacy-mixed.nf`/`typed-without-flag.nf` cover these. Our builder raises them at `process.ts` L155, L227/L247, L229/L353 and `workflow.ts` L42, L77. |
| Legacy outputs inside a typed process | Not a builder error. Lint gives a type-check error ("Every output must be assigned…"). |
| `hello = HELLO()` in typed code, where HELLO has no outputs | Lint error: "Cannot assign the result of a call that does not return a value". |
| `ALIGN()`, `ALIGN(reads)` or `ALIGN(a, b, 3)` against two inputs | Parses. Lint error: "Process `ALIGN` expects 2 argument(s) but received N". |
| `ALIGN(null, file('idx'))` | Lint-clean. |
| `v = PROC(...)` then `v.name` or `v.view()`, in typed and in legacy workflows | Lint-clean and runs (`-stub`). |
| Template (section 2.5) plus `include { HELLO } from './modules/local/hello/main.nf'` and a bare call, from a typed and from a legacy script | Lint-clean, runs under `-stub`, and the template is a `lint -format` fixed point. |
| Start and end trees for the oracle goldens (section 8) | 0 errors (only "variable declared but not used" warnings); `run -stub` succeeds. |

### 1.3 Code facts (checked against `main` with Node scripts in the scratchpad)

- **Item ranges** exclude the item's leading comments (its doc comment) and its trailing comment. `printDeclaration` prints both and ends with `"\n"`. So the splice span runs from the first leading comment's start to the trailing comment's end, and the printed text goes in without its final newline.
- **A reprint normalises the whole declaration.** For example, `println 'x'` becomes `println('x')`. The fields the printer derives are listed in `lang-2610/test/printer/structure.ts`: `parens`, `braced`, `trailingComma`, empty closure params, the `main` label and the publish type.
- **`createLayout(text)` lexes the whole file and throws on lexer errors.** Instead, a layout built from the text with everything outside the span blanked (newlines kept) works. I checked it on a partial file: the edited workflow printed correctly, and the file stayed `partial` with the same problems.
- **Replacing or wrapping a node silently drops the comments attached to the old node.** `missingComments` only covers the new tree. Wrappers must copy the comment slots, and a guard must compare comments.
- **Synthesised nodes:**
  - a synthesised `Include` prints as `include { X } from '…'\n` (`StringLiteral.text` must be set);
  - positioned children inside `NO_RANGE` parents keep their layout. Wrapping a multi-line chain in a new `Assignment` keeps its wrapping and blank lines.
- **`printScript(parse(t))` without a layout** drops blank lines between positioned declarations. With `createLayout(t)` the template prints back unchanged.
- **`diffAst` in `engine/src/source/equivalent.ts` is not exported.**
- `shiftPositions` copies problems with `Object.assign`, so a new `ParseProblem` field survives F-104's chunk path.

### 1.4 Unbuilt names this plan relies on

| From | Name | Used for |
|---|---|---|
| F-105 | `openProject(version, files, options?)`, `ProjectFile` | building `EditState`; tests |
| F-105 | `ProjectModel.file(path)`, `paths()`, `lookup(path, name)`, `dependants(path)`, `setFile(path, text)`, `deleteFile(path)` | current texts and ASTs; callee scope; rename fan-out; `commit` |
| F-105 | `FileModel { path, source, declarations, includes }`, `ScriptIncludeModel { node, target, entries }`, `ResolvedEntry { entry, declaration, pipeline }`, `Binding`, `IncludableDeclaration`, `IncludeTarget.path`/`kind` | callee and rename resolution |
| F-105 | test helper `packages/engine/test/model/read-tree.ts` | loading trees |
| F-106 | lang-core `Projection`, `GraphNode` (`id, kind, label, inputs, outputs, range`), `CallNode.callee`, `ChainNode.steps`, `Port { id, label, argument: Range \| null }`, `PortRef { node, port }`, `GraphEdge { from, to, direct }` | locating what to edit |
| F-106 | engine `createProjector(model, catalogue)`, `Projector.project(path, workflow)`, `workflows()`, `parseNodeKey(id)` | resolving ids; candidates for property tests |
| F-106 | test helpers `test/projection/open.ts`, fixture tree `test/projection/fixtures/` | property trees |

F-106 behaviour this plan assumes (check when it lands; adjust F-106 if needed):
- `Port.argument` is set for every input port fed by an argument expression, whether through an edge or inline;
- a node's `range` lies inside its top-level `main` statement and equals or encloses its call expression;
- call input ports follow the callee's declaration order, matching positional `args`;
- chain port `<step>:<arg>` indexes `MethodCall.args` from 1;
- the keys of assigned nodes parse to `{kind: "assigned", variable}`;
- code-node outputs are named after the variables they assign.

Not relied on: `ChainStep.range`, F-107 and F-108. Legacy forms stay code nodes until those land, and edits still work on the nodes F-106 projects.

## 2. Design

### 2.1 Where things live

| Piece | Package |
|---|---|
| `EditCommand` union, `TextPatch`, `CommandResult`, `Scaffold`; `LanguagePack.scaffold`; `ParseProblem.code?` | lang-core |
| The new-process template (`scaffold.ts`, on the pack entry, a tiny pure function); the `code: "mixed-definitions"` tag at the five builder sites | lang-2610 |
| Patches, inverse, splicing, guards, commands, `applyCommand` (version-independent) | engine `src/edit/` |

### 2.2 Command model (AR-20, AR-23)

**Commands are plain, clone-safe data.** Workflow edits name projection ids (node and port) and are resolved against the current model.

**`applyCommand(state, command)` is pure.** It:
1. builds `TextPatch[]` from the current texts;
2. applies them in memory (`applyPatches`), which also gives the inverse;
3. re-parses each changed Nextflow or config file (`createSourceFile`) and runs the guards;
4. returns `{ok: true, patches, inverse, files}` or `{ok: false, code, message, path, problems}`.

It never mutates the model and never throws: a caught exception becomes a refusal with code `internal`.

**Patches:**
- `edit` holds sorted, non-overlapping edits against one file;
- `create` adds a file and `delete` removes one;
- a list holds at most one patch per path.

**Inverses:** an edit's inverse puts back the original slices at their new offsets; the inverse of `create` is `delete` and vice versa. Undo applies the inverse. A sequence of commands undoes by applying their inverses in reverse order.

**`commit(state, result)`** writes `files` into the model through F-105's `setFile` and `deleteFile`; re-modelling is F-105's.

### 2.3 How edits reach the text (AR-22; the open question from F-110 and F-104)

| Command | Text change |
|---|---|
| AddCall, Connect, Disconnect, DeleteNode | AST transform of the one target `WorkflowDef`, then `printDeclaration(updated, {layout: createLayout(masked text)})`, spliced over the item's span |
| CreateProcess | a new file from `pack.scaffold.process(name)`, plus an include inserted between items |
| RenameDeclaration | identifier-range edits only |
| ReplaceFileText | one edit trimmed to the changed text (common prefix and suffix, backed off to code-point boundaries) |

- **No statement-level printer.** AR-22 only requires untouched declarations to stay equivalent, and LA-45 and ADR 0032 say edited declarations are formatted.
- **Comment guard:** every comment attached in the original declaration must appear in the updated tree, unless it sits inside a node the command removes deliberately. Otherwise the command is refused (`internal`).
- **The printer's own check:** a non-empty `missingComments` is also refused.
- **Line endings:** printed text uses CRLF when the file's first line break is CRLF.
- **Include placement**, following ADR 0032's fresh layout:
  - after the last `Include` item, as `"\n" + include`;
  - else after the last `FeatureFlag`, as `"\n\n" + include`;
  - else before the first item's leading comments, as `include + "\n"` (so a doc comment stays with its declaration);
  - else appended at the end of the file.

### 2.4 Guards (run on every result)

**AR-24, no new problems:**
- a file's problems are the multiset of `source + message` over `file.problems` and every `Unparsed.problems`;
- a result is refused (`does-not-parse`) if any changed Nextflow or config file has a key the original didn't, or a new file has any problem;
- problems the file already had don't block an edit elsewhere in it, so partial imports stay editable (ADR 0004) and ReplaceFileText can repair a broken file.

If the properties show whole-file messages moving under edits outside the broken item, compare only `Unparsed.problems` and `scope: "file"` problems, and record that.

**LA-13, no new mixing.** For each changed script:
- `mixed(ast)` is true when the AST has `Process`/`Workflow` definitions with both `typed: true` and `typed: false`, or a problem with `code === "mixed-definitions"`;
- a result is refused (`mixed-definitions`) when it is mixed and the original wasn't, so imported files that are already mixed stay editable.

The message, in British English, gives no spec IDs or version literals: "This edit would put typed and legacy process or workflow definitions in `<path>` (typed: A; legacy: B). A script can't mix them: keep legacy definitions in their own file, or migrate them to typed." Any nf-lang messages are appended.

Among the F-111 commands, only ReplaceFileText can mix. The guard is generic, so later commands such as UpdateDeclaration and InsertRegistryModule get it for free.

### 2.5 Commands

All the "refuse" outcomes below return a short message saying what to do.

**CreateProcess `{name, caller}`**
- Refused when:
  - `name` doesn't match `^[A-Za-z_][A-Za-z0-9_]*$`;
  - `caller` isn't a modelled or partial script;
  - `modules/local/<lower(name)>/main.nf` already exists;
  - `lookup(caller, name)` is already defined.
- Creates the file with this template (verified in section 1.2; the pack owns the text):

```nextflow
nextflow.enable.types = true

process NAME {
    script:
    """
    echo 'NAME'
    """
}
```

- Adds `include { NAME } from '<rel>/modules/local/<lower>/main.nf'` to `caller`. `<rel>` is `.` or a run of `..` segments relative to the caller's directory.
- It doesn't add a call; F-301 composes CreateProcess with AddCall.

**AddCall `{target, callee}`**
- `callee` must bind in the file's scope (`lookup`) to one of:
  - a process, named workflow or agent;
  - an `Unparsed` with one of those heads;
  - a non-plugin, non-pipeline include entry, which may be unresolved.
- A workflow can't call itself.
- Appends a bare `CALLEE()` to `main`, creating the section if it is null.
- It never assigns, because assigning an output-less call is a lint error; Connect introduces variables.

**Connect `{target, from, to}`**, with both ports in the same workflow:
1. **Reference to the source:**
   - a take gives `name`; a params port `p` gives `params.p`;
   - an assigned node gives `v`, or `v.<port>` when it has more than one output;
   - a code-node output `v` gives `v`;
   - an unassigned top-level node gets a variable: the statement `E` becomes `x = E` (an `Assignment`, keeping the statement's comment slots);
   - a nested source, or `from.node === to.node`, is refused.
2. **Order:**
   - source after target: move the source statement to just before the target statement, if no `Variable` name in the source statement is assigned in `[target, source)` and no name the source assigns appears in that range; otherwise refuse as a cycle;
   - source before target: refuse when a statement in between reassigns the referenced variable.
3. **Target:**
   - an emit node, or a port of `:output`, sets the `NamedOutput.value` with that name;
   - a port with an `argument` replaces that expression node, found by exact range;
   - otherwise, input `i` of a call pads `args` with `null` up to `i` and appends;
   - anything else is refused.

**Disconnect `{target, port}`**
- The port's argument must be a positional argument of a call or chain step, or a `NamedArgument` value:
  - a named argument is removed;
  - the last positional argument is removed;
  - an earlier one becomes `null`.
- Refused for a chain's receiver (`in`), for emit and publish values, and for a port with no argument.

**DeleteNode `{target, node}`**
- **Top-level call, chain, factory or code node:** removes its statement. It also clears, as Disconnect does, every direct edge from the node into a call or chain argument in the same workflow. Indirect reads stay, and F-112 reports them.
- **Nested node:** clears the argument it is.
- **Take, emit, params and output nodes:** refused (F-305 and F-307).

**RenameDeclaration `{path, name, newName}`**
- Applies to a modelled process, named workflow, function, record, enum or agent.
- `newName` must be a valid identifier and must not clash:
  - with the declaring file's declarations;
  - with names bound in any file that will bind it without an alias.
- Edits:
  - the declaration's name;
  - in `path` and in each `dependants(path)` file that binds the name without an alias: calls (`MethodCall` with no receiver), `Variable` and the first `name.length` units of a `TypeRef`;
  - include entries whose target is `path`; an aliased entry keeps its alias and its call sites.
- Not changed:
  - shadowing (ignored);
  - `Unparsed` text;
  - config `withName` selectors;
  - module directories.

**ReplaceFileText `{path, text}`**
- The path must exist.
- One trimmed edit; plain files skip the parse guard.

### 2.6 What later features need from this API (not planned here)

| Feature | Need |
|---|---|
| F-113 | `applyCommand` is synchronous and pure. Its cost is one projection, one reprint and one parse per changed file. `commit` re-parses through F-105, so if QA-04 needs it, add a way to reuse the checked `SourceFile`. Run commands one at a time, and drop a command built on an older projection, since ids can be stale. |
| F-209 | Keep `inverse` lists. Redo is the original `patches`. |
| F-301, F-310 | Group several commands as one undo step: commit each one, then concatenate the inverses in reverse. |
| F-302 | A refused Connect can serve as the "invalid target" dry run. Type checks and LA-14 arity are F-112's. |
| F-207 | Ids can change after variable introduction, a statement move or a rename. Diff the projections to carry layout keys (ADR 0008). |
| F-208 | Show a ReplaceFileText refusal's `problems` as diagnostics. |
| F-210 | There is no create, delete or rename file command yet. |
| F-307, F-305 | Takes, emits, params and outputs. |
| F-112 | `code: "mixed-definitions"`. A literal `null` argument is the placeholder for an unconnected input (LA-33). |

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/edit.ts` | `WorkflowTarget { path; workflow: string \| null }`; `CreateProcess { kind; name; caller }`, `AddCall { kind; target; callee }`, `Connect { kind; target; from: PortRef; to: PortRef }`, `Disconnect { kind; target; port: PortRef }`, `DeleteNode { kind; target; node: string }`, `RenameDeclaration { kind; path; name; newName }`, `ReplaceFileText { kind; path; text }`; `type EditCommand`; `EDIT_COMMAND_KINDS`; `TextEdit { start; end; text }`; `type TextPatch = {kind:"edit"; path; edits: readonly TextEdit[]} \| {kind:"create"; path; text} \| {kind:"delete"; path}`; `FileText { path; text: string \| null }`; `type RefusalCode = "not-found" \| "invalid" \| "does-not-parse" \| "mixed-definitions" \| "internal"`; `type CommandResult = {ok: true; patches; inverse; files: readonly FileText[]} \| {ok: false; code; message; path: string \| null; problems: readonly ParseProblem[]}`; `interface Scaffold { process(name: string): string }`. All fields are readonly. |
| `packages/lang-2610/src/scaffold.ts` | `scaffold: Scaffold`, with a header citing `process-typed.mdx` and the oracle case |
| `packages/engine/src/edit/patches.ts` | `class PatchError extends Error`; `applyPatches(files: ReadonlyMap<string,string>, patches: readonly TextPatch[]): { files: Map<string,string>; inverse: TextPatch[] }`; `diffText(before: string, after: string): TextEdit \| null` |
| `packages/engine/src/edit/refusal.ts` | `class EditRefusal extends Error { code: RefusalCode; path: string \| null; problems: readonly ParseProblem[] }` |
| `packages/engine/src/edit/nodes.ts` | `variable`, `property(object, name)`, `nullLiteral`, `stringLiteral(value)`, `call(name, args)`, `assignment(name, value, slotsFrom?)`, `expressionStatement`, `includeOf(name, source)` (all `NO_RANGE`); `replaceNode<T>(root: T, target: AstNode, replacement: AstNode \| null): T` (structural sharing; `null` removes from arrays); `findByRange(root: AstNode, range: Range): AstNode \| null` (outermost expression); `attachedComments(node): Comment[]` |
| `packages/engine/src/edit/splice.ts` | `itemSpan(item: ScriptItem): {start: number; end: number}`; `reprintDeclaration(file: ScriptSourceFile, original: Declaration, updated: Declaration, printer: ScriptPrinter, removed?: readonly AstNode[]): TextEdit`; `includeInsertion(file: ScriptSourceFile, include: Include, printer: ScriptPrinter): TextEdit` |
| `packages/engine/src/edit/guards.ts` | `problemKeys(file: SourceFile): string[]`; `definitionStyles(ast: ScriptAst): { typed: string[]; legacy: string[]; tagged: ParseProblem[] }`; `checkResult(before: (path: string) => SourceFile \| undefined, after: readonly FileText[], parser: SourceParser): void` (throws `EditRefusal`) |
| `packages/engine/src/edit/names.ts` | `isIdentifier(name)`; `freshName(base, taken: ReadonlySet<string>)`; `namesInWorkflow(def: WorkflowDef): Set<string>`; `moduleDirectory(name)`; `relativeSource(fromPath, toPath)` |
| `packages/engine/src/edit/workflow.ts` | `locateWorkflow(state, target): { file: ScriptSourceFile; def: WorkflowDef; projection: Projection }`; `topStatement(def, range): number`; `referenceTo(def, projection, from: PortRef): { expression: Expression; introduce: { statement: number; name: string } \| null }`; `clearArgument(def, argument: Range): WorkflowDef` |
| `packages/engine/src/edit/commands/{create-process,add-call,connect,delete-node,rename,replace-file-text}.ts` | One `(state: EditState, command: <Kind>) => TextPatch[]` each (`connect.ts` also exports `disconnect`); refusals throw `EditRefusal` |
| `packages/engine/src/edit/apply.ts` | `interface EditState { readonly model: ProjectModel; readonly parser: SourceParser; readonly catalogue: ScriptCatalogue; readonly scaffold: Scaffold }`; `createEditState(version: string, files: Iterable<ProjectFile>, options?: { packs?: readonly LanguagePack[] }): Promise<EditState>`; `applyCommand(state: EditState, command: EditCommand): CommandResult`; `commit(state: EditState, result: Extract<CommandResult, {ok: true}>): readonly string[]` |
| `packages/engine/src/edit/index.ts` | re-exports |
| `tools/oracle/cases/f111-{mixed-after-flag,start-typed,start-legacy,edits-typed,edits-legacy}/**` | section 8 trees; `edits-*` are generated by the golden test |

### 3.2 Change

- `packages/lang-core/src/index.ts`: `LanguagePack.scaffold: Scaffold`; export the edit types.
- `packages/lang-core/src/ast/parse-result.ts`: `readonly code?: string` on `ParseProblem`, documented as set by packs, with `"mixed-definitions"` defined.
- `packages/lang-2610/src/index.ts`: `scaffold`.
- `packages/lang-2610/src/ast/build/context.ts`: `error(message, at, code?)`.
- `packages/lang-2610/src/ast/build/process.ts` L155, L247, L353 and `workflow.ts` L42, L77: pass `"mixed-definitions"`.
- `packages/engine/src/source/equivalent.ts`: export `diffNodes(a, b, ignore?: ReadonlySet<string>): string \| null` (today's `diffAst`); `equivalent` is unchanged.
- `packages/engine/src/index.ts`: export `applyCommand`, `applyPatches`, `createEditState`, `commit`, and the types.
- `packages/engine/package.json`: devDependency `"fast-check": "4.11.0"` (MIT; its one dependency is `pure-rand`); `pnpm install`.
- Engine fake packs (`palette.test.ts`, `packs.test.ts`, `source/parser.test.ts`): add `scaffold`.
- `tools/oracle/cases/cases.yaml`: five entries (section 5).
- No change to dependency-cruiser, workflows, root scripts, generated files or the scope of `features.json`.

## 4. Tests (written before the implementation)

**Pack**

| File: test | Asserts |
|---|---|
| `lang-2610/test/scaffold.test.ts`: `F-111 step 2 LA-12 LA-11: the new-process template sets nextflow.enable.types = true and defines one typed process` | parse is modelled with no problems, `typesEnabled`, body `[FeatureFlag, Process(typed, NAME)]` for several names |
| `…: F-111 LA-45 ADR-0032: the template is a printer fixed point` | `printScript(ast, {layout: createLayout(t)}).text === t` |
| `lang-2610/test/index.test.ts` (added): `F-111 LA-02: the pack provides the template without loading the parser` | F-104's static-import guard still holds |
| `lang-2610/test/ast/mixed-definitions.test.ts`: `F-111 LA-13: errors from a definition in the other style carry code mixed-definitions, also inside Unparsed` | the five sites; `typed-legacy-mixed.nf` and `typed-without-flag.nf` through `parseScriptSource`; other errors have no code |

**Engine: `packages/engine/test/edit/`**

| File: test | Asserts |
|---|---|
| `patches.test.ts`: `F-111 AR-23: a patch then its inverse restores exact bytes` | fast-check: random texts (CRLF, astral characters), random non-overlapping edits, creates and deletes |
| `…: F-111 AR-20: overlapping or out-of-range edits, two patches for one path, creating an existing file and deleting a missing one throw PatchError` | |
| `…: F-111: diffText gives one edit spanning only the changed text` | |
| `splice.test.ts`: `F-111 AR-22 LA-45: a reprint replaces the span from the first leading comment to the trailing comment; the rest is byte-identical` | |
| `…: F-111 ADR-0033: a declaration in a partial file is reprinted with a layout masked to its span` | the 1.3 probe; status and problem keys unchanged |
| `…: F-111 ADR-0032: an include goes after the last include, else after the flags, else before the first declaration's comments` | blank-line rules; empty file |
| `…: F-111: printed text follows the file's CRLF line endings` | |
| `…: F-111 ADR-0004: a reprint that would drop a comment is refused` | |
| `guards.test.ts`: `F-111 AR-24: a result with a problem the file didn't have is refused, and nothing is written` | |
| `…: F-111 AR-24 ADR-0004: problems the file already had don't block an edit elsewhere` | |
| `…: F-111 step 3 LA-13: a legacy process before the types flag and a typed one after is refused with an explanation, though nextflow lint accepts it` | the `f111-mixed-after-flag` text |
| `…: F-111 step 3 LA-13: legacy definitions added after the flag, or typed ones in a script without it, are refused with the explanation and nf-lang's message` | via ReplaceFileText |
| `…: F-111 LA-13 ADR-0004: a script that was already mixed can still be edited` | |
| `create-process.test.ts`: `F-111 step 2 LA-12: CreateProcess writes modules/local/<name>/main.nf with nextflow.enable.types = true and adds the include` | `HELLO` → `modules/local/hello/main.nf`; text equals `scaffold.process("HELLO")`; include after the last include |
| `…: F-111 LA-12 AR-03: the include is relative to the calling script and resolves to the new file` | from `main.nf` and `subworkflows/local/x/main.nf`; after `commit`, no F-105 diagnostics |
| `…: F-111 LA-14: CreateProcess from a legacy script includes the typed module without touching its definitions` | |
| `…: F-111: CreateProcess refuses an invalid name, an existing module path and a name already in scope` | |
| `add-call.test.ts`: `F-111 AR-21 AR-10: AddCall appends a bare call and the projection gains a call node` | |
| `…: F-111 AR-22 LA-45: AddCall reprints only the target workflow` | the other items are byte-identical |
| `…: F-111: AddCall works on an empty workflow, one with take and emit, and a legacy workflow` | |
| `…: F-111: AddCall refuses names that aren't callable in scope, and a self-call` | |
| `connect.test.ts`: `F-111 UX-25 AR-21: Connect rewrites the argument feeding an input port` | inline → ref; ref → ref; a nested node is replaced |
| `…: F-111 UX-25: Connect to a missing argument pads earlier positions with null` | |
| `…: F-111 AR-10: Connect from an unassigned node assigns it to a new variable` | naming and dedupe; comments kept |
| `…: F-111 LA-14: Connect from a multi-output call reads the output by name` | typed |
| `…: F-111: Connect from take and params nodes reads the take and params.<name>` | |
| `…: F-111: Connect moves a later source statement before the target, and refuses a cycle or a reassignment` | |
| `…: F-111: Connect refuses a nested source and self-connection` | |
| `…: F-111 F-302: Disconnect removes the last argument and replaces an earlier one with null; the code parses` | |
| `…: F-111: Disconnect refuses a chain's receiver, emit and publish values, and a port with no argument` | |
| `delete-node.test.ts`: `F-111 AR-21: DeleteNode removes the node's statement and clears direct arguments it fed` | |
| `…: F-111: DeleteNode on a nested node clears its argument; take, emit, params and output nodes are refused` | |
| `rename.test.ts`: `F-111 AR-21 AR-03: RenameDeclaration renames the declaration, its references, and the include entries and references in includers` | |
| `…: F-111: an aliased include keeps its alias and call sites; record type references are renamed` | |
| `…: F-111 AR-22: RenameDeclaration only replaces identifier text` | every edit turns `name` into `newName` |
| `…: F-111: RenameDeclaration refuses invalid or clashing names and unparsed declarations` | |
| `replace-file-text.test.ts`: `F-111 AR-21 UX-44: ReplaceFileText applies parsing text as one trimmed edit` | |
| `…: F-111 AR-24 UX-44: text that doesn't parse is refused with the parser's message` | |
| `…: F-111: plain files are always replaced; a missing path is refused` | |
| `apply.test.ts`: `F-111 AR-20: commands and results are plain data, and applyCommand is pure` | `structuredClone` round trip; the model's texts are unchanged; two runs are deep-equal; every `EDIT_COMMAND_KINDS` kind is dispatched |
| `…: F-111 AR-24: a refused command returns a message and no patches` | |
| `properties.test.ts`: `F-111 step 1 AR-22 AR-23 AR-24 LA-13: random command sequences on <tree> parse, keep untargeted declarations equivalent and undo to exact bytes` | section 4.1; trees: `f111-start-typed`, `f111-start-legacy`, F-106's `test/projection/fixtures`, the `s1-*` oracle cases, `tools/corpus/fixtures` and `lang-2610/test/ast/fixtures` |
| `…: F-111 step 1: every command kind is accepted at least once on the start trees` | coverage guard |
| `oracle-goldens.test.ts`: `F-111 step 2 ADR-0011: the scripted edits on <start> produce tools/oracle/cases/<edits> byte for byte` | `toMatchFileSnapshot` per file; no extra files; ids resolved from the projection by callee or label, never written as literals |

### 4.1 Property harness (`test/edit/harness.ts`)

**Choices:**
- the base model is built once per tree;
- fast-check draws `fc.array(choice, {minLength: 1, maxLength: 4})`, where `choice = {kind, a, b, name, snippet}` (natural numbers, plus a name matching `^[A-Z][A-Z0-9_]{0,7}$`);
- each choice becomes a command by indexing the candidates enumerated from the current state: workflows, nodes, input and output ports, edges, callees in scope, declarations and files;
- ReplaceFileText texts come from a deleted span, an inserted snippet (a legacy process, `}`, `/*`, `workflow W {}`) or `printScript` of the file.

**After each command, the invariants:**
- (a) **AR-24:** accepted means no new problem keys and new files are clean; refused means a message and no state change.
- (b) **AR-22:**
  - every original item whose range touches no edit is found at its shifted range in the re-parsed result, with `diffNodes` null (Unparsed items by normalised text);
  - every comment outside the edit spans is at its shifted offset with the same text;
  - workflow commands edit only inside the target workflow's span;
  - CreateProcess edits the caller only by insertion at item boundaries;
  - each Rename edit turns `name` into `newName`;
  - ReplaceFileText targets the whole file.
- (c) **LA-13:** no changed script is newly mixed.
- (d) **AR-21 effects:** an accepted AddCall keeps the workflow's other statements structure-equal (F-110's `structure` field list, mirrored in `test/edit/structure.ts`).

**After the sequence:**
- applying the inverses in reverse restores exact bytes and the same set of paths (AR-23);
- `reset(state, base)` in `finally` keeps runs independent.

**Settings:** fixed `seed: 111`, `numRuns: 25` per tree; `F111_RUNS` overrides.

### 4.2 Corpus: `packages/engine/test/corpus/edit.corpus.ts` (`pnpm test:corpus`, CI `corpus-parse`)

| Test | Asserts |
|---|---|
| `F-111 step 1 AR-22 AR-23 AR-24 LA-13: random command sequences on <pin> …` | section 4.1 on rnaseq-nf, rnaseq-nf-typed and fetchngs (40 runs each) and on rnaseq and sarek (15 each, length ≤ 3); each kind is accepted at least once per pin; counts per kind and refusal code go to the "Edit properties (F-111)" section of `.cache/reports/parse-corpus.md` |
| `F-111 LA-45 AR-22: reprinting each corpus workflow unchanged keeps its structure` | `structure(parse(splice))` equals `structure(original)` for every modelled workflow; any other field difference fails |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-111` from `main` after F-106 merges. Tasks 1 to 6 need only F-105. In every task, write the tests first and watch them fail.

1. **Oracle evidence and start trees** (Nextflow only, copied from section 8).
   - Add `f111-mixed-after-flag` (`lint: {expect: ok}`, `run: {expect: ok}`; `about` says why LA-13 needs its own check).
   - Add `f111-start-typed` and `f111-start-legacy` (lint and run ok).
   - Done when `pnpm oracle -- --case f111-mixed-after-flag --case f111-start-typed --case f111-start-legacy` passes (Java 17 to 26, or the CI `oracle` job) and `pnpm check` passes.
2. **lang-core types, pack template, mixing tags.**
   - Files: `edit.ts`, `LanguagePack.scaffold`, `ParseProblem.code`, `scaffold.ts`, the builder tags, the pack tests and the engine fake packs.
   - Done when `pnpm --filter @nf-builder/lang-2610 test && pnpm --filter @nf-builder/engine test && pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts` pass.
3. **Patches.**
   - Add the fast-check devDependency (`pnpm install`) and `patches.ts`, with `patches.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/edit/patches.test.ts` and `pnpm check` pass.
4. **Splice and guards.**
   - Files: `nodes.ts`, `refusal.ts`, `splice.ts`, `guards.ts`, `names.ts`, and the `diffNodes` export, with their tests.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/edit/splice.test.ts test/edit/guards.test.ts test/source` and `pnpm check` pass.
5. **Apply, ReplaceFileText, CreateProcess and AddCall.**
   - Files: `apply.ts`, the three commands, the engine `index.ts` exports, and their tests plus `apply.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/edit` and `pnpm check` pass.
6. **RenameDeclaration.**
   - Files: `rename.ts`, `rename.test.ts`.
   - Done when the task 5 command passes and `pnpm check` passes.
7. **Connect, Disconnect and DeleteNode** (needs F-106).
   - Files: `workflow.ts`, `connect.ts`, `delete-node.ts` and their tests.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
8. **Properties on the fixture trees.**
   - Files: `harness.ts`, `structure.ts`, `properties.test.ts`.
   - A violation is fixed in the command with a unit case, never by weakening an invariant.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
9. **Oracle goldens.**
   - Files: `oracle-goldens.test.ts` (sequences in section 8), the generated `f111-edits-typed` and `f111-edits-legacy` trees (`vitest -u`), and two `cases.yaml` entries (lint and run ok).
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/edit/oracle-goldens.test.ts`, `pnpm oracle -- --case f111-edits-typed --case f111-edits-legacy` and `pnpm check` pass.
10. **Corpus.**
    - File: `edit.corpus.ts`.
    - Done when `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` passes (or CI `corpus-parse`, whose job limit is 20 min; keep F-111 under 3 min), and `pnpm check` passes.
11. **Records** (orchestrator, section 7).
    - Done when `pnpm check` passes and Scope guard passes without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **Reprint level** (F-110 and F-104 notes).
   - **Recommendation:** declaration-level reprint for workflow-body commands; identifier edits for renames; item-boundary inserts for includes. AR-22, LA-45 and ADR 0032 allow this.
   - Alternative: a statement printer, which gives smaller diffs but needs insertion and indentation rules per section for no spec gain.
2. **Command model.**
   - **Recommendation:** section 2.2 as designed: plain data; ids resolved at apply time; `TextPatch` with an `edit`/`create`/`delete` union and one patch per path; `inverse` in the result; `commit` separate from apply; no history in F-111.
3. **Reading of AR-24.**
   - **Recommendation:** refuse a new problem key (lexer, parser, builder or internal) in a changed file. Problems the file already had don't block, so partial imports stay editable (ADR 0004) and ReplaceFileText can repair a broken file.
4. **LA-13.**
   - **Recommendation:** our own check, as in section 2.4, because 26.10.7 accepts mixing that depends on position.
   - Tag nf-lang's five builder errors with `ParseProblem.code` in the pack.
   - Already-mixed files stay editable.
   - Amend LA-13's rationale to cite the docs and record this finding.
5. **Positional placeholders.**
   - **Recommendation:** a missing earlier input is `null` (lint-clean, so F-112 shows it as unconnected, LA-33). Disconnect removes a trailing positional argument and replaces an earlier one with `null`.
   - Alternatives: shifting the arguments (changes meaning), or refusing (blocks F-302).
6. **Variable introduction.**
   - **Recommendation:** a call gives its callee name in lower case (`FASTQC` gives `fastqc`); a factory or chain gives `<factory or last operator>_ch`; then `_2`, `_3` until the name is free in the workflow and the file's scope.
   - AddCall never assigns.
7. **Connect order.**
   - **Recommendation:** move a later source above the target when that is safe, otherwise refuse. Without this, connecting a node added at the end of `main` to an earlier node would always be refused.
8. **DeleteNode.**
   - **Recommendation:**
     - remove the statement and clear the direct arguments it fed (F-302's delete-edge semantics);
     - leave indirect reads in place, and F-112 reports them;
     - refuse role nodes.
   - Alternative: leave every reference dangling (simpler, but worse on the canvas).
9. **CreateProcess output** (LA-12 doesn't say).
   - **Recommendation:**
     - the directory is the name in lower case (nf-core convention; registry names are lower case);
     - the include source is an explicit `<rel>/modules/local/<lower>/main.nf`;
     - the template is script-only with no ports, as in section 2.5 (Configure adds ports later, F-303);
     - the exec variant waits for F-301;
     - the template comes from `LanguagePack.scaffold` (LA-02).
10. **Rename scope.**
    - **Recommendation:** as in section 2.5. No `withName` selector updates, no file moves, shadowing ignored, `Unparsed` text untouched. Record these as limitations.
11. **fast-check 4.11.0** as an engine devDependency.
    - **Recommendation:** accept. ADR 0011 already names it; it is dev-only, MIT, and its one dependency is `pure-rand`. A decide-and-record item: a new dependency, though not a runtime one.
12. **Interface growth.**
    - **Recommendation:** record `LanguagePack.scaffold` and `ParseProblem.code` in the ADR. Both are in memory, with no dependency-cruiser change; update the sketch in `architecture.md`.
13. **No Playwright test** (Q13).
    - **Recommendation:** the evidence is the unit and property tests plus the CI `oracle` and `corpus-parse` jobs.

**AGENTS.md "Ask first" and decide-and-record items:**
- one new dev dependency (point 11);
- no package boundary or dependency-cruiser change, only interface growth (point 12);
- no stored or exported format: patches and inverses live in memory, and the code conventions in points 5, 6 and 9 are recorded as user-visible behaviour;
- no workflow edits;
- no open question in `open-questions.md` affected (Q6 is about project templates);
- spec text to amend: the LA-13 rationale, the AR-24 reading, the LA-12 conventions, and the placeholder in UX-25 / F-302.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing, currently 0036 or later): "Edit commands: text patches with inverses, declaration reprint, AR-24 and LA-13 guards". It covers points 1 to 12 and the finding in section 1.2. Add a `docs/adr/README.md` row.
- **Spec:**
  - `architecture.md`: an AR-24 clarification ("a problem the file didn't have") and the sketch's `scaffold`;
  - `language.md`: the LA-13 rationale and the LA-12 directory and include form.
- **`features.json` notes** (no scope change):
  - **F-111:** "Verified <date>:
    - step 1 by `test/edit/properties.test.ts` (fixture trees) and `test/corpus/edit.corpus.ts` (CI `corpus-parse`);
    - step 2 by `create-process.test.ts` and oracle cases `f111-edits-typed`/`f111-edits-legacy` (lint and `run -stub`);
    - step 3 by `guards.test.ts`, the LA-13 property and oracle case `f111-mixed-after-flag`.

    No Playwright test (Q13)."
  - F-113, F-207, F-208, F-209, F-210, F-301, F-302, F-305, F-307, F-310 and F-112: the lines in section 2.6.
- **`progress.md` Decisions:** the ADR; points 3 to 11; "patches and history in memory only; fast-check is dev-only".
- **Engine README:** one line on edit commands.
- No `docs/licences.md` row: fast-check is a standard permissive npm dev dependency.
- Delete this plan in the merging PR, per the hand-off README.

## 8. Evidence and how to repeat it

Probe trees are in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f111/` (the scratchpad may be cleared):
- `mix-after`: legacy process before the flag, typed after; lint ok, run ok;
- `tpl`: the template plus typed and legacy callers;
- `args`: argument count, `null` and the assignment probes;
- `mixout`: legacy outputs in a typed process;
- `gold/{start,end}-{typed,legacy}`: the start trees, and the expected shapes of the goldens.

The Node checks of printer behaviour are in `scripts/` (`reprint.ts`, `masked.ts`, `include.ts`, `wrap.ts`). Run them with `node --experimental-transform-types`.

To repeat a probe:
```
NXF_HOME=<scratch>/home NXF_OFFLINE=true /home/user/wt-F-105/.cache/nextflow/26.10.7/nextflow-26.10.7-dist lint -o json .
… run main.nf -stub
```

**`f111-start-typed`** (verified):
- `data/s1.txt` contains `one\ntwo\n`.
- `modules/local/align/main.nf`: the flag; `process ALIGN { input: sample: String / output: file('aligned.txt') / script: """ echo '${sample}' > aligned.txt """ }`, laid out as in section 2.5.
- `modules/local/count/main.nf`: the flag; `process COUNT { input: aligned: Path / output: file('count.txt') / script: """ wc -l < ${aligned} > count.txt """ }`.
- `main.nf`:
```nextflow
nextflow.enable.types = true

include { ALIGN } from './modules/local/align/main.nf'
include { COUNT } from './modules/local/count/main.nf'

workflow {
    reads = channel.of('a', 'b')
    more = channel.of('c')
    COUNT(channel.fromPath("${projectDir}/data/*.txt"))
    more.view()
}
```

Typed command sequence:
1. AddCall ALIGN.
2. Connect `reads` → ALIGN's input.
3. Disconnect that input.
4. Connect `more` → ALIGN's input.
5. Connect ALIGN's output → COUNT's input. This moves the ALIGN statement above COUNT, introduces `align`, and replaces the nested factory.
6. DeleteNode on the `.view` chain.
7. CreateProcess REPORT (caller `main.nf`).
8. AddCall REPORT.
9. RenameDeclaration COUNT → COUNT_LINES in `modules/local/count/main.nf`.

The expected end state (`align = ALIGN(more)`, `COUNT_LINES(align)`, `REPORT()`, three includes) lints with 0 errors and runs.

**`f111-start-legacy`** (verified):
- `modules/local/legacy_count/main.nf`: `process LEGACY_COUNT { input: val x / output: path 'count.txt' / script: """ echo ${x} > count.txt """ }`.
- `main.nf`:
```nextflow
include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    numbers = channel.of(1, 2)
    LEGACY_COUNT(numbers)
    numbers.view { v -> "n: ${v}" }
}
```

Legacy command sequence:
1. Connect LEGACY_COUNT's first output → the `.view` chain's `in`, giving `legacy_count = LEGACY_COUNT(numbers)` and `legacy_count.view { … }`.
2. CreateProcess HELLO.
3. AddCall HELLO.

The expected end state lints with 0 errors and runs.

**`f111-mixed-after-flag`:** the `mix-after/main.nf` probe (legacy `LEGACY_GOODBYE`, then the flag, then typed `TYPED_HELLO`, each with `script:` and `stub:`, and a workflow calling both). It lints with 0 errors and runs both tasks.
