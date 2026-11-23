# @nf-builder/sources

GitHub, zip and registry clients.

The registry client (F-502, IO-30) is `createRegistryClient`: a snapshot implementation, a live implementation that stays off until `registry.nextflow.io` allows cross-origin reads (`LIVE_REGISTRY`), and automatic fallback from live to the snapshot.

May import: `@nf-builder/lang-core` only (ADR 0003).
