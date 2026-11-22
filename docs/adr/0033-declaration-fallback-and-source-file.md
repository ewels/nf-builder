# 0033. Fall back per declaration, print untouched code from its source, and load the parser lazily

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0004 says files are authoritative: a file the strict grammar rejects is kept verbatim, and one bad declaration is kept as raw text, isolated by a brace-aware pre-scanner, while the rest of the file is modelled. IO-14 says import never fails because of code the app can't model, and IO-20 that untouched files export equivalent to what was imported. AR-01 asks for a `SourceFile` holding path, text, language, parse status, AST and comment map. The nine malformed fixtures in `tools/corpus/fixtures/fixtures.yaml` record which declarations must be isolated. Four of them fail the grammar; three parse but carry builder errors that nf-lang reports on one declaration. ADR 0027 keeps the parser off the pack entry until the engine loads it; the architecture sketch still showed synchronous `parseScript`/`parseConfig` on `LanguagePack`. Research: the [F-104 plan](https://github.com/ewels/nf-builder/blob/f29d22e/docs/plan/handoff/plan-F-104.md).

## Decision

- **Two tiers.** Each file is parsed whole first. If the grammar rejects it, a hand-written pre-scanner (`packages/lang-2610/src/source/prescan.ts`) splits it into top-level chunks; each chunk is parsed alone in fragment mode (whole-script checks off, the types flag carried forward) and its ranges are shifted back to file positions. A chunk that still fails becomes an `Unparsed` item holding its exact text, its head (keyword and name) and its own errors. If the grammar accepts the file, any item an error starts inside, and any `InvalidDeclaration`, becomes `Unparsed`; code the builder dropped is kept as `Unparsed` too.
- **The pre-scanner** is lexical, linear, never throws and never recurses. It knows comments (an unterminated `/*` runs to the end, so `unclosed-comment.nf` stays verbatim as recorded), strings, GStrings and slashy strings. It splits scripts after a `}` that closes depth 0 and before a top-level starter keyword, and configs before each top-level statement, unless the neighbouring line continues the expression. Comment-only lines between declarations lead the next chunk, as nf-lang attaches them.
- **Whole-script checks** (duplicate params, output or entry workflow, mixed statements and declarations, and the rest of nf-lang's file-level errors) carry `scope: "file"`: they stay file problems and never isolate a declaration.
- **Status:** `modelled` (no `Unparsed`), `partial` (some), `verbatim` (something failed and nothing could be modelled), `plain` (not Nextflow).
- **`Unparsed` joins the script and config item unions**, so every consumer handles it.
- **`ParseProblem.source` gains `"internal"`** for exceptions and model-check failures, which downgrade the file to verbatim instead of failing.
- **Print** emits each untouched item from its source slice and the trivia between items from the file text, so an unedited file prints byte for byte. The printer (ADR 0032) is used only for new and edited declarations (F-111).
- **Equivalent** (the glossary) is read as: same language and status family; ASTs equal after dropping ranges and comment slots, with line endings normalised inside strings; `Unparsed` compared by normalised text and head; comments compared as the ordered list of kind and normalised text; verbatim and plain files compared as normalised text (line endings unified, trailing whitespace dropped at line ends and at the end).
- **`LanguagePack.loadParser()`** replaces the sketch's synchronous parse methods. It is a dynamic import, like `loadCatalogue()` (ADR 0028), and the loaded `SourceParser` also carries the pack's printer, so parser and printer share one lazy chunk. The engine memoises it per pack.
- **`SourceFile`** lives in lang-core and is built by the engine (`createSourceFile`). It is in memory only: IndexedDB and exports keep file text (ADR 0004), so it is not a stored or exported format.

## Consequences

- A failing file is parsed at most twice (whole, then per chunk).
- Every lint-clean corpus file is fully modelled and every corpus file prints back byte for byte; the forced-chunk property (every corpus file split and stitched back) guards the pre-scanner on real code.
- F-111 can splice printer output into one item's slice and check every other item stays equivalent; F-404 exports untouched files byte for byte.
- The parser and printer stay out of the initial bundle (QA-01); an end-to-end test checks the built manifest.

## Alternatives

- A token-based scanner on the generated lexer: it doesn't treat an unterminated `/*` as a comment, so `unclosed-comment.nf` would be partly modelled, contradicting the fixture.
- Masking other chunks instead of slicing: simpler, but quadratic in file size times chunks.
- A separate model type wrapping the AST: two near-identical root types for F-105 onwards.
- Always chunking: costs a second parse on every file for no gain on files that parse.
