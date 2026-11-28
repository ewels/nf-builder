# Architecture

Package boundaries and dependency rules: ADR 0003. This file covers how the parts work together.

## Data flow

```
files (IndexedDB) ──► engine worker: parse ─► AST ─► semantic model ─► projection (graph per workflow)
       ▲                                                                     │
       │                                                                     ▼
  text patches ◄── edit command ◄── UI (canvas, popup, forms, Code tab) ◄── React Flow / panes
```

The main thread keeps only pack versions and palette search; parsing, modelling, projection, edits and diagnostics run in the engine worker behind Comlink (AR-04, ADR 0043). The worker also reads and writes the IndexedDB project store, so file text never sits on the main thread (ADR 0045), apart from open editors and Markdown previews, which hold their own file's text while mounted (ADRs 0048, 0059). The config form gets a view of the file whose code excerpts are at most 160 characters (ADR 0061).

- The UI never edits text or AST directly. It sends edit commands and renders projections.
- The engine runs in a Web Worker behind a Comlink API. The UI keeps a read-only copy of the latest projection and diagnostics.
- The engine worker owns the layout sidecar and carries node positions on every change; ELK runs in its own worker, started lazily from the canvas chunk (ADR 0052).
- Zip import reads and unpacks the file in the engine worker; the page sees only the summary (ADR 0053).
- GitHub import fetches in the document, which lists the repository and downloads raw files, then transfers the bytes to the engine worker in one `importProject` call; the worker decodes and stores them, and never reaches the GitHub client (ADR 0057).
- The Files view pulls the project's file list from the engine worker (`listFiles`) while it is visible and builds its rows on the main thread; files dropped or uploaded into an open project are staged and checked in the worker like a zip import, and added as raw writes (ADR 0055).
- The Markdown preview reads its file from the worker and renders it on the main thread in a lazy chunk, with marked and DOMPurify; the details pane's outline of a script with no workflow comes from the worker (`outline`), names and ranges only (ADR 0059).

## Engine model

| ID | Requirement |
|---|---|
| AR-01 | `SourceFile` holds path, text, language (`nextflow`, `config`, `json`, `yaml`, `markdown`, `text`), parse status, AST, and comment map. |
| AR-02 | The AST is our own typed tree built from the ANTLR parse tree. Every node has a source range. Comments are attached as leading, trailing or dangling comments, as nf-lang's `CommentAttacher` does (ADR 0027). |
| AR-03 | The semantic model resolves includes across files, declarations by name, workflow bodies into statements, and statements into calls, chains, assignments and code nodes. Includes of registry modules resolve to `modules/<namespace>/<name>/` under the project root, or under the including script's directory when that lies in a `modules/` directory (nested vendoring, ADR 0034). |
| AR-04 | Re-parsing is per file. A change to one file re-parses that file and recomputes the model for files that depend on it. |
| AR-05 | Diagnostics come from the parser, the model, and pack lint rules. Each has a range, severity, message, and optional quick fix: text edits that become a `ReplaceFileText` command when applied (ADR 0042). |

## Projection

| ID | Requirement |
|---|---|
| AR-10 | A projection is computed per workflow: nodes (calls, chains, factories, takes, emits, params, output, code nodes) and edges (def-use links between variables, call arguments and results). |
| AR-11 | Node identity uses the layout keys in ADR 0008, so positions survive re-parses. The key grammar is in ADR 0036. |
| AR-12 | Chain boundaries: a chain is a maximal sequence of operator method calls with no assignment in between (ADR 0008). |
| AR-13 | A statement the projection can't model becomes a code node (ADR 0004). Its inputs and outputs come from a free-variable analysis of the statement. |
| AR-14 | Typed workflows use plain assignments and call results. Legacy workflows may also use `.out`, `|`, `set` and `tap`; the projection handles these forms, as well as aliases, call-result properties and `if`/ternary choices between dataflow branches (ADR 0038). |

## Edit commands

| ID | Requirement |
|---|---|
| AR-20 | Edit commands are a discriminated union in `lang-core`. Each has a pure `apply(model) → TextPatch[]` in the engine, implemented with pack printer rules. |
| AR-21 | Minimum set for v1: `CreateProcess`, `CreateWorkflow` (ADR 0060), `CreateRecord`, `CreateFunction`, `AddCall`, `AddChain`, `AddFactory`, `Connect`, `Disconnect`, `DeleteNode`, `DeleteNodes` (several nodes as one command, ADR 0067), `RenameDeclaration`, `UpdateDeclaration` (from the popup, ADR 0066), `SetDirective`, `AddInclude` (ADR 0067), `InsertRegistryModule`, `AddTake`, `AddEmit`, `UpdateParams`, `UpdateOutputs`, `ReplaceFileText` (from code editors), `CreateFile` (new files and folders from the Files view, ADR 0055; with text for pasted files, ADR 0067), `MoveFile` (a renamed process's module folder, ADR 0066), and for config forms `SetConfigOption`, `RemoveConfigOption`, `AddConfigBlock`, `AddConfigPlugin` and `RemoveConfigPlugin`, each one statement-level text edit (ADR 0061). |
| AR-22 | Applying a command leaves every declaration it doesn't target equivalent (see glossary), apart from added includes and new files. Whitespace next to the edit may change (property test, ADR 0011). |
| AR-23 | Every command is one undo step; a user action that applies several commands (F-301, F-310) is one step. Undo restores exact bytes. History is kept in memory per open project; raw file writes clear it (ADR 0051). |
| AR-24 | A command that would produce code that fails to parse is rejected before it touches any file. A problem the file already had doesn't count, so partial imports stay editable (ADR 0039). |

## Language pack interface

Sketch, to be fixed in M1:

```ts
interface LanguagePack {
  version: string;                      // "26.10"
  loadParser(): Promise<SourceParser>;  // parser and printer, lazily loaded (ADR 0033)
  includes: IncludeRules;               // include resolution and includable names (ADR 0034)
  palette: PaletteDefinition;           // palette.json, ADR 0025
  loadCatalogue(): Promise<Catalogue>;  // generated, lazily loaded (ADR 0005, ADR 0028)
  scaffold: Scaffold;                   // new-process and include text (ADR 0039)
  loadLints(): Promise<PackLints>;      // codes, rules and connection checks, lazily loaded (ADR 0042)
  loadTemplates(): Promise<TemplateSet>; // project templates, lazily loaded (ADR 0047)
  defaults: ProjectDefaults;
  upgradeFrom?: { from: string; steps: UpgradeStep[] };
}
```

## UI state

| ID | Requirement |
|---|---|
| AR-30 | Zustand stores hold UI-only state: open tabs, selection, view modes, panel sizes, popup draft. Project content lives only in the engine and IndexedDB; a mounted Code view or Markdown preview holds its own file's text, never the stores (ADRs 0048, 0059). Copied nodes and their file text live in the engine worker; the stores hold only a summary (ADR 0067). |
| AR-31 | React Flow nodes are thin presentational components keyed by projection node ID. No business logic inside node components. |
| AR-32 | Monaco loads lazily on first use of a code view. |
