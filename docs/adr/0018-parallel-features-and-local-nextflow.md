# 0018. Allow parallel features and local Nextflow runs

- Status: Accepted
- Date: 2026-11-21

## Context

The maintainer reviewed two rules that were slowing the autonomous build (2026-11-21, in the build session):
- ADR 0012's session routine takes one feature at a time, and `CLAUDE.md` allowed one builder at a time. Several open features (the M0 spikes, the app shell) don't depend on each other.
- ADR 0011's consequences say the Nextflow oracle runs only in CI, and AGENTS.md said not to run it locally. The agent sandbox has Java 21 and can download the Nextflow release jar from GitHub releases; `nextflow lint` and `run` work there offline.

## Decision

This amends ADR 0011 and ADR 0012; everything else in them stands.

- **Parallel features:** up to three features may be in progress at once when none depends on another. Each has its own branch, git worktree and PR, and goes through the same plan, build, review and merge steps. Builders for different features may run at the same time; one builder per feature.
- **Local Nextflow:** agents may run Nextflow (and the catalogue generator) locally for a faster loop, using the release jar `nextflow-<version>-dist` with `NXF_HOME=.cache/nextflow/home NXF_OFFLINE=true`. CI still runs the oracle on every PR; a local result never replaces it. F-005 pins the version and adds a wrapper.

## Consequences

- Wall time drops where features are independent; `progress.md` and `features.json` need merging more often.
- Local lint catches Nextflow mistakes before CI; CI stays the authority.

## Alternatives

- Keep both rules: slower, with every Nextflow check waiting on a CI round trip.
