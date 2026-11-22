# 0030. Defer private GitHub import and report the timing budgets instead of gating them

- Status: Accepted
- Date: 2026-11-22

## Context

The maintainer reviewed what was making the build slow and complex (2026-11-22, in the build session). Importing private repositories needs token handling (IO-15, QA-33) and a private test repository and token only the maintainer can provide. F-702 required every performance budget to pass as a CI gate; QA-02 (time to interactive under throttling), QA-04 (edit latency) and QA-05 (canvas frame times) are timing measurements on shared runners that tend to force late tuning and flake. ADR 0029 already relaxed QA-03.

## Decision

- **F-402** (private GitHub import with a token) moves to milestone M8, deferred past v0.1. Features in M8 stay in `features.json` but don't count towards finishing v0.1; the autonomous run ends when every M0 to M7 feature passes (AGENTS.md, CLAUDE.md). Public import (F-401) stays.
- **Budgets:** QA-01 (bundle size), the QA-03 ceiling and QA-06 (snapshot size) fail CI when exceeded. QA-02, QA-04 and QA-05 are measured in CI and shown in the budget report, but don't block merges. F-702's step changes to match.

## Consequences

- One feature less in v0.1, and no maintainer-only secret on the path to the release.
- Timing regressions show in reports rather than failing PRs; someone has to read the report.

## Alternatives

- Keep F-402: needs a private test repository and token from the maintainer, and token-storage work, for a feature most first users won't need.
- Keep all budgets as gates: timing on shared runners varies, so gates would flake or need generous margins.
