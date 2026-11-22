# Plan: F-106, projection for typed workflows

I wrote this plan on 2026-11-22 without changing anything in the repo or any worktree. It is based on `main` at `7e34504`, after F-102 merged. Two other plans aren't built yet: `docs/plan/handoff/plan-F-104.md` and `plan-F-105.md`. Section 1.4 lists every name from those plans that this plan relies on.

## 0. Scope

F-106 computes a graph for each workflow from F-105's `ProjectModel`:
- **Nodes:** call, chain, factory, take, emit, params, output, and code.
- **Ports:** the ones that LA-20, LA-22, LA-24, LA-25 and LA-26 define.
- **Edges:** def-use edges, typed as `Channel<T>`, `Value<T>` or plain where known (LA-28).
- **Node ids:** the layout keys of ADR 0008, made precise. They depend only on names and order, so they survive whitespace changes and most small edits.

Steps 1 and 2 are checked by:
- snapshots of every typed workflow in the fixture sets and on the typed rnaseq-nf pin;
- whitespace changes that are guarded by F-104's `equivalent`.

Types are checked against `nextflow lint` itself, through a new oracle tree of type probes (1.3).

There is no UI, so there is no Playwright test (Q13).

**Out of scope:**
- **F-107:** the legacy forms (`.out`, `|`, `set`/`tap`), ports from legacy process qualifiers, and legacy operators that aren't in the catalogue.
- **F-108:** code-node inputs and free-variable analysis of whole statements.
- **F-111:** edits.
- **F-112:** diagnostics.
- **F-113:** caching and the worker.

## 1. Findings

### 1.1 Spec and ADRs
- **AR-10:** one projection per workflow. Its nodes are calls, chains, factories, takes, emits, params, output and code nodes. Its edges are def-use links between variables, call arguments and results.
- **AR-11 and ADR 0008:** node ids are layout keys, `<file>#<workflow>/<assigned variable>`, or `<callee>@<n>` when nothing is assigned. ADR 0008 is silent on:
  - the entry workflow;
  - reassignment;
  - take, emit, params and output nodes;
  - how `n` is counted.

  F-207 (`.nf-builder/layout.json`) will store these keys, so they are a stored format.
- **AR-12 and ADR 0008:** a chain is a maximal run of operator calls with no assignment in between. Closures live in the details pane.
- **LA-20:** a typed process has one input port per `input:` declaration, typed as declared. It has one output port per named output; a single unnamed output gives one port named `out`. Topics are not ports.
- **LA-22:** ports come from take and emit, with their types. **LA-24:** a chain has a receiver port, one port per channel argument, and one output. **LA-25:** a factory has no inputs and one output. **LA-26:** params has one output per parameter; output has one input per declared output.
- **LA-28:** edges carry `Channel<T>` or `Value<T>` where these are known.
- **ADR 0003:** the engine does parsing, modelling and projection, and the model types live in lang-core.
- **AR-31:** node components are presentational and keyed by projection node id. The projection must be plain data, because it goes from the worker to the UI.
- **ADR 0004:** no statement is dropped; an unmodellable statement becomes a code node.
- **ADR 0006 and LA-02:** the engine has no version literals.

### 1.2 Upstream typing rules
Source: nf-lang v26.10.7, `modules/nf-lang/src/main/java/nextflow/script/control/TypeCheckingVisitor.java`.
- **Process and agent calls** (`checkProcessCall` L974-L1065): the result is `Channel` if any argument is a `Channel`, or is dynamic but not a `null` constant; otherwise it is `Value`.
  - One output gives that type directly.
  - Several outputs give a `Record` of named fields, each wrapped in the dataflow kind.
  - Legacy (V1) processes are not handled there, so their result is dynamic.
- **Workflow calls** (`workflowOutputType`/`workflowEmitType` L754-L786): one emit gives its type directly; several give a `Record`. A plain emit type is wrapped as `Value<T>`.
- **Pipeline calls** (`checkPipelineCall`/`pipelineOutputType` L890-L970): the call takes one `record(...)` of params. Its outputs come from the target's output block, wrapped by `workflowEmitType`.
- **Operators:** their return types come from the declared signatures, with generic substitution. `DataflowOpResolver.java` only refines `combine`, `groupBy` and `join`.
- **Publish:** `asDataflowType` L271.

The pack catalogue (`catalogue/script.json`) carries the data:
- operators per receiver (`Channel` and `Value`), with signatures such as `collect() -> Value<Bag<E>>`, `mix(other: Channel<E>) -> Channel<E>`, `Value.flatMap -> Channel<R>`, `join(opts, right: Channel<Record>) -> Channel<Record>`, and `subscribe -> void`;
- factories, for example `fromPath -> Channel<Path>`, `of(E...) -> Channel<E>` and `value(V) -> Value<V>`;
- functions, for example `file -> Path`, `record -> Record` and `tuple -> Tuple`;
- `processSections.typedOutputs` (`stdout`, `env` and `eval` give `String`).

Legacy operators such as `first`, `concat`, `set` and `tap` are not in the catalogue. That matters for F-107.

### 1.3 Evidence from `nextflow lint` 26.10.7 (probes in the scratchpad, section 8)

**Annotation pair.** Every assignment was annotated with `def x: T = ...`.
- `probe-ok` has 0 errors.
- `probe-bad`, with the kinds flipped, has 6 errors such as `Assignment target with type Value<Path> cannot be assigned to value with type Channel<Path>`.
- So lint checks the Channel/Value kind exactly.

**Type reveal.** A probe line `def tN: Boolean = <expr>` makes lint print nf-lang's inferred type of `<expr>`. On a typed project like the planned fixture tree (`probe-proj-types`), lint printed:

| Expression | nf-lang type |
|---|---|
| `prepared.bams` | `Channel<Path>` (declared emit) |
| `prepared.logs` | `Channel<String>` (from `ALIGN(channel, value)` with output `log: String = stdout()`) |
| `prepared.index` | `Value<Path>` (`INDEX(plain Path)`, output `file('index')`) |
| `prepared` | `Record { bams…, logs…, index… }` |
| `LEGACY_COUNT(...)` | `Record { txt: ? }` |
| `SUB(record(input: ch))` (pipeline) | `Channel<String>` |
| `ch_names` (`fromList`, then `mix`) | `Channel<String>` |
| `params.samples` | `Channel<Sample>` |
| `params.fasta` | `Path` |
| `report = file(...)` | `Path` |
| `filter{}.combine(index: v)` | `Channel<Record>` |
| `aligned` (multi-output) | `Record { bam: Channel<Path>, log: Channel<String> }` |
| `aligned.bam.map{}` | `Channel<Path>` |

An agent call gives `Channel<String>` with a channel argument and `Value<String>` with a plain one (`probe-agent`).

The planned subset of rules (2.4) reproduces every **kind** above. It reproduces the **element** type wherever it infers one; it doesn't infer closure results (`R`).

The un-annotated project (`probe-proj`) lints clean, with warnings only. It covers every node kind, a pipeline call, a legacy call, reassignment, a multi-line chain with a named `combine` argument, and a record-input process with a topic.

### 1.4 Code facts and the F-104/F-105 names relied on

**AST facts (from F-102, merged):**
- `WorkflowDef { name | null, typed, takes: Section<TypedName>, main: Section<Statement>, emits: Section<NamedOutput | ExpressionStatement>, publishers: Section<NamedOutput> }`.
- `NamedOutput { name, type, value | null }`. A value of `null` means the emit names a variable.
- `TypedProcess` has `inputs: Section<TypedName | RecordInput | TupleInput>`, `outputs: Section<NamedOutput | ExpressionStatement>` and `topics`.
- `AgentDef` has the same inputs and outputs.
- `ParamsBlock.params: Param { name, type, defaultValue }` and `OutputBlock.outputs: OutputDecl { name, type }`.
- `MethodCall { receiver | null, method, args (source order, NamedArgument inline), closures }`.
- `PropertyExpr`, `Variable` and `TypeRef { name, typeArguments, nullable }`.
- `VariableDeclaration`, with `def x: T = e` allowed in workflows.
- An implicit main is a `Section` with `label: null`.
- `childNodes` and `walk` are in lang-core.
- `workflow`, `output`, `params`, `take` and `emit` are valid identifiers (`ScriptParser.g4#identifier` L624). For example, `workflow workflow {}` parses, so the entry workflow can't be keyed `workflow`.

| Name relied on | From | Used for |
|---|---|---|
| `ScriptSourceFile.ast: ScriptAst \| null`, `status` | F-104 | the AST of each workflow's file; no AST means no workflows |
| `Unparsed { head: DeclarationHead \| null, range }`, `DeclarationHead { keyword, name }`; `Unparsed` in `ScriptItem` | F-104 | unparsed workflows (listed, not projected); callees marked unparsed |
| engine `equivalent(a, b): Equivalence` | F-104 | step 2 guard: a perturbed text really is a whitespace-only change |
| `"types": ["node"]` in `engine/tsconfig.json` | F-104 | engine tests read files |
| `ProjectModel.file(path): FileModel \| undefined`, `paths()`, `lookup(path, name): Binding \| undefined` | F-105 | file ASTs; callee resolution |
| `openProject(version, files, options?)`, `ProjectFile` | F-105 | building models in tests |
| `FileModel { path, source }` | F-105 | walking files |
| `Binding = { kind: "declaration"; declaration } \| { kind: "include"; include: ScriptIncludeModel; entry: ResolvedEntry }` | F-105 | callee kind and declaration |
| `ScriptIncludeModel.target: IncludeTarget` (`kind` `file`/`missing`/`plugin`/`external`, `path`, `module`) | F-105 | callee file, registry module name, unresolved calls, plugin entries |
| `ResolvedEntry { declaration: IncludableDeclaration \| null, pipeline: boolean }`, `IncludableDeclaration` | F-105 | pipeline calls; `Unparsed` callees |
| test helper `packages/engine/test/model/read-tree.ts` | F-105 | reading fixture trees by path |

If F-104 or F-105 lands with other names, adjust sections 3 and 5 only. The algorithm doesn't depend on their internals.

## 2. Design

### 2.1 Where things live
- **lang-core `src/projection.ts`:** the projection types only. They are model types, shared by the engine and the web app (ADR 0003).
- **engine `src/projection/`:** all the logic. It is version-independent. Operator, factory, function and typed-output data come from the pack's `ScriptCatalogue`, which is passed in. The engine contains no version literals (open point 1).

### 2.2 Graph shape (plain data; every range is in the workflow's file)
- **Nodes:** `id`, `kind`, `label`, `inputs: Port[]`, `outputs: Port[]` and `range`, plus fields per kind:
  - call: `callee { name, kind: process | workflow | agent | pipeline | null, status: modelled | unparsed | unresolved, typed, path, module }`;
  - chain: `steps [{ operator, range, known }]`;
  - factory: `namespace`, `factory`;
  - take and emit: `name`.
- **Port:** `id`, `label`, `type: FlowType | null` and `argument: Range | null`.
  - Input port types are the declared types. Output port types are inferred.
  - `argument` is the expression feeding the input. F-111 rewrites it; F-206 shows inline values.
- **Edge:** `id`, `from {node, port}`, `to {node, port}` and `type`, which is the source port's type.
  - `variable`, for example `samples_ch`, `params.reads` or `res.txt`. It is `null` for a nested node.
  - `direct: false` when the use is an inline expression that reads the value, for example `record(input: samples)`.
- **Order:**
  - Nodes: `:params`, then the takes, then the main statements in creation order (arguments before the node using them), then the emits, then `:output`.
  - Edges are sorted by the target node and port, then by the source.

### 2.3 Statements (main section, in order, with a scope `name -> source`)
- **Dataflow expressions (DE):**
  - **Call:** a receiver-less call whose name looks up to a process, workflow, agent or pipeline entry. A `process`, `workflow` or `agent` `Unparsed` head counts too (status `unparsed`), as does a non-plugin include entry with no declaration (status `unresolved`). Functions, plugin entries and unknown names are not calls.
  - **Factory:** `channel.<f>(…)` or `Channel.<f>(…)`, with `f` among the catalogue factories.
  - **Chain:** an operator call whose receiver, followed down through further operator calls, ends at a DE or at a graph reference. An operator is a catalogue member of the receiver's dataflow type; if that type is unknown, either type counts.
  - **Parenthesised:** a `Parenthesized` DE.
- **Statement forms:**
  - `x = DE` or `def x[: T] = DE` gives nodes; the top node gets key `x`. The declared `T` wins over the inferred type.
  - A bare `DE` gives nodes with unassigned keys.
  - Anything else is a code node. If it assigns exactly one variable (`x = e` or `def x = e`), it gets that variable as an output, typed from inline rules (`file()` gives `Path`). It has no inputs; F-108 adds them.
- **Graph references:**
  - a variable bound in scope;
  - `params.<name>[...]`, which feeds port `<name>` of `:params`;
  - `<var>.<name>` on a node with several outputs, which feeds output port `<name>`;
  - any other property of a reference is an indirect edge from the reference.
- **Wiring an argument:**
  - a DE is projected as a nested node, with an edge from it;
  - a graph reference gives a direct edge;
  - otherwise, each graph value it reads (`variablesRead`) gives an indirect edge;
  - if it reads none, the argument is inline: the port's `argument` is set and there is no edge.
- **Using a multi-output source as a whole** gives one indirect edge per output port.
- **What doesn't wire:**
  - closures are never ports, and their reads are not edges;
  - factory arguments are not ports (LA-25).
- **Call ports:**
  - The inputs come from the callee's declaration:
    - `TypedName` gives a port named after it;
    - `RecordInput` gives `$i`, labelled `record(a, b)` and typed `Record`;
    - `TupleInput` gives `$i`, labelled `tuple(…)` and typed `Tuple`;
    - extra arguments give extra `$i` ports.
  - The outputs:
    - a process or agent gives one port per output, `out` for a single unnamed one;
    - a workflow gives one port per emit. A bare variable emit is named after the variable; a lone expression emit is `out`.
    - a pipeline call has the params as inputs and the output block as outputs. A `record(k: v, …)` argument maps `k` to its port; any other shape feeds one `$1` port.
    - an unresolved, unparsed or legacy callee falls back to inputs `$1..$n` and one `out` of unknown type. F-107 adds the legacy qualifier ports, behind the same `signature.ts` function.
- **Chain ports:** `in` for the receiver, then `<step>:<arg>` (both 1-based; `arg` indexes `MethodCall.args`) for each argument that is a DE or reads graph values, named or positional. The label is `op(paramName)`. A chain has one output, `out`, unless the last step returns `void`.
- **Single-output role nodes:** takes, factories and chains output `out`; an emit's input is `in`.
- **Emits:** each item is an emit node, `:emit:<name>`. Its value is wired like an argument; a `null` value reads the variable `<name>`. Its type is the declared type.
- **Publish:** each item wires its value into port `<name>` of `:output`.
- **`:params`:**
  - It appears in the entry workflow when the file has a `ParamsBlock`, and in any workflow that wires a `params.x` read.
  - Its ports are the declared params in order, then any undeclared names that are read (untyped).
  - `LegacyParam` is left to F-107.
- **`:output`:** it appears when the file has an `OutputBlock` or the workflow has a publish section. Its ports are the declared outputs, then any publish targets that aren't declared.
- **Not projected:** `onComplete` and `onError`.

### 2.4 Types (LA-28; "where known")
- **Representation:**
  - `TypeExpr { name, args, nullable }`, where `"?"` stands for a wildcard or an unknown argument;
  - `FlowType { dataflow: "channel" | "value" | "plain" | null, element: TypeExpr | null }`.
- **Declared types:** a `TypeRef` of `Channel<X>` gives a channel, `Value<X>` gives a value, and any other type is plain.
- **Inline expressions:**
  - a string or GString gives `String`, an integer `Integer`, a boolean `Boolean`;
  - a list or map literal gives `List` or `Map`;
  - a catalogue function call gives its return type;
  - `null` is a null constant;
  - anything else is unknown.
- **Process and agent outputs:** the declared `NamedOutput.type`; otherwise the inline or typed-output type of the value, or the declared type of an input it names. The dataflow kind follows the 1.2 call rule, where unknown arguments count as channels.
- **Workflow emit types:**
  - the declared type if there is one;
  - otherwise the type of the emit's source in the callee's own projection, which is memoised per projector;
  - a cycle gives unknown;
  - `workflowEmitType` wraps a plain type in `Value`.
- **Operators:**
  - The overload is chosen by:
    - argument count, where closures count and all named arguments together count as one Map;
    - whether the first parameter is a Map;
    - if several overloads still fit: their return type if they all agree, else their shared dataflow kind with an unknown element, else unknown.
  - Generic substitution: `E` and `V` become the receiver's element type; any other single-capital generic becomes `?`.
  - For factories, `E` and `V` come from the literal argument types when these all agree.
- **Not inferred** (open point 3):
  - closure results (`R`);
  - record field structure;
  - the components of `combine` and `groupBy` tuples;
  - unification through parameters such as `fromList(Iterable<E>)`.

### 2.5 Node ids (AR-11; stored by F-207; open point 2)

```
id    = path "#" workflow "/" local          workflow = name, or "" for the entry workflow
local = var | var "~" n                      node whose result is assigned to var (n-th assignment, n >= 2)
      | callee "@" n                         n-th unassigned node of that callee, n >= 1: PROC@1, channel.of@1, .view@1 (chain: "." + first operator)
      | ":code@" n                           n-th unassigned code node
      | ":take:" name | ":emit:" name | ":params" | ":output"
```

- The forms can't collide:
  - identifiers contain none of `~`, `@`, `.` or `:`;
  - role nodes start with `:`;
  - local parts contain no `/` or `#`;
  - parsing splits at the last `#`.
- The ids contain no offsets or line numbers, so whitespace never changes them.
- An edit changes a node's id only when it changes:
  - the node's variable;
  - its callee;
  - its order among unassigned nodes of the same callee;
  - its order among assignments to the same variable.

### 2.6 API
- `createProjector(model, catalogue)` returns a `Projector` with:
  - `workflows()`, which lists modelled and unparsed workflows;
  - `project(path, name)`, which returns a `Projection`, or `null` for an unparsed or missing workflow.
- The projector is a snapshot of the model. It memoises callee projections and is replaced after the model changes; F-113 owns invalidation.
- It never throws (IO-14).

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/projection.ts` | `interface TypeExpr { readonly name: string; readonly args: readonly TypeExpr[]; readonly nullable: boolean }`; `type Dataflow = "channel" \| "value" \| "plain"`; `interface FlowType { readonly dataflow: Dataflow \| null; readonly element: TypeExpr \| null }`; `type GraphNodeKind = "call" \| "chain" \| "factory" \| "take" \| "emit" \| "params" \| "output" \| "code"`; `interface Port { readonly id: string; readonly label: string; readonly type: FlowType \| null; readonly argument: Range \| null }`; `interface Callee { readonly name: string; readonly kind: "process" \| "workflow" \| "agent" \| "pipeline" \| null; readonly status: "modelled" \| "unparsed" \| "unresolved"; readonly typed: boolean \| null; readonly path: string \| null; readonly module: string \| null }`; `interface ChainStep { readonly operator: string; readonly range: Range; readonly known: boolean }`; `CallNode`, `ChainNode`, `FactoryNode`, `TakeNode`, `EmitNode`, `ParamsNode`, `OutputNode`, `CodeNode` (shared `id, kind, label, inputs, outputs, range` plus the 2.2 fields); `type GraphNode`; `interface GraphEdge { readonly id: string; readonly from: PortRef; readonly to: PortRef; readonly type: FlowType; readonly variable: string \| null; readonly direct: boolean }`; `interface PortRef { readonly node: string; readonly port: string }`; `interface WorkflowRef { readonly path: string; readonly name: string \| null; readonly modelled: boolean; readonly typed: boolean \| null; readonly range: Range }`; `interface Projection { readonly workflow: WorkflowRef; readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] }`; `type NodeKeyLocal = { kind: "assigned"; variable: string; occurrence: number } \| { kind: "unassigned"; callee: string; occurrence: number } \| { kind: "code"; occurrence: number } \| { kind: "take" \| "emit"; name: string } \| { kind: "params" } \| { kind: "output" }`; `interface NodeKey { readonly path: string; readonly workflow: string \| null; readonly local: NodeKeyLocal }` |
| `packages/engine/src/projection/keys.ts` | `formatNodeKey(key: NodeKey): string`; `parseNodeKey(id: string): NodeKey \| null`; `class KeyAllocator { constructor(path: string, workflow: string \| null); assigned(variable: string): string; unassigned(callee: string): string; code(): string; take(name: string): string; emit(name: string): string; params(): string; output(): string }` |
| `packages/engine/src/projection/types.ts` | `UNKNOWN: FlowType`; `typeFromRef(ref: TypeRef): TypeExpr`; `flowFromDeclared(ref: TypeRef \| null): FlowType \| null`; `parseTypeText(text: string): TypeExpr` (catalogue strings, `E...` varargs); `formatType(type: TypeExpr): string`; `formatFlowType(type: FlowType): string`; `wrapFlow(dataflow: Dataflow \| null, element: TypeExpr \| null): FlowType`; `asEmitType(type: FlowType): FlowType` (`workflowEmitType`) |
| `packages/engine/src/projection/library.ts` | `interface OperatorArguments { readonly positional: readonly (FlowType \| null)[]; readonly named: boolean; readonly closures: number }`; `interface DataflowLibrary { isFactory(namespace: string, name: string): boolean; factoryType(name: string, args: readonly (TypeExpr \| null)[]): FlowType; isOperator(name: string, receiver: Dataflow \| null): boolean; operatorType(name: string, receiver: FlowType, args: OperatorArguments): FlowType \| "void"; functionType(name: string): TypeExpr \| null; typedOutputType(name: string): TypeExpr \| null }`; `dataflowLibrary(catalogue: ScriptCatalogue): DataflowLibrary` (memoised in a `WeakMap`) |
| `packages/engine/src/projection/reads.ts` | `interface Read { readonly name: string; readonly property: string \| null; readonly range: Range }`; `variablesRead(expression: Expression): readonly Read[]` (closure params, implicit `it` and closure-local `def`s excluded; property, method and named-argument keys aren't reads) |
| `packages/engine/src/projection/signature.ts` | `interface PortSpec { readonly id: string; readonly label: string; readonly type: FlowType \| null }`; `interface Signature { readonly kind: Callee["kind"]; readonly typed: boolean \| null; readonly inputs: readonly PortSpec[]; readonly outputs: readonly PortSpec[] }`; `processSignature(def: TypedProcess \| AgentDef, library: DataflowLibrary): Signature` (element types; the dataflow kind is applied per call); `workflowSignature(def: WorkflowDef, emitType: (name: string) => FlowType \| null): Signature`; `pipelineSignature(ast: ScriptAst): Signature`; `fallbackSignature(kind: Callee["kind"], argumentCount: number): Signature` (F-107 adds `legacyProcessSignature` here) |
| `packages/engine/src/projection/project.ts` | `interface Projector { workflows(): readonly WorkflowRef[]; project(path: string, workflow: string \| null): Projection \| null }`; `createProjector(model: ProjectModel, catalogue: ScriptCatalogue): Projector` |
| `packages/engine/src/projection/index.ts` | re-exports |
| `packages/engine/test/projection/fixtures/**` | the typed fixture project, with type probes (task 1) |
| `packages/engine/test/projection/fixtures.json` | the oracle tree manifest: `{ fixtures: [{ file, lint: [{ line, column, message }] }] }`, with messages recorded from a real lint run |
| `packages/engine/test/projection/{render,open,whitespace,probes}.ts` | test helpers (5.0) |

### 3.2 Change
- `packages/lang-core/src/index.ts`: export the projection types.
- `packages/engine/src/index.ts`: export `createProjector`, `formatNodeKey`, `parseNodeKey`, `formatFlowType` and `formatType`, and re-export the projection types.
- `tools/oracle/src/paths.ts`: add `PROJECTION_FIXTURES_FILE`.
- `tools/oracle/src/cli.ts`: add it to the default trees, next to F-102's two.
- `tools/oracle/test/*`: update wherever the default tree list is asserted.
- **No change** to dependency-cruiser, workflows, root scripts, generated files or `features.json` scope.

## 4. Tests (written before the implementation)

### 4.0 Fixture tree and helpers
- **`fixtures/`** is one typed project, modelled on `probe-proj`:
  - `main.nf`: params block, factories, a pipeline call, a legacy call, reassignment, an unassigned chain, `log.info`, a plain value, a multi-line chain with a named `combine` argument, publish, and an output block;
  - `subworkflows/local/prepare/main.nf`: typed takes, and emits that are declared, assigned and bare;
  - `modules/local/align/main.nf`: a record input, two named outputs and a topic, plus a single unnamed output;
  - `modules/local/legacy_count/main.nf`;
  - `pipelines/sub.nf`;
  - an agent call, which lint accepts (`probe-agent`).
- **Type probes:** after each assignment worth checking, a line `def probe<N>: Boolean = <var | var.name | params.x>`.
  - The manifest records lint's error for each probe line; the probe lines are the only errors.
  - No probes on legacy call results (F-107).
- **`probes.ts`:** `stripProbes(text): { text; probes: { line, expression }[] }` removes whole probe lines; `parseNfType(message)` reads `Channel<…>`, `Value<…>`, `Record { a: T … }`, `?` and plain types.
- **`open.ts`:** `openTree(dir, { stripProbes? }): Promise<ProjectModel>` (on F-105's `read-tree.ts`) and `projectorFor(model)` (the real catalogue via `pack.loadCatalogue()`).
- **`render.ts`:** `renderProjection(p, text): string`. It writes one line per node (id, kind, label, callee, range) and one line per port with its type. Each edge sits under its target port as `<- node[port] Type via variable` (marked `indirect` when not direct); an inline argument shows its source text.
- **`whitespace.ts`:** `perturbWhitespace(text, ast, seed, kind: "indent" | "blank" | "trailing" | "crlf" | "all")`. It only acts at line starts and ends outside String/GString/comment ranges, and never after a `\` line continuation.

### 4.1 Unit tests: `packages/engine/test/projection/`

| File: test | Asserts |
|---|---|
| `keys.test.ts`: `F-106 AR-11 ADR-0008: node keys are <file>#<workflow>/<assigned variable>, or <callee>@<n> when nothing is assigned` | every 2.5 form, including entry `main.nf#/x`, `x~2`, `channel.of@1`, `.view@1`, `:code@1`, `:take:reads`, `:emit:out`, `:params`, `:output` |
| `…: F-106 AR-11: parseNodeKey inverts formatNodeKey and distinct keys never format alike` | 500 seeded keys, including variables named `workflow`, `output`, `params` and `take`, and paths containing `#` |
| `…: F-106 AR-11: the allocator numbers unassigned nodes per callee and assignments per variable, in source order` | |
| `types.test.ts`: `F-106 LA-28: declared types map to channel, value or plain flow types` | `Channel<Sample>`, `Value<Path>`, `Path`, `String?`, `Map<String, ?>`, null |
| `…: F-106 LA-28: every catalogue type text parses and formats back` | all `returns` and parameter types in `catalogue/script.json` |
| `library.test.ts`: `F-106 AR-12 LA-24: operators are the catalogue's Channel and Value members` | each operator with its receiver; `first`, `set`, `info` are not operators; an unknown receiver accepts either type |
| `…: F-106 LA-28: operator results follow the catalogue signature with the receiver's element type` | `collect`, `mix` on Value, `flatMap` and `map` on Value, `reduce`, `combine` named and positional, `join`, `view`, `filter`, `unique`, `subscribe` (void), and an unknown receiver whose overloads agree |
| `…: F-106 LA-25 LA-28: factory results follow the catalogue, with E and V from literal arguments` | `fromPath`, `of('a','b')`, `of(1,'a')` (unknown element), `value('x')`, `empty`, `topic`, `interval` |
| `…: F-106 LA-28: inline argument types come from literals and catalogue functions` | `file`, `record`, `tuple`, strings, integers, null, unknown |
| `reads.test.ts`: `F-106 AR-10: variablesRead finds the variables an expression reads and the property read from each` | `record(input: s, fasta: file(x))`; closure params, implicit `it` and closure `def`s excluded; GString interpolation; `params.a.b` gives `params`/`a` |
| `project.test.ts`: `F-106 AR-10 LA-20: a typed process call has one input per input declaration, typed as declared, and one output per named output; topics are not ports` | `ALIGN` in `PREPARE` |
| `…: F-106 LA-20: a single unnamed process output is one port named out` | `INDEX` |
| `…: F-106 LA-22: a workflow call has ports from take and emit with declared or inferred types; takes and emits are nodes in its own projection` | `PREPARE` |
| `…: F-106 AR-12 LA-24: a chain is the maximal run of operator calls with no assignment between; receiver and graph-fed arguments are ports, closures are not; one output` | `joined` |
| `…: F-106 AR-12: an assignment ends a chain` | `ch_names` factory, then the `ch_names~2` chain, then `.view@1` |
| `…: F-106 LA-25: a factory has no inputs and one output typed from the catalogue` | |
| `…: F-106 LA-26: the params node has one output per declared parameter, and the output node one input per declared output, fed by publish` | |
| `…: F-106 LA-28: a process or agent call returns Channel when any argument is a channel or unknown, else Value; plain workflow emits become Value` | |
| `…: F-106 LA-28: every edge carries its source port's type` | all fixture workflows |
| `…: F-106 AR-10: def-use edges read the latest assignment before the use; res.name reads that output; a nested call is its own node` | |
| `…: F-106 AR-10: a pipeline call takes the included pipeline's params and gives its outputs; record() arguments map to params` | `SUB` |
| `…: F-106 AR-10 ADR-0004: every main statement is one top node or one code node, every emit an emit node, every publish item an edge or port of the output node` | all fixture sets |
| `…: F-106 LA-14: a typed workflow's call to a legacy process is a call node with argument ports until F-107` | `LEGACY_COUNT`; `s1-typed-calls-legacy*` |
| `…: F-106 ADR-0004: calls to an Unparsed declaration or to an include with a missing target are call nodes marked unparsed or unresolved` | inline, intentionally broken modules |
| `…: F-106 AR-10: functions, plugin entries and unknown names are not call nodes` | inline |
| `…: F-106 AR-31: projections are plain data and deterministic` | `structuredClone` round trip; two projectors give deep-equal results |
| `…: F-106 AR-11: node ids are unique across every workflow of a project` | |
| `…: F-106: workflows() lists modelled and unparsed workflows; project() returns null for an unparsed or missing one` | |
| `…: F-106 IO-14: projecting never throws` | verbatim and partial files, self-recursion, an A→B→A cycle, an empty workflow |

### 4.2 Step 1: `snapshot.test.ts` and `types-oracle.test.ts`

| Test | Asserts |
|---|---|
| `F-106 step 1 AR-10 LA-28: <set>/<file>#<workflow> matches its projection snapshot` | Each typed workflow in:<br>• the F-102 typed fixtures (`packages/lang-2610/test/ast/fixtures/` as one project: `workflow-typed.nf#greet`, `output-block.nf#`, `pipelines/rnaseq.nf#`);<br>• `tools/oracle/cases/s1-typed-calls-legacy` and `s1-typed-calls-legacy-module`;<br>• the F-106 fixture tree (with probes stripped).<br>Snapshots go to `snapshots/<set>/<path-with-__>--<workflow or entry>.txt` |
| `F-106 step 1: every typed workflow in the fixture sets has a snapshot` | count guard |
| `types-oracle.test.ts`: `F-106 LA-28 ADR-0005: the dataflow kind of every probed value matches nextflow lint, and so does the element type wherever the projection infers one` | Probes are mapped to `(node id, port)` through 2.5. For `Record { … }` results, field names and kinds are compared with the node's output ports. Missing elements are printed as information. |
| `…: F-106: every probe line has exactly one recorded lint message, and nothing else is recorded` | manifest consistency |

### 4.3 Step 2: `identity.test.ts`

| Test | Asserts |
|---|---|
| `F-106 step 2 AR-11: ids, ports and edges are unchanged after a whitespace-only re-parse (<kind>, seed <s>) of <set>` | The guard `equivalent(original, perturbed)` holds first. Then node ids (in order), kinds, labels, port ids and types, and edges by endpoints, type and variable are equal; ranges are excluded. 5 kinds × 3 seeds on all three sets. |
| `F-106 AR-11 ADR-0008: ids of untouched nodes survive small edits` | An edited closure body, a changed literal argument, an added comment, a statement appended at the end of `main`, an added include. Once F-110 has merged, optionally also: each `test/printer/input/typed/*.nf` and its `formatted/` twin give the same ids. |

### 4.4 Corpus: `packages/engine/test/corpus/projection.corpus.ts` (`pnpm test:corpus`, CI `corpus-parse`)

| Test | Asserts |
|---|---|
| `F-106 step 1: the typed rnaseq-nf branch's workflows match their projection snapshots` | `main.nf#` and `modules/rnaseq.nf#RNASEQ` into committed `snapshots/rnaseq-nf-typed/`. Expected in outline:<br>• `RNASEQ(params.reads Channel<Sample>, params.transcriptome Path)` gives port `samples_ch: Channel<Record>`;<br>• the chain `[flatMap, collect]` gives `Value<Bag<?>>`;<br>• `MULTIQC` gives `out: Value<Path>`;<br>• `log.info` is `:code@1`;<br>• `:output` is fed by `samples` and `multiqc_report`;<br>• in RNASEQ, `INDEX` gives `Value<Path>`, `FASTQC` and `QUANT` give `Channel<Record>`, and the `join` chain has ports `in` and `1:1` |
| `F-106 step 2 AR-11: rnaseq-nf-typed ids are stable across whitespace-only re-parses` | as in 4.3 |
| `F-106 IO-14 AR-10: every workflow of every pinned pipeline projects without throwing, with unique ids and every statement represented` | Also appends "Projection (F-106)" to `.cache/reports/parse-corpus.md`: per pin, the workflows, nodes by kind, main statements and code nodes. This is F-107's baseline. |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-106` from `main` once F-105 has merged, and rebase sections 3 and 4 on the names it actually built. Each task writes its tests first, watches them fail, then implements.

1. **Fixture tree and oracle wiring.**
   - Files: `fixtures/**`, `fixtures.json`, `tools/oracle/src/{paths,cli}.ts` and the oracle tests.
   - Write the Nextflow code from `probe-proj`/`probe-agent`, checked against the docs and catalogue. Record the probe messages from a real `pnpm nextflow -- lint -o json` run; never write them by hand.
   - Done when `pnpm oracle` passes (Java 17 to 26; CI `oracle` otherwise) and `pnpm check` passes.
2. **Types and keys.**
   - Files: `lang-core/src/projection.ts` and exports; `engine/src/projection/{keys,types}.ts`; `keys.test.ts`, `types.test.ts`.
   - Done when `pnpm --filter @nf-builder/lang-core test && pnpm --filter @nf-builder/engine exec vitest run test/projection/keys.test.ts test/projection/types.test.ts` and `pnpm check` pass.
3. **Library and reads.**
   - Files: `library.ts`, `reads.ts`; their tests.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/projection/library.test.ts test/projection/reads.test.ts` and `pnpm check` pass.
4. **Projector, part 1.**
   - Scope; main statements (calls through `processSignature` and `fallbackSignature`, factories, chains, code shells); takes; edges and wiring; `createProjector`, `workflows()`; the helpers `open.ts` and `render.ts`; the 4.1 `project.test.ts` cases for these.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/projection` and `pnpm check` pass.
5. **Projector, part 2.**
   - Emits, publish and `:output`, `:params`; `workflowSignature` with memoised inference of callee emits and the cycle guard; pipeline calls; unparsed and unresolved callees; the remaining `project.test.ts` cases; engine `index.ts` exports.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
6. **Steps 1 and 2 on the fixtures.**
   - `probes.ts`, `whitespace.ts`, `snapshot.test.ts`, `types-oracle.test.ts`, `identity.test.ts` and the committed snapshots.
   - A disagreement with lint is fixed in the rules with a unit case; it is never allow-listed.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
7. **Corpus.**
   - `projection.corpus.ts` and the `rnaseq-nf-typed` snapshots.
   - Done when `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (or CI `corpus-parse`) and `pnpm check` pass.
8. **Records** (orchestrator, section 7).
   - Done when `pnpm check` passes and Scope guard passes without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **Placement.**
   - **Recommendation:** types in lang-core; all logic, including nf-lang's call-typing rules, in the engine; per-version data from the catalogue.
   - Alternative: a `LanguagePack.dataflow` hook. It would be more faithful to ADR 0006, but these rules have been stable since DSL2.
   - Record in the ADR.
2. **Node-key grammar (2.5).** It becomes a stored format when F-207 writes `layout.json`, so it falls under "Decide and record".
   - **Recommendation:** the 2.5 grammar, with `""` for the entry workflow (`workflow` is a legal workflow name), `~n` for reassignment, `.op@n` for chains, and a `:` prefix for role nodes.
   - Record in a new ADR that fills in ADR 0008's sketch without superseding it. Add an AR-11 pointer.
3. **Type depth.**
   - **Recommendation:** the 2.4 subset. Kinds match lint (1.3); element types are given where we infer them.
   - Not inferred: closure results, record fields, `combine`/`groupBy` tuples, and parameter unification. F-112 can add them if LA-32 needs them.
4. **Plain values.**
   - **Recommendation:** `dataflow: "plain"`, as nf-lang distinguishes them. Edges show `Path`, and F-205 draws them dashed like values.
   - Note it in the ADR as the reading of LA-28.
5. **Code nodes in F-106.**
   - **Recommendation:** shells keep every statement (ADR 0004), with the obvious output for a single-variable assignment (needed for publish wiring) and no inputs.
   - F-108 adds free-variable inputs and outputs for complex statements, replacing `codeNode()` in `project.ts`.
6. **What is a call node.**
   - **Recommendation:** processes, workflows, agents and pipeline entries, plus `Unparsed` heads (`unparsed`) and non-plugin include entries without a declaration (`unresolved`).
   - Not functions, plugin entries or unknown names; those become code.
   - Unparsed callees stay `kind: "call"` with a status. F-205 maps this to UX-22's "unparsed" style, rather than adding a ninth kind.
7. **Pipeline calls** (experimental in 26.10).
   - **Recommendation:** the target's params as inputs and its output block as outputs. `record(k: v)` maps to ports; any other argument shape feeds `$1`.
8. **Port names (2.3).**
   - **Recommendation:** the declared names; `out` and `in` for single ports; `$n` positionally; `<step>:<arg>` for chains; an unnamed expression emit is `out`.
9. **Closures and factory arguments don't wire** (ADR 0008, LA-25).
   - **Recommendation:** accept this. A param read only inside a closure or a factory shows as an unconnected params port.
10. **`:params` and `:output` presence and ports (2.3).**
    - **Recommendation:** as in 2.3. `LegacyParam` is left to F-107.
11. **Type oracle.**
    - **Recommendation:** an oracle *tree* with probe lines and exact positions. This is a small change to `tools/oracle/src` code, not a workflow edit. It is the strongest available evidence for LA-28.
    - Alternative: a `cases.yaml` entry with substring errors. That is weaker, because it doesn't pair messages to lines.
12. **Step 2 reading.**
    - **Recommendation:** "whitespace-only" means perturbations that F-104's `equivalent` accepts, at line starts and ends outside strings and comments. Add the small-edit test as extra evidence. F-110's formatter pairs are optional, because F-106 doesn't depend on F-110.
13. **Projector lifetime.**
    - **Recommendation:** each projector is a snapshot with its own memo. F-113 owns invalidation: a callee change affects its callers' ports, so re-project the workflows in the re-modelled files and in their dependants (F-105's `dependants()`).
14. **Playwright.**
    - **Recommendation:** none (Q13). The evidence is the unit tests plus CI `oracle` and `corpus-parse`.
15. **AGENTS.md decide-and-record items.**
    - No new runtime or dev dependency.
    - No package boundary or dependency-cruiser change.
    - Stored format: the node keys (point 2). The projection itself is in memory only.
    - No workflow edit.
    - No open question in `open-questions.md` is affected.

## 7. Records (drafts for the orchestrator)

- **ADR** "Projection model, node keys and dataflow types" (`Accepted (agent)`, the next free number): points 1–9 and 13, plus its `docs/adr/README.md` row.
- **`docs/spec/architecture.md`:** AR-11 points to the ADR for the key grammar.
- **`docs/licences.md`:** a row for the rules re-implemented from nf-lang v26.10.7's `TypeCheckingVisitor` (`checkProcessCall`, `workflowOutputType`/`workflowEmitType`, `pipelineOutputType`, `asDataflowType`; Apache-2.0, with line references in `project.ts`/`types.ts`).
- **READMEs:** one line in the engine README (projection) and one in the lang-core README (projection types).
- **`features.json` notes** (no scope change):
  - **F-106** "Verified …": step 1 by the snapshot tests and the corpus test; types by the oracle tree; step 2 by `identity.test.ts` and the corpus test. No Playwright test.
  - **F-107:** `.out` needs a callee-to-node map in the scope. Also: pipes, `set`/`tap` binding, `legacyProcessSignature` in `signature.ts`, legacy operators missing from the catalogue, `LegacyParam` on `:params`, `if` blocks (common in nf-core) as code for now, and the baseline report in `parse-corpus.md`.
  - **F-108:** replace the code-node shell, `codeNode()` in `project.ts`, and register its outputs in the scope; `variablesRead` is the start of its free-variable analysis.
  - **F-111:** `Port.argument`, the `ChainStep` ranges, node `range` and `Edge.direct` locate the text to patch; renames map keys through `parseNodeKey`/`formatNodeKey`.
  - **F-112:** `FlowType`/`TypeExpr` on ports (declared) and edges (source) for LA-29 and LA-32.
  - **F-113:** projections are plain data; re-project after a change as in point 13.
  - **F-205/F-206/F-207/F-307/F-308:** node kinds, `callee.status`/`typed`/`module`, ids as layout keys, and the take, emit and chain steps.
- **`progress.md` Decisions:** the ADR, points 3–12 as settled, and "projection in memory only; no new dependency".

## 8. Evidence and how to repeat it

These are in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f106/`; the scratchpad may be cleared.
- **Probes:**
  - `probe-ok` (0 errors) and `probe-bad` (6 kind-mismatch errors);
  - `probe-proj` (the fixture-tree draft, lint-clean);
  - `probe-proj-types` (its type reveal, 15 messages in 1.3);
  - `probe-agent`.
- **Upstream sources:**
  - `nf/src/modules/nf-lang/src/main/java/nextflow/script/control/TypeCheckingVisitor.java` and `DataflowOpResolver.java` (a sparse clone at tag v26.10.7);
  - `docs/*.mdx` (fetched at v26.10.7): `workflow-typed.mdx` (pipeline composition L65-L175), `process.mdx` (singleton outputs L1105-L1116), `process-typed.mdx` (outputs L324-L436), `workflow.mdx` (calling and named outputs L508-L629).
- **To repeat a lint:**

```
NXF_HOME=/home/user/wt-F-110/.cache/nextflow/home NXF_OFFLINE=true NXF_SYNTAX_PARSER=v2 \
  /home/user/wt-F-110/.cache/nextflow/26.10.7/nextflow-26.10.7-dist lint -o json .
```

- **The typed rnaseq-nf pin** is at `/home/user/wt-F-110/.cache/corpus/rnaseq-nf-typed/` (`main.nf`, `modules/rnaseq.nf` and four typed process modules).
