# 0039. Apply edits as text patches with inverses, reprinting whole declarations, behind AR-24 and LA-13 guards

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

AR-20 to AR-24 make every canvas or form change a command that the engine applies to the source and that can be undone. LA-45 and ADR 0032 say edited declarations are formatted and untouched ones keep their text. F-104 and F-110 left open how far a command reprints. AR-24 says a command that would produce unparseable code is refused, but imported files may already have problems (ADR 0004). LA-13 says typed and legacy definitions never share a script, yet `nextflow lint` 26.10.7 accepts mixing that depends on position ([upstream bug 20](../research/upstream-bugs.md)). LA-12 doesn't say how a new process's directory and include are written. The formatter also re-indents multi-line string content, which changes the string's value ([upstream bug 23](../research/upstream-bugs.md)). Research: the [F-111 plan](https://github.com/ewels/nf-builder/blob/c092032/docs/plan/handoff/plan-F-111.md).

## Decision

- **Commands** are plain data (`lang-core/src/edit.ts`). Node and declaration ids are resolved when the command is applied. Applying returns one `TextPatch` per path (`edit`, `create` or `delete`) plus the inverse command. `commit` is separate from apply. History is F-207's: patches and inverses live in memory only.
- **Reprint level:**
  - workflow-body commands reprint the whole enclosing declaration;
  - renames edit identifiers in place;
  - include inserts go at item boundaries;
  - `ReplaceFileText` replaces a file.

  Untouched declarations keep their text (LA-45).
- **AR-24, read as "no problem the file didn't have":** a result is refused when a changed file gains a problem key (lexer, parser, builder or internal) it didn't have before. Problems already in the file don't block, so partial imports stay editable and `ReplaceFileText` can repair a broken file.
- **LA-13:** our own check refuses a result that newly mixes typed and legacy definitions in a script, whatever the order, because lint doesn't catch every case. The pack tags nf-lang's mixing errors with `ParseProblem.code` `mixed-definitions`. Files that are already mixed stay editable.
- **Code conventions:**
  - **Placeholders:** a missing earlier positional input is `null`. Disconnect removes a trailing positional argument and replaces an earlier one with `null`.
  - **New variables:** the callee in lower case (`FASTQC` becomes `fastqc`), or `<factory or last operator>_ch`, then `_2`, `_3` until the name is free. AddCall never assigns.
  - **Connect:** moves a later source above its target when that is safe, otherwise refuses.
  - **DeleteNode:** removes the statement and clears the direct arguments it fed. Indirect reads stay for F-112 to report. Role nodes can't be deleted.
- **CreateProcess (LA-12):** writes `modules/local/<lower>/main.nf` from `LanguagePack.scaffold`, script-only with no ports, and includes it as `<rel>/modules/local/<lower>/main.nf`. Ports come from Configure (F-303).
- **Rename limits:**
  - `withName` selectors aren't updated;
  - files don't move;
  - shadowing is ignored;
  - `Unparsed` text is left alone.
- **Interface growth:** `LanguagePack.scaffold` and `ParseProblem.code`. Both live in memory, with no change to package boundaries or dependency-cruiser rules.
- **Known difference `string-reindent`** (amends ADR 0032): the printer keeps multi-line string content verbatim, where `nextflow lint -format` re-indents it. This is a sixth known difference, with a fixture, corpus entries and the three ported formatter cases marked. It lets reprinted declarations compare exactly with the corpus.
- **fast-check 4.11.0** is an engine dev dependency for the property tests (ADR 0011).

## Consequences

- Undo, redo and autosave (F-207) store patches and inverses. Canvas edits (F-301 to F-310) and quick fixes (F-112, as `ReplaceFileText`) all go through `applyCommand`.
- Reprinting a declaration can change formatting inside it; the edit corpus test checks that reprinted declarations keep the same structure.
- The guards run on every result. The property tests (`test/edit/properties.test.ts`) and the corpus reprint (`test/corpus/edit.corpus.ts`) check them. Oracle cases `f111-*` lint and stub-run the edited trees.

## Alternatives

- A statement-level printer: smaller diffs, but it needs insertion and indent rules for each section, and the spec doesn't ask for it.
- Refusing any file that has a problem: would block repairs and partial imports.
- Relying on lint for LA-13: it misses mixing that depends on position.
- Shifting positional arguments on Disconnect: changes their meaning.
- Following the formatter's string re-indentation: changes string values.
