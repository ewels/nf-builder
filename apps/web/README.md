# @nf-builder/web

The app. `src/engine/` starts the engine worker and talks to it through Comlink (ADR 0043).

May import: `@nf-builder/lang-core`, `@nf-builder/engine` and `@nf-builder/sources`; never a language pack directly (ADR 0003).

Only `vite.config.ts` may also import the root build-time `scripts/` (ADR 0014); nothing under `src/` may.
