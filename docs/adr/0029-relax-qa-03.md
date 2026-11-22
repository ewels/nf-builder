# 0029. Let opening a large project take longer, as long as the app stays responsive

- Status: Accepted
- Date: 2026-11-22

## Context

QA-03 asked for nf-core/sarek (pinned) to be parsed and modelled in the worker in at most 3 s. Spike S2 ([report](../research/2026-11-22-spike-s2-parser.md)) measured the generated parser on sarek's 275 files: 15.9 s for the first parse in a process and 1.1 s afterwards. The first-parse cost is ANTLR building its prediction cache for real ambiguities in Nextflow's grammar; Nextflow's own Java parser pays it too. Meeting 3 s would take lazy parsing, caching and possibly grammar changes, adding complexity to the engine worker (F-113). The maintainer decided on 2026-11-22 that a slower first open is fine if the app stays usable and says what it is doing.

## Decision

QA-03 becomes: while the worker parses and models a project, the canvas and the rest of the UI stay responsive, and the app shows loading progress (for example files parsed out of the total). Parsing and modelling nf-core/sarek (pinned) in the worker finishes within 30 s on the CI reference profile; the ceiling only catches regressions.

## Consequences

- F-113 runs parsing in the worker and reports progress; lazy parsing, parse caches and grammar restructuring aren't needed for v0.1.
- F-702 checks the new QA-03 ceiling instead of 3 s.
- The first open of a very large pipeline takes several seconds; later opens in the same session are fast.

## Alternatives

- Keep 3 s: lazy parsing of only the files the entry workflow reaches, a parse cache in IndexedDB, parser warm-up, and possibly grammar changes, for a cost users see once per session.
