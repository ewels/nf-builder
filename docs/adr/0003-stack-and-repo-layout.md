# 0003. TypeScript and React in a pnpm monorepo with tool-enforced boundaries

- Status: Accepted
- Date: 2026-11-21

## Context

Agents write the code, so the stack should be mainstream, strongly typed and quick to check. Agents also blur layers unless a tool stops them. React Flow and Monaco were requested.

## Decision

**Stack:**
- TypeScript (`strict`, `noUncheckedIndexedAccess`), React, Vite, pnpm.
- React Flow (`@xyflow/react`) for the canvas. ELK.js for auto-layout.
- Monaco with Shiki's Nextflow grammar for code editing.
- Zustand for UI state. Comlink for workers. fflate, `yaml` and Ajv for zip, YAML and JSON Schema.
- Biome, Vitest and Playwright for lint, unit tests and end-to-end tests.

Versions are pinned at scaffold time and kept current by Renovate.

**Packages:**

| Package | Role | May import |
|---|---|---|
| `packages/lang-core` | Model types, edit commands, the language pack interface | nothing internal |
| `packages/lang-2610` | Nextflow 26.10 pack (ADR 0006) | `lang-core` |
| `packages/engine` | Parse, model, projection, edits, printing. No DOM; runs in a worker | `lang-core`, packs via the interface |
| `packages/sources` | GitHub, zip and registry clients | `lang-core` |
| `apps/web` | The app | all of the above, but never a pack directly |
| `tools/spec-extract`, `tools/corpus` | Build-time tools (ADRs 0005, 0011) | standalone |

dependency-cruiser enforces the table in `pnpm check`. Its error messages say where the code should go instead.

## Consequences

- Each package can be tested on its own, which keeps agent loops short.
- Monaco is heavy: it is lazy-loaded, and phones get read-only mode.

## Alternatives

- CodeMirror 6: lighter, but Monaco was asked for. Revisit if the load budget breaks.
- Single package: boundaries would live only in prose.
- ESLint plus Prettier: slower. Biome plus dependency-cruiser covers what we need.
