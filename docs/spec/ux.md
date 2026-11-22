# User interface

Mockup: [docs/mockup](../mockup/README.md). Where the mockup and this file disagree, this file wins.

## Layout

| ID | Requirement |
|---|---|
| UX-01 | Header bar with app name, project switcher, save state, Templates, Import, Export, and Nextflow version selector. The selector lists installed language packs; at launch only `26.10`. |
| UX-02 | Three columns under the header: left (palette or files, 256 px default), centre (tabs plus canvas or editor), right (details, 296 px default). Side columns can be resized and collapsed; widths persist per browser. |
| UX-03 | Status bar: problems count, suggestions count (separate, links to the problems panel), node and channel counts for the active canvas, language version. |
| UX-04 | Below 1024 px wide the app is read-only: canvas and details only, with a note that editing needs a larger screen. |

## Left column

| ID | Requirement |
|---|---|
| UX-10 | Segmented control switches between **Components** and **Files**. |
| UX-11 | One search box filters every category, generic and registry, by name, description and keywords. |
| UX-12 | Generic categories come first, as collapsible accordions, generated from the language pack's catalogue plus `palette.yaml`: **Processes** (Process, Exec process, Agent, marked preview); **Workflows** (Workflow, Include pipeline); **Channel factories**; **Operators**, grouped (transform, filter, combine, fork, split, reduce, inspect; a group with no modern operator in the pack is left out, as fork and split are in 26.10, ADR 0025); **Params & outputs**; **Types, functions & includes** (record, enum, function, include); **Plugins & config**. |
| UX-13 | The palette offers modern constructs only (ADR 0007). Nothing invalid for the project's language version appears. Preview features show a `preview` badge. |
| UX-14 | Then a **registry.nextflow.io** section: Modules (grouped by namespace, lazy-loaded, process or workflow marked, typed modules tagged `typed`) and Plugins. A refresh button shows the data source (live or snapshot) and its age. |
| UX-15 | Items are added by drag and drop onto the canvas, or by keyboard: focus the item, press Enter, and it is placed at the viewport centre. Dropping an operator on an edge inserts it into that edge's chain. |
| UX-16 | The Files view shows the project tree with new file, new folder and upload actions. Registry module folders carry a `registry` tag; files that failed to parse carry an error badge. Dropping files or a zip adds them. |

## Canvas

| ID | Requirement |
|---|---|
| UX-20 | One canvas per workflow (entry or named). Tabs above the canvas hold open workflows and open files. |
| UX-21 | Node anatomy: kind icon tile, name in monospace, one subtitle line (kind, or registry name), then one row per port. Input ports on the left edge, outputs on the right. A "port labels" toggle hides labels for compact view. |
| UX-22 | Node kinds and colours: process and registry module (green; module shows its registry name), workflow (blue; offset shadow shows it opens), operator chain (amber pill), channel factory (purple), params (purple), output block (pink), take and emit (grey pills), code node (grey, monospace preview of first line), unparsed (grey, error outline). An unresolved callee draws as unparsed, subtitled "not found"; a pipeline draws as a workflow and an agent as a process with its own icon (ADR 0046). |
| UX-23 | Typed processes and workflows carry a small `typed` badge on the top edge. No badge means legacy syntax (ADR 0007). |
| UX-24 | Edges are channels. Queue channels are solid, value channels dashed, plain values dotted; an edge of unknown type is solid, muted and thinner (ADR 0046). Edges touching the selected node are highlighted. Hovering an edge shows its type and source. A type mismatch is drawn red, with the diagnostic on hover. |
| UX-25 | Connecting: drag from an output port to an input port. Invalid targets dim while dragging. Connecting creates or rewrites the call's argument (ADR 0004). |
| UX-26 | Standard canvas controls: pan, zoom, fit, minimap, marquee and shift-click multi-select, delete, copy and paste (within and across projects), undo and redo, auto-layout (ELK) for all or selected nodes. |
| UX-27 | View mode toggle per tab: Graph, Split (graph plus live code of the workflow's file), Code. |
| UX-28 | Chains expand and collapse in place (ADR 0008). Code nodes show their full text on hover. |

## Details pane (right)

| ID | Requirement |
|---|---|
| UX-30 | A single click selects a node and shows read-only details: name, kind, file, description, inputs and outputs with types and connections, key directives, topics, a short script preview, and diagnostics for that node. |
| UX-31 | With nothing selected, it shows the open workflow's summary: take, emit, calls, registry modules used. |
| UX-32 | Header buttons: Edit (opens popup) and Code (opens popup on the Code tab). For registry modules: version, upstream link, "update available" if newer. |

## Edit popup

| ID | Requirement |
|---|---|
| UX-40 | Double-clicking a node (or Enter on a selected node) opens a modal with two tabs: **Configure** (default) and **Code**. Workflow nodes are the exception: double-click opens the workflow in a canvas tab (UX-50). |
| UX-41 | Configure shows a form for everything the kind supports, built from the catalogue. For a typed process: name, description (doc comment), inputs (name, type, nullable), stage, outputs (name, type, value), topics, directives (add from searchable list), script, stub. Legacy processes get qualifier-based input and output editors. |
| UX-42 | There is no control to change a node's kind (ADR 0008). |
| UX-43 | Code shows only that declaration in Monaco, with Nextflow highlighting, inline diagnostics and hover help. "Show whole file" switches to the full file. "Format" applies canonical formatting (ADR 0005). |
| UX-44 | Both tabs edit the same pending state. Apply validates and applies one edit command (one undo step). Cancel discards. If the Code tab doesn't parse, Apply is disabled and the error shown. |
| UX-45 | Legacy nodes show a "Migrate to typed" action when a migration is available. It shows a diff and applies only on confirmation (ADR 0007). |
| UX-46 | Every input, output, take and emit row in Configure has a one-line description field. The General section has a Markdown description. These are saved as the doc comment (LA-50), and the details pane shows them next to each port. |

## Workflows and files

| ID | Requirement |
|---|---|
| UX-50 | Opening a workflow node opens or focuses a canvas tab for its definition. A breadcrumb shows the path from the entry workflow, with back navigation. |
| UX-51 | In a workflow canvas, `take` inputs are pills on the left and `emit` outputs pills on the right. Adding, removing or renaming them updates the ports of every call site. |
| UX-52 | Opening a file from the Files view uses its editor (`files.md`). Unknown text files open in Monaco. |

## Dialogs

| ID | Requirement |
|---|---|
| UX-60 | New project dialog: name, language version (installed packs only); three routes: Start blank, From a template, Import (GitHub repo with ref and optional token, or zip). Shows projects stored in this browser. States that projects live in this browser only. Has "Publish docs to GitHub Pages" (FI-40) and "Generate metro map" (FI-50) checkboxes, both on by default. |
| UX-61 | Import shows a summary (files, skipped, size) before creating the project, then a report afterwards: parse failures, legacy share, suggestions count. |
| UX-62 | Export dialog: zip of the project, with a checkbox to include the layout sidecar (on by default). |

## Keyboard

| ID | Requirement |
|---|---|
| UX-70 | Every action reachable by mouse is reachable by keyboard. Minimum shortcuts: search (`/`), add focused palette item (Enter), delete (Delete/Backspace), undo and redo (platform standard), open popup (Enter), close popup (Esc), fit (`F`), auto-layout (`L`), switch view mode (`G`, `S`, `C`). |
