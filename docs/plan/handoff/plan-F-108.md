# Plan: F-108, code nodes with free-variable ports

Written 2026-11-22, on the same base as F-107. Section 1.5 lists the F-106 names relied on.

## 0. Scope

F-108 replaces F-106's code-node shell (`codeNode()` in `project.ts`). Each code node's ports come from a free-variable analysis of its statement (AR-13, LA-27, ADR 0004):
- inputs are the free variables the statement reads that resolve to graph values;
- outputs are the variables it assigns.

Which statements become code stays F-106's (and F-107's) decision.

**Steps:**
- Step 1:
  - a runnable fixture of arbitrary Groovy statements, with code nodes wired to the right producers;
  - a lint oracle tree that proves the free-variable analysis.
- Step 2:
  - each code node's text is exact and re-parses to the same statement;
  - projecting changes nothing.

  Both are checked on fixtures and on the corpus.

**Out of scope:**
- F-107: its legacy forms.
- F-111: moving, editing or deleting code.
- F-112: lints.
- F-205: UI. UX-22 and UX-28 rely on `label` and `text`.
- Playwright: there is no UI (Q13).

## 1. Findings

### 1.1 Spec
- **AR-13:** an unmodellable statement becomes a code node, with ports from a free-variable analysis.
- **LA-27:** inputs are free variables that resolve to graph values; outputs are the variables it assigns.
- **ADR 0004:** a code node holds the text, and its ports are inferred from the variables it reads and assigns.
- **UX-22:** a code node shows a monospace preview of its first line.
- **UX-28:** a code node shows its full text on hover.
- **Glossary "equivalent":** the meaning F-104 implemented in `equivalent`.

### 1.2 nf-lang scoping (`VariableScopeVisitor.java`, v26.10.7)

| Rule | Lines |
|---|---|
| Assignment without `def`, in a workflow, declares the name at workflow scope (an error inside closures) | L657–L678 |
| Blocks open a scope | L603–L609 |
| A catch block declares its variable | L612–L617 |
| An assignment visits its value before its target | L620–L636 |
| A mutated target's root (`x.p =`, `x[i] =`) is a read | L685–L713 |
| `set`/`tap` declare their variable | L773–L786 |
| A declaration visits its initializer first | L831 onwards |

### 1.3 Lint probes (`f108/probe-free`, `probe-free2`, `probe-free3`)

An isolated statement's free reads are exactly lint's "`v` is not defined" errors. There is one error per occurrence, at the variable's position.

**Reported** (`a1` twice in `a1 + a1`):
- reads inside closures;
- `if` conditions;
- GString interpolations;
- mutated roots: `acc.prop = v` reports `acc`; `lst[idx] = e` reports `lst` and `idx`;
- `lst2 << x`;
- ternary and elvis operands;
- `obj?.p`.

**Not reported:**
- closure parameters;
- `it` in a closure without parameters;
- catch variables;
- an earlier `def` in the same block;
- a name implicitly declared earlier in the same statement (assigned in `then`, read in `else`);
- map keys and named-argument keys;
- method names after a receiver.

**Reported although they are function names:** implicit-this calls such as `compute(x)`, and `fn4(1)` even when `fn4` holds a closure. So method names are never reads, and the oracle drops errors at method-name positions.

**Compound assignment:** `acc1 += 1` with `acc1` undeclared gives no error, because nf-lang declares the target first.

**A reader line placed after the statement** finds these defined:
- implicit declarations;
- tuple targets;
- `set`/`tap` targets.

It finds block-local and closure-local `def`s (`inner`, `loc`) not defined.

### 1.4 Corpus (from the F-107 survey)

- **Under F-106 alone,** 664 of 1291 top-level statements in the legacy pins are code nodes.
- **Under F-107's full rules,** 186 of 2061 statements are code nodes, about 130 of them reading no graph value.

The kinds that remain:
- plain-value assignments: strings, lists, maps, ternaries over params;
- logging and validation calls;
- list building with `<<` or `.add(…)` (21);
- function calls that take channels;
- `if`s with no dataflow (86);
- `def (a, b) = …` (3);
- `workflow.onComplete`.

### 1.5 F-106 names relied on (planned, not built)

| Name | Used for |
|---|---|
| lang-core `CodeNode`, `Port`, `GraphEdge`, `PortRef`, `FlowType` | node shape; F-108 adds `CodeNode.text` |
| `keys.ts` `KeyAllocator.assigned(variable)`, `.code()` | code-node ids |
| F-106 2.4 inline typing (the helper the shell uses for `x = file(…)`), `library.functionType` | the type of a single-assignment output |
| `reads.ts` `variablesRead` | consistency test only |
| `project.ts` `codeNode()` (replaced), the statement loop that binds code outputs, `createProjector`, `Projector.project` | the call site |
| test helpers `open.ts` (`openTree`, `projectorFor`), `render.ts`, `whitespace.ts` (`perturbWhitespace`); the `snapshot.test.ts` layout; the `fixtures/` tree | fixtures, snapshots, identity |
| oracle tree manifests (`loadTreeManifest`, the `PROJECTION_FIXTURES_FILE` pattern, format `{ fixtures: [{ file, lint: [{ line, column, message }] }] }`) | the free-variable probe tree |
| F-104 `createSourceFile`, `printSourceFile`, `equivalent`, `pack.loadParser()` | step 2 |
| F-105 `openProject`, `read-tree.ts` (through F-106) | tests |

**Also relied on:** the `scope.ts` amendment requested in F-107's 1.5 (`WorkflowScope.lookup`, `bind` and `resolveRead`, with `ReadPath` and `ResolvedRead`). F-108 only calls it, so F-107's `.out` extensions reach code-node inputs automatically.

## 2. Design

### 2.1 Free-variable analysis (`free-variables.ts`)

The walk goes in source order. It keeps a stack of block scopes and a set W of names this statement has declared at workflow scope so far.

**Reads:**
- A read is any `Variable` that isn't a method name.
- Its `properties` are the simple names that follow it: `params.reads` gives `["reads"]`. The chain stops at an index, a call or `*.`.
- A read is free unless it is declared in an enclosing block or closure scope, or is in W.
- Not reads:
  - method names, property names, and map or named-argument keys;
  - closure parameters, or `it` when a closure has no parameters;
  - catch variables inside their catch.

**Declarations and assignments:**
- `def` at the statement's top level: initializer first, then the targets go into W and are writes.
- `def` inside a nested block or closure: local, so not a write.
- `=`, `op=` and tuple targets: value first. Then each name is either reassigned (a write, unless it is block-local) or implicitly declared into W (a write).
- Assignments inside closures are local.
- A compound target (`x += 1`) is a read flagged `compoundTarget`, as well as a write.
- `x.p = v` and `x[i] = v`: `x` is a read and not a write (open point 3).
- `.set { v }` and `.tap { v }` (a single bare variable): `v` goes into W and is a write.

### 2.2 Code node (`code.ts`)

**Inputs:**
- Each distinct free read, in first-read order, is resolved through `scope.resolveRead({ name, properties })`. Whole `params` is skipped (open point 5).
- Each resolved `variable` (`x`, `res.bam`, `params.reads`, and with F-107, `FOO.out.bam`) is one input port.
- Its edges come from every source, with `direct: false` and the source port's type.
- Reads that resolve to nothing get no port: functions, built-ins, unbound names.
- Reads inside closures count (open point 2).

**Outputs:**
- One port per write, in first-write order.
- Type: for a single `x = e` or `def x = e`, F-106's inline type of `e`; otherwise unknown.
- The caller binds each output in the scope, replacing the earlier binding.

**Id:** `assigned(first write)`, or `code()` when the node has no writes (open point 6). F-106's key grammar is unchanged.

**Label and text:**
- `label`: the first non-blank line, trimmed (UX-22).
- `text`: exactly `file.text.slice(range.start, range.end)` (UX-28).

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/projection/free-variables.ts` | `interface FreeRead { readonly name: string; readonly properties: readonly string[]; readonly range: Range; readonly inClosure: boolean; readonly compoundTarget: boolean }`; `interface Write { readonly name: string; readonly range: Range; readonly declared: boolean }`; `interface StatementVariables { readonly reads: readonly FreeRead[]; readonly writes: readonly Write[] }`; `statementVariables(statement: Statement): StatementVariables` |
| `packages/engine/src/projection/code.ts` | `interface CodeContext { readonly scope: WorkflowScope; readonly keys: KeyAllocator; readonly library: DataflowLibrary; readonly text: string }`; `buildCodeNode(statement: Statement, context: CodeContext): { readonly node: CodeNode; readonly edges: readonly GraphEdge[]; readonly writes: readonly string[] }` |
| `packages/engine/test/projection/code/*.test.ts` and `snapshots/**` | section 4 |
| `packages/engine/test/projection/code/free-variables/main.nf` | the probe tree, lint errors on purpose |
| `packages/engine/test/projection/code/free-variables.json` | the tree manifest, with every lint error recorded from a real run |
| `packages/engine/test/corpus/code-nodes.corpus.ts` | |
| `tools/oracle/cases/f108-code-nodes/**` | the 4.0 fixture |

### 3.2 Change
- **`lang-core/src/projection.ts`:** `CodeNode` gains `readonly text: string`.
- **`engine/.../project.ts`:** call `buildCodeNode` instead of `codeNode()` and delete the shell. No other change.
- **`engine/.../index.ts`:** export `statementVariables`.
- **`tools/oracle/src/paths.ts`:** add `FREE_VARIABLE_PROBES_FILE`.
- **`tools/oracle/src/cli.ts`:** add the tree to the default trees.
- **`tools/oracle/test/*`:** update wherever the tree list is asserted.
- **`tools/oracle/cases/cases.yaml`:** one case.
- **F-106 snapshots:** regenerated.
- **No change** to `render.ts` (ports and edges already render), dependency-cruiser, workflows, scripts or generated files.

## 4. Tests (written before the implementation)

### 4.0 Fixtures

**`f108-code-nodes`** is an oracle case that must pass lint and run with `-stub`; check each construct with `pnpm nextflow -- lint`.
- A legacy entry workflow and a legacy subworkflow, a legacy process with a stub, and a typed workflow in its own file (LA-13).
- The statements:
  - `def summary = [:]`, then `summary['reads'] = params.reads`;
  - `def (fwd, rev) = …`;
  - `if`/`else` assigning `mode`, with a `def tmp` inside a branch;
  - `try`/`catch` assigning `threshold`;
  - `count = 0`, then `count += 1`;
  - a GString `label`;
  - `log.info(…)`;
  - `lst << mode`;
  - a closure value reading `label`;
  - a local function called with a channel (`res = helper(reads_ch)`);
  - `assert`;
  - `workflow.onComplete { … count … }`;
  - a chain whose closure reads `label`, which stays unwired, for contrast;
  - a process call and emits that use the code outputs.

**The probe tree** has one workflow per probe, about 25 in all. Each probe holds one statement, using names unique to that probe, and then a reader line `probe_<n> = [<every name the statement assigns anywhere>]`.

### 4.1 Unit and oracle tests: `packages/engine/test/projection/code/`

| File: test | Asserts |
|---|---|
| `free-variables.test.ts`: `F-108 AR-13 LA-27: reads are the variables a statement uses before declaring them, every occurrence, with their property path` | |
| `…: F-108 LA-27: closure parameters, implicit it, closure- and block-local defs and catch variables are not free` | |
| `…: F-108 LA-27: method names, property names, map and named-argument keys are not reads` | |
| `…: F-108 LA-27: writes are implicit declarations, reassignments, top-level defs, tuple targets and set/tap targets, in first-write order` | |
| `…: F-108 LA-27: a compound assignment reads and writes its target; a property or index assignment reads its root only` | |
| `…: F-108 AR-13: variablesRead and statementVariables agree on every expression statement of the fixtures` | |
| `free-variables-oracle.test.ts`: `F-108 LA-27 ADR-0005: the free reads of every probe statement are exactly nextflow lint's "is not defined" errors in it` | method-name positions and compound targets dropped, as in 1.3 |
| `…: F-108 LA-27 ADR-0005: after every probe statement exactly its writes are defined` | the reader line's errors are the other names |
| `…: F-108: every probe has recorded messages and nothing else is recorded` | |
| `code.test.ts`: `F-108 step 1 AR-13 LA-27: an if/else assigning in its branches is one code node with those outputs, and later uses wire to it` | |
| `…: F-108 step 1 LA-27: inputs are the graph values read: a take, the latest earlier assignment, res.name of a multi-output call, a :params port` | |
| `…: F-108 LA-27: reads inside a code node's closures are inputs; a chain's closure reads still are not` | |
| `…: F-108 LA-27: functions, built-ins, undeclared names and params as a whole are not ports; a value assigned earlier in the same statement is not an input` | |
| `…: F-108 AR-11: a code node is keyed by its first output, or :code@n without outputs; def (a, b) gives outputs a and b` | |
| `…: F-108 LA-28: single-assignment outputs keep F-106's inline type; edges into code nodes are indirect and carry the source type` | |
| `…: F-108 UX-22 UX-28: label is the first line, text the whole statement` | |
| `…: F-108 LA-10: a typed workflow gets the same code nodes` | |
| `snapshot.test.ts`: `F-108 step 1: f108-code-nodes/<file>#<workflow> matches its projection snapshot` | plus the regenerated F-106 snapshots |
| `roundtrip.test.ts`: `F-108 step 2 ADR-0004: every code node's text is exactly its statement's source` | all fixture sets |
| `…: F-108 step 2 ADR-0004: a code node's text re-parses on its own to the same statement` | wrapped in `workflow { main: … }` with the file's types flag; AST equal, ignoring ranges and comments |
| `…: F-108 step 2 IO-20: projecting leaves files unchanged` | `printSourceFile` gives the text back; the model is deep-equal before and after; `equivalent` holds |
| `…: F-108 AR-11: code node ids and ports are unchanged after whitespace-only re-parses` | |

### 4.2 Corpus: `packages/engine/test/corpus/code-nodes.corpus.ts`

| Test | Asserts |
|---|---|
| `F-108 step 2 ADR-0004 IO-20: on every pinned pipeline, code node text is exact and re-parses to the same statement, and projection leaves files unchanged` | Also writes "Code nodes (F-108)" to the report: per pin, code nodes, inputs, outputs and edges. |
| `F-108 IO-14: every corpus workflow projects with code-node analysis without throwing` | |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-108` from `main` after F-106 merges.

0. **Scope extraction.** Only if `scope.ts` is missing. This is shared with F-107; see F-107 task 0.
1. **Fixtures and oracle tree.**
   - The `f108-code-nodes` case; the probe tree and its manifest; the oracle `paths`/`cli` changes and their tests. Record the messages from a real `pnpm nextflow -- lint -o json` run.
   - Done when `pnpm oracle` (Java 17 to 26; CI `oracle` otherwise) and `pnpm check` pass.
2. **Free-variable analysis.**
   - `free-variables.ts`, its unit tests and the oracle test.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/projection/code/free-variables.test.ts test/projection/code/free-variables-oracle.test.ts` and `pnpm check` pass.
3. **Code node builder.**
   - `code.ts`, `CodeNode.text`, the `project.ts` call site, `code.test.ts`, and the snapshots. Review the regenerated F-106 snapshot diff: only code-node ports, edges and ids should change.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
4. **Step 2.**
   - `roundtrip.test.ts` and `code-nodes.corpus.ts`.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (or CI `corpus-parse`) and `pnpm check` pass.
5. **Records** (orchestrator).
   - Done when `pnpm check` and Scope guard pass, without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **Scope API.**
   - **Recommendation:** F-106 builds `scope.ts` (F-107's 1.5). Otherwise task 0.
2. **Closure reads.**
   - **Recommendation:** they are code-node inputs. The code node is opaque, and lint counts them as reads.
   - This differs on purpose from F-106's chains, whose closures live in the details pane (ADR 0008).
3. **Mutations** (`x.p = v`, `x[i] = v`, `x << v`, `x.add(v)`).
   - **Recommendation:** these are reads only, since LA-27 says outputs are the variables a statement assigns. Record the limitation: later reads of `x` don't depend on the mutation.
   - Alternative: also make the mutated root an output.
4. **Conditional writes** (`if (c) { x = 1 }` without `else`).
   - **Recommendation:** outputs replace the earlier binding, following LA-27 strictly.
   - With F-107's transparent `if`s, the `if`s that contain dataflow aren't code at all.
5. **`params` read as a whole.**
   - **Recommendation:** no port. `params.x` still gives a port.
6. **Keys.**
   - **Recommendation:** the first output's variable; `:code@n` when there are no outputs. Only the key variable consumes an occurrence number.
7. **Port ids.**
   - **Recommendation:** the resolved reference text, with one port per distinct reference.
8. **Method names are never reads,** even when a variable of that name exists.
   - **Recommendation:** accept this; it matches lint (1.3).
9. **Step 2 reading.**
   - **Recommendation:** the three checks in 4.1: exact text, standalone re-parse, and read-only projection, on fixtures and the corpus.
10. **Free-variable oracle.**
    - **Recommendation:** a lint-only oracle tree with exact positions, like F-106's type probes. It is a small code change in `tools/oracle/src`, not a workflow edit.
    - A `cases.yaml` substring check would miss extra errors.
11. **Playwright.**
    - **Recommendation:** none (Q13).
12. **Decide-and-record items:**
    - no new dependency;
    - no package boundary change;
    - no stored format: `CodeNode.text` is in memory and the key grammar is unchanged;
    - no workflow edit;
    - one ADR for the LA-27 readings (points 2–8).

## 7. Records
- **ADR** "Code nodes and free-variable ports" (`Accepted (agent)`), with its README row.
- **`docs/licences.md`:** a row for the scoping rules re-implemented from nf-lang `VariableScopeVisitor` v26.10.7 (Apache-2.0, line references in `free-variables.ts`).
- **`features.json` notes:**
  - **F-108** "Verified …";
  - **F-111:** `CodeNode.text` and `range` locate code to move or delete;
  - **F-112:** unresolved free reads;
  - **F-205:** `label` and `text` for UX-22 and UX-28.
- **`progress.md` Decisions.**

## 8. Evidence
- **Probes:** `f108/probe-free`, `probe-free2` and `probe-free3` under `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`, run with the lint command in F-107 section 8.
- **Corpus figures:** from F-107's survey outputs.

---

## Where F-107 and F-108 touch the same files

The two features are independent once `scope.ts` exists: F-108 only calls it, and F-107 extends it. They overlap here:

| File | F-107 | F-108 | Risk |
|---|---|---|---|
| `packages/lang-core/src/projection.ts` | `Guard`, node `guards`, `ProjectedStatement`, `Projection.statements` | `CodeNode.text` | different interfaces; at most a trivial textual conflict |
| `packages/engine/src/projection/project.ts` | the statement dispatch, adding guards after a node is built | the `codeNode()` call site only | small |
| `packages/engine/src/index.ts` | adds exports | adds exports | append-only |
| `tools/oracle/cases/cases.yaml` | adds cases | adds a case | append-only |
| F-106's committed projection snapshots (and F-107's corpus snapshots, if F-107 lands first) | changes them | changes them | conflict |

For the snapshot conflict: whichever feature merges second merges `main`, regenerates with `pnpm --filter @nf-builder/engine test -u` and `pnpm test:corpus -u`, and reviews only its own changes. Never hand-merge snapshots.

The rest stays separate:
- F-108 alone changes `tools/oracle/src`.
- F-107 alone changes `LanguagePack`, lang-2610, `library.ts`, `signature.ts`, `scope.ts` and `render.ts`.
- Each feature has its own test directory (`test/projection/legacy/`, `test/projection/code/`) and its own corpus file (`legacy-projection.corpus.ts`, `code-nodes.corpus.ts`).
