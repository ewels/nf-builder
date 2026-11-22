# Hand-off plans (session 2)

Plans written by the planner agent on 2026-11-22 for features not yet merged, kept here so the next session can resume without re-planning. They are inputs, not decisions of record: the open points are settled below and still have to be recorded (ADR, `open-questions.md`, `progress.md`) when each feature lands. Delete a plan in the PR that merges its feature. Paths under `/tmp/...scratchpad...` in the plans pointed at session scratch files and may be gone; where it matters, the files were copied into the repo or the worktree.

## State on 2026-11-22

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
| F-112 diagnostics | `feat/F-112` | Tasks 1–7 committed; task 8 (calls and types) building. [plan](plan-F-112.md). |
| F-113 engine worker | `feat/F-113`, in PR | Plan deleted in its PR. |
| F-202 projects in IndexedDB | not started | [plan](plan-F-202.md). After F-113. |
| F-205 canvas | not started | [plan](plan-F-205.md). After F-113 (and F-106); parallel with F-202. |
| F-206 details pane | not started | [plan](plan-F-206.md). After F-205. |
| F-501 registry snapshot | merged, PR #29, **not passing** | Passes once the Pages deploy serves `/registry/` and `verify` passes (ADR 0041, F-011). F-502 to F-506, F-702, F-704 and F-705 depend on it. |
| F-011 GitHub Pages hosting | `feat/F-011`, PR #37 | Reviewed, CI green; merge once Pages is enabled (#35), after merging `main`. |

## Merge order

Branches are stacked: `feat/F-108` → `feat/F-107`; `feat/F-111` also merges F-107. Open PRs for F-108, F-107 and F-111 against `main` in that order (merge `main` into each first), each green before the next. Worktrees: `/home/user/wt-F-1xx`.

Next free ADR number: 0044 (0040 and 0041 are F-011's, 0042 F-112's, 0043 F-113's).

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

### F-112 — [plan](plan-F-112.md)
- Accept the recommendations in section 6, except:
  - quick fixes carry text edits (`QuickFix { title, path, edits }`) and become F-111's `ReplaceFileText { path, text }` when applied (the plan's own fallback), so F-111's command shape is unchanged;
  - no new feature for full nf-lang name-resolution and type-check parity: the spec doesn't require it for v0.1, so the deferred checks (point 4's list) are recorded in F-112's notes and ADR.
- LA-33 amended: a missing argument is an error (nf-lang rejects it), an unused output a warning. LA-31 and a new LA-37 row as in point 7. `Port.argumentType` is added to F-106 (point 13).
- Rules behind a lazy `LanguagePack.loadLints()`, one ADR at landing.

### F-113 (merged with its PR)
- Accept every recommendation in section 6: Comlink 4.4.2 as a runtime dependency of `@nf-builder/web` (ADR 0003 names it); pack versions from a pack-free `version` export, palette through the worker; Comlink only in apps/web; the page throttled 4× with worker timings reported unthrottled (Chromium can't throttle workers), clarified in `quality.md`; F-113 reports QA-03 and QA-04, F-702 gates QA-03; diagnostics from `ProjectModel.diagnostics()` until F-112 wires its diagnoser; `window.nfBuilderEngine` test hook; no double-parse optimisation yet; loading progress shown by F-202; the worker manifest and the `check:hosts` amendment; a `bench` job in `ci.yml` and `pnpm bench`. One ADR at landing.

### F-202 — [plan](plan-F-202.md)
- Accept every recommendation in section 6: a hand-written IndexedDB wrapper instead of Dexie (amends one clause of ADR 0002); schema v1 (`projects`, `files` keyed by `[projectId, path]`, text only) with migrations; storage and autosave in the engine worker, `persist()`/`estimate()` on the main thread; `fake-indexeddb` 6.2.8 as a web dev dependency; the IO-01 and IO-03 readings (warning at 80%, step 3 simulates 85%); blank project has no files until F-203; step 1's content edit through `window.nfBuilderEngine` until F-208; `readFile`/`close` added to F-113's service (fold in if F-113 is still open); no new UX row for loading progress; a disclosure-button switcher with native dialogs; no multi-tab coordination; the F-201 header test update and baseline re-approval from CI. One ADR at landing.

### F-205 — [plan](plan-F-205.md)
- Open point 1: option B. F-205 step 1 becomes "Open fixture projects covering every node kind and a corpus pipeline; visual snapshots per node kind match baselines"; F-203 step 1 gains "each template's canvas matches its approved visual baseline" and F-203 depends on F-205. The template check moves to F-203 rather than being dropped: an ADR and the `scope-change` label in F-205's PR.
- Accept the other recommendations: `@xyflow/react` 13.0.2 pinned (12.12.1 fallback), a lazily loaded canvas, the interim layered layout until F-207 (ADR 0008's end state unchanged), view logic in the engine run on the main thread, the corpus restored in the Chromium e2e leg (ci.yml edit), `window.nfBuilderWorkspace`, plain edges dotted and unknown solid muted (UX-24), unresolved callees drawn as unparsed with "not found" (UX-22), badge when `callee.typed === true`, session-only port-labels toggle, visible attribution at bottom centre, selection highlight left to F-206, status-bar counts wired, `apps/web/src/workspace/` owned by whichever of F-202 and F-205 lands first.

### F-501 (merged with its PR)
- Accept every recommendation in section 6: an orphan `registry-snapshot` branch fetched by each Netlify build; ship without the build-hook secret and open a `maintainer` issue for it; split `index.json` (QA-06) and `ports.json`, with IO-31 read as the pair; `tools/registry-snapshot` may import lang-core and pack entries (amends ADR 0003); make lang-2610 erasable for plain Node; ports from registry metadata in `meta.yml` order; parser wins on kind and component; every bundle file; pinned dependency closure; plugin release admitted by the pinned Nextflow; the failure policy; a path-filtered PR dry run outside "CI green"; daily at 03:23 UTC; the fixture snapshot for e2e. ADR 0035 (F-105 takes 0034).

## Process notes for the next session

- Docs-only changes go straight to `main` after `pnpm check` (ADR 0031); everything else through a PR.
- Wait for CI by polling the public check-runs API rather than subscribing to PRs (Netlify bot comments are noisy).
- After every merge to `main`, merge `main` into open feature branches: a PR that conflicts with `main` gets no CI run.
- Visual baselines: download the `playwright-chromium` artefact, view the `-actual.png`, commit it (ADR 0021).
- Local e2e: `export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`; stale `vite preview` servers from other worktrees can hold ports 4173 and 5173. Spike ports: S5 4175, S3 4177 and 4178.

### F-011 — [plan](plan-F-011.md)
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
  - the notice reads "nf-builder can't run inside another page." with an "Open in a new tab" link;
  - `passes` is set in the PR, and F-501 flips in a follow-up after a snapshot-triggered `verify` passes.
- `smol-toml` stays (section 6).
- The plan's mention of #33 is stale: Actions runs again.

### F-206 — [plan](plan-F-206.md)
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
