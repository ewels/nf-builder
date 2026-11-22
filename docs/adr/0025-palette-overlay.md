# 0025. Keep the palette overlay in YAML, generate JSON for the pack

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0005 adds a small hand-written `palette.yaml` to each pack for grouping, icons, defaults and docs links, naming only things the catalogue contains. F-109 needs it, a validation test, and a way to regenerate the catalogue in CI on demand. The pack will run in the browser and in the engine worker, and a YAML parser would be a new runtime dependency. The catalogue (generated from the language server, ADR 0020) lists directives, operators, factories, functions and feature flags, but not language constructs such as `process`, `workflow` or `record`, which come from the grammar. ADR 0007 says the palette offers only modern constructs. UX-12's fork and split groups contain only operators nf-lang marks deprecated.

## Decision

- `packages/lang-2610/palette.yaml` is the hand-edited source. `pnpm gen:palette` parses it and writes `palette.json` beside it, a generated file that is committed; unit tests in `pnpm check` fail when they differ and validate every name. The pack reads the JSON (`src/palette.ts`), so runtime dependencies don't change; `yaml` is a root dev dependency only. The types live in `@nf-builder/lang-core`.
- Each palette item names either a catalogue entry (a channel factory, an operator or a config scope) or a construct, which names a rule of the pack's own grammar and is checked against the generated parser's rule names.
- Legacy-only items are refused: a factory or operator whose every catalogue entry is `deprecated`, and constructs the grammar marks as legacy (`importDeclaration`, `paramDeclarationV1`, `legacyType`) or LA-34 forbids (`processWhen`). Groups that would be empty in 26.10 (UX-12's fork and split) are left out.
- Preview features stay in the palette with a `preview` badge, starting with `agent` (Q4).
- The palette and catalogue are not yet part of `LanguagePack`, so the main thread doesn't load them; F-204 decides how the palette reaches the UI.
- `ci.yml` also runs on `workflow_dispatch`, so the catalogue check (which uploads the regenerated files when they differ) can be run by hand; the token stays read-only.

## Consequences

- One more generated file to keep in step; the test and `--check` catch drift.
- Adding a palette item means a YAML edit plus `pnpm gen:palette`.

## Alternatives

- A YAML parser at runtime: a new runtime dependency.
- The overlay as TypeScript or JSON only: drops the YAML file ADR 0005 and F-109 name, and is less pleasant to edit.
- A dispatch workflow that commits the regenerated catalogue: needs a write token for little gain.
