# @nf-builder/lang-core

Model types, edit commands, the language pack interface.

May import: no other workspace package (ADR 0003).

`src/ast/` holds the script AST types, source ranges, comments and a walker (AR-02, ADR 0027); the builders live in each pack.
