# 0047. Ship project templates as pack-owned file trees, bundled as a lazy JSON chunk and checked by the oracle

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

UX-60 asks for a New project dialog with Start blank, templates and a Publish docs checkbox. LA-11, LA-40 to LA-43 and LA-50 say what a new pipeline contains, and ADR 0007 says templates are typed. Open question Q6 asked which templates ship in v0.1. The sketch in `architecture.md` gave the pack a `templates: Template[]` member. A template is copied into a user's pipeline, so its licence matters, and whatever the user gets should be what the oracle checked. Research: the [F-203 plan](https://github.com/ewels/nf-builder/blob/8583211/docs/plan/handoff/plan-F-203.md).

## Decision

- **Templates in v0.1:** Start blank, Hello world and Samplesheet to MultiQC (Q6). The nf-core-style skeleton and Pipeline composition move to the M8 feature F-211, "More project templates" (ADR 0030). nf-core's typed module conventions are new (ADR 0007), and the skeleton needs plugins that the offline oracle can't fetch.
- **Format:**
  - Each template is a directory in the pack, `packages/lang-<version>/templates/<id>/`, with names and descriptions in the hand-edited `templates.yaml`.
  - `pnpm gen:templates <version>` bundles them into the generated `templates.json`; `--check` runs in `pnpm check`.
  - `LanguagePack.loadTemplates()` loads it as a lazy chunk, outside QA-01. It replaces the sketch's `templates` member.
  - It is a build input, not a stored or exported format.
- **Engine and workspace:**
  - `EngineApi.templates(version)` returns ids, names and descriptions only.
  - `NewProject.template` names a template; the worker copies that template's files into the new project, so the request carries no file text (AR-30).
- **Content:**
  - No placeholders are substituted, and no `manifest.name` is set, so the user gets exactly what the oracle checked. F-601 can set the name.
  - Start blank has an entry workflow, a `params` block, `nextflow.config`, a schema and a README, but no `output` block: `nextflow lint` rejects `output {}` without `publish:`. LA-40 reads as "an output block once something is published".
  - Tool versions use the LA-42 `eval` idiom. Hello world has no `topic:` section, because `echo` is not a tool.
  - Samplesheet to MultiQC carries tiny text test data and a relative samplesheet under `assets/`, with a `test` profile: no remote data and no plugins.
- **Oracle:** each template is the case `template-<id>`, run in place. Three case keys are new:
  - `dir` runs a directory in place;
  - `lint.clean` requires no lint output;
  - `run.tools` puts shims on the `PATH` for the tools that `eval(...)` calls under `-stub`.
- **Documentation check:** a unit test checks that every process and workflow has a doc comment and every parameter a schema description. The check moves into the engine with F-311 and F-312 (LA-54).
- **Dialog:**
  - Native `<dialog>`, with Start blank and From a template as radios, then the templates as a second radio group.
  - Publish docs is shown, checked by default and sent as `NewProject.publishDocs`, but does nothing until F-606.
  - The Import route and the metro map checkbox stay with F-401, F-403 and F-607.
  - The header's Templates button opens the dialog on From a template, so the F-201 shell baseline is re-approved.
  - Start blank doesn't wait for the template list: the worker resolves the pack's blank template itself, so it works while the list loads or after it failed to load.
- **Licence:** template content is dedicated under MIT-0, so users needn't keep a notice. It is written for this project. The facts it takes from elsewhere are cited in the oracle cases' `sources`: tool versions and the MultiQC version command from nf-core modules, and the shape of `SAY_HELLO` from the Nextflow docs' typed process example.
- **Baselines:** each template's canvas is a visual baseline approved from CI (ADR 0021). They use F-205's interim layout, and F-207 re-approves them. Start blank's canvas is checked in the DOM only: it has no edges and nothing to lay out.
- **Parameter comments:** parameters are described in `nextflow_schema.json` only, not in comments (LA-53).
- **Opening a project keeps the canvas.** The canvas store resets only when no project is current and none is opening. This amends ADR 0046's "It resets when no stored project is current": a status pushed before an open finished could blank the canvas.

## Consequences

- A pack version owns its templates. A new pack copies and updates them, and the oracle runs them against that version.
- A template change runs through `gen:templates`, the oracle and the baselines.
- Projects don't record which template they started from. F-401 may add that, which would change the stored format.

## Alternatives

- **Vite `import.meta.glob` with `?raw`:** no generator, but it ties the pack to Vite, and `check:hosts` would scan the template text in JS chunks.
- **Placeholders such as the project name:** the user would get text the oracle never checked.
- **The repository's MIT licence for templates:** users would have to keep the notice in their pipelines.
- **Hiding Publish docs until F-606:** drops a control UX-60 lists.
