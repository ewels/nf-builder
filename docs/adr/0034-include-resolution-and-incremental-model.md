# 0034. Resolve includes as nf-lang 26.10 does, and re-model a changed file and its direct dependants

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

AR-03 asks the semantic model to resolve includes across files and declarations by name, with registry modules resolving to `modules/<namespace>/<name>/`. AR-04 asks that a change re-parses one file and recomputes the model for the files that depend on it. Include resolution changed in recent Nextflow releases (registry modules with nested vendoring, pipeline includes of `workflow` and `params`), and ADR 0006 and LA-02 keep version-specific behaviour in the pack. `nextflow lint` 26.10.7 aborts or tries to download instead of reporting some registry problems (`docs/research/upstream-bugs.md` 12, 13, 15). Research: the [F-105 plan](https://github.com/ewels/nf-builder/blob/39670fb/docs/plan/handoff/plan-F-105.md).

## Decision

- **Rules in the pack.** `LanguagePack.includes: IncludeRules` (lang-core types, lang-2610 implementation in `src/includes/`, pure and on the pack entry, a few hundred bytes) ports nf-lang 26.10.7: local sources resolve against the including file (a directory gives its `main.nf`, otherwise `.nf` is appended unless present); other sources are registry references, matching upstream's `ModuleReference` pattern, resolving to `modules/<scope>/<name>/main.nf` under the project root or, for a script under a `modules/` directory, under that directory (nested vendoring), with `meta.yml` required beside it; `plugin/` sources are plugins; constant `includeConfig` sources resolve against the including file with no extension added, and a directory counts as missing; expressions and URLs are external and unchecked, as upstream.
- **AR-03 clarification:** registry modules resolve under the project root, or under the including script's directory when that lies in a `modules/` directory.
- **Entries** bind to the target's declarations in nf-lang's order (workflows, processes, agents, functions, records and enums; the entry workflow as `workflow`, the params block as `params`). `Unparsed` declarations bind by their head, so partial targets still offer their names (ADR 0004).
- **"Module could not be parsed"** exactly when the target's grammar fails. Errors the AST builder reports, including those its reparse of an invalid declaration finds, are builder errors and don't stop resolution, as upstream.
- **Diagnostics:** a minimal `Diagnostic` (path, range, severity, message, code) in lang-core, with codes `include-target`, `include-not-parsed` and `include-name`, nf-lang's wording at the include node, project-relative paths. Where lint aborts or downloads instead (a registry module that isn't present or lacks `meta.yml`, an invalid reference), our own message names the missing path or gives upstream's reference message.
- **Incremental model:** `ProjectModel` (engine) re-parses only the changed file and re-models it and the files whose includes resolved to it. Nextflow has no re-exports, so dependants of dependants are untouched. Creating or deleting a file also re-models the files whose resolution looked for that path, or for a directory whose existence changed. Unchanged files keep their model objects. A `trace` hook counts parse and model work.
- **Left to F-112:** pipeline-include typing errors, alias rules, duplicate names and config include placement.
- The model is in memory only; it is not a stored or exported format.

## Consequences

- Every include in the pinned corpus resolves with no diagnostics, as lint reports none; deleting a target gives each includer a diagnostic naming the path.
- A new Nextflow version can change the rules in its own pack without touching the engine.
- F-106 can look up a call's declaration through `ProjectModel.lookup`, and F-113 can drive re-modelling from file events.

## Alternatives

- Rules in the engine: simpler wiring, but puts 26.10's registry and pipeline-include semantics outside the pack.
- Transitive dependants: simpler to state, but re-models files whose inputs didn't change.
- Treating any parser-sourced problem as "could not be parsed": diverges from lint on targets with builder-only errors.
