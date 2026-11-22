# @nf-builder/lang-core

Model types, edit commands, the language pack interface.

May import: no other workspace package (ADR 0003).

`src/ast/` holds the script AST types, source ranges, comments and a walker (AR-02, ADR 0027); the builders live in each pack.

`src/printer.ts` holds the `ScriptPrinter` interface and `PrintError`; `NO_RANGE` (in `src/ast/range.ts`) marks nodes an edit created (F-110).
`src/source-file.ts` holds `SourceFile` (AR-01) and `SourceParser`, with `Unparsed` (in `src/ast/unparsed.ts`) for text a pack cannot model (F-104, ADR 0033).
