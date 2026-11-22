# Plan: F-203, New project dialog with Start blank and two typed templates (Hello world, Samplesheet to MultiQC)

Planner output, 2026-11-22. I changed nothing in the repo. I read `/home/user/wt-main` (clean `main` at `874ddf3`) and the branches `origin/feat/F-202` and `origin/feat/F-205`. I ran probes against the pinned Nextflow 26.10.7 in the scratchpad (section 8).

## 0. Scope

**In:**
- **Templates in the 26.10 pack (LA-02, ADR 0006):** `blank`, `hello-world` and `samplesheet-multiqc`. Each is a file tree on disk, bundled into a lazy JSON chunk, and run by the oracle as a case.
- **Engine:** `EngineApi.templates(version)`. In the worker, `createProject({ template })` writes the template's files.
- **The UX-60 dialog:**
  - name;
  - Nextflow version (installed packs only);
  - two routes, Start blank and From a template, with a template list;
  - Publish docs to GitHub Pages, checked by default;
  - the projects stored in this browser;
  - the sentence saying projects live in this browser only.
  - It replaces F-202's name-only "New project" dialog.
- **Steps 1 to 3:**
  - step 1 by engine and e2e checks of the expected nodes, plus one `@visual` whole-canvas baseline per template (the settled F-205 decision);
  - step 2 by the oracle cases;
  - step 3 by pack tests for doc comments and schema descriptions, plus an engine test that finds no diagnostics at all.

**Out:**
- the Import route (F-401, F-403);
- the Generate metro map checkbox (F-607 cites UX-60);
- the files Publish docs writes (FI-40, F-606);
- the nf-docs docs oracle (F-606, F-311);
- LA-54 lints (F-312);
- recording the project's source (IO-13, F-401);
- the nf-core-style skeleton and Pipeline composition templates (Q6, open point 1).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-60** asks for name, version, three routes, the stored projects, the "browser only" sentence and two checkboxes. F-203's description narrows this to Start blank, templates and the Publish docs checkbox.
- **Templates live in the pack.** LA-02 and ADR 0006 put them there. The architecture sketch has `templates: Template[]`; it was marked "to be fixed in M1".
- **Every template is typed.** LA-11 and ADR 0007 require it, and LA-11 points to the LA-40 group (LA-40 to LA-45).
- **Other rules that apply:**
  - LA-12: one process per file, in `modules/local/<lower>/main.nf`, with the flag;
  - LA-03: `manifest.nextflowVersion = '>=26.10.6'`;
  - LA-50: Groovydoc with `@param` and `@return`;
  - LA-53: parameters are documented in `nextflow_schema.json`.
- **Oracle:** ADR 0011 and ADR 0019 already expect templates to be oracle cases.
- **Visual baselines** come only from CI (ADR 0021).
- **ADR 0002:** "Clearing site data deletes projects; the UI says so".
- **ADR 0014 and ADR 0040:** `form-action 'none'`, so dialogs call `preventDefault` on submit.
- **ADR 0040 and ADR 0044:** bundling the templates avoids any fetch, so the base path and frames don't matter.
- **Q6** is open. Its proposed list has four templates; F-203 names two.

### 1.2 Code facts
- **F-202 branch:**
  - `NewProject { name; languageVersion; files }`;
  - `WorkspaceApi.createProject` checks the name (`normaliseProjectName`) and the version (`installedPackVersions`);
  - `requestPaletteView` memoises one request per version;
  - IndexedDB schema v1 stores text only.
  - Tasks 6 to 9 (the store, the switcher, the dialogs, the e2e tests) are **not built yet**.
  - The F-202 plan says a blank project has no files until F-203.
- **F-205 branch:**
  - `workspace-store.ts` has `defaultWorkflow`, which picks `main.nf`'s entry workflow;
  - `e2e/canvas.ts` has `canvasReady`, `node` and `viewportZoom`.
  - Tasks 4 onwards are not built.
- **Dependency rules:** `apps/web` can't import a pack. The main thread holds only pack versions and palette search (F-113), so the template list goes through the worker.
- **Bundling precedents:**
  - the pack already lazy-imports JSON (`loadCatalogue`) and imports a generated `palette.json` (`gen:palette`, checked by `test/gen-palette.test.ts`);
  - `check:hosts` doesn't scan chunks built from a `.json` source. Template text holds URLs (`$schema` and README links), so it should ship as JSON.
- **Pack constraints:**
  - `packages/lang-2610` must stay erasable, because `tools/registry-snapshot` imports the entry under plain Node;
  - Biome excludes `palette.json`, and template JSON needs the same exclusion.
- **Oracle:** a case's directory is `tools/oracle/cases/<id>`, fixed. Lint warnings are collected but never fail a case. Each run happens in a fresh copy under `.cache/oracle/runs/<id>/`.
- **F-205 fixture:** `tools/oracle/cases/f205-canvas` shows a lint-clean typed entry workflow that has a params block, an output block and a typed process.
- **Corpus `rnaseq-nf-typed`** (pinned `ce09c72`, Apache-2.0) shows two things:
  - `params { reads: Channel<Sample> }` loading a samplesheet into records;
  - a typed FASTQC process with a record input and record output.
- **Registry:** `nf-core/fastqc` and `nf-core/multiqc` in the registry snapshot are `typed: false`. A typed template therefore uses local typed processes, not registry modules.
- **Vendored skill `nf-pipeline-design`** (lines 443–470 and 703–750) gives the typed `topic:` syntax `tuple('tool', eval('…')) >> 'versions'`. LA-37 means a typed process should have a single output: a record when it returns several values.

### 1.3 Probe results (26.10.7, `lint -o json` and `run -stub`)

| Probe | Result |
|---|---|
| Empty `params {}` and empty `workflow {}` with the flag and doc comments | lint clean, run ok |
| `output {}` when the entry workflow has no `publish:` | **lint error** "Output block is defined but entry workflow does not define a `publish:` section" |
| An empty `publish:` section | **syntax error** "Unexpected input: '}'" |
| `params { input: Channel<Sample> }` loading a CSV of relative paths into records; a typed process with `sample: Sample` in and `record(...)` out | lint clean, no warnings, tasks staged |
| `topic: tuple('notatool', eval('notatool --version')) >> 'versions'` under `-stub` without the tool | **task fails** with "Unable to evaluate output" |
| The same, with a shim for the tool first on `PATH` | run ok |

### 1.4 Unbuilt names this plan relies on (rebase before task 6)

| From | Names |
|---|---|
| F-202 UI (tasks 6–9) | `project-store.ts` (`ProjectActions.create(name)`, `useProjects`), `project-dialogs.tsx` (`ProjectNameDialog` with `mode: "create" \| "rename"`), `project-controls.tsx`, `e2e/projects.ts` (`createProjectInUi`, `WorkspaceHook`), the switcher's "New project…" |
| F-205 (tasks 4 onwards) | `CanvasHost`, `.workflow-canvas[data-canvas-state="ready"]`, React Flow node `data-id` set to projection keys, the typed badge |
| F-202 with F-205 | opening a project (`openProject`) drives `workspaceStore`, so the canvas shows the default workflow. Whichever of the two lands second wires this. |

## 2. Design

### 2.1 Where templates live, and their format
- **Source of truth:** `packages/lang-2610/templates/<id>/**`. These are real project trees: text only, UTF-8, `\n` line endings, no dotfiles, each file at most 1 MB (IO-12). The oracle runs them in place, through a new `dir` key.
- **Metadata:** `packages/lang-2610/templates/templates.yaml` is hand-edited. It has `blank: {id, name, description}` and `templates: [{id, name, description}]`, in display order.
- **Bundle:** `packages/lang-2610/templates.json` is generated by `pnpm gen:templates 26.10`. It holds `{ blank: ProjectTemplate, templates: ProjectTemplate[] }`, with files sorted by path and their bytes exactly as on disk. A unit test runs it with `--check`.
  - The pack loads it lazily through `loadTemplates()`, like `loadCatalogue`. It becomes a JSON chunk in the worker.
- **Not a stored or exported format:**
  - `templates.json` is build data;
  - a created project's files go into F-202's IndexedDB schema v1 unchanged;
  - the template trees are new content, not a new format.
- **No substitution.** A project is byte-identical to the tree the oracle checked. Templates set no `manifest.name` (open point 3).
- **Start blank** is the pack's `blank` template. The web app knows no template ids: it uses `TemplateList.blank.id`.

### 2.2 Template content
The builder writes these with the syntax reference, the vendored skills and the oracle, never from memory. They are written new, not copied from rnaseq-nf or nf-core. Tool versions and conda specs are facts and may come from the pinned nf-core modules, cited in the case's `sources`.

Rules for every template:
- every `.nf` file enables types;
- each process is alone in `modules/local/<lower>/main.nf`, with an explicit include path;
- a Groovydoc block (LA-50) on every process and workflow, the entry workflow included, plus `@param` and `@return` tags;
- `nextflow_schema.json` uses draft 2020-12 with `$defs`, has no `$id` (no repository is known yet), and describes every parameter;
- `nextflow.config` sets `manifest { nextflowVersion = '>=26.10.6'; description = … }`;
- a short British English `README.md`;
- no plugins and no remote data (the oracle runs offline);
- no `publishDir` and no `Channel.`;
- closures name their parameters;
- operators come from the typed set;
- each script is a printer fixed point (LA-45).

The three templates:
- **`blank`:**
  - `main.nf`: the flag, a documented empty `params {}`, and a documented empty entry `workflow {}`. There is **no `output {}`**, because lint rejects one when nothing is published (probe; open point 4).
  - `nextflow.config`, a `nextflow_schema.json` with no parameters, and `README.md`.
- **`hello-world`:**
  - a params block, a `channel.` factory, one typed process `modules/local/say_hello/main.nf` that writes a file, and an output block publishing it;
  - no records, no code nodes and no `topic:` (it runs `echo` only, open point 6). F-701 rebuilds it from blank using only the keyboard, so every construct must be reachable from the palette.
- **`samplesheet-multiqc`:**
  - `record Sample` (`id`, `fastq_1: Path`, and `fastq_2: Path?` if the docs allow it);
  - `params { input: Channel<Sample> }`;
  - typed `FASTQC` (record in, one record out) and `MULTIQC` (collected paths in, one record or path out), each with a `topic:` version from `eval(...)` and a `stub:` block;
  - the entry workflow publishes the FastQC results, the MultiQC report and `channel.topic('versions')`;
  - `assets/samplesheet.csv`, tiny text FASTQs under `assets/test/`, and a `test` profile that sets `params.input`.

### 2.3 Engine and workspace
- **The pack interface** gains `loadTemplates()`.
- **Engine `templates.ts`:**
  - `templateList` strips the file text;
  - `templateFiles` resolves one template's files;
  - `EngineApi.templates` is queued like `palette`.
- **Workspace `createProject(input)`:**
  - with `input.template` set, it requires `files` to be empty and writes `templateFiles(languageVersion, template)`;
  - `templates` passes straight through;
  - `publishDocs` is carried but has no effect until F-606.

### 2.4 Dialog UX and accessibility (`NewProjectDialog`)
- **Element:** native `<dialog>` opened with `showModal()`, labelled by the `<h2>New project</h2>`.
- **Form:** submitting calls `preventDefault` (CSP). Create submits; Cancel, Escape or a successful Create closes the dialog and returns focus to the control that opened it.
- **Openers:**
  - the switcher's "New project…" opens the dialog with Start blank selected;
  - the header's **Templates** button (enabled, open point 10) opens it with From a template selected.
- **Fields, in order:**
  1. **Name:** "Untitled project", focused and selected; 1 to 100 characters.
  2. **Nextflow version:** a `<select>` of `installedPackVersions()`.
  3. **How to start:** a `<fieldset>` with native radios "Start blank" and "From a template". F-401 and F-403 add "Import".
  4. **Template:** a `<fieldset>`, shown only for From a template. It has one radio per template, with the name, and the description linked by `aria-describedby`; the first is selected. While the list loads it shows "Loading templates…". If the list fails, it shows "Templates couldn't be loaded." and Start blank still works.
  5. **Publish docs to GitHub Pages:** a checkbox, checked.
  6. **Projects in this browser:** a list of buttons that open a project, with the open one `aria-current`. With none, it shows "No projects in this browser yet."
  7. The sentence "Projects are stored in this browser only. Clearing site data deletes them."
- **Buttons:** Cancel, then Create (shows "Creating…" and is disabled while busy).
- **Errors:** shown inline with `role="alert"`; the dialog stays open.
- **Keyboard:** Tab between groups and arrow keys inside each radio group; nothing but native controls (QA-10, QA-11).
- **Layout:** the dialog body scrolls when it is too tall, and there is no animation (QA-13).
- **After Create:** `create` calls `createProject`, then `openProject`, and the canvas shows the default workflow.

### 2.5 Oracle additions (`tools/oracle`, still standalone)
- **`dir`:** an optional path relative to the manifest; it must resolve inside the repository.
- **`lint.clean: true`:** any lint warning fails the case.
- **`run.tools: [names]`:** the runner writes an executable shim per tool, which prints `<tool> 0.0.0`, into a directory outside the copied tree and puts that directory first on `PATH` (open point 5).

## 3. Files

### 3.1 Create

| Path | Exports or content |
|---|---|
| `packages/lang-core/src/templates.ts` | see the block below |
| `packages/lang-2610/templates/templates.yaml` | the metadata (2.1) |
| `packages/lang-2610/templates/{blank,hello-world,samplesheet-multiqc}/**` | the trees (2.2) |
| `packages/lang-2610/templates.json` | generated |
| `packages/lang-2610/test/templates.test.ts`, `test/templates/doc-tags.ts` (test-only LA-50 tag scan) | section 4 |
| `scripts/gen-templates.ts` | see the block below |
| `test/gen-templates.test.ts` | section 4 |
| `packages/engine/src/templates.ts` | see the block below |
| `packages/engine/test/templates/templates.test.ts` | section 4 |
| `apps/web/src/project/templates.ts` | see the block below |
| `apps/web/src/project/new-project-dialog.tsx` (and its CSS) | see the block below |
| `apps/web/test/{new-project-dialog.test.tsx,templates-request.test.ts}` | section 4 |
| `e2e/templates.ts` | `TEMPLATE_IDS`; `TEMPLATE_NODES: Record<string, readonly { id: string; title: string; typed: boolean \| null }[]>`; `readTemplate(id)` (reuses `readProject`); `openNewProject(page, via: "switcher" \| "templates")`; `createFromDialog(page, { name, template: string \| null })` |
| `e2e/new-project.spec.ts` | section 4 |

`packages/lang-core/src/templates.ts`, re-exported from the index:

```ts
export interface TemplateFile { readonly path: string; readonly text: string }
export interface TemplateInfo { readonly id: string; readonly name: string; readonly description: string }
export interface ProjectTemplate extends TemplateInfo { readonly files: readonly TemplateFile[] }
export interface TemplateSet { readonly blank: ProjectTemplate; readonly templates: readonly ProjectTemplate[] }
```

`scripts/gen-templates.ts`:

```ts
templatePaths(version: string, repoRoot?: string): { dir: string; yaml: string; json: string }
readTemplateTree(dir: string): TemplateFile[]  // throws on binary, CRLF, symlink, dotfile, > 1 MB
templatesJson(yamlText: string, file: string, read: (id: string) => TemplateFile[]): string
genTemplates(opts: { version: string; check?: boolean; repoRoot?: string }): { status: 0 | 1; message: string }
main(argv: readonly string[]): number
```

`packages/engine/src/templates.ts`:

```ts
export interface TemplateList { readonly version: string; readonly blank: TemplateInfo; readonly templates: readonly TemplateInfo[] }
export const loadTemplateSet: (version: string, packs?: readonly LanguagePack[]) => Promise<TemplateSet> // perPack
export function templateList(version: string, packs?: readonly LanguagePack[]): Promise<TemplateList>
export function templateFiles(version: string, id: string, packs?: readonly LanguagePack[]): Promise<readonly ProjectFile[]>
```

`apps/web/src/project/templates.ts`:

```ts
export type TemplatesState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly list: TemplateList }
  | { readonly status: "error"; readonly message: string };
export function requestTemplates(version: string): Promise<TemplateList> // one per version; forgets a rejection
export function useTemplates(version: string | undefined): TemplatesState
```

`apps/web/src/project/new-project-dialog.tsx`:

```ts
export type NewProjectRoute = "blank" | "template";
export interface NewProjectRequest { readonly name: string; readonly languageVersion: string; readonly template: string; readonly publishDocs: boolean }
export interface NewProjectForm { readonly name: string; readonly languageVersion: string; readonly route: NewProjectRoute; readonly templateId: string | null; readonly publishDocs: boolean }
export function newProjectRequest(form: NewProjectForm, list: TemplateList | null): NewProjectRequest | { readonly error: string }
export interface NewProjectDialogProps {
  readonly languageVersions: readonly string[];
  readonly templates: TemplatesState;
  readonly projects: readonly ProjectMeta[];
  readonly currentId: string | null;
  readonly initialRoute: NewProjectRoute;
  onCreate(request: NewProjectRequest): Promise<void>;
  onOpen(id: string): Promise<void>;
  onClose(): void;
}
export function NewProjectDialog(props: NewProjectDialogProps): JSX.Element
```

### 3.2 Change
- **`packages/lang-core/src/index.ts`:** `LanguagePack.loadTemplates(): Promise<TemplateSet>`, and the exports.
- **`packages/lang-2610/src/index.ts`:**
  ```ts
  loadTemplates: async () => (await import("../templates.json")).default as TemplateSet
  ```
  It is dynamic only, so the pack stays erasable.
- **`packages/engine/src/service/{types,service}.ts`:** `EngineApi.templates(version): Promise<TemplateList>`. In `index.ts`, export `templateList`, `templateFiles` and `TemplateList`.
- **`apps/web/src/workspace/types.ts`:** `NewProject` gains `readonly template?: string` and `readonly publishDocs?: boolean`, with doc comments.
- **`apps/web/src/workspace/workspace.ts`:**
  - `createProject` resolves the template, and refuses an unknown template or a template given together with files;
  - `templates` passes through.
- **`apps/web/src/engine/engine-client.ts`:** `templates: (v) => race(remote.templates(v))`.
- **`project-store.ts`:**
  - `create(request: NewProjectRequest)` replaces `create(name)`;
  - dialog state moves into the store (`dialog: { kind: "new"; route } | { kind: "rename" } | { kind: "delete" } | null`, `showDialog`, `closeDialog`) if F-202 kept it local, so the header can open it.
- **`project-controls.tsx`, `project-dialogs.tsx`:** New project renders `NewProjectDialog`. `ProjectNameDialog` keeps the rename mode only.
- **`shell/app-header.tsx`:** Templates is enabled, with an `onTemplates` prop.
- **`tools/oracle/src/cases.ts`, its runner (`nextflow.ts` environment), `README.md`:** the 2.5 keys.
- **`tools/oracle/cases/cases.yaml`:** three new cases:
  - `template-blank` and `template-hello-world`: `dir`, `lint: {expect: ok, clean: true}`, `run: {expect: ok}`;
  - `template-samplesheet-multiqc`: also `run.args: ["-stub", "-profile", "test"]` and `run.tools: [fastqc, multiqc]`.
- **`package.json`:** `"gen:templates": "node scripts/gen-templates.ts"`.
- **`biome.json`:** exclude `packages/lang-*/templates.json` and `packages/lang-*/templates`.
- **`.gitattributes`:** `packages/lang-*/templates/** -text`.
- **AGENTS.md:**
  - a Commands row for `pnpm gen:templates 26.10` ("after editing `packages/lang-*/templates/`; `--check` compares");
  - a Generated files line for `packages/lang-*/templates.json`;
  - a Nextflow knowledge line: templates are oracle cases `template-<id>`, and `run.tools` shims tools for `eval`.
- **Tests that move to the new dialog (moved, not weakened):**
  - F-202's "the New project dialog says projects are stored in this browser only" unit test;
  - `e2e/projects.ts` `createProjectInUi` drives the new dialog through Start blank;
  - any F-202 assertion that a blank project has no files becomes "has the blank template's files".
- **`e2e/app-shell-layout.spec.ts`:** in the `F-201 UX-01` test, Templates is now enabled. Re-approve the app-shell baseline from CI.

## 4. Tests (written before the code in each task)

| File: test | Asserts |
|---|---|
| **`test/gen-templates.test.ts`** | |
| `F-203 LA-02: templates.json is up to date with the template trees for every pack (pnpm gen:templates --check)` | status 0 |
| `F-203: gen:templates sorts files by path, keeps exact bytes, puts blank first and the templates in templates.yaml order` | temporary root |
| `F-203 IO-01 IO-12: gen:templates refuses binary or non-UTF-8 files, CRLF, symlinks, dotfiles and files over 1 MB` | text-only schema v1 |
| `F-203: gen:templates refuses an unlisted template directory, a listed id without a directory, and duplicate or non-kebab ids` | |
| **`packages/lang-2610/test/templates.test.ts`** (pack parser) | |
| `F-203 LA-02 Q6: loadTemplates gives blank, then Hello world and Samplesheet to MultiQC, with sentence-case names and descriptions` | |
| `F-203 LA-03: every template's nextflow.config sets manifest.nextflowVersion to '>=26.10.6'` | config AST |
| `F-203 LA-11 LA-12: every .nf file starts with nextflow.enable.types = true; each process is alone in modules/local/<lower name>/main.nf` | |
| `F-203 LA-40: every main.nf has a typed params block; Hello world and Samplesheet to MultiQC publish through an output block; no publishDir anywhere` | |
| `F-203 LA-42: every Samplesheet to MultiQC process has a topic: section emitting to 'versions'` | |
| `F-203 LA-45 ADR-0032: every template script is a printer fixed point` | |
| `F-203 step 3 LA-50 ADR-0013: every process and workflow, the entry workflow included, has a doc comment with Markdown text, an @param per input or take and an @return per output or emit` | `doc-tags.ts` |
| `F-203 step 3 LA-53: every params-block parameter has a non-empty description in nextflow_schema.json, and the schema lists no other parameters` | |
| **`packages/engine/test/templates/templates.test.ts`** (real pack and service) | |
| `F-203 LA-11 LA-40 LA-43 LA-44: each template opens with no parse problem and no diagnostic of any severity` | |
| `F-203 step 1 LA-11 UX-23: each template's entry workflow projects the expected nodes, and every call's callee is typed` | `TEMPLATE_NODES` values |
| `F-203 LA-41: Samplesheet to MultiQC's FASTQC takes and emits records` | port types |
| `F-203 LA-44: every chain step in the templates is a known typed operator` | |
| `F-203 ADR-0003: templates(version) lists blank and the templates without file text, needs no open project, and survives structuredClone; an unknown version rejects` | |
| `F-203: templateFiles returns the files sorted by path; an unknown id rejects naming the id and version` | |
| **Oracle `tools/oracle/test/cases.test.ts`** | |
| `F-203 ADR-0019: dir resolves relative to the manifest; a missing dir or one outside the repository is a problem` | |
| `F-203: lint.clean fails a case whose lint reports a warning` | |
| `F-203: run.tools puts an executable shim per tool first on PATH, outside the copied tree` | |
| `F-203 LA-02: every template in templates.yaml has a template-<id> case pointing at it, with lint clean and a run check` | reads by path |
| **Oracle cases (step 2)** | `template-blank`, `template-hello-world`, `template-samplesheet-multiqc` pass in the CI `oracle` job |
| **Web `workspace.test.ts`** (extend) | |
| `F-203 UX-60 LA-02: createProject with a template stores exactly its files and the chosen version` | |
| `F-203 UX-60: Start blank stores the pack's blank template` | |
| `F-203: createProject refuses an unknown template, and a template given with files` | |
| `F-203: templates passes straight through` | |
| **`engine-client.test.ts`** | `F-203 ADR-0003: templates crosses the bridge` |
| **`templates-request.test.ts`** | `F-203: requestTemplates sends one request per version and forgets a rejected one` |
| **`new-project-dialog.test.tsx`** | |
| `F-203 UX-60 LA-01: name (Untitled project), a version select of installed packs only, and the Start blank and From a template routes` | |
| `F-203 UX-60: From a template lists each template as a radio with its description, the first selected` | |
| `F-203 UX-60 FI-40: Publish docs to GitHub Pages is checked by default` | |
| `F-203 UX-60 ADR-0002: the dialog says projects are stored in this browser only and lists them, the open one current; with none it says so` | |
| `F-203 QA-10: every control is labelled; descriptions are linked with aria-describedby; the dialog is labelled by its heading` | |
| `F-203 UX-60: loading and failed template lists; Start blank stays usable` | |
| `F-203 UX-60: newProjectRequest rejects a bad name and returns the route's template id and the Publish docs value` | |
| **`project-store.test.ts`** | `F-203 UX-60: create sends the template and Publish docs, then opens the new project` |
| **`app-shell.test.tsx`** | `F-203 UX-01: Templates is enabled and opens the dialog on From a template` |
| **E2E `e2e/new-project.spec.ts`** | |
| `F-203 step 1 UX-60 LA-11: Start blank opens main.nf's entry workflow with the expected nodes` | |
| `F-203 step 1 UX-60 LA-11 UX-23: Hello world shows the expected nodes, calls badged typed` | |
| `F-203 step 1 UX-60 LA-11 LA-41: Samplesheet to MultiQC shows the expected nodes, calls badged typed` | |
| `F-203 step 1 ADR-0021: each template's canvas matches its approved baseline @visual` | baselines `template-hello-world-chromium-linux.png` and `template-samplesheet-multiqc-chromium-linux.png`, screenshots of the `.workflow-canvas` element after `canvasReady` |
| `F-203 IO-01 LA-02: a project created from a template holds exactly the template's files, also after reload` | `readFile` against the disk; `.nf-builder/` ignored (F-207) |
| `F-203 UX-60 UX-70 QA-11: the dialog works by keyboard alone; Escape cancels and focus returns to the opener` | |
| `F-203 UX-60 ADR-0002: the dialog lists stored projects and opens one` | |
| `F-203 UX-60: an empty name shows an error and creates nothing` | |
| `F-203 UX-01 UX-60: the header's Templates button opens the dialog on From a template` | |
| `F-203 QA-30: creating from each template raises no CSP violation or console error` | |

## 5. Tasks (one builder run each)

Branch `feat/F-203` after F-202 and F-205 merge. Local e2e runs need `export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.

1. **Oracle keys `dir`, `lint.clean` and `run.tools`,** with tests and the README.
   - Done when `pnpm --filter @nf-builder/oracle test` and `pnpm check` pass.
2. **Format and blank:**
   - lang-core types and `loadTemplates`;
   - `scripts/gen-templates.ts`, the root script and its test;
   - `templates.yaml` (blank only), the `blank/` tree and `templates.json`;
   - the Biome exclusions, `.gitattributes` and the AGENTS.md rows;
   - the `template-blank` case;
   - pack tests for blank.
   - Done when these pass: `pnpm gen:templates 26.10 --check`, `pnpm oracle -- --case template-blank`, `pnpm --filter @nf-builder/lang-2610 test` and `pnpm check`.
3. **Engine `templates.ts` and `EngineApi.templates`,** with engine tests for blank.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
4. **Hello world:** the tree, the YAML entry, regeneration, the case, and the pack and engine expectations (fill in `TEMPLATE_NODES`).
   - Done when these pass: `pnpm oracle -- --case template-hello-world`, `pnpm gen:templates 26.10 --check`, the two package test suites and `pnpm check`.
5. **Samplesheet to MultiQC:** the same as task 4, including the LA-41 and LA-42 tests.
   - Done when these pass: `pnpm oracle -- --case template-samplesheet-multiqc`, then the full `pnpm oracle`, and `pnpm check`.
6. **Workspace and bridge:** `NewProject.template` and `publishDocs`, `createProject` resolving templates, `templates` passed through, the client, `requestTemplates`.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
7. **Dialog:** the store's `create` and dialog state, the header Templates button, the unit tests and the moved F-202 test.
   - Done when these pass: `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts` (the templates chunk is JSON and isn't scanned).
8. **E2E,** written first:
   - `e2e/templates.ts` and `new-project.spec.ts`;
   - the F-202 helper update and the F-201 UX-01 assertion.
   - Done when these pass: `pnpm test:e2e -- --grep "F-203|F-202|F-201|F-205"`, `pnpm smoke` (under 60 s) and `pnpm check`.
9. **CI and baselines** (orchestrator).
   - Push the branch.
   - Download the `playwright-chromium` artefact, view `template-*-actual.png` and `app-shell-default-actual.png`, and commit them at the baseline paths (ADR 0021).
   - Done when every job of `CI` and `Scope guard` is green, the `oracle` job included.
10. **Records** (section 7).
    - Done when `pnpm check` passes and the Scope guard passes with `scope-change` (for the new M8 feature).

## 6. Open points (each with a recommendation; none decided here)

1. **Q6, the templates in v0.1** (an open question: decide and record).
   - **Recommendation:** answer "Start blank, Hello world and Samplesheet to MultiQC". These are the two F-203 names, and F-504, F-607 and F-701 already refer to them.
   - Move the nf-core-style skeleton and Pipeline composition to a new M8 feature, "More project templates", added with `scope-change` (ADR 0030). This defers them; it doesn't drop them. The reasons:
     - nf-core's typed module conventions are days old (ADR 0007);
     - the nf-core skeleton relies on plugins (nf-schema, utils) that the offline oracle can't fetch.
2. **Templates in the pack, as trees plus generated JSON** (2.1; a new generated-file kind and a root script).
   - **Recommendation:** accept, and record it in an ADR, with `loadTemplates()` replacing the sketch's `templates: Template[]`. It is **not** a stored or exported format.
   - **Alternative:** Vite `import.meta.glob('…', { query: '?raw' })`. It needs no generator, but it ties the pack to Vite, and the result is JS chunks that `check:hosts` scans, so the template URLs would need entries in `non-fetched-urls.ts`.
3. **No substitution and no `manifest.name`.**
   - **Recommendation:** accept. What the oracle checked is what the user gets, and a template's name would be wrong for most projects. F-601 (config forms) can set it; add a note there and in F-607 (the metro title comes from `manifest.name`).
4. **Blank has no output block** (the probes show lint rejects `output {}` without `publish:`, and an empty `publish:` is a syntax error).
   - **Recommendation:** read LA-40 as "an output block once something is published", in the ADR, with no spec edit.
5. **`eval` versions under `-stub`** (the probe failed without the tool and passed with a shim).
   - **Recommendation:** keep the LA-42 `eval` idiom and add the oracle's `run.tools` shims.
   - **Alternative:** fixed versions emitted as values. That needs no oracle change, but the versions can drift from the pinned container.
6. **Hello world has no `topic:` section,** because `echo` is not a tool. It also stays reachable from the palette for F-701.
   - **Recommendation:** accept.
7. **Test data for Samplesheet to MultiQC:** tiny text FASTQs and a relative-path samplesheet under `assets/`, plus a `test` profile. No remote data and no plugins.
   - **Recommendation:** accept, because of the offline oracle and text-only IndexedDB.
8. **The Publish docs checkbox does nothing yet:** it is rendered, checked by default and sent as `NewProject.publishDocs`, but nothing uses it until F-606. Add a note to F-606.
   - **Recommendation:** accept.
   - **Alternatives:** hide it, which drops something the feature lists; or write the FI-40 stubs now, which is F-606's scope.
9. **The Import route and the metro map checkbox** are out of scope; add notes to F-401, F-403 and F-607. The route group takes a third radio.
   - **Recommendation:** accept.
10. **The header Templates button** (UX-01 doesn't say what it does).
    - **Recommendation:** enable it to open the dialog on From a template, update the F-201 UX-01 assertion, and re-approve the app-shell baseline from CI.
    - **Alternative:** leave it disabled (no baseline churn).
11. **Licence of template content** (it is copied into users' pipelines; decide and record).
    - **Recommendation:** dedicate `packages/lang-*/templates/` under MIT-0, so users needn't keep a notice, with a `licences.md` row. Write the code fresh; facts only from nf-core, cited in `sources`.
    - **Alternative:** the repository's MIT.
12. **The doc-comment check is test-only** until F-311 (comment parser) and F-312 (LA-54).
    - **Recommendation:** accept. Notes to F-311 and F-312: "templates produce no LA-54 suggestion".
13. **Layout:** the template baselines use F-205's interim layout.
    - **Recommendation:** note in F-207 that it re-approves them, and that `.nf-builder/layout.json` written on open is outside the template files.
14. **Project source:** none is recorded in F-203 (it would change the schema).
    - **Recommendation:** note in F-401 that it may add `{kind: "template", id, version}`.
15. **`depends_on`:** F-205's PR adds F-205 to F-203's `depends_on` (the settled decision). If it hasn't, F-203's PR does, with `scope-change`.

**AGENTS.md decide-and-record items:**
- **Runtime dependency:** none.
- **Package boundaries and dependency-cruiser:** no change. `LanguagePack` gains a member.
- **Stored or exported format:** none (2).
- **Workflows:** none; the `oracle` job runs every case.
- **Open question:** Q6 (1).
- **`features.json`:** the new M8 feature (1), notes, and possibly `depends_on` (15).
- **Accepted ADRs:** no conflict. ADR 0007 "Templates are typed" is met, and ADR 0013's docs files stay with F-606.

## 7. Records (drafts)

- **ADR** (`Accepted (agent)`, the next free number at landing): "Project templates are pack-owned file trees, bundled as a lazy JSON chunk and checked by the oracle". It covers open points 2 to 8 and 10 to 12, the oracle keys and `NewProject.template`, and gets a row in `docs/adr/README.md`.
- **`open-questions.md` Q6:** "Answered 2026-…-… (agent): …", per point 1.
- **Spec:** `architecture.md`'s sketch line becomes `loadTemplates(): Promise<TemplateSet>; // project templates, lazily loaded (ADR NNNN)`.
- **AGENTS.md:** the 3.2 rows.
- **`licences.md`:** the template-content row (point 11).
- **`features.json`** (with `scope-change` for the new feature):
  - **F-203:** `passes`, and the note "Verified …: step 1 by `e2e/new-project.spec.ts` (DOM and @visual) and the engine projection test; step 2 by the oracle cases `template-*` (CI job `oracle`); step 3 by the `lang-2610` template tests and the zero-diagnostics engine test";
  - the new M8 feature;
  - **notes** for F-207, F-311, F-312, F-401, F-403, F-504 (Hello world is the typed template), F-601, F-606, F-607 and F-701.
- **`progress.md` Decisions:** the ADR, Q6, the generator and the oracle keys, the Templates button and the baseline re-approval, the moved F-202 tests, the Publish docs no-op.
- **Plan files:**
  - save this plan as `docs/plan/handoff/plan-F-203.md`, add its row to the handoff README, and delete the plan in the merging PR;
  - remind the builder to keep ADR numbers in step with the README, whose "next free" is 0045 before F-202 and F-205 land.

## 8. Evidence

- **Repository reads:**
  - `docs/plan/features.json` (F-111, F-201 to F-210, F-401 to F-406, F-504, F-601, F-602, F-606, F-607, F-701, F-702);
  - `docs/spec/{language,ux,files,data-and-io,architecture,quality}.md`;
  - ADRs 0002, 0006, 0007, 0011, 0013, 0019 and 0035;
  - `docs/plan/open-questions.md`;
  - `docs/plan/handoff/{README,plan-F-202,plan-F-205}.md`;
  - `packages/lang-core/src/index.ts`, `packages/lang-2610/src/{index,scaffold,palette}.ts`, `packages/engine/src/{packs.ts,service/*}`;
  - `tools/oracle/src/{cases,check,paths,trees}.ts`, `tools/oracle/cases/cases.yaml`;
  - `scripts/{gen-palette,non-fetched-urls}.ts`, the `scripts/check-hosts.ts` header, `test/gen-palette.test.ts`;
  - `.dependency-cruiser.cjs`, `biome.json`, `playwright.config.ts`;
  - the vendored skills `build-nextflow-pipeline`, `nf-pipeline-design`, `nextflow-output-patterns`, `nextflow-schema`.
- **Branch reads:**
  - `origin/feat/F-202`: `apps/web/src/workspace/{types,workspace,project-name}.ts`, `engine/{engine-client,engine.worker}.ts`, `palette/use-palette-view.ts`, the workspace test names;
  - `origin/feat/F-205`: `workspace/workspace-store.ts`, `main.tsx`, `e2e/canvas{,.spec}.ts`, `tools/oracle/cases/f205-canvas/**`.
- **Corpus:**
  - `/home/user/wt-F-111/.cache/corpus/rnaseq-nf-typed` (sha `ce09c72`): `main.nf`, `modules/{rnaseq.nf,fastqc,multiqc}`, `nextflow.config`, `nextflow_schema.json`;
  - the registry snapshot index on `origin/registry-snapshot` (fastqc and multiqc are `typed: false`).
- **Probes** under `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f203-probe/`:
  - `blank`, `b1`, `b3` and `b4` are the blank-template variants;
  - `evalstub` is the CSV records and `eval` topic case;
  - `shims` is the PATH shim.
  - The Nextflow used was `/home/user/wt-F-111/.cache/nextflow/26.10.7/nextflow-26.10.7-dist`, with the oracle's environment (`NXF_OFFLINE`, `NXF_SYNTAX_PARSER=v2`).
- **Not verified:**
  - whether `fastq_2: Path?` loads from a blank CSV cell;
  - the exact `eval` version commands;
  - the conda specs.
  
  Tasks 4 and 5 settle these with the oracle.
