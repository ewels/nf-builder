# Plan: F-107, projection for legacy workflows

Written 2026-11-22. Based on `main` at `47c03b3` and `feat/F-104` at `63d19b4`, plus the unbuilt F-105 and F-106 plans. Section 1.5 lists every F-106 name it relies on.

## 0. Scope

F-107 extends F-106's projector to cover legacy forms.
- **Legacy process ports** come from qualifiers (LA-21). They are used for both legacy and typed callers (LA-14).
- **`.out` access:** `X.out`, `X.out.name`, `X.out[n]`, and a variable assigned a process name.
- **Pipes `|` and fork `&`.**
- **`set { v }` and `tap { v }`** are treated as assignments.
- **Legacy operators and factories** missing from the catalogue, such as `first`, `last`, `concat` and `channel.from`.
- **Legacy `params.x = …`** become `:params` ports.

The measured corpus (1.2) needs three more forms for step 2's 90%: alias statements, call-result properties, and conditional dataflow. The plan includes them as separable work: task 6, and the rules in 2.4 marked "alias" and "call-result property". The decision is open point 2.

**Steps:**
- Step 1: snapshots of every workflow in the rnaseq, sarek, fetchngs and rnaseq-nf pins, plus legacy fixture snapshots that run in `pnpm check`.
- Step 2: a modelled-share report per workflow in the `parse-corpus` report, with an assertion that the overall share is at least 90%.

**Out of scope:**
- F-108: code-node ports.
- F-111: edits, including rewriting pipes or `set`.
- F-112: lints, including LA-14 tuple arity and `.out` before a call.
- F-113.
- Playwright: there is no UI (Q13).

## 1. Findings

### 1.1 Spec and ADRs
- **AR-14:** legacy workflows may use `.out`, `|`, `set` and `tap`.
- **LA-21:** one input port per input line. A tuple is one port whose label lists its components. One output port per output line, named by `emit:`, else by index.
- **LA-28:** for legacy code, queue versus value is inferred where possible, and `T` may be unknown.
- **AR-12 and ADR 0008:** a chain is a maximal run of operators with no assignment in between.
- **AR-11:** F-106's key grammar is unchanged.
- **ADR 0004:** anything else becomes a code node.
- **LA-02:** version data comes from the pack.
- **LA-14:** a typed workflow may call legacy processes.

### 1.2 Corpus measurements

Method:
- Files parsed with F-104's `parseScriptSource`.
- Includes resolved by relative path.
- F-106's rules simulated in a scratch script.

The pins are `.cache/corpus` under `/home/user/wt-F-104`.

| | rnaseq | sarek | fetchngs | rnaseq-nf | all |
|---|---|---|---|---|---|
| legacy workflows | 29 | 81 | 7 | 2 | 119 |
| top-level main statements | 398 | 843 | 41 | 9 | 1291 |
| `.out.<name>` reads | 507 | 621 | 13 | 0 | 1141 |
| `.out` as a whole, `.out[n]`, `\|`, `&` | 0 | 0 | 0 | 0 | 0 |
| `set {}` / `tap {}` | 27 / 0 | 2 / 1 | 0 | 0 | 29 / 1 |
| operators not in the catalogue | first 20, distinct 2 | concat 8, last 4, collate 2, first 1 | – | – | 37 |
| `channel.from` (not in the catalogue) | 2 | 0 | 0 | 0 | 2 |
| `if` statements (those containing a call, factory or `.out`) | 144 (128) | 206 (142) | 7 (1) | 0 | 357 (271) |
| statements inside `if` branches | 441 | 555 | 15 | 0 | 1011 |
| ternaries choosing between dataflow values | 3 | 44 | 0 | 0 | 47 |
| `x = x.mix(…)` reassignments | 48 | 53 | 0 | 0 | 101 |
| `x = PROC` (process used as a value) | 9 | 0 | 0 | 0 | 9 |
| `def (a, b) = …` | 1 | 2 | 0 | 0 | 3 |
| legacy `params.x = …` | 14 | 38 | 0 | 3 | 55 |
| legacy processes | 79 | 131 | 9 | 4 | 223 |

**Legacy process ports:**
- 581 input lines: tuple 370, path 128, val 83. There are no `each`, `env`, `stdin` or `file` inputs.
- 943 output lines: tuple 907, path 36. Of these, 259 carry `topic:`.
- Only 5 processes have an unnamed output: rnaseq-nf has 4 with a single output, and rnaseq has 1 with several.

**Closures:** 106 of the 955 closures in workflows read a workflow variable, mostly plain-value takes. F-106's rule that closures never wire is kept.

**Share of statements modelled.** "Statements" means main statements. Once dataflow `if`s are transparent, their branch statements replace them; an `if` with no dataflow inside counts once.

| Rules | rnaseq | sarek | fetchngs | rnaseq-nf | overall |
|---|---|---|---|---|---|
| F-106 only | 53.3 | 47.0 | 26.8 | 88.9 | 48.6 (627/1291) |
| + `.out`, set/tap, legacy operators, pipes (AR-14's list) | 62.3 | 74.3 | 36.6 | 88.9 | 69.5 |
| + alias `x = <reference>`, `CALL(…).name` | 70.4 | 77.3 | 46.3 | 88.9 | 74.3 (959/1291) |
| + transparent dataflow `if`s | 90.4 | 88.9 | 54.3 | 88.9 | 88.6 (1827/2061) |
| + ternary/elvis between dataflow values | 91.0 | 91.6 | 54.3 | 88.9 | 90.5 (1866/2061) |
| + `x = PROC` aliases | 92.2 | 91.6 | 54.3 | 88.9 | 91.0 (1875/2061) |

**Removing one rule from the last row:**

| Without | Overall |
|---|---|
| alias statements | 74.4 |
| `.out` | 56.7 |
| call-result properties | 89.2 |
| set/tap | 89.3 |
| legacy operators | 89.9 |
| ternaries | about 89.1 |

So every row is needed, and the margin is about 1 point (roughly 20 statements). The simulation is approximate, so the real figure can differ by 1 to 2 points.

**Per workflow (last row):** 98 of 119 workflows are at 90% or more, and 80 are at 100%. The lowest are nf-core utility subworkflows that are Groovy by nature:
- `PIPELINE_INITIALISATION`: 0–31%;
- `UTILS_*`: 0–15%;
- `SAMPLESHEET_TO_CHANNEL`: 27%, made of validation `if`s that call `error()`.

What remains unmodelled is plain Groovy, or function calls that take channels (`gatherPileups(X.out.table)`). These stay code nodes (F-108).

### 1.3 Behaviour checked with Nextflow 26.10.7 (`lint` and `run -stub`)

**Docs at v26.10.7:**
- `workflow.mdx`: `.out` at L608–L629; `|` and `&` at L666–L723, including `channel.of('Hello') | map {…} | (greet & to_upper) | mix | view`.
- `process.mdx`: `emit:` at L1065–L1089; singleton outputs at L1105–L1116.
- `reference/operator.mdx` `*Returns:*` lines: these return a **dataflow value**: `collect`, `count`, `countFasta`, `countFastq`, `countJson`, `countLines`, `first`, `last`, `max`, `min`, `reduce`, `sum`, `toList`, `toSortedList`.

**nf-lang sources:**
- `VariableScopeVisitor.java` L773–L786: `set` and `tap` count as assignments only when the closure is exactly one bare variable.
- `ASTUtils.java` L226–L229: `.out` resolves only on a process or workflow name.
- `WorkflowDslV1.java` L44–L86 lists the operators allowed in pipes. Its return types (`Channel`, `Object`, `void`) say nothing about queue versus value.

**`probe-legacy`** (lint clean, and it runs):
- pipes with a fork into `mix` and `view`;
- `tap`/`set`, `.out[2]`, and `.out.name` in emits;
- a ternary over `.out`.

`def runner = GREET2` placed before the call fails at run time ("has not been invoked before accessing"). An alias placed after the call, in both `if`/`else` branches, works.

**`probe-typed-out`:** in a typed workflow, lint rejects:
- `HELLO.out`: "Process `HELLO` cannot be used as a variable";
- operators in pipes: "`map` is not defined".

`set { v }` is accepted in typed workflows.

**`probe-kind`** (runtime class of each value):

| Value | Runtime class |
|---|---|
| `first()`, `collect()`, `last()`, `Value.map` | `DataflowVariable` (a value) |
| `channel.of`, `concat` | `DataflowBroadcast` (a channel) |
| a process with an `each` input, called with a value and a list | `DataflowBroadcast` (a channel) |
| a legacy call result | `ChannelOut` |

### 1.4 Code facts
- **Legacy process inputs and outputs:** `LegacyProcess.inputs` and `outputs` are `Section<ExpressionStatement>`. Items are calls such as `tuple val(meta), path(reads)` or `path x, stageAs: 'y'`, or a bare `stdin`.
- **Pipes and forks:** a pipe is `Binary "|"` and a fork is `Binary "&"`; `(A & B)` is `Parenthesized`. A `map {…}` inside a pipe is a receiver-less `MethodCall`.
- **`set`:** a `MethodCall` with one `Closure` whose body is a single `ExpressionStatement(Variable)`.
- **Other fields used:** `LegacyParam { target: PropertyExpr, value }` and `WorkflowDef.typed`.
- **Catalogue entries used:** `processSections.inputs` and `outputs` list the legacy qualifiers. `typedOutputs` gives `env`, `eval` and `stdout` the type `String`.
- **Operators missing from the catalogue (17):** `buffer`, `collate`, `concat`, `countFasta`, `countFastq`, `countJson`, `countLines`, `distinct`, `first`, `last`, `merge`, `randomSample`, `set`, `splitFasta`, `splitFastq`, `splitJson`, `tap`. The catalogue has 37 operators, including deprecated legacy ones.

### 1.5 F-106 names relied on (planned, not built)

| Name | Used for |
|---|---|
| lang-core `projection.ts`: `Projection`, `GraphNode` and the node kinds, `Port`, `GraphEdge`, `PortRef`, `FlowType`, `Dataflow`, `TypeExpr`, `Callee`, `ChainStep.known` | shapes; F-107 adds `guards` and `statements` |
| `keys.ts` `KeyAllocator` (`assigned`, `unassigned`, `code`) | keys for set/tap targets, pipe nodes, ternary branches |
| `types.ts` `UNKNOWN`, `wrapFlow`, `parseTypeText` | legacy port types |
| `library.ts` `DataflowLibrary` (`isOperator`, `operatorType`, `isFactory`, `typedOutputType`), `dataflowLibrary(catalogue)` | operators, factories, `stdout`/`env`/`eval` types |
| `reads.ts` `Read`, `variablesRead` | indirect reads of `.out.name` |
| `signature.ts` `PortSpec`, `Signature`, `processSignature`, `workflowSignature`, `fallbackSignature`, and the `legacyProcessSignature` slot | legacy ports; unknown callees |
| `project.ts` `createProjector(model, catalogue)`, `Projector.project`, the statement loop, recognition of dataflow expressions (2.3), memoised callee projections | dispatch of the new forms |
| test helpers `open.ts` (`openTree`, `projectorFor`), `render.ts` (`renderProjection`), `whitespace.ts` (`perturbWhitespace`), the `snapshot.test.ts` layout | fixtures and snapshots |
| `project.test.ts` cases "F-106 LA-14 … until F-107" and "F-106 AR-10 ADR-0004: every main statement is one top node or one code node…" | updated and generalised |
| F-105 `openProject`, `ProjectModel.lookup`, `Binding`, `ResolvedEntry` (through F-106) | resolving callees to a `LegacyProcess` |

**Requested of F-106 (open point 1):** `packages/engine/src/projection/scope.ts` with:

```ts
export interface Value { readonly node: string; readonly ports: readonly PortSpec[] }
export interface ReadPath { readonly name: string; readonly properties: readonly string[] }
export interface ResolvedRead { readonly variable: string; readonly sources: readonly { readonly port: PortRef; readonly type: FlowType | null }[] }
export class WorkflowScope {
  lookup(name: string): readonly Value[];          // always one value in F-106
  bind(name: string, values: readonly Value[]): void;
  resolveRead(read: ReadPath): ResolvedRead | null; // F-106 2.3 graph references, including params.<p> and <var>.<name>
}
```

The request also includes `Read.properties: readonly string[]`, the full chain of simple property names.

## 2. Design

### 2.1 Where things live
- **Engine `projection/`:**
  - `legacy.ts`: `.out`, pipes, `set`/`tap`;
  - `conditional.ts`: transparent `if`s and ternaries;
  - `coverage.ts`;
  - additions to `signature.ts`, `library.ts`, `scope.ts` and `project.ts`.
- **lang-2610 `src/legacy-operators.ts`:** the 17 names with their result kinds, read from the docs `*Returns:*` lines.
- **lang-core:** the `LegacyOperator` type, `LanguagePack.legacyOperators`, and the projection additions.

### 2.2 Legacy process ports (LA-21), via `legacyProcessSignature`

**Inputs,** one per `inputs` item, in order:
- Qualifier: the call's method name, or a bare `stdin`.
- Id: the declared identifier (`val x`, `path x`, `file x`, `env X`, `each x`, `each path(x)`); otherwise `$<i>`, counting from 1.
- Label: the identifier; `tuple(<c1>, <c2>…)` where each component is its identifier or string text; `stdin`; or the pattern text.
- Element type:

  | Qualifier | Element type |
  |---|---|
  | `path`, `file` | `Path` |
  | `env`, `stdin` | `String` |
  | `tuple` | `Tuple` |
  | `val`, `each` | unknown |

- Dataflow kind: `null`.

**Outputs,** one per `outputs` item, in order:
- Id and label: the `emit:` value; otherwise `out` when it is the only output; otherwise `[<i>]`, counting from 0 as `.out[i]` does.
- `topic:` and `optional:` outputs stay ports.
- Element type:

  | Qualifier | Element type |
  |---|---|
  | `path`, `file` | `Path` |
  | `env`, `eval`, `stdout` | from `library.typedOutputType` (`String`) |
  | `tuple` | `Tuple` |
  | `val` | unknown |

**Result kind:** a channel if any argument is a channel or unknown, or if the process has an `each` input; otherwise a value (1.3). This replaces F-106's fallback for every caller of a legacy process.

### 2.3 `.out` (legacy workflows only)
- **What the scope tracks:**
  - `calls`: for each callee, the values of the calls that can reach this point;
  - `aliases`: for each variable, a callee (`v = PROC`).
- **How a reference resolves:**
  - `X.out` gives the whole result of the reaching calls;
  - `.out.<name>` gives port `<name>`;
  - `.out[<integer literal>]` gives the n-th output in declaration order;
  - an alias resolves to the callee's reaching calls at the point where it is used.
- **Callees with no known signature** (unresolved or unparsed): output ports `<name>` and `[n]` are created on demand, as `:params` does for undeclared reads.
- **`X.out` before any call of X:** not a graph reference.
- **Where `.out` resolution applies:** in `resolveRead` (indirect reads and F-108 code-node inputs), chain receivers, arguments, emits and publish.

### 2.4 Statement forms

**Alias** (applies to both workflow styles):
- `x = R` or `def x = R`, where R is a graph reference, creates no node. `x` is bound to R's values.
- `x = PROC` (legacy only) binds a callee alias.
- `def x` and `x = null` bind `x` to nothing.

**Call-result property:** `CALL(…).name` and `CALL(…)[n]` are graph references to the nested call node. This applies to both styles.

**`set` and `tap`** (both styles; nf-lang's shape: a closure that is exactly one bare variable):
- `E.set { v }` behaves like `v = E`: E's top node is keyed `v`.
- `.tap { v }` ends the chain at that point. The prefix's top node is keyed `v` and feeds the rest of the chain (AR-12).
- On a bare reference, both are aliases.
- Any other shape is not modelled.

**Legacy operators** (legacy workflows only):
- The pack's `legacyOperators` names count as operators on any non-plain receiver.
- Their result kind comes from the pack: `value` or `channel`; `assign` marks `set` and `tap`.
- Chain steps for them get `known: false`.
- A catalogue operator whose overloads all fail on argument count takes the dataflow kind that all its overloads share.
- `channel.<f>` or `Channel.<f>` with `f` not in the catalogue is a factory of unknown type.

**Pipes** (legacy only). In `L | R`, L must be a dataflow expression or a graph reference.
- `R` is a callee name: a call with L's values spread over its inputs in order. A multi-output L gives one argument per output.
- `R` is an operator name, or `op(args) {…}` with no receiver: a chain step with receiver L. Consecutive operator pipes form one chain.
- `R` is `(A & B …)`: calls `A(L)` and `B(L)`. The result is the list of their outputs.
- A multi-valued receiver of an operator puts its first value on `in` and the rest on argument ports. This is how `| mix` after a fork works.
- `| set { v }` binds `v`.
- Anything else in a pipe is code.

**`LegacyParam`:** in the entry workflow, `:params` gets one port per distinct `params.<name>` target, in source order. These come after block params and before undeclared reads.

### 2.5 Conditional dataflow (open point 2; task 6)

**Transparent `if`:**
- An `if` with no modelled statement in its branches stays one code node.
- Otherwise the `if` is transparent, and each statement in its branches is projected in order.
- These nodes get `guards: Guard[]`, ordered outer to inner. Each guard is `{ condition: Range, branch: "then" | "else" }`; else-if chains nest.

**Reaching definitions:**
- Bindings are sets, and each value in a set gives its own edge.
- A branch starts from a copy of the scope.
- After the `if`, each name holds the union across branch ends, plus the incoming set when there is no `else`.
- A `def` inside a branch block disappears after it, matching nf-lang's block scope.
- `calls` and `aliases` are joined the same way.

**Ternary and elvis:** `x = c ? A : B` or `x = a ?: b`, where at least one branch is a dataflow expression or a graph reference and the others read no graph value.
- Branches that are dataflow expressions become nodes guarded by `c`.
- `x` is bound to the union of all branches.
- Keys: the then-branch top node is `x`, the else-branch top node is `x~2`, the same as for if/else.

**Conditions** are not wired.

### 2.6 Coverage (step 2)
- `Projection.statements` lists, in order, every main statement as a `ProjectedStatement { range, nodes, binds, modelled, guards }`. A transparent `if` is replaced by its branch statements, recursively.
- `modelled` is true when the statement produced no code node.
- `projectionCoverage(p)` returns `{ statements, modelled }`.
- The overall share is the sum of `modelled` over the sum of `statements` across every corpus workflow.

### 2.7 Gating

| Rule | Workflow style |
|---|---|
| `.out`, callee aliases, pipes, legacy operators and factories | legacy only (lint rejects `.out` and pipes in typed code) |
| `set`/`tap`, aliases, call-result properties, conditionals | both |

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-2610/src/legacy-operators.ts` | `legacyOperators: readonly LegacyOperator[]`: the 17 names from 1.4, with a docs reference |
| `packages/lang-2610/test/legacy-operators.test.ts` | |
| `packages/engine/src/projection/legacy.ts` | `setTarget(call: MethodCall): { readonly form: "set" \| "tap"; readonly variable: string } \| null`; `outPath(e: Expression): { readonly callee: string; readonly selector: string \| number \| null } \| null`; `pipeSteps(e: BinaryExpr): readonly PipeStep[] \| null`, where `PipeStep = { kind: "source"; expression: Expression } \| { kind: "call"; callee: string; range: Range } \| { kind: "operator"; call: MethodCall \| Variable } \| { kind: "fork"; callees: readonly string[] }` |
| `packages/engine/src/projection/conditional.ts` | `isTransparentIf(s: IfStatement, modelled: (s: Statement) => boolean): boolean`; `branchesOf(e: Expression): readonly { expression: Expression; guard: Guard }[] \| null` (ternary/elvis) |
| `packages/engine/src/projection/coverage.ts` | `projectionCoverage(p: Projection): { readonly statements: number; readonly modelled: number }` |
| `packages/engine/test/projection/legacy/*.test.ts` | section 4 |
| `packages/engine/test/projection/legacy/snapshots/**` | |
| `packages/engine/test/corpus/legacy-projection.corpus.ts` | |
| `packages/engine/test/corpus/snapshots/legacy-projection/<pin>/**` | |
| `tools/oracle/cases/f107-legacy-dataflow/**` | the 4.0 fixture |
| `tools/oracle/cases/f107-legacy-kinds/main.nf` | the 4.0 fixture |

### 3.2 Change
- **`lang-core/src/projection.ts`:** add `interface Guard { readonly condition: Range; readonly branch: "then" \| "else" }`. Add `guards: readonly Guard[]` to the shared node base. Add `interface ProjectedStatement { readonly range: Range; readonly nodes: readonly string[]; readonly binds: readonly string[]; readonly modelled: boolean; readonly guards: readonly Guard[] }`. Add `Projection.statements: readonly ProjectedStatement[]`.
- **`lang-core/src/index.ts`:** add `interface LegacyOperator { readonly name: string; readonly result: "channel" \| "value" \| "assign" }` and `LanguagePack.legacyOperators: readonly LegacyOperator[]`.
- **`lang-2610/src/index.ts`:** set `legacyOperators`.
- **`engine/.../signature.ts`:** add `interface LegacySignature extends Signature { readonly repeats: boolean }`; `legacyProcessSignature(def: LegacyProcess, library: DataflowLibrary): LegacySignature`; `legacyResultDataflow(s: LegacySignature, args: readonly (Dataflow \| null)[]): Dataflow`.
- **`engine/.../library.ts`:**
  - `dataflowLibrary(catalogue, legacy: readonly LegacyOperator[] = [])`;
  - new methods `isLegacyOperator(name): boolean` and `legacyResult(name): LegacyOperator["result"] \| null`;
  - the fallback for operators with no fitting overload.
- **`engine/.../scope.ts`:** `calls`, `aliases`, `fork(): WorkflowScope`, `join(ends: readonly WorkflowScope[], exhaustive: boolean): void`, and `.out` handling in `resolveRead`.
- **`engine/.../reads.ts`:** add `Read.properties`, unless F-106 already has it.
- **`engine/.../project.ts`:**
  - dispatch for 2.3–2.6;
  - `createProjector(model, catalogue, options?: ProjectorOptions)` with `interface ProjectorOptions { readonly legacyOperators?: readonly LegacyOperator[] }`;
  - guards are added in the statement loop after a node is built, so the signature of `codeNode()` doesn't change.
- **`engine/src/index.ts`:** export `projectionCoverage` and `ProjectorOptions`.
- **Test helpers:**
  - `open.ts` `projectorFor` passes `pack.legacyOperators`;
  - `render.ts` adds a `guards` line, `binds`, and a header `statements N, modelled M`.
- **F-106 `project.test.ts`:** the two cases named in 1.5 get new expectations and are generalised; they are not weakened.
- **F-106 snapshots:** regenerated.
- **`tools/oracle/cases/cases.yaml`:** two cases.
- **No change** to dependency-cruiser, workflows, root scripts or generated files.

## 4. Tests (written before the implementation)

### 4.0 Fixtures
Each fixture is an oracle case. Check every construct with `pnpm nextflow -- lint` and run with `-stub`, with stubs on every process.

**`f107-legacy-dataflow`:**
- `main.nf`: legacy `params.x = …`; the docs pipe example with `&`, `mix` and `view`; `tap`/`set`; `.out.name` and `.out[0]`; `runner = PROC` inside if/else after the calls; a ternary over `.out`; `first`, `last`, `concat`, `collate`, `distinct`; `channel.from` (keep it only if run accepts it).
- `modules/local/*`: every legacy qualifier (val, path, file, tuple, each, env, stdin), with outputs that use `emit:`, `topic:`, `optional:`, a lone unnamed output, and several unnamed outputs.
- `subworkflows/local/sub/main.nf`: takes; `if` around calls with `x = x.mix(…)`; emits through `.out`.

**`f107-legacy-kinds`:**
- Probe lines `println("probe <expr> ${<expr>.getClass().getSimpleName()}")`.
- `cases.yaml` `run.output` lists the probe lines, recorded from a real run.

### 4.1 Unit tests: `packages/engine/test/projection/legacy/`

| File: test | Asserts |
|---|---|
| `signature.test.ts`: `F-107 LA-21: a legacy process has one input port per input line; a tuple is one port labelled with its components` | F-102's `process-legacy-io.nf` ALIGN and the fixture modules |
| `…: F-107 LA-21: legacy outputs are named by emit:, else out when alone, else [i]; topic and optional outputs stay ports` | |
| `…: F-107 LA-21 LA-28: output element types follow the qualifier; results are values only when every argument is a value or plain and no input is each` | |
| `…: F-107 LA-14 LA-21: a typed workflow's call to a legacy process has its qualifier ports` | replaces F-106's "until F-107" expectation; `s1-typed-calls-legacy*` |
| `library.test.ts`: `F-107 AR-14 LA-28: the pack's legacy operators are operators on dataflow receivers in legacy workflows, with their documented result kind` | `first`/`last` give a value; `concat` gives a channel; not on plain receivers; not in typed workflows; `join(b)` keeps a channel |
| `lang-2610/test/legacy-operators.test.ts`: `F-107 LA-02: legacy operators come from the pack and none duplicates a catalogue operator` | |
| `out.test.ts`: `F-107 AR-14: X.out.name and X.out[n] read that output of the reaching call of X; X.out reads all its outputs` | process and workflow callees |
| `…: F-107 AR-14: a variable assigned a process name resolves .out through that process's calls` | rnaseq's `ch_star_out` shape |
| `…: F-107 AR-14: .out before any call is not a reference; an unresolved callee gains output ports on demand` | |
| `…: F-107 AR-14 AR-10: .out in emits, publish, chain receivers and indirect reads wires the right port` | |
| `statements.test.ts`: `F-107 AR-10: an assignment of a graph reference creates no node and binds the variable` | |
| `…: F-107 AR-10: CALL(…).name is that output of the nested call` | |
| `…: F-107 AR-14 AR-12: set binds the expression's top node; tap ends the chain and keys its prefix` | F-102's `legacy-dataflow.nf`: `channel.of('x').tap { copy }.set { original }` |
| `…: F-107 LA-26: legacy params.x = … give :params ports in source order` | |
| `pipes.test.ts`: `F-107 AR-14: a pipe into an operator is a chain step and into a process a call; a fork calls each process with the same input` | the docs example: `channel.of@1` → `.map@1` → `GREET@1` and `TO_UPPER@1` → `[mix, view]` |
| `…: F-107 AR-14: a multi-output left side spreads over the process inputs; \| set { v } binds` | |
| `…: F-107: \| that is not a pipe stays code` | |
| `conditional.test.ts`: `F-107 AR-10: statements inside an if with dataflow become nodes carrying their guards; an if without dataflow is one code node` | |
| `…: F-107 AR-10: after an if, uses read every reaching definition; without else, the previous one too; defs inside a branch are gone` | |
| `…: F-107 AR-14: .out after an if/else reaches the calls in both branches` | |
| `…: F-107 AR-10 AR-11: a ternary over dataflow makes guarded nodes keyed x and x~2 and binds x to both` | also elvis |
| `coverage.test.ts`: `F-107 step 2 ADR-0004: every projected statement is listed once, with nodes, a binding or one code node` | generalises F-106's statement test |
| `…: F-107 step 2: projectionCoverage counts transparent ifs by their branch statements` | |
| `kinds-oracle.test.ts`: `F-107 LA-28 ADR-0005: legacy queue and value kinds match the class nextflow run -stub prints` | `DataflowVariable` is a value; `DataflowBroadcast` and `DataflowQueue` are channels; `ChannelOut` is skipped |
| `snapshot.test.ts`: `F-107 step 1 AR-14 LA-21: <set>/<file>#<workflow> matches its projection snapshot` | `f107-legacy-dataflow`, F-102's `legacy-dataflow.nf`, `s1-legacy-calls-typed*` |
| `identity.test.ts`: `F-107 AR-11: legacy ids are unchanged after whitespace-only re-parses` | F-106 helper; 5 kinds × 2 seeds |

### 4.2 Corpus: `packages/engine/test/corpus/legacy-projection.corpus.ts`

| Test | Asserts |
|---|---|
| `F-107 step 1 AR-14 LA-21: <pin>/<file>#<workflow> matches its projection snapshot` | rnaseq, sarek, fetchngs and rnaseq-nf: 119 files, each headed `statements N, modelled M` |
| `F-107 step 1: every workflow of the pins has a snapshot` | count guard |
| `F-107 step 2 ADR-0004: the share of statements modelled is reported per workflow and is at least 90% overall` | Writes "Legacy projection (F-107)" to `.cache/reports/parse-corpus.md`: per pin, per workflow sorted by share, and overall. Uploaded by CI as `parse-corpus-report`. |
| `F-107 IO-14 AR-11: every corpus workflow projects without throwing, with unique ids` | |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-107` from `main` after F-106 merges. Rebase on F-106's built names first. Each task writes its tests first, watches them fail, then implements.

0. **Scope extraction.** Only if F-106 lacks `scope.ts`.
   - Extract it in a small `refactor(engine)` PR, shared with F-108 (open point 1).
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
1. **Pack data.**
   - lang-core types; lang-2610 `legacy-operators.ts` and its test; `dataflowLibrary(…, legacy)`; `ProjectorOptions`; `projectorFor`; the library tests.
   - Done when `pnpm --filter @nf-builder/lang-2610 test`, `pnpm --filter @nf-builder/engine exec vitest run test/projection/legacy/library.test.ts` and `pnpm check` pass.
2. **Fixtures.**
   - The two oracle cases and their `cases.yaml` entries. Record the run output; never write it by hand.
   - Done when `pnpm oracle -- --case f107-legacy-dataflow --case f107-legacy-kinds` (Java 17 to 26; CI `oracle` otherwise) and `pnpm check` pass.
3. **Legacy signature (2.2).**
   - Update the F-106 LA-14 test and regenerate the F-106 snapshots. Review the diff: only the legacy-call ports should change.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
4. **`.out`, aliases, call-result properties, set/tap, legacy operators and factories, `LegacyParam` (2.3, 2.4); `Projection.statements` and `coverage.ts`.**
   - `out`, `statements` and `coverage` tests.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/projection` and `pnpm check` pass.
5. **Pipes and fork.**
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/projection/legacy/pipes.test.ts` and `pnpm check` pass.
6. **Conditionals (2.5).** Only if open point 2 is accepted.
   - `scope.fork`/`join`, transparent `if`s, ternaries, and `conditional.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
7. **Snapshots, kinds oracle and identity.**
   - `render.ts`; fixture snapshots; `kinds-oracle.test.ts`; `identity.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
8. **Corpus.**
   - `legacy-projection.corpus.ts` and the committed snapshots. If the share lands below 90%, report the figure and the leftover statement kinds instead of loosening the assertion.
   - Done when `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (or CI `corpus-parse`) and `pnpm check` pass.
9. **Records** (orchestrator, section 7).
   - Done when `pnpm check` passes and Scope guard passes; it needs the `scope-change` label only if open point 2 splits the feature.

## 6. Open points (each with a recommendation; none decided here)

1. **Shared scope API (1.5).**
   - **Recommendation:** amend F-106's plan, task 4, to create `scope.ts` with `lookup`, `bind`, `resolveRead` and multi-value bindings, plus `Read.properties`.
   - This makes F-107 and F-108 independent. Otherwise task 0 is done once, by whichever feature starts first.
2. **Step 2 is unreachable with AR-14's four forms (74%; 1.2).**
   - **Recommendation:** keep it inside F-107:
     - alias statements, call-result properties and callee aliases (task 4);
     - transparent dataflow `if`s with guards and reaching definitions, and ternary/elvis (task 6).
   - Record this in an ADR and amend AR-14. The overall share is measured as in 2.6.
   - Alternatives:
     - split task 6 into a new feature that F-107's step 2 depends on (`scope-change` label);
     - lower the target with an ADR. This is weaker, and AGENTS.md forbids weakening a step without an ADR.
   - The margin is about 1 point, so the corpus test may need one more small rule.
3. **Legacy operator data.**
   - **Recommendation:** pack data: `LanguagePack.legacyOperators`, the 17 names, with kinds taken from the docs `*Returns:*` lines. It is passed through `createProjector`'s options.
   - Alternative: extend `gen:catalogue` with `WorkflowDslV1`. That gives no queue/value kinds, misses `tap`, `dump` and `count*`, and changes the generator.
4. **Port ids.**
   - **Recommendation:**
     - inputs: the identifier, else `$i` (counting from 1);
     - outputs: the `emit:` name, else `out` when alone, else `[i]` (counting from 0, as `.out[i]` does). A lone unnamed output matches F-106's typed `out`.
5. **Aliases create no node.**
   - **Recommendation:** accept this. Record them in `Projection.statements`, and generalise F-106's "one node per statement" test (4.1). The new invariant is stricter.
6. **Unknown callees with `.out.<name>`.**
   - **Recommendation:** create output ports on demand, as `:params` does.
7. **Gating (2.7).**
   - **Recommendation:** as tabled. This leaves F-106's typed snapshots unchanged, except for legacy calls and the set/tap and alias forms.
8. **Result kind with `each`.**
   - **Recommendation:** a channel, as the run probe shows.
9. **Corpus snapshots.**
   - **Recommendation:** all 119 workflows, committed, with a `docs/licences.md` row for the corpus-derived files. Licence per pin as recorded for F-103's config snapshots.
10. **Placeholder declarations.**
    - **Recommendation:** `def x` and `x = null` bind to nothing. This adds a few statements and isn't counted in the 91.0%.
11. **Playwright.**
    - **Recommendation:** none (Q13).
12. **Decide-and-record items:**
    - no new dependency;
    - no package boundary or dependency-cruiser change; `LanguagePack` gains a field, which is an API change, not a boundary;
    - no stored-format change, because the key grammar is unchanged;
    - no workflow edit;
    - a spec change (AR-14) and an ADR (points 2–10).

## 7. Records (drafts for the orchestrator)
- **ADR** "Legacy and conditional dataflow in projections" (`Accepted (agent)`, the next free number), with its README row.
- **AR-14** in `docs/spec/architecture.md`: add aliases and conditional dataflow, and point to the ADR.
- **`docs/licences.md`:**
  - the corpus-derived snapshots;
  - the operator kinds from Nextflow docs v26.10.7 (Apache-2.0);
  - the rules from nf-lang `VariableScopeVisitor` (set/tap) and `ASTUtils` (`.out`).
- **`features.json` notes:**
  - **F-107** "Verified …".
  - **F-111:** pipes, `set`/`tap`, guards and aliases have no argument ranges to rewrite yet.
  - **F-112:** LA-14 tuple arity from the declaration; `.out` before a call; legacy operators with `known: false`.
  - **F-205:** guards, and several edges into one port.
- **`progress.md` Decisions:** the ADR, the settled points, and the measured share.

## 8. Evidence

All in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/` (it may be cleared).
- **Survey scripts:** `f107/scripts/survey.ts`, `survey2.ts`, `ifs.ts`, `closures.ts`.
  - Run: `node --experimental-transform-types --no-warnings <script> /home/user/wt-F-104/.cache/corpus <out>`.
  - Outputs in `f107/out/`: `survey.txt`, `scenarios.txt`, `per-workflow.tsv`, `remaining-dataflow.txt`.
  - `survey2.ts` is a ready seed for task 8.
- **Probes:** `f107/probe-legacy`, `f107/probe-kind`, `f107/probe-typed-out`.
- **To repeat a lint:** `NXF_HOME=<scratch> NXF_OFFLINE=true /home/user/wt-F-104/.cache/nextflow/26.10.7/nextflow-26.10.7-dist lint -o json .` (and `run main.nf -stub`).
- **Upstream sources:** `f106/nf/src` (v26.10.7, commit `0ad848ef`).
