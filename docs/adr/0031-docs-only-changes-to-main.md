# 0031. Push docs-only changes straight to main

- Status: Accepted
- Date: 2026-11-22

## Context

Every change has gone through a branch, a pull request, CI and a squash merge, including small ADR updates, plans, progress entries and spec wording. For changes that touch no code, that adds a CI round trip and merge conflicts in `progress.md` without catching anything `pnpm check` doesn't already catch locally (ADR lint, `features.json` validation, the AGENTS.md tests). The maintainer decided on 2026-11-22 that docs-only changes may go straight to `main`.

## Decision

- Docs-only changes may be committed and pushed directly to `main` after `pnpm check` passes locally: files under `docs/` (ADRs, spec, plans, research, `progress.md`, `open-questions.md`), `AGENTS.md`, `CLAUDE.md` and package READMEs.
- Anything else goes through a pull request with green CI and a review, as before: code, tests, workflows, configuration, dependencies, generated files and `features.json` (the Scope guard checks it on PRs).
- A docs change that belongs to a feature still travels in that feature's PR.

## Consequences

- Fewer PRs and fewer `progress.md` merge conflicts; ADRs and plans land as soon as they're written.
- A docs-only push gets no Deploy check run; the site doesn't change.

## Alternatives

- Keep every change in a PR: slower, with CI re-running checks that `pnpm check` already ran.
- Allow small code changes on `main` too: CI is the authority for code (ADR 0015).
