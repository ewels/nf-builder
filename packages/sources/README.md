# @nf-builder/sources

GitHub, zip and registry clients.

The import module (`src/import/`, F-403, F-401, IO-12) holds what both import routes share: limits, entry paths, the ignore list, the text check, file selection with its summary, and the plan for a listing.

The GitHub client (`src/github/`, F-401, IO-10) is the `./github` entry. It runs in the document, never in a worker (QA-30). The registry client (F-502, IO-30) is `createRegistryClient`.

May import: `@nf-builder/lang-core` only (ADR 0003).
