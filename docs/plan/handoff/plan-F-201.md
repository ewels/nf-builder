# Plan: F-201 App shell (header, resizable and collapsible columns, tab strip, status bar)

Feature: F-201 (M2), spec UX-01, UX-02, UX-03; depends on F-002 (passes).
Steps:
1. Resize and collapse both side columns; widths persist after reload.
2. Visual snapshot matches the approved baseline.

Also read: AR-30 (Zustand for panel sizes), AR-31, QA-10..QA-14, LA-02, ADR 0003, 0011, 0014, 0015, 0016, Q10, mockups 1 and 4.

Scope: shell chrome with placeholder content only. Not in scope: projects (F-202), palette and segmented control (F-204, UX-10), canvas (F-205), details content (F-206), view modes (F-208), problems panel, UX-04 narrow-screen mode, axe (F-701, QA-14), the netlify.toml CSP (unchanged).

## Constraints found while planning

- F-002 tests must stay green unchanged: e2e asserts left x=0, widths 256 / 888 / 296 at 1440 px, landmarks `complementary "Components and files"`, `main "Canvas and editor"`, `complementary "Details"`, `banner` containing `h1 "nf-builder"`; the unit test regex needs `<h1>` content to be exactly `nf-builder` (no logo inside the h1) and no `<aside>` before `</header>`. So separators must not take grid width: place them in the same grid cell as the column edge (explicit `grid-column`/`grid-row` for every child, separator overlapping the boundary), not as extra tracks.
- CSP `style-src 'self'`: no `<style>` elements and no `style=""` from HTML. React `style` props go through CSSOM and are allowed. Grid widths come from a `style={{ gridTemplateColumns }}` prop; cursor during drag comes from a class on `<html>`.
- Biome 2.6.8 `lint/a11y/useSemanticElements` rejects `<div role="separator">` (probed). `<hr tabIndex={0} aria-orientation="vertical" aria-valuenow=…>` passes Biome and keeps the implicit `separator` role. Use `<hr>`.
- LA-02: no Nextflow version literal outside `packages/lang-*`, including `apps/web`, `e2e/` and tests outside packs. e2e reads versions and limits from the DOM.
- Unit tests run in Node (no jsdom; adding it would be a new dev dependency). Test pure functions and the vanilla store with an injected in-memory storage. Render components with `renderToStaticMarkup` as the existing tests do. Interaction goes in Playwright.
- Sandbox vs CI rendering: the sandbox has Chromium 1243 (headless shell); Playwright 1.65.1 expects 1255. Sandbox `system-ui` resolves to Inter (fc-match); CI resolves to whatever `--with-deps` installs. The Docker daemon is absent in the sandbox. `gh run download` of CI artifacts fails with a proxy 403 (`productionresultssa30.blob.core.windows.net`, tested on run 44949228451). `gh run view --log-failed` works. So baselines can only be rendered in CI and must reach the repo through git.
- Playwright 1.65.1 default `updateSnapshots: "default"` writes a missing baseline into the working tree and soft-fails. Set `"none"` so nothing writes baselines except an explicit `--update-snapshots` in the baselines workflow.
- AGENTS.md now allows parallel features: take the next free ADR number at PR time. `playwright.config.ts` and `ci.yml` may conflict with F-007 or F-008 branches.

## 1. Files

### packages (version list for UX-01 without literals, LA-02)

`packages/lang-core/src/index.ts` (change)
```ts
/** A language pack (ADR 0006). M1 features grow this towards the architecture.md sketch. */
export interface LanguagePack {
  readonly version: string;
}
```

`packages/lang-2610/src/index.ts` (change); `package.json` gains `"dependencies": { "@nf-builder/lang-core": "workspace:*" }`
```ts
import type { LanguagePack } from "@nf-builder/lang-core";
export const pack: LanguagePack = { version: "26.10" };
```

`packages/engine/src/packs.ts` (new), re-exported from `packages/engine/src/index.ts`; engine `package.json` gains `@nf-builder/lang-core` and `@nf-builder/lang-2610` as `workspace:*`
```ts
import type { LanguagePack } from "@nf-builder/lang-core";
import { pack as pack2610 } from "@nf-builder/lang-2610";
export const installedPacks: readonly LanguagePack[];   // [pack2610]
export function installedPackVersions(): readonly string[];
```
The existing dependency-cruiser rules already allow these edges: engine to the pack entry (Q10), the pack to lang-core, and web to engine. test/architecture.test.ts shows package-name imports resolve through the workspace symlink to `packages/lang-2610/src/index.ts`. No rule change.

### apps/web

`apps/web/package.json` (change): `dependencies` gains `"zustand": "5.1.0"` (exact pin, as elsewhere) and `"@nf-builder/engine": "workspace:*"`. `pnpm-lock.yaml` is updated by `pnpm install`.

`apps/web/src/layout/layout-store.ts` (new): UI-only state (AR-30)
```ts
import type { StateStorage } from "zustand/middleware";
import type { StoreApi } from "zustand/vanilla";

export type Side = "left" | "right";
export interface ColumnLayout { readonly width: number; readonly collapsed: boolean }
export interface LayoutState { readonly left: ColumnLayout; readonly right: ColumnLayout }
export interface LayoutActions {
  setWidth(side: Side, width: number): void;        // clamps and rounds; ignored while collapsed or if not finite
  setCollapsed(side: Side, collapsed: boolean): void;
  toggleCollapsed(side: Side): void;
}
export type LayoutStore = LayoutState & LayoutActions;

export const LAYOUT_STORAGE_KEY = "nf-builder:layout";
export const LAYOUT_STORAGE_VERSION = 1;
export const COLUMN_LIMITS: Readonly<Record<Side, { readonly min: number; readonly initial: number; readonly max: number }>>;
//   left  { min: 200, initial: 256, max: 480 }, right { min: 240, initial: 296, max: 480 }  (open point 7)
export const COLLAPSED_WIDTH = 32;   // rail that keeps the expand button
export const DEFAULT_LAYOUT: LayoutState;

export function clampWidth(side: Side, width: number): number;
/** Validates data read from storage: unknown shape → defaults; widths clamped; non-boolean collapsed → false. */
export function sanitiseLayout(value: unknown): LayoutState;
/** Wraps a storage getter so that blocked, missing or full storage never throws (Node tests, privacy modes, quota). */
export function safeStorage(getStorage: () => StateStorage): StateStorage;
export function createLayoutStore(getStorage?: () => StateStorage /* default () => window.localStorage */): StoreApi<LayoutStore>;
export const layoutStore: StoreApi<LayoutStore>;
export function useLayout<T>(selector: (state: LayoutStore) => T): T;   // useStore(layoutStore, selector)
```
Implementation: `createStore(persist(…, { name: LAYOUT_STORAGE_KEY, version: LAYOUT_STORAGE_VERSION, storage: createJSONStorage(() => safeStorage(getStorage)), partialize: ({ left, right }) => ({ left, right }), migrate: () => DEFAULT_LAYOUT, merge: (persisted, current) => ({ ...current, ...sanitiseLayout(persisted) }) }))`. With synchronous localStorage, hydration completes during store creation, so the first render has the stored widths and nothing flashes.

`apps/web/src/layout/separator.ts` (new): pure keyboard and drag mapping
```ts
import type { Side } from "./layout-store";
export const KEYBOARD_STEP = 16;
export type SeparatorAction =
  | { readonly type: "resize"; readonly width: number }
  | { readonly type: "collapse" };
/** WAI-ARIA window splitter: left separator ArrowRight +step / ArrowLeft −step; right separator mirrored;
 *  Home → min, End → max, Enter → collapse; anything else → undefined. Width is unclamped; the store clamps. */
export function separatorKeyAction(side: Side, key: string, width: number): SeparatorAction | undefined;
/** Left: startWidth + (x − startX); right: startWidth − (x − startX). Unclamped. */
export function dragWidth(side: Side, startWidth: number, startX: number, x: number): number;
```

`apps/web/src/shell/app-header.tsx` (new)
```ts
export interface AppHeaderProps { readonly languageVersions: readonly string[] }
export function AppHeader(props: AppHeaderProps): JSX.Element;
```
Contains `<header className="app-header">` with `<h1 className="app-name">nf-builder</h1>` (unchanged content); the project switcher, a disabled `<button aria-haspopup="menu">` reading "No project"; the save state, `<p className="save-state" role="status">` reading "Nothing to save"; disabled "Templates", "Import" and "Export" buttons; and a visible "Nextflow" label with `<select aria-label="Nextflow version" defaultValue={versions[0]}>`, one `<option>` per version. Use `defaultValue` so React adds no controlled-field warning.

`apps/web/src/shell/side-column.tsx` (new)
```ts
export interface SideColumnProps {
  readonly side: Side;
  readonly id: string;            // "column-left" | "column-right"
  readonly label: string;         // landmark name: "Components and files" | "Details" (F-002 tests)
  readonly title: string;         // visible h2: "Components" | "Details"
  readonly children?: ReactNode;
}
export function SideColumn(props: SideColumnProps): JSX.Element;
```
Renders `<aside id aria-label className="column column-{side}[ is-collapsed]">` with a `div.column-header` holding the `h2` (not rendered when collapsed) and the toggle button. The button has `id="{id}-toggle"`, stays mounted in both states (so focus survives a toggle) and carries `aria-expanded`, `aria-controls="{id}-body"`, the name "Collapse …" or "Expand …", a matching `title` and an inline chevron icon. Below it, `div#{id}-body` gets `hidden` when collapsed.

`apps/web/src/shell/column-separator.tsx` (new)
```ts
export interface ColumnSeparatorProps {
  readonly side: Side;
  readonly controls: string;      // column id
  readonly label: string;         // "Resize components and files" | "Resize details"
}
export function ColumnSeparator(props: ColumnSeparatorProps): JSX.Element;
```
Renders `<hr className="column-separator column-separator-{side}" tabIndex={0} aria-orientation="vertical" aria-label aria-controls aria-valuenow={width} aria-valuemin={min} aria-valuemax={max}>`. Rendered only while its column is expanded.
- Pointer: primary button only. `setPointerCapture`; `dragWidth` on move goes to `setWidth`; release on up or cancel; `html.is-resizing` while dragging.
- Keys: `separatorKeyAction`, `preventDefault` on handled keys. Enter collapses the column, then focuses `#{controls}-toggle`.

`apps/web/src/shell/tab-strip.tsx` (new): `export function TabStrip(): JSX.Element`. A `div.tab-strip` with muted "No files open". No `role="tablist"` until tabs exist, because an empty tablist is an ARIA error.

`apps/web/src/shell/status-bar.tsx` (new)
```ts
export interface StatusBarProps {
  readonly problems: number; readonly suggestions: number;
  readonly nodes: number; readonly channels: number;
  readonly languageVersion: string | undefined;
}
export function formatCount(count: number, singular: string, plural: string, none?: string): string;
// formatCount(0,"problem","problems","No problems") → "No problems"; (1,…) → "1 problem"; (0,"node","nodes") → "0 nodes"
export function StatusBar(props: StatusBarProps): JSX.Element;
```
A top-level `<footer className="status-bar">` (contentinfo). On the left: a check icon with "No problems", then "No suggestions" (plain text until the problems panel exists), then "0 nodes · 0 channels". On the right: "Nextflow {version}".

`apps/web/src/shell/icons.tsx` (new): `ChevronIcon({ direction: "left" | "right" })` and `CheckIcon()`. These are inline SVG with `aria-hidden="true"` and `focusable="false"`, set colours through attributes or `currentColor`, and carry no `style` attribute.

`apps/web/src/app-shell.tsx` (change)
```ts
export function AppShell(): JSX.Element;   // signature unchanged; existing tests call <AppShell />
```
Calls `installedPackVersions()` once at module level and composes: `AppHeader`, then `div.app-columns` with `style={{ gridTemplateColumns: \`${L}px minmax(0, 1fr) ${R}px\` }}` (L and R are the width, or COLLAPSED_WIDTH when collapsed). Inside the grid, in DOM and tab order:
- the left `SideColumn`, body placeholder "No project open"
- the left `ColumnSeparator`
- `<main className="column column-centre" aria-label="Canvas and editor">`, holding `TabStrip` and `div.canvas-area` with "No project open"
- the right `ColumnSeparator`
- the right `SideColumn`, body "Nothing selected"

Then `StatusBar` with zero counts and `languageVersion = versions[0]`.

`apps/web/src/styles.css` (change):
- Tokens in `:root`: `--color-*`, `--space-*`, `--header-height: 48px`, `--status-height: 28px`, `--tabs-height: 36px`, `--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, `--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- The shell grid gains a status row.
- Explicit grid placement for the columns and separators. Separators are 8 px wide, overlap the column edge, show a 1 px line, use `cursor: col-resize` and have a visible `:focus-visible` outline.
- Collapsed rail, header controls, tab strip, dotted canvas background, status bar.
- Pairs that must reach 4.5:1 contrast (QA-13): body text and muted text on white and on the muted surface; header text on the header background; disabled button text, where WCAG exempts it but it should stay legible.
- No transitions or animations (QA-13 reduced motion, and stable screenshots).
- British English and sentence case in all copy; uppercase small labels (as in the mockup) through `text-transform` only.

### e2e and config

`e2e/browsers.ts` (change)
```ts
export const VISUAL_TAG = "@visual";
/** Visual baselines are rendered and compared only in CI (Linux, Playwright's Chromium) unless PW_VISUAL=1. */
export function visualEnabled(env: Record<string, string | undefined>): boolean;
```

`playwright.config.ts` (change):
- `updateSnapshots: "none"`; the CLI `--update-snapshots` overrides it.
- `snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}"`.
- The chromium project gets `grepInvert: visualEnabled(process.env) ? undefined : new RegExp(\`${VISUAL_TAG}\\b\`)`.
- Firefox and WebKit already run only `@smoke`, so `@visual` never runs there.

`e2e/app-shell-layout.spec.ts` (new): see Tests.

`e2e/__screenshots__/app-shell-layout.spec.ts/app-shell-default-chromium-linux.png` (new, produced by the workflow below, never locally).

`.github/workflows/visual-baselines.yml` (new; workflow edit, so decide and record):
- Name `Visual baselines`.
- `on: pull_request: types: [labeled]`; top-level `permissions: contents: read`.
- Job `update` with `if: github.event.label.name == 'update-baselines' && github.event.pull_request.head.repo.full_name == github.repository` and job-level `permissions: contents: write`. `runs-on` is the same value as the CI Chromium e2e job (open point 4: pin `ubuntu-24.04`).
- Steps:
  - Check out the PR head branch (`ref: head.ref`, passed through `env`, never inline `${{ }}` in `run`).
  - `./.github/actions/setup`, then `pnpm exec playwright install --with-deps chromium`.
  - `PW_BROWSERS=chromium pnpm test:e2e -- --grep @visual --update-snapshots=changed`.
  - If `git status --porcelain e2e/__screenshots__` shows changes: commit only that folder as `github-actions[bot]` ("test(e2e): update visual baselines from CI") and push to the head branch.
- Actions pinned by SHA with a version comment (test/workflows.test.ts). Never `pull_request_target`.

`.github/workflows/ci.yml` (change, only if open point 4 accepts the pin): the e2e job's `runs-on: ubuntu-24.04`.

## 2. Tests (written before the implementation in each task)

Every new test name carries F-201 and/or the requirement ID. The F-002 tests stay as they are and must still pass.

### Unit: packages
| File | Name | Asserts |
|---|---|---|
| packages/lang-2610/test/index.test.ts (add) | `LA-01 ADR-0006: the pack entry exports a LanguagePack for 26.10` | `pack.version === "26.10"` (a literal is allowed inside lang-*) |
| packages/engine/test/packs.test.ts (new) | `UX-01 LA-02: installedPackVersions lists the version of each installed pack, taken from the pack` | `installedPackVersions()` equals `installedPacks.map(p => p.version)` and equals `[pack.version]` from `@nf-builder/lang-2610`; non-empty; no literal |

### Unit: apps/web
| File | Name | Asserts |
|---|---|---|
| apps/web/test/layout-store.test.ts | `UX-02: the left column defaults to 256 px and the right to 296 px, both expanded` | `DEFAULT_LAYOUT` and a fresh store with empty memory storage |
| 〃 | `UX-02: setWidth clamps each column to its limits and rounds to whole pixels` | below min → min, above max → max, 300.6 → 301, per side |
| 〃 | `UX-02: setWidth ignores widths that are not finite numbers` | NaN or Infinity leaves the width unchanged |
| 〃 | `UX-02: collapsing keeps the width and expanding restores it` | setWidth 320, collapse, expand → 320; toggleCollapsed flips |
| 〃 | `UX-02: resizing a collapsed column changes nothing` | setWidth while collapsed is a no-op |
| 〃 | `F-201 step 1 UX-02 AR-30: the layout is stored under nf-builder:layout as version 1 with widths and collapsed flags` | the exact JSON in memory storage after setWidth and setCollapsed: `{"state":{"left":{"width":…,"collapsed":…},"right":{…}},"version":1}`; no action functions stored |
| 〃 | `F-201 step 1 UX-02: a new store starts from the stored layout (reload)` | seed storage, create a second store, state equals the seed synchronously |
| 〃 | `UX-02: malformed JSON, wrong types and out-of-range widths in storage fall back to defaults or are clamped, without throwing` | `"{"`, `{"state":{"left":"x"}}`, width 99999 → max, `collapsed: "yes"` → false |
| 〃 | `UX-02: a stored layout from another version is replaced by the defaults` | version 0 or 2 → DEFAULT_LAYOUT |
| 〃 | `UX-02: storage that throws (blocked or full) leaves the layout working in memory` | a getStorage that throws, and a setItem that throws: actions still update state and nothing throws |
| apps/web/test/separator.test.ts | `UX-02 UX-70: on the left separator ArrowRight widens and ArrowLeft narrows by 16 px` | separatorKeyAction("left", …) |
| 〃 | `UX-02 UX-70: on the right separator ArrowLeft widens and ArrowRight narrows by 16 px` | mirrored |
| 〃 | `UX-02 UX-70: Home and End go to the column's minimum and maximum, Enter collapses, other keys do nothing` | min and max from COLUMN_LIMITS; "a", "Tab" → undefined |
| 〃 | `UX-02: dragging the left separator right widens the left column; dragging the right separator left widens the right column` | dragWidth both sides |
| apps/web/test/status-bar.test.tsx | `UX-03: counts read "No problems", "1 problem", "2 problems", and likewise for suggestions, nodes and channels` | formatCount |
| 〃 | `UX-03: the status bar shows problems, suggestions, node and channel counts, then the language version` | static markup order; a version passed in (taken from `installedPackVersions()`, no literal) |
| apps/web/test/app-shell.test.tsx (add) | `UX-01 LA-02: the header has the project switcher, save state, Templates, Import and Export, and a Nextflow version selector listing exactly the engine's installed packs` | static markup inside `<header>`; the `<option value>` list equals `installedPackVersions()` |
| 〃 | `UX-02: each side column has a vertical separator with its value, limits and aria-controls naming the column` | two `<hr` with `tabindex="0"`, `aria-orientation="vertical"`, `aria-valuenow="256"`/`"296"`, min, max, `aria-controls="column-left"`/`"column-right"`; the asides carry those ids |
| 〃 | `UX-02: each side column has a collapse button that controls it and reports aria-expanded` | `aria-expanded="true"` and the names "Collapse components and files" and "Collapse details" |
| 〃 | `UX-02: the centre column has a tab strip above the canvas area` | `tab-strip` comes before `canvas-area` inside `<main>` |
| 〃 | `UX-03: the status bar is a footer after the columns` | `<footer` comes after the last `</aside>` |

### Unit: repo (test/)
| File | Name | Asserts |
|---|---|---|
| test/e2e-browsers.test.ts (add) | `F-201 ADR-NNNN: @visual tests are listed on Chromium only, and only when CI or PW_VISUAL=1 is set` | `visualEnabled` unit cases; `--list` with `{CI:"",PW_VISUAL:""}` has no `@visual`; with `{CI:"true", PW_BROWSERS:"chromium,firefox,webkit"}` Chromium lists ≥1 `@visual` and Firefox and WebKit list none |
| 〃 | `F-201 ADR-NNNN: a missing or changed baseline fails rather than being written, and baselines live in e2e/__screenshots__` | import `playwright.config.ts`: `updateSnapshots === "none"` and `snapshotPathTemplate` starts with `{testDir}/__screenshots__/` |
| test/workflows.test.ts (add) | `F-201 ADR-NNNN: the Visual baselines workflow runs only for the update-baselines label on same-repository pull requests, and only its job may write contents` | `types: [labeled]`; the `if` checks label and repo; top-level `contents: read`; `contents: write` only in the job; no `pull_request_target` |
| 〃 | `F-201 ADR-NNNN: the Visual baselines workflow updates only @visual baselines, on the Chromium e2e runner image, and commits only e2e/__screenshots__` | the `--grep @visual --update-snapshots=changed` command; `runs-on` equals ci.yml's e2e `runs-on`; `git add` path is `e2e/__screenshots__` |

The existing check "ci.yml has 8 jobs" is unaffected because the new workflow is a separate file.

### End-to-end: e2e/app-shell-layout.spec.ts (Chromium; one test also on Firefox and WebKit)
| Name | Tag | Asserts |
|---|---|---|
| `F-201 step 1 UX-02 QA-30: dragging the separators resizes both side columns within their limits, the widths persist after reload, and no CSP violation occurs` | | `watchForCspViolations`. Drag the left separator +100 → left aside 356 and `aria-valuenow="356"`. Drag the right one −60 → right 356; centre = 1440 − 356 − 356. Drag the left far right → width equals its `aria-valuemax`. Reload → same widths. Violations and console errors are `[]` |
| `F-201 step 1 UX-02 UX-70: the separators resize with the arrow keys, Home and End, and the widths persist after reload` | `@smoke` | Focus the left separator (`tabindex=0`). ArrowRight ×2 → 288; Home → `aria-valuemin`; End → `aria-valuemax`. Right separator ArrowLeft → 312. Reload → kept |
| `F-201 step 1 UX-02: both side columns collapse and expand with their buttons, and stay collapsed after reload` | | Click "Collapse components and files": aside width 32, `aria-expanded="false"`, separator count 0, centre grows. Same for details. Reload → still collapsed. "Expand …" → previous widths return |
| `F-201 step 1 UX-02 UX-70: Enter on a separator collapses its column and moves focus to its expand button` | | Enter on the left separator → collapsed; the "Expand components and files" button is focused; Enter on that button → expanded |
| `F-201 UX-01: the header shows the project switcher, save state, Templates, Import, Export and a Nextflow version selector listing the installed packs` | | Inside `banner`: the buttons exist (disabled); the status text is visible; combobox "Nextflow version" has ≥1 option, each matching `/^\d+\.\d+$/` (no literal) |
| `F-201 UX-03: the status bar shows problems and suggestions counts, node and channel counts, and the selected language version` | | `contentinfo` contains "No problems", "No suggestions", "0 nodes", "0 channels" and `Nextflow ${selected option value}` |
| `F-201 UX-02: the centre column shows a tab strip above the canvas area` | | The tab strip is visible inside `main` and its bottom edge is ≤ the canvas area's top edge |
| `F-201 step 2 UX-01 UX-02 UX-03: the default app shell matches the approved baseline` | `@visual` | Fresh context, 1440×900; wait for `contentinfo`; `expect(page, "No approved baseline, or the shell changed: add the update-baselines label to the PR (ADR NNNN)").toHaveScreenshot("app-shell-default.png")` with Playwright defaults (animations disabled, caret hidden), no masks and no thresholds |

The existing `e2e/app-shell.spec.ts` (F-002) runs unchanged and must pass.

## 3. Tasks (three builder runs)

### Task 1: Version source and layout state (no UI change)
- Write the tests first: the package tests, layout-store.test.ts and separator.test.ts.
- Implement: lang-core `LanguagePack`, lang-2610 `pack`, engine `packs.ts` and its re-export, the workspace deps, `zustand@5.1.0` in apps/web, `layout/layout-store.ts`, `layout/separator.ts`.
- Do not touch app-shell.tsx yet.
- Proof: `pnpm install && pnpm --filter @nf-builder/engine test && pnpm --filter @nf-builder/lang-2610 test && pnpm --filter @nf-builder/web test && pnpm check`

### Task 2: Shell UI and functional e2e
- Write the tests first: the app-shell.test.tsx additions, status-bar.test.tsx, and every e2e test except `@visual`.
- Implement: `shell/*.tsx`, the app-shell.tsx composition, styles.css. Keep the F-002 tests green and unchanged.
- Proof: `pnpm check && pnpm test:e2e -- --grep "F-201|F-002" && pnpm smoke && pnpm build && pnpm check:budget && pnpm check:hosts`

### Task 3: Visual baseline plumbing
- Write the tests first: the e2e-browsers.test.ts and workflows.test.ts additions, then the `@visual` e2e test.
- Implement: `VISUAL_TAG` and `visualEnabled` in e2e/browsers.ts; the playwright.config.ts changes; `.github/workflows/visual-baselines.yml`; the ci.yml `runs-on` pin if accepted.
- Never run `--update-snapshots` locally, and commit no PNG.
- Proof: `pnpm check && pnpm test:e2e -- --grep F-201` (excludes `@visual` locally) and `CI=true PW_BROWSERS=chromium,firefox,webkit node scripts/run-playwright.ts --list --grep @visual` (exactly one test, on chromium).

### Orchestrator, after the builder runs (docs, GitHub and approval)
1. Write the ADR (`Accepted (agent)`, next free number) and add it to docs/adr/README.md; replace `ADR-NNNN` in the test names. Add the Decisions lines to progress.md. Add an AGENTS.md line saying baselines in `e2e/__screenshots__/` come only from the Visual baselines workflow.
2. Create the label: `gh label create update-baselines`.
3. Open the PR, then add the label. The first CI run fails the `@visual` test (no baseline); this is expected and its message says so.
4. The workflow commits the PNG to the branch. Then `git pull`, Read the PNG, compare it with the mockup and UX-01..03, and approve or fix. Remove the label.
5. A push made with GITHUB_TOKEN does not trigger CI. The next commit you push (features.json `passes`, notes, progress.md) runs CI. Chromium e2e green, including `@visual`, is the step 2 evidence; record the run in the notes.
6. Append to F-701's `notes` the WCAG 2.5.7 deferral, if open point 8 goes that way.

## 4. Open points (orchestrator decides; recommendation first)

1. **Resizing: hand-rolled (recommended), or react-resizable-panels 4.24.1 (new dependency, so an ADR).**
   - v4 has grown into a workspace library (Group, Grid, tabsets, popouts). Importing only Group, Panel and Separator measured 48 kB minified and 15.4 kB gzipped.
   - It injects no `<style>` element in normal use. It does attach a constructable stylesheet through `adoptedStyleSheets` and `insertRule` for a global drag cursor. CSSOM sheets aren't governed by `style-src` in current browsers, but that would need an e2e check under our CSP. Its popout feature copies styles into `<style>` elements in other windows; we wouldn't use it.
   - It brings its own layout storage (`useDefaultLayout`), which would duplicate the Zustand store AR-30 asks for. Its sizes are percentage-first, while UX-02 is in px.
   - Hand-rolled is about 150 lines with px widths and the WAI-ARIA splitter pattern, needs no new dependency and no ADR.
2. **zustand 5.1.0 as an apps/web runtime dependency.** ADR 0003 already names it, so record a Decisions line rather than a new ADR. It is MIT (no licences.md entry), create plus persist is 1.3 kB gzipped, and the bundle contains no URLs (IO-41 clean).
3. **New persisted format** (Decide and record). localStorage key `nf-builder:layout`, Zustand envelope `{state:{left:{width,collapsed},right:{width,collapsed}},version:1}`. Data is validated on read and storage failures are ignored. Collapsed state persists along with widths. Recommendation: localStorage, not IndexedDB, because synchronous hydration means no layout flash. Record it in the F-201 ADR. ADR 0002 and data-and-io.md mention only IndexedDB for projects.
4. **Visual baselines.** Recommendation: render and approve in CI through a label-triggered `Visual baselines` workflow (above). This is a workflow edit with a job-level `contents: write`, limited to same-repo PRs and the label; anyone who can add labels already has write access.
   - Also pin `runs-on: ubuntu-24.04` for both that job and the CI Chromium e2e leg, so a silent `ubuntu-latest` move doesn't break baselines. Renovate doesn't manage runner labels; bump them deliberately.
   - Playwright bumps that change rendering need the label on the Renovate PR.
   - Rejected or fallback options:
     - (a) A CI artifact downloaded with `gh`: blocked, the proxy returns 403 for the artifact blob host (tested).
     - (b) Print the actual PNG as base64 in the job log on failure and decode it from `gh run view --log` (logs are readable): no write token, but hacky.
     - (c) `workflow_dispatch`: the workflow must be on `main` before it can be dispatched, and its push still doesn't trigger CI.
     - (d) Local generation: the sandbox Chromium and fonts differ, and there is no Docker daemon.
   - "Approved" means the orchestrator viewed the image, the PR's Screenshots section shows it, and the reviewer checked it. That reading is consistent with ADR 0011 and AGENTS.md: updating a baseline because the UI changed intentionally is not weakening it.
5. **Fonts.** Recommendation: the system font stack, no bundled font. Baselines are CI-only, so determinism doesn't need one. Bundling Inter (the mockup's font, OFL) could come later for fidelity; it would need a licences.md entry and an asset under `font-src 'self'`.
6. **Version list without literals (LA-02).** Recommendation: a minimal `LanguagePack { version }` in lang-core, `pack` in lang-2610, and `installedPackVersions()` in engine, called synchronously on the main thread.
   - Consequence for F-113: once the pack entry carries the parser and catalogue, this main-thread import would pull them into the initial bundle (QA-01 CI would catch it). F-113 must then move the list behind the worker API or a light export.
   - Alternative: a bare `export const version` in lang-2610 without touching lang-core. Smaller, but it diverges from Q10's "entry exports a LanguagePack".
   - These are the first cross-package workspace dependencies. They fit the existing rules, so the boundaries don't change.
7. **Spec is silent on these.** Proposed values:
   - Minimum and maximum widths: left 200–480, right 240–480.
   - Collapsed rail: 32 px with a 24 px button (WCAG 2.5.8).
   - Keyboard step: 16 px. Home and End go to min and max. Enter collapses.
   - Arrow keys don't act while a column is collapsed; its separator is removed and the expand button restores it.
   - Centre minimum width: none. At 1024 px with both columns at maximum the centre is 64 px. Accept that, or later clamp against the viewport.
   - Record these in the ADR or the Decisions lines, not in ux.md (changing the spec would itself need an ADR).
8. **WCAG 2.2 SC 2.5.7 Dragging movements (AA, part of QA-10).** Drag-to-resize needs a single-pointer alternative, and keyboard support doesn't count. Recommendation: defer to F-701, which owns QA-10, by appending to its notes. The alternative is "Narrower" and "Wider" buttons in each column header now, which adds clutter and baseline churn. Check SC 2.5.8 target size for the 8 px separator at the same time.
9. **Placeholder wording** (British English, sentence case):
   - Header: switcher "No project" (disabled); save state "Nothing to save"; buttons "Templates", "Import" and "Export" (the mockup says "Export .zip"; ux.md says Export), all disabled.
   - Version: label "Nextflow", accessible name "Nextflow version".
   - Columns: tab strip "No files open"; canvas "No project open"; left body "No project open"; right body "Nothing selected".
   - Status bar: "No problems", "No suggestions", "0 nodes · 0 channels", "Nextflow {version}". Suggestions isn't a link until the problems panel exists.
10. **Icons.** Recommendation: a tiny inline-SVG set (chevron, check), with no icon font and no dependency. No logo for now; if one is added it must sit outside the `<h1>` (the F-002 unit regex).
11. **Tags.** `@visual` is a new tag; Chromium runs it only in CI or with `PW_VISUAL=1`. Also tag the F-201 keyboard and persistence test `@smoke`, so Firefox and WebKit cover the shell (QA-20); it adds about 1 s to `pnpm smoke`.
12. **Separator element.** `<hr tabIndex={0}>`, because Biome rejects `div role="separator"` (probed). The alternative is a `biome-ignore` comment.
13. **No axe now.** QA-14 belongs to F-701, and `@axe-core/playwright` would be a new dev dependency.
14. **Parallel work.** Take the ADR number at PR time. Expect possible merge conflicts with F-007 and F-008 in playwright.config.ts and ci.yml.

What the feature leaves unspecified (listed here, not filled in): min and max widths, collapse affordance and placement, keyboard step, centre minimum, placeholder copy, how "approved baseline" is produced and by whom in autonomous mode, and whether collapsed state persists. UX-02 says only that widths persist.
