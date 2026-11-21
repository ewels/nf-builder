# Roadmap

Milestones run in order. A milestone is done when every feature tagged with it in [`features.json`](features.json) has `passes: true` and its exit criteria hold. Features are the unit of work: one feature per agent session, one per PR (ADR 0012).

## M0: Foundations and spikes

Get the repo, the harness and the risky unknowns settled before writing product code.

- Scaffold the monorepo, CI, GitHub Pages deploy, `pnpm check` and `pnpm smoke` (F-001 to F-004).
- Corpus tooling (F-009).
- Spikes S1 to S5 (F-005 to F-008, F-010).
- Spikes, each ending in a short report in `docs/research/` and a `Spike result` section on the linked ADR (a superseding ADR if the decision changes):

| Spike | Question | ADR |
|---|---|---|
| S1 | Can a typed workflow call a legacy process from another file, and vice versa? What is the `.module-info` format? Is 26.10.6 released? | 0007, 0009 |
| S2 | Does the nf-lang grammar generate a working TypeScript parser? Parse rate on the corpus, sarek parse time. Can `tools/spec-extract` produce the catalogue? | 0005 |
| S3 | Does the language server run under CheerpJ within budget? | 0010 |
| S4 | Do the registry API, `raw.githubusercontent.com` and `codeload.github.com` allow requests from a GitHub Pages origin? | 0009 |
| S5 | Can nf-metro render SVG in the browser under Pyodide, skipping its native PNG and animation dependencies? Load time and size? | 0013 |

**Exit:** CI green on `main`; five spike reports merged, each recorded on its ADR.

## M1: Engine core

Parse, model, project and edit Nextflow 26.10 code with no UI.

**Exit:** equivalent round trip on the whole corpus; projections for typed and legacy workflows snapshot-tested; core edit commands pass property tests; printer output matches `nextflow lint -format` in the oracle job; QA-03 and QA-04 met.

## M2: App shell

Three-column app showing real projects, read-mostly.

**Exit:** a blank or template project opens, renders on the canvas, shows details on click, persists across reloads, and lays out automatically.

## M3: Editing

Build and change pipelines from the canvas and popup.

**Exit:** the "samplesheet to MultiQC" template can be rebuilt from blank using only the palette, canvas and popup, including its doc comments, and the result passes `nextflow lint` and the nf-docs oracle.

## M4: Import and export

Bring real pipelines in and take them out unharmed.

**Exit:** each corpus pipeline imports from GitHub, survives a scripted edit, and exports lint-clean with untouched files equivalent.

## M5: Registry

Modules and plugins from registry.nextflow.io.

**Exit:** a user can find `nf-core/fastqc`, drop it into a typed workflow, connect it, and export a pipeline that passes `nextflow lint`, with the registry unreachable (snapshot mode).

## M6: Project files

Config, schema, `meta.yml` and other file editors, plus docs publishing to GitHub Pages with nf-docs and an auto-generated nf-metro map.

**Exit:** a new pipeline's `nextflow.config` and `nextflow_schema.json` can be built entirely through forms, and stay in step with the `params` block.

## M7: Polish and first release

**Exit:** all performance and accessibility checks green; read-only small-screen mode; user docs; `v0.1.0` tagged and live on GitHub Pages.

## After v0.1

Not scheduled; each needs a feature list and possibly ADRs first:

- Migrate to typed: language-server-backed if S3 succeeded, otherwise rule-based for common shapes.
- "Advanced checks" with the in-browser language server (if S3 succeeded).
- Language pack for the first 2027 Nextflow release, with upgrade steps from 26.10.
- Compare with upstream for imported projects.
- Push to GitHub (branch plus pull request) with a token.
- Offline use as a PWA.