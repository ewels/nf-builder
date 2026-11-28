# Plan: F-304, edit popup Code tab: Monaco on the declaration only

Written by the planner on 2026-11-28, designed against `origin/feat/F-303` at `5b09d76` (PR #65, ADR 0066). I changed nothing except this file. Paths are relative to the repository root. Build on `feat/F-304` branched from `main` after F-303 merges.

## 0. Scope

**Steps:** (1) "Edit in Code, switch to Configure: the form reflects the edit"; (2) "Introduce a syntax error: Apply is disabled and the error shows inline"; (3) "Format produces the same text as the oracle formatter for that declaration".

**In scope (UX-43, UX-44, the feature's notes):**
- The popup's Code tab, enabled for every node the popup opens on today (typed process calls, `popupTarget`): Monaco on the declaration's text only, Shiki Nextflow highlighting, inline parse diagnostics, "Show whole file", "Format", Apply disabled while the code doesn't parse.
- One draft across both tabs (UX-44); Apply is one undo step (AR-23); a refusal keeps the popup open; stale forms refused (ADR 0066).
- The details header's Code button opens the popup on the Code tab (F-206 note).
- The popup's Monaco registers its flush with `registerFlush` (F-209 note); read-only as F-303 (F-703 note).

**Out of scope (open points, section 6):** UX-43 "hover help" (not in F-304's description or steps; no feature owns it); lint diagnostics of the unapplied draft (only parse problems are inline here); editing the whole file in the popup; Code for workflows and legacy processes (F-305, F-306, F-307 extend `popupTarget`).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-43:** Code shows only the declaration, Nextflow highlighting, inline diagnostics and hover help; "Show whole file" switches to the full file; "Format" applies canonical formatting (ADR 0005).
- **UX-44:** both tabs edit the same pending state; Apply validates and applies one command (one undo step); Cancel discards; if Code doesn't parse, Apply is disabled and the error shown; a rename is update + rename + folder move as one group; stale forms refused.
- **AR-21** lists `ReplaceFileText` "from code editors" and `UpdateDeclaration`, no declaration-scoped text command. **AR-24/LA-13:** guards on every command result (`edit/guards.ts` `checkResult`). **AR-30:** "popup draft" is UI state the stores may hold. **LA-45:** "new and edited declarations are formatted" (tension with a verbatim Code apply, open point 4).
- **ADR 0048:** lean Monaco, Shiki, `ReplaceFileText` verbatim (not reformatted), refusal markers owner `nf-builder-refusal`, Monaco undo stays local. **ADR 0066:** popup, `declarationForm`, `UpdateDeclaration`, `editDeclaration` + `applyGroup`, rename moves the module folder, Esc and Cancel discard without asking, stale message. **ADR 0051:** groups are one step; history in the worker. **ADR 0056:** read-only closes the popup. **ADR 0032:** printer known differences (a Format fixture must avoid them).

### 1.2 Code (F-303 branch)
- `apps/web/src/popup/edit-popup.tsx`: Code tab is `aria-disabled` with `CODE_TAB_TITLE`; panel holds only `ConfigureForm`. `popup-store.ts`: `Opened {revision, original, draft: TypedProcessForm, …}`, `applyPopup` → `canvasStore.editDeclaration`; `PopupRequest.tab` is the canvas tab id (so the new field needs another name).
- `apps/web/src/canvas/canvas-store.ts` `editDeclaration` (≈l.1385): revision stale check, `updateDeclaration` + `renameDeclaration` + optional `moveFile` (`moduleFolder`, `folderOf`, `declaresOnly`, `nodeAfterRename`) through `applyGroup` with token `popup-<session>-<n>`; does not call `flushPending`.
- `apps/web/src/code/`: `monaco.ts` (lean build), `languages.ts` `registerLanguage(id)`, `markers.ts` `problemsToMarkers(problems, lines)`, `models.ts` (scheme `nf-builder`, one model per path, disposed on session change), `code-editor.tsx` (`fixedOverflowWidgets: true`, sets `data-language`, `registerFlush`), `text-sync.ts`.
- `packages/engine/src/form/read-process.ts` `processForm(file, process, catalogue)`, `formChoices`; `form/write-rows.ts` `formSource` prefixes `nextflow.enable.types = true`: **a typed process only parses as typed after that flag**, so parsing a declaration alone needs the file's flags prepended and problem lines shifted back.
- `packages/engine/src/edit/splice.ts` `itemSpan(item)` (leading doc comment to trailing comment), `reprintDeclaration`, CRLF handling (`withEndings`, private). `edit/apply.ts` `applyCommand` runs `checkResult`. `edit/commands/update-declaration.ts` needs only the file, parser and catalogue for the declaration text (call sites via `processCalls(state.model, …)`).
- `packages/lang-2610/src/printer/index.ts` `printDeclaration(node, {layout})`; printer fixtures in `packages/lang-2610/test/printer/` with `formatted/` goldens from `pnpm oracle --write-format` (generated, never edit).
- `e2e/details.spec.ts:341` asserts the details Code button is disabled "until F-304"; F-304 changes that assertion as ADR 0049 anticipated (not a weakening).

## 2. Design

### 2.1 What the Code tab edits
- **A separate, declaration-only Monaco model** (URI `nf-builder-popup:/<path>#<name>`, language `nextflow`), created when the Code tab first mounts and disposed when the popup closes. Not a range-limited view of the file model: the file model belongs to the Code view (ADR 0048 drafts and sync) and a hidden-area model can't stop edits leaking past the range.
- Its text is the declaration's `itemSpan` slice (doc comment included, so Code edits the description too). `declarationForm` returns it as `text`, with `span {start, end}` for Show whole file.
- **Parsing alone:** the worker parses `<the file's feature-flag statements before the declaration>\n\n<text>` (as `formSource` does) and requires: no parse problems; exactly one item, a `Process` of the same style as the original (typed). Problems come back with lines relative to `text`, ready for `problemsToMarkers`. Includes, functions, statements, a second declaration or a change of kind are refused with a message (kind: UX-42, open point 3).

### 2.2 One draft across tabs (UX-44)
Popup state gains `section: "configure" | "code"` and a `code` draft:
`{original: string; text: string; touched: boolean; baseForm: TypedProcessForm; check: "valid" | "checking" | "invalid"; problems: ParseProblem[]; message: string | null}`.
- **Untouched** (no typing or Format in Code yet): Configure is the truth and Apply is F-303's path, unchanged (call sites follow inputs exactly). Showing Code with a changed form displays `declarationText(base: null, form)`, rendered in the worker by applying `UpdateDeclaration` to a one-file scratch state and slicing the declaration; that is display only.
- **Touched**: the code text is the truth. Each edit re-arms a 300 ms check (`parseDeclaration`); a result for older text is dropped. Switching to Configure needs `check === "valid"`: the draft becomes the parsed form and `baseForm` the same (origins now refer to the code text's items). While invalid, the Configure tab is `aria-disabled` with title "Fix the code first: <message>". Configure edits after that are applied on top of the code text: switching back to Code, or Apply, first renders `declarationText(base: text, form: draft)` when `formChanged(baseForm, draft)`, then re-parses.
- Nothing is sent to the project before Apply. Cancel, Esc and narrowing discard both representations.

### 2.3 Apply
- Untouched: `canvasStore.editDeclaration` (F-303).
- Touched: Apply is disabled unless `check === "valid"` (step 2; `aria-disabled` plus `disabled` on the submit button, the problem in the status line and as markers). New `canvasStore.editDeclarationText({target, revision, text, name, node})`: same stale check; group `[renameDeclaration(old → name)]` when the parsed name differs, then `replaceDeclaration {path, name, text}`, then F-303's `moveFile` rule; label "Edit process <name>"; one `applyGroup`, so one undo step and a refused part discards the rest. The rename runs first so the replace finds the declaration under its new name. Extract F-303's rename parts into a shared helper `renameParts(target, newName)`.
- **`ReplaceDeclaration`** (new, lang-core + engine): finds the declaration, parses `text` alone (2.1), requires the same name, splices it over `itemSpan` with the file's line endings and no final newline, verbatim (not reprinted; open point 4). Unchanged text gives no patch. `applyCommand`'s AR-24/LA-13 guards run as for every command. Call sites: open point 2 (recommend: when the inputs change, remap call arguments by input name with `remapArguments`, refusing a piped call as `UpdateDeclaration` does).
- Refusals from the worker keep the popup open; problems in the declaration go to markers with owner `nf-builder-refusal` (positions mapped from file to declaration lines by subtracting the span's start line); others go to the status line.

### 2.4 Format, Show whole file, diagnostics
- **Format** (button in the Code toolbar, disabled while invalid): worker `formatDeclaration` parses alone and prints with `printDeclaration(process, {layout: createLayout(prefixed)})`, minus the final newline. The page replaces the model text as one Monaco edit (`pushEditOperations`, so Ctrl+Z in the editor undoes it) and marks the draft touched. Equal to `nextflow lint -format`'s slice for that declaration apart from ADR 0032's known differences (step 3 fixture avoids them).
- **Show whole file** (toggle button, `aria-pressed`): swaps the editor to a second, read-only model holding the file text with the declaration's span replaced by the current draft text, the declaration revealed and selected; `readOnlyMessage` "Edit the rest of the file in the Code view." (open point 1). Toggling back restores the declaration model, its cursor and undo stack.
- **Inline diagnostics:** parse problems of the draft as markers, owner `nf-builder-popup` (not the refusal owner). Lint diagnostics of the draft: open point 5.
- **Esc:** Monaco prevents default on keys it handles (closing the find widget), so the dialog's `cancel` doesn't fire then; e2e asserts it. Monaco's overflow widgets must render inside the modal `<dialog>` (top layer; the rest of the page is inert): keep the widgets in the editor's DOM (no `overflowWidgetsDomNode`), and e2e checks the find widget and context menu are usable.
- **Flush:** the popup editor registers a flush with `registerFlush` that moves the buffer into the popup draft (and runs a pending check); it never applies anything. With the modal open the history keys and buttons are inert anyway (open point 6).
- **Loading:** the editor is a lazy chunk (`declaration-editor.tsx`) imported when the Code tab first shows, so Configure-only use loads no Monaco (QA-01, ADR 0048). A chunk failure shows "The code editor couldn't load." in the panel; Configure keeps working.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/engine/src/form/declaration-text.ts` | `declarationSource(file: ScriptSourceFile, d: Declaration): {text: string; start: number; end: number}`; `flagPrefix(file: ScriptSourceFile, d: Declaration): string`; `type ParsedDeclaration = {ok: true; process: TypedProcess; file: ScriptSourceFile} \| {ok: false; message: string; problems: readonly ParseProblem[]}`; `parseDeclarationText(parser: SourceParser, prefix: string, text: string): ParsedDeclaration` (problems relative to `text`); `formatDeclarationText(parser: SourceParser, prefix: string, text: string): {ok: true; text: string} \| (ParsedDeclaration & {ok: false})` |
| `packages/engine/src/edit/commands/replace-declaration.ts` | `replaceDeclaration(state: EditState, command: ReplaceDeclaration): TextPatch[]` |
| `apps/web/src/popup/declaration-editor.tsx` | default `DeclarationEditor(props: {path: string; name: string; text: string; problems: readonly ParseProblem[]; refusal: readonly ParseProblem[]; wholeFile: {text: string; start: number; end: number} \| null; onChange(text: string): void; onFormat(): void})` (lazy) |
| `apps/web/src/popup/code-tab.tsx` | `CodeTab(props)`: toolbar (Format, Show whole file), status line, `lazy(() => import("./declaration-editor"))` |
| `packages/engine/test/form/declaration-text.test.ts`, `packages/engine/test/edit/replace-declaration.test.ts`, `packages/engine/test/service/declaration-code.test.ts`, `apps/web/test/code-tab.test.tsx`, `apps/web/test/edit-declaration-text.test.ts` | section 4 |
| `e2e/popup-code.spec.ts`; helpers in `e2e/popup.ts`: `openCodeTab(page)`, `codeText(page)`, `typeInPopupEditor(page, line, text)`, `CODE_EDITED`, `FORMAT_START`, `formattedSlice(name)` | section 4 |
| `tools/oracle/cases/f304-code-edited/`, `tools/oracle/cases/f304-format-start/`, `packages/lang-2610/test/printer/input/f304-format.nf` (copy of the case's process file) | section 4.4 |
| `docs/adr/0067-popup-code-tab.md` (next free number at merge) | section 7 |

### 3.2 Change
- **`packages/lang-core/src/edit.ts`:** `ReplaceDeclaration {kind: "replaceDeclaration"; path: string; name: string; text: string}` in `EditCommand` and `EDIT_COMMAND_KINDS`.
- **`packages/engine/src/edit/apply.ts`:** dispatch. **`edit/splice.ts`:** export `withEndings`. **`history/labels.ts`:** "Edit process <name>" for `replaceDeclaration`. **`layout/carry.ts`:** no hints (kind listed if the switch is exhaustive). **`test/edit/harness.ts`:** add `replaceDeclaration` to the property-test prelude if the harness enumerates kinds.
- **`packages/engine/src/service/types.ts`, `service.ts`:** `DeclarationFormResult` gains `text: string` and `span: {start: number; end: number}`. `EngineApi` gains
  `parseDeclaration(request: DeclarationCode): Promise<DeclarationCodeResult | EngineRefusal>`,
  `formatDeclaration(request: DeclarationCode): Promise<{revision: number; text: string} | EngineRefusal>`,
  `declarationText(request: {path: string; name: string; base: string | null; form: DeclarationForm}): Promise<{revision: number; text: string} | EngineRefusal>`,
  with `DeclarationCode {path: string; name: string; text: string}` and `DeclarationCodeResult {revision: number; name: string; form: DeclarationForm; choices: FormChoices}`. A text that doesn't parse is `does-not-parse` with declaration-relative `problems`. Export the new types from `packages/engine/src/index.ts`.
- **`apps/web/src/engine/expose.ts`, `engine-client.ts`, `workspace/workspace.ts`, `types.ts`:** pass the three calls through (read-only calls, no `change(...)`).
- **`apps/web/src/canvas/canvas-store.ts`:** `editDeclarationText(request: DeclarationTextEdit, session?: number): Promise<EditOutcome>` with `DeclarationTextEdit {target; revision; text; name; node}`; shared `renameParts`.
- **`apps/web/src/popup/popup-store.ts`:** `PopupRequest.section?: "configure" | "code"`; `Opened.section`, `Opened.code` (2.2); actions `showSection(section): Promise<void>`, `editCode(text: string): void`, `formatCode(): Promise<void>`, `flushCode(): Promise<void>`; `applyPopup` routes per 2.3; `canApply(state): boolean` exported for the button.
- **`apps/web/src/popup/edit-popup.tsx`, `popup.css`:** real tablist (Arrow keys move between tabs, `aria-selected`), Code panel, Apply disabled while invalid, Configure disabled while invalid; editor host height.
- **`apps/web/src/details/details-header.tsx`:** Code enabled with the same reason logic as Edit, opens with `section: "code"`; title "Edit this process's code".
- **`e2e/details.spec.ts`:** the F-206 F-303 test expects Code enabled for a typed process (rename the test to cite F-304).
- **Docs:** AR-21 gains `ReplaceDeclaration` ("from the popup's Code tab"); UX-43 and UX-44 only if open points change them; ADR README row.
- **Unchanged:** runtime dependencies, package boundaries and dependency-cruiser rules, stored and exported formats, workflows.

## 4. Tests (write first)

### 4.1 Engine (`pnpm --filter @nf-builder/engine test`)
- `form/declaration-text.test.ts`:
  - "F-304 UX-43: declarationSource is the itemSpan slice, doc comment included";
  - "F-304 UX-44: parseDeclarationText reads a typed process alone, with the file's types flag";
  - "F-304 step 2 UX-44: a syntax error gives problems on the declaration's own lines and columns";
  - "F-304 UX-44 UX-42: two declarations, an include, a statement, a workflow or a legacy process are refused";
  - "F-304 step 3 UX-43: formatDeclarationText equals the process's slice of `formatted/f304-format.nf`" (slice found by parsing the golden);
  - "F-304: formatDeclarationText is a fixed point".
- `edit/replace-declaration.test.ts`:
  - "F-304 UX-44 AR-22: only the declaration's span changes; every other declaration and include is byte-identical";
  - "F-304 AR-24: text that doesn't parse is refused with problems and nothing changes";
  - "F-304: a different name is refused (the store renames first)";
  - "F-304 LA-13 UX-42: a legacy process in place of a typed one is refused";
  - "F-304: CRLF files keep CRLF; unchanged text gives no patch";
  - "F-304 AR-23: the inverse restores the bytes";
  - call-site cases per open point 2.
- `edit/oracle-goldens.test.ts`: "F-304 step 1: replacing GREET's text in f303-configure-start gives f304-code-edited byte for byte"; "F-304 UX-44: renameDeclaration, replaceDeclaration and moveFile from the Code tab give f303-rename-moved".
- `service/declaration-code.test.ts`: `declarationForm` returns `text` and `span`; `parseDeclaration` gives the form of the edited text (step 1); `formatDeclaration`; `declarationText(base: null, form)` equals what `UpdateDeclaration` writes; `declarationText(base: text, form)` keeps a comment that only the code text has; no project → `no-project`.
- `history/labels.test.ts`: "Edit process GREET" for `replaceDeclaration`.

### 4.2 Web (`pnpm --filter @nf-builder/web test`)
- `popup-store.test.ts` (fake engine and canvas): "F-304 step 1 UX-44: Code edit then Configure shows the parsed form"; "untouched Code keeps F-303's Apply"; "F-304 step 2 UX-44: an invalid check disables Apply and Configure; fixing it enables both"; "an older check result is dropped"; "Configure edits after a Code edit are rendered over the code text before Apply"; "Apply after a Code edit calls editDeclarationText once with the parsed name"; "Cancel and close discard the code draft"; "read-only opens nothing (F-703)".
- `edit-declaration-text.test.ts`: group order `[renameDeclaration?, replaceDeclaration, moveFile?]` under one token and label; stale refusal; a refused part is discarded.
- `code-tab.test.tsx`: Format disabled while invalid; Show whole file is `aria-pressed`; the status line shows the first problem.
- `details-pane.test.tsx`: "F-304 UX-32: Code is enabled for a typed process and opens the popup on Code".
- `edit-popup` keyboard: Arrow keys move between tabs.

### 4.3 End-to-end (`pnpm test:e2e -- --grep F-304`), `e2e/popup-code.spec.ts`, Chromium
- "F-304 step 1 UX-44": from `f303-configure-start`, Code tab, add the `cpus 2` line and a comment, change the description; switch to Configure: description and directive `cpus` = `2` shown; Apply: one undo step "Edit process GREET", files equal `f304-code-edited` byte for byte, one Ctrl+Z restores the start bytes.
- "F-304 step 2 UX-44": delete a closing brace: Apply disabled, a Monaco error marker on the line and the parse message in the status line, Configure `aria-disabled`; undo the typo in the editor: Apply enabled.
- "F-304 step 3 UX-43": `f304-format-start`, Code tab, Format: editor text equals the process slice of `packages/lang-2610/test/printer/formatted/f304-format.nf`.
- Also: the editor host has `data-language="nextflow"`; Show whole file shows the other declarations read-only and back; Esc with the find widget open closes only the widget, then Esc closes the popup; the details Code button opens on Code; Ctrl+Z inside the editor doesn't change the project history; read-only doesn't open it; no CSP violation or console error.

### 4.4 Oracle cases (`pnpm oracle`; CI job `oracle`)
- `f304-code-edited`: `f303-configure-start` after the Code edit (new description, a comment, `cpus 2`); lint clean, stub-runs. Take the directive placement from `f303-directive-defaults`, not from memory.
- `f304-format-start`: a typed process laid out irregularly (indentation, spacing, blank lines) but lint-clean, with an entry workflow calling it; no ADR 0032 known differences (no `int`, `catch`, `f(1)(2)`). Its process file is also printer input `f304-format.nf`; `formatted/f304-format.nf` comes from `pnpm oracle --write-format` (needs the pinned Nextflow and Java 17+ locally; never hand-written).

## 5. Tasks
1. lang-core `ReplaceDeclaration`; engine `form/declaration-text.ts` and its tests; the `f304-format-start` case and printer input; golden by `pnpm oracle --write-format`. Done: `pnpm --filter @nf-builder/engine test -- declaration-text && pnpm --filter @nf-builder/lang-2610 test -- printer && pnpm check`.
2. Engine `replace-declaration.ts`, dispatch, label, `f304-code-edited` case, golden tests. Done: `pnpm --filter @nf-builder/engine test && pnpm oracle && pnpm check` (plus `pnpm test:corpus` if the harness changes).
3. Service API (`text`, `span`, `parseDeclaration`, `formatDeclaration`, `declarationText`) and the page pass-throughs. Done: `pnpm --filter @nf-builder/engine test -- service && pnpm check`.
4. Canvas store `editDeclarationText` and `renameParts`. Done: `pnpm --filter @nf-builder/web test -- edit-declaration && pnpm check`.
5. Popup store: sections, code draft, checks, routing of Apply, flush. Done: `pnpm --filter @nf-builder/web test -- popup-store && pnpm check`.
6. UI: `code-tab.tsx`, lazy `declaration-editor.tsx` (model, markers, Format, Show whole file, `registerFlush`), tabs, details Code button, CSS. Done: `pnpm --filter @nf-builder/web test && pnpm check`.
7. End-to-end tests and the F-206 details assertion. Done: `pnpm test:e2e -- --grep "F-304|F-303|F-206"` (with `PW_CHROMIUM_EXECUTABLE` in the sandbox), then `pnpm build && pnpm check:budget`.
8. Records: ADR, AR-21, ADR README, `features.json` (`passes`, notes), `progress.md`. Done: `pnpm check`.

## 6. Open points (none decided here)
1. **Show whole file: read-only or editable?** UX-43 says "switches to the full file". Editable means the popup applies a file-wide `ReplaceFileText`, outside "the declaration only". Recommend read-only with the declaration highlighted.
2. **Call sites after a Code edit.** `UpdateDeclaration` reorders or extends calls by row origin. A verbatim `ReplaceDeclaration` would leave calls lint-failing after an input change. Recommend remapping by input name inside `ReplaceDeclaration`; an input renamed in Code then counts as removed plus added (gets `null`), stated in the ADR.
3. **Changing kind, style or name in Code.** UX-42 forbids a kind control; Code could still turn a typed process into a legacy one or a workflow. Recommend refusing a change of kind or style ("The Code tab can't change what kind of declaration this is."), and allowing a name change as rename + replace + move (2.3).
4. **LA-45 versus a verbatim apply.** LA-45 says edited declarations are formatted; ADR 0048 applies Code view text verbatim, and UX-43 has an explicit Format. Recommend verbatim (Format is the user's choice) and record it as reading LA-45 for form edits only; else Apply reformats and Format becomes redundant.
5. **Lint diagnostics of the draft.** "Inline diagnostics" could mean pack lints on unapplied text, which needs a what-if model in the worker. Recommend parse problems live in F-304, plus the file's current diagnostics in the declaration's range while the text is unchanged; draft lints as a follow-up feature.
6. **`registerFlush` meaning for a draft.** The F-209 note asks for it; flushing a popup draft into the project would break UX-44's "nothing until Apply". Recommend a flush that only syncs buffer to draft.
7. **Hover help** (UX-43) has no owner feature. Recommend a new M3/M7 feature (`scope-change` label) rather than widening F-304.
8. **Esc with a code draft** discards without asking (ADR 0066). Typing more code raises the cost of a stray Esc; keep ADR 0066 or ask before discarding a touched code draft (would amend ADR 0066).

Ask-first items (AGENTS.md "Decide and record"): a new edit command and three `EngineApi` calls extend ADR 0039/0043/0066 (needs an ADR); open point 7 is a `features.json` scope change. No new dependency, format, boundary or workflow.

## 7. Records (drafts for the orchestrator)
- ADR "Edit a declaration's code in the popup: a declaration-only model, `ReplaceDeclaration`, and code as the truth once edited" (Accepted (agent)): 2.1 to 2.4 and the settled open points; amends ADR 0066 (Code tab, details Code button) and AR-21.
- `progress.md` Decisions: one line per settled open point.

## 8. Evidence
`git show origin/feat/F-303:` `docs/plan/features.json` (F-304, F-303), `docs/spec/ux.md` (UX-43, UX-44), `docs/adr/0048`, `0066`; worktree `/home/user/wt-F-303` files cited in 1.2.
