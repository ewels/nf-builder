# 0058. List registry modules by namespace in scroll-loaded windows, share the palette search, and read ports from the snapshot on demand

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-14 asks for registry modules grouped by namespace, lazy-loaded, marked process or workflow, with typed modules tagged `typed`, and for plugins. UX-11 asks one search box to filter generic and registry items by name, description and keywords. ADR 0050 shipped interim lists (50 module names and the plugin ids, hidden while searching) and left `ports` to F-503.

The spec doesn't say what "lazy-loaded" means, how namespaces are ordered, whether they collapse, or what a row's label is. The deployed snapshot (read 2026-11-27) holds 2,330 modules and 105 plugins. nf-core has 2,296 of the modules; cellgeni 20, seqera-services 7, seqera 4, and claymcleod, nextflow-io and nf-neuro one each. In code-point order nf-core is fourth, so the small namespaces either sit above it or behind 2,296 rows. `index.json` is 755 kB and `ports.json` 1,023 kB, and descriptions reach 5,154 characters.

F-204's end-to-end tests use strict `getByRole("status")` locators over the whole Components panel, so a second status region would break them. The mockup (`docs/mockup/1-main.png`) shows a plain `nf-core` subheading above short names (`fastqc`, `samtools/flagstat`) and the placeholder "Search components and modules".

Research: the [F-503 plan](https://github.com/ewels/nf-builder/blob/f0fd4b5/docs/plan/handoff/plan-F-503.md).

## Decision

- **View logic** in `packages/sources` (`registry/view.ts`), pure and unit-tested:
  - The namespace is the text before the first `/`; the short name is the rest, so `cellgeni/anndata/concat` shows `anndata/concat` under `cellgeni`.
  - Groups list `nf-core` first, then the other namespaces in code-point order; modules keep the index's name order inside a group.
  - The `typed` tag shows only when `typed === true` and `version !== null`, so unknown (`null`) and live-only modules carry none.
- **Search** (UX-11):
  - Modules match on name, description and keywords; plugins on id and summary. Every term must be a substring of one field, case-insensitively, as in `searchPalette`. The `component` field isn't searched.
  - The terms come from the engine's `queryTerms`, now exported, so both regions split a query the same way and `sources` keeps importing only `lang-core` (ADR 0003).
  - Lower-cased fields are built once per index; empty terms return the index's own arrays. Results keep name order, with no ranking.
  - The registry filter reads a deferred copy of the query (`useDeferredValue`), so a keystroke never waits for a registry render. The lists stay visible while searching, with every group forced open and its toggle `aria-disabled`.
- **Lazy loading** means incremental rendering, with no new dependency:
  - Each open list (each namespace group, and Plugins) renders 100 rows, then a real button "Show N more (of T)", with counts in en-GB format.
  - An `IntersectionObserver` rooted at the nearest scrolling ancestor, with a 200 px bottom margin, presses it. It is re-observed after each growth, so a tall viewport keeps loading until it is full. Keyboard users and browsers without `IntersectionObserver` press the button themselves.
  - Growth runs inside `startTransition`, so typing and scrolling interrupt it.
  - A window resets to 100 rows when its list changes (a new query or index) and when its group closes.
- **Rows and groups:**
  - A module row is `li.registry-item` with `data-name` holding the full name, the process or workflow glyph with the kind as hidden text (QA-12), the short name as its label, a `typed` badge when tagged, and the title "<full name> · <description>".
  - A plugin row carries `data-name=<id>`, the plugin glyph, the id as its label and `summary` as its title.
  - Namespace headings are collapsible buttons with their counts, open by default, with session-only state like the Modules and Plugins toggles. Persisting them would change the `nf-builder:palette` stored format, so it is left out.
  - Rows stay unfocusable and undraggable until F-504 and F-505, like generic rows until F-301.
- **Messages:**
  - The registry section adds no `role="status"`. A search with no registry match shows a plain note: "No registry modules or plugins match."
  - The panel's one status message, `No components match "<q>".`, appears only when neither region matches, or the registry isn't ready. When only the registry matches, the generic region shows "No language components match." as a plain muted line.
- **Search placeholder:** "Search components and modules"; the accessible name stays "Search components".
- **`ports(name)`** completes ADR 0050's client surface for ports:
  - `RegistryClient.ports(name, options?)` resolves the module's `meta.yml` ports, or `null` for a name the file lacks, such as a live-only module.
  - It is snapshot-only: the live and combined clients delegate to the snapshot client, and nothing is requested from `registry.nextflow.io`.
  - `${snapshotUrl}ports.json` is read on the first call, never at palette load, and held in memory like `index.json`. It is validated (`format === 1`, a string `generatedAt`, a `modules` object; otherwise `invalid`); 404 or 410 is `unavailable` ("This registry snapshot has no ports file.").
  - If its `generatedAt` differs from the index's, it is re-read once with `no-cache`; if it still differs the call rejects `invalid` ("Registry ports are out of step with the index."). Concurrent calls during that re-read share it, and a call after a failed read reads again.
  - F-503 has no UI consumer; F-504 uses it for inserted nodes and LA-14 checks.

## Consequences

- This amends ADR 0050: the interim lists are replaced, the lists stay visible while searching, and the client gains `ports`. `bundle` and `plugin` still come with F-504 and F-505.
- The DOM grows to at most every row a user scrolls to (about 2,300 simple rows today). If the registry grows by an order of magnitude, a virtualiser is the next step, as a new dependency with its own ADR.
- F-502's end-to-end locator reads `data-name` instead of the label, and expects nf-core first. The names and counts it asserts are unchanged.
- The app-shell `@visual` baseline changes with the registry section and the placeholder; it is re-approved from CI (ADR 0021).
- Checked by `e2e/registry-modules.spec.ts` (search, 100-row windows over a 2,500-module snapshot with no long task over 200 ms while scrolling, collapsing, the single status message) and the unit tests for the view logic, `ports`, the window helpers and the message rule.

## Alternatives

- **A virtualiser such as `@tanstack/react-virtual`:** a new runtime dependency, more than 2,300 rows need.
- **Fetching the module list in pages:** a snapshot format change (F-501), and the index is already one read.
- **Full names as row labels:** each name would repeat the heading above it.
- **Namespaces in plain code-point order, or by size:** code-point order puts three small namespaces ahead of the 2,296 nf-core modules; by size moves groups around as the registry changes.
- **Persisting the open namespaces:** a stored-format change for little gain.
- **Hiding the generic region when only the registry matches:** the user loses sight of where the language components went.
- **Deferring `ports` to F-504:** ADR 0050 and F-503's note put it here, and F-504 then starts with the client ready.
