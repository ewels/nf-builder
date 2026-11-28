# Plan: F-303, the edit popup's Configure tab for typed processes

Written by the planner on 2026-11-28 from `main` at `d0cea22` (F-605 merged), designed against `feat/F-301` at `e292d42` (`/home/user/wt-F-301`, in review: `CreateWorkflow`, `freshName`, `addFromPalette` with groups and rollback) and with `feat/F-601` at `2bb41e7` (`/home/user/wt-F-601`, engine side only) for form patterns. I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**In scope:**
- **Opening the popup** (UX-40): double-click a process node, Enter on the already selected node, or the details header's Edit button (UX-32, F-206 note). A modal with two tabs, Configure (default) and Code; Code shows disabled until F-304.
- **Configure for a typed process** (UX-41): name, description (the doc comment's text), inputs (name, type, nullable), stage, outputs (name, type, value), topics, directives (added from a searchable catalogue list that leaves out deprecated ones), script, stub.
- **No kind control** (UX-42, ADR 0008).
- **Apply and Cancel** (UX-44): Apply validates and applies one command, or one group when the name changes, so it is one undo step (AR-23, ADR 0051, F-209 note). Cancel and Esc discard.
- **Read-only** (F-703 note, ADR 0056): no popup on double-click or Enter, and the Edit button isn't rendered.
- **F-207 note:** a rename through the popup keeps the node's position (repeat of F-207 step 3).

**Out of scope:**
- The Code tab, Show whole file, Format and parse-gated Apply (UX-43, F-304).
- Legacy processes (F-306), chains, factories, params, output, records, functions, includes (F-305), workflow nodes (double-click opens a tab, UX-50, F-307), agents.
- Per-port description fields and nf-docs tag upkeep (UX-46, LA-50 to LA-52, F-311). F-303 edits only the description text and keeps the tags as they are.
- Documentation suggestions (F-312).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-40:** double-click, or Enter on a *selected* node, opens a modal with Configure (default) and Code. Workflow nodes open their tab instead (UX-50).
- **UX-41:** the typed-process field list above, "built from the catalogue"; directives are added "from searchable list".
- **UX-42 / ADR 0008:** node kinds are fixed; there is no control to change one.
- **UX-44:** both tabs edit the same pending state. Apply validates and applies one edit command (one undo step). Cancel discards. The parse gate belongs to the Code tab (F-304).
- **AR-21** lists `UpdateDeclaration` ("from the popup") and `SetDirective`; neither exists. **AR-30** puts the popup draft in a Zustand store. **AR-24 / ADR 0039:** a result that gains a parse problem is refused; workflow-body commands reprint the whole declaration; renames edit in place and carry layout keys (`packages/engine/src/layout/carry.ts` reads `renameDeclaration`); "files don't move".
- **ADR 0051:** commands under one `group` are one step; history keys don't fire in dialogs. **ADR 0056:** narrowing closes open project dialogs; Enter, Space and Escape still select in read-only. **ADR 0049:** Edit and Code show disabled until F-303 and F-304. **LA-45:** edited declarations are formatted. **LA-34:** `storeDir` is a deprecated directive.

### 1.2 Code (main and F-301)
- **AST** (`packages/lang-core/src/ast/script.ts`): `TypedProcess` has `directives`, `inputs` (`TypedName | RecordInput | TupleInput`), `stage`, `outputs` (`NamedOutput | ExpressionStatement`), `topics` (each a `>>` binary), `when`, `exec` (the script, `script:`/`exec:`/`shell:` label), `stub`. The doc comment is a `doc` comment in the process's `leadingComments`; `docSummary` (`packages/engine/src/details/declaration.ts`) already cuts at the first tag.
- **Edit tools:** `replaceNode`, `attachedComments`, `NO_RANGE` nodes (`edit/nodes.ts`); `reprintDeclaration(file, original, updated, printer, removed)` (`edit/splice.ts`) refuses any edit that would drop a comment not under a `removed` node. There is no expression parser: new text is parsed by `SourceParser.parseScript` on a synthetic script.
- **Resolution:** `resolveCallee(model, path, name)` gives a call's declaration and file. `Callee` on a projection node gives `kind`, `status`, `typed`, `path`, `module`.
- **Catalogue** (`packages/lang-2610/catalogue/script.json`): 41 `directives`, only `storeDir` with `deprecated: true`; signatures give parameter types (`cpus` Integer, `memory` MemoryUnit, `time` Duration, `debug` Boolean, `publishDir` Map or List). `processSections.stage` has `env`, `stageAs`, `stdin`; `typedOutputs` has `env`, `eval`, `stdout`; `functions` has `file`, `files`, `record`, `tuple`. `types` lists `Channel`, `Value`, `Duration`, `MemoryUnit` and `shim.*` (Bag, Float, Integer, Iterable, List, Map, Set, String, Path); no `Boolean` or `Record` (open point 9).
- **Canvas** (`apps/web/src/canvas/workflow-canvas.tsx`): no `onNodeDoubleClick` yet; React Flow 13 selects a focused node on Enter or Space. The F-206 e2e test "Enter or Space on a focused node selects it, Escape clears" must keep passing.
- **Store** (F-301 `canvas-store.ts`): `addFromPalette` applies parts with `sendNow(..., {group, label})` and rolls back a refused second part with `undo(revision, {discard: true})`; worth extracting as `applyGroup` for both.
- **Details:** `details-header.tsx` renders Edit and Code `disabled`; `e2e/details.spec.ts` ("Edit and Code show, disabled…") and `apps/web/test/details-pane.test.tsx` assert it; the `details-process-trim` visual baseline shows them (open point 13).
- **Dialogs:** native modal `<dialog>` with `showModalOnce` (`apps/web/src/project/project-dialogs.tsx`), errors inline, the dialog stays open.
- **e2e:** `openStoredFixture(page, name)` (`e2e/history.ts`) always loads `HISTORY_FIXTURE`; it needs a `dir` argument. `storedFiles`, `historyStatus`, `readSidecar`, `nodePosition`, `node` exist.

### 1.3 F-601 patterns to reuse
- **Value kinds:** `ConfigValueKind` (lang-core `config.ts`), `valueKindOf(names, types)` (lang-2610 `config/forms.ts`, catalogue type to widget), `parseValueText` and `valueText` (engine `config/values.ts`, with its unit hints "Use a whole number and a unit, for example 8.GB"). A directive's catalogue parameter types give its kind, its default and its hint the same way. The page can't import the pack (dependency-cruiser), so the worker sends the kind and default with each directive choice.
- **"Can't model it, keep it as code":** F-601 shows what its form can't model read-only, with "Edit in code", and never writes it. F-303 does the same for destructured `record(...)`/`tuple(...)` inputs, non-`>>`-string topics, directives outside the catalogue and `when:`.
- **Read-only when broken:** F-601 makes the form read-only when the file has parse problems; F-303 refuses to open on an `Unparsed` declaration and shows the refusal in the details pane's live region.
- F-601's web form isn't written yet, so there are no components to share; it lands on `main` before or after F-303 (open point 14).

### 1.4 Nextflow 26.10.7 behaviour (checked with the pinned dist, `.cache/nextflow/26.10.7`)
- Docs: `nextflow-io/nextflow` `v26.10.7/docs/process-typed.mdx` (inputs `name: Type`, nullable `Type?`, `stage:` with `env`/`stdin`/`stageAs`, outputs `name: Type = value` or one unnamed, `topic:` as `value >> 'name'`, directives as in legacy processes).
- A typed process with input `x: String` called as `P()` fails lint: "Process `P` expects 1 argument(s) but received 0". `P(null)` lints clean but `run -stub` fails; with `x: String?` it runs.
- A single-output process's call result *is* that output: `greet.text` fails lint ("Unrecognized property `text` for type Value<Path>"). Output names matter to readers only with two or more outputs.
- The step 2 trees in section 2.6, with `cpus 1`, `memory 1.GB`, `time 1.h` and a `/** … */` description, lint clean, stub-run, and the module is a `lint -format` fixed point (scratchpad `f303/start`, `f303/end`).

## 2. Design

### 2.1 What opens, and where
`popupTarget(node: GraphNode): PopupTarget` (engine, pure): `{kind: "typedProcess", path, name}` for a `call` node whose callee is a modelled, typed process; `{kind: "workflow"}` for a workflow callee (F-303 does nothing; F-307 opens the tab); otherwise `{kind: "unavailable", reason}` ("Editing legacy processes arrives with Migrate to typed.", "Configure isn't available for <kind label> nodes yet.", "<NAME> isn't found in the project.").
- **Double-click** (`onNodeDoubleClick`) and **Enter** on the node that is already selected open the popup; Enter on an unselected node only selects it (React Flow), as F-206's test expects (open point 2). Space never opens.
- **Edit** in the details header is enabled for `typedProcess` targets; for others it stays disabled with the reason as its title. **Code** stays disabled (F-304).
- **Read-only:** the canvas passes no open handler and the header doesn't render the buttons (unchanged). Narrowing closes the popup through `readOnlyStore.start`'s `onEnter` and discards the draft (open point 11).

### 2.2 The form (lang-core types, worker-built)
`EngineApi.declarationForm(path, workflow, node)` resolves the callee and returns `{revision, form: TypedProcessForm, choices: FormChoices}` or a refusal. Rows carry `origin`, the index of the AST item they came from (`null` for a new row), so the engine keeps an untouched row's node and comments, and knows how inputs moved.

| Section | Row fields | Kept as code (read-only row, "Edit in Code") |
|---|---|---|
| name, description | `name`; `description` (doc text before the first tag; tags kept in `docTags`) | |
| inputs | `name`, `type`, `nullable` | `record(...)`, `tuple(...)` inputs |
| stage | `directive` (from `processSections.stage`), `args` (text) | |
| outputs | `name` (empty only for a sole output), `type` (optional), `value` (text) | |
| topics | `value` (text), `topic` (name) | an emission whose right side isn't a string |
| directives | `name`, `args` (text); `deprecated`, `known` | none: unknown names are editable text too |
| script | `label` (`script`, `exec` or `shell`, never changed), `text` (dedented section body) | |
| stub | `text` or null (Add stub / Remove stub) | |

`when:` and comments that sit outside every row are kept and listed in a note at the top of the form ("Kept as written: when: section").
- **Choices:** `directives` = non-deprecated catalogue entries `{name, summary, kind, defaultArgs}` in name order; `stage` = the three stage directives with their signatures as hints; `types` = type names for an input's `<datalist>` (open point 9).
- **Defaults:** integer `1`, boolean `true`, memory `1.GB`, duration `1.h`; other kinds start empty and are required ("Enter a value for container.").

### 2.3 The command
`UpdateDeclaration {kind: "updateDeclaration"; path; name; form: DeclarationForm}` where `DeclarationForm = TypedProcessForm` for now (F-305 and F-306 extend the union). Label: `Edit process <name>`. Apply in the engine:
1. Locate the typed `Process` `name` in `path`; refuse `not-found`, `invalid` (legacy, `Unparsed`).
2. Keep the original node of every row whose fields are unchanged. Write every new or changed row as text in one synthetic script (`nextflow.enable.types = true` plus `process __NF_BUILDER_FORM__ { … }`, script text re-indented by four spaces), parse it with the pack, and map each parse problem to its row by line. Any problem refuses with `fields: [{field, message}]` and no patch.
3. Detach the parsed nodes (`NO_RANGE`, recursively); a changed row keeps the original row's leading and trailing comments.
4. Description: replace the doc comment's text before the first tag, keep the tags; a new comment is `/**\n * <text>\n */`; an empty description with no tags removes the comment.
5. Renamed inputs: rename `Variable` references in the rows the user didn't edit (stage, outputs, topics, directives, script, stub) (open point 4).
6. `reprintDeclaration` with the removed rows; refuses if a comment would be lost.
7. **Call sites** (open point 3): for every call of the process in the project (direct and aliased includes), permute the positional arguments by the input `origin`s, drop removed ones, and append `null` for new inputs (ADR 0039 placeholder; lint clean, F-112 reports it). A call fed by a pipe has no argument range: refuse with "GREET is called with a pipe in main.nf; change its inputs in the Code tab."
8. The usual AR-24 and LA-13 guards (`applyCommand`).

A rename is the existing `RenameDeclaration`, applied **after** the update in the same group (it carries layout keys and include entries). One command when the name is unchanged; otherwise group `popup-<session>-<n>`, label `Edit process <new name>`; a refused rename is rolled back with `undo(..., {discard: true})`, as F-301 does (`applyGroup`, 2.5).

### 2.4 Pending state and the popup (web)
- `popupStore` (Zustand, AR-30): `{status: "closed"} | {status: "loading" | "editing" | "applying"; opener; tab; node; target; revision; original; draft; choices; message; fields}`.
- `<EditPopup>` (lazy chunk): native modal `<dialog>` labelled "Edit process GREET", `role="tablist"` with Configure (selected) and Code (`aria-disabled`, title "The Code tab arrives with the declaration editor."). Sections are `<fieldset>`s with `<legend>`s in UX-41 order; rows have Remove, Move up and Move down buttons (inputs and outputs only), Add buttons per section. Script and stub are monospace `<textarea>`s (open point 6).
- **Directive picker:** a search box (`role="combobox"`, `aria-controls` a `role="listbox"`) filtering `choices.directives` by name and summary; Arrow keys and Enter pick; "No directives match." when empty. Picking adds a row with the default and focuses its value.
- **Validation:** names are checked on the page with `isIdentifier` (engine, pure) and duplicates refused inline; everything else on Apply. A refusal keeps the popup open, shows `message` in an `aria-live` region, marks each field in `fields` with `aria-invalid` and its message, and focuses the first.
- **Apply:** no change closes without a step. Otherwise `canvasStore.editDeclaration(...)`; if the project revision moved since the form was read, refuse: "GREET changed since the popup opened. Close it and open it again." On success: close, select the node (its new key after a rename), return focus to the opener.
- **Cancel / Esc:** close and discard, no confirmation (UX-44).

### 2.5 Copy (British English, sentence case)
| When | Text |
|---|---|
| Title | "Edit process GREET" |
| Kept rows | "Kept as written. Edit it in the Code tab." |
| Directive search empty | "No directives match." |
| Required value | "Enter a value for container." |
| Duplicate name | "Another input is already called reads." |
| Stale | "GREET changed since the popup opened. Close it and open it again." |
| Refused | "Couldn't apply: <engine message> Nothing was changed." |

### 2.6 Oracle cases (generated by the engine golden test)
- `f303-configure-start`: `main.nf` (`greet = GREET('world')`, `greet.view()`) and `modules/local/greet/main.nf` (described, `name: String`, `text: Path = file('greeting.txt')`, script, stub).
- `f303-configure-typed`: step 2's result: `cpus 1`; inputs `name: String`, `punctuation: String?`; output `message: Path = file('greeting.txt')`; the call `GREET('world', null)`. Both verified by hand (1.4); `lint: {expect: ok, clean: true}`, `run: {expect: ok}`.
- `f303-configure-all`: every section edited once (description, stage `stageAs`, a topic with `eval`, stub removed and added, a kept `record(...)` input, a kept `storeDir`, input reordered with two callers, an input renamed); `run.tools` shims for the `eval` tool.
- `f303-directive-defaults`: one process with each defaulted directive kind (`cpus 1`, `memory 1.GB`, `time 1.h`, `debug true`).

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/lang-core/src/declaration-form.ts` | `TypedProcessForm {kind: "typedProcess"; name; description; docTags: string \| null; inputs: InputRow[]; stage: StageRow[]; outputs: OutputRow[]; topics: TopicRow[]; directives: DirectiveRow[]; script: {label: "script" \| "exec" \| "shell"; text}; stub: string \| null; kept: string[]}`; `InputRow = {origin: number \| null; kind: "named"; name; type; nullable: boolean} \| {origin: number; kind: "code"; text}`; `StageRow`, `OutputRow`, `TopicRow` (`"emit"` or `"code"`), `DirectiveRow {origin; name; args; deprecated; known}`; `DeclarationForm = TypedProcessForm`; `FormField {section: FormSection; row: number \| null; part: string \| null}`; `FieldProblem {field: FormField; message}`; `DirectiveChoice {name; summary; kind: ConfigValueKind; defaultArgs: string}`; `FormChoices {directives; stage; types}` |
| `packages/engine/src/form/popup-target.ts` | `PopupTarget`; `popupTarget(node: GraphNode): PopupTarget` |
| `packages/engine/src/form/read-process.ts` | `processForm(file: ScriptSourceFile, process: TypedProcess): TypedProcessForm`; `formChoices(catalogue: ScriptCatalogue, model: ProjectModel, path: string): FormChoices` |
| `packages/engine/src/form/form-diff.ts` | `formChanged(a: DeclarationForm, b: DeclarationForm): boolean`; `inputOrigins(form): (number \| null)[]`; `isIdentifier` re-export for the page |
| `packages/engine/src/form/write-rows.ts` | `formSource(form, changed): {text: string; lines: Map<number, FormField>}` (the synthetic script) |
| `packages/engine/src/edit/commands/update-declaration.ts` | `updateDeclaration(state: EditState, command: UpdateDeclaration): TextPatch[]` |
| `packages/engine/src/edit/call-sites.ts` | `processCalls(model, path, name): CallSite[]`; `remapArguments(call, origins): Expression[]` |
| `packages/engine/test/form/*.test.ts`, `test/edit/update-declaration.test.ts`, `test/edit/call-sites.test.ts` | section 4 |
| `tools/oracle/cases/f303-*/**` | 2.6, with `cases.yaml` entries (`spec: [F-303, UX-41, UX-44, AR-21]`, sources: `process-typed.mdx`) |
| `apps/web/src/popup/popup-store.ts` | `PopupState`; `popupStore`; `usePopup`; `openPopup(request: {tab: string; node: string; opener: HTMLElement \| null}): Promise<void>`; `updateDraft(f: (d: TypedProcessForm) => TypedProcessForm)`; `applyPopup(): Promise<void>`; `closePopup()` |
| `apps/web/src/popup/edit-popup.tsx` | `default function EditPopup(): JSX.Element \| null` |
| `apps/web/src/popup/configure-form.tsx`, `row-list.tsx`, `directive-picker.tsx`, `popup.css` | presentational parts (`ConfigureForm`, `RowList<T>`, `DirectivePicker`) |
| `apps/web/src/canvas/node-keys.ts` | `opensPopup(event: {key; target}, selected: string \| null): string \| null` |
| `apps/web/test/popup-store.test.ts`, `configure-form.test.tsx`, `directive-picker.test.tsx`, `node-keys.test.ts` | section 4 |
| `e2e/popup.ts`, `e2e/popup.spec.ts` | `popup(page)`, `openPopupByDoubleClick(page, id)`, `addInput(page, {name, type, nullable})`, `addDirective(page, query, name)`; the tests |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`:** `UpdateDeclaration`; add to `EditCommand`; append `"updateDeclaration"` to `EDIT_COMMAND_KINDS`; the refusal gains `fields?: readonly FieldProblem[]`. **`index.ts`:** exports.
- **`packages/engine/src/edit/apply.ts`, `history/labels.ts`** (`Edit process <name>`), **`index.ts`** (`popupTarget`, `formChanged`, `inputOrigins`, `isIdentifier`, types).
- **`packages/engine/src/service/{types,service}.ts`:** `EngineApi.declarationForm(path, workflow, node): Promise<DeclarationFormResult | EngineRefusal>`, `DeclarationFormResult {revision; target: {path; name}; form; choices}`; `EngineRefusal.fields?`.
- **`packages/engine/test/edit/harness.ts`:** an `updateDeclaration` case (the read-back form with one random row change) and its structure check; `test/corpus/edit.corpus.ts` runs it on typed processes.
- **`packages/engine/test/edit/oracle-goldens.test.ts`:** the `f303-*` goldens.
- **`apps/web/src/engine/engine-client.ts`, `workspace/{types,workspace}.ts`, `e2e/engine.ts`:** pass `declarationForm` through.
- **`apps/web/src/canvas/canvas-store.ts`:** `applyGroup(parts: {command; label?}[], session, label): Promise<ApplyOutcome>` extracted from `addFromPalette`; `editDeclaration(request: {target; revision; form; newName: string \| null}, session?): Promise<EditOutcome>`.
- **`apps/web/src/canvas/workflow-canvas.tsx`, `canvas-host.tsx`:** `onNodeDoubleClick` and host `onKeyDown` through `opensPopup`, only when `!readOnly`.
- **`apps/web/src/details/details-header.tsx`:** Edit enabled for `typedProcess` targets, opening the popup; Code unchanged.
- **`apps/web/src/app-shell.tsx`:** mount `<Suspense><EditPopup/></Suspense>`; `onEnter` of the read-only store also calls `closePopup`.
- **Tests updated for the new behaviour, not weakened:** `e2e/details.spec.ts` "Edit and Code show, disabled…" and `apps/web/test/details-pane.test.tsx` become "Edit enabled for a typed process, Code disabled"; `e2e/history.ts` `openStoredFixture(page, name, dir = HISTORY_FIXTURE)`.
- **Unchanged:** workflows, CSP and host allow-list, dependency-cruiser rules, IndexedDB and sidecar formats, AGENTS.md command table.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **`packages/engine/test/form/popup-target.test.ts`** | |
| `F-303 UX-40 UX-42: only a call of a modelled typed process opens Configure; workflow, legacy, unresolved and other kinds don't, each with a reason` | over the f205/f206 fixture projections |
| **`packages/engine/test/form/read-process.test.ts`** | |
| `F-303 UX-41: the form of a typed process lists name, description, inputs, stage, outputs, topics, directives, script and stub in source order` | f303-configure-all start tree |
| `F-303 UX-41: record and tuple inputs, non-string topics and when: are kept as code rows or notes` | |
| `F-303 step 3 UX-41 LA-34: directive choices are every non-deprecated catalogue directive; storeDir isn't one` | against the real 26.10 catalogue |
| `F-303 UX-41: each directive choice's kind and default come from its catalogue type` | cpus `1`, memory `1.GB`, time `1.h`, debug `true`, container `""` |
| **`packages/engine/test/edit/update-declaration.test.ts`** | |
| `F-303 step 2 UX-44 AR-21: adding an input, renaming an output and adding cpus is one updateDeclaration whose result equals f303-configure-typed` | patches for both files; no new diagnostics |
| `F-303 AR-22 LA-45: an unchanged form changes nothing; untouched rows keep their text and comments` | |
| `F-303 AR-24 UX-44: a value that doesn't parse is refused with a field problem on that row and no patch` | `fields[0].field = {section: "outputs", row: 0, part: "value"}` |
| `F-303 UX-41: editing the description keeps the doc tags; an empty description with no tags removes the comment` | |
| `F-303 UX-41: renaming an input renames its uses in the rows the user didn't edit` | |
| `F-303 AR-23: updateDeclaration's inverse restores the exact bytes of every file it touched` | |
| `F-303 LA-13: a legacy process or an Unparsed declaration is refused with a message` | |
| **`packages/engine/test/edit/call-sites.test.ts`** | |
| `F-303 ADR-0039 LA-33: new inputs append null, removed ones drop their argument, a reorder permutes arguments, at every call including aliased includes` | |
| `F-303: a call fed by a pipe refuses an input change` | |
| **`packages/engine/test/edit/oracle-goldens.test.ts`** (extend) | `F-303 step 2: f303-configure-start + updateDeclaration equals f303-configure-typed`; `F-303 UX-41: … equals f303-configure-all`; `f303-directive-defaults` |
| **`properties.test.ts`, `test/corpus/edit.corpus.ts`** (via the harness) | `updateDeclaration` accepted at least once; results parse; untouched declarations equivalent |
| **`packages/engine/test/history/labels.test.ts`** | `F-303 AR-23: updateDeclaration is labelled "Edit process <name>"` |
| **`packages/engine/test/service/service.test.ts`** | `F-303 AR-23 ADR-0051: updateDeclaration then renameDeclaration under one group is one undo step restoring every byte and the sidecar`; `F-303: declarationForm refuses a stale or unknown node and its result survives structuredClone` |
| **`apps/web/test/node-keys.test.ts`** | `F-303 UX-40 UX-70: Enter on the selected node opens it; Enter on another node, Space, or Enter in a text field don't` |
| **`apps/web/test/popup-store.test.ts`** (fake engine) | `F-303 UX-44 F-209: Apply sends one command, or a group of update then rename with one label`; `F-303 UX-44: a refused rename is undone with discard and the popup stays open with the message`; `F-303 UX-44: no change closes without applying`; `F-303 UX-44: a moved revision refuses as stale`; `F-303 F-703: openPopup in read-only does nothing and narrowing closes an open popup` |
| **`apps/web/test/configure-form.test.tsx`** | `F-303 step 4 UX-42: the form has no kind control` (no `select`, `radio` or field named kind; the legends are exactly UX-41's sections); `F-303 UX-44: field problems mark their inputs aria-invalid and focus the first` |
| **`apps/web/test/directive-picker.test.tsx`** | `F-303 UX-41 UX-70: typing filters by name and summary, arrows and Enter add, "No directives match." when empty` |
| **`apps/web/test/details-pane.test.tsx`** (update) | `F-303 UX-32: Edit is enabled for a typed process and disabled with its reason otherwise; Code stays disabled` |
| **`e2e/popup.spec.ts`** (Chromium) | |
| `F-303 step 1 UX-40: double-clicking a process opens the popup on Configure` | dialog "Edit process GREET"; tab Configure `aria-selected`; Code `aria-disabled`; Esc closes and returns focus |
| `F-303 UX-40 UX-70 F-206: Enter on the selected node opens the popup; Enter on an unselected node only selects it; the Edit button opens it` | |
| `F-303 step 2 UX-41 UX-44 AR-23: add an input, rename an output, add cpus from the list, Apply: one undo step, code and ports updated` | from `f303-configure-start`; `historyStatus` gains one step "Edit process GREET"; stored files minus `.nf-builder/` equal `f303-configure-typed` byte for byte; node ports `name`, `punctuation`, `message`; one Ctrl+Z restores the start bytes |
| `F-303 step 3 UX-41 LA-34: deprecated directives are not offered` | searching "storeDir" shows "No directives match."; the list's names equal the catalogue's non-deprecated names |
| `F-303 step 4 UX-42: there is no control for changing kind` | no combobox, listbox or radio group other than the directive picker; no text "kind" among labels |
| `F-303 F-207 step 3: renaming a process in the popup keeps its node's position` | sidecar entry moves to the new key with the same coordinates; the node is still selected |
| `F-303 UX-44: Cancel discards the draft and changes nothing` | revision and files unchanged |
| `F-303 F-703 UX-04: in read-only, double-click and Enter don't open the popup` | viewport 800 px |
| `F-303 QA-30: opening and applying log no CSP violation and no console error` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-303` after F-301 merges (merge `main` first). `pnpm check` before every commit. Settle section 6 first.

1. **Oracle cases.** Write `f303-configure-start`, `f303-configure-typed`, `f303-directive-defaults` by hand and add their `cases.yaml` entries. Done when `pnpm oracle` (local, Java 17+) or a draft PR's `oracle` job passes them.
2. **Form types and reading.** `declaration-form.ts`; `popup-target.ts`, `read-process.ts`, `form-diff.ts`; their tests. Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
3. **`UpdateDeclaration` without call sites.** Command type and kind, `write-rows.ts`, `update-declaration.ts`, label, harness case, field-problem refusals; tests. Done when `pnpm --filter @nf-builder/engine test`, `pnpm test:corpus` (after `pnpm corpus:fetch && pnpm corpus:lint`) and `pnpm check` pass.
4. **Call sites and input renames.** `call-sites.ts`, step 5 and 7 of 2.3; goldens for `f303-configure-typed`, then write `f303-configure-all` and its case from the golden. Done when engine tests, `pnpm oracle` (or CI `oracle`) and `pnpm check` pass.
5. **Service and bridge.** `declarationForm`, refusal `fields`, engine client, workspace, `e2e/engine.ts`; service group test. Done when `pnpm --filter @nf-builder/engine test`, `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
6. **Store.** `applyGroup` (refactor `addFromPalette` onto it), `editDeclaration`, `popup-store.ts`; tests. Done when `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep F-301` pass.
7. **Popup UI.** `edit-popup.tsx`, `configure-form.tsx`, `row-list.tsx`, `directive-picker.tsx`, CSS; `node-keys.ts`, canvas and details wiring, app shell; unit tests and the F-206 test updates. Done when `pnpm check` and `pnpm test:e2e -- --grep "F-206|F-207|F-209|F-703"` pass; any moved baseline is reported, not regenerated.
8. **End-to-end.** `e2e/popup.ts`, `popup.spec.ts`, `openStoredFixture` dir argument. Done when `pnpm test:e2e -- --grep F-303`, `pnpm smoke` (under 60 s) and `pnpm build && pnpm check:budget && pnpm check:hosts` pass.
9. **Records** (section 7). Done when `pnpm check` passes.

## 6. Open points (none decided here)

1. **`UpdateDeclaration` and the form types** extend ADR 0039 and lang-core's command set (decide and record). The refusal's new `fields` is an in-memory API change, not a stored format. **Recommend:** accept, with `DeclarationForm` as a union F-305 and F-306 extend; `SetDirective` stays unbuilt (the popup doesn't need it).
2. **Enter and React Flow** (F-206 note). **Recommend:** Enter opens only when the focused node is already selected (UX-40's literal reading); the first Enter selects. Keeps F-206's test. **Alternative:** Enter always selects and opens (one key press, breaks F-206's test flow).
3. **Call sites after an input change.** Spec silent for processes (UX-51 covers takes). Without it, adding an input leaves every call failing lint (1.4). **Recommend:** permute, drop and append `null` at every call (ADR 0039 placeholder, lint clean, F-112's LA-33 reports it), refuse pipes. **Alternative:** leave calls alone and let lint errors show.
4. **Renaming an input or output inside the process.** **Recommend:** rename an input's `Variable` uses in rows the user didn't edit; for outputs, rename property reads `<var>.<old>` that the projection resolves to that output, only when the process has two or more outputs (a sole output is read without its name, 1.4). **Alternative:** rename nothing; F-112 reports what breaks.
5. **Renaming moves the module?** LA-12 wants `modules/local/<lower name>/`, F-301 names new processes `NEW_PROCESS` to be renamed here, and ADR 0039 says "files don't move". **Recommend:** when the file is `modules/local/<lower old>/main.nf` and declares only this process, move it in the same group (a new `MoveFile` command rewriting include sources and open tabs; supersedes that line of ADR 0039). **Alternative:** keep ADR 0039 and add a feature for moving files.
6. **Script and stub editors.** **Recommend:** monospace `<textarea>`s in Configure (no Monaco, AR-32, QA-01); F-304 brings Monaco to the Code tab. **Alternative:** a small Monaco per field.
7. **Description format.** F-311 owns nf-docs tags. **Recommend:** edit the text before the first tag only, keep the tags verbatim, write new comments as `/**\n * text\n */` (template style). Note for F-311: input renames here leave `@param` tags stale until it lands.
8. **Directive defaults and kinds** (Nextflow syntax): **Recommend:** integer `1`, boolean `true`, memory `1.GB`, duration `1.h`, others required; oracle case `f303-directive-defaults`. Reuse F-601's kind table and hints (open point 14).
9. **Type suggestions.** The catalogue's `types` has no `Boolean` or `Record`, and the input types the docs allow are "all standard types except Channel and Value". **Recommend:** a free-text type field with suggestions from the catalogue's `shim.*` names (prefix dropped), `Duration`, `MemoryUnit`, and the project's records and enums in scope; record the catalogue gap in `docs/research/upstream-bugs.md` only if the language server really omits them (researcher to check).
10. **Registry modules** (typed, under `modules/nf-core/`). **Recommend:** allowed, with a note in the popup: "This is a registry module. Editing it here means an update will overwrite your changes." **Alternative:** read-only.
11. **Narrowing while the popup is open.** **Recommend:** close and discard, as project dialogs close (ADR 0056). **Alternative:** keep the draft and reopen on widening.
12. **Code tab placeholder.** **Recommend:** show the tab `aria-disabled` with a title, as UX-32's disabled buttons did (ADR 0049).
13. **Visual baselines.** Enabling Edit changes `details-process-trim`. **Recommend:** re-approve from CI (ADR 0021) and say so in the PR; no other baseline should move.
14. **Order with F-601.** F-303 wants F-601's value-kind table and `parseValueText` hints. **Recommend:** if F-601 merges first, reuse them through the worker; otherwise F-303 adds a minimal `directiveKind(types)` in the engine and F-601 folds it into `valueKindOf` (note on F-601).
15. **Stale form.** **Recommend:** refuse Apply when the revision moved since the form was read (2.4); the modal blocks most changes, but autosave of another tab's Code view can still land.

**AGENTS.md decide-and-record items:**
- **Spec or ADR changes:** points 1 (ADR 0039 command set, AR-21 unchanged), 2 (UX-40 reading), 3 and 4 (edit semantics), 5 (supersedes "files don't move"), 7, 11.
- **Package boundaries / dependency-cruiser:** none (the page gets kinds from the worker).
- **Stored or exported formats:** none (point 5's move changes files, not formats).
- **New runtime dependency:** none. **Workflows:** none. **`features.json`:** notes only, unless point 5's alternative adds a feature (`scope-change`).
- **Open questions in `docs/plan/open-questions.md`:** none found that F-303 depends on.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number: "Edit typed processes in a popup form through UpdateDeclaration". Covers 2.1 to 2.4 and the points settled; amends ADR 0039 (command, call-site rules, file move if chosen) and ADR 0049 (Edit enabled). Row in `docs/adr/README.md`.
- **Spec:** UX-40 "Enter on the selected node"; UX-41 "parts the form can't model are kept and shown as code"; UX-44 "Apply is one command, or update then rename as one group".
- **`features.json` notes:** F-303 verified-by note; F-304: share `popupStore`'s draft, enable the Code tab, `registerFlush`; F-305/F-306: extend `DeclarationForm` and `popupTarget`; F-307: `popupTarget` returns `workflow` for double-click; F-311: description field and tag upkeep, stale `@param` after input renames; F-601: directive kinds if point 14's fallback is used.
- **`progress.md` Decisions:** the ADR, the Enter rule, call-site rules, defaults, baseline re-approval.

## 8. Evidence

- `process-typed.mdx` at v26.10.7 and the probe trees: `/tmp/claude-0/-home-user-nf-builder/7eb86299-0303-577c-b405-f447f3050ce3/scratchpad/f303/` (`start`, `end`, `a`, `b`, `c`), run with `.cache/nextflow/26.10.7/nextflow-26.10.7-dist`.
