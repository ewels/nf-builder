# Project file editors

Each file type has an editor. Editors that offer a form also offer the raw text (Form, Split or Code), and both go through edit commands, so undo and autosave behave the same everywhere.

## `nextflow.config`

| ID | Requirement |
|---|---|
| FI-01 | Parsed with the pack's config grammar. Each top-level scope is a collapsible card. Scopes and options come from the catalogue (`config.json`) and the plugin specs of the plugins declared in the root `nextflow.config` (ADR 0065). A config file opens in its own tab with Form, Split and Code; the form is read-only while the file has parse problems (ADR 0061). |
| FI-02 | First-class forms for `manifest`, `params`, `process` (defaults, `resourceLimits`, `withLabel` and `withName` selectors), `profiles`, `plugins`, `docker`, `singularity`, `apptainer`, `conda`, `wave`, `executor`. Other scopes get a generic key/value form typed from the catalogue. Memory and duration values are written as `8.GB` and `2.h`, strings single-quoted; a value the form can't model is shown as read-only code with "Edit in code" (ADR 0061). A scope card shows when the file has the scope or the user has just added it, and lists only the options the file sets, each with Remove, plus "Add option…"; the pack's pinned options are listed first in Add option under "Suggested", and a card with nothing set says "No options set" (ADR 0071). |
| FI-03 | "Add scope" lists every scope in the catalogue with its description. Unknown scopes and options in existing files are kept, never removed, and flagged as warnings with Nextflow's run-time wording ("Unrecognized config option …"), which `nextflow lint` 26.10 doesn't report. Plugin scopes count as unknown until their plugin's spec is loaded (ADRs 0061, 0065). Descriptions in the Add scope and Add option lists render inline code and `https` links, never HTML from the catalogue (ADR 0071). |
| FI-04 | Selecting an option shows its description, type and docs link in the right pane. The description is rendered as safe Markdown (no HTML, `https` links only), and the docs link always points under `https://docs.seqera.io/nextflow/` (ADR 0061). A plugin option's docs link is its plugin's project page when that is an `https` URL, else there is none (ADR 0065). |
| FI-05 | `includeConfig` lines are kept, and the included files open from a link in their own config tab. A dynamic or URL source is shown as external, with no link (ADR 0061). |
| FI-06 | Selectors show which processes they match (for example "used by 1 process"), counted over the processes the entry workflow invokes, matched as Nextflow does: regular expression on the whole name, `!` negates, `withName` against the declared, alias and fully qualified names, `withLabel` against any label (ADR 0061). |

## `nextflow_schema.json`

| ID | Requirement |
|---|---|
| FI-10 | Schema builder: groups of parameters, each with type, default, description, help text, enum, pattern, format, required and hidden. Drag to reorder and regroup. Check first whether `nextflow-io/schema-builder` (nf-schema-builder) can be reused or embedded rather than rebuilt; see the [prior-art notes](../research/2026-11-21-prior-art.md). |
| FI-11 | Kept in step with the `params` block: adding or changing a parameter in one offers the matching change in the other. Mismatches are diagnostics with quick fixes. |
| FI-12 | Validated with Ajv against the JSON Schema draft the nf-schema plugin expects. Confirm the draft in M6. |
| FI-13 | Samplesheet schemas (`assets/schema_input.json` or the path the schema references) open in the same builder in "row" mode. Where a record type matches a samplesheet schema, mismatches between them are diagnostics. |

## Module `meta.yml`

| ID | Requirement |
|---|---|
| FI-20 | Form for name, description, keywords, authors, maintainers, tools, inputs and outputs, following the registry module spec schema. |
| FI-21 | "Update from process" regenerates inputs and outputs from the module's `main.nf`, as `nextflow module spec` does. The result is a diff to confirm. |
| FI-22 | Registry module folders open read-only, with a "Make local copy" action. Editing upstream modules in place is not allowed: it breaks updates. |

## Documentation publishing

| ID | Requirement |
|---|---|
| FI-40 | When "Publish docs" is on, a new project includes `docs/usage.md` and `docs/output.md` stubs and `.github/workflows/docs.yml`. |
| FI-41 | `docs.yml` runs on pushes to the default branch and on manual dispatch, with `pages: write` and `id-token: write`. Steps: check out; set up Java 17 and uv; download the language server jar pinned by the pack; run `uvx nf-docs@<pinned> generate . --format html --output _site --language-server <jar>`; upload the Pages artifact; deploy. |
| FI-42 | The generated README tells the user the one-time step: Settings → Pages → Source: GitHub Actions. |
| FI-43 | Imported projects get an "Add docs publishing" action. Nothing is added to them automatically. |
| FI-44 | The pinned versions (nf-docs, language server, actions) come from the language pack's defaults and update with the pack. |

## Metro map

| ID | Requirement |
|---|---|
| FI-50 | When "Generate metro map" is on, the app writes `assets/metro_map.mmd` in nf-metro format (ADR 0013). The title comes from `manifest.name`. Stations are the process and workflow calls in the entry workflow. Named subworkflows become sections (Mermaid `subgraph`). Edges carry line IDs. |
| FI-51 | Lines are assigned automatically: `main` along the longest path from a pipeline input to an output, then one line per remaining branch that reaches a different terminal station. Colours come from a fixed palette that reads well on light and dark backgrounds. |
| FI-52 | The file starts with a comment marking it as generated, plus a hash of its content. While the hash matches, the app regenerates the file after each edit that changes the entry workflow's projection. Once it differs (hand-edited), the app stops, shows "metro map out of date" in the problems panel, and offers "Regenerate", which shows a diff before overwriting. |
| FI-53 | The app sets `manifest.diagram = 'docs/images/metro_map.svg'` in `nextflow.config`. |
| FI-54 | **If spike S5 succeeds:** the SVG is rendered in the browser with nf-metro under Pyodide (in a worker, lazy-loaded) and written to `docs/images/metro_map.svg`. **Otherwise:** the project gets `.github/workflows/metro-map.yml`, which renders the SVG with the pinned nf-metro whenever the `.mmd` changes and commits it. Either way, the README embeds the SVG. |
| FI-55 | The details pane, with nothing selected on the entry workflow, shows the rendered map (or the `.mmd` text if no SVG exists yet). The `.mmd` opens in Monaco like any other file. |

## Other files

| ID | Requirement |
|---|---|
| FI-30 | `README.md` and other Markdown (`.md`, `.markdown`) open in Preview, with Split and Code. The preview renders GitHub-flavoured Markdown, raw HTML included, and is sanitised: no scripts, styles, frames, forms or event handlers; external links open in a new tab with `noopener`; links to project files open them; only `data:` images are shown and others appear as their alt text, so the preview makes no requests (ADR 0059). |
| FI-31 | `.nf` files with no workflow (function libraries, record definitions) open in Monaco, with an outline of their declarations in the details pane. Each declaration is listed with its kind, name and line; selecting one shows it in the code (ADR 0059). |
| FI-32 | Everything else that is text opens in Monaco, highlighted by extension; unknown extensions, HTML and SVG open as plain text and are never rendered (ADR 0059). Until F-407, projects hold text files only (ADR 0045): imports and uploads list binary files as skipped and never open them. Once projects hold binary files (F-407, in v0.1 by ADR 0071), the Files view lists them and they don't open. |
