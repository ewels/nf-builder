# Hand-off plans (session 2)

Plans written by the planner agent on 2026-11-22 for features not yet merged, kept here so the next session can resume without re-planning. They are inputs, not decisions of record: the open points are settled below and still have to be recorded (ADR, `open-questions.md`, `progress.md`) when each feature lands. Delete a plan in the PR that merges its feature. Paths under `/tmp/...scratchpad...` in the plans pointed at session scratch files and may be gone; where it matters, the files were copied into the repo or the worktree.

## State on 2026-11-23 (end of session 2)

| Feature | Branch | State |
|---|---|---|
| F-102 script AST | merged, PR #23 | |
| F-103 config AST | merged, PR #24 | |
| F-104 round trip | merged, PR #26 | |
| F-110 printer | merged, PR #25 | |
| F-105 semantic model | merged, PR #30 | |
| F-106 typed projection | merged, PR #32 | Plan deleted in its PR. |
| F-107 legacy projection | merged, PR #36 | |
| F-108 code nodes | merged, PR #34 | |
| F-111 edit commands | merged, PR #38 | |
| F-112 diagnostics | merged, PR #40 | |
| F-113 engine worker | merged, PR #39 | |
| F-202 projects in IndexedDB | merged, PR #42 | |
| F-205 canvas | merged, PR #41 | |
| F-203 new project dialog | merged, PR #43 | |
| F-206 details pane | merged, PR #45 | |
| F-207 layout sidecar | merged, PR #49 | |
| F-208 view modes and Code | merged, PR #46 | |
| F-209 undo and redo | merged, PR #50 | |
| F-309 problems panel | merged, PR #52 | |
| F-403 zip import | merged, PR #51 | |
| F-502 registry client | merged, PR #48 | |
| Parser error position | merged, PR #47 | |
| F-501 registry snapshot | merged, PR #29; passing | Confirmed on live data after the snapshot-triggered Pages deploy. |
| F-011 GitHub Pages hosting | merged, PR #37 | Live at https://ewels.github.io/nf-builder/; first `verify` passed. |
| F-703 read-only below 1024 px | merged, PR #53 | Plan deleted in its PR. |
| F-401 GitHub import | merged, PR #55 | Plan deleted in its PR. |
| F-210 Files view | merged, PR #54 | Plan deleted in its PR. |
| F-503 registry palette | merged, PR #56 | Plan deleted in its PR. |

## Merge order

Branches are stacked: `feat/F-108` → `feat/F-107`; `feat/F-111` also merges F-107. Open PRs for F-108, F-107 and F-111 against `main` in that order (merge `main` into each first), each green before the next. Worktrees: `/home/user/wt-F-1xx`.

Next free ADR number: 0055 (0054 is F-309's).

## Decisions already taken on the plans' open points

### F-102 (merged)
- Conventions are ADR 0027 (on `feat/F-102`; flat ranges `{start, end, line, column, endLine, endColumn}`, nf-lang comment attachment, AR-02 amended).
- Report every ScriptAstBuilder error; `-1:-1` upstream errors at the real node; vendored nf-core/fastqc fixture module (MIT) allowed; oracle extended to lint the fixture and error trees (an AGENTS.md "Nextflow knowledge" line says the oracle reproduces `errors.json`); comment-dump oracle in `pnpm test:corpus`.
- Records at landing: `docs/licences.md` rows for the ported `ScriptAstBuilder`, `CommentAttacher`, `Comments`, `EscapeUtils`, Groovy `StringUtils`/`Numbers` logic, the syntax-reference snippets in fixtures (Apache-2.0) and the vendored fastqc module (MIT); notes from the plan's section 9.

### F-103 (merged with its PR)
- Reuses F-102's base types and expression/statement builders (the plan's tasks 1–2 are covered by F-102).
- Snapshots all 228 corpus configs (one line per statement); fixture configs are oracle cases; integer number-format errors ported; `parseConfig` off the pack entry.
- Records at landing: licences rows for ported `ConfigAstBuilder`, `EscapeUtils`, Groovy `Numbers` and the corpus-derived snapshots; AGENTS.md `pnpm test:corpus` row mentions `pnpm test:corpus config-ast -u`; F-112 notes for keyword checks, duplicate named arguments, decimal-number errors, selector placement and include resolution.

### F-104 (merged with its PR)
- Accept the plan's recommendations: a new ADR for `LanguagePack.loadParser()` (lazy, like ADR 0028's `loadCatalogue()`) replacing the synchronous parse methods in the architecture sketch; `Unparsed` joins the AST unions; the plan's isolation and verbatim rules; its reading of the glossary's "equivalent"; chunks parsed by slicing and shifting; `SourceFile` in memory only; `yaml` as a lang-2610 dev dependency and Node types for engine tests are fine.

### F-110 (merged with its PR)
- One new ADR listing the upstream formatter bugs as known differences (ADR 0005), `NO_RANGE` for new nodes (amending ADR 0027) and the blank-line layout for new declarations.
- Port legacy printing too; default formatter flags only; no pack loader in F-110 (the parser loader from F-104 or F-111 carries the printer); the plan's oracle extension; corpus parity in the `corpus-parse` job; reuse F-102's fixtures by path; statement-level printing left to F-111; no fast-check yet.
- Spec gap: also print feature flags, enums and agents if cheap; record what LA-45 formats.

### F-105 (merged with its PR)
- Accept every recommendation in section 6: rules in the pack (`LanguagePack.includes`, new ADR); minimal `Diagnostic` in lang-core; nf-lang wording, our own for registry cases lint can't report; upstream registry fidelity (nested vendoring, `meta.yml`) with the AR-03 clarification; dynamic `includeConfig` counted as external; partial targets bind what they can; direct dependants only; F-112 keeps the typing, alias and duplicate checks; two lint-only oracle cases; `yaml` as an engine dev dependency.
- Rebase the plan on F-104's names as built before task 2 (section 1.4 lists them).

### F-106 (merged with its PR)
- Accept every recommendation in section 6: types in lang-core, logic in the engine with catalogue data; the 2.5 node-key grammar in a new ADR (a stored format once F-207 writes `layout.json`); the 2.4 type subset with `plain` values; code-node shells until F-108; calls are processes, workflows, agents and pipelines (unparsed and unresolved marked by status); the plan's port names; a type-probe oracle tree; whitespace-only per F-104's `equivalent`; projector as a snapshot, F-113 owns invalidation; no Playwright test.
- Rebase sections 3 and 4 on F-104's and F-105's names as built (section 1.4 lists them).
- Amendment from the F-112 plan: ports carry `argumentType` (the inline argument's type) for LA-32 checks.
- Amendment from the F-107/F-108 plans: task 4 also creates `packages/engine/src/projection/scope.ts` (`lookup`, `bind`, `resolveRead`, multi-value bindings) and `Read.properties`, so F-107 and F-108 can run in parallel (plan-F-107.md section 1.5).

### F-107 (merged with its PR)
- Accept every recommendation in section 6. Step 2's 90% needs alias statements, call-result properties, callee aliases and transparent dataflow `if`s and ternaries as well as AR-14's four forms (74% without them): keep them in F-107, amend AR-14 and record it in the F-107 ADR. Legacy operator data in the pack (`LanguagePack.legacyOperators`). Commit all 119 corpus workflow snapshots with a licences row.

### F-108 (merged with its PR)
- Accept every recommendation in section 6: closure reads are code-node inputs; mutations are reads only; conditional writes replace the binding; no port for `params` as a whole; keys from the first output; a lint-only free-variable oracle tree. One ADR for the LA-27 readings.

### F-111 (merged with its PR)
- Accept every recommendation in section 6: declaration-level reprint for workflow commands, identifier edits for renames, item-boundary include inserts; the command model of 2.2 (plain data, ids resolved at apply time, patches with inverses, `commit` separate); AR-24 read as "no problem the file didn't have"; our own LA-13 check (lint accepts positional mixing, upstream-bugs #20) with `ParseProblem.code` tags; `null` placeholders for missing positional inputs; variable introduction names; Connect moves a later source when safe; DeleteNode clears direct arguments; CreateProcess writes `modules/local/<lower>/main.nf` from `LanguagePack.scaffold`; the rename limits; `fast-check` 4.11.0 as an engine dev dependency (ADR 0011). One ADR at landing.

### F-112 (merged with its PR)
- Accept the recommendations in section 6, except:
  - quick fixes carry text edits (`QuickFix { title, path, edits }`) and become F-111's `ReplaceFileText { path, text }` when applied (the plan's own fallback), so F-111's command shape is unchanged;
  - no new feature for full nf-lang name-resolution and type-check parity: the spec doesn't require it for v0.1, so the deferred checks (point 4's list) are recorded in F-112's notes and ADR.
- LA-33 amended: a missing argument is an error (nf-lang rejects it), an unused output a warning. LA-31 and a new LA-37 row as in point 7. `Port.argumentType` is added to F-106 (point 13).
- Rules behind a lazy `LanguagePack.loadLints()`, one ADR at landing.

### F-113 (merged with its PR)
- Accept every recommendation in section 6: Comlink 4.4.2 as a runtime dependency of `@nf-builder/web` (ADR 0003 names it); pack versions from a pack-free `version` export, palette through the worker; Comlink only in apps/web; the page throttled 4× with worker timings reported unthrottled (Chromium can't throttle workers), clarified in `quality.md`; F-113 reports QA-03 and QA-04, F-702 gates QA-03; diagnostics from `ProjectModel.diagnostics()` until F-112 wires its diagnoser; `window.nfBuilderEngine` test hook; no double-parse optimisation yet; loading progress shown by F-202; the worker manifest and the `check:hosts` amendment; a `bench` job in `ci.yml` and `pnpm bench`. One ADR at landing.

### F-202 (merged with its PR)
- Accept every recommendation in section 6: a hand-written IndexedDB wrapper instead of Dexie (amends one clause of ADR 0002); schema v1 (`projects`, `files` keyed by `[projectId, path]`, text only) with migrations; storage and autosave in the engine worker, `persist()`/`estimate()` on the main thread; `fake-indexeddb` 6.2.8 as a web dev dependency; the IO-01 and IO-03 readings (warning at 80%, step 3 simulates 85%); blank project has no files until F-203; step 1's content edit through `window.nfBuilderEngine` until F-208; `readFile`/`close` added to F-113's service (fold in if F-113 is still open); no new UX row for loading progress; a disclosure-button switcher with native dialogs; no multi-tab coordination; the F-201 header test update and baseline re-approval from CI. One ADR at landing.

### F-205 (merged with its PR)
- Open point 1: option B. F-205 step 1 becomes "Open fixture projects covering every node kind and a corpus pipeline; visual snapshots per node kind match baselines"; F-203 step 1 gains "each template's canvas matches its approved visual baseline" and F-203 depends on F-205. The template check moves to F-203 rather than being dropped: an ADR and the `scope-change` label in F-205's PR.
- Accept the other recommendations: `@xyflow/react` 13.0.2 pinned (12.12.1 fallback), a lazily loaded canvas, the interim layered layout until F-207 (ADR 0008's end state unchanged), view logic in the engine run on the main thread, the corpus restored in the Chromium e2e leg (ci.yml edit), `window.nfBuilderWorkspace`, plain edges dotted and unknown solid muted (UX-24), unresolved callees drawn as unparsed with "not found" (UX-22), badge when `callee.typed === true`, session-only port-labels toggle, visible attribution at bottom centre, selection highlight left to F-206, status-bar counts wired, `apps/web/src/workspace/` owned by whichever of F-202 and F-205 lands first.

### F-203 (merged with its PR)
- Accept every recommendation in section 6:
  - **Q6 (answer at landing):** v0.1 ships Start blank, Hello world and Samplesheet to MultiQC. The nf-core skeleton and Pipeline composition move to a new M8 feature, "More project templates" (`scope-change`).
  - **Format:** templates are pack-owned trees with generated `templates.json` (`pnpm gen:templates`), loaded lazily by `loadTemplates()`. Not a stored format.
  - **Content:**
    - no substitution and no `manifest.name`;
    - blank has no output block (lint rejects an empty one);
    - LA-42 `eval` versions, with the oracle's `run.tools` shims;
    - Hello world has no `topic:` section;
    - offline test data under `assets/`.
  - **Dialog:** Publish docs is carried but does nothing until F-606; Import and the metro checkbox stay out of scope; the header's Templates button opens the dialog on From a template.
  - **Licence:** template content is dedicated under MIT-0, with a `licences.md` row.
  - **Checks:** the doc-comment check is test-only until F-311 and F-312; F-207 re-approves the template baselines.

### F-501 (merged with its PR)
- Accept every recommendation in section 6: an orphan `registry-snapshot` branch fetched by each Netlify build; ship without the build-hook secret and open a `maintainer` issue for it; split `index.json` (QA-06) and `ports.json`, with IO-31 read as the pair; `tools/registry-snapshot` may import lang-core and pack entries (amends ADR 0003); make lang-2610 erasable for plain Node; ports from registry metadata in `meta.yml` order; parser wins on kind and component; every bundle file; pinned dependency closure; plugin release admitted by the pinned Nextflow; the failure policy; a path-filtered PR dry run outside "CI green"; daily at 03:23 UTC; the fixture snapshot for e2e. ADR 0035 (F-105 takes 0034).

## Process notes for the next session

- Plans written before F-202 and F-205 merged name `apps/web/src/workspace/workspace-store.ts`; the canvas store is now `apps/web/src/canvas/canvas-store.ts` (`useWorkspace`, `show`, `changed`), and `apps/web/src/workspace/` is F-202's worker-side code.
- Visual baselines: download the `playwright-chromium` artefact through `api.github.com/repos/ewels/nf-builder/actions/runs/<id>/artifacts`, view each `-actual.png`, copy to `e2e/__screenshots__/<spec>/<name>-chromium-linux.png` (ADR 0021).
- Several worktrees share e2e ports 4173 and 5173; builders wait rather than kill servers.

- Docs-only changes go straight to `main` after `pnpm check` (ADR 0031); everything else through a PR.
- Wait for CI by polling the public check-runs API rather than subscribing to PRs (Netlify bot comments are noisy).
- After every merge to `main`, merge `main` into open feature branches: a PR that conflicts with `main` gets no CI run.
- Visual baselines: download the `playwright-chromium` artefact, view the `-actual.png`, commit it (ADR 0021).
- Local e2e: `export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`; stale `vite preview` servers from other worktrees can hold ports 4173 and 5173. Spike ports: S5 4175, S3 4177 and 4178.

### F-011 (merged with its PR)
- Accept every point in section 8:
  - build now, and merge only after Pages is enabled (#35);
  - ADR 0014 and ADR 0035 are superseded by ADRs 0040 and 0041, and ADR 0002 is amended;
  - the QA-30 amendment lands with the ADRs;
  - `budget` and `hosts` stay separate jobs under the same base;
  - copied public HTML is stamped with the policy in `writeBundle`;
  - the deployed registry check samples 20 bundles and 5 plugins;
  - `SITE_CONTEXT=production`;
  - a fifth step for the frame guard;
  - the tests removed with their behaviour are mapped in the PR;
  - the notice reads "nf-builder can't run inside another page." with an "Open in a new tab" link (superseded by ADR 0044: the maintainer wants the app to work in frames, so there is no guard);
  - `passes` is set in the PR, and F-501 flips in a follow-up after a snapshot-triggered `verify` passes.
- `smol-toml` stays (section 6).
- The plan's mention of #33 is stale: Actions runs again.

### F-206 (merged with its PR)
- Accept every recommendation in section 6:
  - Edit and Code are shown disabled while a node is selected;
  - every directive is shown in source order;
  - the 8-line preview;
  - the doc-comment summary;
  - containment scopes, with "No problems found";
  - Parameters and Outputs in the entry summary;
  - projection parts on the main thread, with `EngineApi.details` in the worker;
  - single selection, with edges not selectable;
  - the plan's wording.
- Task 0, wiring the diagnoser into the service, is done in F-112's PR, since F-112 merges after F-113.

### F-207 (merged with its PR)
- Accept every recommendation in section 6:
  - elkjs 0.12.1, pinned, as a web runtime dependency under its EPL-2.0 option, in its own lazily started worker;
  - `setLayout` as the only writer of the sidecar, and layout writes don't advance the revision (clarifies ADR 0043);
  - commands and patches never touch the sidecar;
  - a session memo of removed positions;
  - `layeredLayout` kept as the fallback when ELK fails;
  - lazy layout per workflow;
  - step 3 through `window.nfBuilderWorkspace.apply` until F-303;
  - moves aren't undoable in v0.1;
  - the invalid and newer policies;
  - React Flow's own selection;
  - sizes taken with port labels shown;
  - the partial-placement rule.
- Point 10: add F-202 to F-207's `depends_on`, with the `scope-change` label and the ADR.
- One ADR at landing for the sidecar v1 format. It also records that history is F-209's and autosave F-202's, correcting ADR 0039's attribution.

### F-208 (merged with its PR)
- Accept every recommendation in section 6:
  - `style-src 'self' 'unsafe-inline'` for Monaco, as ADR 0014 anticipated. It amends ADR 0040's policy line with a new ADR, and adds a `cspProblems` rule allowing only those two style sources. The probe found 31 violations under the strict policy and none with inline styles.
  - `monaco-editor` 0.57.0, pinned, with lean imports and no React wrapper.
  - Option A: Shiki 4.6.0 with `@shikijs/monaco`, the JavaScript regex engine and `github-light`.
  - A refused draft is kept in the session model.
  - A 300 ms debounce.
  - A fixed 50/50 split.
  - Modes kept per tab for the session.
  - The shortcut scope.
  - Only the refusal's problems are shown.
  - A clean buffer follows external changes, and a dirty one wins.
  - Step 3 evidence from the Node-side marker test and the budget job.

### F-209 (merged with its PR)
- Accept every recommendation in section 6:
  - history lives in the engine worker's service, with `undo`, `redo`, `history` and `apply` options (amends ADR 0043's API);
  - a group is a sequence of parts under a `group` token, not concatenated inverses, because `applyPatches` refuses two patches to one path;
  - raw writes clear the history;
  - limits of 100 steps and 8,000,000 units;
  - platform shortcuts, with editors keeping their own undo;
  - controls in the tab strip;
  - no automatic retry after a stale refusal;
  - the AR-23 and UX-70 wording;
  - add F-202 to F-209's `depends_on` and F-209 to F-309's (`scope-change` label in F-209's PR);
  - full-file byte checks, sidecar included;
  - node moves stay outside the history.

### F-309 (merged with its PR)
- Accept every recommendation in section 6:
  - start after F-208 and F-209; F-209's PR adds F-209 to F-309's `depends_on`;
  - the panel at the bottom of the centre column, closed by default, fixed height, open state for the session only (no stored format);
  - diagnostics pulled per revision for the whole project;
  - `EngineApi.applyFix` with a per-file stale check (amends ADR 0043's API list, clarifies ADR 0042's staleness);
  - code-only file tabs (UX-20), reused by F-210, F-605 and F-601;
  - the navigation rules, grouping and sorting, and keyboard model;
  - the UX-03 reading, amended in the spec;
  - step 2 read as "the diagnostic disappears" (`deprecated-channel` is a warning), recorded in the ADR and notes;
  - refused Code-view drafts not listed; mismatch red left to F-302;
  - a "Show in problems panel" button in the details pane;
  - the 64-character cap on fix edits.

### F-502 (merged with its PR)
- Accept every recommendation in section 6:
  - live registry access gated off by a constant (`LIVE_REGISTRY = false`), recorded in an ADR, with the test hook driving the live path;
  - step 2's condition ("if S4 allowed it") is false, so `passes` can be set with notes citing the task 0 run, the `curl` check and the live-path test; the step isn't reworded;
  - delete the S4 probe and its workflow after task 0 (ADR 0023; a workflow edit, recorded);
  - interim lists of 50 names, the 2.8 copy, no staleness warning, HTTP cache only offline, no `/registry/` in `pnpm dev`;
  - `index()` only for now;
  - the F-204 locator change and the shell baseline re-approval, recorded in the PR;
  - extend the recorded-registry-data licences row to the live fixtures.

### F-403 (merged with its PR)
- Accept every recommendation in section 6:
  - fflate 0.8.3, pinned, as a runtime dependency of `@nf-builder/sources` (`unzipSync` only), plus root dev fflate and `sources` dev fast-check 4.11.0;
  - unzipping in the engine worker with `sources` loaded lazily;
  - the 2.2 size guards, without CRC checks;
  - binary files skipped and listed, schema v1 unchanged; add the deferred M8 feature "Binary files in projects" (schema v2, import and export passthrough) with `scope-change`;
  - the 2.5 default ignore list and `.gitignore` subset; unsupported lines block Create;
  - SI units; every central-directory record counts as an entry; a 200 MB cap on the zip itself (IO-12);
  - the one-level folder rule, path rules, and a damaged entry aborting the import;
  - F-403 builds the summary half of UX-61; the Import route with an "Import from" group;
  - add F-403 to F-404's `depends_on` (`scope-change`);
  - fixtures built with `git archive` from the corpus cache; step 1 read as "the pinned tree after the IO-12 rules"; tag the small-zip test `@smoke`.
- F-403 lands before F-401, which then builds on the shared `packages/sources` import module and the Import route.

### F-401 — plan deleted
- Accept every recommendation in section 6, with one change: the default ignore list is F-403's (2.5 in plan-F-403), shared by both routes, rather than point 4's list. One list keeps both routes' summaries consistent and reads ADR 0009's "test data" one way.
  - fetching in the document, bytes transferred to the worker as `ArrayBuffer`s (an AR-30 reading);
  - `ProjectMeta.source` as an optional field with no schema version bump, and the rule for when a bump is needed (amends ADR 0045);
  - `EngineApi.report()` and `WorkspaceApi.importProject()`;
  - the limit semantics, binaries skipped (as F-403), the report's definitions (UX-61), no token field until F-402, Publish docs hidden on Import;
  - body length checked against the tree size, no SHA-1 in the app;
  - the `web-worker-no-github-client` dependency-cruiser rule;
  - mocked e2e evidence with blob SHAs checked against the corpus, an opt-in `F401_LIVE=1` test, the git-generated tree fixture;
  - 8 requests in flight, one retry on network errors or 5xx; the accepted input forms (IO-10); session-only report; the repository name as the default project name; warn but allow a repository with no `.nf` files.

### F-703 — plan deleted
- Accept every recommendation in section 6:
  - start after F-207 merges (no `depends_on` change; recorded in notes);
  - the code view isn't mounted below 1024 px: Graph only, modes kept per tab;
  - switching projects stays; New, Templates, Import, Rename and Delete are hidden and refused; an open dialog closes;
  - read-only writes nothing to the project (positions stay in memory; `openedAt` still updates);
  - side by side from 640 to 1023 px with a fixed details column, stacked below 640 px; the minimap is dropped; zoom, fit and port labels stay;
  - all header actions hidden; Export stays hidden in read-only for v0.1 (note to F-404);
  - WCAG 1.4.4 accepted for v0.1 with an F-701 note on an "Edit anyway" override;
  - the `read-only` refusal code (type-only) and guards in the page's stores, not the worker;
  - flush, then guard, on narrowing;
  - the copy in point 12; the `READ_ONLY_ALLOWED` e2e allow-list; one `@smoke` test; no prefetch change;
  - F-202's multi-tab note answered: last write wins stands for v0.1.

### F-210 — plan deleted
- Accept every recommendation in section 6:
  - `EngineApi.listFiles`, pulled while the panel is visible, rows built by a pure engine function;
  - a new `CreateFile` command (one undo step; extends ADR 0039 and AR-21);
  - empty folders as `<folder>/.gitkeep` (no format change);
  - adding files as raw writes that clear the undo history, with the dialog saying so;
  - IO-12 limits and binary skipping for loose files, no ignore list;
  - a dropped zip uses F-403's staging plus a "Keep the folder" checkbox;
  - always confirm, replace only after listing, skip clashes with reasons;
  - the target-folder rules; refuse dropped folders;
  - registry tags from the pack's `scriptInclude` check, excluding `local`; read-only registry files left to F-506;
  - badges from parse status; file tabs reuse F-309's code-only tabs (F-309 lands first); a script with a workflow opens its canvas tab;
  - rename, move and delete become a new M3 feature that depends on F-210 (`scope-change`);
  - the 2.8 tree keyboard model; one shared `projectPathProblem` in lang-core; the document drop guard for file drags; session-only state; one `@visual` baseline.

### F-605 — [plan](plan-F-605.md)
- Accept every recommendation in section 6:
  - FI-32's "binary files are listed but not opened" is read for v0.1 as "projects hold text files only"; step 2 moves to the deferred M8 "Binary files in projects" feature (added by F-403's PR, or by F-605's if not), with an ADR and `scope-change`;
  - marked 18.2.1 and DOMPurify 3.4.18, pinned, as runtime dependencies; jsdom 31.0.1 as a web dev dependency;
  - the 2.2 sanitising rules (images `data:` only); placeholders for project images (note to F-607);
  - no heading anchors or code highlighting in the preview;
  - Preview, Split and Code modes for Markdown, opening in Preview, with G, S and C positional (UX-27 amended);
  - tasks 1 to 3 now, tasks 4 to 7 after F-309 merges; no `depends_on` change;
  - the tablist label "Open workflows and files"; the 2.6 language set; `EngineApi.outline`; AR-30 extended to the preview; tab closing left to F-307; no preview size cap; the step 1 test tagged `@smoke`.

### F-601 — [plan](plan-F-601.md)
- Accept every recommendation in section 6:
  - tasks 1 to 6 now, task 7 after F-309 merges (file tabs, `openFile`, `revealCode`); no `depends_on` change;
  - open configs through `openFile` and a "Configuration" link in the entry workflow's summary (UX-31 amended);
  - statement-level config edits (one `TextEdit` per command; amends ADR 0039's reprint level for configs and refines ADR 0032);
  - port nf-lang's `ConfigFormattingVisitor` with default options, with corpus parity against `lint -format`;
  - five new commands (AR-21 amended); Add scope, selector and profile write an empty block; no block removal in v0.1;
  - the 2.6 placement rules; `8.GB` and `2.h` literals, single-quoted strings;
  - expressions read-only with "Set a value"; the form read-only while the file has parse problems;
  - `config-unknown-option` mirroring Nextflow's run-time `ConfigValidator` (FI-03 amended); FI-06 selector counts as `ConfigSelectorResolver` does (FI-06 amended);
  - verified docs URL rules in the pack and a minimal safe renderer for catalogue Markdown;
  - `EngineApi.configView` and `configSchema` (amends ADR 0043's API list), excerpts capped at 160 characters;
  - Form, Split and Code modes on config tabs reusing `ViewMode` (UX-27 amended); new top-level blocks appended at the end;
  - step 2's "imported" read as "a project created from existing files"; the Nextflow grammar for highlighting; collapsed selector cards over 20.

## Paused on 2026-11-23

Work paused at the maintainer's request (usage limits). To resume:
- No open PRs. F-309 and F-403 merged after the pause.
- **Next features, plans ready (dependencies met):** F-703 (read-only below 1024 px), F-210 (Files view; reuse F-309's `openFile` and F-403's staging), F-605 (Markdown and other files; move its step 2 to F-407), F-601 (config editor), F-401 (GitHub import; reuse `@nf-builder/sources/import`).
- Then plan M3 from F-301 onwards.


## Session 3 (from 2026-11-27)

ADR numbers reserved for features in flight, so parallel branches don't clash: 0055 F-210, 0056 F-703, 0057 F-401, 0058 F-503. Take the next free number after these for any other feature.

### F-503 — plan deleted
- Accept every recommendation in section 6, with one change: namespaces are ordered with `nf-core` first, then the rest in code-point order, as the mockup shows (2,296 of 2,330 modules in the deployed snapshot are nf-core's).

### F-301 — [plan](plan-F-301.md)
- Accept every recommendation in section 6, with one change to point 16: F-703 (read-only below 1024 px) is being built now; if it has merged when F-301 starts, palette adds go through its read-only guard and are refused there, with a test.
- The new feature for the other palette items (point 1) is added in F-301's PR with `scope-change`. ADR number: the next free one when F-301 starts (0055 to 0058 are reserved above).
