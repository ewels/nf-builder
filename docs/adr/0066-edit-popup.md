# 0066. Edit typed processes in a popup form read in the worker, applied by UpdateDeclaration, with renames moving the module folder

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-40 opens a modal with Configure and Code tabs on double-click, or Enter on a selected node. UX-41 lists a typed process's Configure fields, "built from the catalogue", with directives added from a searchable list. UX-42 and ADR 0008 forbid a kind control. UX-44 makes Apply one edit command and one undo step, and Cancel discards. AR-21 names `UpdateDeclaration` ("from the popup") but no command existed. ADR 0049 showed the details header's Edit and Code buttons disabled until F-303 and F-304. ADR 0051 makes commands under one `group` one undo step. ADR 0056 closes project dialogs when the window narrows below 1024 px.

ADR 0039 left gaps the popup needs filled. It reprints whole declarations and keeps untouched ones, but says nothing about a form that changes some rows and not others. It writes `null` for a missing earlier argument, but no command changes a process's inputs, so no call site ever had to follow. Its rename limits say "files don't move", yet LA-12 wants each process in `modules/local/<lower name>/main.nf` and F-301 names new processes `NEW_PROCESS`, to be renamed here (ADR 0060).

Nextflow 26.10.7, checked with the pinned dist: a typed process with input `x: String` called as `P()` fails lint ("expects 1 argument(s) but received 0"); `P(null)` lints clean and runs only when the input is nullable. A sole output is read through the call result itself, so its name matters to readers only when there are two or more outputs. `cpus 1`, `memory 1.GB`, `time 1.h` and `debug true` lint clean and stub-run (oracle case `f303-directive-defaults`).

The catalogue's `types` has no `Boolean`, `Record`, `Tuple` or `VersionNumber`. All four are documented standard types (docs.seqera.io/nextflow/reference/stdlib-types) and the pinned lint accepts them. Our generator (`tools/spec-extract`) keeps only classes with a class-level `@Description`, and these have none or no class. This is our gap, not an upstream bug.

Research: the F-303 plan (deleted in the PR that merged F-303; settled in `docs/plan/handoff/README.md`, "F-303"); `nextflow-io/nextflow` `v26.10.7/docs/process-typed.mdx` and `docs/reference/process.mdx`.

## Decision

- **Opening** (UX-40, amends ADR 0049). A native modal `<dialog>` titled "Edit process <NAME>" opens on double-click of a process node, Enter on a node that is already selected, or the details header's Edit button. Enter on an unselected node only selects it (React Flow), so F-206's keyboard test holds. Space never opens. `popupTarget` (engine, pure) allows only a call of a modelled typed process. Workflow nodes are left to F-307, legacy processes to F-306, and other kinds get a reason, shown as the disabled Edit button's title. Edit is enabled for typed processes. Code stays a tab that is `aria-disabled` until F-304.
- **Read-only** (ADR 0056). In read-only mode the popup doesn't open, and the Edit button isn't rendered. Narrowing below 1024 px closes an open popup and discards its draft.
- **The form is read in the worker** (amends ADR 0043's API list). `EngineApi.declarationForm(path, workflow, node)` returns `{revision, target, form, choices}` or a refusal. The form has these parts, in UX-41 order:
  - name;
  - description, the doc comment's text before its first tag, with the tags kept verbatim;
  - inputs (name, type, nullable);
  - stage;
  - outputs (name, type, value);
  - topics;
  - directives;
  - script and stub, as monospace text areas.

  Each row carries `origin`, the index of the item it came from, or `null` for a new row. The form can't model `record(...)` and `tuple(...)` inputs, topics whose right side isn't a string, or `when:`. These are kept as written and shown read-only, with "Edit it in the Code tab". The page can't import the pack, so the worker sends the choices:
  - directives: the catalogue's directives minus the deprecated ones (`storeDir`, LA-34), with each one's kind from F-601's value kinds and a default (integer `1`, boolean `true`, memory `1.GB`, duration `1.h`; other kinds start empty and are required);
  - stage directives;
  - type suggestions: the catalogue's types, the project's records and enums, and a hand-kept list of the documented class-less standard types (`Boolean`, `Record`, `Tuple`, `VersionNumber`, in `packages/lang-2610/src/standard-types.ts`).
- **`UpdateDeclaration`** (AR-21, extends ADR 0039's command set). `{kind: "updateDeclaration", path, name, form}` is labelled "Edit process <name>".
  - **Rows:** untouched rows keep their text and comments. New and changed rows are parsed through the pack. A changed row keeps the comments of the row it replaces. A parse problem refuses the command with `fields` (the section, row and part), and nothing changes.
  - **Description:** an edit replaces only the text before the first tag. A new doc comment is written `/**\n * text\n */`.
  - **Renamed inputs:** uses in rows the user didn't edit are renamed, except where a closure parameter or local variable shadows the name.
  - **Call sites:** every call of the process, through direct and aliased includes, has its positional arguments reordered, dropped or extended with `null` to follow the inputs (ADR 0039's placeholder, reported by F-112). A call fed by a pipe refuses an input change.
  - **Renamed outputs:** when the process has two or more outputs, reads that resolve to the output are renamed: `r.x`, `P().x`, `P.out.x` and `P().out.x`.
  - **Guards:** the usual AR-24 and LA-13 guards apply. `DeclarationForm` is a union that F-305 and F-306 extend. `SetDirective` stays unbuilt.
- **Renames move the module folder** (LA-12; supersedes ADR 0039's "files don't move" rename limit; amends ADR 0052). A changed name applies `UpdateDeclaration`, then `RenameDeclaration`, as one undo group (ADR 0051) labelled "Edit process <new name>". Two conditions add a new `MoveFile {path, newPath}` to the same group:
  - the file is `modules/local/<lower old name>/main.nf`;
  - the file declares only this process.

  The move is skipped for a rename that only changes case, and when the target folder already exists. `MoveFile` does the following:
  - moves a file, or every file under a folder;
  - rewrites include sources in the includers and in the moved scripts;
  - carries layout sidecar keys, including those of workflows in moved files;
  - refuses a missing source, a taken target, a move into itself and the managed `.nf-builder/` folder.

  `ProjectChange.moves` tells open tabs to follow the moved files.
- **Apply** (UX-44). An unchanged form closes without a step. A form read at an older revision is refused as stale: "<NAME> changed since the popup opened. Close it and open it again." `applyGroup` (canvas store, shared with F-301's palette add) rolls back only the parts that recorded a step. A refused part therefore leaves nothing behind, and an earlier step is kept. A refusal keeps the popup open, marks each field in `fields` with `aria-invalid` and focuses the first. On success the popup closes and the node is selected again, under its new key after a rename. Cancel and Escape discard without asking.
- **Registry modules** stay editable, with a note: "This is a registry module. Editing it here means an update will overwrite your changes."

## Consequences

- Processes created from the palette as `NEW_PROCESS` get a proper name and folder in one undo step.
- Adding an input keeps every call lint-clean. The `null` it adds is flagged until connected, and a run fails it unless the input is nullable.
- `withName` selectors still don't follow renames (ADR 0039). `@param` tags go stale after an input rename until F-311.
- Enabling Edit changes the `details-process-trim` visual baseline. If it moves, it is re-approved from CI (ADR 0021).
- The edit harness's prelude runs `createProcess` before `updateDeclaration`, so the property and corpus tests also exercise the command on legacy pins.
- Oracle cases `f303-configure-start`, `f303-configure-typed`, `f303-directive-defaults`, `f303-rename-moved`, `f303-outputs-renamed`, `f303-outputs-legacy-reads` and `f303-configure-all` are generated or checked by the engine golden test. They lint and stub-run.
- There is no new runtime dependency, stored or exported format, package boundary, dependency-cruiser rule or workflow.

## Alternatives

- **Enter always opens:** one key press fewer, but it breaks F-206's select-then-act keyboard flow.
- **Leave call sites alone after an input change:** every call would fail lint until fixed by hand.
- **Rename nothing inside the process or at reads:** F-112 would report the breakage, but the form would make broken code from a plain rename.
- **Keep "files don't move" and add a feature for moving:** `NEW_PROCESS` folders would outlive every rename.
- **A small Monaco per script field:** costs bundle budget (QA-01) before F-304 brings Monaco to the Code tab.
- **Fix the catalogue generator for class-less types:** the generator reads class-level descriptions, and these types have none to read.
- **Keep the draft across narrowing:** project dialogs already close (ADR 0056), and a hidden draft could be applied against a moved revision.
