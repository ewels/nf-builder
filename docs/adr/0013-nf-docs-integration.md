# 0013. Write docs in nf-docs format, generate an nf-metro map, publish to GitHub Pages

- Status: Accepted
- Date: 2026-11-21

## Context

- **nf-docs:** the edit popup already collects descriptions. [nf-docs](https://github.com/ewels/nf-docs) builds pipeline API docs from Groovydoc comments, `nextflow_schema.json`, the README, config and `meta.yml`. It handles typed syntax ([research](../research/2026-11-21-nf-docs.md)).
- **Metro maps:** Nextflow 26.10 adds `manifest.diagram`, a relative path to a pipeline diagram (SVG preferred). nf-core draws these as metro maps with [nf-metro](https://github.com/seqeralabs/nf-metro), which renders a Mermaid `graph LR` file with `%%metro` directives. nf-metro is a Python package (MIT): pure-Python layout, with native dependencies used only for PNG and animation output.
- **What the canvas knows:** the builder already holds the pipeline graph, so it can write the metro map source itself.

## Decision

**Doc comments:**
- Descriptions are written as a Groovydoc block before the declaration:
  - Markdown text first;
  - `@param <input> <text>` per input or take;
  - `@return <output> <text>` per named output or emit (`@return <text>` if unnamed).
- Existing comments are read in either style nf-docs accepts. They are rewritten, in tag style, only when the user edits the docs. Unknown tags are kept.
- Parameter docs live in `nextflow_schema.json`.
- Suggestion-level lints flag missing docs.

**Metro map:**
- The app generates `assets/metro_map.mmd` from the entry workflow:
  - stations are process and workflow calls;
  - named subworkflows become sections;
  - a `main` line follows the longest input-to-output path, with one more line per branch that ends somewhere else (QC into MultiQC, for example).
- It sets `manifest.diagram = 'docs/images/metro_map.svg'`.
- While the file is untouched, the app regenerates it whenever the graph changes. Once the user edits it by hand, the app stops and flags it as out of date. "Regenerate" then shows a diff before overwriting.
- **The SVG:** render it in the browser by running nf-metro under Pyodide, so the SVG is written into the project and exported with it. Spike S5 checks this. If it fails, ship a `metro-map.yml` workflow that renders the SVG with a pinned nf-metro whenever the `.mmd` changes, and commits it.

**Publishing:**
- New pipelines ship with `docs/usage.md`, `docs/output.md` and `.github/workflows/docs.yml`.
- The workflow runs nf-docs (with a pinned language server jar) and deploys the HTML to GitHub Pages, metro map included.
- Pinned versions of nf-docs, nf-metro, the language server and actions come from the pack's defaults.
- New project checkboxes, both on by default: "Publish docs to GitHub Pages" and "Generate metro map". Imported projects get matching actions instead, never applied automatically.

## Consequences

- Pipelines made here come documented, with a diagram, in formats other tools read.
- Some content waits on nf-docs: workflow take/emit descriptions (#17) and extra pages (#19). Pinning the language server is #18.
- Auto-generated lines are a starting point. Real analysis routes (for example, one line per aligner choice) need hand edits, which is why hand-edited maps are left alone.

## Alternatives

- A builder-specific doc format: invisible to other tools.
- Committing generated Markdown via the nf-docs pre-commit hook: noisy diffs. Could be an option later.
- Converting `nextflow -with-dag` output with `nf-metro convert`: needs a Nextflow run. The builder already has the graph.
- Drawing the metro map on the canvas itself: two diagram editors to maintain. The `.mmd` file stays editable as text.
