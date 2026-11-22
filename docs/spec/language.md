# Language support

## Versions

| ID | Requirement |
|---|---|
| LA-01 | Each project has a `languageVersion`. At launch the only pack is `26.10` (ADR 0006). |
| LA-02 | All version-specific behaviour comes from the pack: grammar, catalogue, palette, printer, lints, templates, defaults. Code outside `packages/lang-*` contains no Nextflow version literals. |
| LA-03 | New projects set `manifest.nextflowVersion` to the pack's recommended floor. For 26.10 that is `>=26.10.6` (released 2026-11-12; spike S1 confirmed it and found 26.10.7, released 2026-11-20, as the latest patch), per nf-core's guidance on record hashing and the `stage` block. |
| LA-04 | A pack may provide upgrade steps from the previous pack. "Upgrade project" runs them, then lints, and shows a diff before applying. |

## Typed and legacy code

| ID | Requirement |
|---|---|
| LA-10 | Parsing, projection, editing and export work for both typed and legacy processes and workflows (ADR 0007). |
| LA-11 | Anything created from the palette or a template is typed and follows the best practices in LA-40. |
| LA-12 | A new process or named workflow is written to its own file, with `nextflow.enable.types = true` at the top: `modules/local/<name>/main.nf` or `subworkflows/local/<name>/main.nf`. The app adds the `include` to the calling script. |
| LA-13 | The app never puts typed and legacy process or workflow definitions in the same script, because Nextflow forbids it. An edit that would do so is refused with an explanation. |
| LA-14 | A typed workflow may call a legacy process or workflow included from another file, and a legacy workflow may call a typed one (spike S1, Nextflow 26.10.7, ADR 0007). Inserting a legacy registry module into a typed workflow needs no warning. The typed workflow passes a legacy `tuple` input as `tuple(...)`, one argument per declared component (a mixed list literal fails `nextflow lint`), and reads the module's outputs by assignment and name, never through `.out`. `nextflow lint` doesn't check a legacy input's shape, so the connection check compares the tuple's arity with the legacy declaration. |

## Ports and types

| ID | Requirement |
|---|---|
| LA-20 | **Typed process:** one input port per `input:` declaration, typed as declared. One output port per named output; a single unnamed output gives one port named `out`. Topic emissions are not ports; they are listed in details. |
| LA-21 | **Legacy process:** one input port per input line. A `tuple` is one port whose label lists its components. One output port per output line, named by `emit:`, else by index. |
| LA-22 | **Workflow (either style):** ports from `take:` and `emit:`. Typed workflows carry declared types. |
| LA-23 | **Registry module not yet in the project:** ports from `meta.yml` until inserted. After insertion, from its parsed source. |
| LA-24 | **Operator chain:** input ports for the receiver and each channel argument. One output. |
| LA-25 | **Channel factory:** no inputs (arguments live in the popup). One output. |
| LA-26 | **`params` block:** one output per parameter. **`output` block:** one input per declared output. |
| LA-27 | **Code node:** inputs are free variables it reads that resolve to graph values; outputs are variables it assigns. |
| LA-28 | Edges carry `Channel<T>` or `Value<T>` where known. For legacy code, queue vs value is inferred where possible and `T` may be unknown. |
| LA-29 | Connecting two ports with incompatible known types is allowed but produces an error diagnostic. Unknown types never block a connection. |

## Lints

Severity levels: **error** (Nextflow would reject it), **warning** (deprecated or likely wrong), **suggestion** (works, but a modern form exists).

| ID | Rule | Severity |
|---|---|---|
| LA-30 | Syntax errors from the parser | error |
| LA-31 | Construct not valid for the project's language version | error |
| LA-32 | Type mismatch on an edge or call argument | error |
| LA-33 | Unconnected required input; unused output of a process with no topic or publish use | warning |
| LA-34 | Deprecated constructs: `when:`, `storeDir`, `shell:`, `Channel.` factories, implicit `it` | warning |
| LA-35 | Legacy process or workflow (offer "Migrate to typed" when available) | suggestion |
| LA-36 | `tuple` where a record would fit; `publishDir` where workflow outputs would fit; legacy `params.x =` assignments; `params` used outside the entry workflow and `output` block | suggestion |

Every lint message says what to do. Mechanical fixes are offered as quick fixes.

## Documentation

| ID | Requirement |
|---|---|
| LA-50 | Descriptions are stored as a Groovydoc `/** … */` block before the process, workflow or function, in the format nf-docs reads (ADR 0013): Markdown text, then `@param <name> <text>` per input or take, then `@return <name> <text>` per named output or emit (`@return <text>` when unnamed). |
| LA-51 | Existing doc comments are parsed in both styles nf-docs accepts: tags, or `Inputs:` / `Outputs:` bullet lists. A comment is rewritten, in tag style, only when the user edits its content. Unknown tags are kept. |
| LA-52 | Renaming an input, output, take or emit through the app renames its tag. Deleting one removes its tag. |
| LA-53 | Pipeline parameters are documented in `nextflow_schema.json` (`description`, `help_text`), not in comments. |
| LA-54 | Suggestion-level lints: a process or workflow with no doc comment; an input, output, take or emit with no description; a parameter with no schema description. |

## Best-practice defaults for new code (26.10)

| ID | Default |
|---|---|
| LA-40 | Pipelines use a typed `params` block and an `output` block. No `publishDir`. |
| LA-41 | Structured data uses `record` types; processes take and emit records where there is more than one related value. |
| LA-42 | Tool versions go to the `versions` topic from a `topic:` section. |
| LA-43 | Channel factories use lower-case `channel.`; closures name their parameters. |
| LA-44 | Operators come from the set recommended for static typing; `mix` takes one argument per call. |
| LA-45 | Code is formatted as `nextflow lint -format` would (ADR 0005), apart from the known differences where its output is broken (ADR 0032). New and edited declarations are formatted; declarations an edit didn't touch are printed from their source text (ADR 0032, F-104). |
