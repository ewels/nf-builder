# Plan: F-601, the `nextflow.config` editor

The editor gives forms for first-class scopes, generic typed forms for other scopes, Add scope, option docs in the right pane, selectors showing the processes they match, and unknown options kept and flagged.

Planner output, 2026-11-23. I changed nothing in the repository.

**Sources I read:**
- `origin/main`: first at `893c900`, then at `d195424` after F-209 merged as PR #50 during this session. I read it through scratch worktrees, which I have since removed.
- The `feat/F-209` branch, before it merged: `/home/user/wt-F-209`, now removed.
- `docs/plan/handoff/plan-F-309.md`. F-309 is now being built in `/home/user/wt-F-309`, with no commits yet.
- Nextflow v26.10.7:
  - the nf-lang sources, from a local checkout of tag `v26.10.7`;
  - `ConfigValidator.groovy`, `ConfigSelectorResolver.groovy`, `Session.groovy` and `ScriptMeta.groovy`, fetched at the tag;
  - the v26.10.7 docs, checked against the anchors on the live docs.seqera.io;
  - runs of the pinned 26.10.7 release (section 8).

**What the feature cites:**
- **Requirements:** FI-01 to FI-06.
- **Dependencies:** F-103 and F-208.
- **Notes:**
  - From F-103: the config AST is syntactic.
  - From F-105: config includes come from `FileModel.includes`.
  - From F-203: `manifest.name` is set here.
- **ADRs read in full:** 0005, 0027, 0032, 0034, 0039, 0051.
- **ADRs read through the F-309 plan and the hand-off README:** 0042, 0043, 0048, 0049.
- **Config-specific ADRs:** none exist. Configs appear only in 0027 (shared AST conventions) and 0034 (config include resolution).

## 0. Scope

**In scope:**
- **Config tabs:** a config file opens in its own tab with Form, Split and Code modes. Split puts the form beside the F-208 Monaco code pane. Every form change is an edit command, so undo (F-209) and autosave (F-202) behave as everywhere else.
- **The form (FI-01, FI-02):**
  - one collapsible card per top-level scope, in source order;
  - first-class forms for `manifest`, `params`, `process` (defaults, `resourceLimits`, `withLabel` and `withName` selectors), `profiles`, `plugins`, `docker`, `singularity`, `apptainer`, `conda`, `wave` and `executor`;
  - a generic form typed from the catalogue for every other scope;
  - Add scope… (FI-03) and Add option….
- **Edit commands:** five new config commands, with statement-level edits that keep every untouched byte (ADR 0032).
- **Config printer:** a port of nf-lang's `ConfigFormattingVisitor`. New statements print as `nextflow lint -format` would, checked against the corpus.
- **Unknown scopes and options (FI-03):** kept, shown read-only, and flagged by a new warning, `config-unknown-option`. It mirrors Nextflow 26.10.7's run-time `ConfigValidator`, which `nextflow lint` doesn't run.
- **Option docs (FI-04):** the right pane shows the selected option's full name, types, description and a verified docs link.
- **Includes (FI-05):** `includeConfig` rows link to the included file, which opens in its own config tab.
- **Selector counts (FI-06):** "used by N processes", from a process-use index over the call graph, matched exactly as Nextflow's `ConfigSelectorResolver` does.
- **Things the forms can't model:** dynamic expressions, invalid statements (`if`, `try`, `def`), incomplete assignments, `Unparsed` items, unknown selector kinds and external includes are shown read-only as code, with "Edit in code".
- **Fixtures and tests:** oracle cases (lint and `run -stub`), corpus tests, and the end-to-end tests for both steps.

**Out of scope:**

| What | Owner |
|---|---|
| Plugin specs as a source of scopes (FI-01's "and plugin specs"), and "Add plugin from registry" | F-505, whose description says "plugin scopes join the config editor catalogue" |
| Keeping config `params` and the script params block in step, and the mockup's "Linked files" box | F-602 |
| Setting `manifest.diagram` | F-607 (FI-53), which uses `setConfigOption` |
| The Files tree as a way to open files | F-210, which reuses `openFile` |
| The problems panel listing the new warnings | F-309. The warnings are ordinary diagnostics, so the panel picks them up. |
| Read-only form below 1024 px | F-703 |
| Keyboard audit and a shortcut for Add scope | F-701 |
| A "no process matches this selector" diagnostic | Open point 11 |
| Removing whole scope, selector or profile blocks from the form | Code view; open point 5 |
| A separate Monaco grammar for config files | Open point 17 |

## 1. Findings

### 1.1 Spec, mockup and ADRs
- **`files.md`:**
  - The intro says "Editors that offer a form also offer the raw text (Form, Split or Code), and both go through edit commands, so undo and autosave behave the same everywhere."
  - FI-01 to FI-06 are as cited.
  - FI-03 says unknown items are "kept and flagged as warnings, never removed".
- **Mockup `docs/mockup/5-config.png`:**
  - `nextflow.config` is a file tab beside `main.nf`, with a Form, Split and Code toggle.
  - Cards for manifest (name, version, description, nextflowVersion), plugins (an `nf-schema` row and "Add plugin from registry"), process and profiles (collapsed, "docker · test").
  - The process card has text fields showing `6.GB` and `4.h`, a `resourceLimits` summary row ("cpus: 16 · memory: 128.GB · time: 48.h"), and a "SELECTOR withLabel: process_high · used by 1 process" row.
  - "Add scope (executor, docker, wave …)" sits at the bottom.
  - The right column reads "Config option": `process.resourceLimits`, a `Map` type badge, a version badge, the description and "Open in Nextflow docs".
  - The code is marked "illustrative and unchecked".
- **AR-21:** the minimum command set has no config commands, so it needs amending (section 7).
- **AR-22 to AR-24:** commands leave untouched declarations equivalent, are one undo step each, and are refused if they add a parse problem.
- **AR-30:** the UI holds a read-only copy, with no file text. ADR 0049 reads this as "excerpts, never a whole file".
- **AR-31 and AGENTS.md:** logic belongs in `packages/engine`.
- **ADR 0039:**
  - Commands are plain data, resolved at apply time.
  - Reprinting works at declaration level for workflow commands; renames edit identifiers in place; inserts go at item boundaries.
  - A statement-level printer was rejected for scripts as "needs insertion and indent rules for each section". Config files are flat statement lists, so the trade-off differs (open point 3).
- **ADR 0032:**
  - Printed output equals `lint -format` apart from known differences.
  - What gets formatted is new and edited declarations; untouched ones are printed from source.
  - New nodes carry `NO_RANGE` and get the fresh layout.
- **ADR 0034:** a constant `includeConfig` resolves against the including file. Expressions and URLs are external and unchecked.
- **ADR 0051 (F-209):**
  - `apply(command, revision, {group, label})`; one step per command, and a no-op command adds no step.
  - `commandLabel` in `packages/engine/src/history/labels.ts` is an exhaustive switch, so new kinds need labels.
  - The shortcuts don't fire in text fields, the code editor or dialogs.
  - The store flushes code-pane text before an undo, through `registerFlush`.
- **F-309 plan, as settled:**
  - code-only file tabs: `WorkflowTab.kind: "workflow" | "file"`, `fileTabFor`, `openFile(path)`;
  - `revealCode(path, range)`, with Split forced on a Graph tab;
  - status-bar node and channel counts hidden on file tabs;
  - "F-601 reuses `openFile`", and "Config files open in Monaco until F-601".

### 1.2 Code as it stands (`origin/main` `d195424`)

**Config AST** (lang-core `ast/config.ts`, F-103):
- **Node kinds:**
  - `ConfigAssign {path: ConfigName[], value: Expression}`;
  - `ConfigBlock {name, statements}`;
  - `ConfigSelector {selector, target, statements}`, with the kind as written;
  - `ConfigApplyBlock` / `ConfigApply` (`plugins { id '…' }`);
  - `ConfigInclude {source: Expression}`;
  - `ConfigIncomplete`;
  - `ConfigInvalid` (`if`, `try` or `def`, kept);
  - `Unparsed` at the top level.
- **Names:** `ConfigName.form` is `identifier`, `string` or `builtInType`, and `name` is decoded.
- **Ranges and comments:** every node has an exact range and the comment slots. `StringLiteral` keeps `text` verbatim and `value` decoded.

**Catalogue** (`packages/lang-2610/catalogue/config.json`, typed `ConfigCatalogue`):
- **Top level, 42 nodes:**
  - 36 scopes;
  - `plugins` as a `dsl` node;
  - 5 unscoped options: `bucketDir`, `cleanup`, `outputDir`, `resume`, `workDir`.
- **Whole tree:** 71 scopes, 495 options and 2 placeholders (`azure.batch.pools.<name>`, `azure.storage.fileShares.<name>`).
- **Children:** `params`, `env` and `profiles` have none.
- **Option types, by count:** String 218, Boolean 118, Duration 47, Integer 45, `List<String>` 18, Map 15, Object 14, MemoryUnit 12, Float 12, List 7, boolean 5, a few others. Some options have several types, such as `process.cache :: Boolean | String`.
- **Descriptions:** Markdown, with inline code in 440 and links in 104.
- **"Read more" links:**
  - Only 66 nodes carry one.
  - Process options link to `reference/process#memory` and similar. On the live site that page is an index with no per-directive anchors, so those links are stale (1.5).

**Printer** (lang-2610 `src/printer/`):
- Scripts only: `printScript`, `printDeclaration`, `createLayout`.
- There is no config printing. `SourceParser` carries `printer: ScriptPrinter`.
- `Formatter.expression()` prints any expression. String literals print their verbatim `text`.

**Edit commands** (engine `src/edit/`):
- Seven kinds, none for config.
- `applyCommand` runs `checkResult`, which also refuses a new parse problem in config files.
- Helpers:
  - `stringLiteral(value)` gives a single-quoted string with escapes;
  - `itemSpan`, the `reprintDeclaration` lost-comment check, `withEndings` (CRLF) and `diffText`.
- `EditState.catalogue` is the script catalogue only.

**Diagnostics:**
- Lint rules get `LintContext.file` (script or config) and `catalogue` (both parts).
- Config rule today: `config-include-placement`.
- F-112's fixture test requires every code to have `fixtures/<code>/{positive,negative}/` and an entry in `test/lints/fixtures.json`, recorded by lint and checked by the oracle.
- F-112's corpus test compares only lint-origin codes.

**Service:**
- `Open` holds `catalogue: Catalogue`, a projector and a diagnoser, all dropped in `changed()`.
- `details` (F-206) shows the pattern for adding a read-only call.
- `FileModel.includes` has `kind: "config"` entries with an `IncludeTarget` (`file`, `missing` or `external`).

**Web:**
- `canvas-store.ts`: `WorkflowTab {id, path, workflow, label, mode}` and `ViewMode = "graph" | "split" | "code"`.
- `apply(command, session?, options?)` runs in a serial queue, and `registerFlush` is awaited only by undo and redo.
- `TabPanel` has `PanelLayout` with a canvas slot and a code slot.
- `CodePane` takes any path; every Monaco model uses the Nextflow language id.
- The left column's Files tab reads "No project open" (F-210).
- `DetailsPane` renders only workflow content.

**Visual baselines that could change:**
- `details-entry-summary` uses `f206-details`, which has no `nextflow.config`.
- The canvas and view-modes baselines target `.column-centre`.

### 1.3 Nextflow 26.10.7 behaviour (pinned release, oracle environment; section 8)

| Check | Result |
|---|---|
| `lint` on `process { memmory = '4 GB' }`, an unknown `mystery { level = 3 }`, an empty `docker {}` | 0 errors, 0 warnings. Lint doesn't validate option names. |
| `run -stub` on the same tree | `WARN: Unrecognized config option 'process.memmory'` and `WARN: Unrecognized config option 'mystery.level'`; nothing for the empty block |
| Where the run-time check comes from | `ConfigValidator.groovy` L107–L168 |
| What `ConfigValidator` skips | profiles' contents are checked as top level (L114); `withLabel:`/`withName:` and `executor.$name` are dropped (L137–L145); keys under Map-typed options (L206–L231); `params` (L161); `env` (NXF_ check only, L157, L238); core plugin scopes `aws`, `azure`, `cloudcache`, `google`, `k8s`, `tower`, `wave` when that plugin isn't loaded (L58–L66, L192); `HIDDEN_OPTIONS` (L42–L52) |
| Selector matching | `ConfigSelectorResolver.groovy` L89–L116. The pattern is trimmed, `!` negates, and it must match the whole name (Java `matches()`). `withLabel` matches if any label matches. `withName` is tried against the distinct names in order: declared name, alias, fully qualified name. |
| `f601-selectors` run (11 selectors, aliases, a named workflow) | `GREET [notLabel:1, simple:1, dotstar:1, notTwice:1, fq:1]`, `SHOUT [either:1, label:1, notTwice:1]`, `TWICE [declared:1, notLabel:1, either:1, alias:1]`, `TWICE [declared:1, notLabel:1]`, plus `WARN: There's no process matching config selector: .*:SHOUT -- Did you mean: SHOUT?` and `… NOPE`. A process called from the entry workflow has no prefix (`Session.groovy` L1157–L1199; docs `config.mdx` L185–L286). |
| Value forms the forms would write | `8.GB`, `512.MB`, `1.TB`, `2.h`, `30.min`, `5.s`, `500.ms`, `1.d`, `'it\'s $HOME'`, `['conda-forge', 'bioconda']`, `[cpus: 4, memory: 8.GB, time: 2.h]`, `withName: 'GREET\|SHOUT'`, `withLabel: big_mem`, `'gpu-test' { process.memory = 4.GB }`, `build.repository = '…'` inside `wave {}`, `env { GREETING_STYLE = 'loud' }` |
| Status of those forms | All lint clean. All are a fixed point of `lint -format`. All run, and `nextflow config -flat` shows the resolved values. |
| Docs basis for the value forms | `MemoryUnit` and `Duration` are made "by adding a unit suffix to an integer" (`stdlib-types/memory-unit.mdx` L10, `duration.mdx` L10–L34) |
| `process.withName: X {…}` (dotted selector) | Parse error "Unexpected input: ':'". Selectors are always blocks. |
| Empty blocks | `withLabel: big_mem {}` and `test {}` print as `name {` / `}`. They are lint clean and silent at run time. |
| `plugins { id 'nf-schema@2.5.1' }` | Lint clean offline. A run would download the plugin, so that case is lint-only. |

### 1.4 Corpus measurements
Five pins, 228 config files. Probes ran with the packages of `/home/user/wt-main` and `/home/user/wt-F-209` and the corpus in `/home/user/.nfcache/corpus`.
- **Assignments:**
  - 2,471 in all, 1,022 of them dotted;
  - 1,827 in first-class scopes other than `params`, of which 904 (49%) are literals;
  - the non-literal values are 659 closures, 226 maps, 28 lists and a few others;
  - 456 `params` assignments, 437 of them literals.
- **Selectors:**
  - 1,057, all under `process`: 1,027 `withName` and 30 `withLabel`;
  - 227 `withName` patterns contain `:`, so fully qualified names are needed: 93 are full paths and 134 are `.*:NAME`.
  - None is invalid as a JavaScript regex.
- **Other statements:** 125 `includeConfig` (8 dynamic), 86 profiles, 3 `plugins` blocks.
- **The run-time validator rules on the catalogue** flag exactly 8 options, all from plugin scopes:
  - `validation.defaultIgnoreParams` ×3 and `validation.monochromeLogs` ×3 (nf-schema);
  - `prov.enabled` and `prov.formats.bco.file` (nf-prov).
- **Prototype process-use index and matcher:**
  - On `f601-selectors` it reproduces Nextflow's matches exactly.
  - sarek: 332 process uses in 22 ms; 373 selectors matched in 68 ms with naive per-pair regex compiles; 10 zero matches, all names absent from the code or nf-test configs.
  - rnaseq: 179 uses; 666 selectors; 28 zero matches, mostly nf-test configs for subworkflows.
- **Formatting:** `.cache/corpus-lint/<pin>.format/` holds Nextflow's formatted output for all 228 configs, and 189 of them differ from the source. A config printer can therefore get corpus parity with no new tooling.
- **Engine today:** every draft fixture tree parses as `modelled` with zero diagnostics, which agrees with lint.

### 1.5 Docs links (verified on docs.seqera.io; the pages are in the v26.10.7 docs tree)
- **Scope pages:** `reference/config/<kebab(scope)>`, 33 pages: `apple-container`, `apptainer`, `aws`, `azure`, `charliecloud`, `conda`, `dag`, `docker`, `env`, `executor`, `fusion`, `google`, `k8s`, `lineage`, `mail`, `manifest`, `nextflow`, `notification`, `podman`, `registry`, `report`, `sarus`, `seqera`, `shifter`, `singularity`, `smolvm`, `spack`, `timeline`, `tower`, `trace`, `unscoped`, `wave`, `workflow`.
- **Option anchors:** the lowercased dotted path without dots. Seen on the live pages: `docker#dockerenabled`, `executor#executorretrydelay`, `wave#wavebuildcacherepository`, `manifest#manifestname`, `unscoped#cleanup`.
- **Process options:** `reference/process/directives/<kebab(option)>`, 41 pages covering every catalogue process option except `when`. `memory`, `resource-limits` and `error-strategy` were checked live.
- **Special pages:** `config#process-configuration`, `config#process-selectors`, `config#parameters`, `config#config-profiles`, `plugins`.
- **`agent`:** has no page.

## 2. Design

### 2.1 Tabs, modes and entry points
- **Tab kind:** `WorkflowTab.kind` gains `"config"` next to F-309's `"workflow" | "file"`.
- **`configTabFor(path)`:**
  - id `config:<path>`;
  - `workflow: null`;
  - `mode: "graph"`, which a config tab shows as Form;
  - label as F-309's file tabs: the file name, or the last two segments for a `main.nf`;
  - `title` is the full path.
- **`openFile(path)`** (F-309's) dispatches on `languageOf(path)`: `config` gives a config tab, anything else a code-only file tab. F-210's tree, F-309's problem navigation and FI-05's include links therefore all open the form. `load()` and `changed()` never project a config tab.
- **Modes (UX-27):**
  - The `ViewMode` values are reused. On a config tab the toggle reads Form, Split and Code, and G selects Form (open point 14).
  - `PanelLayout`'s canvas slot renders `<ConfigPane path>`, a lazy chunk, and the code slot renders F-208's `CodePane`.
  - Form mode loads no Monaco (AR-32).
- **Entry point:**
  - `openFile` serves every route.
  - F-601 adds one user-facing route of its own: in the entry workflow's summary (UX-31), a "Configuration" section links the root `nextflow.config` when the project has one (open point 2).
  - An e2e hook, `window.nfBuilderWorkspace.openFile`.
- **Status bar:** node and channel counts are hidden on a config tab, as on F-309's file tabs.

### 2.2 The view: worker to page (AR-30)
- **Engine API:**
  - `EngineApi.configView(path)` gives `{revision, view: ConfigView | null}`, or a `not-found` refusal for a path that isn't a config file.
  - `EngineApi.configSchema(version)` gives a `ConfigSchema` and needs no project.
  - Both are pure engine functions behind the service, with the process-use index memoised per revision like the projector.
- **`ConfigView.items`** is the top-level statements grouped in order of first appearance:
  - scope cards, one per scope name, gathering block and dotted forms;
  - include rows;
  - code rows.
- **Cards:**
  - Each card holds option rows. With several occurrences of an option, the last one wins, as in Nextflow, and the row says how many there are.
  - A process card also holds selector cards. A profiles card holds profile cards, each recursively holding its own items. A plugins card holds plugin rows.
  - Top-level options (`cleanup`, `workDir` and so on) share one "Unscoped options" card.
- **Each option row carries:**
  - its full option path, as `ConfigValidator` names it (selectors dropped);
  - a classification (`option`, `free`, `hidden`, `unchecked` or `unknown`) and the catalogue types;
  - a value kind;
  - either a decoded `ConfigValue` or a code excerpt;
  - the statement's range and name range;
  - the diagnostics inside its range.
- **What the form can't model** is never dropped and never written by a form:

| Construct | Shown as |
|---|---|
| A non-literal value: closure, GString with interpolation, reference, ternary, method call, or a map or list holding one; also a literal that doesn't fit the option's kind, or a value with comments inside | Read-only code excerpt with Edit in code, plus "Set a value" (open point 8) |
| `ConfigInvalid` (`if`, `try`, `def`), `ConfigIncomplete`, top-level `Unparsed` | Code row with its problem |
| Unknown selector kind (`withFoo: x`), selectors outside `process` | Selector card with read-only rows |
| Unknown scope or option | Card or row flagged "Unknown", its value as code, with an explicit Remove |
| Dynamic or URL `includeConfig` | Row "External source, not checked", with no link |
| Comments | Never shown; never touched by a command, except those attached to a statement the user removes |

- **Excerpts** are capped at 160 characters on one line, so the view never carries a file (AR-30). A test checks the cap over the whole corpus.
- **Read-only when broken:** when the file has any parse problem (`status` isn't `modelled`, or `problems` isn't empty), `view.editable` is false. The form is then read-only behind a banner: "This file has errors. Fix them in Code; the form is read-only until then." (open point 9).

### 2.3 First-class and generic forms (FI-02)
- **Layout data:** the per-scope layout lives in the pack (`ConfigRules.forms`), with a test that it names only catalogue options:

| Scope | Form | Fields always shown, in order |
|---|---|---|
| `manifest` | options | name, description, version, nextflowVersion, homePage, license, defaultBranch |
| `params` | params | none (free names) |
| `process` | process | cpus, memory, time, container, executor, queue, errorStrategy, maxRetries, then resourceLimits as a fixed-key map |
| `profiles` | profiles | none |
| `plugins` | plugins | none |
| `docker` | options | enabled, runOptions, registry |
| `singularity`, `apptainer` | options | enabled, autoMounts, cacheDir, runOptions |
| `conda` | options | enabled, channels, useMamba, cacheDir |
| `wave` | options | enabled, strategy, freeze |
| `executor` | options | name, queueSize, cpus, memory, pollInterval, submitRateLimit |

  `maps: {"process.resourceLimits": {cpus: "integer", memory: "memory", disk: "memory", time: "duration"}}`.
- **The `process` form:**
  - Defaults section (the pinned fields).
  - Resource limits section, a fixed-key map edited as one value.
  - Selectors section: one card per selector, showing the selector as written, "used by N processes" (2.8) and its own pinned fields plus Add option. "Add selector…" asks for the kind (`withName` or `withLabel`) and a pattern.
- **The `profiles` form:** one card per profile, each a full nested editor for that context, with Add profile… and Add scope inside it.
- **`params` and `env`, and keys under Map options (`process.ext.*`):** free-name rows. The kind is inferred from the literal: string, integer, decimal or boolean. "Add parameter…" asks for a name, a kind and a value.
- **The `plugins` form:**
  - Rows of `id` values, split into name and version, each with Remove.
  - Add plugin… takes free text `name[@version]`, validated by `^[A-Za-z0-9._-]+(@[A-Za-z0-9._+-]+)?$`. F-505 replaces it with the registry picker.
- **Generic scopes:**
  - The rows set in the file, plus Add option….
  - Add option… lists the scope's catalogue options not yet set, nested scopes flattened as dotted names, each with its description's first sentence.
  - A picked option becomes a pending row, which is UI state only, until a value is committed.
  - Placeholder scopes (`azure.batch.pools.<name>`) are shown, but options under them can't be added from the form in v0.1.
- **Add scope… (FI-03):**
  - A native `<dialog>` listing every top-level catalogue scope and `plugins` (37 entries) with the first paragraph of each description.
  - A filter box searches name and description; scopes already in this context are marked "In use".
  - A separate group lists the 5 unscoped options.
  - Choosing a scope runs `addConfigBlock`, which writes an empty block (open point 5). Choosing an unscoped option adds a pending row.

### 2.4 Value kinds (catalogue type, widget, literal written)
- **Type to kind** (`ConfigRules.valueKind`): when an option has several types, the first type with a kind wins (`wave.strategy :: List<String> | String` gives `stringList`).

| Catalogue type | Kind | Widget | Written as |
|---|---|---|---|
| String | `string` | Text field | Single-quoted, with `\\`, `\'` and `\n` escaped (`stringLiteral`) |
| Boolean, boolean | `boolean` | Select: Not set, true, false | `true` / `false` |
| Integer | `integer` | Text field: optional minus sign and digits, a safe integer | Number literal, with unary minus when negative |
| Float, Double, float | `decimal` | Text field matching `-?\d+(\.\d+)?` | Number literal as typed |
| MemoryUnit | `memory` | Text field accepting `8.GB`, `8 GB` or `8GB` (B, KB, MB, GB, TB, PB, EB, ZB) | `8.GB`. Whole numbers only, as the docs require. |
| Duration | `duration` | Text field accepting `2.h`, `2h`, `2 h` (`ms`, `s`, `m`, `min`, `h`, `d`) | `2.h`, with `m` written `min` |
| `List<String>`, `String[]`, `Set<String>` | `stringList` | One-per-line text area | `['a', 'b']` |
| `process.resourceLimits` (layout) | `map` | Four labelled fields | `[cpus: 4, memory: 8.GB, time: 2.h]` |
| Anything else (Map, Object, List, Closure, …) | `code` | Read-only | n/a |

- **Reading values:**
  - `readValue` reads literals of the row's kind.
  - Memory and duration also read `N.UNIT` property expressions and plain strings (`'10GB'`, `'2h'`). A string is kept as written until the user edits it, and then rewritten in suffix form (open point 7).
- **Committing:**
  - A field commits on Enter or blur when it is valid and changed. Escape reverts.
  - Clearing a pinned field, or choosing Not set, removes the option.
  - Invalid input shows an inline message ("Use a whole number and a unit, for example 8.GB") and sends nothing.
  - `parseValueText` and `valueText` are pure functions in the engine, used by the page.

### 2.5 Edit commands (lang-core `edit.ts`; engine `edit/commands/config.ts`)
- **Addressing:** options and blocks are addressed by name, not by range, and resolved at apply time (ADR 0039).
- **Option paths:** `option` is the full option path as the validator names it, for example `["process", "memory"]`, also inside a selector. A selector context requires the path to start with `process`.

```ts
export interface ConfigSelectorRef { readonly kind: "withName" | "withLabel"; readonly pattern: string }
export interface ConfigContext { readonly profile: string | null; readonly selector: ConfigSelectorRef | null }
export type MemoryUnitName = "B" | "KB" | "MB" | "GB" | "TB" | "PB" | "EB" | "ZB";
export type DurationUnitName = "ms" | "s" | "min" | "h" | "d";
export type ConfigValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "decimal"; readonly text: string }
  | { readonly kind: "memory"; readonly amount: number; readonly unit: MemoryUnitName }
  | { readonly kind: "duration"; readonly amount: number; readonly unit: DurationUnitName }
  | { readonly kind: "stringList"; readonly values: readonly string[] }
  | { readonly kind: "map"; readonly entries: readonly { readonly key: string; readonly value: ConfigValue }[] };
export interface SetConfigOption { readonly kind: "setConfigOption"; readonly path: string; readonly context: ConfigContext; readonly option: readonly string[]; readonly value: ConfigValue }
export interface RemoveConfigOption { readonly kind: "removeConfigOption"; readonly path: string; readonly context: ConfigContext; readonly option: readonly string[] }
/** Ensures the blocks exist: `scope` within the context, or the profile or selector block itself when `scope` is empty. */
export interface AddConfigBlock { readonly kind: "addConfigBlock"; readonly path: string; readonly context: ConfigContext; readonly scope: readonly string[] }
export interface AddConfigPlugin { readonly kind: "addConfigPlugin"; readonly path: string; readonly id: string }
export interface RemoveConfigPlugin { readonly kind: "removeConfigPlugin"; readonly path: string; readonly id: string }
```

- **Refusals:**
  - `not-found`: the path isn't a config file, or there is nothing to remove.
  - `invalid`:
    - a name that isn't writable (params and env names must be identifiers);
    - a selector option outside `process`;
    - a duplicate plugin name;
    - a malformed plugin id;
    - a non-finite or unsafe number;
    - a value to replace that has comments inside;
    - a one-line block to reprint that holds an invalid statement.
  - `does-not-parse`: from the existing AR-24 guard.
- **No-ops:** setting the same text, or adding a block that exists, gives no patch, and so no undo step.
- **Labels** (`commandLabel`):
  - "Set process.memory", "Set process.memory for withLabel: big_mem", "Set docker.enabled in profile test";
  - "Remove …";
  - "Add docker", "Add profile test", "Add selector withLabel: big_mem";
  - "Add plugin nf-schema@2.5.1", "Remove plugin …".

### 2.6 Placement and printing: untouched bytes stay identical (ADR 0032; open points 3, 4, 6)
- **Patch shape:** every config command yields one `TextEdit` on one file. Nothing outside the edited statement, or outside the insertion point, changes.
- **Setting an option:**
  1. If the option already occurs in the context, in any form, replace the value range of the last occurrence with the printed new value.
  2. Otherwise, if a block for the whole scope path exists in the context (the last one wins), or the selector block does, insert `<rest> = <value>` as its last statement.
  3. Otherwise, if a block for a prefix exists, insert the rest of the path in dotted form, for example `build.repository = '…'` inside `wave {}`. A missing selector is created as a block inside the `process` block.
  4. Otherwise, if the context holds a dotted assignment under the same top-level scope, insert a dotted assignment after the last such statement.
  5. Otherwise:
     - at the top level, append a new block after the last top-level item, after one blank line;
     - in a profile, append a dotted assignment at the end of the profile (nf-core's style);
     - a missing profile is added to the last `profiles` block, or a new `profiles` block is appended;
     - selectors are always blocks.
- **Indentation and line endings:**
  - An inserted line copies the indentation of its previous sibling's line.
  - In an empty block it uses the block line's indentation plus the file's indent unit: four spaces by default, a tab or two spaces if the first indented line of the file uses them.
  - CRLF files stay CRLF (`withEndings`).
- **One-line blocks:** if the container is on one line, or its last statement shares a line with `}`, the whole container statement is reprinted with the config printer at its depth. That keeps every attached comment, or the command is refused.
- **Removing:**
  - Delete every occurrence in the context, each as whole lines: own-line leading comments, the statement, its trailing comment and the line break.
  - If another statement shares those lines, reprint the container without it.
  - Containers left empty stay.
- **Names:**
  - New names and patterns are written bare only when they match `[a-zA-Z_][a-zA-Z0-9_]*`, as the formatter's `IDENTIFIER` does, and aren't a config-lexer keyword or built-in type name, which the docs say need quotes (`config.mdx` L215–L217).
  - Otherwise they are single-quoted.
- **Config printer:** a line-by-line port of `ConfigFormattingVisitor` (nf-lang v26.10.7, 188 lines) on top of the existing `Formatter`, with default options only.
  - `printConfig(ast, {layout})` prints a whole file, for the corpus parity check.
  - `printConfigStatement(node, {layout, indent})` prints new statements and reprinted one-line blocks.
  - `ConfigApply` is printed through `Formatter.directive` with a `MethodCall`-shaped adapter.
  - Error-only nodes throw `PrintError`.
- **Position of new top-level blocks:** at the end of the file, even after `includeConfig`. Later statements win in Nextflow, so the value the user sets takes effect (open point 15).

### 2.7 Unknown scopes and options (FI-03; open point 10)
- **The rule:** a new pack lint rule, `config-unknown-option`: warning, origin `ours`, spec `FI-03`, upstream `ConfigValidator.groovy#L107-L231`.
  - It walks each config file, building full paths as the validator does: profile contents as top level, `withLabel:` and `withName:` dropped, `executor.$name` dropped.
  - It skips `params`, `env`, keys under Map-typed options, `HIDDEN_OPTIONS`, and core plugin scopes the catalogue doesn't describe (`cloudcache`).
  - Any other path that isn't a catalogue option or the `plugins` dsl is flagged.
  - An unknown selector kind is a path segment `withFoo:x`, as at run time.
- **Range and message:**
  - The range is the assignment's name path.
  - The message starts with Nextflow's run-time text: "Unrecognized config option 'process.memmory' -- check the name against the config reference, add the plugin that defines it, or remove it".
- **Shared logic:** the walk and the classifier (`classifyPath`) live in lang-2610 `src/config/validator.ts`, shared by the rule and by `ConfigRules.classify`, so the view and the warning can't disagree.
- **Display:** the form flags these rows "Unknown option" with the warning glyph, and an unknown scope's card header reads "Unknown scope". Nothing is removed unless the user presses Remove.
- **Plugin scopes:** the corpus's only flags are plugin scopes (1.4). They stay flagged until F-505 merges plugin specs into the classifier.

### 2.8 Selectors (FI-06; open point 11)
- **The process-use index:** `processUses(model)` walks from the entry workflow. That is `main.nf`'s unnamed workflow, otherwise the first entry workflow, by the canvas `defaultWorkflow` rule.
  - In each workflow's `main` and `emit` sections, a call is:
    - a `MethodCall` with no receiver; or
    - a `Variable` on the right of `|` or `&`, for legacy pipes.
  - The call's name is bound through `ProjectModel.lookup`.
  - A process records `{fq, simple: the invoked name, base: the declared name, labels: the string-literal arguments of its label directives, path}`.
  - A named workflow recurses with its invoked name as a prefix. A depth limit of 20 and a visited set guard against recursion.
  - The entry workflow adds no prefix.
  - With no entry workflow, every process declaration counts, with `fq = simple = base = name`.
- **Matching:** `matchSelector(ref, uses)` mirrors `ConfigSelectorResolver`:
  - trim the pattern, strip a leading `!` and trim again;
  - compile `^(?:p)$` once per selector;
  - `withLabel` matches if any label matches, negation applied;
  - `withName` matches if any of the distinct names `[base, simple, fq]` matches, negation applied.
  - The count is the number of matching uses (distinct fully qualified names), with up to 50 process names for the details pane.
  - A pattern JavaScript can't compile gives `count: null` and "Can't evaluate this pattern".
- **Display:** "used by 1 process", "used by 3 processes", or "used by no process" (with the warning glyph for `withName`, which Nextflow warns about too).
- **Cost:** the index is computed once per revision in the service; the prototype took 22 ms on sarek.

### 2.9 Option docs in the right pane (FI-04; open point 12)
- **When the config tab is active,** `DetailsPane` renders `ConfigDetails` for the selected row, scope card or selector. Clicking or focusing a row selects it.
- **It shows:**
  - the full name in monospace (`process.memory`);
  - the catalogue types as badges, joined by "or", or "Unknown option" with the FI-03 explanation;
  - the description, without a trailing "[Read more](…)" paragraph, rendered by a small React renderer that handles paragraphs, inline code, https links (new tab, `rel="noopener noreferrer"`), emphasis and fenced code, with no `innerHTML`;
  - "Open in Nextflow docs", linking to `ConfigRules.docsUrl(path)` by the rules in 1.5, falling back to the catalogue's own link and then to `reference/config`.
- **A selector** shows its pattern, its kind's docs (`config#process-selectors`) and the matched process names.
- **Nothing selected:** "Select an option to see its description".
- **Host check:** the docs links are covered by the existing `https://docs.seqera.io/nextflow/` never-fetched prefix (its reason is extended). Catalogue JSON chunks aren't scanned.

### 2.10 Includes (FI-05)
- **Where the rows come from:** the view takes the file's `ConfigIncludeModel`s from `FileModel.includes`. Include rows appear at their source position, at the top level or inside a profile.
- **By target kind:**
  - `file`: a link button ("Open conf/extra.config") that calls `openFile`;
  - `missing`: the `include-target` diagnostic text;
  - `external`: "External source, not checked", with the expression excerpt.
- **Kept:** commands never touch `ConfigInclude` statements.

### 2.11 Undo, Split and Code together
- **One command, one step:** every committed change is one command sent through `canvasStore.apply(command, session, {label})`, so it is one F-209 step. Undo works from the tab-strip buttons, or with Ctrl+Z when focus is outside a text field (ADR 0051).
- **Flush first:** before each command, the config store awaits a new `canvasStore.flushCode()`, which runs the registered code-pane flushes outside the queue, as F-309's `applyFix` does. A pending Monaco edit therefore lands first and can't overwrite the form change later.
- **Refreshing:** the config store pulls `configView` on open and whenever `summary.revision` changes. The pull is deferred by one macrotask, with at most one in flight, and a result for an older revision is dropped.
- **Field drafts:** a field's draft is kept only while it is focused and dirty; otherwise it follows the view.
- **Code edits:** a Code-view edit in Split reaches the form through the same revision change. A refused Code draft (F-208) leaves the form on the saved text.
- **Edit in code:** sets the tab to Split and calls `revealCode(path, range)`, the F-309 mechanism.
- **F-309's problem navigation:** opening a config diagnostic puts its tab in Split.

### 2.12 Accessibility (QA-10 to QA-13, UX-70)
- **Cards:** each card is a `<section>` with an `<h3>` button (`aria-expanded`).
- **Fields:** every field has a visible `<label>` and `aria-describedby` for its message.
- **Status:** a `role="status"` line for applied and refused edits.
- **Add scope:** a native modal `<dialog>` with a labelled filter and a list of buttons.
- **Flags:** shown with text and a glyph (QA-12).
- **Keys:** the view-mode keys never fire in fields. Everything reachable by mouse is reachable by keyboard.

### 2.13 Fixtures (`tools/oracle/cases/`)
The builder re-checks every file against the v26.10.7 docs and the oracle rather than copying it unchecked.

- **`f601-config`** (step 1 start). `main.nf`:
```nextflow
// F-601 (FI-02, FI-06): two typed processes, one labelled big_mem, so a withLabel selector matches one process.
nextflow.enable.types = true

process GREET {
    input:
    name: String

    output:
    line: String = stdout()

    script:
    """
    echo 'hello ${name} (${task.memory})'
    """

    stub:
    """
    echo 'hello ${name} (${task.memory})'
    """
}

process SHOUT {
    label 'big_mem'

    input:
    line: String

    output:
    loud: String = stdout()

    script:
    """
    echo "${task.memory}: ${line.trim()}" | tr a-z A-Z
    """

    stub:
    """
    echo "${task.memory}: ${line.trim()}" | tr a-z A-Z
    """
}

workflow {
    names = channel.of('ada', 'grace')
    loud = SHOUT(GREET(names))
    loud.view()
}
```
  `nextflow.config`:
```nextflow
manifest {
    description = 'Greets and shouts'
    nextflowVersion = '>=26.10.6'
}
```
  Expected: `lint: {expect: ok, clean: true}`; `run: {expect: ok, output: ["NULL: HELLO ADA (NULL)"]}`.
- **`f601-config-after`** (step 1 result): the same `main.nf`, and this config:
```nextflow
manifest {
    description = 'Greets and shouts'
    nextflowVersion = '>=26.10.6'
}

process {
    memory = 2.GB
    withLabel: big_mem {
        memory = 8.GB
    }
}
```
  Expected: lint clean; run output `"8 GB: HELLO ADA (2 GB)"` and `"8 GB: HELLO GRACE (2 GB)"`. Checked: a `lint -format` fixed point.
- **`f601-unknown`** (step 2 start): the same `main.nf`. `nextflow.config`:
```nextflow
// F-601 (FI-03): an imported config with an unknown process option, and an included file with an unknown scope.
manifest {
    description = 'Greets and shouts'
    nextflowVersion = '>=26.10.6'
}

process {
    cpus = 1
    memmory = '4 GB' // misspelt: kept and flagged
}

includeConfig 'conf/extra.config'
```
  `conf/extra.config`:
```nextflow
// An unknown scope and an empty block
mystery {
    level = 3
}

docker {
}
```
  Expected: `lint: {expect: ok, clean: true}`, which records that lint is silent; `run: {expect: ok, output: ["Unrecognized config option 'process.memmory'", "Unrecognized config option 'mystery.level'"]}`.
- **`f601-unknown-after`:** the same tree with `cpus = 2`; same expectations.
- **`f601-selectors`** (FI-06): the tree in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/nfprobe601/f601-selectors/`:
  - `main.nf`: typed `GREET`, `SHOUT` labelled `big_mem`, `workflow GREETING` calling `GREET`, and an entry workflow calling `GREETING` and `SHOUT`;
  - `modules/local/twice/main.nf`: a typed process `TWICE`, included as `TWICE_A` and `TWICE_B`;
  - `nextflow.config`: the 11 selectors of 1.3, each setting a distinct `ext.<key> = 1`.
  - Expected: lint clean; run output contains the four `ext` lines and the two "There's no process matching config selector" warnings.
- **`f601-forms` and `f601-forms-after`** (placements and value kinds). The start is checked (lint clean, runs):
```nextflow
// F-601 forms fixture (start): the starting point of each placement rule.
manifest {
    description = 'Greets and shouts'
    nextflowVersion = '>=26.10.6'
}

docker.enabled = false

process {
    withName: GREET { cpus = 1 }
}

wave {
}

profiles {
    test {
        params.count = 1
    }
}
```
  - `f601-forms-after/nextflow.config` is the exact output of the scripted command sequence in test `config-commands.test.ts`, which exercises every rule of 2.6 and every kind of 2.4:
    - set `manifest.name`;
    - a dotted `docker.runOptions` beside `docker.enabled`;
    - memory in the one-line `withName: GREET` (reprint);
    - top-level `process.memory`, `process.time`, `errorStrategy`, `maxRetries` and `resourceLimits`;
    - add selector `withLabel: big_mem` with memory;
    - `wave.build.repository` (dotted rest of the path);
    - `conda.channels`, `executor.queueSize` and `pollInterval`, `env.GREETING_STYLE`, `params.ratio` and `params.loud` (new blocks);
    - `cleanup` (unscoped);
    - `process.cpus` in profile `test` (dotted);
    - `process.memory` in a new profile `'gpu-test'`;
    - remove `docker.enabled`.
  - The builder generates it from the commands, then commits it once the oracle passes: lint clean, a `lint -format` fixed point, and a run whose recorded output shows the selector memories.
  - My checked drafts of these forms are `f601-forms/` and `f601-values/` in section 8.
- **`f601-plugins`** (lint only; a run would download plugins): `f601-config` after `addConfigPlugin 'nf-schema@2.5.1'`, `addConfigPlugin 'nf-prov@1.4.0'`, `removeConfigPlugin 'nf-prov@1.4.0'`, and `addConfigBlock` for profile `test` and for `docker`. Expected: lint clean.
- **Sources for `cases.yaml`:**
  - `docs/config.mdx` L29–L95 and L185–L357;
  - `docs/reference/stdlib-types/memory-unit.mdx` L10 and `duration.mdx` L10–L34;
  - `docs/reference/process/directives/resource-limits.mdx`;
  - `ConfigValidator.groovy` L107–L168, `ConfigSelectorResolver.groovy` L89–L116, `Session.groovy` L1163–L1199.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/lang-core/src/config.ts` | `ConfigValueKind = "string" \| "boolean" \| "integer" \| "decimal" \| "memory" \| "duration" \| "stringList" \| "map" \| "code"`; `ConfigPathClass = {kind: "option"; types: readonly string[]; description: string} \| {kind: "scope"; description: string} \| {kind: "dsl"} \| {kind: "free"; owner: "params" \| "env" \| "map"} \| {kind: "hidden"} \| {kind: "unchecked"} \| {kind: "unknown"}`; `ConfigScopeForm {scope; form: "options" \| "params" \| "process" \| "profiles" \| "plugins"; pinned: readonly string[]}`; `ConfigFormLayout {scopes: readonly ConfigScopeForm[]; maps: Readonly<Record<string, Readonly<Record<string, ConfigValueKind>>>>}`; `ConfigRules {forms: ConfigFormLayout; classify(names: readonly string[]): ConfigPathClass; valueKind(names: readonly string[], types: readonly string[]): ConfigValueKind; docsUrl(names: readonly string[]): string \| null}` (all readonly) |
| `packages/lang-2610/src/printer/config-formatter.ts` | `ConfigFormatter` (constructor `(fmt: Formatter)`; `config(ast: ConfigAst): void`; `statement(node: ConfigStatement): void`); a port of `ConfigFormattingVisitor` with upstream line references |
| `packages/lang-2610/src/config/validator.ts` | `HIDDEN_OPTIONS`, `CORE_PLUGIN_SCOPES`; `classifyPath(catalogue: ConfigCatalogue, names: readonly string[]): ConfigPathClass`; `optionPaths(ast: ConfigAst): Iterable<{names: string[]; node: ConfigAssign; range: Range}>` (the validator's walk) |
| `packages/lang-2610/src/config/docs.ts` | `SCOPE_PAGES`, `DIRECTIVE_PAGES` (from v26.10.7 `docs/reference/`); `configDocsUrl(catalogue: ConfigCatalogue, names: readonly string[]): string \| null` |
| `packages/lang-2610/src/config/forms.ts` | `CONFIG_FORMS: ConfigFormLayout`; `valueKindOf(names, types): ConfigValueKind` |
| `packages/lang-2610/src/config/index.ts` | `createConfigRules(catalogue: ConfigCatalogue): ConfigRules` |
| `packages/lang-2610/src/lints/config.ts` | `configUnknownOption: LintRule` |
| `packages/lang-2610/test/printer/input/config/*.config` (blocks, selectors, profiles, plugins, values, comments, includes) and their `formatted/` goldens via `pnpm oracle --write-format` | |
| `packages/lang-2610/test/config/{validator,docs,forms,printer-statement}.test.ts`, `packages/lang-2610/test/corpus/print-config.corpus.ts` | section 4 |
| `packages/lang-2610/test/lints/fixtures/config-unknown-option/{positive,negative}/` (`nextflow.config`, `conf/extra.config`) | |
| `packages/engine/src/config/types.ts` | `ProcessUse {fq; simple; base; labels: readonly string[]; path}`; `ProcessUses {entry: string \| null; uses: readonly ProcessUse[]}`; `SelectorMatch {count: number \| null; processes: readonly string[]; note: string \| null}`; `OptionRow {kind: "option"; key; option: readonly string[]; label; class: ConfigPathClass["kind"]; types: readonly string[]; valueKind: ConfigValueKind; value: ConfigValue \| null; code: string \| null; occurrences: number; range: Range; nameRange: Range; diagnostics: readonly Diagnostic[]}`; `IncludeRow {kind: "include"; key; range; source: string; target: {kind: "file"; path} \| {kind: "missing"; message} \| {kind: "external"}}`; `CodeRow {kind: "code"; key; range; text: string; reason: "value" \| "invalid" \| "incomplete" \| "unparsed"; problems: readonly string[]}`; `PluginRow {key; id; name; version: string \| null; range}`; `SelectorCard {key; selector: ConfigSelectorRef \| null; written: string; range; rows: readonly ConfigRow[]; match: SelectorMatch \| null}`; `ProfileCard {key; name; range; items: readonly ConfigViewItem[]}`; `ScopeCard {key; scope; known: boolean; form: ConfigScopeForm["form"] \| "generic" \| "unscoped"; pinned: readonly string[]; rows; selectors; profiles; plugins; range}`; `ConfigRow = OptionRow \| IncludeRow \| CodeRow`; `ConfigViewItem = {kind: "scope"; card: ScopeCard} \| IncludeRow \| CodeRow`; `ConfigView {path; status: ParseStatus; editable: boolean; context: ConfigContext; items: readonly ConfigViewItem[]}`; `ConfigSchemaNode {kind: ConfigNode["kind"]; name; path: readonly string[]; description; docsUrl: string \| null; types: readonly string[]; valueKind: ConfigValueKind \| null; children: readonly ConfigSchemaNode[]}`; `ConfigSchema {version; scopes: readonly ConfigSchemaNode[]; forms: ConfigFormLayout}`; `EXCERPT_LIMIT = 160` |
| `packages/engine/src/config/values.ts` | `readValue(expr: Expression, kind: ConfigValueKind): ConfigValue \| null`; `valueExpression(value: ConfigValue): Expression` (`NO_RANGE` nodes); `parseValueText(kind: ConfigValueKind, text: string): {ok: true; value: ConfigValue} \| {ok: false; message: string}`; `valueText(value: ConfigValue): string` |
| `packages/engine/src/config/uses.ts` | `processUses(model: ProjectModel): ProcessUses` |
| `packages/engine/src/config/selectors.ts` | `matchSelector(selector: ConfigSelectorRef, uses: ProcessUses): SelectorMatch` |
| `packages/engine/src/config/view.ts` | `configView(input: {file: ConfigSourceFile; rules: ConfigRules; uses: ProcessUses; diagnostics: readonly Diagnostic[]; includes: readonly ConfigIncludeModel[]}): ConfigView` |
| `packages/engine/src/config/schema.ts` | `configSchema(version: string, catalogue: ConfigCatalogue, rules: ConfigRules): ConfigSchema` |
| `packages/engine/src/config/index.ts` | re-exports |
| `packages/engine/src/edit/config/nodes.ts` | `configName(name: string): ConfigName`; `configAssign(path: readonly string[], value: Expression): ConfigAssign`; `configBlock(name: string, statements?): ConfigBlock`; `configSelector(ref: ConfigSelectorRef, statements?): ConfigSelector`; `configApply(id: string): ConfigApply`; `bareSafe(name: string): boolean` |
| `packages/engine/src/edit/config/locate.ts` | `contextStatements(ast: ConfigAst, context: ConfigContext): {statements: readonly ConfigStatement[]; owner: ConfigBlock \| ConfigSelector \| null} \| null`; `occurrences(ast, context, option): readonly ConfigAssign[]`; `container(ast, context, scope): {block: ConfigBlock \| ConfigSelector \| null; rest: readonly string[]; dotted: ConfigAssign \| null}` |
| `packages/engine/src/edit/config/splice.ts` | `indentUnit(text: string): string`; `insertStatement(file: ConfigSourceFile, into: ConfigBlock \| ConfigSelector \| null, after: ConfigStatement \| null, node: ConfigStatement, printer: ConfigPrinter): TextEdit`; `removeStatements(file, nodes: readonly ConfigStatement[], printer): TextEdit`; `replaceValue(file, assign: ConfigAssign, value: Expression, printer): TextEdit`; `reprintStatement(file, node, updated, printer): TextEdit` |
| `packages/engine/src/edit/commands/config.ts` | `setConfigOption(state: EditState, command: SetConfigOption): TextPatch[]`, plus the same for `removeConfigOption`, `addConfigBlock`, `addConfigPlugin`, `removeConfigPlugin` |
| `packages/engine/test/config/{values,uses,selectors,view,schema}.test.ts`, `packages/engine/test/edit/{config-commands,config-properties}.test.ts`, `packages/engine/test/service/config.test.ts`, `packages/engine/test/corpus/config.corpus.ts` | section 4 |
| `tools/oracle/cases/f601-{config,config-after,unknown,unknown-after,selectors,forms,forms-after,plugins}/**` | 2.13 |
| `apps/web/src/config/config-store.ts` | `ConfigTabState {status: "loading" \| "ready" \| "failed"; revision: number \| null; view: ConfigView \| null; message: string \| null; selected: string \| null; pending: readonly PendingRow[]; collapsed: readonly string[]; notice: string \| null}`; `PendingRow {key; context: ConfigContext; option: readonly string[]}`; `ConfigState {schema: ConfigSchema \| null; tabs: Readonly<Record<string, ConfigTabState>>}`; `ConfigActions {open(path): Promise<void>; refresh(): Promise<void>; select(path, key: string \| null): void; set(path, context, option, value: ConfigValue): Promise<ApplyOutcome \| null>; remove(path, context, option): Promise<ApplyOutcome \| null>; addBlock(path, context, scope: readonly string[]): Promise<ApplyOutcome \| null>; addPlugin(path, id): Promise<ApplyOutcome \| null>; removePlugin(path, id): Promise<ApplyOutcome \| null>; addPending(path, row: PendingRow): void; toggle(path, cardKey): void; editInCode(path, range: Range): void}`; `createConfigStore(o: {engine: () => EngineApi; workspace: StoreApi<WorkspaceState & WorkspaceActions>; schedule?: (fn: () => void) => void}): StoreApi<ConfigState & ConfigActions>`; `configStore`; `useConfig<T>(selector): T` |
| `apps/web/src/config/config-pane.tsx` | `ConfigPane({path}): JSX.Element`, a lazy boundary like `CodePane` |
| `apps/web/src/config/config-editor.tsx` | default export `ConfigEditor({path})` (lazy chunk) |
| `apps/web/src/config/{scope-card,option-row,value-field,selector-card,profile-card,plugins-card,add-scope-dialog,add-option-menu}.tsx` | `ScopeCardView`, `OptionRowView`, `ValueField({kind, value, label, disabled, onCommit, onClear})`, `SelectorCardView`, `ProfileCardView`, `PluginsCardView`, `AddScopeDialog({schema, inUse, onPick, onClose})`, `AddOptionMenu({schema, scope, taken, onPick})` |
| `apps/web/src/config/config-details.tsx` | `ConfigDetails(): JSX.Element`; `ConfigDetailsView({row, schemaNode, match})` |
| `apps/web/src/config/catalogue-text.tsx` | `CatalogueText({markdown}): JSX.Element` (the safe subset in 2.9) |
| `apps/web/src/config/config.css` | |
| `apps/web/test/{config-store,config-editor,value-field,add-scope-dialog,config-details,catalogue-text}.test.ts(x)` | section 4 |
| `e2e/config.ts` | `F601_CONFIG`, `F601_CONFIG_AFTER`, `F601_UNKNOWN`, `F601_UNKNOWN_AFTER`, `F601_SELECTORS`, `F601_FORMS_AFTER`; `openStoredConfigFixture(page, dir, name)`; `openConfigTab(page, path)` (through the summary link); `configCard(page, scope): Locator`; `optionField(card: Locator, label: string): Locator`; `selectorCard(page, written): Locator`; `addScope(page, scope)`; `addSelector(page, kind, pattern)`; `configDetails(page): Locator`; `configReady(page)` (`[data-config-state="ready"]`) |
| `e2e/config.spec.ts` | section 4 |

### 3.2 Change
- **lang-core:**
  - `printer.ts`: `ConfigPrinter {printConfig(ast: ConfigAst, options?: PrintOptions): PrintResult; printConfigStatement(node: ConfigStatement, options?: PrintOptions & {readonly indent?: number}): PrintResult}`.
  - `source-file.ts`: `SourceParser.configPrinter: ConfigPrinter`.
  - `edit.ts`: the 2.5 types, the five kinds in `EditCommand` and `EDIT_COMMAND_KINDS`.
  - `index.ts`: `LanguagePack.loadConfigRules(): Promise<ConfigRules>`, and the exports.
- **lang-2610:**
  - `printer/index.ts`: `printConfig`, `printConfigStatement`, `configPrinter`.
  - `source/index.ts`: the parser carries `configPrinter`.
  - `src/index.ts`: `loadConfigRules: async () => (await import("./config/index.ts")).createConfigRules(…)`, memoised, loading the catalogue's config part lazily.
  - `lints/index.ts`, `lints/codes.ts` (the code entry) and `lints/advice.ts` if needed.
  - `test/lints/fixtures.json` (recorded entries), `test/printer/fixtures.json` (config files in the `printer` tree), `test/printer/fixtures.test.ts` (dispatch `.config` to `printConfig`).
- **engine:**
  - `edit/apply.ts`: the `build` cases.
  - `history/labels.ts`: the labels in 2.5.
  - `service/types.ts`: `ConfigViewResult {revision: number; view: ConfigView \| null}`, `EngineApi.configView(path: string): Promise<ConfigViewResult \| EngineRefusal>` and `configSchema(version: string): Promise<ConfigSchema>`.
  - `service/service.ts`: `Open.configRules`, `Open.uses?` (dropped in `changed()`), and the two methods.
  - `index.ts`: export `config/*`, `parseValueText`, `valueText`, `languageOf` (if not exported yet).
- **web:**
  - `engine/engine-client.ts`: both methods in `connectEngine`; not announced, being read-only.
  - `workspace/workspace.ts`: pass-through.
  - `canvas/canvas-store.ts`: `WorkflowTab.kind` `"config"`, `configTabFor`, `openFile` dispatch, `flushCode()`, config tabs skipped by `load`/`changed`.
  - `views/view-mode.ts`: `modeLabel(kind, mode)`.
  - `views/view-mode-toggle.tsx`: `labels` prop.
  - `views/tab-panel.tsx`: config tabs.
  - `shell/tab-strip.tsx`: toggle labels by kind.
  - `details/details-pane.tsx`: `ConfigDetails` on a config tab.
  - `details/workflow-summary.tsx` and `packages/engine/src/details/summary.ts`: a `configs: readonly string[]` field and the "Configuration" link (open point 2).
  - `app-shell.tsx` and `shell/status-bar.tsx`: no node or channel counts on config tabs, if F-309 hasn't done it for file tabs.
  - `main.tsx`: `nfBuilderWorkspace.openFile`.
- **Other:**
  - `e2e/engine.ts`: `EngineHook.configView` and `configSchema`.
  - `tools/oracle/cases/cases.yaml`: the eight cases.
  - `scripts/non-fetched-urls.ts`: extend the docs prefix's reason to "and the config editor's docs links (F-601)".
  - `docs/licences.md`: the rows in section 7.
- **Unchanged:**
  - dependencies;
  - dependency-cruiser rules (a new pack member, inside existing boundaries);
  - workflows (the oracle and corpus-parse jobs pick up new cases and `*.corpus.ts` files);
  - stored and exported formats;
  - generated files (the catalogue is read, not edited);
  - the AGENTS.md command table.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **lang-2610 `test/printer/fixtures.test.ts`** (extend) | |
| `F-601 ADR-0032 LA-45: each config printer fixture prints exactly as nextflow lint -format wrote it` | `printConfig` on `input/config/*.config` and the `config-constructs` oracle files by path equals `formatted/`; the oracle's format rows check the goldens |
| **`test/config/printer-statement.test.ts`** | |
| `F-601 ADR-0032: printConfigStatement prints a new assignment, block, selector and plugin line in the fresh layout at a given indent` | |
| `F-601: printConfigStatement throws PrintError for ConfigInvalid and ConfigIncomplete and reports no missing comments for printable nodes` | |
| **`test/corpus/print-config.corpus.ts`** | |
| `F-601 ADR-0032 LA-45: every corpus config prints as nextflow lint -format wrote it, apart from listed known differences` | against `.cache/corpus-lint/<pin>.format/`; new differences get entries in `known-format-differences.json` with an upstream-bug id |
| **`test/config/validator.test.ts`** | |
| `F-601 FI-03: classifyPath follows ConfigValidator 26.10.7` | table: `process.memory` option; `process.memmory` unknown; `params.x` and `env.X` free; `process.ext.args` and `process.resourceLimits.cpus` free (map); `cleanup` option; `poolSize` hidden; `cloudcache.path` unchecked; `wave.enabled` and `aws.region` option; `mystery.level` unknown; `plugins` dsl; `process` scope |
| `F-601 FI-03: optionPaths drops withLabel and withName selectors and executor.$name, and treats a profile's content as top level` | |
| **`test/config/docs.test.ts`** | |
| `F-601 FI-04: every catalogue scope and option gets a docs URL under https://docs.seqera.io/nextflow/ by the verified page rules` | |
| `F-601 FI-04: docsUrl gives the verified pages and anchors` | `docker.enabled` to `reference/config/docker#dockerenabled`; `process.memory` to `reference/process/directives/memory`; `process.when` to `config#process-configuration`; `cleanup` to `reference/config/unscoped#cleanup`; `executor.retry.delay` to `executor#executorretrydelay`; `appleContainer` to `apple-container`; `params` to `config#parameters`; `profiles` to `config#config-profiles`; `plugins` to `plugins` |
| **`test/config/forms.test.ts`** | |
| `F-601 FI-02: the form layout covers exactly the FI-02 scopes and names only catalogue options` | |
| `F-601 FI-02: valueKind maps every catalogue type, the first type with a widget winning, and Map, Object and Closure to code` | |
| **engine `test/diagnostics/fixtures.test.ts`** (existing, data-driven) | |
| `F-112 step 1: config-unknown-option has a positive and a negative fixture` and `…fires on its positive fixture and not on its negative` | positive: `f601-unknown` shapes; negative: params, env, ext, hidden, selectors, `executor.$sge`, profiles, cloudcache |
| **`test/diagnostics/names.test.ts`** (extend) | |
| `F-601 FI-03 AR-05: config-unknown-option starts with Nextflow's run-time message and says what to do` | starts with "Unrecognized config option 'process.memmory'" and has a ` -- ` advice clause |
| **`test/config/values.test.ts`** | |
| `F-601 FI-02: readValue reads each kind's literals, 8.GB and '8 GB' as memory, 2.h and '2h' as duration, and nothing from closures, GStrings or values with comments` | |
| `F-601 FI-02: valueExpression prints the forms the oracle checked` | `8.GB`, `2.h`, `30.min`, `'it\'s $HOME'`, `['a', 'b']`, `[cpus: 4, memory: 8.GB, time: 2.h]`, `-1` |
| `F-601: parseValueText accepts 8.GB, 8 GB, 8GB, 2h, 2 h, 90 m and refuses decimals for memory and duration with a message` | |
| **`test/config/uses.test.ts`** | |
| `F-601 FI-06: processUses on f601-selectors lists GREETING:GREET, SHOUT, TWICE_A and TWICE_B with declared names, aliases and labels` | |
| `F-601 FI-06: legacy pipes and calls inside closures or ifs are found; recursion stops; no entry workflow counts declarations` | |
| **`test/config/selectors.test.ts`** | |
| `F-601 FI-06: every f601-selectors selector matches what Nextflow 26.10.7 applied in the oracle run` | counts 1, 1, 1, 2, 1, 2, 2, 1, 3, 0, 0 in file order |
| `F-601 FI-06: patterns are trimmed, ! negates, labels match any label, and an uncompilable pattern gives null with a note` | |
| **`test/config/view.test.ts`** | |
| `F-601 FI-01: f601-forms-after gives one card per top-level scope in order of first appearance, gathering block and dotted forms` | |
| `F-601 FI-02: first-class cards carry their pinned fields; resourceLimits is a fixed-key map row; selectors carry their match` | |
| `F-601 FI-03: f601-unknown flags process.memmory and mystery.level and keeps them as rows with code values` | |
| `F-601 FI-05: include rows carry a file target, a missing-target message or external` | |
| `F-601: dynamic values, ConfigInvalid, ConfigIncomplete and Unparsed items are code rows; a file with problems is not editable` | |
| `F-601 AR-30: no excerpt in a view exceeds 160 characters or spans lines` | |
| **`test/config/schema.test.ts`** | |
| `F-601 FI-03 FI-04: the schema lists all 42 top-level catalogue nodes with descriptions, docs URLs and value kinds, and survives structuredClone` | |
| **`test/edit/config-commands.test.ts`** | |
| `F-601 step 1 FI-02 AR-23: addConfigBlock process, setConfigOption process.memory, addConfigBlock withLabel big_mem and setConfigOption in it turn f601-config into f601-config-after byte for byte; each inverse restores the previous bytes` | |
| `F-601 step 2 FI-03: setConfigOption process.cpus on f601-unknown gives f601-unknown-after, and the unknown option's line is byte-identical` | |
| `F-601 FI-02 ADR-0032: the scripted sequence turns f601-forms into f601-forms-after` | each rule of 2.6 hit once |
| `F-601 IO-33: the plugin and block sequence gives f601-plugins` | |
| `F-601 ADR-0032: inserting into a one-line block reprints only that block, keeping its comments` | |
| `F-601: removeConfigOption removes every occurrence in its context with the comments attached to them and leaves the container` | |
| `F-601: commands keep CRLF endings and the file's indent unit (tabs, two spaces)` | |
| `F-601 AR-24: invalid names, a selector option outside process, a duplicate plugin, a malformed plugin id and a value with comments inside are refused and change nothing` | |
| `F-601 F-209: setting the same value or adding an existing block yields no patch` | |
| **`test/edit/config-properties.test.ts`** (fast-check) | |
| `F-601 AR-22 ADR-0032 FI-03: random config commands on the f601 trees and corpus-shaped configs keep every other statement's exact text, keep unknown statements, add no parse problem, and their inverse restores the bytes` | |
| **`test/history/labels.test.ts`** (extend) | |
| `F-601 F-209: config commands have labels naming the option, context or plugin` | |
| **`test/service/config.test.ts`** | |
| `F-601: configView answers at the current revision and refuses a path that isn't a config file` | `not-found` |
| `F-601 FI-06: after a change to main.nf the next view's selector counts follow` | add a label |
| `F-601: configSchema needs no open project; results survive structuredClone` | |
| **`test/corpus/config.corpus.ts`** | |
| `F-601 FI-01: configView never throws on the 228 corpus configs and accounts for every statement` | |
| `F-601 FI-03: on the five pins the unknown-option warnings are exactly the eight plugin-scope options` | `validation.*` ×6, `prov.*` ×2 |
| `F-601 FI-06: selector counts on the pins; zero matches are listed in the report` | |
| `F-601 AR-22 AR-23: set, remove and add-block on every corpus config pass the guards, keep untouched statements byte for byte and undo exactly` | timings in `.cache/reports/config-corpus.md` |
| **web `canvas-store.test.ts`** (extend) | |
| `F-601 UX-20: openFile opens a .config file once as a config tab in Form mode, and other files as F-309's file tabs` | |
| `F-601: changed() never projects a config tab; modes are kept per config tab` | |
| `F-601 F-209: flushCode runs every registered flush outside the queue` | |
| **`config-store.test.ts`** (fake engine, real canvas store) | |
| `F-601: opening a config tab pulls its view and the schema once; a new revision pulls again; one pull at a time; an older result is dropped` | |
| `F-601 F-209: set flushes pending code, then sends one setConfigOption with its label through the canvas store` | |
| `F-601: a refusal becomes the tab's notice and pulls again; pending rows vanish once the view holds them` | |
| `F-601: editInCode switches the tab to Split and records a reveal for the range` | |
| **`config-editor.test.tsx`** (static markup) | |
| `F-601 FI-01: each top-level scope is a collapsible card in source order` | |
| `F-601 FI-02: first-class cards show their pinned fields; generic cards show set options and Add option` | |
| `F-601 FI-03 QA-12: an unknown option shows "Unknown option", the glyph, its value as code and Remove` | |
| `F-601 FI-06: selector cards read "used by 1 process", "used by no process" or "Can't evaluate this pattern"` | |
| `F-601 FI-05: an include row links its file; an external one doesn't` | |
| `F-601: a view that isn't editable disables every field and shows the banner` | |
| **`value-field.test.tsx`** | |
| `F-601 FI-02 QA-11: each kind renders a labelled widget, commits a parsed value on Enter or blur, reverts on Escape, and shows the message for invalid input without committing` | |
| **`add-scope-dialog.test.tsx`** | |
| `F-601 FI-03: lists every catalogue scope with its description, filters by name and description, and marks scopes in use` | |
| **`config-details.test.tsx`** and **`catalogue-text.test.tsx`** | |
| `F-601 FI-04: shows the full name, the types, the description without its Read more line, and the docs link` | |
| `F-601 FI-04: an unknown option says it isn't a Nextflow 26.10 option` | |
| `F-601: catalogue text renders paragraphs, inline code, https links and fenced code, and never raw HTML` | |
| **`view-mode.test.ts`**, **`tab-panel.test.tsx`**, **`workflow-summary.test.tsx`** (extend) | |
| `F-601 UX-27 UX-70: a config tab's toggle reads Form, Split and Code, and G selects Form` | |
| `F-601 UX-27: a config tab shows the form, the form beside the code, or the code` | |
| `F-601: the entry summary links nextflow.config when the project has one` | only with open point 2 |
| **e2e `e2e/config.spec.ts`** (Chromium) | |
| `F-601 step 1 FI-02 FI-06 AR-23: set process memory and a withLabel selector through the forms; the code matches f601-config-after, has no problems, and four undos restore the file` | 1. A stored `f601-config` project; open `nextflow.config` from the summary link.<br>2. Add scope… then process.<br>3. Memory `2.GB` and Enter.<br>4. Add selector… `withLabel` `big_mem`; the card reads "used by 1 process".<br>5. Memory `8.GB` in it.<br>6. `readFile` equals `f601-config-after/nextflow.config`.<br>7. Split shows the same text.<br>8. Engine diagnostics for the file are empty; no CSP violation.<br>9. The Undo button four times gives the `f601-config` bytes. |
| `F-601 step 2 FI-03: an unknown option in an imported config is kept and flagged; setting cpus leaves it byte for byte` | `f601-unknown` (through the zip import if F-403 has merged; open point 16). The `memmory` row is flagged with Nextflow's message. Set cpus `2`: the file equals `f601-unknown-after`. The engine reports exactly the two warnings. The include link opens `conf/extra.config`, where `mystery` reads "Unknown scope". |
| `F-601 FI-03: Add scope lists every scope in the catalogue with its description` | the names equal the 37 top-level scope and dsl nodes read from `config.json` on disk |
| `F-601 FI-04: selecting an option shows its description, type and docs link in the right pane` | `process.memory`: `MemoryUnit`, `href=https://docs.seqera.io/nextflow/reference/process/directives/memory` |
| `F-601 FI-05: an includeConfig line opens the included file in its own config tab` | |
| `F-601 FI-06: selectors show how many processes they match, as Nextflow applied them` | `f601-selectors`: all 11 counts |
| `F-601 UX-27: on a config tab a form edit updates the Split code and a code edit updates the form; Form mode loads no Monaco` | |
| `F-601: a dynamic value is read-only, and Edit in code reveals it in Split` | `data-selection` (F-309) |
| `F-601 F-203: manifest.name is set through the form on a Hello world project` | the file gains `name = '…'` in `manifest` |
| `F-601 UX-70 QA-11: the form, the Add scope dialog and the option fields work by keyboard` | |
| `F-601 FI-01 FI-04: the config form and the option details match their approved baselines @visual` | `f601-forms-after` in Form mode; the right pane on `process.resourceLimits`; baselines from CI only |

## 5. Tasks

**Starting point:**
- Branch `feat/F-601` from `main`.
- Tasks 1 to 6 touch only the packages, the oracle and e2e helpers, and can start now.
- Tasks 7 onwards touch `canvas-store.ts`, the tab strip, the tab panel and the details pane, so they start after F-309 merges (open point 1).
- Run `pnpm check` before every commit. The e2e tests need `PW_CHROMIUM_EXECUTABLE`.

1. **Oracle cases.**
   - Files: `f601-config`, `f601-config-after`, `f601-unknown`, `f601-unknown-after` and `f601-selectors` (2.13), and their `cases.yaml` entries with sources.
   - Done when these pass:
     - `pnpm oracle -- --case f601-config --case f601-config-after --case f601-unknown --case f601-unknown-after --case f601-selectors`;
     - `pnpm check`.
2. **Config printer.**
   - Files:
     - `ConfigPrinter` and `SourceParser.configPrinter`;
     - `config-formatter.ts`, `printConfig`, `printConfigStatement`;
     - the config fixture inputs, goldens through `pnpm oracle --write-format`, and `fixtures.test.ts` dispatch;
     - `printer-statement.test.ts` and `print-config.corpus.ts`;
     - the licences row.
   - Done when these pass:
     - `pnpm --filter @nf-builder/lang-2610 test`;
     - `pnpm oracle` (format and fixed-point rows);
     - `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus -- print-config`;
     - `pnpm check`.
3. **Config rules and the warning.**
   - Files:
     - lang-core `config.ts` and `LanguagePack.loadConfigRules`;
     - lang-2610 `config/{validator,docs,forms,index}.ts`;
     - `lints/config.ts`, the code entry, the fixtures and the recorded `fixtures.json` entries;
     - their tests.
   - Done when these pass:
     - `pnpm --filter @nf-builder/lang-2610 test`;
     - `pnpm --filter @nf-builder/engine exec vitest run test/diagnostics`;
     - `pnpm oracle` (lint-fixtures tree);
     - `pnpm check`.
4. **Engine view.**
   - Files: `engine/src/config/*` (values, uses, selectors, view, schema) and their tests, and the view parts of `config.corpus.ts`.
   - Done when these pass:
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm test:corpus -- config`;
     - `pnpm check`.
5. **Commands.**
   - Files:
     - the lang-core command types;
     - `edit/config/{nodes,locate,splice}.ts` and `commands/config.ts`;
     - the `build` cases and labels;
     - `config-commands.test.ts`, `config-properties.test.ts` and the edit parts of `config.corpus.ts`;
     - generate `f601-forms-after` and `f601-plugins` from the commands, and add the `f601-forms`, `f601-forms-after` and `f601-plugins` cases.
   - Done when these pass:
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm oracle -- --case f601-forms --case f601-forms-after --case f601-plugins`;
     - `pnpm test:corpus -- config`;
     - `pnpm check`.
6. **Service and bridge.**
   - Files:
     - `configView` and `configSchema` in `types.ts` and `service.ts` (memoised index);
     - `connectEngine` and `workspace.ts`;
     - `e2e/engine.ts`;
     - `test/service/config.test.ts`, and `engine-client` and `workspace` test extensions.
   - Done when these pass:
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm --filter @nf-builder/web test`;
     - `pnpm test:e2e -- --grep "F-113|F-202"`;
     - `pnpm check`.
7. **Config tabs, a read-only form, FI-04 and FI-05.**
   - Files:
     - the tab kind, `openFile` dispatch, `flushCode`, mode labels and `TabPanel`;
     - `config-store.ts` (pull and selection);
     - the lazy `ConfigPane` and `ConfigEditor` rendering cards, rows, code rows, include links and selector counts, with no editing yet;
     - `ConfigDetails` and `CatalogueText`;
     - the summary link and the `openFile` hook;
     - `e2e/config.ts`, and the FI-04, FI-05 and FI-06 e2e tests.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-601 FI-0[456]|F-208|F-206|F-209|F-309"`.
8. **Editing.**
   - Files:
     - `ValueField` and set, remove and pending rows;
     - Add scope, Add option, Add selector, Add profile, plugins, params and env;
     - Edit in code and Set a value;
     - the read-only banner;
     - the store actions with flush and notice;
     - the unit tests;
     - the step 1, step 2, FI-03, UX-27, dynamic-value, `manifest.name` and keyboard e2e tests.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-601|F-208|F-209|F-201"`;
     - `pnpm smoke`, in under 60 s.
9. **Visual tests.**
   - Files: the `@visual` test.
   - Done when `pnpm check` passes and the PR's Chromium job runs it.
   - The orchestrator then views each `-actual.png` from the `playwright-chromium` artefact and commits it (ADR 0021). CI must then be green, with every existing baseline unchanged.
10. **Records** (section 7).
    - Done when `pnpm check` and the Scope guard pass.

## 6. Open points (recommendations only; none decided here)

1. **Sequencing with F-309.**
   - The UI shares F-309's file tabs, `openFile` and `revealCode`, and the same files (`canvas-store.ts`, `tab-panel.tsx`, `tab-strip.tsx`).
   - **Recommend:**
     - Build tasks 1 to 6 now.
     - Start task 7 after F-309 merges, rebasing on its names as built.
     - If F-309 stalls, F-601 implements file tabs and reveal exactly as plan-F-309 sections 2.4 and 2.5 describe, and F-309 rebases.
   - No `depends_on` change, so no `scope-change` label.
2. **How users open the editor without F-210.**
   - **Recommend:**
     - `openFile` dispatch, which F-210 and F-309 reuse;
     - a "Configuration" section in the entry workflow's summary linking the root `nextflow.config` when it exists. It is small, independent, and leaves every baseline unchanged, since `f206-details` has no config.
     - Amend UX-31.
   - **Alternative:** add F-210 to F-601's `depends_on` (`scope-change`) and open configs only from the Files tree. That blocks F-601 on F-403 and F-210.
3. **Statement-level config edits.** This amends ADR 0039's reprint level for config files and refines ADR 0032's "what is formatted" to "new and edited config statements".
   - **Recommend:**
     - one `TextEdit` per command: value replacement, line insertion or line removal;
     - a container reprint only for one-line blocks.
     - Config files are flat statement lists. Reprinting a whole `process` block would reformat nf-core's aligned blocks: 189 of 228 corpus configs change under `lint -format`.
   - **Alternative:** reprint the enclosing top-level statement, ADR 0039's script rule. Larger diffs on every form edit.
4. **Port `ConfigFormattingVisitor`.**
   - **Recommend:** port it, with default options only, plus corpus parity against the existing `corpus-lint` formatted output and the F-110 known-differences mechanism.
   - **Alternative:** hand-write the few line shapes F-601 needs. Cheaper, but then nothing proves that new statements match `lint -format`, which ADR 0005 requires.
5. **Command set and what "Add" writes.**
   - **Recommend:**
     - the five commands, with an AR-21 amendment;
     - Add scope, Add selector and Add profile write an empty block (`name {` / `}`, lint clean and silent at run time). The file stays the source of truth, and each add is one undo step.
     - Add option and unscoped options are pending UI rows until a value is committed.
     - No block-removal command in v0.1; Code covers it.
   - **Alternative:** every add is UI-only until the first value. That gives one fewer command but hidden state.
6. **Placement rules** (2.6): last occurrence edited; existing block; prefix block with the rest dotted; dotted beside dotted; new top-level block at the end; dotted in profiles; selectors always blocks; indentation copied from siblings.
   - **Recommend:** accept, and record them in the ADR. The goldens and property tests pin them down.
7. **Literal forms written.**
   - **Recommend:**
     - `8.GB` and `2.h` (unit suffix on an integer, as the type docs say, and as the mockup and nf-core write);
     - single-quoted strings, `[…]` lists, `[key: value]` maps.
     - Memory and duration strings are read and kept as written until edited, then rewritten in suffix form.
   - **Alternative:** strings (`'8 GB'`). Also valid, but they need escaping and don't match the mockup.
8. **Expressions in forms.**
   - **Recommend:** read-only code with Edit in code, plus an explicit "Set a value", which replaces the expression as one undoable step and is refused when the expression holds comments.
   - **Alternative:** Edit in code only. That leaves 659 closure-valued corpus options unchangeable from the form.
9. **Files with parse problems.**
   - **Recommend:** the form is read-only with a banner until the file parses cleanly. We can't know what an `Unparsed` chunk holds, so writing around it could add a duplicate scope.
   - **Alternative:** allow edits; the AR-24 guard still refuses new problems.
10. **Unknown options** (FI-03).
    - **Recommend:**
      - our own warning, `config-unknown-option`, mirroring Nextflow 26.10.7's run-time `ConfigValidator`, with a message that starts with its exact text;
      - plugin scopes flagged until F-505;
      - `env` NXF variables not flagged (another validator message; a note for later);
      - amend FI-03 to say the warning is Nextflow's run-time check, which `nextflow lint` doesn't make.
      - The oracle cases prove the parity.
    - **Alternative:** a UI-only flag with no diagnostic. The problems panel and the status bar would then miss it, against "flagged as warnings".
11. **FI-06 semantics.**
    - **Recommend:**
      - count the invoked processes reachable from the entry workflow (distinct fully qualified names) whose declared, alias or fully qualified name, or any label, matches, exactly as `ConfigSelectorResolver` does;
      - JavaScript regex, with `null` when it can't compile;
      - no diagnostic for unmatched selectors in F-601, with a note for a later feature that mirrors Session's "There's no process matching config selector" warning;
      - amend FI-06 with the definition.
12. **Docs links and descriptions** (FI-04).
    - **Recommend:**
      - the verified URL rules in the pack, preferred over the catalogue's stale `reference/process#…` links;
      - a minimal safe renderer for catalogue Markdown;
      - no "added in" version badge, which the catalogue lacks; a note for the catalogue generator.
13. **The view through the worker.**
    - **Recommend:** `EngineApi.configView` and `configSchema`, amending ADR 0043's API list; excerpts capped at 160 characters (AR-30); the schema, about 170 kB, sent once per session.
    - **Alternative:** load the catalogue on the main thread. F-113 kept pack code off the main thread.
14. **Modes on config tabs.**
    - **Recommend:** reuse the `ViewMode` values, labelled Form, Split and Code, with G selecting Form; amend UX-27.
    - **Alternative:** a separate `"form"` mode value. More churn for the same behaviour.
15. **New top-level blocks after `includeConfig`.**
    - **Recommend:** append at the end of the file, so the value the user sets takes effect (later wins); say so in the ADR.
    - **Alternative:** insert before a trailing run of includes. That keeps nf-core's "modules.config last" precedence, but the form's value could then be silently overridden.
16. **Step 2's "imported".**
    - **Recommend:** read it as "a project created from existing files". The e2e test opens the stored fixture and, if F-403 has merged, also imports it as a zip. Record the reading in the notes; the step text is unchanged.
17. **Highlighting.**
    - **Recommend:** config files keep the Nextflow grammar in Monaco; a separate config grammar is not needed for v0.1.
18. **Large configs.**
    - **Recommend:** selector cards collapse to one summary line by default when a card has more than 20 selectors; time `configView` on sarek's `modules.config` in the corpus report; a note for F-702.

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** none.
- **Package boundaries or dependency-cruiser rules:** none. There is a new `LanguagePack` member and new engine and web modules, inside existing rules.
- **Stored or exported format:** none. The view, the schema, pending rows and collapse state are session-only; files are text.
- **Workflows:** none. The oracle and corpus-parse jobs pick up the new cases and corpus tests.
- **`features.json` beyond `passes` and `notes`:** none with the recommendations (points 1 and 2).
- **ADR interplay:** amends ADR 0039 (reprint level for configs, point 3), refines ADR 0032 (point 3) and amends ADR 0043's API list (point 13).
- **Spec behaviour:** AR-21, FI-03, FI-06, UX-27, and UX-31 with point 2.
- **Open questions:** none relevant in `open-questions.md`.

## 7. Records (drafts for the orchestrator)

**ADR** (`Accepted (agent)`, the next free number at landing; F-207 and F-309 may take 0052 and 0053):
- **Title:** "Edit nextflow.config through forms: statement-level config commands, a ported config printer, Nextflow's run-time option check and selector matching".
- **It covers:** sections 2.1 to 2.10 and the recommendations of points 2 to 18.
- **It amends** ADR 0039 and ADR 0043, and refines ADR 0032.
- Add a row to `docs/adr/README.md`.

**Spec:**
- **AR-21:** add `SetConfigOption`, `RemoveConfigOption`, `AddConfigBlock`, `AddConfigPlugin` and `RemoveConfigPlugin` (ADR …).
- **FI-03:** "…flagged as warnings with Nextflow's run-time wording ('Unrecognized config option …'), which `nextflow lint` 26.10 doesn't report. Plugin scopes count as unknown until their plugin's spec is loaded (F-505)."
- **FI-06:** "…counted over the processes the entry workflow invokes, matched as Nextflow does: regular expression on the whole name, `!` negates, `withName` against the declared, alias and fully qualified names, `withLabel` against any label."
- **UX-27:** "On a config tab the modes are Form, Split and Code, and G selects Form."
- **UX-31:** "…and a link to the project's `nextflow.config`" (point 2).

**`features.json` notes:**
- **F-601:**
  - "Verified …:
    - step 1 by `e2e/config.spec.ts` and `test/edit/config-commands.test.ts` on oracle cases `f601-config` and `f601-config-after` (lint clean, run shows the selector memory);
    - step 2 by the step 2 e2e test and `f601-unknown` / `f601-unknown-after` (lint silent; Nextflow's run warns with the same text).
  - 'Imported' is read as a project created from existing files."
- **F-505:**
  - Merge each declared plugin's `ConfigScope` definitions (registry snapshot `plugins/<id>/<version>.json`) into `ConfigRules.classify` and `configSchema`. That clears the `validation.*` and `prov.*` warnings in the corpus.
  - Reuse `addConfigPlugin`.
- **F-607:** set `manifest.diagram` with `setConfigOption(["manifest", "diagram"], {kind: "string", …})`.
- **F-602:** the config `params` card edits config params only; the schema builder's sync is separate.
- **F-210:** `openFile` already opens `.config` files as config tabs; the tablist label is still "Workflows".
- **F-309:** config diagnostics open their config tab in Split (if F-309 lands after F-601, wire `goTo` for config tabs).
- **F-701:** audit the config form, the Add scope dialog and G-for-Form.
- **F-702:** `configView` and the process-use index timings (prototype: 22 ms index and 68 ms matching on sarek).
- **F-703:** the form is read-only below 1024 px.

**Other records:**
- **`docs/licences.md`:**
  - the ported `ConfigFormattingVisitor` (nf-lang, Apache-2.0);
  - the `ConfigValidator` and `ConfigSelectorResolver` logic (Nextflow, Apache-2.0);
  - the selector fixture's shapes, adapted from the docs (`config.mdx`).
- **`progress.md` Decisions:** the ADR, the five commands, statement-level edits, the warning code, FI-06 semantics, the entry link, the spec amendments, and the new baselines.
- **`docs/plan/handoff/README.md`:** an F-601 row. Delete this plan in the PR that merges F-601.

## 8. Evidence

All paths are under `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`.

| Probe | Path | Result |
|---|---|---|
| Draft trees, linted, formatted and run with pinned Nextflow 26.10.7 (`/home/user/.nfcache/nextflow-26.10.7-dist`, the oracle's environment variables, a copied `NXF_HOME`) | `nfprobe601/f601-config/`, `f601-config-after/`, `f601-unknown/`, `f601-unknown-after/`, `f601-selectors/`, `f601-forms/`, `f601-forms-start/`, `f601-values/`, `f601-blocks/`, `f601-sel/`; runner `nfprobe601/nf.sh` | section 1.3; all lint clean; `-after`, forms, values and blocks are `lint -format` fixed points |
| Corpus config statistics and unknown options under the validator rules | `f601probe/corpus.test.ts`, `f601probe/corpus.txt` | 1.4 |
| Selector pattern shapes | `f601probe/selectors.test.ts`, `f601probe/selectors.txt` | 1,027 `withName`, 227 with `:`, 0 invalid in JavaScript |
| Process-use index and matching prototype (fixture, sarek, rnaseq) | `f601probe/uses.test.ts`, `f601probe/uses.txt` | fixture counts equal the run; sarek 332 uses, 22 ms |
| Current engine diagnostics on the drafts | `f601probe/diag.test.ts`, `f601probe/diag.txt` | all `modelled`, 0 diagnostics |
| Upstream v26.10.7 sources | `upstream601/ConfigValidator.groovy`, `ConfigSelectorResolver.groovy`, `Session.groovy`, `ScriptMeta.groovy` | line references in 1.3 |
| Live docs anchors | `docsprobe/*.html` | 1.5 |
| `ConfigFormattingVisitor` (nf-lang v26.10.7) | `f106/nf/src/modules/nf-lang/src/main/java/nextflow/config/formatter/ConfigFormattingVisitor.java` | 188 lines to port |
| v26.10.7 docs | `f106/nf/src/docs/config.mdx`, `reference/config/*.mdx`, `reference/process/directives/*.mdx`, `reference/stdlib-types/{memory-unit,duration}.mdx` | 1.5, 2.4 |

**Files read for the design (`origin/main` `d195424`):**
- `packages/lang-core/src/{ast/config.ts, ast/range.ts, ast/unparsed.ts, ast/parse-result.ts, catalogue.ts, edit.ts, printer.ts, source-file.ts, lint.ts, index.ts}`;
- `packages/lang-2610/src/{index.ts, catalogue.ts, printer/index.ts, lints/{names,scan,codes}.ts}` and `catalogue/config.json`;
- `packages/engine/src/{edit/{apply,guards,splice,nodes,refusal}.ts, edit/commands/replace-file-text.ts, model/{file-model,project}.ts, service/{service,types}.ts, source/{language,print}.ts, history/labels.ts}`;
- `apps/web/src/{canvas/canvas-store.ts, views/*, code/{code-pane,models}.tsx, details/*, shell/{tab-strip,left-column}.tsx, app-shell.tsx, main.tsx}`;
- `e2e/{canvas,code-view,history,projects}.ts`;
- `tools/oracle/{README.md, cases/cases.yaml, cases/config-constructs/*}`;
- `scripts/{check-hosts,non-fetched-urls}.ts`;
- `.dependency-cruiser.cjs`, `vitest.corpus.config.ts`.

My scratch worktree of `origin/main` has been removed. The probe directories above remain.
