# Architecture

Package boundaries and dependency rules: ADR 0003. This file covers how the parts work together.

## Data flow

```
files (IndexedDB) ──► engine worker: parse ─► AST ─► semantic model ─► projection (graph per workflow)
       ▲                                                                     │
       │                                                                     ▼
  text patches ◄── edit command ◄── UI (canvas, popup, forms, Code tab) ◄── React Flow / panes
```

- The UI never edits text or AST directly. It sends edit commands and renders projections.
- The engine runs in a Web Worker behind a Comlink API. The UI keeps a read-only copy of the latest projection and diagnostics.

## Engine model

| ID | Requirement |
|---|---|
| AR-01 | `SourceFile` holds path, text, language (`nextflow`, `config`, `json`, `yaml`, `markdown`, `text`), parse status, AST, and comment map. |
| AR-02 | The AST is our own typed tree built from the ANTLR parse tree. Every node has a source range. Comments are attached to the following node. |
| AR-03 | The semantic model resolves includes across files, declarations by name, workflow bodies into statements, and statements into calls, chains, assignments and code nodes. Includes of registry modules resolve to `modules/<namespace>/<name>/`. |
| AR-04 | Re-parsing is per file. A change to one file re-parses that file and recomputes the model for files that depend on it. |
| AR-05 | Diagnostics come from the parser, the model, and pack lint rules. Each has a range, severity, message, and optional quick fix (an edit command). |

## Projection

| ID | Requirement |
|---|---|
| AR-10 | A projection is computed per workflow: nodes (calls, chains, factories, takes, emits, params, output, code nodes) and edges (def-use links between variables, call arguments and results). |
| AR-11 | Node identity uses the layout keys in ADR 0008, so positions survive re-parses. |
| AR-12 | Chain boundaries: a chain is a maximal sequence of operator method calls with no assignment in between (ADR 0008). |
| AR-13 | A statement the projection can't model becomes a code node (ADR 0004). Its inputs and outputs come from a free-variable analysis of the statement. |
| AR-14 | Typed workflows use plain assignments and call results. Legacy workflows may also use `.out`, `|`, `set` and `tap`; the projection handles these forms. |

## Edit commands

| ID | Requirement |
|---|---|
| AR-20 | Edit commands are a discriminated union in `lang-core`. Each has a pure `apply(model) → TextPatch[]` in the engine, implemented with pack printer rules. |
| AR-21 | Minimum set for v1: `CreateProcess`, `CreateWorkflow`, `CreateRecord`, `CreateFunction`, `AddCall`, `AddChain`, `AddFactory`, `Connect`, `Disconnect`, `DeleteNode`, `RenameDeclaration`, `UpdateDeclaration` (from the popup), `SetDirective`, `AddInclude`, `InsertRegistryModule`, `AddTake`, `AddEmit`, `UpdateParams`, `UpdateOutputs`, `ReplaceFileText` (from code editors). |
| AR-22 | Applying a command leaves every declaration it doesn't target equivalent (see glossary), apart from added includes and new files. Whitespace next to the edit may change (property test, ADR 0011). |
| AR-23 | Every command is one undo step. Undo restores exact bytes. |
| AR-24 | A command that would produce code that fails to parse is rejected before it touches any file. |

## Language pack interface

Sketch, to be fixed in M1:

```ts
interface LanguagePack {
  version: string;                      // "26.10"
  parseScript(text: string): ParseResult;
  parseConfig(text: string): ParseResult;
  palette: PaletteDefinition;           // palette.json, ADR 0025
  loadCatalogue(): Promise<Catalogue>;  // generated, lazily loaded (ADR 0005, ADR 0028)
  printer: Printer;                     // declarations → text, ADR 0005
  lints: LintRule[];
  templates: Template[];
  defaults: ProjectDefaults;
  upgradeFrom?: { from: string; steps: UpgradeStep[] };
}
```

## UI state

| ID | Requirement |
|---|---|
| AR-30 | Zustand stores hold UI-only state: open tabs, selection, view modes, panel sizes, popup draft. Project content lives only in the engine and IndexedDB. |
| AR-31 | React Flow nodes are thin presentational components keyed by projection node ID. No business logic inside node components. |
| AR-32 | Monaco loads lazily on first use of a code view. |
