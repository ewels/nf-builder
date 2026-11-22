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
