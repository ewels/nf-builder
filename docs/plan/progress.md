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
## 2026-11-22 · F-111 · Claude (autonomous)
- Did: edit commands in `packages/engine/src/edit/` (types in lang-core): CreateProcess, AddCall, Connect, Disconnect, DeleteNode, RenameDeclaration and ReplaceFileText, applied as text patches with inverses behind the AR-24 and LA-13 guards. Property tests with fast-check over fixture trees, a corpus reprint check, and oracle cases that lint and stub-run edited trees. The printer now keeps multi-line string content verbatim.
- State: passing.
- Next: F-112, then F-113.
- Decisions:
  - [ADR 0039](../adr/0039-edit-commands.md):
    - declaration-level reprint, plain-data commands, and patches and inverses in memory only;
    - AR-24 read as "no problem the file didn't have", with our own LA-13 check (lint misses positional mixing, upstream bug 20);
    - `null` placeholders, variable names, Connect moving a later source, DeleteNode clearing direct arguments;
    - CreateProcess at `modules/local/<lower>/main.nf` from `LanguagePack.scaffold`, plus the rename limits;
    - `ParseProblem.code`.
  - A sixth printer known difference, `string-reindent` (upstream bug 23, amends ADR 0032); the three ported nf-lang formatter cases that assert re-indentation are marked as known differences, with their inputs and outputs unchanged.
  - Spec: AR-24 clarified; LA-12 and LA-13 cite ADR 0039; the architecture sketch gains `scaffold`.
  - `fast-check` 4.11.0 as an engine dev dependency (ADR 0011).
- Blockers: none new.

## 2026-11-22 · F-113 · Claude (autonomous)
- Did:
  - The engine runs in a module Web Worker behind Comlink. A pure `EngineApi` service (`packages/engine/src/service/`) handles open with progress, apply, patches, writes, projections, diagnostics and the palette.
  - The palette and the `window.nfBuilderEngine` test hook go through the worker. The main bundle no longer holds the parser or catalogues (75 kB initial JS).
  - A worker manifest feeds `check:hosts`.
  - A Chromium trace checks that no parsing happens on the main thread.
  - `pnpm bench` and a CI `bench` job report QA-03 and QA-04.
- State: passing.
- Next: F-202 and F-205.
- Decisions:
  - [ADR 0043](../adr/0043-engine-worker.md):
    - Comlink 4.4.2 is a runtime dependency of `@nf-builder/web` only;
    - the service is pure;
    - the main thread keeps only pack versions and palette search;
    - worker chunks are recorded in `.vite/worker-manifest.json`, and `check:hosts` skips JSON worker chunks (amends ADR 0028's rule);
    - worker chunks stay outside QA-01;
    - the page is throttled 4× and the worker runs unthrottled (QA-02 and QA-03 clarified);
    - F-702 gates QA-03, and QA-04 is reported.
  - `.github/workflows/ci.yml` gains a `bench` job, and the `pnpm bench` script is new.
  - First numbers (local): sarek cold open 18.6 s of 30 s; edit p95 271 ms of 100 ms. The cost of re-projection and the double parse is noted in F-702.
  - The bench includes FASTQC under an alias to measure AddCall, since SAREK already calls FASTQC (a process is called once per workflow).

## 2026-11-22 · F-112 · Claude (autonomous)
- Did:
  - Pack lint rules behind a lazy `loadLints()`, and an engine diagnoser that combines parse problems, model diagnostics and the rules.
  - 30 codes, each with lint-recorded fixtures; the 16 lint-origin codes match `nextflow lint` on the fixtures and the whole pinned corpus.
  - nf-lang wording plus advice; text-edit quick fixes for four codes.
  - The oracle and the corpus lint cache now record warnings.
- State: passing.
- Next: F-113, then F-202 and F-205.
- Decisions:
  - [ADR 0042](../adr/0042-diagnostics.md):
    - rules live in the pack, lazily loaded;
    - code origins (lint, paranoid, ours) with lint parity;
    - message style;
    - `QuickFix { title, path, edits }` sharing F-111's `TextEdit`;
    - the v0.1 code set;
    - name-resolution parity deferred, with no new feature.
  - LA-33 amended: a missing argument (`call-arity`) or a `null` for a typed input that isn't nullable (`null-argument`, ours) is an error, an unused output a warning. LA-31 extended. New LA-37. AR-05 and the architecture sketch updated.
  - `duplicate-call` (ours) covers upstream bug 24, on the same branch path only (sarek calls a process in two exclusive `if`s; ternaries and `&&`/`||` count as branches too).
  - Paranoid checks are reported at the spec's severity.
  - No new dependency; diagnostics are in memory.
- Blockers: none new.


## 2026-11-22 · F-011 · Claude (autonomous)
- Did:
  - production hosting moved to GitHub Pages: `pages.yml` builds with configure-pages' base path and the registry snapshot branch, checks, deploys and verifies the live site, with no secrets;
  - the QA-30 policy is in `<meta>` elements stamped into every built page from `scripts/security-policy.ts`, plus `pnpm check:site` and a CI `site` job;
  - preview mirrors Pages, and the e2e tests run under `/nf-builder/`;
  - the app loads and works inside frames, including cross-origin iframes (ADR 0044, at the maintainer's request; the first draft refused to run in a frame);
  - the snapshot plugin is host-neutral and `check:registry --url` samples with cache-busting;
  - Deploy check, the netlify.toml headers and the Netlify verify job are gone, and `netlify.toml` keeps only build settings.
- State: passing (steps 1 and 5 confirmed by the first `verify` runs after merge, Q11); merges once the maintainer enables Pages (#35).
- Next: F-111, then F-112 and F-113.
- Decisions:
  - [ADR 0040](../adr/0040-github-pages-hosting.md) and [ADR 0041](../adr/0041-registry-snapshot-deploy.md) (on `main` since fcc9483).
  - `scope-change`: new feature F-011; F-002 reworded (no SPA fallback or deploy previews; the Pages URL); F-704's URL. Notes appended to F-008, F-501, F-502 and F-607.
  - `.github/workflows/`: `pages.yml` is new and `deploy-check.yml` is deleted; `ci.yml` gains `site`, and `budget` and `hosts` build under `/nf-builder/`; `registry-snapshot.yml` loses `verify` and stops writing `netlify.toml`; `s4-probe.yml` runs on dispatch only.
  - `check:hosts` ignores a CSP directive's closing `;` after a URL.
  - `smol-toml` stays, for `test/netlify-toml.test.ts`.
  - `SITE_CONTEXT` and `SITE_COMMIT` stamp `version.json`.
  - The registry check samples 20 bundles and 5 plugins after deploys; the full check runs before upload.
  - Tests removed with their behaviour, each replaced under ADR 0040 or 0041:
    - `netlify-config.test.ts` moved to `netlify-toml.test.ts` and `security-policy.test.ts`;
    - `check-deploy-headers.test.ts` moved to `check-site.test.ts` (`--allow-newer` dropped: Pages deploys are serialised);
    - the SPA-fallback and header e2e assertions now assert their absence;
    - the S4 pull-request trigger became dispatch-only;
    - the registry `verify` job and hook moved to the `pages.yml` tests.
  - A present but broken registry snapshot fails the deploy (the full `check:registry` before upload) until the next good snapshot; only a missing branch is skipped.
  - [ADR 0044](../adr/0044-embeddable-in-frames.md) (maintainer's decision): no frame guard. An embedded copy has partitioned storage, so its own projects. Embedders grant clipboard and other permissions. Notes for F-202 and F-310.
- Blockers: #35.

## 2026-11-22 · deploy · Claude (autonomous)
- Did:
  - The maintainer enabled GitHub Pages and deleted the Netlify site. F-011 merged (PR #37), and the first `Pages` run deployed https://ewels.github.io/nf-builder/.
    - `verify` confirmed the commit and the meta policy.
    - A sampled `check:registry --url` against the live site passed.
    - A `Registry snapshot` run was dispatched to exercise the snapshot-triggered deploy.
  - F-112 merged (PR #40). M0 and M1 are complete, and 26 of 69 v0.1 features pass.
- Decisions:
  - The maintainer asked for the app to work inside iframes, so F-011 dropped its frame guard before merging ([ADR 0044](../adr/0044-embeddable-in-frames.md)).
- Next: F-202 and F-205 are building; F-203 and F-209 are being planned; F-501 flips after the snapshot-triggered `verify`.
- Blockers: none. #35 asks whether to use a custom domain (before F-202 ships) and to update the repository homepage.

## 2026-11-22 · F-202 · Claude (autonomous)
- Did:
  - Projects in IndexedDB, written from the engine worker: a hand-written wrapper (schema v1, migrations, version handling), a debounced autosaver, and a workspace that wraps the engine service.
  - On the main thread: a store with persistent-storage and quota checks, plus the header project switcher with dialogs, save state, the quota warning, and a note when persistence is refused or the app is embedded.
  - End-to-end tests cover create, edit, reload, saving then saved, the warning, and a cross-origin iframe.
- State: passing once CI is green with the re-approved app-shell baseline.
- Next: F-205, then F-203 (templates) and F-206 to F-209.
- Decisions:
  - [ADR 0045](../adr/0045-projects-in-indexeddb.md):
    - no Dexie (amends ADR 0002);
    - schema v1 and migrations;
    - storage in the worker, with `readFile` and `close` added to the engine API (amends ADR 0043);
    - the IO-01 and IO-03 readings;
    - several tabs: the last write wins;
    - the shared `ewels.github.io` origin, since the maintainer chose no custom domain (#35).
  - `fake-indexeddb` 6.2.8 is a web dev dependency for tests.
  - Project ids fall back to `getRandomValues` where `crypto.randomUUID` is missing, as it is in a frame inside an insecure page.
  - The F-201 UX-01 test now expects an enabled project switcher. This is a behaviour change, not a weakened test, and the app-shell baseline is re-approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-22 · F-205 · Claude (autonomous)
- Did:
  - The canvas. `canvasView` in the engine maps projections to node and edge views, with an interim layered layout.
  - A lazily loaded React Flow 13 canvas with node anatomy, edges styled by dataflow, type tooltips, controls, a minimap and a port-labels toggle.
  - Workflow tabs and a canvas store. Projects opened through F-202 now show on the canvas.
  - The `f205-canvas` fixture covers every node kind. Visual baselines per node kind and for rnaseq-nf-typed were viewed and approved from CI.
- State: passing.
- Next: F-203, then F-206 to F-209.
- Decisions:
  - [ADR 0046](../adr/0046-canvas-rendering.md) covers:
    - `@xyflow/react` 13.0.2 as a new runtime dependency, in a lazily loaded canvas;
    - view logic in the engine;
    - the interim layered layout;
    - the UX-21, UX-22 and UX-24 readings (UX-22 and UX-24 amended);
    - the `window.nfBuilderWorkspace` hook;
    - the corpus step in the Chromium end-to-end leg (`ci.yml`);
    - four IO-41 entries.
  - `scope-change`: F-205 step 1 is reworded. The template check moves to F-203, which now depends on F-205.
  - A licences row for the corpus-derived baselines.
- Blockers: none.

## 2026-11-22 · F-501 · Claude (autonomous)
- Did: confirmed the registry snapshot on live data. The dispatched snapshot run published to `registry-snapshot`, and the Pages deploy it triggered passed `verify` against the live `/registry/`.
- State: passing.
- Next: F-203, F-206 and F-208 in flight.
- Decisions: none.

## 2026-11-22 · F-203 · Claude (autonomous)
- Did:
  - Three pack-owned templates (Start blank, Hello world, Samplesheet to MultiQC), bundled by `pnpm gen:templates` into a lazily loaded `templates.json`. Each is an oracle case run in place and lint-clean.
  - `EngineApi.templates` and `NewProject.template`: the worker copies a template's files into a new project.
  - The New project dialog: name, version, Start blank or From a template, and Publish docs. The header's Templates button opens it.
  - End-to-end tests create from each route; each template's canvas matches a baseline approved from CI.
  - Fixed a race where opening a second project could blank the canvas.
- State: passing once CI is green.
- Next: F-206, F-208, then F-207 and F-209.
- Decisions:
  - [ADR 0047](../adr/0047-project-templates.md) covers:
    - Q6 answered: Start blank, Hello world and Samplesheet to MultiQC;
    - the template format and generator, which is not a stored format;
    - content rules: no substitution or `manifest.name`, blank has no output block, LA-42 `eval` versions, offline test data;
    - the oracle keys `dir`, `lint.clean` and `run.tools`;
    - Publish docs does nothing until F-606;
    - template content under MIT-0, with a licences row.
  - `scope-change`: the nf-core-style skeleton and Pipeline composition move to the new deferred M8 feature F-211.
  - Opening a project keeps the canvas until the new one is current (amends ADR 0046).
  - Start blank works without the template list.
  - F-202's "stored in this browser" check moved to the dialog's unit test; the IndexedDB record test now compares the blank template's files.
  - The F-201 UX-01 test expects an enabled Templates button, and the app-shell baseline is re-approved from CI (ADR 0021).

## 2026-11-22 · F-208 · Claude (autonomous)
- Did:
  - A Graph, Split and Code toggle per tab, with G, S and C shortcuts.
  - A lazily loaded Monaco editor with Shiki highlighting. Edits go to the engine as `ReplaceFileText` after a 300 ms pause, and the graph follows. A refused edit keeps its draft, marked with its problems, and the saved file is untouched.
  - The review found that a refused draft could reach another project's file; the store now numbers project sessions and refuses commands for a closed one.
- State: passing once CI is green with the new baselines.
- Next: F-206, then F-207 and F-209.
- Decisions:
  - [ADR 0048](../adr/0048-code-view-monaco.md):
    - `style-src 'self' 'unsafe-inline'` for Monaco, amending ADR 0040's policy (QA-30 updated); nothing else loosened, no `'wasm-unsafe-eval'`;
    - three runtime dependencies: `monaco-editor` 0.57.0, `shiki` and `@shikijs/monaco` 4.6.0;
    - the editing rules, drafts per session and project, and the AR-30 reading for editor buffers;
    - eight IO-41 entries for URLs in Monaco's chunk.
  - UX-27 now says what Split shows and what happens to a refused edit.
  - Licences rows for Monaco, DOMPurify, the codicons, Shiki and the Nextflow grammars (MIT), which settles the "Check during F-304" row.
  - The `nfBuilderWorkspace` test hook gains `apply`.
  - F-205's canvas baselines are re-approved from CI because the toggle now shows in the tab strip (ADR 0021).
- Blockers: none.

## 2026-11-23 · F-206 · Claude (autonomous)
- Did:
  - Selecting a node on the canvas highlights it and its edges and shows its details: kind, file, description, ports with types and connections, directives, topics, a script preview and its problems. With nothing selected, the pane shows the workflow summary.
  - The view comes from the projection on the main thread; declarations and diagnostics come from a new `details` call to the worker.
  - The review found that the canvas stopped re-fitting after a port-labels toggle; fixed, and F-205's baselines are unchanged.
- State: passing once CI is green.
- Next: F-207; F-209 after F-208.
- Decisions:
  - [ADR 0049](../adr/0049-details-pane.md): the main-thread and worker split, `EngineApi.details` (amends ADR 0043's API list), the AR-30 reading (excerpts with length caps), single selection and its lifetime, the UX-24 highlight, the UX-30 to UX-32 readings (spec clauses added), and two colour tokens.
  - Task 0 wasn't needed: F-112 had already wired the diagnoser into the service.
  - The two details-pane baselines are approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-23 · Parser error position fix · Claude (autonomous)
- Did: fixed the parser's first error landing on an earlier `stub:` or `emit:` keyword when a blank line precedes it and a syntax error comes later in the file; such positions now match `nextflow lint`. Two out-of-order-section cases on the reparse path remain (see the spike S2 addendum). Found through F-208's refused-edit baseline.
- State: fix only; no feature changes `passes`.
- Next: F-208, F-207, F-502, then F-403 and F-209.
- Decisions:
  - The cause is a runtime difference (antlr4ng against Groovy's optimised ANTLR runtime), recorded as an addendum to the [spike S2 note](../research/2026-11-22-spike-s2-parser.md); stage 2 decides SLL fallbacks with two or more exiting alternatives by full LL. ADR 0020 stands.
  - A new malformed fixture, `late-error-after-stub.nf`, and a position check against lint in the corpus test (ADR 0017).
- Blockers: none.

## 2026-11-23 · F-502 · Claude (autonomous)
- Did:
  - `packages/sources`: a registry client with a snapshot implementation, a live implementation and automatic fallback. Live stays off behind `LIVE_REGISTRY = false`, because `registry.nextflow.io` still sends no CORS header (S4 re-run on 2026-11-23).
  - The palette's registry.nextflow.io section: source and age, a refresh button, the unavailable and failure states, and interim module and plugin lists until F-503.
  - The S4 probe, its workflow and its tests are deleted, as ADR 0023 planned.
- State: passing once CI is green with the re-approved app-shell baseline.
- Next: F-207, F-209, then F-403 and F-309.
- Decisions:
  - [ADR 0050](../adr/0050-registry-client.md): the client surface, snapshot validation, HTTP cache only, the live gate and how to turn it on, live overlay rules, the palette states, and the probe deletion (a workflow edit). Amends ADR 0009's "prefers live"; IO-30 and UX-14 updated.
  - `@nf-builder/sources` becomes a dependency of `@nf-builder/web` (ADR 0003 already allows it); `sources` depends on `lang-core` and takes `@types/node` 22.20.5 as a dev dependency; no dependency-cruiser change.
  - The F-204 locator is narrowed to the generic region and F-011 step 2's test checks the app page only; neither assertion is weakened. The base-path test now tolerates only a missing `apps/web/public`.
  - Licences row for recorded registry data extended to the hand-written live fixtures.
  - The app-shell baseline is re-approved from CI (ADR 0021).

## 2026-11-23 · F-209 · Claude (autonomous)
- Did:
  - Undo and redo in the engine worker: one step per command, groups for multi-command actions, limits, and clearing on raw writes. Every change reports the history's labels.
  - Undo and Redo buttons in the tab strip, platform shortcuts that leave text fields, Monaco and dialogs alone, and a live region.
  - The store flushes pending Code-view text before an undo, and captures the session when undo is pressed.
- State: passing once CI is green with the re-approved tab-strip baselines.
- Next: F-207 (merges after this and carries layout keys on undo), F-502, then F-403 and F-309.
- Decisions:
  - [ADR 0051](../adr/0051-undo-and-redo.md): history in the worker (amends ADR 0043's API), step and group model, limits of 100 steps and 8,000,000 units, shortcuts, controls, and the test hook's `apply` signature. It corrects ADR 0039's attribution: history is F-209's and autosave F-202's.
  - AR-23 and UX-70 updated.
  - `scope-change`: F-202 added to F-209's `depends_on`, and F-209 to F-309's.
  - The tab-strip baselines are re-approved from CI (ADR 0021).
  - Commit c594543 on the branch doesn't typecheck on its own; the squash merge hides it.
- Blockers: none.

## 2026-11-23 · F-207 · Claude (autonomous)
- Did:
  - A layout sidecar, `.nf-builder/layout.json` (format v1), owned and written only by the engine. Positions are carried across every change (commands, undo, redo, raw patches) by matching projections with rename and delete hints, so renames keep positions and undo restores the sidecar byte for byte.
  - ELK (elkjs 0.12.1) in its own lazily started worker places nodes without positions; placed nodes stay drawn while it runs, with a 30 s timeout that falls back to columns.
  - Dragging and arrow-key moves save positions; an Auto-layout control; layout notices; the screen-fixed dot grid removed.
- State: passing once CI is green with the re-approved baselines.
- Next: F-403, F-309, then F-703, F-210, F-605 and F-601.
- Decisions:
  - [ADR 0052](../adr/0052-layout-sidecar.md): the sidecar v1 format, engine ownership and `setLayout` (amends ADR 0043's API list; stale writes refused and re-sent once), the carry algorithm and hints (amends ADR 0051's `StepPart`), ELK placement, elkjs as a runtime dependency under EPL-2.0, the timeout and the layered fallback (amends ADR 0046), and the viewport rules answering the F-206 and F-208 notes.
  - `scope-change`: F-202 added to F-207's `depends_on`.
  - IO-02 and the architecture data flow updated; an elkjs licences row.
  - Canvas, shell, template and view baselines re-approved from CI (ADR 0021).

## 2026-11-23 · F-403 · Claude (autonomous)
- Did:
  - Zip import in the engine worker with fflate: the New project dialog's Import route reads a zip, strips one top-level folder, applies the shared limits, ignore list and text check, shows a summary, and creates the project from the selection.
  - `packages/sources/import`: the import core shared with F-401 (limits, paths, ignore list with a non-backtracking matcher, text detection, selection and summary) and the zip reader with bomb guards.
- State: passing once CI is green.
- Next: F-207 and F-309 merging, then F-703, F-210, F-605 and F-601.
- Decisions:
  - [ADR 0053](../adr/0053-zip-import.md): fflate 0.8.3 as a runtime dependency of `@nf-builder/sources` (`unzipSync` only), unzipping in the engine worker from the `./import` subpath, the API additions (amends ADRs 0043 and 0045), the limits table, the folder rule, the default ignore list reading ADR 0009's "test data" as nf-core's root folders, binary files skipped, and a damaged entry aborting the import.
  - IO-11, IO-12, QA-32 and the architecture data flow updated; an fflate licences row.
  - `scope-change`: F-403 added to F-404's `depends_on`, and the deferred M8 feature F-407 "Binary files in projects" added.
- Blockers: none.

## 2026-11-23 · F-309 · Claude (autonomous)
- Did:
  - A problems panel at the bottom of the centre column with Problems and Suggestions tabs, rows grouped by file, a keyboard model and quick-fix buttons; status-bar counts that open it.
  - Quick fixes applied through the engine (`EngineApi.applyFix`) as one undo step, refused when their file has changed.
  - Navigation from a problem to its node (selected and centred) or its code; code-only file tabs (`openFile`) for files without a workflow; a details-pane link to the panel.
- State: passing once CI is green with the approved baselines.
- Next: F-703, F-210, F-605, F-601 and F-401 (plans ready).
- Decisions:
  - [ADR 0054](../adr/0054-problems-panel.md): diagnostics pulled per revision, the panel's placement and session-only state, `EngineApi.applyFix` (amends ADR 0043's API list) with per-file staleness (clarifies ADR 0042), the 64-character cap on fix edits, navigation rules, code-only file tabs, and the step 2 reading.
  - UX-03 and UX-20 updated.
  - Problems panel and status-bar baselines approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-28 · F-703 · Claude (autonomous)
- Did:
  - Read-only mode below 1024 px, detected with one width media query that also measures a frame's own viewport: canvas and details only, a polite note after the header, and every editing control left unrendered (left column, header actions, the switcher's New, Rename and Delete, dialogs, view-mode toggle, history controls, Code pane, Edit and Code, Auto-layout, minimap, quick-fix buttons).
  - Refusals in the page's stores: the canvas store's `send` queue refuses commands, undo, redo and quick fixes with `read-only`; node moves and sidecar saves are dropped; project create, rename and delete throw. Narrowing flushes a pending code edit first; widening restores the controls and each tab's view mode.
  - Side-by-side layout from 640 to 1023 px and a stacked one below 640 px, with no horizontal page scroll down to 320 px.
  - A code-only file tab shows "This file opens in the code view on screens 1024 px or wider." with the code view unmounted; problem navigation selects nodes but doesn't change view modes or reveal code.
- State: passing once CI is green with the approved baselines.
- Next: F-210 and F-401 merging, then F-503, F-605, F-601 and F-301.
- Decisions:
  - [ADR 0056](../adr/0056-read-only-below-1024.md): the 1024 px media query, what read-only shows, flush then guard on narrowing, refusals in the page's stores rather than the worker, no project writes in read-only (the sidecar waits for the next wide open), the layout, the note's copy and focus rule, and WCAG 1.4.4 accepted for v0.1 with an "Edit anyway" decision left to F-701.
  - UX-04 amended.
  - `EngineRefusalCode` gains `"read-only"`, type-only: the worker never returns it (ADR 0043 unchanged).
  - F-202's multi-tab note answered: ADR 0045's last-write-wins per file stands for v0.1, with no Web Locks.
  - `read-only-phone` and `read-only-narrow` baselines approved from CI (ADR 0021).
## 2026-11-28 · F-401 · Claude (autonomous)
- Did:
  - GitHub import of public repositories: a second source, "GitHub repository", in F-403's "Import from" group on the Import route. Review lists the repository with two `api.github.com` requests and shows the summary in the shared `ImportSummaryView`; Import downloads from `raw.githubusercontent.com` (8 in flight, one retry), with progress and Cancel import; closing the dialog aborts an in-flight import.
  - `@nf-builder/sources/github`: ref resolution, tree listing and raw downloads, run in the document. The client checks `content-length` before reading a body (skipped when `content-encoding` is set) and maps malformed tree entries to `GithubError("unexpected")`. F-403's import helpers are reused; only `binary.ts` and `plan.ts` were added in `sources/import`.
  - `WorkspaceApi.importProject` stores the transferred bytes with the project's `source` in one transaction and re-checks the IO-12 limits. `EngineApi.report()` and the Import report dialog show files, parse failures, the legacy share and suggestions.
  - Tests: `e2e/github-import.spec.ts` against a mocked GitHub, with the fetchngs tree fixture generated from git and its blob SHAs checked against the corpus cache. The unit tests' API responses are synthesised from the GitHub docs, since the sandbox couldn't reach the API. The opt-in live test (`F401_LIVE=1`) was not run.
- State: passing once CI is green.
- Next: F-210 merging, then F-503, F-605, F-601 and F-301.
- Decisions:
  - [ADR 0057](../adr/0057-github-import.md): fetching in the document with bytes transferred to the worker (an AR-30 reading); `ProjectMeta.source` as an optional field with no schema version bump, and the rule for when a bump is needed (amends ADR 0045); `EngineApi.report()` and `WorkspaceApi.importProject()` (amend ADRs 0043 and 0045); the `web-worker-no-github-client` dependency-cruiser rule and the `./github` subpath export; F-403's default ignore list shared by both routes instead of the plan's list; limits on the selected files; length checks, no SHA-1 in the app; no token field until F-402; Publish docs hidden for a GitHub import; the report's definitions; mocked e2e evidence with an opt-in live test.
  - IO-10, IO-12, IO-13, UX-60, UX-61 and the architecture data flow updated.
  - Known limitation: a raw 429 without CORS headers is opaque, so it shows as "Couldn't reach GitHub" rather than the rate-limit message.
- Blockers: none.

## 2026-11-28 · F-210 · Claude (autonomous)
- Did:
  - The Files view in the left column's Files tab: the project tree as a WAI-ARIA tree (files before folders, type-ahead, Enter to open), with New file, New folder and Upload, a drop hint, `registry` tags on registry module folders and parse badges.
  - `EngineApi.listFiles`, pulled while the panel is visible and stopped when it is hidden, including in read-only where the left column isn't rendered; tree rows built on the main thread by a pure engine function. A path that is both a file and a folder shows the folder only.
  - A `CreateFile` command for new files and folders, one undo step each; an empty folder is `<folder>/.gitkeep`. `projectPathProblem` moved from F-403's import code into lang-core and shared by new names, zips and uploads.
  - Adding files through the workspace's `stageFiles`, `previewAdd` and `addFiles`: the Add files dialog is always shown, names the target folder, lists replacements and skipped clashes with reasons, and says adding can't be undone and clears the undo history. A pending code edit is flushed first. Loose files take IO-12's limits with binary files skipped; a dropped zip uses F-403's staging with a "Keep the folder" checkbox; dropped folders are refused.
  - Opening files: a script with a workflow opens its canvas tab, anything else a code-only file tab through F-309's `openFile`, and `.nf-builder/**` opens read-only. The tablist ("Open workflows and files") holds only tabs; a closable file tab closes with Delete (`aria-keyshortcuts`) and has an `aria-hidden` pointer-only ×.
  - Read-only guards: adds are refused even when already in flight, `createFile` and `createFolder` are refused through F-703's apply refusal, and the document drop guard stays mounted.
  - Tests: `e2e/files.spec.ts` and unit tests in `packages/engine`, `packages/sources`, `packages/lang-core` and `apps/web`. The property and corpus edit harness now runs 6 fixed examples per command kind before its random runs (no assertion weakened). The Firefox and WebKit `@smoke` run adds the zip through the Upload input, because Playwright's synthetic `DataTransfer` with files crashes Firefox; the drop path is tested on Chromium.
- State: passing once CI is green with the approved baseline.
- Next: F-605, F-601, F-301.
- Decisions:
  - [ADR 0055](../adr/0055-files-view.md): `listFiles` and the workspace's add methods (amend ADR 0043's API list); `CreateFile` (extends ADR 0039 and AR-21); `.gitkeep` for empty folders with no stored-format change; adds as raw writes that clear the history (ADR 0051); IO-12 limits for loose files with no ignore list; F-403's staging plus "Keep the folder" for zips; clash handling; the registry rule from the pack's include check with `local` excluded; badges from parse status, with "Not fully parsed" for verbatim or partial files without problems; file tabs and the tablist rename; the tree keyboard model; read-only refusals.
  - UX-16, UX-20, AR-21, IO-12 and the architecture data flow updated.
  - `scope-change`: F-313 "Files view: rename, move and delete files and folders" added to M3, depending on F-210.
  - `files-view-registry-error` baseline approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-28 · F-503 · Claude (autonomous)
- Did:
  - Registry modules grouped by namespace in the palette, `nf-core` first and the rest in code-point order, each group a collapsible heading with its count; rows show the short name with the full name in `data-name`, the process or workflow glyph with hidden text, and a `typed` tag on typed modules that have a version. Plugins list their ids with `summary` as the title.
  - Lazy loading as windows of 100 rows with a real "Show N more (of T)" button that an `IntersectionObserver` presses as the palette scrolls; growth runs in a transition, and a group's window resets when the group closes.
  - The palette's one search box filters registry modules (name, description, keywords) and plugins (id, summary) through a deferred query; the lists stay visible while searching. The single "No components match" status appears only when nothing matches anywhere; the placeholder reads "Search components and modules".
  - `ports(name)` on the registry client: snapshot-only, `ports.json` read on demand, failed reads retried, concurrent re-reads of a stale file shared.
- State: passing once CI is green with the approved baseline.
- Next: F-605, F-601 and F-301.
- Decisions:
  - [ADR 0058](../adr/0058-registry-palette.md): namespace groups and order, short labels, 100-row scroll-loaded windows with no new dependency, shared search, the message rule, session-only group state, and snapshot-only `ports()` (amends ADR 0050: interim lists replaced, `ports` added).
  - UX-14 updated.
  - F-502's e2e locator reads `data-name` and expects nf-core first; the names and counts it asserts are unchanged. F-502's interim-list unit test replaced, as F-502's note asked.
  - App-shell `@visual` baseline re-approved from CI (ADR 0021).
## 2026-11-28 · F-605 · Claude (autonomous)
- Did:
  - Markdown files (`.md`, `.markdown`) open in a file tab in Preview, with Split and Code. The preview is GitHub-flavoured Markdown, raw HTML included, sanitised and built in a lazy chunk that never loads Monaco; it follows Split edits and undo, and project links open files through the new `canvasStore.openPath`.
  - Render pipeline: marked, then a raw-HTML pre-filter that drops `on*` attributes and `<base>` from raw-HTML tokens only (to keep Chromium's CSP report log quiet; DOMPurify stays the sanitiser), then a parse into an inert `<template>` document with `createContextualFragment` (no `DOMParser`, which made Chromium report CSP violations under the page's policy), then DOMPurify with `IN_PLACE`, then the link, image and input rewrites, then import into the page. Images are `data:` only, other images become placeholders; links with backslashes are inert; `id` and `name` are prefixed `user-content-`.
  - Other text files open in Monaco with the language from their extension (13 extra Shiki grammars in one lazy chunk); HTML, SVG and unknown files open as plain text.
  - `.nf` files with no workflow open in Code with a "Declarations" outline in the details pane from the new `EngineApi.outline`; rows reveal the declaration.
  - Read-only below 1024 px: a Markdown tab shows the sanitised preview only; other files keep the note; outline rows are plain text.
  - Tests: `e2e/markdown.spec.ts` (step 1 tagged `@smoke`), unit tests in `apps/web/test/` and `packages/engine/test/`, oracle case `f605-library`. F-210's end-to-end test now expects README in Preview.
- State: passing once CI is green with the approved baseline.
- Next: F-301, F-601, then F-404, F-405, F-505.
- Decisions:
  - [ADR 0059](../adr/0059-markdown-and-text-files.md): marked 18.2.1 and DOMPurify 3.4.18 pinned as runtime dependencies of `@nf-builder/web`, jsdom 31.0.1 as a web dev dependency (licence rows added); the render pipeline, with DOMPurify `IN_PLACE` instead of the plan's `RETURN_DOM_FRAGMENT` (3.4.18 hardens `IN_PLACE`, and `RETURN_DOM_FRAGMENT` re-parses through `DOMParser`); the sanitising, link and image rules; the IO-41 reading of user links; AR-30 extended to the preview; Preview, Split and Code with positional G, S and C; the language set; `EngineApi.outline` (amends ADR 0043's API list); the read-only preview (amends ADR 0056).
  - FI-30, FI-31, FI-32, UX-04, UX-27, AR-30 and the architecture data flow updated.
  - `scope-change`: F-605's step 2 ("A .png in the project is listed but not opened") moved to the deferred M8 feature F-407 "Binary files in projects", since v0.1 projects hold text files only (ADR 0045).
  - `markdown-preview` baseline approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-28 · F-301 · Claude (autonomous)
- Did:
  - Palette rows are native buttons: tabbable while their category is open, described to keyboard users by a hidden span, draggable when they can be added. Dropping Process or Workflow on the canvas, or pressing Enter or Space on it, creates `modules/local/new_process/main.nf` or `subworkflows/local/new_workflow/main.nf`, includes it and calls it in the open workflow, as one undo step. The new node is selected, the Files view reveals the file, focus stays on the palette item, and a polite live region in the palette announces the result (repeated messages are announced again).
  - Engine: a `CreateWorkflow` command sharing `createDefinition` with `CreateProcess`; `Scaffold.workflow` in the 26.10 pack; `paletteAction`; `EngineApi.freshName` (`NEW_PROCESS`, `NEW_WORKFLOW`, then `_2`, …); `undo(revision, { discard: true })`, which leaves no redo step.
  - Canvas store: `addFromPalette` runs the fresh name, the create and `AddCall` as one queued task under one group; a refused or throwing `AddCall` rolls the create back with `discard`, so nothing changes. The node's centre lands on the drop point or the viewport centre, set in the same update as the projection and saved with `setLayout`, so ELK never places it; an `addsPending` counter keeps the viewport for every view while an add is pending. Adds are refused in read-only (F-703), on a file tab and with no project.
  - Drag data uses the custom MIME type `application/x-nf-builder-palette`; F-210's drop guard still acts on `Files` drags only.
  - Tests: `e2e/palette-add.spec.ts`; unit tests in `packages/engine`, `packages/lang-2610` and `apps/web`; oracle case `f301-palette-adds` (lint clean, `run -stub`), matched byte for byte by the e2e test and the engine golden from `template-blank`.
- State: passing once CI is green.
- Next: F-601, F-404, then F-302, F-303, F-307.
- Decisions:
  - [ADR 0060](../adr/0060-palette-adds.md): `CreateWorkflow` and `Scaffold.workflow` (amend ADR 0039 and AR-21), with the scaffold `nextflow.enable.types = true\n\nworkflow NAME {\n}\n` taken from the blank template's precedent and proved by oracle case `f301-palette-adds`, since the typed-workflow docs don't show it verbatim; `EngineApi.freshName` and `undo`'s `discard` option (amend ADR 0043's API); the discarding rollback of a half add (amends ADR 0051's history rules); the viewport kept for every view while an add is pending (amends ADR 0052's viewport rule); default names `NEW_PROCESS` and `NEW_WORKFLOW`; placement by node centre; Process and Workflow only, other items focusable and `aria-disabled`; the custom MIME type; the live region instead of a second `role="status"`.
  - UX-15 and AR-21 updated.
  - Step 3's "exported result" read as the project's files, checked against the oracle case; F-404 repeats it on a zip.
  - `scope-change`: F-314 "Add the remaining palette items" (factories, records, enums, functions, includes, params, output, Exec process, Agent, Include pipeline) added to M3, depending on F-301. The F-111 alias note moved to F-310 and F-504.
  - No visual baseline changed.
- Blockers: none.

## 2026-11-28 · F-404 · Claude (autonomous)
- Did:
  - The header's Export button opens an Export dialog (UX-62): the file name, the file count, "Include the layout (.nf-builder/layout.json)" checked by default (disabled with a note when there is no sidecar), warnings for case-only and file-and-folder path clashes (export still runs), and a note when the project was imported. Errors show inline; success closes the dialog and returns focus. Export stays hidden in read-only (ADR 0056); the header's Import button stays disabled for F-406.
  - `WorkspaceApi.exportProject({layout})` in the engine worker, inside `serial`: pending Code-view edits are flushed first, every file's stored text is read at one revision and zipped with fflate `zipSync` from the new lazily loaded `@nf-builder/sources/export` subpath; the bytes are transferred to the page and downloaded through a blob URL revoked after 60 s.
  - The zip: every entry under `<slug>/`, `<slug>.zip` (unsafe characters replaced, at most 100 characters, `project` when empty, `-project` added to names the importer skips or Windows reserves), UTF-8 names, export-time timestamps, default compression, no folder entries; 0755 for the root `bin/` and `resources/usr/bin/`, 0644 otherwise, made on Unix; files byte-identical to the stored text, BOM and CRLF included. `exportClashes` in lang-core, re-exported from `@nf-builder/engine`.
  - Tests: `e2e/export.spec.ts` (steps 1 to 3, typed-then-exported text, layout unticked, CSP at top level and in a frame); unit tests in `packages/sources/test/export/`, `packages/lang-core/test/paths.test.ts` and `apps/web/test/` (workspace export, dialog, store, download, expose, header).
- State: passing once CI is green.
- Next: F-601, F-302, then F-303, F-307, F-405, F-505.
- Decisions:
  - [ADR 0062](../adr/0062-zip-export.md): the exported format (one top folder, name rule, modes, timestamps, compression, no folder entries, byte-identical text); `WorkspaceApi.exportProject` and the `./export` subpath with `zipSync` (amends ADR 0053's "only `unzipSync`" and the API lists of ADRs 0043 and 0045); module binaries under `resources/usr/bin/` executable, confirmed in the Nextflow docs; clash warnings without blocking; the imported-project note; flush before export; the 60 s URL lifetime; no re-import limit checks in v0.1. Confirms ADR 0008's sidecar default (step 3); ADR 0008's body is unchanged.
  - IO-20, IO-21 and UX-62 updated.
  - Step 2 reuses the CI-linted oracle pair `f208-code-edit` and `f208-code-edit-after`; ADR 0011's edited-corpus-export lint is a follow-up needing a `corpus-parse` workflow step (Q17 in `open-questions.md`).
  - Notes appended to F-406 (reuse the writer and name rule; the Import button) and F-407 (export binary files once stored).
  - `@visual` baselines that show the enabled Export button are re-approved from CI (ADR 0021) and listed in the PR.
- Blockers: none.

## 2026-11-28 · F-601 · Claude (autonomous)
- Did:
  - Config tabs: `openFile` opens a `.config` file in a config tab with Form, Split and Code through the shared `modesFor` (G, S and C); Form loads no Monaco. The entry workflow's summary links the root `nextflow.config`. Below 1024 px a config tab shows the F-703 note.
  - The form: a card per scope in source order; first-class forms for `manifest`, `params`, `process` (defaults, `resourceLimits`, `withName` and `withLabel` selectors with "used by N processes"), `profiles`, `plugins`, `docker`, `singularity`, `apptainer`, `conda`, `wave` and `executor`; generic typed forms for every other catalogue scope; Add scope…, Add option…, Add selector…, Add profile…, Add plugin…; values the form can't model shown as read-only code with Edit in code and Set a value; read-only while the file has parse problems. Option docs, types and a docs link in the right pane through a minimal safe Markdown renderer; include rows open the included file in its own config tab.
  - Engine: `EngineApi.configView` and `configSchema`; five config commands, each one statement-level `TextEdit`, with the placement rules, labels and refusals; the process-use index and `ConfigSelectorResolver` matching.
  - lang-2610: a port of nf-lang's `ConfigFormattingVisitor` (default options) as the config printer, with corpus parity against `lint -format` and three known rnaseq differences; the `config-unknown-option` warning mirroring Nextflow's run-time `ConfigValidator`; form layouts and verified docs URL rules.
  - Tests: `e2e/config.spec.ts` (both steps and FI-01 to FI-06), oracle cases `f601-config`, `f601-config-after`, `f601-unknown`, `f601-unknown-after`, `f601-selectors`, `f601-forms`, `f601-forms-after` and `f601-plugins`, config command goldens and property tests, the edit harness's fixed examples for every config command kind, corpus tests (printer parity, every printed config parses, view excerpts) and unit tests in `apps/web/test/`.
- State: passing once CI is green.
- Next: F-302, F-405, then F-303, F-307, F-505, F-406.
- Decisions:
  - [ADR 0061](../adr/0061-config-editor.md): the five config commands (AR-21 amended), each one `TextEdit` at statement level (amends ADR 0039's reprint level for configs, refines ADR 0032); the placement rules, with new top-level blocks at the end of the file; `8.GB`, `2.h` and single-quoted literals; `EngineApi.configView` and `configSchema` with excerpts of at most 160 characters (amends ADR 0043's API list); the form read-only while the file has parse problems.
  - The config printer ports `ConfigFormattingVisitor`; deliberate deviations from `lint -format`: it keeps typed closure parameters and the quotes of non-identifier option names (upstream bugs 25 and 26, recorded in `docs/research/upstream-bugs.md`). Commands still refuse new non-identifier option names.
  - `config-unknown-option` mirrors Nextflow's run-time `ConfigValidator` (FI-03 amended); it skips a map assigned to a whole scope and checks core plugin scopes the catalogue lists (such as `wave`), both on purpose. FI-06 selector counts follow `ConfigSelectorResolver` (FI-06 amended).
  - Option descriptions go through a minimal safe renderer (no HTML, `https` links only); "Open in Nextflow docs" always resolves under `https://docs.seqera.io/nextflow/` (FI-04).
  - Configs open through `openFile` and a "Configuration" link in the entry summary (UX-31 amended); config tabs have Form, Split and Code (UX-27 amended); UX-04, FI-01, FI-02, FI-04, FI-05 and the architecture overview's note on file text updated.
  - Step 2's "imported" is read as a project created from existing files, as settled in the handoff README.
  - `docs/licences.md`: the ported `ConfigFormattingVisitor` in the nf-lang formatter row; new rows for the `ConfigValidator` and `ConfigSelectorResolver` logic and for the selector fixture's shapes adapted from `config.mdx` (all Apache-2.0).
  - Notes appended to F-210, F-309, F-314 (the remaining Plugins & config palette items stay with F-314), F-505, F-602, F-607, F-701, F-702 and F-703.
  - The `config-form` and `config-details` baselines are approved from CI (ADR 0021).
- Blockers: none.

## 2026-11-28 · F-405 · Claude (autonomous)
- Did:
  - The workflow summary gains a "Modelled" section from `projectionCoverage` ("165 of 184 statements (89%)", rounded down; "All N statements (100%)"; "No statements") and a "Suggestions" section: the suggestions inside the open workflow's own range (`workflowSuggestions`), with "Show suggestions" opening the Suggestions tab at the first. The count shows only when the diagnostics revision matches the projection's ("Checking for suggestions…" otherwise); the section is left out when the diagnostics pull failed.
  - `EngineApi.diagnostics()` returns `registry`, the project's registry folders (worker API only, not stored). The problems panel lists registry module files after the project's own files, under a "Registry modules (N suggestions)" heading, each with a `registry` tag; counts are unchanged.
  - The summary's "Registry modules" list now uses the panel's rule, `registryModuleOf(callee.path, registry)` (ADR 0055), instead of `callee.module`, because rnaseq includes its nf-core modules by relative path and `callee.module` is null for them (a deviation from the plan's 4.2 and 4.4).
  - Tests: `e2e/legacy-import.spec.ts` imports nf-core/rnaseq 3.28.0 through the mocked GitHub route with `repoFromFiles` (no typed badge on the legacy calls, status-bar suggestions equal to the engine's and the report's, registry groups last, RNASEQ 165 of 184 statements); `packages/engine/test/corpus/legacy-import.corpus.ts`; unit tests in `packages/engine` and `apps/web`.
- State: passing once CI is green (PR #61).
- Next: F-302, F-601, then F-303, F-307, F-505, F-406.
- Decisions:
  - [ADR 0063](../adr/0063-legacy-import-summary.md): the modelled share counts statements and rounds down; the per-workflow count covers the workflow's own suggestions only; registry module files are grouped after the project's own, not filtered (amends ADR 0054's file order); `DiagnosticsResult.registry` (amends the worker API of ADRs 0043 and 0054); the summary's registry modules found by folder (amends ADR 0049's summary contents).
  - UX-31 and UX-03 updated.
  - Vendored `subworkflows/nf-core/**` stay with the project's own files (ADR 0055 unchanged); note appended to F-504.
  - `details-entry-summary` and `read-only-phone` baselines re-approved from CI (ADR 0021).
## 2026-11-28 · F-302 · Claude (autonomous)
- Did:
  - Connect by drag (UX-25): drags start only from outputs; a drop applies `Connect` as one undo step and rewrites a fed input's argument. While dragging, the worker's dry run marks every input: refused targets dim and reject the drop, mismatched ones dim with a red ring and accept it (LA-29); a refused drop shows "Couldn't connect: <message>" in the canvas notices. The viewport is kept after a connect or disconnect.
  - Engine: `planConnect` makes every check `Connect` makes short of the reprint, comment loss included, and `EngineApi.connectionTargets` runs it per input port with the pack's `connection` and `tupleArity` checks. The dry run predicts the argument count after the connect: `ok` while the count stays wrong, `mismatch` only when it becomes right, as lint checks types only then.
  - Mismatch edges (UX-24, QA-12): `edgeMismatches` maps `type-mismatch` and `tuple-arity` diagnostics at the projection's revision to edges, drawn in the error colour, thicker, above the selection highlight, with a midpoint "!" glyph, the message in the tooltip and the aria label.
  - Disconnect: canvas-local edge selection (click or Enter selects, Escape, a pane click or focus leaving clears); Delete or Backspace applies `Disconnect`. Deletable edges are `role="button"` with `aria-pressed`. The F-206 tests are unchanged. Read-only: no connection, no edge selection or Delete.
  - LA-14: pack code `tuple-arity` (origin `ours`, error) and `Port.components` in lang-core.
  - Tests: `e2e/connect.spec.ts` (all three steps, refused targets, edge keys, viewport, read-only, CSP, the `connect-mismatch` baseline), oracle cases `f302-connect-start`, `f302-connect-typed` and `f302-connect-mismatch` with engine goldens, `type-mismatch` record and `tuple-arity` lint fixtures, and unit tests in `packages/engine/test/`, `packages/lang-2610/test/lints/` and `apps/web/test/`.
- State: passing once CI is green.
- Next: F-303, F-307, F-505, F-406.
- Decisions:
  - [ADR 0064](../adr/0064-connect-ports.md): drag from outputs only; the `planConnect` dry run and `EngineApi.connectionTargets` (amends ADR 0043's API list); refused and mismatch target states; mismatch red with a glyph as the second cue; canvas-local edge selection and Delete; viewport kept after a connect or disconnect (amends ADR 0052); `tuple-arity` (amends ADR 0042's code set, now 31 codes) and `Port.components`. ADR 0063 is taken by F-405's open branch.
  - The oracle confirmed the pinned lint reports `Path` into a `Sample` record input, so `type-mismatch` stays lint-origin. The pinned `nextflow lint` 26.10.7 doesn't check tuple arity (checked), so `tuple-arity` has no lint pattern.
  - UX-24, UX-25 and LA-14 updated.
  - Known: Disconnect after a Connect that introduced `x = P()` leaves `x` unused, which lint reports as an unused-variable warning; follow-up noted on F-310.
  - Notes appended to F-308, F-310, F-504 and F-701.
  - The `connect-mismatch` baseline is approved from CI (ADR 0021); no existing baseline changed.
- Blockers: none.
