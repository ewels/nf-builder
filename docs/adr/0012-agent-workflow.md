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
- **Review:**
  - A fresh-context reviewer agent comments on each PR.
  - A human merges; agents never merge.
  - A review comment that comes up twice becomes a rule in `AGENTS.md` or a check.

## Consequences

- Steady progress over many sessions. Human review is the deliberate bottleneck, kept quick by small PRs.
- The feature list must be good up front. Reviewing it is part of M0.

## Alternatives

- Long autonomous runs with one final review: unrecoverable when they go wrong.
- Markdown task lists: agents rewrite them freely.
