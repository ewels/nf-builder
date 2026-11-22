# Plan: F-105, semantic model: include resolution, declarations by name, per-file re-modelling

Planner output, 2026-11-22. Read-only: I changed nothing in the repo or any worktree. Based on `main` at `7097141` (F-102 merged), `feat/F-103` at `5838ffa` (for `ConfigInclude`), and F-104's plan (`docs/plan/handoff/plan-F-104.md`), which hasn't been built yet. Section 1.4 lists every F-104 name this plan depends on.

## 0. Scope

F-105 builds the project-level model on top of F-104's per-file `SourceFile`s:
- it resolves every script `include` (relative paths, registry module names, `plugin/`) and every `includeConfig` to a project file, or to a diagnostic that names the missing path;
- it binds each include entry to the declaration it names;
- it gives each script a top-level name scope (declarations by name, for F-106);
- it keeps the file dependency graph so a change re-parses one file and re-models only that file and its dependants.

The rules follow nf-lang 26.10.7. The resolution rules and their messages are version-specific, so they live in the pack. The graph and the incremental update live in the engine.

How the steps are checked:
- Step 1: a corpus test over all 5 pinned pipelines, two new oracle cases that tie our messages to real `nextflow lint` output, and deleting real corpus targets so the "diagnostic naming the missing path" branch runs on real code.
- Step 2: a `trace` instrumentation hook, asserted in unit tests and on the corpus.

There is no UI, so no Playwright test (Q13).

Out of scope, all F-112's:
- name and type resolution inside bodies;
- duplicate-name, alias and pipeline-typing errors;
- config include placement;
- quick fixes.

## 1. Findings

### 1.1 Spec and ADRs
- **AR-03:** the model resolves includes across files and declarations by name. "Includes of registry modules resolve to `modules/<namespace>/<name>/`." The rest of AR-03 (workflow bodies, statements) belongs to F-106 to F-108.
- **AR-04:** re-parsing is per file. A change re-parses that file and "recomputes the model for files that depend on it".
- **AR-05:** a diagnostic has a range, severity, message and optional quick fix. Diagnostics come from the parser, the model and lints. No `Diagnostic` type exists yet.
- **IO-32:** inserting a registry module writes `modules/<namespace>/<name>/` and `include { NAME } from '<namespace>/<name>'`.
- **FI-05:** `includeConfig` targets open from a link. F-103's plan leaves "F-105 resolves paths relative to the including file".
- **ADR 0003 and the dependency-cruiser message:** shared types go in lang-core and version-independent logic in the engine. The engine reaches a pack only through its entry (Q10).
- **ADR 0006 and LA-02:** all version-specific behaviour comes from the pack. Registry modules, nested vendoring and pipeline includes (`workflow`/`params`, added in 26.10) are recent and version-specific, so the resolution rules belong in the pack.
- **ADR 0009:** `.module-info` is written only after F-504. Upstream needs it only for warnings, never to resolve.
- **ADR 0004:** model what we can. Partial files (F-104) still offer their modelled declarations.

### 1.2 Upstream rules at v26.10.7 (read from source, confirmed with the pinned `nextflow lint`)

Sources, all under `raw.githubusercontent.com/nextflow-io/nextflow/v26.10.7/modules/`:
- `nf-lang/.../script/control/ResolveIncludeVisitor.java`: `visitInclude` L90-L141, `getDefinitions` L182, `definitionName` L198, `paramsBlockType` L149;
- `nf-lang/.../script/control/ModuleResolver.java`: `isLocalModule` L139, `getIncludeUri` L150, `getLocalIncludeUri` L172-L181;
- `nf-lang/.../module/spi/RemoteModuleResolver.java`: `resolveBaseDir` L61, `isVendoredModuleDir` L93;
- `nf-lang/.../module/spi/FallbackRemoteModuleResolver.java` L34;
- `nextflow/.../module/ModuleReference.groovy`: pattern L37;
- `nextflow/.../module/ModuleResolver.groovy` L60 and `InstalledModule.groovy` L53 (main.nf and meta.yml are both required);
- `nf-lang/.../config/control/ResolveIncludeVisitor.java`: `visitConfigInclude` L65, `getIncludeUri` L78.

**Script include source:**
- **`plugin/...`:** placeholder targets, no file, no error.
- **Local** (`/`, `./`, `../`):
  - resolve against the including file's directory and normalise;
  - if that path is a directory, take `<dir>/main.nf`;
  - else if the source doesn't end in `.nf`, append `.nf`;
  - else use it as written.
- **Anything else is a registry reference:**
  - trimmed, it must match `^([a-z0-9][a-z0-9._\-]*)\/([a-z][a-z0-9._\-]*(?:\/[a-z][a-z0-9._\-]*)*)$`;
  - the base is the project root, unless the including script's directory lies under a `modules/` directory, in which case the base is that directory (**nested vendoring**);
  - the target is `<base>/modules/<scope>/<name>/main.nf`, and `meta.yml` must sit beside it.

**Entries** match the target's definitions in this order: workflows (the entry workflow is named `workflow`), processes, agents, functions, then types (records and enums). A `params` entry with no match names the target's params block.

**Config includes:**
- Only a constant source is checked.
- A URI with a non-`file` scheme is skipped.
- Otherwise the path resolves against the including file's directory, with no extension added.

Lint results from probe trees I built in the scratchpad (section 8):

| Case | `nextflow lint` 26.10.7 |
|---|---|
| `./missing/c` | `main.nf` 2:1 `Invalid include source: '<abs>/missing/c.nf'` |
| `./modules/b` where `modules/b/` holds only `meta.yml` | 4:1 `Invalid include source: '<abs>/modules/b/main.nf'` (a directory wins) |
| `../outside/d.nf` | 6:1 `Invalid include source: '<abs outside>/d.nf'` |
| `{ NOPE } from './modules/a'` | 3:1 `Included name 'NOPE' is not defined in module '<abs>/modules/a/main.nf'` |
| target with a grammar error (`process Q {`) | 5:1 `Module could not be parsed: '<abs>/pipelines/q.nf'` |
| targets with **builder-only** errors (`typed-without-flag.nf`, `section-order.nf`) | no include error; `HELLO` (a process with a builder error) and `ON_TIME` resolve |
| `includeConfig 'missing.config'`; `test { includeConfig 'test' }` in `conf/inc.config` | 2:1 `'<abs>/conf/missing.config'`; 4:12 `'<abs>/conf/test'`; GString and `https://` sources: nothing |
| registry `nf-core/x`, directory missing | lint **aborts**: `Failed to resolve remote module ...: Unable to GET /v1/modules/...` (it tries to download) |
| registry `Bad` | lint **aborts** with ModuleReference's message |
| registry module without `meta.yml` | lint **aborts**: `Module nf-core/nometa is corrupted (missing required files)` |
| `modules/local/x/main.nf` includes `nf-core/present`, which exists only at the root | lint looks in `modules/local/x/modules/nf-core/present` (nested vendoring confirmed) |
| a tree with every resolving form (dir, `.nf` appended, explicit `.nf`, `../`, registry at root, nested registry, `plugin/`, `workflow as P ; params as PP`, nested `includeConfig`) | 0 errors, exit 0 (warnings only for missing `.module-info`) |

Also seen: a missing `includeConfig` in the **root `nextflow.config`** of a tree that resolves registry modules aborts lint ("Unable to parse config file"). Oracle cases must keep config errors out of the root config.

### 1.3 Corpus (`.cache/corpus` from `wt-F-103`, regex scan; the corpus test reports exact counts)

| | rnaseq | sarek | fetchngs | rnaseq-nf | rnaseq-nf-typed | total |
|---|---|---|---|---|---|---|
| script includes | 197 | 354 | 27 | 5 | 6 | 589 |

- Script includes by form:
  - 549 are local and all resolve: 350 directories with `main.nf`, 190 with `.nf` appended, 9 with an explicit `.nf`;
  - 40 are `plugin/`;
  - **0 use registry names**;
  - no directory/`.nf` ambiguity.
- Includes have 550 entries (202 aliased), and every name is declared in its target.
- There are 125 `includeConfig`: 117 constant local paths, all resolving relative to the including file, and 8 dynamic expressions (`params.custom_config_base ...`). None are URLs.
- Lint reports 0 errors over all 570 corpus files, so parity means **zero include diagnostics**.
- Highest fan-in: sarek `modules/nf-core/gatk4/mergevcfs/main.nf` (15 includers), rnaseq `modules/nf-core/samtools/index/main.nf` (5).
- Registry resolution is therefore tested with the vendored fixture `packages/lang-2610/test/ast/fixtures/include-registry.nf` plus `modules/nf-core/fastqc/` (main.nf, meta.yml and `.module-info`; lint-clean in the oracle since F-102) and with the new oracle case.

### 1.4 Code facts, and the F-104 names this plan depends on

From F-102 and F-103 (merged or in review):
- `Include { entries, source: StringLiteral }`, `IncludeEntry { name: Identifier, alias }`, `StringLiteral.value`;
- `WorkflowDef.name === null` for the entry workflow;
- `ParamsBlock`, `ProcessDef`, `AgentDef`, `FunctionDef`, `RecordDef` (`"Record"`), `EnumDef` (`"Enum"`), `Parenthesized`;
- `ConfigInclude { source: Expression }`, nested in `ConfigBlock.statements` and `ConfigSelector.statements`;
- `walk` and `childNodes` in lang-core.

**F-104 names relied on.** If F-104 renames or changes any of these, adjust sections 2 and 3:

| F-104 name | Used for |
|---|---|
| lang-core `SourceFile` (`path`, `text`, `language`, `status`, `ast`, `problems`) and its variants | per-file input; `ast` null means verbatim; `problems` are the whole-file errors |
| `ParseProblem.source` (`"lexer" \| "parser" \| "builder" \| "internal"`) | "could not be parsed" when any problem isn't `"builder"` (1.2: builder-only errors still resolve) |
| `Unparsed { head: DeclarationHead \| null }`, `DeclarationHead { keyword, name }` with keywords `process`, `workflow` (name null for entry), `agent`, `function`, `record`, `enum`, `params` | partial targets offer unparsed declarations by name |
| `ScriptItem` includes `Unparsed`; `ConfigItem`; `ConfigAst.statements: ConfigItem[]` | walking bodies |
| `SourceParser`; `LanguagePack.loadParser()`; engine `loadParser(version, packs?)` and `createSourceFile(path, text, parser)` | parsing inside `ProjectModel` |
| lang-2610 `parseScriptSource(text)` (internal) | building a partial AST in pack tests |
| F-104's test that `src/index.ts` has no static import of `./ast`, `./parser`, `./source`, `./generated` or `antlr4ng` | `./includes/` must stay outside that list |
| `"types": ["node"]` in `engine/tsconfig.json` | engine tests read files |

## 2. Design

### 2.1 Where things live

| Piece | Package |
|---|---|
| `Diagnostic` (AR-05, without the quick fix), `ProjectTree`, `IncludeTarget`, `Includable`, `IncludeRules`, `LanguagePack.includes` | lang-core |
| Path normalisation, the script and config resolution rules, `includable(ast)`, nf-lang messages | lang-2610 `src/includes/` (pure; imports lang-core types only; on the pack entry, not lazy: a few hundred bytes) |
| `FileTree`, `parseFile`/`modelFile`, `ProjectModel` (incremental, `trace`), `openProject` | engine `src/model/` |

### 2.2 Resolution (pack; never throws)

`scriptInclude(from, source, tree)`, where `dir = dirname(from)`:
1. `plugin/<id>` gives `{ kind: "plugin", plugin: id }`.
2. Local sources:
   - `p = resolvePath(dir, source)`: POSIX, with `.`, `..` and `//` removed; `..` above the root is kept; absolute sources stay absolute; neither ever exists in a project;
   - `target = isDirectory(p) ? p/main.nf : source.endsWith(".nf") ? p : p + ".nf"`;
   - result: `isFile(target)` ? `file` : `missing` with `Invalid include source: '<target>'`.
3. Registry references:
   - `s = source.trim()`; empty gives `Module reference cannot be empty`; a pattern failure gives ModuleReference's message;
   - `base = registryBase(from)`: `dir` if any of its segments is `modules`, else `""`;
   - `main = <base>/modules/<s>/main.nf`. If it is missing: `Module '<s>' is not in the project: '<main>' does not exist`. If `meta.yml` is missing: `Module '<s>' is incomplete: '<meta.yml path>' does not exist`. Otherwise `{ kind: "file", path: main, module: s }`.
   - These two messages are ours, because lint downloads or aborts instead (open point 3).

`configInclude(from, source, tree)`:
- unwrap `Parenthesized`; anything other than a `StringLiteral` gives `external`;
- a value with a URI scheme other than `file:` gives `external`;
- otherwise `p = resolvePath(dir, value)`; `isFile(p)` gives `file`, else `Invalid include source: '<p>'`;
- a directory counts as missing (nf-lang accepts it and the run then fails).

`includable(ast)`: a map from name to `{ declaration, pipeline }`, first match wins.
- Order: workflows, processes, agents, functions, records/enums.
- The entry workflow is `workflow` and the params block is `params` (both `pipeline: true`). `params` is added only if nothing else claimed the name.
- `Unparsed` items count by their head's keyword and name.
- Includes, feature flags, legacy params, output blocks and statements are not includable.

### 2.3 Per-file model (engine)

- **`parseFile`** (per file, text only): `createSourceFile` plus `declarations = rules.includable(ast)` for script ASTs.
- **`modelFile`** (reads the tree and its targets' `ParsedFile`s), for each `Include` in the body:
  - a `missing` target gives an `include-target` diagnostic with the rule's message;
  - a `file` target with no AST, or with a non-builder problem, gives `include-not-parsed`;
  - each entry binds to `target.declarations.get(name)`;
  - a name the target lacks gives `include-name`, unless the target was "not parsed" (lint stops there too);
  - `plugin` entries bind to nothing and give no diagnostic.
- **Config files:** `walk` collects `ConfigInclude`s, and `missing` gives `include-target`.
- **Scope:** non-pipeline declarations come first, then include entries under their alias or name; the first binding wins.
- **Diagnostics:** severity `error`, the range of the include node (lint reports its start), the file's path.
- **Watch set:** `modelFile` runs against `recordingTree(tree)`, which records every `isFile` and `isDirectory` query. That gives the watch set by construction.

### 2.4 Incremental updates (AR-04)

```
state: parsed: Map<path, ParsedFile>; models: Map<path, FileModel>; tree: FileTree
       resolvedBy: Map<target, Set<path>>   // files with an include resolved to target (= dependants)
       fileWatch / dirWatch: Map<path|dir, Set<path>>
setFile(p, text):  new = !parsed.has(p); parsed.set(p, parseFile(...))            // trace parse p
                   flipped = new ? tree.add(p) : []
                   remodel({p} ∪ (new ? fileWatch[p] : resolvedBy[p]) ∪ dirWatch[flipped])
deleteFile(p):     drop p (and its watches); flipped = tree.remove(p)
                   remodel(fileWatch[p] ∪ dirWatch[flipped])
remodel(S):        for q in sorted(S ∩ parsed): modelFile(q) (trace model q); replace q's index entries
                   return { remodelled: sorted(S ∩ parsed) }
```

- A text edit re-models the file and the files whose includes resolved to it, nothing else. Nextflow has no re-exports (`getDefinitions` reads only the target's own definitions, as nf-lang's `isIncludeStale` does), so dependants of dependants are untouched.
- Creating or deleting a file also re-models files whose resolution looked for that path, or for a directory whose existence flipped. Example: creating `x/README.md` switches `./x` from `x.nf` to `x/main.nf`, as `Files.isDirectory` does upstream.
- An unchanged file keeps its `FileModel` object.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/diagnostic.ts` | `type DiagnosticSeverity = "error" \| "warning"`; `interface Diagnostic { path: string; range: Range; severity; message: string; code: string }` |
| `packages/lang-core/src/includes.ts` | `interface ProjectTree { isFile(path: string): boolean; isDirectory(path: string): boolean }`; `type IncludeTarget = { kind: "file"; path: string; module: string \| null } \| { kind: "missing"; path: string \| null; module: string \| null; message: string } \| { kind: "plugin"; plugin: string } \| { kind: "external" }`; `type IncludableDeclaration = ProcessDef \| WorkflowDef \| AgentDef \| FunctionDef \| RecordDef \| EnumDef \| ParamsBlock \| Unparsed`; `interface Includable { declaration: IncludableDeclaration; pipeline: boolean }`; `interface IncludeRules { scriptInclude(from: string, source: string, tree: ProjectTree): IncludeTarget; configInclude(from: string, source: Expression, tree: ProjectTree): IncludeTarget; includable(ast: ScriptAst): ReadonlyMap<string, Includable>; notParsed(path: string): string; notDefined(name: string, path: string): string }` (all fields readonly) |
| `packages/lang-2610/src/includes/paths.ts` | `dirname(path: string): string`; `resolvePath(dir: string, source: string): string`; `joinPath(...parts: string[]): string` |
| `packages/lang-2610/src/includes/resolve.ts` | `MODULE_REFERENCE: RegExp`; `registryBase(from: string): string`; `scriptInclude`; `configInclude` (signatures as in `IncludeRules`); upstream line references in the header |
| `packages/lang-2610/src/includes/includable.ts` | `includable(ast: ScriptAst): ReadonlyMap<string, Includable>` |
| `packages/lang-2610/src/includes/index.ts` | `const includes: IncludeRules` |
| `packages/engine/src/model/tree.ts` | `class FileTree implements ProjectTree { constructor(paths?: Iterable<string>); add(path: string): readonly string[]; remove(path: string): readonly string[]; isFile; isDirectory }` (the arrays are directories that appeared or disappeared); `interface Watch { files: ReadonlySet<string>; directories: ReadonlySet<string> }`; `recordingTree(tree: ProjectTree): { tree: ProjectTree; watch: Watch }` |
| `packages/engine/src/model/file-model.ts` | `interface ParsedFile { source: SourceFile; declarations: ReadonlyMap<string, Includable> }`; `parseFile(path: string, text: string, parser: SourceParser, rules: IncludeRules): ParsedFile`; `interface ScriptIncludeModel { kind: "script"; node: Include; target: IncludeTarget; entries: readonly ResolvedEntry[] }`; `interface ConfigIncludeModel { kind: "config"; node: ConfigInclude; target: IncludeTarget }`; `type ResolvedInclude = ScriptIncludeModel \| ConfigIncludeModel`; `interface ResolvedEntry { entry: IncludeEntry; declaration: IncludableDeclaration \| null; pipeline: boolean }`; `type Binding = { kind: "declaration"; declaration: IncludableDeclaration } \| { kind: "include"; include: ScriptIncludeModel; entry: ResolvedEntry }`; `interface FileModel { path; source: SourceFile; declarations: ReadonlyMap<string, Includable>; includes: readonly ResolvedInclude[]; scope: ReadonlyMap<string, Binding>; diagnostics: readonly Diagnostic[] }`; `modelFile(file: ParsedFile, tree: ProjectTree, parsed: (path: string) => ParsedFile \| undefined, rules: IncludeRules): { model: FileModel; watch: Watch }` |
| `packages/engine/src/model/project.ts` | `interface ProjectFile { path: string; text: string }`; `interface ModelEvent { kind: "parse" \| "model"; path: string }`; `interface ProjectModelOptions { parser: SourceParser; includes: IncludeRules; trace?: (event: ModelEvent) => void }`; `interface ModelChange { remodelled: readonly string[] }`; `class ProjectModel { constructor(files: Iterable<ProjectFile>, options: ProjectModelOptions); setFile(path: string, text: string): ModelChange; deleteFile(path: string): ModelChange; file(path: string): FileModel \| undefined; paths(): readonly string[]; dependencies(path: string): readonly string[]; dependants(path: string): readonly string[]; lookup(path: string, name: string): Binding \| undefined; diagnostics(): readonly Diagnostic[] }`; `openProject(version: string, files: Iterable<ProjectFile>, options?: { trace?: (event: ModelEvent) => void; packs?: readonly LanguagePack[] }): Promise<ProjectModel>` |
| `tools/oracle/cases/f105-includes-resolve/**` | the 1.2 all-resolving tree; the GString `includeConfig` goes in `conf/dynamic.config`, not the root config |
| `tools/oracle/cases/f105-includes-missing/**` | the 1.2 missing tree; config errors in `conf/inc.config`; no registry cases (lint downloads or aborts) |

### 3.2 Change
- `packages/lang-core/src/index.ts`: `LanguagePack` gains `readonly includes: IncludeRules`. Export the new types.
- `packages/lang-2610/src/index.ts`: `includes` from `./includes/index.ts` (a static import is fine: no parser code).
- `packages/engine/src/index.ts`: export `ProjectModel`, `openProject` and the model types. Re-export `Diagnostic`, `IncludeTarget`.
- Engine test fakes in `palette.test.ts` and `packs.test.ts` (and F-104's `parser.test.ts`): add `includes`.
- `packages/engine/package.json`: devDependency `"yaml": "2.9.1"` (root version; for reading `cases.yaml` in tests).
- `tools/oracle/cases/cases.yaml`: two lint-only entries (task 1).
- No change to dependency-cruiser, workflows, root scripts or generated files.

## 4. Tests (write before the implementation)

**Pack: `packages/lang-2610/test/includes/`**

| File: test | Asserts |
|---|---|
| `paths.test.ts`: `F-105 AR-03: include paths resolve and normalise as java.nio Path.resolve().normalize()` | `./`, `../`, `//`, trailing `/`, `..` above the root kept, absolute kept, root `dirname("main.nf") === ""` |
| `resolve.test.ts`: `F-105 step 1 AR-03: a relative include of a directory resolves to its main.nf, and a directory wins over a .nf file` | in-memory `ProjectTree` |
| `…: F-105 step 1 AR-03: a relative include without .nf gets .nf; one ending in .nf is used as written` | |
| `…: F-105 step 1: a missing local target names the path nf-lang checks` | `Invalid include source: 'missing/c.nf'`, `'modules/b/main.nf'`, `'../outside/d.nf'`, an absolute path |
| `…: F-105 step 1 AR-03 IO-32: a registry name resolves to modules/<scope>/<name>/main.nf from the project root` | includes the multi-segment `nf-core/samtools/index` and the trimmed `' nf-core/fastqc '` |
| `…: F-105 AR-03: a script under a modules/ directory resolves registry names in its own directory (nested vendoring)` | `modules/local/x/main.nf` resolves into `modules/local/x/modules/...`; a script at root or under `subworkflows/` uses the root |
| `…: F-105 step 1: a registry module not in the project names its missing main.nf, and one without meta.yml names that` | |
| `…: F-105 step 1: an invalid module reference gets nf-lang's message` | `Bad`, `nf-core`, `nf-core/`, `nf-core/FastQC`, `-x/y`, `''` |
| `…: F-105 AR-03: plugin/ sources are plugins, not files` | |
| `…: F-105 step 1 FI-05: includeConfig with a constant path resolves against the including file, with no extension added` | including `('x.config')` in parentheses and a nested profile path |
| `…: F-105 FI-05: includeConfig with an expression or URL is external` | GString, ternary, variable, `https://`; `file:/x` is missing |
| `includable.test.ts`: `F-105 AR-03: declarations are includable by name in nf-lang's order, first wins` | every kind, duplicates |
| `…: F-105 AR-03: the entry workflow is includable as workflow and the params block as params` | `test/ast/fixtures/pipelines/rnaseq.nf` by path; `pipeline: true` |
| `…: F-105 AR-03 ADR-0004: an unparsed declaration is includable by its head` | `parseScriptSource` on `typed-without-flag.nf` and `section-order.nf` |
| `…: F-105: feature flags, includes, legacy params, output blocks and statements are not includable` | |
| `test/index.test.ts` (added): `F-105 ADR-0006 LA-02: the pack provides include rules without loading the parser` | `pack.includes` works; the entry's static imports stay within F-104's allowed set |

**Engine: `packages/engine/test/model/`** (real pack via `pack.version`; helpers `describe.ts` for a JSON summary of the model and `read-tree.ts` for files by path)

| File: test | Asserts |
|---|---|
| `tree.test.ts`: `F-105 AR-04: the file tree derives directories from file paths and reports which appear or disappear` | |
| `file-model.test.ts`: `F-105 step 1 AR-03: includes resolve to files and entries to declarations, under their aliases` | `packages/lang-2610/test/ast/fixtures/` tree: alias resolves to `some/module.nf` `hello`; registry resolves to `modules/nf-core/fastqc/main.nf` `FASTQC` with `module`; pipeline resolves to the entry workflow and params block |
| `…: F-105 AR-03: lookup finds local declarations, then include entries by alias; plugin entries bind without a declaration; pipeline names aren't in scope` | |
| `…: F-105 step 1 ADR-0004: a target the grammar rejects gives "Module could not be parsed" but still binds what it can; builder-only errors don't` | the 1.2 rows |
| `oracle-cases.test.ts`: `F-105 step 1: every error the oracle records for f105-includes-missing is one of our diagnostics, at lint's position` | reads `cases.yaml`; each `errors` text appears in one message; positions main.nf 2:1 to 6:1 and `conf/inc.config` 2:1, 4:12 |
| `…: F-105 step 1: f105-includes-resolve has no diagnostics and every include resolves` | |
| `project.test.ts`: `F-105 step 2 AR-04: changing a file re-parses only it and re-models only it and its dependants` | trace events; `remodelled` |
| `…: F-105 step 2 AR-04: a change re-models neither the file's dependencies nor its dependants' dependants` | chain C→A→B; change B gives model {B, A} |
| `…: F-105 step 2 AR-04: untouched files keep the same FileModel object` | |
| `…: F-105 step 2 AR-04: creating a missing target re-models its includers and clears their diagnostics; deleting it brings back a diagnostic naming the path` | |
| `…: F-105 step 2 AR-04: a directory appearing switches ./x from x.nf to x/main.nf` | |
| `…: F-105 AR-04: after any sequence of changes the model equals a fresh build` | 200 seeded set/delete steps on a 12-file project; `describe` equal |
| `…: F-105 AR-03: dependencies and dependants follow resolved includes in both directions, configs included` | |
| `…: F-105 IO-14: modelling never throws` | verbatim, partial and plain files, self-include, cycles |
| `…: F-105: openProject loads the pack's parser and rules; an unknown version rejects` | |

**Corpus: `packages/engine/test/corpus/model.corpus.ts`** (`pnpm test:corpus`, CI `corpus-parse`). The project is every file under each pin except `.git`.

| Test | Asserts |
|---|---|
| `F-105 step 1 AR-03: on every corpus pipeline, every include resolves or produces a diagnostic naming the missing path` | every script include is `file` or `plugin` with every entry bound; every constant `includeConfig` is `file`; `external` is counted; any `missing` has a diagnostic at its node whose message contains `target.path`; zero diagnostics, matching lint's zero errors in `.cache/corpus-lint/<id>.json`; counts go to an "Include resolution (F-105)" section of `.cache/reports/parse-corpus.md` |
| `F-105 step 1: deleting an included corpus file gives each includer a diagnostic naming that path, and restoring it restores the model` | all targets in rnaseq-nf, rnaseq-nf-typed and fetchngs; the top 10 fan-in plus 10 seeded targets in rnaseq and sarek |
| `F-105 step 2 AR-04: changing one corpus file re-parses only it and re-models only it and its dependants (instrumented)` | same sample plus each `main.nf` and a config included by `nextflow.config`: parse events `[f]`; model events `{f} ∪ dependants`, the latter computed by scanning `includes`; other `FileModel`s unchanged by identity; at the end, `describe` equals a fresh build |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-105` from `main` once F-104 has merged. Each task writes its tests first, sees them fail, then implements.

**Task 1: oracle cases.**
- Files: `tools/oracle/cases/f105-includes-{resolve,missing}/` and two `cases.yaml` entries.
  - `resolve`: `lint: { expect: ok }`.
  - `missing`: `lint: { expect: error, errors: ["missing/c.nf'", "Included name 'NOPE' is not defined in module '", "modules/b/main.nf'", "Module could not be parsed: '", "outside/d.nf'", "conf/missing.config'", "conf/test'"] }`.
- Done when: `pnpm oracle -- --case f105-includes-resolve --case f105-includes-missing` passes (Java 17 to 26, or the CI `oracle` job), and `pnpm check`.

**Task 2: lang-core types and pack resolution rules.**
- Files: `lang-core/src/{diagnostic,includes}.ts` and exports (no `LanguagePack` change yet); `lang-2610/src/includes/{paths,resolve}.ts`; `test/includes/{paths,resolve}.test.ts`.
- Done when: `pnpm --filter @nf-builder/lang-2610 exec vitest run test/includes` and `pnpm check`.

**Task 3: includable names and the pack entry.**
- Files: `includable.ts`, `includes/index.ts`; `LanguagePack.includes`; `lang-2610/src/index.ts`; engine fake packs; `includable.test.ts`; `index.test.ts` addition.
- Done when: `pnpm --filter @nf-builder/lang-2610 test`, `pnpm --filter @nf-builder/engine test`, `pnpm check`, and `pnpm build && pnpm check:budget && pnpm check:hosts`.

**Task 4: engine per-file model.**
- Files: `engine/src/model/{tree,file-model}.ts`; `test/model/{tree,file-model,oracle-cases}.test.ts` with their helpers; `yaml` devDependency (`pnpm install`).
- Done when: `pnpm --filter @nf-builder/engine exec vitest run test/model` and `pnpm check`.

**Task 5: incremental `ProjectModel`.**
- Files: `engine/src/model/project.ts`, `engine/src/index.ts`, `test/model/project.test.ts`.
- Done when: `pnpm --filter @nf-builder/engine test` and `pnpm check`.

**Task 6: corpus test.**
- Files: `engine/test/corpus/model.corpus.ts`. Any mismatch is fixed in the rules with a unit case, never with an allow-list.
- Done when: `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` (or CI `corpus-parse`), and `pnpm check`.

**Task 7: records** (orchestrator, section 7).
- Done when: `pnpm check` passes and the Scope guard passes without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **Rules in the pack** (`LanguagePack.includes`, loaded eagerly and pure).
   - **Recommendation:** yes (ADR 0006, LA-02). This grows the pack interface but changes no boundary and no dependency-cruiser rule.
   - Alternative: rules in the engine. Simpler wiring, but it puts 26.10 registry and pipeline-include semantics outside the pack.
   - Record in a new ADR, `Accepted (agent)`, at the next free number (0032 unless F-104 or F-110 take it first).
2. **`Diagnostic` in lang-core now.**
   - **Recommendation:** the minimal AR-05 shape (`path`, `range`, `severity`, `message`, `code`) now; F-112 adds quick fixes and other sources.
   - In memory only, so not a format change.
3. **Message wording.**
   - **Recommendation:** nf-lang wording, with project-relative paths.
   - Our own wording for the cases where lint downloads or aborts instead of reporting: a registry module that isn't present, and one missing `meta.yml`. Both name the missing path.
   - F-112 makes messages state what to do and adds fixes (insert from registry, create file).
4. **Registry fidelity.**
   - **Recommendation:** follow upstream: nested vendoring for scripts under `modules/`, and both `main.nf` and `meta.yml` required.
   - Clarify AR-03 to read "resolve to `modules/<namespace>/<name>/` under the project root, or under the including script's directory when that lies in a `modules/` directory (nested vendoring)".
   - Note for F-504 (IO-32).
5. **Step 1 and dynamic `includeConfig`.** The 8 corpus includes that are expressions neither resolve nor get a diagnostic, because nf-lang doesn't check them.
   - **Recommendation:** report them as `external` and count them. Read "every include" as script includes plus constant config includes.
   - Record this in the F-105 notes and the ADR.
6. **Partial targets** (a deliberate lenience from ADR 0004).
   - **Recommendation:**
     - "Module could not be parsed" exactly when the grammar fails (lint parity, verified in 1.2);
     - entries still bind to modelled declarations and to `Unparsed` heads;
     - no name errors after a "not parsed" (lint parity).
   - Known deviation: a name that nf-lang drops as `InvalidDeclaration` (for example `LATE_INPUT` in `section-order.nf`) binds to its unparsed node rather than giving "not defined". The target file shows the error.
7. **Which dependants.**
   - **Recommendation:** direct dependants for text edits. On create or delete, add the files that looked for the path or a flipped directory. This matches nf-lang (`isIncludeStale`, no re-exports).
   - Alternative: transitive. Simpler to state, but it re-models files whose inputs didn't change.
8. **Checks left to F-112.**
   - **Recommendation:** leave these out of F-105 (no step needs them), and put them in F-112's notes:
     - the pipeline-include typing errors (`ResolveIncludeVisitor` L134-L137; `ResolvedEntry.pipeline` marks the entries);
     - alias rules (records and enums can't be aliased; `workflow` and `params` must be);
     - duplicate names (scope keeps the first);
     - config include placement.
9. **Oracle cases.**
   - **Recommendation:** the two lint-only cases in task 1.
   - A missing registry module and an invalid reference are unit-tested only, because lint tries the network or aborts.
10. **Test plumbing.**
    - **Recommendation:** `yaml` 2.9.1 as an engine *dev*dependency (already the root's version; not a runtime dependency).
    - Node types come from F-104's tsconfig change. If F-104 didn't make it, add `"types": ["node"]` here.
11. **AGENTS.md "Ask first" and decide-and-record items.**
    - No new runtime dependency.
    - No package-boundary or dependency-cruiser change (the `LanguagePack` interface grows, record it).
    - No stored or exported format (the model is in memory).
    - No workflow edit (the `oracle` and `corpus-parse` jobs pick up the new cases and test unchanged).
    - No open question in `open-questions.md` depends on this.
    - Spec text to record: the AR-03 clarification (point 4) and the architecture.md pack sketch (`includes: IncludeRules`).

## 7. Records (drafts for the orchestrator)

- **ADR** "Resolve includes as nf-lang 26.10 does, and re-model a changed file and its direct dependants": points 1 to 8; `docs/adr/README.md` row.
- **`docs/spec/architecture.md`:** the AR-03 clarification and the sketch's `includes`.
- **`docs/licences.md` row:** ported nf-lang include resolution (`packages/lang-2610/src/includes/`: `ModuleResolver.getLocalIncludeUri`, `RemoteModuleResolver.resolveBaseDir`, `FallbackRemoteModuleResolver`, the `ModuleReference` pattern, script and config `ResolveIncludeVisitor` rules and messages) at v26.10.7, Apache-2.0, with attribution headers. Oracle case trees are our own.
- **features.json notes** (no scope change):
  - **F-105:** "Verified <date>:
    - step 1 by `packages/engine/test/corpus/model.corpus.ts`: all 589 script includes (549 local, 40 plugin) and 117 constant `includeConfig` resolve, 550 entries bind, zero diagnostics as lint; 8 dynamic config includes are external (not checked, as nf-lang); deleting real targets gives diagnostics naming the path;
    - messages and positions are checked against `nextflow lint` by oracle cases `f105-includes-{resolve,missing}`;
    - step 2 by `test/model/project.test.ts` and the corpus test (trace instrumentation: one parse, re-model of the file and its dependants only, untouched models kept; incremental equals fresh build).
    No Playwright test (no UI, Q13)."
  - **F-106:** "From F-105: `ProjectModel.lookup(path, name)` gives a call's declaration (local, or included with its target); plugin entries have none; entries bound to `Unparsed` draw as unparsed nodes."
  - **F-112:** the point 8 checks; `Diagnostic` codes `include-target`, `include-not-parsed`, `include-name`.
  - **F-113:** "`ProjectModel` is synchronous; `setFile`/`deleteFile` return the re-modelled paths; `trace` counts parse and model work."
  - **F-504:** the nested-vendoring and `meta.yml` rules; `.module-info` isn't needed to resolve.
  - **F-601:** "FI-05 links come from `FileModel.includes` (config, `file` targets); external sources have no link."
- **progress.md Decisions:** points 1 to 10 as settled; the ADR; "model in memory only; no new runtime dependency".
- **READMEs:** one line in engine (semantic model) and one in lang-2610 (include rules).

## 8. Evidence and how to repeat it

The probe trees are in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f105/` (`probe`, `probe2`, `probe-ok`, `probe-missing`, `probe-builder`). The scratchpad may be cleared.

To repeat a probe:
```
NXF_HOME=/home/user/wt-F-103/.cache/nextflow/home NXF_OFFLINE=true NXF_SYNTAX_PARSER=v2 \
  /home/user/wt-F-103/.cache/nextflow/26.10.7/nextflow-26.10.7-dist lint -o json .
```

- The upstream sources fetched are in the same folder's `upstream/` (URLs and lines in 1.2).
- The corpus scans are `scan2.py` and `scan_cfg.py` in that folder; run them with `python3 -I <script> /home/user/wt-F-103/.cache/corpus`.
