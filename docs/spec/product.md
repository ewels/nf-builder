# Product

## Purpose

A free, open-source web app for building and editing Nextflow pipelines visually. It writes real Nextflow code: what you see on the canvas is what's in the files, and the files are what you commit.

## Users

1. **Pipeline composers.** Bioinformaticians who know their tools and want to assemble a pipeline from registry modules without learning every corner of the language first.
2. **Pipeline developers.** People who write Nextflow daily and want an overview of an existing pipeline, quick structural edits, and help moving legacy code to modern syntax.
3. **Teachers and trainers.** People who need to show how processes, channels and workflows fit together.

## Where this fits

Other visual Nextflow builders exist: StageNest, DolphinNext, Code Ocean. They generate code from a graph or need a server. This one treats the code as the source of truth, edits any pipeline without losing code, runs entirely in the browser, and defaults to typed 26.10 syntax. Details: [prior art](../research/2026-11-21-prior-art.md).

## Goals

| ID | Goal |
|---|---|
| PR-01 | Start a pipeline from blank, from a template, or by importing a GitHub repo or zip |
| PR-02 | Build and edit pipelines on a node canvas, with every change reflected in correct, formatted Nextflow code |
| PR-03 | Cover the full Nextflow 26.10 language: processes, workflows, operators, channel factories, params, outputs, records, functions, includes, plugins |
| PR-04 | Use modules and plugins from registry.nextflow.io |
| PR-05 | Edit the standard project files: `nextflow.config`, `nextflow_schema.json`, module `meta.yml`, README |
| PR-06 | Default to typed, best-practice code, while handling the legacy code people already have |
| PR-07 | Run entirely in the browser, with projects stored locally and nothing sent to a server |
| PR-08 | Support new Nextflow versions as they ship, starting with 26.10 |

## Non-goals (v1)

- Running pipelines, or talking to Seqera Platform.
- Editing on phones. Small screens get a read-only view.
- Registry pipelines (only modules and plugins).
- Nextflow versions before 26.10.
- Real-time collaboration, accounts, cloud sync.
- Pushing to GitHub. Export is zip only; a push flow may come later.

## Principles

These settle trade-offs. When two conflict, the earlier one wins.

1. **Never lose code.** Anything the app can't model is kept as written (ADR 0004).
2. **Files are the truth.** The canvas is a view of the code (ADR 0004).
3. **Typed by default, legacy tolerated.** New things are modern. Existing things keep working (ADR 0007).
4. **Nudge, don't nag.** Suggestions are visible and one click from a fix, never blocking or modal.
5. **Minimal nodes.** Show the structure; put detail in the side pane and the popup.
6. **Official sources over our own guesses.** Grammar, catalogue and formatting come from Nextflow itself (ADR 0005).
