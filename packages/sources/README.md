# @nf-builder/sources

GitHub, zip and registry clients.

The import module (`src/import/`, F-403, IO-12) holds what both import routes share: limits, entry paths and the top-level folder rule, the ignore list, the text check, and file selection with its summary.

The registry client (F-502, IO-30) is `createRegistryClient`: a snapshot implementation, a live implementation that stays off until `registry.nextflow.io` allows cross-origin reads (`LIVE_REGISTRY`), and automatic fallback from live to the snapshot.

May import: `@nf-builder/lang-core` only (ADR 0003).
