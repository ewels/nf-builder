# nf-schema-builder and StageNest (Q9)

2026-11-21, researcher agent, for open question Q9 and FI-10 to FI-13.

## nextflow-io/schema-builder (nf-schema-builder)

- **Licence: none.** No LICENSE file on `main`, no `license` field in `pyproject.toml`. All rights reserved, so its code can't be copied.
- **Stack:** Python CLI (`nfsb`, v0.2.0) serving a Lit 3 app (`gui/`, Vite). Not published to npm or PyPI.
- **Not embeddable:** the only entry point is the whole-app element `<nfsb-app>`, driven by a module-level store that loads `api/schema` from its Python server. There is no property or event API to pass a schema in and get edits out, so FI-11 (sync with the `params` block) would need a fork.
- **Draft:** new schemas are JSON Schema draft 2020-12 with `$defs`; it still reads draft-07 `definitions`. nf-schema moved to 2020-12 (its migration guide), which matches FI-12.
- **Maintenance:** 27 commits, no releases; active in November 2026 but pre-release.
- **CSP note for FI-12:** Ajv compiles validators with `new Function`, which needs `'unsafe-eval'`. Precompile the 2020-12 validators at build time (Ajv standalone code) to keep QA-30.

**Decision:** build our own schema form in React (`apps/web`) with the schema logic in `packages/engine` (AR-31). Use schema-builder only as a behavioural reference: samplesheet schemas detected by `type: array` / `items` (FI-13 row mode); groups under `$defs` joined with `allOf`, plus a group for ungrouped parameters; unknown keywords and key order kept; the FI-10 fields plus samplesheet `meta`, `unique`, `exists`, `errorMessage`, `mimetype`; lints such as "default not of type" and "minimum > maximum". If upstream adds a permissive licence, its framework-free `gui/src/model/schema.ts` and `lint.ts` are worth porting.

Sources: https://github.com/nextflow-io/schema-builder (`pyproject.toml`, `gui/package.json`, `gui/src/store.ts`, `gui/src/model/templates.ts`, `nf_schema_builder/schema.py`), https://github.com/nextflow-io/nf-schema/blob/master/docs/migration_guide.md, https://github.com/ajv-validator/ajv/blob/master/docs/security.md

## StageNest

Not inspected: `stagenest.studio` is not reachable from the agent sandbox, and GitHub has no public StageNest repository. The React Flow showcase lists "StageNest Studio" as a browser-based visual editor that builds, edits and exports Nextflow pipelines.

Questions to check when someone can open it: does it import arbitrary existing Nextflow or only its own output; does a hand edit disable the canvas; does it support typed syntax and nf-core modules; how does it handle config and export.

A comparable open tool: N-WAVE (https://github.com/HCIstudio/N-WAVE, Apache-2.0, React with an Express and MongoDB server that runs Nextflow in Docker). It needs a server, so it conflicts with ADR 0002; useful for UX ideas only.
