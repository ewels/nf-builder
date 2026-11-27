# Plan: F-503, registry modules and plugins in the palette: namespace groups, process or workflow mark, search, lazy loading

Written by the planner on 2026-11-27 from `main` at `beb703e` (F-502 merged as ADR 0050). I changed nothing apart from this file. Paths are relative to the repository root. Probes are in the scratchpad (section 8).

## 0. Scope

**In scope:**
- **Modules list (UX-14).** Replace F-502's interim lists (`REGISTRY_LIST_LIMIT`, `RegistryList`) with:
  - modules grouped by namespace (the first segment of `name`);
  - each row marked process or workflow (glyph plus hidden text, QA-12);
  - a `typed` tag on typed modules only (`typed === true` and `version !== null`);
  - lazy rendering: a window of rows that grows as the list is scrolled (step 2).
- **Plugins list.** A flat list of ids with the plugin glyph and `summary` as the tooltip.
- **Search (UX-11).** The palette's one search box also filters registry modules (name, description, keywords) and plugins (id, summary). The lists stay visible while searching (F-502 hid them).
- **The "nothing matches" message.** It reflects both regions.
- **`ports(name)` on the registry client.** ADR 0050 assigns it to F-503 and F-503's note asks for it. Snapshot-only, reads `ports.json` on demand. No UI consumer in this feature (open point 6).
- **Kept from F-502:** the heading, refresh button, source line, four states, live overlay and test hook.

**Out of scope:**
- Inserting or dragging a module or plugin (F-504, F-505). Rows stay non-focusable and non-draggable, like generic rows until F-301.
- Bundles (`bundle()`, F-504) and plugin specs (`plugin()`, F-505).
- Module details, versions and upstream links (F-506).
- Persisting the open state of the lists or namespaces (open point 4).
- Turning `LIVE_REGISTRY` on (ADR 0050's gate).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-11:** "One search box filters every category, generic and registry, by name, description and keywords."
- **UX-14:** "Then a **registry.nextflow.io** section: Modules (grouped by namespace, lazy-loaded, process or workflow marked, typed modules tagged `typed`) and Plugins. A refresh button shows the data source (live or snapshot) and its age. The section says when no snapshot is available on the site, when the data couldn't be read (refresh retries), and when a refresh failed (ADR 0050)."
  - It doesn't say what "lazy-loaded" means. Step 2 ("scrolling the module list loads more without blocking input") reads it as incremental rendering on scroll; the index is already one read (ADR 0050).
  - It doesn't say how namespaces are ordered, whether they collapse, or what a row's label is.
- **ADR 0050:**
  - The client surface is `RegistryClient { source; index() }`, and "`ports`, `bundle` and `plugin` come with F-503, F-504 and F-505".
  - The document reads the snapshot; workers make no cross-origin requests (QA-30). One copy in memory plus the HTTP cache; no IndexedDB copy, no stored format.
  - Live-only modules have `version: null` and can't be inserted until the next snapshot.
- **Feature notes (F-501, F-502):**
  - `typed` is `true`, `false` or `null` (unknown); `version: null` means live-only with no typed tag.
  - Names can have three segments (`cellgeni/anndata/concat`).
  - Registry rows use `registry-item*`, never `.palette-item`.
  - F-204's tests are scoped to the generic region; plugin rows use `summary`.
- **Mockup (`docs/mockup/1-main.png`):** Modules, then a plain namespace subheading `nf-core`, then rows `fastqc`, `multiqc`, `samtools/flagstat`, each with a green module glyph. That is the name without its namespace. The search placeholder reads "Search components and modules". `ux.md` wins where they differ.

### 1.2 What exists today
- **`packages/sources/src/registry/`.**
  - `types.ts`: `RegistryModule`, `RegistryIndex`, `RegistryClient` (with `index()` only).
  - `snapshot.ts`: `createSnapshotClient` holds one validated `index.json` promise, and `refresh` re-reads with `no-cache`.
  - `client.ts`: `createRegistryClient` uses the snapshot, plus a live overlay when on.
  - `live.ts`: `createLiveClient(options)` returns `{source: "live", index}`, so it must gain `ports` too.
  - `errors.ts`: `request`, `readJson` and `RegistryError`.
- **`packages/lang-core/src/registry-snapshot.ts`:** `RegistrySnapshotPorts {format: 1; generatedAt; modules: Record<name, SnapshotModulePorts>}`. "generatedAt equals the index's".
- **`apps/web/src/registry/`.**
  - `registry-store.ts`: `registryStore` and `useRegistry`, with states idle, loading, ready and failed.
  - `registry-section.tsx`: `RegistrySectionView` (presentational) and `RegistrySection` (wiring). `searching` hides the lists. `open` holds `{modules, plugins}` in session state.
- **`apps/web/src/palette/palette-panel.tsx`.**
  - It holds `query` and computes `searchPalette(view, query)` from `@nf-builder/engine`.
  - It shows `PaletteMessage` (`role="status"`) with `No components match "<q>".` when the generic count is 0, then `<RegistrySection searching>`.
  - `queryTerms` exists in `packages/engine/src/palette-search.ts`, but `packages/engine/src/index.ts` doesn't export it.
- **Scrolling and rendering.** The palette scrolls inside `.column-body` (`overflow: auto`). React 19 with `createRoot`, so `startTransition` and `useDeferredValue` are available. `apps/web` has no DOM test environment: its unit tests use `renderToStaticMarkup`, so hook logic must be pure functions to be unit-tested.
- **Glyphs (`apps/web/src/glyphs.tsx`, `PALETTE_GLYPHS`).** `process` (green square), `workflow` (blue) and `plugin` (grey) exist. `.visually-hidden` exists in `styles.css`.
- **Tests that pin today's behaviour:**
  - `apps/web/test/registry-section.test.tsx` line 177: "lists show at most 50 names … are hidden while searching". F-502's note says to replace this interim behaviour.
  - `e2e/registry-palette.spec.ts`: `moduleRows` reads `.registry-item-label` inside `getByRole("list", {name: "Modules"})` and expects full names (`nextflow-io/hello`, …).
  - `e2e/palette.spec.ts`: `palette(page)` is the whole Components tab panel, and it asserts `getByRole("status")` texts for `zzzz`, `groupTuple`, `branch` and `fromFilePairs`. **A second `role="status"` anywhere in the panel would break these tests (strict mode).**
  - `e2e/app-shell-layout.spec.ts`: the `@visual` baseline `app-shell-default` includes the palette, with the registry section in the snapshot state.
- **The fixture snapshot** (`tools/registry-snapshot/test/fixtures/expected/registry/`, served by preview from `REGISTRY_SNAPSHOT_DIR`):
  - three modules: `nextflow-io/hello` (process, typed), `nf-core/bam_applybqsr` (workflow, legacy) and `nf-core/fastqc` (process, legacy);
  - two plugins;
  - `ports.json` with the same three names.

  That is too small for step 2, which needs a routed large index.

### 1.3 The deployed snapshot (read 2026-11-27, `generatedAt` 2026-11-27T12:50:09Z)
- **Size.** 2,330 modules and 105 plugins. `index.json` is 755 kB raw and `ports.json` 1,023 kB raw.
- **Namespaces:** nf-core 2,296, cellgeni 20, seqera-services 7, seqera 4, claymcleod 1, nextflow-io 1, nf-neuro 1.
  - Alphabetically, nf-core is fourth, and nf-neuro, seqera and seqera-services sort after it.
  - Without collapsible groups, reaching them means scrolling past 2,296 rows.
- **Shape.** Kinds: 2,203 processes and 127 workflows. Typed: 10 true, 2,319 false, 1 null. Segments: 1,779 names with three, 551 with two.
- **Search `fastqc`** over name, description and keywords (all terms, case-insensitive) gives 7 hits in name order: `nf-core/dragen/germline`, `fastq_fastqc_umitools_fastp`, `fastq_fastqc_umitools_trimgalore`, `fastq_qc_stats`, `fastq_trim_fastp_fastqc`, `fastqc` and `trimgalore` (all under nf-core).
- **Descriptions** reach 5,154 characters, so cache the lower-cased text once per index rather than per keystroke.
- **`ports.json`** for `nf-core/fastqc`: inputs `[["meta:map","reads:file"]]`; outputs `html`, `zip` and `versions_fastqc`.

## 2. Design

### 2.1 Pure view logic (`packages/sources/src/registry/view.ts`)
- **`namespaceOf(name)`** returns the text before the first `/`. **`shortName(name)`** returns the rest (`samtools/merge`).
- **`groupModules(modules)`** returns `ModuleGroup[]`: `{namespace, modules}`, namespaces in code-point order (open point 3), modules in index order (already sorted by name).
- **`createRegistrySearch(index)`** returns a function `(terms) => RegistryMatches`.
  - It builds the lower-cased haystacks once per index: name, description and keywords for modules; id and summary for plugins.
  - Every term must be a substring of one field: the same rule as `searchPalette` (UX-11).
  - Empty terms return everything, with the same arrays.
- **Terms come from the caller.** `queryTerms` is exported from `@nf-builder/engine`, and the web app passes the terms in. `sources` keeps importing only `lang-core` (ADR 0003), and both regions split the query the same way.
- **`moduleMarks(m)`** returns `{kind: m.kind, typed: m.typed === true && m.version !== null}`.

### 2.2 Lazy rendering (step 2)
- **No new dependency** (no virtualiser). Each open list (each namespace group, and Plugins) renders a window of `PAGE = 100` rows, followed by a sentinel when rows remain.
  - The sentinel is a real button: "Show more (100 of 2,296)". It also serves keyboard users and environments without `IntersectionObserver`.
  - An `IntersectionObserver` rooted at the nearest scrolling ancestor, with a 200 px bottom margin, presses it automatically.
  - It is re-observed after each growth, so a tall viewport keeps loading until it is filled.
- **Growth runs inside `startTransition`,** so typing or scrolling interrupts the render.
- **The registry filter reads `useDeferredValue(query)`,** so a keystroke never waits for a registry re-render.
- **The window resets to 100** when the query, the index identity or the group's open state changes.
- **Where the logic lives.** The pure part goes in `apps/web/src/registry/lazy-window.ts`: `nextLimit(limit, total, page)` and `windowOf(rows, limit)`. The hook `useLazyWindow` is a thin wrapper, covered by e2e.

### 2.3 Section layout (`registry-section.tsx`)
```
registry.nextflow.io                     [refresh]
Snapshot · updated 5 hours ago
v Modules
    v nf-core   2,296                    <- h4 button, aria-expanded
      [process glyph] fastqc             <- li.registry-item, title = full name + description
      [workflow glyph] bam_applybqsr  typed
      … Show more (100 of 2,296)
    > cellgeni  20
> Plugins
```
- **Rows.**
  - `li.registry-item[data-name=<full name>]` holds the glyph, then `span.registry-item-label` with the short name (open point 2).
  - Hidden text gives the kind ("process" or "workflow").
  - `span.registry-badge-typed` reads `typed`.
  - The tooltip (`title`) is `"<full name> · <description>"`.
- **Namespace headings** are collapsible buttons showing their counts. They are open by default and keep session-only state, like Modules and Plugins today (open point 4). While searching, every list and group is forced open and the toggles are `aria-disabled`, as generic categories already behave.
- **Plugins:** `li.registry-item[data-name=<id>]` with the plugin glyph, the id as label, and `summary` as the title.
- **No `role="status"`** is added to the registry section; F-204's strict locators depend on it. A registry "no match" is a plain `p.registry-note`: "No registry modules or plugins match."
- **The panel's message (`palette-panel.tsx`)** comes from the pure `paletteMessage(genericCount, registryCount | null)`, where `registryCount` is null when the registry isn't ready:
  - `generic 0`, and the registry is 0 or not ready: the existing `role="status"` message, `No components match "<q>".` This keeps F-204's tests green.
  - `generic 0`, but the registry has matches: the generic region shows its heading and a muted `p` "No language components match." (open point 5), and no status message.
- **The search placeholder** becomes "Search components and modules", as in the mockup. The `aria-label` stays "Search components", so F-204's locator still matches (open point 7).

### 2.4 `ports(name)` on the client
- **`RegistryClient.ports(name, options?)`** returns `Promise<SnapshotModulePorts | null>`.
  - It is snapshot-only: live never supplies ports.
  - `null` means a name not in `ports.json`, such as a live-only module.
- **The snapshot client** reads `${snapshotUrl}ports.json` on first call, holds it like `index.json`, and validates it: `format === 1`, a string `generatedAt` and a `modules` object (otherwise `invalid`).
  - 404 or 410 → `unavailable`, with the message "This registry snapshot has no ports file."
- **Consistency.** If `ports.generatedAt !== index.generatedAt`, for example after a refresh brought a newer index:
  - re-read once with `no-cache`;
  - if it still differs → `invalid` ("Registry ports are out of step with the index.").
- **Delegation.** `createRegistryClient` and `createLiveClient` delegate to the snapshot client. Nothing in F-503 calls `ports()` at load (1 MB raw, open point 6).

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/sources/src/registry/view.ts` | `ModuleGroup {namespace: string; modules: readonly RegistryModule[]}`; `RegistryMatches {modules: readonly RegistryModule[]; plugins: readonly SnapshotPlugin[]}`; `namespaceOf(name: string): string`; `shortName(name: string): string`; `groupModules(modules: readonly RegistryModule[]): readonly ModuleGroup[]`; `createRegistrySearch(index: Pick<RegistryIndex,"modules"\|"plugins">): (terms: readonly string[]) => RegistryMatches`; `moduleMarks(m: RegistryModule): {kind: "process"\|"workflow"; typed: boolean}` |
| `packages/sources/src/registry/ports.ts` | `parseSnapshotPorts(value: unknown, url: string): RegistrySnapshotPorts` (throws `RegistryError("invalid")`) |
| `apps/web/src/registry/lazy-window.ts` | `REGISTRY_PAGE = 100`; `nextLimit(limit: number, total: number, page?: number): number`; `windowOf<T>(rows: readonly T[], limit: number): {shown: readonly T[]; remaining: number}`; `useLazyWindow(total: number, resetKey: unknown): {limit: number; more(): void; sentinelRef: RefCallback<HTMLElement>}` |
| `apps/web/src/registry/registry-lists.tsx` | `RegistryModules`, `RegistryPlugins`, `RegistryRow`: presentational components that take matches, open state, limits and callbacks |
| `apps/web/src/palette/palette-message-rule.ts` | `PaletteMessageKind = "none" \| "no-match" \| "no-language-match"`; `paletteMessage(genericCount: number, registryCount: number \| null): PaletteMessageKind` |
| `packages/sources/test/registry-view.test.ts` | section 4 |
| `packages/sources/test/registry-ports.test.ts` | section 4 |
| `apps/web/test/registry-lazy-window.test.ts`, `apps/web/test/palette-message-rule.test.ts` | section 4 |
| `e2e/registry-snapshots.ts` | `largeIndex(fixture: object, extra: number): object` (adds `nf-core/tool0000…` modules, re-sorted); `routeIndex(page, body)`; `registryRegion(scope)`, `moduleRow(scope, name)` (by `data-name`) |
| `e2e/registry-modules.spec.ts` | the F-503 tests (section 4) |

### 3.2 Change
| Path | Change |
|---|---|
| `packages/sources/src/registry/types.ts` | `RegistryClient.ports(name: string, options?: RegistryReadOptions): Promise<SnapshotModulePorts \| null>` |
| `packages/sources/src/registry/snapshot.ts` | `SnapshotRegistryClient` gains `ports`; a held `ports.json` promise with the consistency re-read |
| `packages/sources/src/registry/client.ts`, `live.ts` | delegate `ports` to the snapshot client |
| `packages/sources/src/index.ts` | export the view functions and types, and `SnapshotModulePorts` as a type re-export |
| `packages/engine/src/index.ts` | export `queryTerms` |
| `apps/web/src/registry/registry-section.tsx` | drop `REGISTRY_LIST_LIMIT` and `RegistryList`; the props `searching: boolean` become `query: string` plus `matches: RegistryMatches \| null`; render `RegistryModules` and `RegistryPlugins`; add namespace open state |
| `apps/web/src/palette/palette-panel.tsx` | compute `terms`, use `useDeferredValue` for registry matches (memoised `createRegistrySearch` per index), apply the `paletteMessage` rule, pass matches down |
| `apps/web/src/palette/palette-search.tsx` | the placeholder text only |
| `apps/web/src/palette/palette.css` | namespace headings, row glyph, typed badge, show-more button; drop `.registry-note` "Showing" styles if unused |
| `apps/web/test/registry-section.test.tsx` | replace the interim-list test (line 177) with F-503 tests; the other F-502 tests stay |
| `e2e/registry-palette.spec.ts` | `moduleRows` reads `data-name` instead of label text (same assertions; open point 2) |
| `docs/spec/ux.md` | UX-14 wording (section 7) |

## 4. Tests (write first)

**`packages/sources/test/registry-view.test.ts`**
- `F-503 UX-14: namespaceOf and shortName split at the first slash, including three-segment names (cellgeni/anndata/concat → cellgeni, anndata/concat)`.
- `F-503 UX-14: groupModules groups by namespace in code-point order and keeps name order inside each group`.
- `F-503 step 1 UX-11: searching [fastqc] over the fixture index returns nf-core/fastqc and not nextflow-io/hello`. It uses `goldenText()`.
- `F-503 UX-11: a module matches on description or keyword, case-insensitively, and only when every term matches; a plugin matches on id or summary`.
- `F-503 UX-11: empty terms return the index's own arrays`. Identity check: no copy.
- `F-503 UX-14: moduleMarks tags typed only when typed is true and version is not null; typed null and live-only modules get no tag`.

**`packages/sources/test/registry-ports.test.ts`** (fake fetch, fixture `ports.json`)
- `F-503 ADR-0050: ports(nf-core/fastqc) reads ports.json once under snapshotUrl and returns its meta.yml ports; a second call makes no request`.
- `F-503 ADR-0050: ports of a name the file lacks resolves null`.
- `F-503 IO-30: ports.json 404 rejects with unavailable; a non-JSON or format 2 body with invalid`.
- `F-503 IO-30: a ports generatedAt that differs from the index re-reads once with cache no-cache, then rejects invalid if it still differs`.
- `F-503 ADR-0050: with live on, ports() reads only the snapshot and requests nothing from registry.nextflow.io`.

**`apps/web/test/registry-lazy-window.test.ts`**
- `F-503 step 2 UX-14: nextLimit grows by one page and stops at total`.
- `F-503 step 2 UX-14: windowOf returns the first limit rows and the remaining count`.

**`apps/web/test/palette-message-rule.test.ts`**
- `F-503 UX-11 F-204: no generic and no registry matches (or registry not ready) give no-match; generic none with registry matches give no-language-match; any generic match gives none`.

**`apps/web/test/registry-section.test.tsx`** (`renderToStaticMarkup`; replaces the line-177 test)
- `F-503 UX-14: modules render under namespace headings with counts, with short labels, data-name holding the full name, and a hidden process or workflow word`.
- `F-503 UX-14: only typed modules with a version carry the typed tag`.
- `F-503 step 2 UX-14: with 250 modules in one namespace, 100 rows render, followed by a Show more (100 of 250) button`.
- `F-503 UX-11: while searching, matching modules and plugins render with every group open; no matches give the plain note and no role=status`.
- `F-503 UX-14: registry rows use no palette-item class and the section has no role=status`. This keeps F-502's guard.

**`e2e/registry-modules.spec.ts`** (Chromium; `--grep F-503`)
- `F-503 step 1 UX-11 UX-14: searching fastqc shows nf-core/fastqc under Modules in the nf-core group, hides nextflow-io/hello, and shows no "No components match" status`. Fixture snapshot, registry host blocked, no console errors or CSP violations.
- `F-503 step 2 UX-14: with a 2,500-module snapshot, the nf-core group first shows 100 rows; scrolling the palette loads more (≥ 400 after four scrolls) with no long task over 200 ms, and a key typed into search during loading appears at once`.
  - Routed `index.json` from `largeIndex`.
  - A `PerformanceObserver({type: "longtask", buffered: true})` is installed by `addInitScript` and started after the first render (open point 8).
- `F-503 UX-14: a namespace group collapses and expands, and Plugins lists the fixture plugins with their summaries as titles`.
- `F-503 UX-11 F-204: searching zzzz still shows one status 'No components match "zzzz".'`.

## 5. Tasks

Branch `feat/F-503`. Run `pnpm check` before every commit. Settle section 6 first.

1. **View logic in `packages/sources`.**
   - Files: `view.ts`, the exports, `registry-view.test.ts`; `queryTerms` exported from the engine.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
2. **`ports(name)` on the client.**
   - Files: `ports.ts`, the `types.ts`, `snapshot.ts`, `client.ts` and `live.ts` changes, `registry-ports.test.ts`.
   - Done when `pnpm --filter @nf-builder/sources test` and `pnpm check` pass.
3. **Pure web helpers.**
   - Files: `lazy-window.ts` (pure part, plus the hook), `palette-message-rule.ts`, and their tests.
   - Done when `pnpm --filter @nf-builder/web test` passes.
4. **Section and panel UI.**
   - Files: `registry-lists.tsx`, `registry-section.tsx`, `palette-panel.tsx`, `palette-search.tsx`, `palette.css`, the rewritten `registry-section.test.tsx`, and the `data-name` locator in `e2e/registry-palette.spec.ts`.
   - Done when `pnpm check` passes and `pnpm test:e2e -- --grep "F-204|F-502"` passes (with `PW_CHROMIUM_EXECUTABLE` set in the sandbox).
5. **End-to-end tests.**
   - Files: `e2e/registry-snapshots.ts`, `e2e/registry-modules.spec.ts`.
   - Done when these pass:
     - `pnpm test:e2e -- --grep F-503`;
     - `pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm smoke` (under 60 s).
   - If the `@visual` app-shell baseline changes in CI, re-approve it from the `playwright-chromium` artifact (ADR 0021); never update it locally.
6. **Records** (section 7).
   - Done when `pnpm check` passes (ADR lint, `features.json` validation).

## 6. Open points (none decided here)

1. **What "lazy-loaded" means (spec gap).**
   - **Recommendation:** incremental rendering on scroll: pages of 100, a sentinel button pressed by an `IntersectionObserver`, `startTransition`.
   - It needs no new dependency. The index is one read already (ADR 0050), and the DOM tops out at about 2,300 simple rows.
   - **Alternatives:**
     - a virtualiser such as `@tanstack/react-virtual`: a new runtime dependency, decide and record; overkill at this size;
     - fetching the module list in pages: a snapshot format change (F-501's format), ruled out.
2. **Row label: short name (mockup) or full name.**
   - **Recommendation:** the short name (`samtools/merge`) under its namespace heading, with the full name in `data-name` and the tooltip.
   - This means changing F-502's e2e `moduleRows` locator to read `data-name`. The assertions (the same names, counts and order) are unchanged, so this is not a weakening, but name it in the PR.
   - **Alternative:** keep full names in the label. No test changes, but each name repeats its namespace under the heading.
3. **Namespace order.**
   - **Recommendation:** code-point order (cellgeni, claymcleod, nextflow-io, nf-core, …): neutral and stable.
   - **Alternative:** nf-core first, as in the mockup, or by size. That favours one organisation; record it in UX-14 if chosen.
4. **Collapsible namespaces and persistence.**
   - **Recommendation:** collapsible, open by default, with session-only state (as F-502's Modules and Plugins toggles). Without collapsing, nf-neuro and seqera sit behind 2,296 nf-core rows.
   - Persisting would change the `nf-builder:palette` localStorage format (v1). That is a stored-format change: decide and record, and leave it out of F-503.
5. **Message when only the registry matches.**
   - **Recommendation:** the generic region shows its heading and a plain muted "No language components match."; the single `role="status"` message "No components match …" appears only when nothing matches anywhere (or the registry isn't ready). This keeps F-204's strict `getByRole("status")` tests valid.
   - **Alternative:** hide the generic region entirely while it has no matches.
6. **`ports(name)` without a UI consumer.**
   - ADR 0050 and F-503's note put it here, but neither step uses it.
   - **Recommendation:** implement and unit-test it here, snapshot-only and on demand; F-504 consumes it for the inserted node and for LA-14 checks. Record it in the F-503 ADR as completing ADR 0050's client surface for ports.
   - **Alternative:** defer it to F-504 and amend ADR 0050's sentence.
   - Either way, don't fetch `ports.json` (1 MB raw) at palette load.
7. **Search placeholder.**
   - **Recommendation:** "Search components and modules" (the mockup), keeping `aria-label="Search components"`.
   - **Alternative:** leave it as it is.
8. **Measuring "without blocking input" (step 2).**
   - **Recommendation:**
     - Chromium Long Tasks, with no task of 200 ms or more after the first render while scrolling five pages;
     - plus a typed character appearing in the search box within the test's default expect timeout.
   - 200 ms is the Interaction to Next Paint "good" bound. 50 ms (the long-task definition) is likely to flake on CI runners.
   - **Alternative:** Event Timing entries for the typed keys, with a duration under 200 ms.
9. **Search fields.**
   - **Recommendation:** exactly UX-11's fields (name, description, keywords) for modules, and id and summary for plugins (plugins have no description or keywords, per F-502). Don't search `component` (`FASTQC`): nf-core names already contain it.
10. **Ranking.**
    - **Recommendation:** keep name order. Step 1 only needs nf-core/fastqc to appear, and 7 hits out of 2,330 need no ranking.
    - **Alternative:** exact short-name matches first. This is new behaviour the spec doesn't ask for.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing, likely 0055): "Registry lists in the palette: namespace groups, short labels, scroll-loaded windows, shared search and snapshot-only ports".
  - It covers sections 2.1 to 2.4 and the settled section 6 points.
  - It amends ADR 0050: the interim lists are replaced, and `ports()` is added to the client.
  - Add a row to `docs/adr/README.md`.
- **Spec (UX-14):**
  - "Modules (grouped by namespace in name order, each group collapsible; rows show the name without its namespace; the list renders 100 rows at a time and loads more as it scrolls; process or workflow marked by icon; typed modules tagged `typed`)";
  - "Search covers registry modules (name, description, keywords) and plugins (id, summary)".
- **`features.json`:**
  - **F-503:** `passes`, and a note: "Verified …: step 1 by `e2e/registry-modules.spec.ts` (fixture snapshot, registry blocked) and `registry-view.test.ts`; step 2 by the routed 2,500-module e2e test (100-row windows, no long task ≥ 200 ms while scrolling) and `registry-lazy-window.test.ts`. `ports(name)` added, snapshot-only (ADR …)".
  - **F-504:** use `registryClient.ports(name)` (snapshot-only, null for live-only); rows carry `data-name`; make rows focusable and draggable here, exposing the description to keyboard users (QA-11, F-204's note).
  - **F-505:** plugin rows carry `data-name=<id>`; `plugin(id, version)` still to add.
- **`progress.md` Decisions:** the ADR, the lazy-render approach (no dependency), the row-label and locator change, the message rule, and `ports()`.

## 8. Evidence

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/7eb86299-0303-577c-b405-f447f3050ce3/scratchpad/f503/`

| Probe | Path |
|---|---|
| Deployed `index.json` (2026-11-27T12:50:09Z; 2,330 modules, 105 plugins; 755,211 bytes) | `index.json` |
| Deployed `ports.json` (1,023,049 bytes; same `generatedAt`) | `ports.json` |
| Namespace counts, kinds, typed counts, segment counts, `fastqc` hits | computed with `python3 -I` from `index.json` (section 1.3) |

Fetched with `curl` from `https://ewels.github.io/nf-builder/registry/{index,ports}.json` (200, `application/json`).
