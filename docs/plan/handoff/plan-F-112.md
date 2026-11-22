# Plan: F-112, diagnostics: parser errors, version rules, deprecations, edge types and legacy suggestions

Planner output, 2026-11-22. I changed nothing in the repo or any worktree. This plan is based on:
- `main` at `cbb24e2`, with F-104 merged;
- `feat/F-105` at `29a6135`, where `Diagnostic`, `IncludeTarget` and `IncludeRules` are already built in `/home/user/wt-F-105/packages/lang-core/src/`;
- the F-106 plan, which is not built yet.

Section 1.5 lists every unbuilt name the plan relies on. The evidence is in section 8.

## 0. Scope

F-112 turns what the engine knows into AR-05 diagnostics, one list per file:
- **Parser problems (LA-30) and F-105's include diagnostics,** with advice added.
- **24 pack lint rules:**
  - LA-29 and LA-31 to LA-36;
  - the typed-code warnings (F-102 note), the agent-output checks (F-101 note) and the alias, duplicate and pipeline-typing checks (F-105, settled), all left to F-112 by earlier features.
- **A quick fix on each mechanical case,** carried as one edit command.

The rules live in the pack (LA-02, ADR 0006) and are loaded lazily. The engine runs them over F-105's model and F-106's projections and adds no Nextflow knowledge of its own.

How the steps are checked:
- **Step 1:**
  - Each code has a positive and a negative fixture directory in one oracle-linted tree.
  - For every code nf-lang also reports, our diagnostics must equal `nextflow lint`'s, at the same line and column.
  - On the corpus: zero error diagnostics, because lint reports zero errors. The ported warnings must equal lint's: 213 `when` and 3 implicit `it`.
- **Step 2:**
  - Every message ends with a `-- <imperative>` clause, or is an nf-lang message listed as already saying what to do.
  - Every diagnostic of a fixable code carries a fix. Applying the fixes reproduces a committed `fixed/` tree, which lints clean of that code.

There is no UI, so there is no Playwright test (Q13).

**Out of scope:**
- Name resolution (`x is not defined`, unused variables) and full expression type checking: a proposed new feature (open point 4).
- Applying fixes (F-111's command; F-309's UI) and the problems panel and counts (F-309).
- The worker and invalidation (F-113).
- Dimming invalid targets while dragging (F-302).
- LA-14's tuple-arity check (F-302 or F-504, open point 11).
- Documentation lints, LA-54 (F-312).

## 1. Findings

### 1.1 Spec and ADRs
- **AR-05:** diagnostics come from the parser, the model and the pack's lint rules. Each has a range, a severity, a message and an optional quick fix, which is an edit command.
- **AR-20/21:** commands are a lang-core union. `ReplaceFileText` is listed (F-111).
- **LA-29:** an incompatible known type is an error, but never blocks a connection. Unknown types never block.
- **LA-30 to LA-36:** the lint table, with three severities. "Every lint message says what to do. Mechanical fixes are offered as quick fixes."
- **Severity definitions:** error means "Nextflow would reject it"; warning means deprecated or likely wrong; suggestion means "works, but a modern form exists".
- **LA-02 and ADR 0006:** lints are pack data. There are no version literals outside `packages/lang-*`.
- **Architecture sketch:** `lints: LintRule[]`, marked "to be fixed in M1". F-104 already made the parser lazy (ADR 0033).
- **ADR 0004:** partial files keep their modelled parts.
- **ADR 0005 and 0011:** Nextflow is the oracle.
- **ADR 0007:** suggestions nudge and never migrate on their own.
- **Product principle 4:** nudge, don't nag.
- **`docs/deprecations.mdx` at v26.10.7:**
  - L35-L44 deprecate `Channel`, the `file` qualifier, `baseDir`, `shell`, `when` and `storeDir`.
  - L17-L28 discourage params outside the entry workflow, legacy params, `.out`, `|`, legacy operators and `publishDir`.
- **`docs/strict-syntax.mdx`:**
  - L502-L563: "Deprecated syntax" is exactly LA-34's `Channel`, implicit `it`, `when` and `shell`. L528 calls `ch.map { it -> it * 2 }` "also correct", which grounds the implicit-`it` fix.
  - L565-L650: best practices.

### 1.2 Upstream rules (nf-lang v26.10.7; a sparse clone in the scratchpad, see section 8)

**What `nextflow lint` prints** (`modules/nf-cli-v1/.../CmdLint.groovy` L235-L357):
- errors;
- warnings, except `ParanoidWarning`s;
- soft errors, printed as warnings.

**When each check runs** (`ScriptParser.analyze`, L74-L99):
- include and name checks run on every script;
- `TypeCheckingVisitor` runs only on typed scripts with no errors so far;
- `CallArityVisitor` runs only on legacy scripts with no errors so far.

**Warnings lint prints:**
- `ScriptAstBuilder`:
  - L597 process input, L619 record field and L634 tuple component without a type;
  - L695 a typed process with several outputs;
  - L824 `when`, L836 `shell`;
  - L977 a typed take without a type;
  - L1059 a type annotation in `publish:`.
- Script `VariableScopeVisitor`: L765 `Channel`, L885 implicit `it`, L926 `baseDir` and similar in a process, L725 mutating in operator closures, plus unused variables and parameters.
- Config `VariableScopeVisitor`: L343 implicit `it`, L123 workflow handlers.
- `TypeCheckingVisitor`: L314 directive closures; L731 a deprecated operator (soft error).

**Paranoid only** (lint never prints them):
- `storeDir` and other `@Deprecated` names (`VariableScopeChecker` L216, L285);
- deprecated feature flags (`VariableScopeVisitor` L245);
- legacy params (L271);
- `params` outside the entry workflow (L875).

**Errors used here:**
- `VariableScopeVisitor` L140 and L144 (aliases), L150, L183, L189, L210, L217 and L260 (duplicates), L249 (feature flags);
- `ResolveIncludeVisitor` L139-L142 (pipeline typing);
- config `VariableScopeVisitor` L204 (include placement);
- `ScriptResolveVisitor` L174 and L179 (agent outputs);
- `VariableScopeVisitor` L803 (`eval` in an agent output);
- `TypeCheckingVisitor` L648 (typed arity), L1007 (process argument), L829 (generic argument), L525 (assignment, used for emits), L267 (workflow output), L1013 (multiple channels);
- `CallArityVisitor` L73 (legacy arity).

**Assignability:** `Types.isAssignableFrom` (L103-L159). An `Object` target or a dynamic source always matches. Records are matched structurally. Integer is assignable to Float. Generic arguments are compared pairwise, and wildcards or placeholders always match.

### 1.3 Probes with the pinned `nextflow lint` 26.10.7 (section 8)

**`probe-types`** (typed): every row is an error at the position shown.

| Code (planned) | Message | Position |
|---|---|---|
| type-mismatch, process input | `Argument with type String is not compatible with process input of type Path` (a `Value<String>` argument also reports `String`) | the argument |
| multiple-channels | `Process \`P2\` was called with multiple channel arguments … -- make sure that at most one argument is a channel …` | the call |
| call-arity, typed | `Process \`P2\` expects 2 argument(s) but received 1` | the method name |
| type-mismatch, workflow take | `Argument with type Value<String> is not compatible with parameter of type Channel<String>`. Also Channel→Value, String→`Value<String>`, `Value<String>`→String, Channel→String and Integer→String | the argument |
| type-mismatch, emit | `Assignment target with type Channel<Integer> cannot be assigned to value with type Channel<String>`. Also kind flips | the emit item |
| type-mismatch, output | `Workflow output \`report\` with type Path cannot be assigned to value with type Channel<String>`. Also `Channel<String>` ← `Value<String>` and String ← Integer | the publish item |

**`probe-compat`:**
- Lint accepts:
  - Integer → Float input;
  - `record(id: 'a')` → `Sample` input;
  - `Value<Integer>` → `Value<Float>` take;
  - `List<String>` → `Iterable<String>` take;
  - `Value<Path>` → output declared `Path`.
- Lint rejects:
  - `List<String>` → `List<Path>`;
  - String → `Sample`;
  - `Channel<Path>` → output declared `Path`.

**`probe-warn`:**

| Construct | What lint prints, at |
|---|---|
| `when:`, `shell:` | warnings at the section label |
| `Channel.of`, `SUBW(Channel.value(3))` | `Channel` warning at the receiver |
| `{ it * 2 }` in a script and in a config | implicit `it` warning at each `it` |
| typed process, workflow and publish annotations | the L597, L619, L634, L695, L977 and L1059 warnings at the name, field, component, `output` label, take or publish target |
| directive `cpus { 2 }` | the L314 warning |
| unknown flag | `Unrecognized feature flag 'nextflow.enable.foo'` at 1:1 |
| duplicates | `\`A\` is already included` at the second include; `\`B\` is already included` at a process clashing with an include; `\`C\` is already declared` at the later process; `Parameter \`a\` is already declared` at the param |
| aliases | `An included pipeline must be aliased, e.g. \`workflow as MY_PIPELINE\`` and `Included types cannot be aliased`, both at the entry |
| pipeline typing | `Including a pipeline requires \`nextflow.enable.types = true\` in the including script`; `An included pipeline must enable static typing -- set … in '<absolute path>'`; both at the include |
| config include placement | `Config includes are only allowed at the top-level or in a profile` at `includeConfig` |
| legacy arity | `Incorrect number of call arguments, expected 2 but received 1` at the call |
| silent | `storeDir`, `publishDir`, `params.x = 1`, `params` in a process or function, `nextflow.enable.dsl = 2`, and `params.y = 2` in a workflow print nothing |

### 1.4 Corpus warnings (pinned dist, measured today; `.cache/corpus-lint` keeps errors only)

| Pin | Errors | `when` | Implicit `it` | Other warnings (not ported) |
|---|---|---|---|---|
| rnaseq | 0 | 78 | 3 | 0 |
| sarek | 0 | 131 | 0 | 3 unused variable or parameter |
| fetchngs | 0 | 4 | 0 | 0 |
| rnaseq-nf | 0 | 0 | 0 | 1 unused parameter |
| rnaseq-nf-typed | 0 | 0 | 0 | 0 |

There are no `Channel.` warnings in the corpus, so the fixtures carry that case.

### 1.5 Code facts and the unbuilt names relied on

**Built:**
- `SourceFile.problems` (whole-file `ParseProblem`s with lint parity: `source`, 1-based line and column, `scope?`).
- `Unparsed` items, which rules skip.
- lang-core `walk` and `childNodes`; the AST types.
- `Closure.params` is `null` with no arrow and `[]` with a bare arrow; nf-lang treats both as an implicit `it` (`ScriptAstBuilder` L2028-L2030, `VariableScopeVisitor` L857).
- The catalogue:
  - `directives[].deprecated` (only `storeDir`);
  - `featureFlags[].name` (6 flags);
  - the deprecated Channel operators.
- Engine `loadParser(version, packs?)`, whose pattern `loadLints` follows.
- lang-2610's internal `parseScriptSource` and `parseConfigSource`, for unit tests.
- The tree manifests in `tools/oracle` (`loadTreeManifest`, `runTree`): errors only, with exact comparison.
- `tools/corpus` `parseLintJson` keeps errors only.

**F-105** (built on `feat/F-105`; adjust if its names change at merge):

| Name | Used for |
|---|---|
| lang-core `Diagnostic { path, range, severity, message, code }`, `DiagnosticSeverity` | widened in 3.2 |
| lang-core `IncludeTarget`, `IncludableDeclaration`, `IncludeRules` | the lint context |
| engine `ProjectModel`: `file`, `paths`, `lookup(path, name)`, `dependants`, `diagnostics` | context and assembly |
| engine `FileModel { source, includes, diagnostics }` | context and assembly |
| engine `ScriptIncludeModel { node, target, entries }`, `ResolvedEntry { entry, declaration, pipeline }`, `Binding` | `LintContext.includes`, `lookup` |
| engine `openProject(version, files, options?)`, `ProjectFile`; test helper `test/model/read-tree.ts` | tests |
| include codes `include-target`, `include-not-parsed`, `include-name` | messages get advice |

**F-106** (plan only):

| Name | Used for |
|---|---|
| lang-core `Projection`, `GraphNode`, including `CallNode.callee { name, kind, status, typed }`, `EmitNode`, `OutputNode` | type rules |
| lang-core `Port { id, type, argument }` and `GraphEdge { to, type }` | type rules |
| lang-core `FlowType { dataflow, element }`, `TypeExpr { name, args, nullable }`, `WorkflowRef { path, name, modelled }` | type rules |
| engine `createProjector(model, catalogue)`, `Projector.workflows()`, `project(path, name)` | context |
| F-106 inline typing in `engine/src/projection/types.ts` | `Port.argumentType` (3.2) |

F-112 relies on `Port.argument` being the argument's range for every call input fed by an argument, whether it arrives as an edge or inline. If F-106 sets it only for inline arguments, task 5 sets it for edges too.

**F-111** (in planning; coordination only): `TextEdit` and `ReplaceFileText` (2.2, open point 2).

## 2. Design

### 2.1 Where things live

| Piece | Package |
|---|---|
| `Diagnostic` (widened), `QuickFix`, `TextEdit`, `ReplaceFileText`, `DiagnosticCode`, `LintRule`, `LintContext`, `PackLints`, `LanguagePack.loadLints()` | lang-core |
| Every rule, the code registry, parse advice, include advice and type compatibility | lang-2610 `src/lints/` (one lazy chunk) |
| Building the context, mapping parse problems to diagnostics, running the rules, sorting, `applyTextEdits`, counts | engine `src/diagnostics/` (version-independent) |

### 2.2 Shapes

```ts
// lang-core/src/commands.ts: created by whichever of F-111 or F-112 lands first (open point 2)
interface TextEdit { readonly start: number; readonly end: number; readonly text: string }   // UTF-16 offsets into the diagnosed text
interface ReplaceFileText { readonly kind: "ReplaceFileText"; readonly path: string; readonly edits: readonly TextEdit[] }
// lang-core/src/diagnostic.ts
type DiagnosticSeverity = "error" | "warning" | "suggestion";
interface QuickFix { readonly title: string; readonly command: ReplaceFileText }
interface Diagnostic { path; range; severity; message; code; readonly fix?: QuickFix }
```

Rules return `LintFinding { range, message, fix?: { title, edits } }`. The engine wraps each fix into the command, so the pack never builds commands. Everything is plain data that crosses Comlink.

### 2.3 Codes

**Origins:**
- **lint:** lint prints it, and the oracle checks it.
- **paranoid:** nf-lang reports it, but lint hides it.
- **ours:** there is no upstream check.

All upstream line numbers are at v26.10.7.

| Code | Severity | Spec | Origin and source | Fires on (range) | Fix |
|---|---|---|---|---|---|
| `syntax` | error | LA-30 | parser: `SourceFile.problems` from the lexer, parser or builder | the problem | no |
| `include-target`, `include-not-parsed`, `include-name` | error | AR-03, AR-05 | model (F-105) | the include | no (creating a file or inserting a module is a command for F-309, F-504 or F-111) |
| `deprecated-when` | warning | LA-34 | lint: `ScriptAstBuilder` L824 | the `when` label | no: it changes behaviour; nf-core's `ext.when` moves into config |
| `deprecated-shell` | warning | LA-34 | lint: L836 | the `shell` label | no: `!{}` and `$` escaping need rewriting |
| `deprecated-channel` | warning | LA-34 | lint: `VariableScopeVisitor` L765 (a method call whose receiver is the variable `Channel`) | the receiver | **yes:** `channel` |
| `implicit-it` | warning | LA-34 | lint: script L885, config L343 (`it` resolving to the nearest paramless closure, unless a `def it` shadows it) | each `it` | **yes:** add `it ->` to that closure: insert ` it ->` after `{`, or `it ` before a bare `->` |
| `deprecated-directive` | warning | LA-34 | paranoid: `VariableScopeChecker` L285; catalogue `deprecated` plus a pack advice table; today only `storeDir` | the directive call | no |
| `legacy-process` | suggestion | LA-35 | ours: a `LegacyProcess` | the name | no (no migration exists in v0.1) |
| `legacy-workflow` | suggestion | LA-35 | ours: `WorkflowDef.typed === false` | the name, or the `workflow` keyword | no |
| `legacy-params` | suggestion | LA-36 | paranoid: L271 | the `LegacyParam` | no (types and nested names aren't mechanical) |
| `params-outside-entry` | suggestion | LA-36 | paranoid: L875; reads of `params` in processes, agents, functions and named workflows | each `params` | no |
| `tuple-where-record` | suggestion | LA-36 | ours: a typed process `TupleInput`, or a `tuple(...)` output value | that node | no (callers change) |
| `publish-dir` | suggestion | LA-36 | ours (deprecations.mdx "Discouraged"): a `publishDir` directive in a script | the directive | no |
| `missing-type` | warning | LA-37 (new, open point 7) | lint: `ScriptAstBuilder` L597, L619, L634, L977 (check agent inputs against the fixture) | the name | no |
| `typed-process-outputs` | warning | LA-37 | lint: L695 (more than one output, all named) | the `output` label | no |
| `publish-type-ignored` | warning | LA-37 | lint: L1059 | the publish target | **yes:** delete `[name.end, type.end)` |
| `feature-flag` | error | LA-31 | lint: L249 (a name not in the catalogue's `featureFlags`) | the flag | no |
| `pipeline-include-types` | error | LA-31 | lint: `ResolveIncludeVisitor` L139-L142; the paths are project-relative | the include | no (enabling types breaks legacy definitions) |
| `config-include-placement` | error | LA-31 | lint: config L204 (allowed at the top level or directly under `profiles { <name> { } }`; selectors open no scope) | `includeConfig` | no |
| `agent-output` | error | LA-31 | lint: `ScriptResolveVisitor` L174 and L179; `VariableScopeVisitor` L803 for process-only functions (`eval`, `env`) | the output | no |
| `include-alias` | error | AR-05 | lint: L140, L144 | the entry | no |
| `duplicate-name` | error | AR-05 | lint: L150, L183, L189, L210, L217, L260, in nf-lang's order (includes, named workflows, processes, agents, functions, types; functions may overload) | the later one | **yes,** only when the duplicate is an identical include entry (same name, alias and target): remove that entry, or the whole include line if it was the only entry |
| `call-arity` | error | LA-33 ("unconnected required input"; open point 5) | lint: `TypeCheckingVisitor` L648 in typed scripts; `CallArityVisitor` L73 in legacy ones. The count is positional arguments, plus 1 if there are named arguments, plus closures | method name (typed) or call (legacy) | no |
| `unused-output` | warning | LA-33 | ours (open point 6) | the call | no |
| `type-mismatch` | error | LA-29, LA-32 | lint: L1007, L829, L525, L267 (2.6) | the argument, emit or publish item | no |
| `multiple-channels` | error | LA-32 | lint: L1013 | the call | no |

`internal` (warning, engine-owned) reports an `internal` parse problem or a rule that threw. It is not a lint: it gets a unit test and no fixtures.

**`unused-output`, exactly.** It covers calls in a workflow's `main:` (including inside `if` blocks) that resolve to a modelled process.

The call is exempt when any of these holds:
- the process has a non-empty `topic:` section;
- a legacy output has a `topic:` option;
- the process has a `publishDir` directive;
- any project config assigns `publishDir` inside a `process` block or selector.

Otherwise:
- **A bare call** warns once, unless a legacy script reads `<name>.out` anywhere in the workflow.
- **`v = CALL(...)` or `def v = …`** warns once if `v` is never read after the statement, counting `main`, `emit` and `publish`, closures and GStrings.
- **A typed multi-output call** warns once per output name that is never read as `v.<name>`, unless `v` is also read whole.

### 2.4 Messages ("states what to do")

- **Form:** `<problem> -- <imperative clause>`, nf-lang's own convention.
  - Ported messages keep nf-lang's text verbatim as the prefix, so `startsWith` gives lint parity.
  - Where upstream gives no instruction, we append one.
  - nf-lang paths become project-relative, as in F-105.
- **Exceptions:** nf-lang messages that already instruct without a ` -- <verb>` clause stay verbatim, and `DiagnosticCode.verbatim` lists them as patterns:
  - "The `shell` block is deprecated, use `script` instead";
  - "Implicit closure parameter is deprecated, declare an explicit parameter instead";
  - "Agent output `x` should declare a type -- typed outputs are answered by the model";
  - "An included pipeline must be aliased, e.g. …".
- **Parse and include messages:** `PackLints.advise(code, message)` returns the message with advice appended, unless it already has ` -- `.
  - For `syntax`, a pack table maps message patterns to advice. It covers every builder, parser and lexer message the pack can produce: about 50, taken from `test/ast/errors.json`, `test/config-ast/errors.json`, `test/ported/cases.json`, the DescriptiveErrorStrategy messages and the corpus fixtures. Anything else gets a generic default.
  - For the include codes, the advice is per code. F-105's code stays as it is; the engine applies `advise` to `FileModel.diagnostics`.
- **Advice to append** (the builder writes the final words; it must check Nextflow syntax against the docs, never from memory):

| Code | Appended advice |
|---|---|
| `missing-type` | `-- add a type, such as \`x: String\`` |
| `feature-flag` | `-- use one of <the catalogue's flags>, or remove it` |
| first `pipeline-include-types` message | `-- add \`nextflow.enable.types = true\` to this script` |
| `config-include-placement` | `-- move it to the top level or into a profile` |
| `Included types cannot be aliased` | `-- remove the alias` |
| duplicates | `-- remove the duplicate, or rename one or alias it with \`as\`` |
| typed arity | `-- pass one argument for each input: \`a\`, \`b\`` |
| type mismatch | `-- pass a <T>` (process input: "a <T>, or a channel or value of <T>"); emit: `-- change the declared type, or emit a <S>`; output: `-- change the output's type in the output block, or publish a <T>` |
| `storeDir` (from store-dir.mdx L46-L60) | `-- use explicit workflow logic that reuses an existing output instead` |
| `legacy-process`, `legacy-workflow` | `-- migrate it to static types: give it its own script with \`nextflow.enable.types = true\` and typed inputs and outputs` |
| `params-outside-entry` | `-- pass the value in as an input instead` |
| `tuple-where-record` | `-- use a record (\`record(...)\`) so values are matched by name` |
| `publish-dir` | `-- publish outputs from the entry workflow (\`publish:\` and the \`output\` block) instead` |
| `unused-output` | `-- connect it, publish it, or remove the call` |
| `internal` | `-- it is kept as written; edit it as text` |

### 2.5 Assembly (engine, per file, never throws)

1. Map `source.problems` to `syntax`, or to `internal` for `source: "internal"`.
   - `problemRange(text, problem)` turns the 1-based code-point line and column into offsets.
   - Messages go through `advise`.
2. Add F-105's `FileModel.diagnostics` through `advise`.
3. If the file has an AST, run every rule in `lints.rules` with a `LintContext`:
   - `file`;
   - `catalogue`;
   - `lookup(name)`, from F-105 `lookup`, giving `{ declaration, path, typesEnabled, entry }`;
   - `includes`: every script include entry with its target, declaration, `pipeline` flag and the target's `typesEnabled`;
   - `projections()`: the file's modelled workflows, lazy;
   - `configs()`: every config AST in the project, lazy.

   Each rule runs in a `try` block; a throw becomes `internal` ("Rule `<code>` failed: …"), and the other rules still run.
4. Sort by path, then range start, then code.

`createDiagnoser` is a snapshot memoised per file, like F-106's projector. F-113 owns invalidation (2.8).

### 2.6 Types (LA-29, LA-32)

Type checks run only when the calling script enables types, as nf-lang does. For each edge `e` into port `p` of node `n`, using `e.type`, or `p.argumentType` for inline arguments:

| Target | Rule | Message |
|---|---|---|
| typed process or agent input | element of the source vs `p.type` | L1007 |
| typed workflow take | kinds equal, then elements | L829 |
| emit | as a take | L525 |
| `:output` | `asDataflowType` (a plain target becomes `Value<T>` for a value source), then as a take | L267 |

`multiple-channels`: a typed process or agent call with more than one input fed by a known `Channel`.

`PackLints.connection(source, node, port, isRecord?)` gives `"compatible" | "incompatible" | "unknown"`. The rule uses it, and F-302 can use it too. `assignable(target, source)` works as follows:
- `?` or no element gives unknown.
- An `Object` target matches anything.
- Equal names compare their arguments pairwise; wildcards are skipped.
- Integer is assignable to Float.
- `Iterable` accepts `List`, `Set`, `Bag` and `Iterable`.
- `Record` accepts `Record` and user records.
- A user record (`isRecord`) against a built-in type is incompatible. Against another record type it is unknown, because records are structural and F-106 doesn't infer fields.
- Two different built-ins are incompatible. The built-ins are Boolean, Integer, Float, String, Path, Duration, MemoryUnit, List, Set, Bag, Map, Iterable, Tuple and Record.
- Anything else is unknown.

Type names print as lint prints them (`List<String>`, `Value<String>`). Every pair the fixtures claim is checked by the oracle.

Not checked: chain and operator arguments, factory arguments, pipeline-call params, record structure, tuple arity.

### 2.7 Fixtures and lint parity

- **Layout:** `packages/lang-2610/test/lints/fixtures/<code>/{positive,negative}/` for every code except `internal`, plus `fixed/` for the four fixable codes. Each is a small tree, usually one `main.nf`, with relative includes only and no root `nextflow.config`.
  - Each positive file is lint-clean apart from its own rule. Type checking and arity only run on files with no other errors.
  - Negatives hold near misses: `channel.of`, a `Channel<Path>` type, `it ->`, `Float` ← Integer, an aliased pipeline, and so on.
- **Manifest:** `packages/lang-2610/test/lints/fixtures.json` has `{ fixtures: [{ file, lint: [...errors], warnings: [...] }] }`, recorded from a real run. The oracle lints the whole tree once.
- **Engine tests:** they diagnose each `<code>/<kind>/` as its own project, then:
  - **step 1:** positive ≥ 1 and negative = 0;
  - **lint and parser or model origins:** our `(line, column, message prefix)` set equals lint's matching set (by `lintPattern`, or every lint error in the code's own files for `syntax` and `include-*`);
  - **severity:** error positives have lint errors; warning and suggestion positives have none;
  - **step 2:** wording and fixes.
- **Corpus** (2.8 tests): zero error diagnostics; every lint-origin code equals lint's matching warnings by `file:line:column`; per-code counts in the report.

### 2.8 Notes for later features (not planned here)
- **F-309:**
  - `Diagnostic.severity` includes `suggestion`;
  - `countDiagnostics` gives errors, warnings and suggestions separately (UX-03);
  - `lints.codes` gives severity, spec and fixability for grouping;
  - `fix.title`, and `fix.command` dispatched through F-111 as one undo step (F-209), then re-diagnose.
  - Fix offsets belong to the snapshot that was diagnosed: refuse a stale fix if the file has changed since.
  - Step 2's example is `deprecated-channel`.
- **F-113:**
  - Load `loadLints()` in the worker. One diagnoser per model snapshot.
  - After a change, re-diagnose the file and its `dependants`, and every script when a config changes (`unused-output` reads config `publishDir`).
  - Count diagnosis time in the QA-04 measurements.
- **F-302:** `lints.connection(...)` dims invalid targets while dragging. A `type-mismatch` diagnostic's range is the port's `argument`; use it to draw the edge red (UX-24).
- **F-206 and F-405:** find a node's diagnostics by range containment; count LA-35 suggestions per workflow.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/commands.ts` (if F-111 hasn't created it) | `interface TextEdit`; `interface ReplaceFileText` (2.2) |
| `packages/lang-core/src/lint.ts` | `type DiagnosticOrigin = "parser" \| "model" \| "lint" \| "paranoid" \| "ours" \| "internal"`; `interface DiagnosticCode { code: string; severity: DiagnosticSeverity; spec: readonly string[]; origin: DiagnosticOrigin; upstream: readonly string[]; lintPattern: RegExp \| null; verbatim: readonly RegExp[]; fixable: boolean }`; `interface LintFix { title: string; edits: readonly TextEdit[] }`; `interface LintFinding { range: Range; message: string; fix?: LintFix }`; `interface LintBinding { declaration: IncludableDeclaration \| null; path: string \| null; typesEnabled: boolean \| null; entry: IncludeEntry \| null }`; `interface LintInclude { include: Include; entry: IncludeEntry; target: IncludeTarget; binding: LintBinding; pipeline: boolean }`; `interface LintContext { file: ScriptSourceFile \| ConfigSourceFile; catalogue: Catalogue; lookup(name: string): LintBinding \| undefined; includes: readonly LintInclude[]; projections(): readonly Projection[]; configs(): readonly ConfigAst[] }`; `interface LintRule { code: string; check(context: LintContext): readonly LintFinding[] }`; `type Compatibility = "compatible" \| "incompatible" \| "unknown"`; `interface PackLints { codes: readonly DiagnosticCode[]; rules: readonly LintRule[]; advise(code: string, message: string): string; connection(source: FlowType \| null, node: GraphNode, port: Port, isRecord?: (name: string) => boolean): Compatibility }` (all fields readonly) |
| `packages/lang-2610/src/lints/index.ts` | `const lints: PackLints` |
| `…/lints/codes.ts` | `const CODES: readonly DiagnosticCode[]` (the table in 2.3) |
| `…/lints/advice.ts` | `advise(code: string, message: string): string`; `PARSE_ADVICE: readonly (readonly [RegExp, string])[]`; `INCLUDE_ADVICE: Readonly<Record<string, string>>` |
| `…/lints/scan.ts` | `forEachIt(root: AstNode, text: string, visit: (it: Variable, closure: Closure) => void): void`; `readsIn(nodes: readonly AstNode[]): ReadonlyMap<string, readonly { whole: boolean; property: string \| null }[]>`; `workflowCalls(def: WorkflowDef): readonly { call: MethodCall; statement: Statement; assigned: string \| null }[]`; `argumentCount(call: MethodCall): number`; `directiveCalls(def: ProcessDef \| AgentDef): readonly MethodCall[]`; `configPublishes(configs: readonly ConfigAst[]): boolean` |
| `…/lints/deprecated.ts` | `deprecatedWhen`, `deprecatedShell`, `deprecatedChannel`, `implicitIt`, `deprecatedDirective: LintRule`; `DIRECTIVE_ADVICE: Readonly<Record<string, string>>` |
| `…/lints/legacy.ts` | `legacyProcess`, `legacyWorkflow`, `legacyParams`, `paramsOutsideEntry`, `tupleWhereRecord`, `publishDir: LintRule` |
| `…/lints/typed.ts` | `missingType`, `typedProcessOutputs`, `publishTypeIgnored: LintRule` |
| `…/lints/names.ts` | `featureFlag`, `duplicateName`, `includeAlias`, `pipelineIncludeTypes`, `agentOutput`, `configIncludePlacement: LintRule` |
| `…/lints/calls.ts` | `callArity`, `unusedOutput: LintRule`; `declaredInputs(declaration: IncludableDeclaration): readonly string[] \| null` |
| `…/lints/types.ts` | `typeMismatch`, `multipleChannels: LintRule`; `connection` (as in `PackLints`); `assignable(target: TypeExpr, source: TypeExpr, isRecord?: (name: string) => boolean): boolean \| null`; `nfTypeName(type: TypeExpr): string`; `nfFlowTypeName(type: FlowType): string` |
| `packages/lang-2610/test/lints/fixtures/**`, `fixtures.json` | 2.7 |
| `packages/engine/src/diagnostics/ranges.ts` | `problemRange(text: string, problem: ParseProblem): Range` |
| `…/diagnostics/text-edits.ts` | `applyTextEdits(text: string, edits: readonly TextEdit[]): string` (throws `RangeError` on overlapping or out-of-range edits) |
| `…/diagnostics/context.ts` | `lintContext(options: { model: ProjectModel; projector: Projector; catalogue: Catalogue; path: string }): LintContext \| null` (null without an AST) |
| `…/diagnostics/diagnose.ts` | `interface DiagnoserOptions { model: ProjectModel; projector: Projector; catalogue: Catalogue; lints: PackLints }`; `interface Diagnoser { file(path: string): readonly Diagnostic[]; all(): readonly Diagnostic[] }`; `createDiagnoser(options: DiagnoserOptions): Diagnoser`; `interface DiagnosticCounts { errors: number; warnings: number; suggestions: number }`; `countDiagnostics(list: readonly Diagnostic[]): DiagnosticCounts`; `compareDiagnostics(a: Diagnostic, b: Diagnostic): number` |
| `…/diagnostics/lints.ts` | `loadLints(version: string, packs?: readonly LanguagePack[]): Promise<PackLints>` (memoised like `loadParser`) |
| `…/diagnostics/index.ts` | re-exports |
| `packages/engine/test/diagnostics/open.ts` | `diagnoseTree(dir: string): Promise<{ model: ProjectModel; diagnoser: Diagnoser; lints: PackLints }>`; `fixtureDirs(): readonly { code: string; kind: "positive" \| "negative" \| "fixed"; dir: string }[]` |

### 3.2 Change
- **`lang-core/src/diagnostic.ts`** (F-105's): `DiagnosticSeverity` gains `"suggestion"`; `QuickFix`; `Diagnostic.fix?`.
- **`lang-core/src/index.ts`:** `LanguagePack.loadLints(): Promise<PackLints>`; exports.
- **`lang-core/src/projection.ts`** (F-106's): `Port.argumentType: FlowType | null`.
- **`engine/src/projection/project.ts`** (F-106's): set `argumentType` for inline arguments from F-106's inline typing, and `Port.argument` for edge-fed arguments if F-106 didn't.
- **`lang-2610/src/index.ts`:** `loadLints: async () => (await import("./lints/index.ts")).lints`.
- **Engine test fake packs:** `palette.test.ts`, `packs.test.ts` and the parser and model tests get `loadLints`.
- **`engine/src/index.ts`:** export `createDiagnoser`, `countDiagnostics`, `loadLints`, `applyTextEdits` and the types.
- **`tools/oracle/src/trees.ts`:** `TreeManifest.files[].warnings?: Located[]`; `runTree` compares warnings when they are recorded, and strips `<tree dir>/` from messages (lint prints absolute paths).
- **`tools/oracle/src/{paths,cli}.ts`:** `LINT_FIXTURES_FILE` in the default trees.
- **`tools/corpus/src/lint.ts`:** `parseLintJson` also returns `warnings`; `LintResult.warnings`; a cache file without `warnings` is stale.
- **`lang-2610/test/index.test.ts`:** the lazy-lints assertions.
- **No change** to dependency-cruiser, workflows, root scripts, generated files or F-105's include code.

## 4. Tests (written before the implementation)

**Pack: `packages/lang-2610/test/lints/`**

| File: test | Asserts |
|---|---|
| `registry.test.ts`: `F-112 AR-05: every diagnostic code is described once, with severity, spec IDs, origin and upstream lines for ported codes` | the fields; `lintPattern` is set for lint origins |
| `…: F-112 LA-34: every directive the catalogue marks deprecated has advice` | |
| `…: F-112: the registry holds exactly the planned codes` (added in task 8) | the 2.3 list |
| `advice.test.ts`: `F-112 step 2 LA-30: every parser and builder message the pack can produce gets specific advice` | the five sources in 2.4 |
| `…: F-112 step 2 AR-03: include messages get advice and keep nf-lang's wording as their start` | |
| `rules.test.ts`: `F-112 LA-34: implicit it resolves to the nearest paramless closure, not to declared parameters or a def it` | nested closures, `{ -> it }`, a GString `${it}`, `it` outside closures |
| `…: F-112 LA-34: Channel is flagged only as a method receiver` | `Channel<Path>`, `channel.of` |
| `…: F-112 LA-33: argument counts follow nf-lang: named arguments count once, closures count` | |
| `…: F-112 LA-33: unused outputs follow the reads after the call; topic, publishDir and config publishDir exempt` | |
| `…: F-112 LA-31: config includes are allowed at the top level and directly in a profile only` | |
| `…: F-112 AR-05: duplicates are reported in nf-lang's declaration order, and functions may overload` | |
| `…: F-112 LA-31: agent output types are checked through record fields, with a cycle guard` | |
| `…: F-112 LA-36: params is flagged in processes, functions and named workflows, not in the entry workflow or the output block` | |
| `types.test.ts`: `F-112 LA-29 LA-32: compatibility follows nf-lang: process inputs compare elements; takes, emits and outputs compare kinds and elements` | the 1.3 table, both ways |
| `…: F-112 LA-29: unknown or wildcard types are never incompatible` | |
| `…: F-112 LA-32: type names print as nextflow lint prints them` | |
| `test/index.test.ts`: `F-112 LA-02 ADR-0006 QA-01: the pack loads its lints on demand and imports no lint module statically` | |

**Engine: `packages/engine/test/diagnostics/`**

| File: test | Asserts |
|---|---|
| `ranges.test.ts`: `F-112 LA-30: a parse problem's line and column map to its offsets` | astral characters, last line |
| `text-edits.test.ts`: `F-112 AR-05: applyTextEdits applies sorted, non-overlapping edits and rejects overlaps` | |
| `diagnose.test.ts`: `F-112 AR-05: diagnostics come from the parser, the model and the pack's rules, each with path, range, severity, message and code` | |
| `…: F-112 LA-30: syntax errors keep the parser's wording with advice, at lint's position` | |
| `…: F-112 IO-14: a rule that throws gives an internal warning and the other rules still run` | |
| `…: F-112 ADR-0004: rules see only the modelled part of a partial file` | |
| `…: F-112 UX-03: countDiagnostics counts errors, warnings and suggestions separately` | |
| `…: F-112 AR-31: diagnostics are plain data and deterministic` | `structuredClone`; two runs give deep-equal results |
| `…: F-112 LA-29: an edge whose type is unknown gives no diagnostic` | a legacy call feeding a typed process |
| `fixtures.test.ts`: `F-112 step 1: <code> has a positive and a negative fixture` | every code but `internal` |
| `…: F-112 step 1 <spec IDs>: <code> fires on its positive fixture and not on its negative` | |
| `…: F-112 step 1 ADR-0005: <code> matches nextflow lint on the fixtures` | lint, parser and model origins (2.7) |
| `…: F-112 ADR-0005: <code>'s severity matches the oracle` | |
| `…: F-112 step 2: every <code> message states what to do` | a ` -- ` clause starting with a verb from a fixed list, or a `verbatim` pattern; also prints the distinct messages to `messages.md` via `toMatchFileSnapshot` for review |
| `…: F-112 step 2 AR-05: every <code> diagnostic carries a quick fix, and applying the fixes gives its fixed tree with no <code> left` | the four fixable codes; byte-equal to `fixed/` |
| `…: F-112 step 2: <code> offers no quick fix` | the other codes |
| `agent-cases.test.ts`: `F-112 F-101: the eight agent ported cases get lint's message at lint's position` | `test/ported/cases.json`, owner F-112 |

**Corpus: `packages/engine/test/corpus/diagnostics.corpus.ts`** (`pnpm test:corpus`, CI `corpus-parse`)

| Test | Asserts |
|---|---|
| `F-112 LA-30 LA-31 LA-32 LA-33 ADR-0011: no pinned pipeline gets an error diagnostic, as nextflow lint reports none` | |
| `F-112 ADR-0005: on every pinned pipeline the ported warnings equal nextflow lint's` | 213 `when`, 3 `implicit-it`, every other lint-origin code 0 |
| `F-112 IO-14: diagnosing every pin never throws` | Appends "Diagnostics (F-112)" to `parse-corpus.md`: counts per code and pin, and the time taken |

**Tools**

| Test | Asserts |
|---|---|
| `tools/oracle/test/trees.test.ts`: `F-112: recorded warnings are compared, and the tree's absolute path is stripped from messages` | |
| `tools/oracle/test/cli.test.ts` (or wherever the default trees are asserted) | the default trees include the lint fixtures |
| `tools/corpus/test/lint.test.ts`: `F-112: parseLintJson keeps warnings; a cache file without warnings is re-linted` | |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-112` from `main` once F-106 has merged. Rebase 1.5's names on what was actually built. Each task writes its tests first, watches them fail, then implements.

1. **Oracle and corpus tools record warnings.**
   - Files: `tools/oracle/src/{trees,paths,cli}.ts`, `tools/corpus/src/lint.ts` and their tests.
   - Done when: `pnpm --filter @nf-builder/oracle test && pnpm --filter @nf-builder/corpus test && pnpm check`.
2. **Fixtures, part 1:** `syntax`, the three include codes and the 16 lint-origin codes (positive, negative, and `fixed/` for the four fixable ones), plus `fixtures.json`.
   - Record with `pnpm nextflow -- lint -o json .` in the tree. Convert with a throwaway script and never write messages by hand.
   - Check each construct against the docs, the catalogue and lint.
   - Done when: `pnpm oracle` (Java 17 to 26; otherwise CI `oracle`) passes the lint-fixtures tree, and `pnpm check`.
3. **Fixtures, part 2:** the 8 paranoid and ours codes, recorded the same way.
   - Done when: as in task 2.
4. **Types, registry and advice.**
   - Files:
     - lang-core `commands.ts`, `lint.ts`, `diagnostic.ts`, `index.ts`, the `projection.ts` field;
     - the pack's `lints/{index,codes,advice}.ts`, with `syntax` and the include codes only;
     - the entry's `loadLints`;
     - the fake packs;
     - `registry.test.ts`, `advice.test.ts`, `index.test.ts`.
   - Done when: `pnpm --filter @nf-builder/lang-2610 test && pnpm --filter @nf-builder/engine test && pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`.
5. **Engine diagnoser.**
   - Files: `diagnostics/*.ts`, `index.ts` exports, F-106's `argumentType`, `open.ts`, `ranges`/`text-edits`/`diagnose.test.ts`, and the `fixtures.test.ts` harness driven by the registry, so each later task switches on its own codes.
   - Done when: `pnpm --filter @nf-builder/engine test && pnpm check`.
6. **Rules: deprecations and legacy patterns** (LA-34, LA-35, LA-36): `deprecated.ts`, `legacy.ts`, `scan.ts` (part), and their codes and unit tests.
   - Done when: `pnpm --filter @nf-builder/lang-2610 exec vitest run test/lints && pnpm --filter @nf-builder/engine exec vitest run test/diagnostics && pnpm check`.
7. **Rules: typed warnings, names and includes** (LA-31, LA-37, AR-05): `typed.ts`, `names.ts`, `agent-cases.test.ts`.
   - Done when: as in task 6.
8. **Rules: calls and types** (LA-29, LA-32, LA-33): `calls.ts`, `types.ts`, `types.test.ts`, and the final registry test.
   - Done when: as in task 6, plus `pnpm --filter @nf-builder/engine test`.
9. **Corpus:** `diagnostics.corpus.ts` and the report section. A mismatch is fixed in a rule with a unit case, never allow-listed.
   - Done when: `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (or CI `corpus-parse`), and `pnpm check`.
10. **Records** (orchestrator, section 7).
    - Done when: `pnpm check` passes, and the Scope guard passes (with the `scope-change` label if open point 4 adds a feature).

## 6. Open points (each with a recommendation; none decided here)

1. **Rules in the pack, behind a lazy `LanguagePack.loadLints()`; the engine only assembles them.**
   - **Recommendation:** yes. It follows LA-02 and ADR 0006 and keeps QA-01 safe.
   - It replaces the sketch's `lints: LintRule[]`.
   - Record it in a new ADR, at the next free number when F-112 lands (0036 is free today; F-106, F-107 and F-108 take numbers first).
2. **Quick-fix shape.**
   - **Recommendation:** `QuickFix { title, command: ReplaceFileText }`, with `ReplaceFileText { kind, path, edits: TextEdit[] }`. A code editor's whole-text replace is one edit `[0, length)`.
   - The orchestrator should give this shape to F-111's planner now. Whichever feature lands first creates `lang-core/src/commands.ts`; F-111 adds `apply`, one undo step, and the refusal of stale or unparsable results.
   - If F-111 settles on `{ path, text }` instead, F-112 keeps its edits and F-309 builds the text with `applyTextEdits` when the fix is clicked.
3. **Message style.**
   - **Recommendation:** nf-lang's wording verbatim as the prefix, then ` -- <imperative>`. Verbatim exceptions are listed per code. Checked as in step 2.
4. **v0.1 rule set, and a new feature for the rest.**
   - **Recommendation:** the 2.3 set.
   - Add a feature in M3, "nf-lang name resolution and type-check parity", depending on F-112, F-107 and F-108. It would cover:
     - `x is not defined` and `assigned but not declared`;
     - unused variables and parameters;
     - globals in a process, and mutating external variables in closures;
     - deprecated operators under static typing, and directive closures;
     - config workflow handlers;
     - deprecated feature flags and constants;
     - `.out` before a call (F-107 note), and unresolved code-node reads (F-108 note);
     - operator, pipeline-call and record-structure types.
   - Adding a feature is fine, with the `scope-change` label.
5. **LA-33 arity severity.**
   - The spec says warning, but nf-lang rejects arity mismatches in both typed and legacy scripts.
   - **Recommendation:** error, by the severity definition. Amend LA-33 to say a missing argument (an unconnected input) is an error, and an unused output a warning.
6. **What `unused-output` means:** "a process with no topic or publish use".
   - **Recommendation:** the 2.3 definition. Exempt topics, a `publishDir` directive and config `publishDir` (which silences nf-core). It is per call, from AST reads, so it works before F-107 and F-108.
7. **Spec rows.**
   - **Recommendation:**
     - LA-31 gains feature flags, pipeline typing, agent outputs and config-include placement;
     - a new LA-37 row (warning): "typed-code warnings that `nextflow lint` reports: missing type annotations, several typed process outputs, a type in `publish:`";
     - duplicates and aliases are AR-05 model checks.
   - Record these in the ADR and in `language.md`.
8. **Paranoid checks** (`storeDir`, legacy params, params outside the entry workflow), which lint hides.
   - **Recommendation:** report them at the spec's severity, because LA-34 and LA-36 name them. They are checked by unit tests and fixtures; the oracle shows lint stays silent on them.
9. **LA-35 on vendored registry modules.**
   - **Recommendation:** no exclusion in v0.1. F-309 and F-405 group or filter them.
10. **LA-29 and LA-32 coverage.**
    - **Recommendation:** typed scripts only, as nf-lang does. Process and agent inputs, typed takes, emits and outputs (2.6). Anything else is unknown.
11. **LA-14 tuple arity** (an F-107 note).
    - **Recommendation:** not F-112's. It needs F-107's legacy ports and lint doesn't check it. Hand it to F-302 or F-504, which own LA-14 connections; they can use `connection` with tuple arity.
12. **`internal` diagnostics.**
    - **Recommendation:** a warning, engine-owned, not a lint, so no fixtures. A unit test drives it with a throwing fake parser or rule.
13. **`Port.argumentType`** added to F-106's projection.
    - **Recommendation:** yes. It lets inline arguments be type-checked (LA-32's "call argument").
14. **Oracle plumbing.**
    - **Recommendation:**
      - one combined lint-only tree;
      - manifests record warnings;
      - absolute paths are stripped;
      - the corpus lint cache keeps warnings (it is a cache, not a stored format).
    - These are small `tools/` changes, not workflow edits.
15. **No Playwright test** (Q13).
16. **AGENTS.md "Decide and record" items:**
    - no new runtime or dev dependency;
    - no boundary or dependency-cruiser change; the `LanguagePack` interface grows (the ADR);
    - no persisted or exported format (diagnostics are in memory; fixtures are test data);
    - no workflow edit;
    - `features.json`: notes, plus a new feature if point 4 is accepted;
    - no open question in `open-questions.md` is affected;
    - spec text changes: points 5 and 7 and the architecture sketch.

## 7. Records (drafts for the orchestrator)
- **ADR** "Diagnostics: pack lint rules, message style, quick fixes and lint parity" (`Accepted (agent)`): points 1–3, 5–8 and 10–13, and the 2.3 fix-or-not table with reasons; `docs/adr/README.md` row.
- **Spec:**
  - `architecture.md` sketch: `loadLints(): Promise<PackLints>`; AR-05 notes that a quick fix is a `ReplaceFileText` with edits;
  - `language.md`: the LA-31 additions, the LA-33 severity and LA-37.
- **`docs/licences.md`:**
  - a row for checks and messages ported from nf-lang v26.10.7 (`ScriptAstBuilder` warnings, script and config `VariableScopeVisitor`, `ResolveIncludeVisitor`, `ScriptResolveVisitor`, `TypeCheckingVisitor` call/emit/output/multi-channel checks, `CallArityVisitor`, `Types.isAssignableFrom`), with line references in `src/lints/`;
  - advice text derived from `docs/deprecations.mdx`, `strict-syntax.mdx` and `store-dir.mdx` (Apache-2.0).
- **`features.json` notes:**
  - **F-112** "Verified <date>":
    - step 1 by `fixtures.test.ts` (positive and negative per code, lint parity by the oracle tree);
    - the corpus test (0 errors; 213 `when` and 3 implicit `it` equal lint);
    - step 2 by the wording test and the four `fixed/` trees.

    No Playwright test.
  - Notes for **F-309, F-113, F-302, F-206 and F-405:** 2.8.
  - **F-111:** open point 2.
  - **F-302/F-504:** open point 11.
  - The new feature, if point 4 is accepted.
- **`progress.md` Decisions:** the ADR, the settled points, "diagnostics in memory; no new dependency".
- **READMEs:** one line in the engine README (diagnostics) and one in the lang-2610 README (lints).
- Delete `docs/plan/handoff/plan-F-112.md` when the feature merges, if this plan is stored there.

## 8. Evidence and how to repeat it

**Probe trees** (all under `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f112/`; the scratchpad may be cleared):
- `probe-types`, `probe-compat`, `probe-warn`: each has `lint.json`.
- `corpus-warn/<pin>.json`: full lint output with warnings for all five pins.
- `count.py`: summarises a lint JSON file.
- `up/CmdLint.groovy`: from `modules/nf-cli-v1` at v26.10.7.

**Upstream sources:** a sparse clone at v26.10.7 (commit `0ad848e`): `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f106/nf/src/`, covering `modules/nf-lang/src/main/java` and `docs/`.

**To repeat a lint:**
```
NXF_HOME=/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f112/nxfhome NXF_OFFLINE=true \
  /home/user/wt-F-105/.cache/nextflow/26.10.7/nextflow-26.10.7-dist lint -o json .
```

The corpus used is `/home/user/wt-F-105/.cache/corpus/<pin>`.

**Key files read:**
- `/home/user/wt-main/docs/spec/language.md`
- `/home/user/wt-main/docs/spec/architecture.md`
- `/home/user/wt-main/docs/plan/handoff/plan-F-105.md`
- `/home/user/wt-main/docs/plan/handoff/plan-F-106.md`
- `/home/user/wt-main/packages/lang-core/src/{source-file.ts,ast/script.ts,ast/config.ts}`
- `/home/user/wt-F-105/packages/lang-core/src/{diagnostic.ts,includes.ts}`
- `/home/user/wt-main/tools/oracle/src/trees.ts`
- `/home/user/wt-main/tools/corpus/src/lint.ts`
- `/home/user/wt-main/packages/lang-2610/test/ported/cases.json`
