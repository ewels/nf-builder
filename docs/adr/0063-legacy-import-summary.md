# 0063. Show the modelled share and suggestion count in the workflow summary, and group registry module files in the problems panel

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

F-405 asks that an imported legacy pipeline (nf-core/rnaseq) shows typed badges only on typed code, counts its suggestions, and shows the share of each workflow that is modelled. The badge (UX-23, ADR 0007) and the status bar count (UX-03, ADR 0054) already existed; F-405 proves them on a real import.

ADR 0004 says "The workflow summary shows how much is modelled" without saying what is counted or how it rounds. F-107 defined coverage as main statements that produced no code node (`projectionCoverage`). UX-31 lists the summary's contents as take, emit, calls and registry modules used (ADR 0049). The F-112 note asks for LA-35 suggestions counted per workflow, and for vendored registry modules to be grouped or filtered, since LA-35 doesn't exclude them in v0.1: rnaseq 3.28.0 has 79 processes and 29 workflows, all legacy, so LA-35 alone gives at least 108 suggestions, 75 of them in `modules/nf-core/**`.

ADR 0054 pulls diagnostics per revision and groups problems panel rows by file in path order. ADR 0055 finds registry folders with the pack's include rules; `subworkflows/nf-core/**` has no `modules` segment, so it is never a registry folder. ADR 0057 mocks GitHub in the end-to-end tests.

rnaseq includes its nf-core modules by relative path (`include { X } from '../../modules/nf-core/x/main'`), so a call's `callee.module`, which ADR 0049's summary used for "registry modules used", is null for every one of them.

Research: the F-405 plan (deleted in the PR that merged F-405; settled in `docs/plan/handoff/README.md`, "F-405").

## Decision

- **Modelled share** (ADR 0004's "how much"). `WorkflowSummary.coverage` is `{statements, modelled, percent}` from `projectionCoverage`: statements, as F-107 and the corpus report count them. `percent` is `Math.floor(100 * modelled / statements)`, so only a fully modelled workflow shows 100%, and is `null` with no statements. The summary's "Modelled" section reads "165 of 184 statements (89%)", "All 3 statements (100%)" when every statement is modelled, or "No statements".
- **Suggestions per workflow.** `workflowSuggestions(workflow, diagnostics)` returns the suggestions whose range lies inside the workflow's own range in its file, in source order: every suggestion code (LA-35, LA-36), but not the findings of the components it calls. The summary's "Suggestions" section reads "N suggestions in this workflow" with a "Show suggestions" button that opens the Suggestions tab at the first one, or "No suggestions in this workflow". It shows a count only when the pulled diagnostics' revision equals the projection's; otherwise it reads "Checking for suggestions…". When the diagnostics pull failed, the section is left out. `workflowSummary(projection)` stays pure; the suggestion list is computed beside it.
- **Registry module files in the problems panel** (amends ADR 0054's file order). `problemSections(list, registry)` gives each file group the registry reference of the innermost registry folder holding the file (`registryModuleOf`), or null for the project's own files. In both tabs the project's own files come first in path order, then registry module files in path order, under a "Registry modules (N suggestions)" heading (or "problems" on the Problems tab), each with a `registry` tag. Counts don't change: the status bar still counts every suggestion, so it agrees with LA-35 and the import report. Group, not filter; there is still no collapsing.
- **`DiagnosticsResult.registry`** (amends the worker API of ADRs 0043 and 0054). `EngineApi.diagnostics()` also returns the project's registry folders, from the same `registryFolders` call `listFiles` makes, so the page needs no second round trip. It is a worker message field, not a stored or exported format.
- **"Registry modules used" in the summary** (amends ADR 0049's summary contents). A call's registry module is the registry folder holding its callee's file, by ADR 0055's rule (`registryModuleOf(callee.path, registry)`), the same rule the problems panel uses, instead of `callee.module`. So modules included by relative path, as nf-core pipelines do, are listed. `workflowSummary(projection, registry = [])` takes the folders from the problems store.
- **Vendored nf-core subworkflows** (`subworkflows/nf-core/**`) stay with the project's own files, since ADR 0055 doesn't treat them as registry folders. Registry subworkflows are left to F-504; ADR 0055 is not widened here.
- **Evidence route.** The end-to-end test imports nf-core/rnaseq 3.28.0 through the mocked GitHub route, with the tree synthesised from the pinned corpus files by `repoFromFiles` (F-401 proved tree fidelity), so no tree fixture is committed.

## Consequences

- UX-31 now lists the modelled share and the suggestion count; UX-03 says registry module files are listed after the project's own.
- On rnaseq, the RNASEQ summary reads "165 of 184 statements (89%)" and lists the nf-core modules it calls; the 75 registry module files' suggestions sit together at the end of the Suggestions tab.
- The 19 vendored nf-core subworkflows' LA-35 findings stay among the project's own files until registry subworkflows are recognised (F-504).
- The per-workflow count leaves out the legacy components a workflow calls; the missing typed badge and the Suggestions tab show those. "N of M calls are legacy" was not added.
- No new runtime dependency, package boundary, or stored or exported format. The `details-entry-summary` and `read-only-phone` baselines were re-approved from CI (ADR 0021).

## Alternatives

- **Nodes instead of statements** for the share: would disagree with the F-107 corpus report.
- **Rounding to nearest:** a workflow with one code node among 200 statements would read 100%.
- **Counting the callees' suggestions too:** RNASEQ would show about 40 suggestions that belong to other files.
- **Filtering registry modules out of the Suggestions tab, or a "Hide registry modules" toggle:** the status bar would disagree with LA-35 and the import report; a toggle is deferred.
- **A separate `registryFolders()` call:** one more round trip per revision.
- **Keeping `callee.module` for the summary's registry list:** empty for every relative include, so rnaseq's summary would list no registry modules while the problems panel tags 75 files.
- **Treating `subworkflows/nf-core/**` as registry folders:** widens ADR 0055 beyond F-405; F-504 covers registry subworkflows.
- **Committing a GitHub tree fixture for rnaseq:** about 350 KB of JSON for what `repoFromFiles` builds from the corpus.
