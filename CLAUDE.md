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
5. Open the PR. Wait for CI (`gh pr checks --watch`); send failures to `researcher`, then `builder`. When CI is green and the reviewer has nothing blocking, squash-merge, delete the branch and pull `main`.
6. Start the next feature. Continue until every feature passes, including F-705.

Before a significant call you're making for the maintainer, ask `researcher` for the options and evidence, then decide and record it (AGENTS.md, Decide and record).

The run is long and your context will be compacted. Keep state in files, not memory: after each merge, re-read AGENTS.md "Every session" and the last `progress.md` entries.

Run one builder at a time. Researchers can run in parallel. Subagents don't see this conversation, so give each one the feature ID, the task, the relevant plan section and file paths.
