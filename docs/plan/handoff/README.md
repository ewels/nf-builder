# Hand-off plans

Working plans written by the planner agent on 2026-11-21 for features not yet built, committed so a new session can start without re-planning. They are inputs, not decisions of record: each plan's open points are settled below, and the decisions still have to be recorded (ADR, `open-questions.md`, `progress.md`) in the feature's PR as AGENTS.md says. Delete a plan in the PR that merges its feature.

Plans were written against `main` before F-009 merged, so some say "after F-009 merges": it has.

## Run these in parallel (ADR 0018: up to three independent features)

F-005, F-006 and F-201 don't depend on each other. F-005 and F-006 both touch the Nextflow pin, `ci.yml` and `test/workflows.test.ts`: merge one, then rebase the other.

## Decisions already taken on each plan's open points

### F-005 (spike S1) — merged in #13, plan deleted

- The plan says "ADR 0018" for its own decisions; ADR 0018 is now taken (parallel features and local Nextflow, which already records the local-run permission). Write the oracle tool and its hosts as the next free ADR number, amending the ADR 0003 tools table for `tools/oracle`.
- Nextflow pin: put the version and SHA-256 in `packages/lang-2610/upstream.json` (see F-006 O6), not in `tools/oracle/oracle.yaml`; the oracle reads it by path (tools can't import packages).
- Reuse F-009's `actions/cache` pin (`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`, v6.1.0).
- `.module-info`: format confirmed; writing it is deferred to F-504.
- LA-14: if the cases pass, drop the warning via ADR 0007's spike result section; no new ADR. Say so in the PR.
- Keep all six cases. The oracle also lints `tools/corpus/fixtures/` against `fixtures.yaml` (F-005 notes).

### F-006 (spike S2) — [plan](plan-F-006.md)

- O1: new ADR for `antlr4ng` (runtime) and `antlr-ng` (dev), pinned exactly.
- O2: the `corpus-parse` and `catalogue` CI jobs block merges.
- O3: accept the 26.10.4-based catalogue (language server v26.10.2) against the 26.10.7 grammar; record it in ADR 0005's spike result.
- O4: single-file Java extractor; pin the language server jar by SHA-256.
- O5: record build-time hosts (GitHub release downloads, raw.githubusercontent.com) per ADR 0017.
- O6: one home for the Nextflow pin: `packages/lang-2610/upstream.json`. Coordinate with F-005.
- O7: add NOTICE and `docs/licences.md` entries for the grammar, generated parser, ported classes and catalogue text.
- O8, O9, O10: commit the generated parser; `@ts-nocheck` on generated files if needed; deliver F-101 steps 2 and 3 here if cheap.
- O11: nf-lang has no lexer tests; F-101 ports parse cases from `ScriptAstBuilderTest` and `ConfigAstBuilderTest` instead. Record that in `open-questions.md` when F-101 lands.
- O12 to O16: accept the plan's recommendations.

### F-201 (app shell) — [plan](plan-F-201.md)

- Hand-roll resizing; no `react-resizable-panels`.
- `zustand` 5.1.0 (named in ADR 0003; a Decisions line is enough).
- Record the `nf-builder:layout` localStorage format (version 1) in the F-201 ADR.
- Visual baselines: the plan's label-triggered `Visual baselines` workflow that renders in CI and commits to the branch. With wider network access, downloading the CI artifact may also work; use whichever is simpler. The orchestrator approves by viewing the image.
- System fonts; widths and limits as the plan proposes.
- F-113 and F-701 notes already carry the plan's follow-ups.
