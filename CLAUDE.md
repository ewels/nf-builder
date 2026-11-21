@AGENTS.md

## Claude Code roles

The main session runs on Opus (`.claude/settings.json`) and orchestrates: it reads, decides, delegates, commits and talks to the maintainer. It writes docs and `progress.md` itself and leaves product code to the builder.

Subagents live in `.claude/agents/`:

| Agent | Model | Use for |
|---|---|---|
| `researcher` | Opus | Nextflow and library questions; finding the cause of a failure |
| `planner` | Opus | Turning the feature into files, interfaces, tests and tasks |
| `builder` | Sonnet | Implementing one planned task |
| `reviewer` | Opus | Fresh-context check of the branch against the feature, spec and ADRs |
| `simplifier` | Opus | Proposing removals and simplifications |

For each feature:

1. `planner` writes the plan. Settle anything it flags for the maintainer before building.
2. For each task, `builder` implements it. Check `pnpm check` yourself, then commit.
3. If the builder is stuck, or a check fails twice, ask `researcher` for the cause instead of guessing, then give the builder a corrected task.
4. Run `reviewer`, then `simplifier`. Send the fixes you accept to `builder` as new tasks. Run `reviewer` again if they were substantial.
5. Open the PR.

Run one builder at a time. Researchers can run in parallel. Subagents don't see this conversation, so give each one the feature ID, the task, the relevant plan section and file paths.
