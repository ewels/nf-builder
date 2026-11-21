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
