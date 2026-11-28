# 0061. Edit nextflow.config through forms with statement-level commands, a ported config printer, Nextflow's run-time option check and its selector matching

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

FI-01 to FI-06 ask for a form editor for `nextflow.config`: a card per scope, first-class forms for the common scopes and generic typed forms for the rest, Add scope, option docs in the right pane, include links, selectors showing the processes they match, and unknown options kept and flagged. The files editor rule says forms and raw text both go through edit commands, so undo (AR-23, ADR 0051) and autosave behave as everywhere else.

Before F-601:
- The config AST (F-103) is syntactic: profiles, `params` and `env` are blocks, selectors keep their kind as written, `plugins` is an apply block. Nothing mapped it to the catalogue (`catalogue/config.json`).
- Config files opened in a code-only file tab through `openFile` (ADR 0054); `modesFor` gave each tab kind its modes (ADR 0059).
- Edit commands reprint whole declarations (ADR 0039), which suits scripts. Config files are flat lists of statements, and 189 of 228 corpus configs change under `nextflow lint -format`, so reprinting a whole `process` block would reformat nf-core's aligned blocks on every form edit.
- The printer (ADR 0032) ported nf-lang's script formatter only.
- `nextflow lint` 26.10.7 doesn't report unknown config options. Nextflow reports them at run time, in `ConfigValidator`, as "Unrecognized config option '…'".
- Nextflow applies selectors in `ConfigSelectorResolver`: a regular expression on the whole name, `!` negating, `withName` against the declared, alias and fully qualified names, `withLabel` against any label.
- Catalogue descriptions are Markdown, and some of their docs links point at pages that have moved.

Research: the F-601 plan (deleted in the F-601 PR; see `docs/plan/handoff/README.md`), its probes of the pinned Nextflow 26.10.7, and `docs/research/upstream-bugs.md` entries 25 and 26.

## Decision

- **Tabs and modes** (UX-27, UX-31). `openFile` opens a `.config` file in a config tab. The shared `modesFor` gives config tabs Form, Split and Code (beside F-605's Markdown modes), with G, S and C picking them; Form loads no Monaco. The entry workflow's summary has a "Configuration" link to the root `nextflow.config` when the project has one. Below 1024 px a config tab shows the F-703 note (ADR 0056).
- **The view through the worker** (amends ADR 0043's API list). `EngineApi.configView(path)` returns `{revision, view}`: the file's top-level statements grouped into scope cards, include rows and code rows, each option row with its full option path, classification, catalogue types, value kind, decoded value or a one-line code excerpt of at most 160 characters (AR-30), ranges and diagnostics. `EngineApi.configSchema(version)` returns the catalogue's scopes, the form layouts and the docs URLs once per session. The process-use index for selectors is memoised per revision.
- **Forms** (FI-02). The per-scope layout (`ConfigRules.forms`) lives in the pack, naming only catalogue options. Values are written as `8.GB`, `2.h`, single-quoted strings, `[…]` lists and `[key: value]` maps. Memory and duration strings are read and kept as written until edited. A non-literal value is read-only code with "Edit in code" and "Set a value". The form is read-only, behind a banner, while the file has parse problems, because writing around an unparsed chunk could duplicate a scope. Add scope, Add selector and Add profile write an empty block; Add option is a pending row until a value is committed. There is no block removal in v0.1; Code covers it.
- **Five config commands** (amends AR-21): `SetConfigOption`, `RemoveConfigOption`, `AddConfigBlock`, `AddConfigPlugin` and `RemoveConfigPlugin`. They address options and blocks by name, resolved at apply time, and each yields one `TextEdit` at statement level: a value replaced, a line inserted or lines removed. Only a one-line container is reprinted whole, with every attached comment kept, or the command is refused. This amends ADR 0039's reprint level for config files.
- **Placement.** The last occurrence of an option in the context is edited; otherwise the option goes into the last block for its scope path, then a block for a prefix with the rest of the path dotted, then beside a dotted assignment of the same scope; otherwise a new top-level block is appended at the end of the file, after any `includeConfig`, so the value the user sets takes effect (later statements win). In a profile, new options are dotted; selectors are always blocks. Inserted lines copy their sibling's indentation and the file's line endings.
- **Names.** New profile names and selector patterns are written bare only when they are identifiers that aren't config keywords or built-in type names, as `config.mdx` requires; otherwise they are single-quoted (`'gpu-test'`). Commands still refuse a new option, `params` or `env` name that isn't such an identifier, so a quoted option name only ever comes from the user's own code.
- **Config printer** (refines ADR 0032). `printConfig` and `printConfigStatement` are a port of nf-lang's `ConfigFormattingVisitor` with default options, on the existing `Formatter`. A corpus test checks parity with `nextflow lint -format` on every corpus config, apart from three listed known differences (rnaseq configs whose closures have typed parameters). Two deliberate deviations: the printer keeps a closure parameter's type (`{ String token -> token }`), which `lint -format` drops (upstream bug 25: lossy, but the result parses); and it keeps the quotes of a non-identifier option name, which `lint -format` drops (upstream bug 26: `ext.'a.b'` becomes the different option `ext.a.b`, and `ext.'my-key'` becomes `ext.my-key`, which no longer parses). No corpus config reaches the second. A corpus test checks that what the printer writes for every corpus config parses. ADR 0032's "what is formatted" becomes "new and edited config statements" for config files.
- **Unknown options** (amends FI-03). A pack lint rule, `config-unknown-option` (warning, origin ours), mirrors Nextflow 26.10.7's run-time `ConfigValidator`, and its message starts with Nextflow's text: "Unrecognized config option '…'". It walks profile contents as top level, drops selectors and `executor.$name`, and skips `params`, `env`, keys under Map-typed options and the validator's hidden options. Two choices are deliberate: an assignment of a map to a whole scope (`docker = [enabled: true]`) is skipped rather than checked; and a core plugin scope the catalogue lists (`wave` and others) is checked against the catalogue, although Nextflow skips those scopes unless the plugin is loaded. Plugin scopes the catalogue doesn't list are flagged until F-505 merges plugin specs into the classifier. The view and the rule share one classifier, so they can't disagree. Unknown rows are shown read-only and removed only by an explicit Remove.
- **Selector counts** (amends FI-06). Processes invoked from the entry workflow, through named workflows and aliases, are counted by distinct fully qualified name, matched exactly as `ConfigSelectorResolver` does. A pattern JavaScript can't compile shows "Can't evaluate this pattern". No diagnostic for unmatched selectors in v0.1.
- **Option docs** (FI-04). The right pane shows the full option name, the catalogue types, the description and "Open in Nextflow docs". The description goes through a minimal safe renderer for catalogue Markdown: paragraphs, inline code, emphasis, fenced code and `https` links only, with no HTML and no `innerHTML`. The docs link always resolves under `https://docs.seqera.io/nextflow/`, by URL rules in the pack checked against the live docs, falling back to the catalogue's link and then to the config reference.
- **Includes** (FI-05). Include rows link a file target, which opens in its own config tab; a missing target shows its diagnostic; a dynamic or URL target is "External source, not checked". Commands never touch `includeConfig` statements.
- **Tests.** The edit harness runs fixed examples for every config command kind (F-210's six choices plus the first accepted). The `config-form` and `config-details` baselines are approved from CI (ADR 0021).

## Consequences

- A form edit changes only the statement it touches, so nf-core's hand-aligned configs keep their layout, and each form change is one undo step.
- New statements print as `nextflow lint -format` would, proven on the corpus, except where its output is lossy or broken.
- Unknown options show as warnings in the editor and the problems panel before a run, with the text Nextflow prints at run time. Plugin scopes stay flagged until F-505.
- Selector counts match what Nextflow applies, including aliases and negation.
- Removing a whole block, unmatched-selector warnings and a separate config grammar for highlighting are left for later.

## Alternatives

- **Reprint the enclosing top-level statement (ADR 0039's script rule):** larger diffs that reformat aligned blocks on every edit.
- **Hand-written printing of the few line shapes needed:** nothing would prove that new statements match `lint -format` (ADR 0005).
- **Every add UI-only until a first value:** one fewer command, but hidden state.
- **Strings for memory and duration (`'8 GB'`):** valid, but need escaping and don't match nf-core or the mockup.
- **Edit in code only for expressions:** leaves 659 closure-valued corpus options unchangeable from the form.
- **Editable forms over parse problems:** writing around an unparsed chunk could duplicate a scope.
- **A UI-only unknown flag:** the problems panel and status bar would miss it, against "flagged as warnings".
- **Following `lint -format` on quoted option names:** writes a different option or a file that doesn't parse.
- **Loading the catalogue on the main thread:** pack code stays in the worker (F-113).
- **A separate `form` view mode:** more churn for the same behaviour.
- **New top-level blocks before trailing includes:** keeps nf-core's "modules.config last", but the form's value could be silently overridden.
