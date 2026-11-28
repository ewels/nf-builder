# Plan: F-505, plugins from the palette into `nextflow.config`, their functions in the palette, their scopes in the config editor

Written by the planner on 2026-11-28 from `origin/main` at `0f6e1d3` (F-503 merged), with F-601 in progress on `feat/F-601` (`/home/user/wt-F-601`, at `c39046a`: config printer and config rules landed, the five config commands not yet) and F-301 on `feat/F-301` (`/home/user/wt-F-301`), both designed from their plans. I changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**In scope:**
- **Add a plugin from the palette (IO-33, UX-15):** a registry Plugins row becomes focusable and draggable; Enter on it, or dropping it on the canvas, writes `id '<id>@<version>'` into the `plugins` block of the project's root `nextflow.config`, creating the block (and the file) when absent. One undo step.
- **`RegistryClient.plugin(id, version)`** (F-502 and F-503 notes, ADR 0050's deferred surface): reads `plugins/<id>/<version>.json` from the snapshot.
- **Declared plugins drive the rest:** the plugins declared in `nextflow.config` (whether added here, by the F-601 form, in Code or by import) are read in the worker; their specs are fetched in the document.
- **Palette (IO-33):** each declared plugin's functions, operators and factories are listed in the palette and found by the shared search (UX-11). They are shown, described and focusable, not yet insertable (open point 3).
- **Config editor (FI-01):** each declared plugin's `ConfigScope` definitions join the config catalogue the F-601 editor, `configSchema` and the `config-unknown-option` warning use, so `validation.*` (nf-schema) is no longer flagged once nf-schema is declared.

**Out of scope:**

| What | Owner |
|---|---|
| Inserting a plugin function, operator or factory into a workflow (`include { x } from 'plugin/<id>'` plus a call) | The "remaining palette items" feature F-301's plan proposes (its point 1, `AddInclude`); open point 3 |
| Replacing F-601's free-text "Add plugin…" with a registry picker | Open point 6 |
| Changing a declared plugin's version, or "update available" for plugins | Open point 5 |
| Plugins under `profiles`, or in `includeConfig`ed files | Open point 7 |
| Live plugin specs | ADR 0050: live is gated off and can only prune plugins |

## 1. Findings

### 1.1 Spec and ADRs
- **IO-33:** "Adding a plugin writes `id '<name>@<version>'` into the `plugins` block of `nextflow.config`. The plugin's functions, operators and factories join the palette, and its config scopes join the config editor."
- **FI-01:** "Parsed with the pack's config grammar. Each top-level scope is a collapsible card. Scopes and options come from the catalogue (`config.json`) and plugin specs."
- **ADR 0050:** fetch the snapshot in the document with `import.meta.env.BASE_URL`, JSON content type checked, held in memory; `plugin` "comes with F-505". **ADR 0058:** plugin rows are `li.registry-item` with `data-name=<id>`, `summary` as title; rows stay unfocusable "until F-504 and F-505"; search covers plugin id and summary; no second `role="status"` in the palette.
- **F-505 notes:** the snapshot version is the highest release admitted by the pinned Nextflow; plugins have `summary`, no description; read-only (F-703) refuses or hides inserts.
- **No spec text** says where plugin functions sit in the palette, what dragging one does, which version to use for a plugin declared at another version or none, or whether plugins inside profiles count.

### 1.2 Nextflow syntax (checked, not from memory)
- `packages/lang-2610/catalogue/config.json`: `plugins` is `{kind: "dsl", dsl: "PluginsDsl"}`; the catalogue gives no method signature. The config AST (`ConfigApplyBlock`, nf-lang `ConfigApplyBlockNode`) accepts only the name `plugins`, with `ConfigApply` statements.
- docs.seqera.io/nextflow/plugins/using-plugins (fetched 2026-11-28): `plugins { id 'nf-hello@0.5.0' id 'nf-amazon@2.9.0' }`, one `id` per line; "Nextflow will attempt to download newer versions of plugins if their versions are not set."
- docs.seqera.io/nextflow/plugins/developing-plugins: functions, factories and operators are imported with `include { reverseString } from 'plugin/my-plugin'` (relevant to open point 3 only); `packages/lang-2610/src/includes/resolve.ts` already resolves `plugin/<id>` targets.
- F-601 (plan 1.3): `plugins { id 'nf-schema@2.5.1' }` is lint clean offline with the pinned 26.10.7; a run would download the plugin, so plugin cases are lint-only. F-505's own case is proved by the oracle in task 4, not assumed.

### 1.3 Code on main and the branches F-505 builds on
- **Registry client** (`packages/sources/src/registry/`): `RegistryClient {source; index(); ports()}`; `createSnapshotClient` holds `index.json` and `ports.json` promises; `request`/`readJson`/`RegistryError` in `errors.ts`; the combined client delegates `ports` to the snapshot. `SnapshotPluginFile` and `PluginDefinition` types already exist in `packages/lang-core/src/registry-snapshot.ts`.
- **Fixture snapshot** (`tools/registry-snapshot/test/fixtures/expected/registry/`): `nf-schema` 3.1.0 (21 definitions: one `ConfigScope` `validation` with 11 children, 20 `Function` overloads of 6 names) and `nf-ffq` 0.2.0 (0 definitions). No `Operator` or `Factory` in the fixture: unit tests need a hand-written spec.
- **Palette:** generic region from the pack (`PaletteView`, closed `PaletteCategoryId` union, search by `searchPalette`/`queryTerms`); registry region `apps/web/src/registry/registry-lists.tsx` (`RegistryPlugins`, `RegistryRow`); the single status message rule `apps/web/src/palette/palette-message-rule.ts`.
- **F-301 (branch):** palette rows become buttons; `PALETTE_MIME`, `writePaletteDrag`/`readPaletteDrag` (`apps/web/src/palette/palette-drag.ts`), the canvas host's drop handler, `usePaletteAdd` and a polite live region in the palette. F-505 reuses all of these.
- **F-601 (branch):** lang-core `AddConfigPlugin {kind: "addConfigPlugin"; path; id}` and `RemoveConfigPlugin`; engine `edit/commands/config.ts` `addConfigPlugin` (refuses a duplicate plugin name and a malformed id `^[A-Za-z0-9._-]+(@[A-Za-z0-9._+-]+)?$`; new top-level blocks appended at the end); label "Add plugin nf-schema@2.5.1"; `printConfigStatement` prints the `id` line; `createConfigRules(catalogue)` (`packages/lang-2610/src/config/index.ts`) behind `LanguagePack.loadConfigRules()`; `classifyPath(catalogue, names)` shared by the view and the `config-unknown-option` rule, which reads `context.catalogue.config`; `EngineApi.configView(path)` and `configSchema(version)`. Its plan's note to F-505: "merge each declared plugin's `ConfigScope` definitions into `ConfigRules.classify` and `configSchema`; reuse `addConfigPlugin`".
- **Main:** `CreateFile` (F-210) exists; `canvasStore.apply(cmd, session, {group, label})` refuses `read-only` (F-703); diagnostics are pulled per revision (F-309).

### 1.4 What F-505 reuses from F-601, exactly, and the wait
- **Reused as is:** `AddConfigPlugin` (type, command, refusals, label), `printConfigStatement` for the `id` line, the 2.6 placement rules, `RemoveConfigPlugin` (functions disappear when a plugin is removed from the plugins card), `classifyPath`, `createConfigRules`, `configSchema`, `configView`, the `config-unknown-option` rule and `CORE_PLUGIN_SCOPES`.
- **Extended:** `createConfigRules` and `configSchema` take a catalogue with plugin scopes merged; the diagnoser gets the merged catalogue.
- **Must wait for F-601 to merge:** tasks 4 to 7. Tasks 1 to 3 touch only `packages/sources`, `packages/engine` pure modules and lang-core types and can start now. **Must wait for F-301 to merge:** task 6 (rows, drag, Enter). Open point 1.

## 2. Design

### 2.1 Reading plugin specs (sources)
- `RegistryClient.plugin(id, version, options?)` resolves a `SnapshotPluginFile`, snapshot-only (combined and live clients delegate, as `ports` does). URL `${snapshotUrl}plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}.json`; `credentials: "omit"`; JSON content type checked; validated (`format === 1`, `id` and `version` equal to the request, `definitions` an array; else `invalid`); 404 or 410 is `unavailable` ("This registry snapshot has no spec for <id> <version>."). Held per `id@version`; a failed read is dropped so a later call reads again. Never read at palette load.

### 2.2 Declared plugins (worker)
- `declaredPlugins(file: ConfigSourceFile): DeclaredPlugin[]` (engine, pure): every `id` in the top-level `ConfigApplyBlock`s of the root `nextflow.config`, in source order, split at the first `@` into `id` and `version | null`; non-string arguments are skipped.
- `EngineApi.plugins(): Promise<PluginsResult | EngineRefusal>` gives `{revision, plugins}`; pulled by the page whenever `summary.revision` changes (amends ADR 0043's API list).

### 2.3 The plugin store (page)
`apps/web/src/registry/plugin-store.ts`:
1. On each new revision, pull `plugins()`.
2. For each declared plugin, choose the spec version: the declared version if the snapshot index's version equals it; otherwise the index's version, marked `approximate: true`; none when the index lacks the id or lists `definitions: 0` (open point 5).
3. Read missing specs with `registryClient.plugin`, in parallel, in the document.
4. Publish `PluginSpecState {declared; specs: readonly LoadedPlugin[]; failures}` for the palette, and send the config scopes to the worker with `EngineApi.setPluginScopes(scopes)` when their key (`id@version` list) changes.

### 2.4 Plugin scopes in the config catalogue (worker)
- `pluginConfigNodes(spec: SnapshotPluginFile): ConfigNode[]` (engine, pure): each `ConfigScope` definition becomes a catalogue `scope` with `option` children; `PluginTypeRef` printed as the catalogue writes types (`Map<String, Object>`); missing descriptions become "".
- `mergePluginScopes(config: ConfigCatalogue, scopes: readonly PluginScopes[]): ConfigCatalogue`: appends plugin scopes; a name the pack already has (a core scope) keeps the pack's node and adds only missing children; the result is memoised on the scopes key.
- The service keeps the scopes for the open project (cleared on `open` and `close`) and uses the merged catalogue in the diagnoser, `createConfigRules`, `configSchema` and `configView`. `DiagnosticsResult`, `ConfigViewResult` and `ConfigSchema` gain `pluginsKey: string`, and the problems, config and schema stores re-pull when the plugin store's key changes as well as on a new revision (open point 4).
- FI-04 for plugin options: description and types from the spec; the docs link is the plugin's `projectUrl` from the index, else none (open point 8).

### 2.5 Plugin items in the palette (engine pure, web)
- `pluginPaletteGroup(spec: SnapshotPluginFile, version: string, approximate: boolean): PluginPaletteGroup` (engine): one item per distinct `(kind, name)`; overloads folded into `signatures` (`samplesheetToList(String, Path) -> List`); kinds `function`, `operator`, `factory` with the existing glyphs; key `plugin:<id>:<kind>:<name>`; `summary` is the first paragraph of the description, else the first signature.
- `searchPluginGroups(groups, terms)`: matches name, plugin id, description and signatures with `queryTerms`, like `searchPalette`.
- **Placement:** a "From plugins" list at the end of the generic region's "Plugins & config" category, one sub-heading per plugin (`nf-schema 3.1.0`), session-only open state (open point 2). Counts join `paletteMessage`'s language count, so the single status message rule still holds.
- Rows are focusable buttons with the summary as accessible description (QA-11); `aria-disabled="true"`, not draggable; Enter announces "<name> can't be added from the palette yet." (open point 3).

### 2.6 Adding a plugin (web)
- Registry plugin rows become F-301-style buttons: draggable with `PALETTE_MIME` and key `registry-plugin:<id>`; Enter or a drop on the canvas calls `canvasStore.addPlugin({id, version}, session)`.
- `addPlugin`, one queued task:
  1. refuse with no project, an older session, or read-only (existing guard);
  2. await `flushCode()`;
  3. if `nextflow.config` is missing, `apply(createFile, rev, {group})` first;
  4. `apply({kind: "addConfigPlugin", path: "nextflow.config", id: "<id>@<version>"}, rev, {group, label: "Add plugin <id>@<version>"})`;
  5. if step 4 is refused after step 3 applied, undo once (F-301's rollback).
- Group token `plugin-<session>-<counter>` (F-301 point 14). No node is drawn, the viewport is untouched, and the Files view refreshes on its own.
- **Copy** (live region from F-301):
  - "Added plugin nf-schema@3.1.0 to nextflow.config."
  - "nf-schema is already in nextflow.config." (the duplicate refusal; open point 5)
  - "Couldn't add nf-schema: <engine message> Nothing was changed."
- An already-declared plugin's row shows an "added" badge (text, not colour only; QA-12) from the plugin store.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/sources/src/registry/plugin.ts` | `parsePluginFile(value: unknown, url: string, id: string, version: string): SnapshotPluginFile` |
| `packages/sources/test/registry-plugin.test.ts` | section 4 |
| `packages/engine/src/plugins/declared.ts` | `DeclaredPlugin {id: string; version: string \| null; range: Range}`; `declaredPlugins(file: ConfigSourceFile): DeclaredPlugin[]` |
| `packages/engine/src/plugins/config-scopes.ts` | `PluginScopes {id: string; version: string; nodes: readonly ConfigNode[]}`; `pluginConfigNodes(spec: SnapshotPluginFile): ConfigNode[]`; `typeRefText(t: PluginTypeRef): string`; `mergePluginScopes(config: ConfigCatalogue, scopes: readonly PluginScopes[]): ConfigCatalogue`; `pluginsKey(scopes): string` |
| `packages/engine/src/plugins/palette.ts` | `PluginPaletteItem {key; kind: "function" \| "operator" \| "factory"; name; summary; description; signatures: readonly string[]}`; `PluginPaletteGroup {id; version; approximate: boolean; items: readonly PluginPaletteItem[]}`; `pluginPaletteGroup(spec, version, approximate): PluginPaletteGroup`; `searchPluginGroups(groups, terms: readonly string[]): PluginPaletteGroup[]` |
| `packages/engine/test/plugins/{declared,config-scopes,palette}.test.ts`, `packages/engine/test/plugins/fixtures/nf-hand.json` (hand-written spec with an operator and a factory) | section 4 |
| `tools/oracle/cases/f505-plugin/**` | the blank template's files with `nextflow.config` as `addConfigPlugin` leaves it; `cases.yaml` entry `lint: {expect: ok, clean: true}`, no `run` (a run downloads the plugin), `spec: [F-505, IO-33]` |
| `apps/web/src/registry/plugin-store.ts` | `LoadedPlugin {id; version; approximate; spec: SnapshotPluginFile}`; `PluginSpecState`; `createPluginStore(deps)`; `usePlugins` |
| `apps/web/src/palette/plugin-groups.tsx` | `PluginGroups({groups, searching})` |
| `apps/web/test/{plugin-store,plugin-groups}.test.tsx` | section 4 |
| `e2e/plugins.spec.ts` | section 4 |

### 3.2 Change
- **`packages/sources/src/registry/{types,snapshot,client,live}.ts`, `index.ts`:** `RegistryClient.plugin(id: string, version: string, options?: RegistryReadOptions): Promise<SnapshotPluginFile>`.
- **`packages/engine/src/service/{types,service}.ts`:** `PluginsResult {revision: number; plugins: readonly DeclaredPlugin[]}`; `EngineApi.plugins()`, `EngineApi.setPluginScopes(scopes: readonly PluginScopes[]): Promise<{pluginsKey: string}>`; `pluginsKey` on `DiagnosticsResult`, `ConfigViewResult` and `ConfigSchema`; the merged catalogue passed to the diagnoser and F-601's config functions.
- **`packages/lang-2610/src/config/index.ts` / `LanguagePack`:** a way to build `ConfigRules` over a given catalogue (for example `loadConfigRules(catalogue?: ConfigCatalogue)`); the exact shape follows F-601 as merged.
- **`packages/engine/src/index.ts`:** export the 3.1 engine types and functions.
- **`apps/web/src/engine/engine-client.ts`, `apps/web/src/workspace/{types,workspace}.ts`, `e2e/engine.ts`:** pass `plugins` and `setPluginScopes` through.
- **`apps/web/src/canvas/canvas-store.ts`:** `PluginAdd {id; version}`; `addPlugin(request, session?): Promise<PaletteAddOutcome>`; drop dispatch on the `registry-plugin:` key prefix.
- **`apps/web/src/registry/registry-lists.tsx`, `palette/palette-panel.tsx`, `palette/palette-category-section.tsx`, `palette/palette-message-rule.ts`, `palette.css`:** plugin rows as buttons with the added badge; the "From plugins" list; counts.
- **F-601's config, problems and schema stores:** re-pull on `pluginsKey`.
- **Unchanged:** workflows, CSP and host allow-list (same-origin snapshot), IndexedDB, sidecar and snapshot formats, dependency-cruiser rules, AGENTS.md commands.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **`packages/sources/test/registry-plugin.test.ts`** | |
| `F-505 IO-33 IO-30: plugin(id, version) reads plugins/<id>/<version>.json from the snapshot once and validates it` | URL with encoded segments, one fetch for two calls, `credentials: "omit"`; the fixture nf-schema 3.1.0 parses |
| `F-505 IO-30: plugin is snapshot-only; the combined and live clients delegate and never call registry.nextflow.io` | |
| `F-505 IO-30: 404 is unavailable, HTML is invalid, a mismatched id or version is invalid, and a failed read is retried` | codes and messages |
| **`packages/engine/test/plugins/declared.test.ts`** | |
| `F-505 IO-33: declaredPlugins lists top-level plugins ids with and without versions, in order` | `nf-schema@3.1.0`, `nf-prov`; profile-nested and non-string ids ignored |
| **`packages/engine/test/plugins/config-scopes.test.ts`** | |
| `F-505 FI-01: nf-schema's validation scope becomes catalogue nodes with its 11 children and printed types` | |
| `F-505 FI-01 FI-03: with nf-schema merged, classifyPath calls validation.monochromeLogs an option; without it, unknown` | uses F-601's `classifyPath` |
| `F-505 FI-01: a plugin scope named like a pack scope keeps the pack's nodes and adds only new children` | |
| **`packages/engine/test/plugins/palette.test.ts`** | |
| `F-505 IO-33: nf-schema 3.1.0 gives six function items with folded signatures` | names `paramsHelp`, `paramsSummaryLog`, `paramsSummaryMap`, `samplesheetToList` (8 signatures), `validate`, `validateParameters` |
| `F-505 IO-33: operators and factories from the hand-written spec get their kinds and keys` | |
| `F-505 UX-11: searchPluginGroups matches name, plugin id and description with queryTerms` | |
| **`packages/engine/test/service/service.test.ts`** (extend) | |
| `F-505 IO-33: plugins() follows the revision after addConfigPlugin and removeConfigPlugin` | |
| `F-505 FI-03: after setPluginScopes(nf-schema) the config-unknown-option warning on validation.monochromeLogs is gone and pluginsKey changes` | |
| `F-505 FI-01: configSchema lists the validation scope only while nf-schema's scopes are set` | |
| **`packages/engine/test/edit/oracle-goldens.test.ts`** (extend) | |
| `F-505 IO-33: addConfigPlugin nf-schema@3.1.0 on template-blank equals oracle case f505-plugin` | |
| **`apps/web/test/plugin-store.test.tsx`** | |
| `F-505 IO-33: the store reads the declared plugin's spec, picks the index version when the declared one differs, skips definitions 0, and sends scopes once per key` | fake engine and client |
| **`apps/web/test/canvas-store.test.ts`** (extend) | |
| `F-505 IO-33 AR-23: addPlugin applies addConfigPlugin with the index version under one group and label` | |
| `F-505 IO-33: with no nextflow.config, createFile and addConfigPlugin form one group; a refused second part is undone` | |
| `F-505 UX-04: addPlugin is refused in read-only and calls no engine method` | |
| **`apps/web/test/plugin-groups.test.tsx`**, **`registry-section.test.tsx`** (extend) | |
| `F-505 QA-11 IO-33: plugin palette items are focusable, described by their summary and aria-disabled` | |
| `F-505 QA-11 UX-15: a registry plugin row is a draggable button described by its summary; Enter calls addPlugin` | |
| **`e2e/plugins.spec.ts`** (Chromium, fixture snapshot, registry.nextflow.io blocked) | |
| `F-505 step 1 IO-33 UX-15: search nf-schema, focus its row and press Enter: nextflow.config gains id 'nf-schema@3.1.0' and the palette lists its functions` | from the blank template; `readFile("nextflow.config")` equals oracle case `f505-plugin`; `samplesheetToList` and `validateParameters` under "nf-schema 3.1.0"; the row shows "added"; live region text |
| `F-505 step 1 UX-15: dragging the nf-schema row onto the canvas adds the same line` | |
| `F-505 AR-23: one undo removes the line and the functions leave the palette` | |
| `F-505 FI-01: in the nextflow.config form, Add scope lists validation and setting validation.monochromeLogs raises no unknown-option warning` | |
| `F-505 IO-33: adding nf-schema again says it is already there and changes nothing` | revision unchanged |
| `F-505 QA-30: no CSP violations or console errors` | `watchForCspViolations` |

## 5. Tasks

Branch `feat/F-505`. Run `pnpm check` before every commit. Settle section 6 first.

1. **`plugin()` in the client.** `plugin.ts`, client surface, delegation; tests. Can start now.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
2. **Pure plugin logic.** `plugins/declared.ts`, `config-scopes.ts` (without the `classifyPath` test, added in task 4), `palette.ts`, the hand-written spec; tests. Can start now.
   - Done when `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
3. **Plugin store.** `plugin-store.ts` against a fake engine, with `plugins`/`setPluginScopes` declared in `service/types.ts` and stubbed in the service. Can start now.
   - Done when `pnpm --filter @nf-builder/web test` and `pnpm check` pass.
4. **After F-601 merges (merge `main`):** the service methods, the merged catalogue in the diagnoser and config functions, `pluginsKey`, the `classifyPath` test, the oracle case `f505-plugin` and its golden.
   - Done when `pnpm --filter @nf-builder/engine test`, `pnpm oracle -- --case f505-plugin` (or CI `oracle`), `pnpm test:corpus` (config touched) and `pnpm check` pass.
5. **Config editor wiring.** F-601's stores re-pull on `pluginsKey`; plugin options in the right pane.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm test:e2e -- --grep F-601` and `pnpm check` pass.
6. **After F-301 merges:** registry plugin rows as buttons with drag and Enter, `addPlugin`, the "From plugins" list, the added badge, counts.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-204|F-301|F-502|F-503"` pass; any `@visual` change is re-approved from CI (ADR 0021).
7. **End-to-end and records.** `e2e/plugins.spec.ts`; section 7.
   - Done when `pnpm test:e2e -- --grep F-505`, `pnpm smoke`, `pnpm build && pnpm check:budget && pnpm check:hosts` and `pnpm check` pass.

## 6. Open points (none decided here)

1. **Waiting for F-601 and F-301** (`features.json`, needs the `scope-change` label). F-505's step needs `addConfigPlugin` (F-601) and the palette drag and Enter (F-301); F-505 `depends_on` only F-503.
   - **Recommend:** add F-601 and F-301 to F-505's `depends_on` in F-505's PR, with an ADR line; run tasks 1 to 3 now. **Alternative:** a note only, as F-605 did, and a duplicate minimal plugin command (rejected: two writers of the same text).
2. **Where plugin functions sit in the palette.** UX-12's categories are a closed pack-generated list; IO-33 says only "join the palette".
   - **Recommend:** a "From plugins" list at the end of "Plugins & config", grouped by plugin. **Alternative:** merge into Channel factories, Operators (which group?) and Types, functions & includes with a plugin tag; this changes lang-core `PaletteViewItem` and the engine view.
3. **What a plugin function does when added.** No command exists; F-301's plan proposes a feature for includes and functions.
   - **Recommend:** shown and described, `aria-disabled`, "can't be added yet"; note on that new feature to add `include { x } from 'plugin/<id>'` and a call. **Alternative:** add `AddInclude` here (scope growth).
4. **Making page-fetched data change worker diagnostics** without a new revision. ADR 0043 and ADR 0054 key results by revision only.
   - **Recommend:** `setPluginScopes` plus a `pluginsKey` on results, stores re-pulling on either change (amends ADR 0043, clarifies ADR 0054). Warnings on plugin options may show briefly until specs load. **Alternative:** pass scopes with every call.
5. **Versions.** The snapshot holds one release per plugin; projects may declare another (F-601's fixture uses `nf-schema@2.5.1`) or none.
   - **Recommend:** use the index version's spec, marked "spec from 3.1.0" in the group heading; a plugin already declared at any version is a refusal ("already in nextflow.config"); no version change from the palette in v0.1. **Alternative:** exact version or nothing (no functions or scopes for 2.5.1).
6. **F-601's "Add plugin…" free text.** F-601's plan says F-505 replaces it with a registry picker; F-505's description doesn't.
   - **Recommend:** keep F-601's field; the palette is the picker. Note on F-701 for a picker if the audit asks.
7. **Plugins inside profiles or included configs.** Not specified; the AST allows them syntactically.
   - **Recommend:** top-level blocks of the root `nextflow.config` only, as IO-33 names that file; record the reading.
8. **FI-04 docs link for plugin options.** The verified docs URL rules cover the pack catalogue only.
   - **Recommend:** the plugin's `projectUrl` from the index, else no link.
9. **Missing `nextflow.config`.** **Recommend:** create it in the same undo step (`CreateFile` then `addConfigPlugin`).
10. **Plugin `requires`.** The snapshot already admits only releases for the pinned Nextflow. **Recommend:** no extra check.

**AGENTS.md decide-and-record items:**
- **`features.json`:** point 1 (`depends_on`, `scope-change`).
- **ADR changes:** points 4 and 5 and the `RegistryClient.plugin` surface amend ADR 0050 (client) and ADR 0043 (API list); point 4 clarifies ADR 0054; the config-rules extension builds on F-601's ADR. One new ADR at landing, next free number (reserve it in `docs/plan/handoff/README.md`).
- **Spec readings:** points 2, 3, 5, 7 and 8 (IO-33, FI-01, FI-04 wording).
- **None:** runtime dependencies, package boundaries, dependency-cruiser rules, stored or exported formats (the snapshot plugin format v1 is read unchanged; palette open state is session-only), workflows, open questions.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`: "Add plugins from the palette with F-601's command, read plugin specs from the snapshot in the document, and merge their scopes in the worker". Covers 2.1 to 2.6 and points 1 to 10. Row in `docs/adr/README.md`.
- **Spec:** IO-33 adds "(the snapshot's release; functions listed, not yet insertable)"; FI-01 adds "plugin specs of the plugins declared in the root `nextflow.config`".
- **`features.json` notes:** F-505 verified line citing `e2e/plugins.spec.ts`, the oracle case and the unit tests; the remaining-palette-items feature: insert plugin functions with `include { x } from 'plugin/<id>'`; F-702: plugin spec reads at open.
- **`progress.md` Decisions:** the ADR, the `depends_on` change, `EngineApi.plugins` and `setPluginScopes`, the version rule.
- Delete this plan in the PR that merges F-505.

## 8. Evidence

- docs.seqera.io/nextflow/plugins/using-plugins and /developing-plugins, fetched 2026-11-28 (quotes in 1.2).
- Fixture snapshot plugin files and their definitions, read from `origin/main`.
- `feat/F-601` at `c39046a` and `plan-F-601.md` sections 2.5 to 2.7 and 7; `feat/F-301` plan sections 2 to 6.
- No local Nextflow run: the `f505-plugin` case is proved by `pnpm oracle` in task 4.
