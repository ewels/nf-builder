# Progress log

Append-only. Newest entry at the bottom. One entry per agent session or human working session.

```
## YYYY-MM-DD · <feature id or "planning"> · <who>
- Did: what changed (files, PR link)
- State: passing / partial / blocked
- Next: the next concrete step
- Decisions: calls made for the maintainer, with ADR or question links, or "none"
- Blockers: anything only the maintainer can unblock, or "none"
```

## 2026-11-21 · planning · Claude with Phil Ewels
- Did:
  - spec (`docs/spec/`), ADRs 0001–0013, roadmap, feature list, open questions;
  - `AGENTS.md`, MIT licence;
  - research notes in `docs/research/`;
  - six-screen mockup, linked from `docs/spec/README.md`.
- State: no code yet.
- Next: maintainer reviews the Proposed ADRs (Q2) and picks a name (Q1), then F-001.
- Blockers: Q2.

## 2026-11-21 · planning · Claude with Phil Ewels
- Did: name settled as nf-builder (Q1); sidecar folder `.nf-builder/`; first commit to `ewels/nf-builder`.
- State: no code yet.
- Next: maintainer reviews the Proposed ADRs (Q2), then F-001.
- Blockers: Q2.

## 2026-11-21 · planning · Claude with Phil Ewels
- Did:
  - all ADRs accepted (Q2); spikes now append a `Spike result` section to their ADR (ADR 0001);
  - mockup screenshots in `docs/mockup/`;
  - Claude Code roles: Opus main session, subagents in `.claude/agents/` (`CLAUDE.md`, ADR 0012).
- State: no code yet.
- Next: F-001.
- Blockers: none.

## 2026-11-21 · planning · Claude with Phil Ewels
- Did: vendored eight Nextflow skills into `.claude/skills/` so cloud sessions get them (plugin entries removed from `.claude/settings.json`); added F-705, a post-v0.1 cleanup that removes them and `docs/mockup/`.
- State: no code yet.
- Next: F-001.
- Blockers: none.

## 2026-11-21 · planning · Claude with Phil Ewels
- Did: hosting moved to Netlify (`nf-builder.netlify.app`, ADR 0002; F-002 adds `netlify.toml`); autonomous mode on (ADR 0012, AGENTS.md, CLAUDE.md): the agent decides, records, merges its own PRs and continues to the end.
- State: no code yet.
- Next: F-001.
- Decisions: none (maintainer's own).
- Blockers: none.

## 2026-11-21 · F-001 · Claude (autonomous)
- Did: pnpm monorepo scaffold per ADR 0003: five packages (`lang-core`, `lang-2610`, `engine`, `sources`, `apps/web`) with `src/`, `test/` and short READMEs; strict TypeScript, Biome, Vitest projects, dependency-cruiser rules with "where to go instead" messages; `pnpm check` runs typecheck, lint, unit tests and architecture rules. Tests cover every rule, the layout and the check pipeline.
- State: passing (fresh clone `pnpm install && pnpm check` exits 0).
- Next: F-002 (web app shell and `netlify.toml`).
- Decisions:
  - Engine reaches packs only through a pack's entry module ([Q10](open-questions.md)).
  - TypeScript pinned to 6.0.3: dependency-cruiser 18.8 silently cruises 0 modules under TypeScript 7.0. A test asserts the real `arch` run cruises at least one module, so a careless bump fails loudly. Move to 7.1 once dependency-cruiser supports it.
  - Node 22 (`engines.node ^22.23.5`, the sandbox runtime; maintenance LTS until 2027-04-30) and pnpm 10.28.0. No `.nvmrc`: on Netlify it would override the Node version that `netlify.toml` sets (F-002).
  - Biome formats and lints code, JSON and YAML but not Markdown, so docs and Accepted ADR bodies are never reformatted.
  - Q9 (StageNest, nf-schema-builder) doesn't affect the scaffold; it is being researched now and will be answered before M0 closes.
- Blockers: none. Note: this sandbox can't reach `*.netlify.app`, `registry.nextflow.io` or `nextflow.io`; deployed checks run from GitHub Actions instead.

## 2026-11-21 · F-002 · Claude (autonomous)
- Did: minimal app shell (`apps/web`: React 19 + Vite 8, header with the app name, three labelled columns at 256 / fill / 296 px); `netlify.toml` with build, Node 22.23.5, pnpm 10.28.0, the QA-30 headers and an SPA fallback; `vite preview` serves the same headers; Playwright e2e under the production CSP (`pnpm test:e2e`, with a wrapper so `-- --grep` filters under pnpm 10); `version.json` stamped from `COMMIT_REF`; `deploy-check` workflow asserting deployed headers on previews and on `main`. PR #3.
- State: passing. Preview of the PR head served every `netlify.toml` header on `/`, a deep route and a hashed asset (deploy-check run on PR #3). Production is checked by the same job on the merge commit.
- Next: F-003 (CI).
- Decisions:
  - Security header set, CSP baseline, root `scripts/` and `e2e/` build-time folders, `smol-toml` dev dependency, public `/version.json` ([ADR 0014](../adr/0014-security-headers.md)).
  - New workflow `.github/workflows/deploy-check.yml` (ADR 0014): `pull_request` and push to `main`, read-only token, SHA-pinned actions; fork PRs skip it.
  - `vite dev` sends every header except the CSP, because its React Refresh preamble is an inline script; e2e runs against `vite preview` with the full CSP.
  - Node 22.23.5 exactly in `netlify.toml` (inside `engines.node ^22.23.5`), not the researcher's Node 24 suggestion, to match the agent sandbox.
  - `passes` is set before the post-merge production check ([Q11](open-questions.md)).
  - Q9 answered: own schema form, nf-schema-builder as reference only; StageNest not inspectable from the sandbox ([Q9](open-questions.md), [notes](../research/2026-11-21-schema-builder-and-stagenest.md)).
- Blockers: merged `feat/*` branches can't be deleted from the sandbox; issue #2 (`maintainer`) asks for "Automatically delete head branches".

## 2026-11-21 · F-003 · Claude (autonomous)
- Did: `ci.yml` with one job per check (`pnpm check`, Playwright on Chromium plus `@smoke` on Firefox and WebKit, QA-01 bundle budget, IO-41 host allow-list, ADR lint, `features.json` validation, `pnpm audit`); checker scripts with unit tests and `file:line` messages; one allow-list shared by the CSP and the host scan; `renovate.json`. PR #4; throwaway PR #5 broke every check (all nine jobs failed with their own messages) and was closed.
- State: passing. F-002's production deploy check also passed on `main` after merge.
- Next: F-004 (agent harness).
- Decisions:
  - CI design, QA-01 measurement (initial JS from the Vite manifest, 1 kB = 1000 bytes, workers excluded until F-702), never-fetched URL list, browsers, Renovate ([ADR 0015](../adr/0015-ci-checks.md)).
  - `pnpm check` also runs the ADR lint and `features.json` validation.
  - F-203's duplicate `UX-60` removed; QA-34 and ADR-0015 added to F-003's spec list ([Q12](open-questions.md), PR labelled `scope-change`).
- Blockers: Renovate app installation (#6) and required status checks on `main` (#7) are maintainer settings; neither blocks a feature.

## 2026-11-21 · F-004 · Claude (autonomous)
- Did: `Scope guard` workflow and `scripts/check-features-scope.ts` (only `passes` changes and appended `notes` pass without `scope-change`); `pnpm smoke` (fresh build plus the `@smoke` tests on Chromium, under 60 s; about 4 s locally, also run in CI); tests that keep AGENTS.md Commands in step with `package.json` and the PR template's definition of done in step with AGENTS.md. PR #8; throwaway PR #9 showed the guard fail on a reworded description and pass once labelled.
- State: passing.
- Next: F-009 (corpus tooling).
- Decisions:
  - Scope guard design, `notes` append-only, smoke as "at least one `@smoke` test" ([ADR 0016](../adr/0016-scope-guard-and-smoke.md)).
  - AGENTS.md Commands lists only commands that exist; corpus, grammar and catalogue commands join it with their features.
- Blockers: none new (#2, #6, #7 open for the maintainer).

## 2026-11-21 · F-009 · Claude (autonomous)
- Did: `tools/corpus` (`@nf-builder/corpus`): `corpus.yaml` pins nf-core/rnaseq 3.28.0, sarek 3.12.0, fetchngs 1.13.0 and nextflow-io/rnaseq-nf `master` and `static-typing` by full SHA; `pnpm corpus:fetch` checks each out by SHA into `.cache/corpus/` (5 pipelines, 63 MB, about 5 s; a second run makes no network call); nine malformed fixtures with `fixtures.yaml` (expected `lint` results confirmed with `nextflow lint` 26.10.7); a cached `corpus` CI job. PR #10.
- State: passing.
- Next: hand-off to a new session with wider network access (see the hand-off entry below).
- Decisions:
  - Corpus fetch design, formats, and ADR 0002's allow-list read as runtime-only ([ADR 0017](../adr/0017-corpus-fetch.md)).
  - Maintainer's decisions recorded as [ADR 0018](../adr/0018-parallel-features-and-local-nextflow.md): up to three independent features in parallel; Nextflow may also run locally (CI stays the authority).
  - Tooling features without UI pass on unit tests plus CI runs ([Q13](open-questions.md)).
  - Malformed fixtures are exempt from "must pass the oracle"; the oracle must reproduce their recorded `lint` result (AGENTS.md, ADR 0017).
- Blockers: none. (#2 closed by the maintainer.)

## 2026-11-21 · hand-off · Claude (autonomous)
- Did: closed out the first session. Passing: F-001, F-002, F-003, F-004, F-009. Plans for F-005, F-006 and F-201 are in `docs/plan/handoff/` with their open points settled; this session's research is in `docs/research/2026-11-21-corpus-and-s1-facts.md` and `2026-11-21-netlify-csp-ci.md`.
- State: `main` green; production deploy checked.
- Next: a new session with wider network access starts F-005, F-006 and F-201 in parallel (ADR 0018), each in its own worktree, from the hand-off plans. After those: F-007, F-008, F-010 (spikes needing CheerpJ, the registry and Pyodide hosts), then M1 from F-101.
- Decisions: the hand-off README settles the plans' open points.
- Blockers: none. Open maintainer issues: #6 (Renovate), #7 (required checks). This session couldn't reach `*.netlify.app`, `registry.nextflow.io`, `docs.seqera.io`, `cdn.jsdelivr.net` or `codeload.github.com`.
- Notes for the next session: run Nextflow locally with `.cache/nextflow/nextflow-26.10.7-dist` (download it from GitHub releases; `NXF_HOME=.cache/nextflow/home NXF_OFFLINE=true`); in the cloud sandbox export `PW_CHROMIUM_EXECUTABLE` for e2e (AGENTS.md); `pnpm corpus:fetch` populates `.cache/corpus`.

## 2026-11-22 · F-201 · Claude (autonomous)
- Did: app shell (`apps/web/src/shell/`): header with placeholder controls and the Nextflow version from the installed packs, side columns that resize by pointer or keyboard and collapse to a rail, tab strip, status bar; Zustand layout store persisted to localStorage; `LanguagePack` in lang-core, `pack` in lang-2610, `installedPackVersions()` in engine; a CI-rendered `@visual` baseline. PR #12.
- State: passing.
- Next: F-005 and F-006 in flight; then F-007, F-008, F-010.
- Decisions:
  - Hand-rolled resizing, widths and limits, layout format `nf-builder:layout` version 1 in localStorage, visual baselines rendered in CI and approved from the artifact ([ADR 0021](../adr/0021-app-shell-layout.md)).
  - `zustand` 5.1.0 as an apps/web runtime dependency (named in ADR 0003).
  - `.github/workflows/ci.yml`: the Chromium e2e job runs on `ubuntu-24.04` (ADR 0021).
  - WCAG 2.5.7 single-pointer alternative deferred to F-701; the suggestions link to F-309 (notes).
  - AGENTS.md: the `*.netlify.app` note now says some sandboxes can't reach it (this one can).
- Blockers: none.

## 2026-11-22 · F-005 · Claude (autonomous)
- Did: `tools/oracle`: `pnpm nextflow` runs the pinned Nextflow release offline; `pnpm oracle` runs `nextflow lint` and `run -stub` on the cases in `tools/oracle/cases/cases.yaml` and lints the corpus fixtures against `fixtures.yaml`; CI job `oracle`. Spike S1 with eight cases; [report](../research/2026-11-22-spike-s1-typed-legacy-interop.md). PR #13.
- State: passing.
- Next: F-006 (parser speed under investigation), F-008 in progress, then F-010 and F-007.
- Decisions:
  - Oracle from the pinned release jar locally and in CI; pin in `packages/lang-2610/upstream.json`; `tools/oracle` joins the ADR 0003 tools; build-time hosts github.com release downloads ([ADR 0019](../adr/0019-nextflow-oracle.md), amending ADR 0011 as ADR 0018 did).
  - `.github/workflows/ci.yml`: new `oracle` job with `actions/setup-java` pinned by SHA (ADR 0019).
  - S1 found typed code must pass legacy tuple inputs as `tuple(...)`: a mixed list literal fails lint, and lint doesn't check arity. LA-14 drops its warning and says so (ADR 0007 spike result, no new ADR); notes on F-110, F-302 and F-504.
  - LA-03: `>=26.10.6` confirmed, 26.10.7 latest.
  - `.module-info`: format recorded, writing deferred to F-504 (ADR 0009 spike result).
  - AGENTS.md: oracle cases marked `expect: error` are exempt from "must pass the oracle", like the corpus fixtures.
- Blockers: none.

## 2026-11-22 · F-008 · Claude (autonomous)
- Did: spike S4: a host-free probe page at `/spike/s4/`, a deployed Playwright probe (`e2e/s4-probe/`, own config) and the `S4 probe` workflow; run against deploy preview #14 in Chromium, Firefox and WebKit; [report](../research/2026-11-22-spike-s4-cors.md). PR #14.
- State: passing.
- Next: F-006 (parse speed fix), F-010 in review, then F-007.
- Decisions:
  - Probe page shipped with every deploy, targets in test code, CSP stripped by route in the test (Playwright's `bypassCSP` fails in WebKit), the `S4 probe` workflow outside the CI-green list, probe kept until F-502 ([ADR 0023](../adr/0023-s4-probe.md)).
  - `.github/workflows/s4-probe.yml`: new workflow, read-only token, SHA-pinned actions (ADR 0023).
  - ADR 0009 confirmed and its status set to Accepted: the registry sends no CORS headers, so the snapshot is the registry source; GitHub import via `api.github.com` and `raw.githubusercontent.com` works; `codeload.github.com` is blocked, so zip import is an upload (spike result; notes on F-403, F-501, F-502).
  - `test/e2e-browsers.test.ts`: the Playwright listing tests get a 30 s timeout (they timed out under load).
- Blockers: none.

## 2026-11-22 · F-010 · Claude (autonomous)
- Did: spike S5: `spikes/s5-nf-metro/` renders the nf-core rnaseq and sarek metro maps with nf-metro 2.1.0 in a Web Worker under self-hosted Pyodide 314.0.8; identical to the CLI (0 differing pixels); 16.5 MB served (10.5 MB gzip), first SVG after 8.6 s; [report](../research/2026-11-22-spike-s5-nf-metro.md). PR #15.
- State: passing.
- Next: F-006 in review, F-007 building, then M1 from F-101.
- Decisions:
  - Spike pages that needn't be deployed live in `spikes/<id>/`; Pyodide self-hosted and fetched at build time; `'wasm-unsafe-eval'` only in the spike's preview; build-time hosts cdn.jsdelivr.net, pypi.org, files.pythonhosted.org, raw.githubusercontent.com ([ADR 0024](../adr/0024-spike-s5-self-hosted-pyodide.md)).
  - `playwright.config.ts`: spike specs run in their own one-worker `chromium-spikes` project (each repeat would otherwise build and serve the spike concurrently).
  - ADR 0013 stands (spike result): no nf-metro patches; Pillow is needed for SVG too; FI-54 follow-ups in F-607's notes.
  - No new npm dependency and no workflow edit; CI's Chromium job fetches about 17 MB of assets and 50 MB of CLI wheels until FI-54.
- Blockers: none.

## 2026-11-22 · F-006 · Claude (autonomous)
- Did: spike S2: vendored nf-lang 26.10.7 grammars with a hand port of their Java actions; `pnpm gen:grammar` generates the TypeScript parser (committed); `parseScript`/`parseConfig`; `pnpm corpus:lint` and `pnpm test:corpus` compare the parser with `nextflow lint` on the corpus (CI job `corpus-parse`); `tools/spec-extract` and `pnpm gen:catalogue` generate the 26.10 catalogue (CI job `catalogue`); a stage-1 prediction fix that cut warm sarek parsing from 38 s to 1.1 s. [Report](../research/2026-11-22-spike-s2-parser.md).
- State: passing.
- Next: F-010 and F-008 in review, F-007, then M1 from F-101.
- Decisions:
  - `antlr4ng` 3.0.16 runtime and `antlr-ng` 1.0.10 dev dependency, pinned exactly and grouped in Renovate; generated parser committed; spec-extract as a single-file Java program; catalogue from language server v26.10.2 (nf-lang 26.10.4) against 26.10.7 grammars; build-time hosts; two blocking CI jobs ([ADR 0020](../adr/0020-parser-and-catalogue-generation.md)).
  - Licensing: upstream NOTICE and Apache-2.0 licence ship with the grammars; `docs/licences.md` lists the generated parser, ported classes, catalogue text and antlr4ng.
  - Stage 1 predicts the `sep` and `type` decisions with full LL; trees equal pure LL on the files the corpus harness checks (and on the whole corpus in a one-off research check).
  - QA-03 cold-start risk handed to F-113 (notes); the catalogue's 26.10.4 skew and docs gaps recorded in ADR 0005's spike result.
  - Hand-off plans folder removed now that all three hand-off features have merged.
- Blockers: none.

## 2026-11-22 · F-007 · Claude (autonomous)
- Did: spike S3: `e2e/s3-spike/` runs the 26.10 language server jar under CheerpJ 5.0 in a Web Worker (local only); correct diagnostics; default cold start 13.4 s, preload variant 9.6 s, 323 MB, 0.9 s diagnostics; CheerpJ needs `'unsafe-eval'`. [Report](../research/2026-11-22-spike-s3-language-server-cheerpj.md).
- State: passing.
- Next: F-101 and F-109 building, then F-102 and F-103.
- Decisions:
  - Spike runs locally with its own header sets, no CI job, kept for re-runs ([ADR 0022](../adr/0022-s3-spike-local.md)).
  - The language server isn't shipped in v0.1: the cold-start threshold is met only with preloading and a 0.4 s margin, and it needs `'unsafe-eval'` (QA-30), a CDN host and a licence decision ([ADR 0026](../adr/0026-no-language-server-in-v0-1.md), superseding ADR 0010's ship branch; its fallback stands).
  - Q3 answered: not needed for v0.1 ([open-questions](open-questions.md)); `docs/licences.md` marks CheerpJ as spike-only.
  - The known-error fixture is also an oracle case; the S1 oracle and docs tests now filter to `s1-` cases.
- Blockers: none.

## 2026-11-22 · F-101 · Claude (autonomous)
- Did: ported nf-lang's `DescriptiveErrorStrategy` (parse errors get upstream's messages and ranges) and the 90 parse-level inputs of `ScriptAstBuilderTest`, `ConfigAstBuilderTest` and `AgentParserTest` as 94 tests; steps 2 and 3 were delivered by F-006.
- State: passing.
- Next: F-109 in review, F-007 in review, then F-102 and F-103.
- Decisions:
  - Q14 answered: the ported "lexer cases" are those parse-level inputs; the 46 the grammar accepts are owned by F-102, F-103 and F-112 (notes).
  - AGENTS.md: the ported inputs are exempt from "must pass the oracle"; their lint results are recorded and checked for consistency, not re-run (an oracle re-check was more than this feature needed).
  - `docs/licences.md`: the upstream test inputs (Apache-2.0).
  - `.gitattributes`: the ported inputs are byte-exact (`-text`).
- Blockers: none.

## 2026-11-22 · F-109 · Claude (autonomous)
- Did: `packages/lang-2610/palette.yaml` (45 items in UX-12's categories) with `pnpm gen:palette` writing the committed `palette.json`, a loader in the pack, validation tests against the catalogue and grammar, and `workflow_dispatch` on `ci.yml`; the catalogue itself came with F-006.
- State: passing.
- Next: F-102 and F-103.
- Decisions:
  - Palette overlay in YAML with a generated JSON mirror; construct items name grammar rules; legacy-only items refused; palette not yet on `LanguagePack` ([ADR 0025](../adr/0025-palette-overlay.md)).
  - `yaml` 2.9.1 as a root dev dependency (already in the stack); `palette.json` joins AGENTS.md's generated files.
  - `.github/workflows/ci.yml`: `workflow_dispatch` trigger, token unchanged (ADR 0025).
  - Q4 answered: `agent` stays in the palette with a `preview` badge; `fromLineage` and pipeline includes, documented as experimental, carry no badge.
  - F-204's search example (`groupTuple`) is legacy-only; noted on F-204.
- Blockers: none.

## 2026-11-22 · F-204 · Claude (autonomous)
- Did: the left column's Components and Files tabs; the palette from the pack in UX-12's accordions with operator groups, search and preview badges; open categories persist; the catalogue loads lazily; the app shell baseline re-approved. PR #20.
- State: passing.
- Next: F-102 and F-103, then F-104, F-110.
- Decisions:
  - `LanguagePack` gains `palette` and `loadCatalogue()`; the engine resolves a serialisable palette view; open categories persist under `nf-builder:palette` version 1 ([ADR 0028](../adr/0028-palette-data-path.md)).
  - IO-41 skips built chunks whose manifest source is a `.json` file, amending ADR 0015's scan (ADR 0028); palette docs links join the never-fetched list.
  - Q15 answered: step 2's intent is checked with `groupBy`.
  - Q16 answered: new feature F-210 (Files view, UX-16); F-301 depends on it (`scope-change`).
  - Tests: the remaining Playwright listing test gets a 30 s timeout.
- Blockers: none.

## 2026-11-22 · QA-03 · Claude with Phil Ewels
- Did: QA-03 relaxed at the maintainer's request: a responsive UI with loading progress, and a 30 s regression ceiling for sarek instead of 3 s ([ADR 0029](../adr/0029-relax-qa-03.md)).
- State: no feature status changed.
- Next: F-102, F-103, then F-104 and F-110.
- Decisions: the maintainer's own (ADR 0029).
- Blockers: none.

## 2026-11-22 · scope · Claude with Phil Ewels
- Did: at the maintainer's request, F-402 (private GitHub import) moved to milestone M8, deferred past v0.1; QA-02, QA-04 and QA-05 become reported measurements rather than CI gates; F-702's step updated ([ADR 0030](../adr/0030-trim-v0-1-scope-and-gates.md)).
- State: no feature status changed.
- Next: F-102, F-103, then F-104 and F-110.
- Decisions: the maintainer's own (ADR 0030). Other simplifications offered (deferring docs publishing, the metro map, schema editors and registry extras; narrowing legacy editing, forms and diagnostics) were declined.
- Blockers: none.

## 2026-11-22 · process · Claude with Phil Ewels
- Did: docs-only changes (`docs/`, `AGENTS.md`, `CLAUDE.md`, package READMEs) may be pushed straight to `main` after `pnpm check`; code, tests, workflows, configuration, dependencies, generated files and `features.json` still go through PRs ([ADR 0031](../adr/0031-docs-only-changes-to-main.md)).
- State: no feature status changed.
- Next: finish F-102's current builder run, then hand off.
- Decisions: the maintainer's own (ADR 0031).
- Blockers: none.

## 2026-11-22 · hand-off · Claude (autonomous)
- Did: this session merged F-201, F-005, F-008, F-010, F-006, F-007, F-101, F-109 and F-204 (PRs #12–#20), plus the maintainer's spec and process changes (ADRs 0029–0031). 14 of 69 features pass; M0 is complete.
- State: F-102 (`feat/F-102`, tasks 1–4 committed, 5–6 in progress) and F-103 (`feat/F-103`, built, stacked on F-102) are open branches; F-104 and F-110 are planned. Plans and settled open points are in `docs/plan/handoff/`.
- Next: finish F-102 (tasks 5–7), merge it, then F-103, then F-104 and F-110 in parallel.
- Decisions: see the entries above and `docs/plan/handoff/README.md`.
- Blockers: none. Open maintainer issues: #6 (Renovate), #7 (required checks).

## 2026-11-22 · F-102 · Claude (autonomous)
- Did: script AST in `lang-core` types with the builder in `lang-2610` (`parseScriptAst`, internal): every declaration and statement kind in the 26.10 syntax reference, typed and legacy, with exact ranges; comments attached by a port of nf-lang's `CommentAttacher` (3,923 corpus comments match); every `ScriptAstBuilder` error with upstream wording; 56 snapshot fixtures, 46 error inputs and the corpus checked by the oracle and `corpus-parse`.
- State: passing.
- Next: F-103 (rebase on F-102's shared builders), then F-104 and F-110 in parallel.
- Decisions:
  - AST conventions: flat ranges, UTF-16 offsets with code-point columns, nf-lang comment attachment; AR-02 amended to match ([ADR 0027](../adr/0027-ast-conventions.md)).
  - AST types live in `lang-core`, the builder in the pack (ADR 0003's "model types"; no boundary change). The AST is built in memory and is not a stored or exported format, so no format ADR.
  - Report every `ScriptAstBuilder` error now rather than leaving half to F-112; warnings and resolver errors stay F-112's (notes).
  - Upstream bugs: the two errors upstream prints at -1:-1 are reported at the real node (`note` in `errors.json`); legacy `params.x =` with types enabled, which crashes lint, gets the upstream message and stays out of the oracle-linted inputs.
  - Vendored nf-core/fastqc (MIT) as a fixture so lint resolves a registry include offline; the oracle lints the AST fixtures and error inputs (AGENTS.md "Nextflow knowledge"); a comment-dump oracle runs in `pnpm test:corpus`.
  - `parseScriptAst` stays internal to the pack (bundle size); F-104 adds a lazy `LanguagePack.loadParser()` and `SourceFile`.
  - `docs/licences.md`: ported AST classes, syntax-reference snippets, fastqc module. No new dependency.
- Blockers: none.

## 2026-11-22 · F-103 · Claude (autonomous)
- Did: config AST (`parseConfigAst`, internal to `lang-2610`) on F-102's shared expression and statement builders: assignments, blocks, selectors, the `plugins` block, `includeConfig`, incomplete and invalid statements, with exact ranges; comments attached by the config path of the ported `CommentAttacher` (785 of 785 corpus config comments match nf-lang); every `ConfigAstBuilder` error at lint's positions (oracle tree `config-ast-errors`, 22 inputs); snapshots of all 228 corpus configs.
- State: passing.
- Next: F-104 and F-110 (in progress), then F-105.
- Decisions:
  - Config AST types in `lang-core`, builder in the pack, sharing ADR 0027's conventions; the AST and its snapshots are not a stored or exported format.
  - Invalid statements are kept as `ConfigInvalid` (ADR 0004) and report only upstream's one message; after a fatal error inside one, the statement is omitted.
  - Escape checks only on values, not on config names, blocks or selectors, as upstream; integer number-format errors ported, decimal ones left to F-112 (notes).
  - Config error inputs are an oracle tree with recorded positions, replacing a message-only case in `cases.yaml` (AGENTS.md "Nextflow knowledge").
  - Selector and include placement and include resolution are resolver checks for F-105 and F-112 (notes).
  - `docs/licences.md`: `ConfigAstBuilder` joins the ported AST row; corpus-derived snapshot row. No new dependency.
- Blockers: none.

## 2026-11-22 · F-110 · Claude (autonomous)
- Did: a line-by-line port of nf-lang 26.10.7's formatter (`packages/lang-2610/src/printer/`, off the pack entry): `printScript`, `printDeclaration` and `createLayout` for every declaration kind, typed and legacy, plus feature flags, enums and agents; the 81 non-Harshil `ScriptFormatterTest` cases; synthesised and edited trees with a fresh layout; the oracle formats the printer fixtures with `nextflow lint -format` and checks fixed points; 335 of 342 corpus scripts print exactly as `lint -format` does.
- State: passing.
- Next: F-104 (after F-103 merges), then F-105.
- Decisions:
  - Parity with `lint -format` except five upstream bugs where its output fails lint, changes meaning or isn't stable (`type-rename`, `catch-package`, `call-wrap`, `named-args-comma`, `directive-comment`); `NO_RANGE` for nodes an edit creates (amends ADR 0027); fresh blank-line layout; the oracle's format and fixed-point checks ([ADR 0032](../adr/0032-printer-known-differences.md)).
  - LA-45 clarified: new and edited declarations are formatted, untouched ones keep their text; the known differences are named (ADR 0032).
  - Default formatter options only; legacy printing ported too; statement-level printing left to F-111 (notes).
  - The upstream bugs are in `docs/research/upstream-bugs.md` for the maintainer to file.
  - `formatted*/` goldens are generated files (`pnpm oracle --write-format`, AGENTS.md); `docs/licences.md` rows for the ported formatter and its tests. No new dependency, no workflow edit.
- Blockers: none.

## 2026-11-22 · F-104 · Claude (autonomous)
- Did: lossless per-file model. `SourceFile` (AR-01) in lang-core; a hand-written pre-scanner and a chunked fallback parse in `lang-2610/src/source/`; items with builder errors or failing chunks become `Unparsed`; the engine builds, prints (untouched items from their source slices) and compares (`equivalent`) source files; `LanguagePack.loadParser()` loads the parser and the printer as one lazy chunk. All 570 corpus files and the 9 fixtures round-trip byte for byte; the malformed fixtures are isolated as recorded.
- State: passing.
- Next: F-105 and F-501 in parallel.
- Decisions:
  - Declaration-level fallback in two tiers, the pre-scanner rules, `scope: "file"` for whole-script checks, the status rule, print from source slices, the reading of the glossary's "equivalent", `Unparsed` in the AST unions, `source: "internal"`, and a lazy `loadParser()` carrying the printer, replacing the sketch's synchronous parse methods ([ADR 0033](../adr/0033-declaration-fallback-and-source-file.md); architecture sketch updated).
  - Types in lang-core, scanner and isolation in the pack, `SourceFile` construction, print and equivalence in the engine; no boundary change.
  - `SourceFile` is in memory only, not a stored or exported format. `yaml` as a lang-2610 dev dependency and Node types for engine tests; no new runtime dependency.
  - A lazy-chunk end-to-end test guards QA-01 even though F-104 has no UI.
  - Flaky F-102 comment tests under load get explicit 30 s timeouts (no assertion changed).
- Blockers: none.

## 2026-11-22 · F-105 · Claude (autonomous)
- Did: the semantic model. nf-lang 26.10.7's include rules in the pack (`src/includes/`, `LanguagePack.includes`): relative paths, registry names with nested vendoring, plugins, config includes; entries bind to declarations (including `Unparsed` heads); `Diagnostic` in lang-core; the engine's `ProjectModel` re-models a changed file and its direct dependants, with a trace hook. Every corpus include resolves with no diagnostics, as lint; oracle cases tie the messages to lint.
- State: passing.
- Next: F-106, with F-501 in review; F-111 and F-112 are planned.
- Decisions:
  - Include rules in the pack, upstream registry fidelity (nested vendoring, `meta.yml` required) with the AR-03 clarification, diagnostics and their codes, "could not be parsed" only when the grammar fails, direct dependants only, the F-112 leftovers ([ADR 0034](../adr/0034-include-resolution-and-incremental-model.md); architecture sketch gains `includes`).
  - Errors the AST builder's reparse finds are builder errors (`source: "builder"`), as upstream collects them, so a target with only builder errors still resolves.
  - Our own messages where lint aborts or downloads (upstream-bugs 12, 13, 15).
  - The model is in memory only; `yaml` as an engine dev dependency; no new runtime dependency.
- Blockers: none.

## 2026-11-22 · F-501 · Claude (autonomous)
- Did: `tools/registry-snapshot` builds the registry snapshot from registry.nextflow.io (module index, `meta.yml` ports, per-release bundles with every file, pinned dependency closure, plugin index and specs), classifying typed and legacy modules with the 26.10 pack's parser; `pnpm check:registry` checks QA-06 and integrity; the `Registry snapshot` workflow builds daily and publishes to the `registry-snapshot` branch; Netlify builds copy it to `/registry/`.
- State: built, not passing: blocked on #31 (the repository is private, so Netlify builds can't read the snapshot branch; they warn and serve no snapshot).
- Next: F-105 in review, then F-106; F-502 and F-503 can follow F-501.
- Decisions:
  - Format v1 split into `index.json` (QA-06) and `ports.json`, IO-31's module index read as the pair; an orphan snapshot branch fetched by each Netlify build (with a read token while the repository is private; warn and serve nothing when it can't be read); `tools/registry-snapshot` may import lang-core and pack entries (amends ADR 0003, new dependency-cruiser rule); an erasable lang-2610 for plain Node; ports from registry metadata in `meta.yml` order; the parser decides kind, component and typed; plugin release admitted by the pinned Nextflow; the failure policy; build-time hosts registry.nextflow.io, public-cr-prod.seqera.io and github.com ([ADR 0035](../adr/0035-registry-snapshot.md)).
  - `.github/workflows/registry-snapshot.yml`: new workflow, read-only except the publish job, SHA-pinned actions (new: `actions/download-artifact` v8.0.2); not a merge gate.
  - `yaml` is a dependency of the build tool (already in the repo); no new browser runtime dependency.
  - Registry problems found while measuring are in `docs/research/upstream-bugs.md` (17 to 19).
- Blockers: #31, give Netlify builds read access to the `registry-snapshot` branch (make the repository public, or set `REGISTRY_SNAPSHOT_TOKEN`); #27, the `NETLIFY_BUILD_HOOK` secret for daily deploys.

## 2026-11-22 · F-501 follow-up · Claude (autonomous)
- Did: dispatched the `Registry snapshot` workflow on `main` after the merge (run 45024203775): the build and check passed and the publish job pushed the first snapshot to branch `registry-snapshot`; the verify job skipped the deployed check because `NETLIFY_BUILD_HOOK` isn't set.
- State: F-501 still not passing: Netlify builds can't read the branch while the repository is private (#31).
- Next: once #31 is resolved, a production deploy should serve `/registry/`; then `pnpm check:registry --url https://nf-builder.netlify.app --generated-at <ts>` and set F-501 to passing in a PR.
- Decisions: none.
- Blockers: #31, #27.

## 2026-11-22 · process · Claude (autonomous)
- Did: GitHub Actions stopped starting jobs at 13:17 UTC ("recent account payments have failed or your spending limit needs to be increased"); opened maintainer issue #33.
- State: no PR can get a green CI, so nothing merges until #33 is resolved. F-106 (PR #32) is built and in review.
- Next: keep building in order on branches with the CI checks run locally (`pnpm check`, `pnpm oracle`, `pnpm test:corpus`, Chromium end-to-end tests, `pnpm build` with `check:budget` and `check:hosts`); merge each PR in order once CI is green again.
- Decisions:
  - While #33 blocks CI, a feature may branch from an unmerged dependency's branch (stacked), as an exception to ADR 0018's "independent features only". Every PR still needs a green CI before it merges, and the stack merges bottom up. The exception ends when CI runs again.
- Blockers: #33 (Actions billing), #31 (snapshot branch read access), #27 (build hook).

## 2026-11-22 · F-106 · Claude (autonomous)
- Did: the projection for typed workflows (`packages/engine/src/projection/`, types in lang-core): calls, chains, factories, takes, emits, `:params` and `:output` nodes with ports per LA-20 to LA-26, def-use edges with Channel/Value types (LA-28) from the catalogue and nf-lang's call rules, pipeline calls, inferred workflow emit types, code-node shells, and a shared scope API for F-107 and F-108. Probed types match `nextflow lint` in a new oracle tree; node ids survive whitespace-only re-parses.
- State: passing.
- Next: F-107 and F-108 in parallel, then F-111 and F-112.
- Decisions:
  - Types in lang-core, logic in the engine with catalogue data; the node-key grammar (entry workflow `""`, `~n` reassignment, `callee@n`, `:code@n`, `:take:`, `:emit:`, `:params`, `:output`), a stored format once F-207 writes the sidecar; plain values as their own kind; the type subset; calls with statuses; projector snapshots ([ADR 0036](../adr/0036-projection-node-keys-and-types.md); AR-11 points to it).
  - Only the entry workflow gets the `:output` node.
  - A type-probe oracle tree (`packages/engine/test/projection/fixtures.json`) ties the projection's kinds to lint.
  - In memory only; no new dependency.
- Blockers: none new.

## 2026-11-22 · F-108 · Claude (autonomous)
- Did: code nodes wired by free-variable analysis (`packages/engine/src/projection/free-variables.ts`, `code.ts`): an input per resolved variable a statement reads, an output per variable it writes, exact source text; a lint-only probe tree checks the free reads against `nextflow lint`; code-node text round-trips.
- State: passing (stacked on F-106; merges after it once CI runs, #33).
- Next: F-107 and F-111 in progress.
- Decisions:
  - Closure reads are inputs; mutations are reads only; a conditional write replaces the binding; no port for `params` as a whole; keys from the first output; a lint-only free-variable oracle tree ([ADR 0037](../adr/0037-code-nodes-and-free-variables.md)).
  - `CodeNode` gains `text`; no new dependency.
  - Upstream: lint reports some variable errors one column early (`docs/research/upstream-bugs.md` 22).
- Blockers: #33.

## 2026-11-22 · hosting · Claude (autonomous)
- Did:
  - merged F-106 (PR #32) and F-108 (PR #34);
  - closed #33 (Actions runs again now that the repository is public), #31 (moot) and #27 (no hook needed);
  - researched and planned the move to GitHub Pages: [research](../research/2026-11-22-github-pages.md), [plan F-011](handoff/plan-F-011.md);
  - opened #35 for the maintainer: enable Pages with Source "GitHub Actions", and decide on a custom domain before F-202.
- State: the Netlify production deploy serves `/registry/`, as the repository is public. F-011 is next, alongside F-107 and F-111.
- Next: build F-011; merge it once #35's first step is done; then F-501 can pass on Pages.
- Decisions:
  - The maintainer chose GitHub Pages for production.
  - [ADR 0040](../adr/0040-github-pages-hosting.md) supersedes ADR 0014 and amends ADR 0002's hosting line:
    - the CSP moves into a meta element, without `frame-ancestors`, with a no-referrer meta;
    - header-only protections are accepted risks;
    - the app refuses to run inside a frame;
    - workers make no cross-origin requests;
    - no SPA fallback;
    - preview mirrors Pages;
    - Deploy check is replaced by a CI `site` job and a post-deploy `verify`;
    - a minimal `netlify.toml` stays for development.
  - [ADR 0041](../adr/0041-registry-snapshot-deploy.md) supersedes ADR 0035: the Pages workflow redeploys after each successful snapshot run through `workflow_run` and reads the branch without credentials. No secrets are needed.
  - QA-30 amended to match.
- Blockers: #35 (Pages source; custom domain before F-202).

## 2026-11-22 · F-107 · Claude (autonomous)
- Did: the legacy projection: ports from process qualifiers (also for typed callers), `.out` in every form, pipes and forks, `set`/`tap`, legacy operators and factories from the pack, legacy params, aliases, call-result properties, and transparent dataflow `if`s and ternaries with guards; `Projection.statements` and a coverage measure; 90.6% of corpus statements modelled.
- State: passing.
- Next: F-111 finishing; then F-112 and F-113.
- Decisions:
  - AR-14 amended: aliases, call-result properties and dataflow conditionals are needed for step 2's 90% ([ADR 0038](../adr/0038-legacy-projection.md)).
  - Legacy operators as pack data (`LanguagePack.legacyOperators`); one `set`/`tap` rule matching nf-lang's `VariableScopeVisitor`, shared with F-108.
  - Licences row for the 119 corpus-derived snapshots. No new dependency.
- Blockers: none.
