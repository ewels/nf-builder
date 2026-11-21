# 0012. Agents work one feature per session against a fixed feature list

- Status: Accepted
- Date: 2026-11-21

## Context

Long agent-built projects fail in known ways:
- trying to do everything at once;
- declaring victory early;
- marking work done without testing it end to end;
- leaving broken state for the next session.

The fixes are well documented: a lean `AGENTS.md`, a fixed feature list, a progress log, one feature per session, mechanical checks, and human review. See [research](../research/2026-11-21-nextflow-language-and-tooling.md#agent-built-projects).

## Decision

- **Guides:**
  - `AGENTS.md`: short, written by hand, with commands, boundaries and the definition of done. `CLAUDE.md` just imports it.
  - Spec and ADRs.
  - Nextflow facts come from the pack catalogue, docs.seqera.io, and the `seqeralabs/nextflow-plugin` skills, never from memory.
- **Scope:**
  - `docs/plan/features.json` is the full scope. Agents may only set `passes` and add `notes`. Anything else needs the `scope-change` label.
  - `docs/plan/progress.md` is an append-only session log.
- **Session:**
  1. Read the log, `git log` and the feature list.
  2. Take the first open feature whose dependencies pass.
  3. Run `pnpm smoke`.
  4. Build on `feat/<id>`, running `pnpm check` and the feature's e2e test.
  5. Set `passes`, log the session, open a PR.
- **Roles (Claude Code):** an Opus main session orchestrates. Subagents in `.claude/agents/`: Opus for research, planning, review and simplification; Sonnet for building from a plan. Only the builder writes product code. Details in `CLAUDE.md`.
- **Autonomous mode** (maintainer's decision, 2026-11-21): one long-running session works through the whole feature list without waiting for the maintainer.
  - It makes the maintainer's calls itself. Each becomes an ADR marked `Accepted (agent)` or a dated answer in `open-questions.md`, and is listed under Decisions in that session's `progress.md` entry. The maintainer reviews them later and may supersede any.
  - It merges its own PRs (squash) once CI is green and the reviewer reports nothing blocking. It never pushes to `main` directly.
  - It skips a feature that needs something only the maintainer can provide (a secret, a GitHub or Netlify setting), opens an issue labelled `maintainer`, and moves on. It stops when every feature passes or everything left is blocked.
- **Review:**
  - A fresh-context reviewer agent checks each branch before its PR is merged.
  - A review comment that comes up twice becomes a rule in `AGENTS.md` or a check.

## Consequences

- Progress doesn't wait for the maintainer. The price is that mistakes reach `main` before a human sees them; small PRs, CI, the reviewer and the decision log keep them findable and revertible.
- The feature list must be good up front. Reviewing it is part of M0.

## Alternatives

- A human merges every PR: safer, but the maintainer becomes the bottleneck. This was the original plan; switching back means removing the autonomous-mode bullet.
- One long run without per-feature PRs: unrecoverable when it goes wrong.
- Markdown task lists: agents rewrite them freely.
