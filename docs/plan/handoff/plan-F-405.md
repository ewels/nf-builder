# Plan: F-405, imported legacy pipelines show typed badges only on typed code, suggestion counts and the share of each workflow that is modelled

Written by the planner on 2026-11-28 from `origin/main` at `0f6e1d3` (F-401, F-210, F-503 merged; the local checkout was at `beb703e`, so I read an export of `origin/main`). I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**Step:** "Import nf-core/rnaseq: nf-core processes carry no typed badge; status bar shows suggestions; workflow summary shows % modelled".

**In scope:**
- **Modelled share in the workflow summary** (ADR 0004 consequence; F-206 note): `workflowSummary` gains the statement counts from `projectionCoverage`, and the summary shows them with a percentage.
- **Suggestion count per workflow** (F-112 note "count LA-35 suggestions per workflow"): the summary says how many suggestions lie inside the open workflow and links to the Suggestions tab.
- **Registry modules in the Suggestions tab** (F-112 note "vendored registry modules aren't excluded from LA-35 in v0.1, so group or filter them here"): file groups under registry module folders are marked and listed after the project's own files (open point 3 chooses group over filter).
- **Evidence for the badge and the status bar** on a real import of nf-core/rnaseq at the corpus pin. Both behaviours already exist (F-205's `badge`, F-309's status bar); F-405 proves them on an imported legacy pipeline.

**Out of scope:**
- "Migrate to typed" (LA-35's parenthesis, UX-45): F-306.
- Changing what LA-35 reports, or its severity; changing the import report (F-401, ADR 0057).
- Treating `subworkflows/nf-core/**` as registry folders (ADR 0055's rule finds `modules/` only; open point 4).
- Live GitHub (ADR 0057: CI mocks GitHub).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-23:** "Typed processes and workflows carry a small `typed` badge on the top edge. No badge means legacy syntax (ADR 0007)." ADR 0007: typed registry modules carry the badge too.
- **LA-35:** "Legacy process or workflow (offer 'Migrate to typed' when available)", severity suggestion.
- **ADR 0004**, Consequences: "Some imported workflows will be partly code nodes. The workflow summary shows how much is modelled." It doesn't define "how much" (statements? nodes?) or the rounding.
- **UX-31** lists the summary as "take, emit, calls, registry modules used" (ADR 0049). Adding a modelled share and a suggestion count changes UX-31: spec edit plus an ADR amending ADR 0049.
- **ADR 0054:** diagnostics are pulled per revision into a read-only page copy; Suggestions tab groups rows by file in path order, "no collapsing"; status bar "Suggestions" counts every suggestion. Grouping registry files differently amends this ordering rule.
- **ADR 0055:** registry folders are found with the pack's include rules; `local` is never a registry module. `subworkflows/nf-core/*` has no `modules` segment, so it is never a registry folder.
- **ADR 0057:** the e2e tests mock GitHub with `page.route`; the import report already gives legacy share and the suggestion total.

### 1.2 Code on main
- **Badge:** `packages/engine/src/canvas/view.ts` sets `badge = "typed"` only when `node.kind === "call" && node.callee.typed === true`; `apps/web/src/canvas/canvas-nodes.tsx` renders `.canvas-badge`. F-205's e2e covers typed and legacy on the f205 fixture. No change needed.
- **Status bar:** `apps/web/src/shell/status-bar.tsx` shows `counts.suggestions` from `problemsStore` (`problemSections` in `packages/engine/src/problems/sections.ts`). No change needed for the count.
- **Coverage:** `projectionCoverage(p)` in `packages/engine/src/projection/coverage.ts` returns `{statements, modelled}` (a statement is modelled when it produced no code node). Exported from the engine.
- **Summary:** `workflowSummary(projection)` in `packages/engine/src/details/summary.ts` (types in `details/types.ts`, `WorkflowSummary`); rendered by `apps/web/src/details/workflow-summary.tsx` through `DetailsBody` in `details-pane.tsx`, which already has `onShowProblems(first)` wired to `problemsStore.show`.
- **Per-workflow attribution:** `problemTarget(d, workflows)` in `packages/engine/src/problems/target.ts` and `rangeContains` (`details/node-range.ts`) give "inside this workflow". `Projection.workflow` is a `WorkflowRef` with `path`, `name` and `range`.
- **LA-35 rules:** `packages/lang-2610/src/lints/legacy.ts` (`legacy-process` at the process name, `legacy-workflow` at the name or the `workflow` keyword). Both lie inside their declaration's range.
- **Registry folders:** `registryFolders(paths, includes, tree)` in `packages/engine/src/files/registry.ts`, served only through `EngineApi.listFiles()` (pulled while the Files view is visible). `EngineApi.diagnostics()` returns `{revision, diagnostics}`.
- **Problems panel:** `apps/web/src/problems/problems-panel.tsx` renders `sections[view]` groups as `<section class="problems-group">` headed by path and count.
- **e2e:** `e2e/github-mock.ts` has `repoFromFiles(repo, sha, files)` and `fetchngsRepo()`; `e2e/github-import.ts` has `importFromGithub`, `reportDialog`; `e2e/zips.ts` has `corpusDir`, `pinnedSha`; `e2e/canvas.ts` has `openWorkflow`, `canvasReady`, `node`, `clickEmptyCanvas`; `e2e/details.ts` has `projectionOf`, `detailsPane`, `detailsSection`; `e2e/problems.ts` has `statusCount`, `problemsPanel`, `engineDiagnostics`.

### 1.3 Corpus evidence (nf-core/rnaseq 3.28.0, `f24c6c0`)
- 900 files, 19 MB; 106 `.nf` files; none sets `nextflow.enable.types`. 79 processes (75 in `modules/nf-core/**`, 4 in `modules/local/**`), 29 workflows (19 in `subworkflows/nf-core/**`). 75 `meta.yml` under `modules/nf-core`, 19 under `subworkflows/nf-core`.
- So LA-35 alone gives at least 108 suggestions, 75 of them in registry module files and 19 in vendored nf-core subworkflows.
- Coverage from the committed snapshots (`packages/engine/test/corpus/snapshots/legacy-projection/rnaseq/`): entry `main.nf#` 3 of 3; `main.nf#NFCORE_RNASEQ` 5 of 6; `workflows/rnaseq/main.nf#RNASEQ` 165 of 184 (89.7%); `PIPELINE_INITIALISATION` 0 of 16; `PIPELINE_COMPLETION` 4 of 10. Every rnaseq workflow is `legacy`.
- The corpus directory has no `.git`; only fetchngs has a committed tree fixture (`packages/sources/test/fixtures/github/`).
- Largest file `docs/images/nfcore-rnaseq_logo.ai` (> 900 KB, binary): skipped by F-401's binary rule. All within IO-12's limits.

## 2. Design

### 2.1 Modelled share (engine, pure)
- `WorkflowSummary.coverage: {statements: number; modelled: number; percent: number | null}`. `percent` is `Math.floor(100 * modelled / statements)`, so a workflow shows 100% only when every statement is modelled; `null` when there are no statements (open point 1).
- `workflowSummary` fills it from `projectionCoverage(projection)`; `modelledShare(c)` is exported for the corpus test and the import report later.
- Web: a "Modelled" section after the kind line, text `165 of 184 statements (89%)`, `All 3 statements (100%)` when equal, `No statements` when zero. British English, sentence case. `data-coverage` attribute carries `modelled/statements` for tests.

### 2.2 Suggestions per workflow (engine pure, web display)
- `workflowSuggestions(workflow: WorkflowRef, diagnostics: readonly Diagnostic[]): readonly Diagnostic[]`: suggestions with `d.path === workflow.path` and `rangeContains(workflow.range, d.range)`, in source order (`compareDiagnostics`). Counts the workflow's own LA-35 and LA-36 findings; it does not count the LA-35 findings of the components it calls (open point 2).
- `DetailsBody` reads `problemsStore` diagnostics (it already imports the store) and passes them to `WorkflowSummaryView` as a prop. The summary shows a "Suggestions" section: `2 suggestions in this workflow` with a "Show suggestions" button calling `onShowProblems(first)`; `No suggestions in this workflow`; while diagnostics are loading or failed, the section says `Checking…` or nothing (follow the status-bar copy of ADR 0054).
- Summary stays pure: `workflowSummary(projection)` is unchanged in signature; the suggestion list is computed beside it so the F-206 corpus test needs no diagnoser.

### 2.3 Registry modules in the Suggestions tab
- `DiagnosticsResult` gains `registry: readonly RegistryFolder[]` (worker: the same `registryFolders` call `listFiles` makes). Additive field on a worker message, not a stored or exported format.
- `problemSections(list, registry = [])`: each `ProblemGroup` gains `module: string | null` (the registry reference of the folder holding the file). Within each tab, groups with `module === null` come first in path order, then registry groups in path order. Counts unchanged (status bar still counts every suggestion; open point 3).
- Panel: a registry group's heading shows a `registry` tag (same style as the Files view tag) and the first registry group is preceded by a sub-heading "Registry modules (N suggestions)". Keyboard order follows the new order. No collapsing (ADR 0054 kept).
- Problems tab uses the same ordering (errors in registry files are rare; open point 3).

### 2.4 Evidence harness (e2e)
- `corpusRepo(id, repo, ref)` in `e2e/github-mock.ts`: walks `corpusDir(id)` and returns `repoFromFiles(repo, pinnedSha(id), files)` with `refs[ref]` set. No tree fixture is committed (open point 5).
- Import through the GitHub route (`importFromGithub(page, "nf-core/rnaseq", "3.28.0")`), close the report dialog, then assert on the opened project.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/details/suggestions.ts` | `workflowSuggestions(workflow: WorkflowRef, diagnostics: readonly Diagnostic[]): readonly Diagnostic[]` |
| `packages/engine/test/details/coverage-summary.test.ts`, `suggestions.test.ts` | section 4 |
| `packages/engine/test/problems/registry-groups.test.ts` | section 4 |
| `packages/engine/test/corpus/legacy-import.corpus.ts` | section 4 (runs in `pnpm test:corpus`) |
| (web tests extend `apps/web/test/details-pane.test.tsx`, `problems-panel.test.tsx` and `problems-store.test.ts`) | section 4 |
| `e2e/legacy-import.spec.ts` | section 4 |

### 3.2 Change
- **`packages/engine/src/details/types.ts`:** `SummaryCoverage {statements: number; modelled: number; percent: number | null}`; `WorkflowSummary.coverage: SummaryCoverage`.
- **`packages/engine/src/projection/coverage.ts`:** `modelledShare(c: {statements: number; modelled: number}): SummaryCoverage`.
- **`packages/engine/src/details/summary.ts`:** fill `coverage`.
- **`packages/engine/src/problems/types.ts`:** `ProblemGroup.module: string | null`.
- **`packages/engine/src/problems/sections.ts`:** `problemSections(list: readonly Diagnostic[], registry?: readonly RegistryFolder[]): ProblemSections`; `registryModuleOf(path: string, registry: readonly RegistryFolder[]): string | null`.
- **`packages/engine/src/service/types.ts`:** `DiagnosticsResult.registry: readonly RegistryFolder[]`.
- **`packages/engine/src/service/service.ts`:** `diagnostics` adds `registry` (pack lookup as in `listFiles`; empty without a pack).
- **`packages/engine/src/index.ts`:** export `workflowSuggestions`, `modelledShare`, `SummaryCoverage`, `registryModuleOf`.
- **`apps/web/src/problems/problems-store.ts`:** keep `registry` from the pull; pass it to `problemSections`.
- **`apps/web/src/problems/problems-panel.tsx`, `problems.css`:** registry tag and sub-heading.
- **`apps/web/src/details/workflow-summary.tsx`, `details-pane.tsx`, `details.css`:** Modelled and Suggestions sections; `WorkflowSummaryView` props gain `suggestions: readonly Diagnostic[] | null` and `onShowSuggestions?: (first: Diagnostic) => void`.
- **`e2e/github-mock.ts`:** `corpusRepo(id: string, repo: string, ref: string): MockRepo`.
- **`e2e/details.spec.ts`:** F-206 step 2 test gains an assertion on the Modelled section of the fixture (strengthens, doesn't weaken).
- **Docs:** UX-31 text (modelled share and suggestion count); ADR 0054's grouping sentence via the new ADR; `docs/plan/features.json` notes on F-405.
- **Baselines:** `details-entry-summary` will change (two new sections): re-approve from CI (ADR 0021). Problems-panel baselines shouldn't change (the f309 fixture has no registry folders).
- **Unchanged:** IndexedDB and sidecar formats, export, workflows, dependency-cruiser rules, runtime dependencies, AGENTS.md command table.

## 4. Tests (write first)

### 4.1 Engine unit (`pnpm --filter @nf-builder/engine test`)
- `test/details/coverage-summary.test.ts`
  - "F-405 ADR-0004: workflowSummary reports the statements and the modelled ones from projectionCoverage": the f107 legacy oracle case projection (7 statements, 5 modelled, as in `coverage.test.ts`) gives `{statements: 7, modelled: 5, percent: 71}`.
  - "F-405 ADR-0004: the percentage rounds down, so only a fully modelled workflow shows 100": `modelledShare({statements: 200, modelled: 199}).percent === 99`; `{3, 3}` gives 100; `{16, 0}` gives 0.
  - "F-405 ADR-0004: a workflow with no statements has no percentage": `{0, 0}` gives `percent: null`.
- `test/details/suggestions.test.ts`
  - "F-405 LA-35: workflowSuggestions counts the suggestions inside the workflow, not in other workflows of the file or in other files": two-workflow fixture (`f309-problems` or the pack's LA-35 fixture) with diagnostics from the diagnoser; legacy-workflow inside counts, a legacy-process in the same file outside the workflow doesn't, warnings don't.
  - "F-405 LA-35: an entry workflow's legacy-workflow suggestion at the `workflow` keyword is inside it".
- `test/problems/registry-groups.test.ts`
  - "F-405 LA-35: registry module files sort after the project's own files in both tabs and carry their module reference": synthetic diagnostics on `main.nf`, `modules/local/a/main.nf`, `modules/nf-core/fastqc/main.nf` with a registry list; groups ordered local first; `module` is `nf-core/fastqc` only on the last.
  - "F-405 UX-03: counts are unchanged by grouping": `counts` equal `problemSections(list).counts`.
  - "F-309: with no registry list the order is path order as before" (guards ADR 0054's behaviour).
- `test/service/service.test.ts` (extend): "F-405: diagnostics() returns the registry folders of the open project" on the f206 fixture (`nf-core/wordcount`).

### 4.2 Corpus (`pnpm test:corpus`, CI `corpus-parse`)
- `test/corpus/legacy-import.corpus.ts`
  - "F-405 UX-23 ADR-0007: no node of any rnaseq workflow carries the typed badge, and at least one nf-core module call is modelled and legacy": for every `projector.workflows()` of rnaseq, `canvasView(...).nodes.every(n => n.badge === null)`; some call node has `callee.module` starting `nf-core/` with `callee.typed === false` and `status === "modelled"`.
  - "F-405 UX-23: rnaseq-nf-typed's typed calls carry the badge" (positive control on the typed pin).
  - "F-405 LA-35: rnaseq has one legacy-process suggestion per process and one legacy-workflow per workflow, and 75 of the legacy-process ones are in registry module files": counts from the diagnoser grouped with `registryFolders`.
  - "F-405 ADR-0004: every rnaseq workflow summary's coverage equals the snapshot header": `workflowSummary(p).coverage` matches `statements N, modelled M` in the committed snapshot file.

### 4.3 Web unit (`pnpm --filter @nf-builder/web test`)
- "F-405 ADR-0004 UX-31: the summary shows 'N of M statements (P%)', 'All N statements (100%)' and 'No statements'".
- "F-405 LA-35: the summary shows the workflow's suggestion count and Show suggestions calls back with the first one; it shows none while diagnostics load".
- "F-405 LA-35: the Suggestions tab marks registry groups with a `registry` tag after a 'Registry modules' heading" (panel render with a fake store).

### 4.4 End-to-end (`pnpm test:e2e -- --grep F-405`, Chromium only, needs the corpus)
`e2e/legacy-import.spec.ts`, one import per test file (`test.describe.configure({mode: "serial"})` with a shared page, or one test with `test.step`s; builder's choice, keep under the default timeout plus a raised import timeout):
- "F-405 step 1 UX-23 ADR-0007: after importing nf-core/rnaseq, nf-core process calls carry no typed badge": open `workflows/rnaseq/main.nf#RNASEQ`; from `projectionOf` pick call nodes with `callee.module` `nf-core/*`; at least 10; each `node(page, id)` is visible after `canvasReady` and has no `.canvas-badge`, and its `aria-label` lacks `typed`; the whole canvas has zero `.canvas-badge`.
- "F-405 step 1 UX-03 LA-35: the status bar counts the import's suggestions": `statusCount(page, "suggestions")` equals the number of `severity === "suggestion"` in `engineDiagnostics(page)`, equals the import report's suggestion figure, and is at least 108 (79 processes plus 29 workflows); the Suggestions tab lists the `modules/nf-core/**` groups after the own files under "Registry modules".
- "F-405 step 1 ADR-0004 UX-31: the workflow summary shows how much of each workflow is modelled": click empty canvas on `RNASEQ`: the Modelled section reads `M of N statements (P%)` with N, M from the engine projection's `statements` (expected 184 and 165 at this pin) and P < 100; the entry workflow reads `All 3 statements (100%)`; the Suggestions section shows the count from `workflowSuggestions`.
- "F-405: importing rnaseq triggers no CSP violation" (reuse `watchForCspViolations`).

## 5. Tasks

Branch `feat/F-405`. Run `pnpm format` and `pnpm check` before every commit. Settle section 6 first.

1. **Coverage in the summary (engine).** `SummaryCoverage`, `modelledShare`, `workflowSummary.coverage`; tests 4.1 coverage.
   - Done: `pnpm --filter @nf-builder/engine test` and `pnpm check`.
2. **Suggestions per workflow (engine).** `workflowSuggestions`; tests 4.1 suggestions.
   - Done: `pnpm --filter @nf-builder/engine test` and `pnpm check`.
3. **Registry groups (engine and service).** `ProblemGroup.module`, `problemSections(list, registry)`, `registryModuleOf`, `DiagnosticsResult.registry`; tests 4.1 registry and service.
   - Done: `pnpm --filter @nf-builder/engine test` and `pnpm check`.
4. **Corpus test.** `legacy-import.corpus.ts`.
   - Done: `pnpm corpus:fetch && pnpm corpus:lint && pnpm test:corpus` passes (or the CI `corpus-parse` job), plus `pnpm check`.
5. **Details pane UI.** Modelled and Suggestions sections; web unit tests; F-206 e2e assertion.
   - Done: `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm test:e2e -- --grep F-206` (the `details-entry-summary` @visual failure is expected; re-approve from CI only).
6. **Problems panel UI.** Store keeps `registry`; panel tag and heading; web unit test.
   - Done: `pnpm --filter @nf-builder/web test`, `pnpm check`, `pnpm test:e2e -- --grep F-309` with no baseline change.
7. **End-to-end.** `corpusRepo` and `e2e/legacy-import.spec.ts`.
   - Done: `pnpm test:e2e -- --grep F-405` (with `PW_CHROMIUM_EXECUTABLE` in the sandbox), `pnpm test:e2e -- --grep F-401`, `pnpm smoke` under 60 s.
8. **Records** (section 7). Done: `pnpm check` (ADR lint, `features.json` validation).

## 6. Open points (none decided here)

1. **What "% modelled" measures and how it rounds.** ADR 0004 says only "how much is modelled". F-107 defined the share as main statements without a code node (`projectionCoverage`).
   - **Recommend:** statements, as F-107 and the corpus report do; show counts and a percentage rounded down; "No statements" for an empty workflow. **Alternative:** nodes (code nodes over all nodes), which disagrees with the F-107 report.
2. **What "suggestion counts" per workflow counts.** The F-112 note says "LA-35 suggestions per workflow"; for RNASEQ its own LA-35 finding is one, while the legacy components it calls carry about 40.
   - **Recommend:** suggestions inside the workflow's own range (all suggestion codes, LA-35 and LA-36), with a link to the Suggestions tab. **Alternative:** also "N of M calls are legacy" from callee `typed === false` (cheap, pure, and helps screen-reader users who can't see badge absence); add it only if the maintainer-proxy wants it.
3. **Group or filter vendored registry modules** (F-112 note). Filtering would make the status bar disagree with LA-35 and the import report.
   - **Recommend:** group: keep every count, list registry files after own files under a "Registry modules" heading with a `registry` tag. Amends ADR 0054's "grouped by file in path order" (decide and record; spec change to UX-03 wording optional). **Alternative:** a "Hide registry modules" toggle (session-only), deferred.
4. **Vendored nf-core subworkflows** (`subworkflows/nf-core/**`, 19 LA-35 findings in rnaseq) aren't registry folders under ADR 0055. Spec gap: AR-03 and UX-14 talk of registry modules only.
   - **Recommend:** leave them with the project's own files in F-405; add a note to F-504 (or whichever feature covers registry subworkflows) rather than widen ADR 0055 here.
5. **Evidence route and fixture.** "Import nf-core/rnaseq" names no route. A real tree fixture like fetchngs's would add ~350 KB of JSON.
   - **Recommend:** GitHub route, mocked, with the tree synthesised from the corpus files by `repoFromFiles` (F-401 already proved tree fidelity). **Alternative:** zip route via `gitArchiveZip` (faster, one request), or commit a git-generated tree fixture.
6. **`DiagnosticsResult.registry`** changes the worker API (ADR 0043's list, ADR 0054's pull). Not a stored or exported format.
   - **Recommend:** accept as an additive field, recorded in the F-405 ADR. **Alternative:** a separate `registryFolders()` call (one more round trip per revision).
7. **UX-31 text.** Adding two summary sections changes user-visible behaviour in the spec.
   - **Recommend:** amend UX-31 ("…registry modules used, the share of statements modelled and the number of suggestions in the workflow") and ADR 0049 through the new ADR.
8. **Visual baseline.** `details-entry-summary` changes. **Recommend:** re-approve from CI (ADR 0021) and say so in the PR.
9. **Summary while diagnostics are stale** (an edit after the pull). **Recommend:** show the count only when `problemsStore.revision` equals the projection's revision, else "Checking for suggestions…".

**AGENTS.md decide-and-record items:**
- **Spec or ADR changes:** UX-31 (point 7), ADR 0054's group order (point 3), ADR 0043/0054's diagnostics result (point 6), ADR 0049's summary contents.
- **`features.json`:** notes only (F-405 verification; a note for point 4). No new feature unless point 2's alternative is split out.
- **None:** runtime dependencies, package boundaries or dependency-cruiser rules, stored or exported formats, workflows, open questions in `docs/plan/open-questions.md` (none cited).

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number at landing (0059 may go to F-301): "Show the modelled share and suggestion count in the workflow summary, and group registry modules in the Suggestions tab". Covers points 1 to 3, 6, 7 and 9; amends ADR 0049 (summary contents), ADR 0054 (group order, `DiagnosticsResult.registry`). Row in `docs/adr/README.md`.
- **Spec:** UX-31 amended; UX-03 optionally gains "registry module files are listed after the project's own".
- **`features.json` F-405 notes:** "Verified <date>: step 1 by `e2e/legacy-import.spec.ts` (nf-core/rnaseq 3.28.0 through the mocked GitHub route: no `.canvas-badge` on the RNASEQ canvas, nf-core calls legacy; status-bar suggestions equal the engine's and the report's; RNASEQ summary 165 of 184 statements) and `packages/engine/test/corpus/legacy-import.corpus.ts`. ADR 00xx." Plus a note on F-504 for point 4.
- **`progress.md`:** entry with the ADR, UX-31 change and baseline re-approval under Decisions.
- **Handoff README:** delete this plan in the PR that merges F-405.

## 8. Evidence

- Feature and notes: `docs/plan/features.json` (F-405; F-112 and F-206 notes addressed to it).
- Spec: `docs/spec/ux.md` UX-23, UX-31; `docs/spec/language.md` LA-35; ADRs 0004, 0007, 0049, 0054, 0055, 0057.
- Corpus counts: `.cache/corpus/rnaseq` (pin `f24c6c0e9469d04975d87c3a8bf9020800978782`), grep of `^process ` and `^workflow` and `meta.yml`; coverage from `packages/engine/test/corpus/snapshots/legacy-projection/rnaseq/*.txt` headers.
- No Nextflow syntax is written by this feature, so no oracle case is needed.
