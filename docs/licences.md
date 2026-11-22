# Third-party components

Every vendored file and runtime dependency with terms beyond a standard permissive npm licence goes here. Add an entry in the same PR that adds the component.

| Component | Use | Licence | Notes |
|---|---|---|---|
| nf-lang ANTLR grammars (`ScriptLexer.g4`, `ScriptParser.g4`, `ConfigLexer.g4`, `ConfigParser.g4`) from nextflow-io/nextflow | Vendored into each language pack (ADR 0005) | Apache-2.0, with BSD-licensed portions from the ANTLR Java grammar | Keep upstream headers; record tag and commit in `grammar/SOURCE.md` |
| CheerpJ | Spike S3 only (`e2e/s3-spike/`, loaded from its CDN in local test runs); not shipped (ADR 0026) | Commercial; free for FOSS projects | Q3 answered: not needed for v0.1 |
| Nextflow TextMate grammar (via Shiki) | Syntax highlighting in Monaco (ADR 0003) | Check during F-304 | |
