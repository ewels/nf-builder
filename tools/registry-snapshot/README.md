# @nf-builder/registry-snapshot

Build-time tool (F-501, IO-31, ADR 0035): builds the static registry snapshot that the site serves at `/registry/`. It may import `packages/lang-core` and a language pack's entry module (the pack classifies typed and legacy modules), and nothing else in the workspace (ADR 0003, amended by ADR 0035).

This is the skeleton from F-501 task 1. The API client, tar reader, classifier, builder and CLI arrive in later tasks.

- The tool runs under plain Node type stripping, so `packages/lang-2610` and this package use only erasable TypeScript syntax (`erasableSyntaxOnly`).
