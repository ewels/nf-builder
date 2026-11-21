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
