# 0011. Test against real pipelines, with real Nextflow and nf-docs as oracles

- Status: Proposed
- Date: 2026-11-21

## Context

Agents write nearly all the code and grade their own work generously. The riskiest behaviour (parsing, round trips, edits, generated code) can be checked against ground truth.

## Decision

| Layer | What | Runs |
|---|---|---|
| Static | `tsc`, Biome, dependency-cruiser | every change |
| Unit | Vitest per package, including lexer cases ported from nf-lang | every change |
| Properties | fast-check on edit commands. Each result must parse, untargeted declarations stay equivalent, and undo restores the snapshot | every change |
| Corpus | Pinned real pipelines in `tools/corpus/corpus.yaml` (nf-core/rnaseq, sarek, fetchngs, rnaseq-nf and its typed branch, plus malformed fixtures), fetched and cached. Checks parse rate, equivalent round trip and projection snapshots | pre-push, CI |
| Nextflow oracle | Docker `nextflow/nextflow:26.10.x`. Runs `nextflow lint` on templates, edit outputs and edited corpus exports, and `lint -format` diffs on printer fixtures | CI |
| Docs oracle | nf-docs `--format json` on every template: every description we wrote must appear. `nf-metro validate` on every generated `.mmd` (ADR 0013) | CI |
| End-to-end | Playwright runs each feature's `steps` from `features.json`. A feature only passes with its e2e test | CI |
| Visual and accessibility | Screenshot baselines; axe; keyboard paths | CI |
| Budgets | Bundle size, load time, parse and edit timings (`docs/spec/quality.md`) | CI |

Rules:
- Never delete or weaken a test or baseline without the maintainer's approval in the PR.
- Every bug fix comes with a test that failed before the fix.

## Consequences

- The oracles need Docker and network, so they run only in CI. Agents use the fast layers locally.
- Corpus pins are bumped deliberately, in their own PRs.

## Alternatives

- Unit tests only: miss the integration failures that matter most here.
- Committing the corpus: bloats the repo.
