# 0069. Edit a declaration's code in the popup with a declaration-only model, ReplaceDeclaration, and the code as the truth once edited

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-43 gives the popup a Code tab: only the declaration, in Monaco, with Nextflow highlighting, inline diagnostics and hover help, a "Show whole file" switch and a "Format" button. UX-44 makes both tabs edit one pending state, disables Apply while the code doesn't parse, and makes Apply one undo step. ADR 0066 built the popup with Configure only: Code was an `aria-disabled` tab, the details header's Code button was disabled (ADR 0049), and Escape and Cancel discarded without asking.

The pieces at hand didn't cover a declaration on its own:

- AR-21 had `ReplaceFileText` for code editors and `UpdateDeclaration` for forms, but nothing that replaces one declaration's text.
- ADR 0048's Code view owns one Monaco model per file, with its own drafts and sync. A range-limited view of that model can't stop edits leaking past the range.
- A typed process parses as typed only after the file's `nextflow.enable.types = true`, so a declaration parsed alone needs its file's flags.
- LA-45 says edited declarations are formatted, while ADR 0048 applies Code view text as written and UX-43 has an explicit Format button.

ADR 0043 lists the worker's API, and ADR 0039 the edit commands and their rename and call-site limits. F-303 extended both (ADR 0066).

Research: the F-304 plan (deleted in the PR that merged F-304; its open points are settled in `docs/plan/handoff/README.md`, "F-304"); `nextflow-io/nextflow` `v26.10.7/docs/process-typed.mdx`. The oracle cases `f304-format-start` and `f304-code-edited` lint clean and stub-run on the pinned 26.10.7, and the printer fixture `f304-format` is a lint-clean fixed point of `nextflow lint -format`.

## Decision

- **Code tab enabled** (UX-43; amends ADRs 0049 and 0066). The popup's Code tab is enabled for every node the popup opens on (typed process calls, `popupTarget`). The details header's Code button opens the popup on the Code tab. In read-only mode the Code button isn't rendered and the popup doesn't open, as ADR 0066 has it for Edit.
- **A declaration-only model.** The Code tab has its own Monaco model, separate from the Code view's file model, created when the tab first shows and disposed when the popup closes. Its text is the declaration from its doc comment through its trailing comment (`itemSpan`), so Code edits the description too. The editor is a lazy chunk, so using only Configure loads no Monaco (QA-01, ADR 0048); if the chunk fails, the panel says "The code editor couldn't load." and Configure keeps working.
- **Parsed on its own** (amends ADR 0043's API list). The worker parses the text after the file's own feature-flag statements, including `nextflow.enable.types`, so a legacy declaration parses as legacy and a typed one as typed. The text must parse with no problems, as exactly one declaration of the same kind and style. Otherwise it is refused with these messages:
  - other code: "The Code tab edits one declaration. Remove the other code, such as an include, a function or a second declaration.";
  - a change of kind or style: "The Code tab can't change what kind of declaration this is." (UX-42, ADR 0008).

  `EngineApi` gains three read-only calls:
  - `parseDeclaration({path, name, text})` returns `{revision, name, form, choices}`, or `does-not-parse` with problems on the text's own lines;
  - `formatDeclaration` returns the text as `printDeclaration` lays it out, without a final newline;
  - `declarationText({path, name, base, form})` applies `UpdateDeclaration` to the declaration alone (to `base`, or to the project's text when `base` is null) and reads its text back, changing nothing.

  `declarationForm` also returns the declaration's `text` and its `span` in the file.
- **Diagnostics.** Parse problems of the draft show live as markers on the declaration's lines, with an owner other than `nf-builder-refusal`. Lints of unapplied text would need a what-if model in the worker and are deferred.
- **One draft, two representations** (UX-44, AR-30). Configure is the source of truth until the Code tab is edited (typing or Format). Before that, the Code tab shows the form rendered by `declarationText`, and Apply is F-303's path unchanged. Once the code is edited, its text is the truth:
  - each edit is checked again after a short pause, and a result for older text is dropped;
  - switching to Configure parses the code into the form, and is `aria-disabled` while the code doesn't parse, titled "Fix the code first: <message>";
  - later form edits are redrawn over the code text in the worker (`declarationText` with the code as `base`) when switching back to Code or on Apply.

  Nothing reaches the project before Apply.
- **`ReplaceDeclaration`** (AR-21; extends ADR 0039's command set). `{kind: "replaceDeclaration", path, name, text}` replaces the declaration's `itemSpan` with `text`, using the file's line endings. The text is parsed alone as above and must keep the declaration's name: "The code names the process <X>, not <NAME>. Nothing was changed." Unchanged text gives no patch, and the AR-24 and LA-13 guards run as for every command. Call sites follow the inputs by name:
  - each call's arguments are remapped to the new inputs by input name;
  - an input renamed in Code counts as one removed and one added, so its argument becomes `null` (ADR 0039's placeholder);
  - a call fed by a pipe refuses an input change with "change that call to a plain call first";
  - output renames are followed at call sites as `UpdateDeclaration` does, when the process has two or more outputs and their count and positions match.
- **Code text is applied as written** (reads LA-45 as applying to form edits). A Code edit is not reprinted on Apply. Format is the user's way to canonical layout: it is disabled while the code doesn't parse, uses `printDeclaration` (the same printer as LA-45, with ADR 0032's known differences), and replaces the editor text as one Monaco edit that Ctrl+Z in the editor undoes.
- **Apply with a Code edit** (UX-44, ADR 0051). Apply is disabled while the code doesn't parse. It applies one undo group labelled "Edit process <name>", in this order:
  1. `RenameDeclaration` to the text's name, when the text renames the process;
  2. `ReplaceDeclaration` with the text;
  3. `RenameDeclaration` to the form's name, when Configure renamed it after the Code edit;
  4. ADR 0066's `MoveFile` of the module folder, under the same conditions.

  The stale check, refusals that keep the popup open, and selecting the node again under its new name are as in ADR 0066.
- **Show whole file** is read-only. It swaps the editor to a second model holding the whole file, with the declaration replaced by the current draft, highlighted and revealed. Typing there says "Edit the rest of the file in the Code view." Switching back restores the declaration model with its cursor and undo stack.
- **Escape** (amends ADR 0066). Escape with an edited code draft (touched in Code and different from the declaration's text) asks "Discard your changes to the code?", with focus on Keep editing; Discard closes and changes nothing, and a second Escape keeps editing. An unedited draft, including one with only Configure changes, closes at once as before. Cancel discards without asking.
- **Inside the modal.** Monaco's find widget and context menu render in the editor's own DOM, so they work inside the modal `<dialog>`. Escape closes the find widget first, then the popup.
- **Keys.** Tab inside the popup's Monaco inserts a tab, as in the Code view; Ctrl+M then Tab leaves the editor (WCAG 2.1.2, audited in F-701).
- **Flush** (F-209). The popup editor's `registerFlush` only moves the editor's text into the popup draft. It never applies anything, so UX-44's "nothing until Apply" holds.
- **Hover help** (UX-43) moves to a new feature, F-317.

## Consequences

- A user can edit anything the form can't model (`record(...)` and `tuple(...)` inputs, non-string topics, `when:`) in place, as one undo step, without leaving the popup.
- Calls stay lint-clean after an input reorder or removal in Code. An input renamed in Code leaves a `null` argument that F-112 flags until it is connected again.
- Text applied from Code may not be canonically formatted. Format is one click, and the oracle checks templates and fixtures, not user projects.
- Two new e2e expectations replace ones that ADRs 0049 and 0066 marked as temporary: the details Code button and the popup's Code tab are enabled.
- Checked by `e2e/popup-code.spec.ts`, oracle cases `f304-format-start` and `f304-code-edited`, the printer fixture `f304-format`, and engine and web unit tests (`replace-declaration.test.ts`, `declaration-text.test.ts`, `declaration-code.test.ts`, `edit-declaration-text.test.ts`, `popup-store.test.ts`, `code-tab.test.tsx`).

## Alternatives

- A range-limited view of the file's Code view model: hidden areas can't stop edits leaking past the declaration, and the model belongs to the Code view's drafts.
- Applying Code edits with `ReplaceFileText` over the declaration's range: no name, kind or call-site rules, so an input change would leave calls failing lint.
- An editable Show whole file: the popup would apply file-wide edits, outside "the declaration only".
- Reformatting Code text on Apply: Format would be redundant and the user's layout lost.
- Keeping ADR 0066's silent discard on Escape: a stray key would lose typed code.
- Flushing the popup draft into the project on undo or export: breaks "nothing until Apply".
- Lints of the unapplied draft now: needs a what-if model in the worker; deferred.
