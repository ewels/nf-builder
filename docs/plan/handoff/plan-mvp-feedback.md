# Plan: MVP feedback batch (forms and shell)

Written by the planner on 2026-11-28 from `main` at `cd942de` (F-304 merged, session 3 pause). I read `main` and changed nothing. Paths are relative to the repository root. Visual polish (custom type-ahead, icon buttons, styling) is deferred to a later design pass. This plan covers only function and structure, in shared components with minimal CSS, so that the design pass can restyle them.

## 0. Scope and shape

Twelve maintainer items (B2, B4 to B7 and 6 to 12) split into two branches that can be built in parallel:

- **Branch A, `feat/F-318` (forms):** B2 value fields, B6 config options, item 11 config Markdown and entry point, item 6 registry search-only, item 10 palette order and the output block.
- **Branch B, `feat/F-319` (shell):** item 9 toasts (and B7, B4 through them), B5 viewport, item 8 tooltips, status colour and context menu, item 7 welcome and one New project flow, item 12 import review.

**Task 0 comes first and is done by the orchestrator.** It is one small PR with the `scope-change` label, holding:
- ADR 0070;
- the spec rows in section 6;
- new features F-318 and F-319 (M3, `depends_on` F-303, F-307, F-601, F-503 and F-505 for A; F-301, F-307, F-310 and F-401 for B);
- F-503 step 2 reworded (section 1.3).

With all docs landing first, neither branch edits `docs/spec/` or the ADRs, so they don't conflict there.

**Out of scope:** visual restyle; a string/expression toggle on config-form values (already typed, ADR 0061); stage directive arguments (stay raw); the output and params Configure forms (F-305); binary files (F-407); the backup Import (F-406); Files rename, move and delete (F-313).

## 1. Findings

### 1.1 Spec and ADRs
- **UX-41 / ADR 0066:** the form rows hold raw Nextflow text: `DirectiveRow.args`, `OutputRow.value` and `TopicRow.value` in `packages/lang-core/src/declaration-form.ts`. `write-rows.ts` pastes them into a synthetic process that the pack parses, so `*.html` gives "Unexpected input". `quote()` already exists there, used for topic names. New directive rows get defaults by catalogue kind (`read-process.ts` `DEFAULTS`). The Inputs "Add" button prefills `type: "String"` (`configure-form.tsx`).
- **FI-02 / ADR 0061:** strings are written single-quoted. Pinned layout options (`ConfigScopeForm.pinned`) render as `UnsetRowView` rows. A set pinned value can't be removed (`option-row.tsx`: `(!asValue || !pinned)`). The Add option dialog lists catalogue children with `firstSentence(description)` as raw text, while the details pane uses the safe renderer in `config/catalogue-text.tsx`.
- **UX-14 / ADR 0058:** registry lists show the whole index in 100-row windows (`registry/lazy-window.ts`).
- **UX-15 / ADRs 0060 and 0065:** add messages go to the palette's live region (`use-palette-add.ts` `say`). For plugins: "No node is drawn and the viewport is untouched".
- **UX-12:** category order is Processes, Workflows, Channel factories, Operators, Params & outputs, … (`packages/lang-2610/palette.yaml`, generating `palette.json`).
- **LA-40:** "Pipelines use a typed `params` block and an `output` block." The `blank` template has `params {}` and no `output`; `hello-world` has both. F-314 owns `UpdateOutputs` (adding outputs from the palette).
- **UX-01:** the header has Templates and Import. Import is disabled and left for F-406 by ADR 0062; the F-406 plan enables it for backups.
- **UX-60:** the New project dialog has three routes. "Publish docs to GitHub Pages" has no explanation and does nothing until F-606 (ADR 0047). Its meaning is in ADR 0013: nf-docs (https://github.com/ewels/nf-docs) builds docs from doc comments, schema, README and config; `docs.yml` publishes them to GitHub Pages.
- **UX-61:** the summary is inline in the New project dialog (`import/import-summary.tsx`, `SKIP_LABELS`). GitHub errors are strings only (`import/messages.ts`).
- **UX-03:** the status bar picks an error or warning glyph (`shell/status-bar.tsx` `ProblemsGlyph`), but the count has no error colour.
- **UX-26, UX-70:** there is no context menu. The actions exist as keys and buttons: `openNode`, popup Edit and Code, copy and paste (ADR 0067), delete, disconnect (ADR 0064), auto-layout.
- **QA-10 to QA-13:** WCAG 2.2 AA, keyboard, colour never the only signal, `prefers-reduced-motion`.

### 1.2 Code on main
- **Notices are scattered over seven places:** `canvasStore` `canvasNotice`, `navigationNotice` and `clipboardNotice` (in `.canvas-notices` and a hidden `data-clipboard-notice` region); `historyNotice`; `layoutNotice`; the palette add message; and `usePopup` `refusal`, shown under the details header in `<p role="status" class="popup-notice">` and never cleared. B7's text comes from `packages/engine/src/form/popup-target.ts`.
- **Viewport:** `workflow-canvas.tsx` calls `fitView` on every mount. `viewport.ts` only bridges the centre and the pointer. `use-refit-on-resize.ts` refits on resize.
- **Canvas controls:** React Flow `<Controls>` draws zoom and fit with `aria-label` only. Port labels and Auto-layout are `ControlButton`s with `title` and `aria-label`. A `title` isn't shown on keyboard focus.
- **No project:** the centre shows "No workflow open"; Files shows "No project open". After a delete the app stays empty. `project-store.ts` opens the first project at start.
- **Hosts:** `registry.nextflow.io` is on the allow-list (`scripts/allow-list.ts`). Links to `github.com/...` need `scripts/non-fetched-urls.ts` entries (IO-41 scan).

### 1.3 Tests that must change (locators or steps, not weakened)
- e2e: `registry-modules.spec.ts` (F-503 step 2 with 2,500 rows, namespace collapse), `registry-palette.spec.ts` (F-502 lists modules with no query), `plugins.spec.ts` (live region to toast), `palette*.spec.ts`, `canvas.spec.ts`, `clipboard.spec.ts`, `layout.spec.ts`, `new-project.spec.ts`, `export.spec.ts`, `read-only.spec.ts`, `app-shell-layout.spec.ts`.
- Unit: `registry-section`, `config-editor`, `value-field`, `new-project-dialog`, `project-ui`, `app-shell`, `files-panel`, `palette-message-rule`, `palette-tree`, `templates-request`.

Each keeps its assertion and only changes how the UI is reached; ADR 0070 records why. **F-503 step 2 becomes:** "Search a term matching 2,500 modules: results load more as they scroll without blocking input." The intent is kept: the same 2,500-module fixture, 100 rows first, at least 400 after four scrolls, no long task over 200 ms, and a typed key showing at once. Only now the rows are search results.

## 2. Design

### 2.1 Value modes (A, B2)
- **The mode is part of the engine form, so the logic stays in the engine (AR-31).** In `declaration-form.ts`:
  ```ts
  export type ValueMode = "string" | "file" | "files" | "expression";
  // DirectiveRow (named): + readonly mode: "string" | "expression"
  // OutputRow:            + readonly mode: ValueMode
  // TopicRow (emit):      + readonly mode: "string" | "expression"
  // In every mode but "expression", args/value hold the unquoted text.
  ```
- **Reading** (`read-process.ts`, also used when the Code tab draft is parsed back into the form, F-304):
  - one plain string literal (single or double quotes, no interpolation) becomes `string`;
  - for outputs, `file(<plain string>)` becomes `file` and `files(<plain string>)` becomes `files`;
  - anything else becomes `expression`, raw text unchanged.
- **Writing** (`write-rows.ts`): `valueSource(mode, text)` returns `'text'`, `file('text')` or `files('text')` (single quotes, `\` and `'` escaped by the existing `quote`), or the raw text. `rowChanges` sees a mode switch as a change, so untouched rows keep their text and comments (ADR 0066).
- **Defaults for new rows:**
  - a directive whose `DirectiveChoice.kind` is `string` starts in `string`; all others start in `expression` with today's defaults (`1`, `1.GB`, …);
  - a new output starts in `file` (open point 1);
  - a new topic starts in `string`.

  `DirectiveChoice` gains `mode`.
- **Validation in `UpdateDeclaration`, before parsing, as `fields` problems:**
  - an empty type gives "Enter a type, for example Path";
  - empty text in a non-expression mode gives "Enter a value" (outputs: "Enter a file name or pattern").
- **Hint:** `stringHint(text)` returns "Written as plain text: `$` isn't replaced. Switch to Expression to insert a value." when the text contains `${` or `$name` in a non-expression mode. It doesn't block Apply (open point 2).
- **Switching modes:** from a literal mode to `expression`, the text becomes its source (`'*.html'`). From `expression` to `string`, a plain literal is unquoted; any other text is kept as the string's content.

### 2.2 Field component (A)
`apps/web/src/ui/value-mode-field.tsx`: a labelled text input plus an "Expression" toggle (`<button aria-pressed>`, sharing the field's label). For outputs, a `<select>` offers File, Files, Text and Expression (open point 1). It is presentational: modes and text come in, and `onChange({mode, text})` goes out. Problems use the existing `data-field`, `aria-invalid` and `aria-describedby` contract. The monospace class applies only in expression mode. CSS uses existing tokens (`--space-*`, `--color-*`).

**Type fields:**
- a new input row has `type: ""`;
- `PortForm` drops `placeholder="Channel<Path>"` and adds a visible hint, "For example Channel<Path>", tied by `aria-describedby`;
- **rule:** placeholders only name an action ("Search …", "Filter") or "Not set", never a value.

### 2.3 Config form (A, B6 and item 11)
- **Cards:** a scope card lists only set options, plus "Add option…". The pack's `pinned` list now only orders suggestions: in the Add option dialog the pinned names come first under "Suggested", then "All options".
- **Remove:** every set option has Remove, pinned ones included. `UnsetRowView` is deleted.
- **When a card shows:** a card shows when the file has its scope, or the user just added it (Add scope's empty block). It is never made up from the layout. A card with nothing set says "No options set".
- **Markdown in lists:** the Add scope and Add option lists render their one-line description through `catalogue-text.tsx`'s inline renderer (`CatalogueInline`, exported for this): inline code and `https` links only, no `innerHTML`.
- **Entry point:** the Files view gets a "Configuration" button above the tree when the root `nextflow.config` exists. It opens the config tab with `openFile`, like the summary link (ADR 0061). Open point 6.

### 2.4 Registry search only (A, item 6)
- **Empty query:** the registry section shows its heading, source and refresh line, "Type to search modules and plugins", and a link "Browse registry.nextflow.io" (new tab, `rel="noopener noreferrer"`).
- **With a query:** the existing grouped results with 100-row windows. "Show N more (of T)" and the IntersectionObserver stay, applied to the results.
- **Removed:** namespace collapse state and the Modules and Plugins accordions with no query.
- **Kept:** the plugin "added" badge, read-only rules and the single status message (`palette-message-rule`) are unchanged.

### 2.5 Palette order and output block (A, item 10)
- **Order:** `palette.yaml` moves `params-outputs` directly after `workflows`, giving Processes, Workflows, Params & outputs, Channel factories, Operators, Types…, Plugins & config. Then `pnpm gen:palette 26.10`.
- **Output block:** I recommend adding `output {\n}` with a doc comment to `templates/blank/main.nf` (LA-40), after `params`, then `pnpm gen:templates 26.10`. It has to be oracle-clean: `pnpm oracle` case `template-blank`. **If an empty `output {}` doesn't lint clean on 26.10.7, stop and report.** The fallback is F-314's `UpdateOutputs` creating the block on first add (open point 7). Don't write the syntax from memory; check it with `pnpm nextflow lint`.

### 2.6 Toasts (B, item 9)
- **Store and region:** `apps/web/src/ui/toast-store.ts` (zustand vanilla) and `ui/toast.tsx`. `<ToastRegion>` is mounted once in `AppShell`: one `role="status"` `aria-live="polite"` region, bottom-centre above the status bar.
- **Behaviour:** up to 3 visible, the oldest dropped; info and success stay 6 s, errors 10 s; timers pause while hovered or focused; a dismiss button, and Escape on a focused toast; toasts never take focus; a repeat of the same `key` replaces the toast and is announced again (the NBSP trick); no transition under `prefers-reduced-motion: reduce`.
- **Action:** an optional single action button. It must also be reachable elsewhere, because a toast is transient (WCAG 2.2.1).
- **Dialogs:** toasts are raised only outside modal dialogs. Messages inside a dialog stay inline, and outcomes are toasted after it closes (open point 4).
- **Moved to toasts:**
  - palette and registry add results;
  - plugin add, with the "Open configuration" action;
  - `canvasNotice`, `navigationNotice` and `clipboardNotice` (successes and refusals);
  - the popup's closed-state `refusal` (B7);
  - export done;
  - import created ("Imported <name>: N files");
  - save failure (open point 3).
- **Stays in place:** persistent states in `.canvas-notices` ("Laying out nodes…", content notices, auto-layout unavailable); `historyNotice` next to the undo buttons; field-tied refusals.
- **B7:** the `popup-notice` paragraph is removed. `popupTarget` reasons are shortened to "<Kind> nodes have no Configure form yet." (the kind is capitalised, "Params nodes …"). They appear as the disabled Edit tooltip and as a toast on Enter or double-click.

### 2.7 Plugins on the canvas (B, B4)
- **Strip:** a "Plugins" strip at the top of the default workflow's canvas (under the breadcrumb, outside React Flow, so no node or projection change). It holds one chip button per declared plugin (`pluginStore.declared`, `id@version`) and is hidden when none are declared. A chip opens the `nextflow.config` config tab.
- **After an add:**
  - toast "Added plugin nf-schema@3.1.0 to nextflow.config." with "Open configuration";
  - the new chip gets `data-new` for 3 s (an outline, with no animation under reduced motion);
  - the active tab doesn't change (open point 5).
- **Read-only:** the strip shows there too.

### 2.8 Viewport per tab (B, B5)
- `canvasStore.viewports: Map<tabId, {x, y, zoom}>`, written from React Flow `onMoveEnd`, session-only, and cleared on project open and close and on tab close.
- On mount, a stored viewport becomes `defaultViewport` and the first `fitView` is skipped. `useRefitOnResize` doesn't refit a tab whose viewport the user has set.
- F-301's keep-viewport rule is unchanged.

### 2.9 Tooltip, status colour, context menu (B, item 8)
- **Tooltip:** `ui/tooltip.tsx` `<Tooltip text shortcut?>` wraps one focusable child. It shows on hover after 500 ms and on focus at once, is dismissed by Escape, and stays while the pointer is over it (WCAG 1.4.13). It has `role="tooltip"` and is linked by `aria-describedby` only when its text differs from the accessible name.
- **Canvas controls:** zoom and fit become our own `ControlButton`s (`showZoom={false} showFitView={false}`) calling `zoomIn`, `zoomOut` and `fitView(FIT)`. The tooltips read "Zoom in", "Zoom out", "Fit view (F)", "Port labels", and "Auto-layout all nodes (L)" or "Auto-layout selected nodes (L)".
- **Status bar:** when errors > 0 the problems count gets `data-severity="error"` and the `--color-error` colour. The error glyph and the word stay (QA-12), with contrast ≥ 4.5:1 (QA-13).
- **Context menu:**
  - `ui/context-menu.tsx` is a `role="menu"` popup: Arrow keys, Home and End, Enter or Space, Escape. Focus returns to the opener, and a click outside closes it.
  - `canvas/canvas-actions.ts` holds `actionsFor(target, state): readonly MenuAction[]`. It is the single list of what can be done, and the keys and the details header use the same handlers.
  - Node actions: Edit, Code (enabled per `popupTarget`, else disabled with the reason), Open workflow (workflow calls), Copy, Delete, Auto-layout selected.
  - Edge actions: Disconnect.
  - Pane actions: Paste N nodes, Auto-layout all, Fit view.
  - In read-only: Open workflow, Copy and Fit view only.
  - Opening: right-click, or Shift+F10 and the ContextMenu key on a focused node, edge or the pane. A right-click selects the target first.

### 2.10 Welcome and one New project flow (B, item 7)
- **When it shows:** `WelcomeScreen` fills the centre when no project is open and none is opening (first visit, or after deleting the open project). The left and right columns are collapsed or empty.
- **Content:**
  - a heading;
  - two sentences on what NF Builder is ("Build Nextflow pipelines visually in your browser. Projects are stored in this browser only.");
  - buttons New project, From template and Import, which open the same New project dialog on that route;
  - "Projects in this browser" with Open, sorted by last opened;
  - nothing else.
- **One flow:** the header "Templates" button becomes "New project…" and opens the same dialog on its last route. The switcher's "New project…" does the same, so there is one dialog and one route chooser (UX-01, open point 8).
- **Publish docs:** the checkbox gets a description: "Adds docs/usage.md, docs/output.md and a GitHub Actions workflow that builds documentation with nf-docs and publishes it to GitHub Pages." It links https://github.com/ewels/nf-docs and adds "Takes effect in a later version" until F-606 (open point 9). A `non-fetched-urls.ts` entry is needed.

### 2.11 Import review (B, item 12)
- **Steps:** the Import route becomes two steps inside the dialog:
  1. Source (GitHub or zip) and "Review";
  2. a Review page with the summary, skipped files, ignore list, and Back and Create.

  The report dialog afterwards is unchanged (UX-61).
- **Plain words:** `SKIP_LABELS` becomes
  - "Matched the ignore list";
  - "Larger than 1 MB, too big to edit here";
  - "Images and other non-text files aren't imported in this version";
  - "Paths that aren't safe to write";
  - "Same path twice";
  - "Compressed in a way the browser can't read".

  Each has one sentence of help (open point 10).
- **Actionable errors:** `importErrorView(error, ctx): { message; actions: readonly ImportErrorAction[] }`, with `ImportErrorAction = "retry" | "open-on-github" | "change-ref" | "add-ignore" | "report"`. Mapping:
  - network, rate-limited, refused, download and incomplete: retry;
  - not-found and no-such-ref: open on GitHub, change ref;
  - truncated and limit breaches: add ignore patterns;
  - unknown: report, which links the nf-builder issues page with no data filled in (open point 11).

## 3. Files

### 3.1 Branch A, create
- `apps/web/src/ui/value-mode-field.tsx`, `ui/field.css`: `export function ValueModeField(props: { label: string; field: string; value: string; mode: ValueMode; modes: readonly ValueMode[]; problem?: string; hint?: string | null; onChange(next: { mode: ValueMode; text: string }): void }): JSX.Element`.
- `packages/engine/src/form/value-mode.ts`:
  ```ts
  export function valueSource(mode: ValueMode, text: string): string;
  export function readValueMode(expr: Expression, file: string, allowed: readonly ValueMode[]): { mode: ValueMode; text: string };
  export function switchMode(from: { mode: ValueMode; text: string }, to: ValueMode): { mode: ValueMode; text: string };
  export function stringHint(text: string): string | null;
  ```
  These are exported from `@nf-builder/engine`.
- `packages/engine/test/form/value-mode.test.ts`, `apps/web/test/value-mode-field.test.tsx`, `e2e/mvp-forms.spec.ts`.
- `tools/oracle/cases/` case `f318-value-modes` with a golden.

### 3.2 Branch A, change
- `packages/lang-core/src/declaration-form.ts`: `ValueMode` and the `mode` fields; `DirectiveChoice.mode`.
- `packages/engine/src/form/read-process.ts`, `write-rows.ts`; `edit/commands/update-declaration.ts` (empty-value and empty-type problems).
- `apps/web/src/popup/configure-form.tsx` (uses `ValueModeField`; new input `type: ""`); `details/port-form.tsx`.
- `apps/web/src/config/scope-card.tsx`, `option-row.tsx`, `add-scope-dialog.tsx`, `catalogue-text.tsx` (export `CatalogueInline`), `config.css`.
- `apps/web/src/files/files-panel.tsx` (Configuration button).
- `apps/web/src/registry/registry-section.tsx`, `registry-lists.tsx`.
- `packages/lang-2610/palette.yaml` with the regenerated `palette.json`; `templates/blank/main.nf` with the regenerated `templates.json`.
- Tests listed in 1.3 for config, registry and palette.

### 3.3 Branch B, create
- `apps/web/src/ui/toast-store.ts`:
  ```ts
  export type ToastTone = "info" | "success" | "error";
  export interface ToastInput { text: string; tone?: ToastTone; key?: string; action?: { label: string; run(): void } }
  export function toast(input: ToastInput): string;
  export function dismissToast(id: string): void;
  export const toastStore: StoreApi<{ toasts: readonly Toast[] }>;
  ```
- `ui/toast.tsx`: `ToastRegion`.
- `ui/tooltip.tsx`: `Tooltip`.
- `ui/context-menu.tsx`: `ContextMenu({ items, at, onClose })`, `MenuAction = { id; label; shortcut?; disabled?: string | null; run(): void }`.
- `ui/ui.css`, adding `--radius-1`, `--shadow-1` and `--motion-fast` to `styles.css`.
- `canvas/canvas-actions.ts` (`actionsFor`).
- `canvas/plugin-strip.tsx`.
- `shell/welcome-screen.tsx`.
- `project/import-review.tsx`.
- Tests: `apps/web/test/{toast-store,toast-region,tooltip,context-menu,canvas-actions,plugin-strip,welcome-screen,import-review}.test.tsx` and `e2e/mvp-shell.spec.ts`.

### 3.4 Branch B, change
- `canvas-store.ts` (viewports; notices to `toast`).
- `workflow-canvas.tsx` (controls, `onMoveEnd`, context menu, `defaultViewport`).
- `use-refit-on-resize.ts`, `canvas-host.tsx`.
- `palette/use-palette-add.ts`, `palette-message.tsx`.
- `popup/popup-store.ts` (refusal to toast); `details/details-header.tsx`.
- `packages/engine/src/form/popup-target.ts` (reason text).
- `shell/status-bar.tsx`, `app-header.tsx`; `app-shell.tsx`.
- `project/new-project-dialog.tsx`, `project-store.ts`, `project-switcher.tsx`.
- `import/messages.ts`, `import-summary.tsx`, `import-section.tsx`.
- `scripts/non-fetched-urls.ts` (nf-docs, `https://github.com/` prefix for "open on GitHub", the issues URL).

**Shared files:** `features.json` and `progress.md` (finish only), the visual baselines, and `packages/engine/src/form/` (different files). A must not edit `popup-store.ts`, `use-palette-add.ts`, `palette-message.tsx` or `canvas-store.ts`. B must not edit `configure-form.tsx`, `config/*`, `registry/*` or `files-panel.tsx`.

## 4. Tests (write first; each fails on `main`)

### 4.1 Branch A
- **`value-mode.test.ts`:**
  - "F-318 UX-41: `'a.txt'`, `"a.txt"` read as string; `"${x}.txt"` as expression";
  - "file('*.html') reads as file, files('*.{html,zip}') as files, file(x) as expression";
  - "valueSource quotes and escapes `it's\\`";
  - "switchMode keeps text both ways";
  - "stringHint flags `$id` and `${id}`, not `$` alone".
- **`packages/engine/test/edit/`:**
  - "F-318 UX-41 UX-44: container 'quay.io/biocontainers/fastqc:0.12.1--hdfd78af_0' in string mode applies lint-clean";
  - "an output `*.html` in file mode writes `file('*.html')`";
  - "an empty input type is refused on inputs.0.type with 'Enter a type'";
  - "an untouched expression row keeps its text and comments";
  - "Code-tab round trip keeps modes".
- **Oracle `f318-value-modes`:** `container`, `publishDir` and `tag` in string mode, `file`/`files` outputs, a string topic. Lint and stub-run (`pnpm oracle`). The golden is matched by `oracle-goldens.test.ts`.
- **`value-mode-field.test.tsx`:**
  - "F-318 QA-11: the Expression toggle is a pressed button named with the field";
  - "the problem is described";
  - "the hint shows for `$`";
  - "no placeholder holds a value".
- **`port-form.test.tsx`:** "F-318 UX-51: the type field has no placeholder and a 'For example' hint".
- **`configure-form.test.tsx`:** "F-318 UX-41: a new input's type is empty".
- **`config-editor.test.tsx`:**
  - "F-318 FI-02: a manifest card shows only set options and Add option…";
  - "a set pinned option has Remove";
  - "Add option lists pinned names under Suggested first".
- **`add-scope-dialog.test.tsx`:** "F-318 FI-03: descriptions render inline code and https links, and no HTML from the catalogue".
- **`files-panel.test.tsx`:** "F-318 UX-16 FI-01: Configuration shows when nextflow.config exists and opens its tab".
- **`registry-section.test.tsx`:**
  - "F-318 UX-14: with no query the section says 'Type to search modules and plugins', links registry.nextflow.io and lists no rows";
  - "a query shows 100 results then 'Show 100 more (of 2,500)'".
- **`packages/lang-2610/test`** (palette): "F-318 UX-12: Params & outputs comes before Channel factories".
- **e2e `mvp-forms.spec.ts`:**
  - "F-318 step 1": add `container` with an unquoted URL, an output `*.html` and a topic `hello`, then Apply. The code shows the single-quoted forms, and there are no problems.
  - "F-318 step 2": a hello-world `manifest` card shows only set options, and each can be removed in one undo step.
  - "F-318 step 3": an empty search shows the prompt and the link; `fastqc` shows results.
  - "F-318 step 4": a blank project shows an output node, and the palette order is right.
  - Plus the reworded "F-503 step 2" (1.3) and the F-502 tests reached through search.

### 4.2 Branch B
- **`toast-store.test.ts`:**
  - "F-319 QA-10: at most 3, oldest dropped";
  - "same key replaces and re-announces";
  - "timers pause and resume";
  - "errors last 10 s".
- **`toast-region.test.tsx`:**
  - "one role=status region";
  - "dismiss button";
  - "reduced motion disables transitions" (CSS class).
- **`tooltip.test.tsx`:**
  - "F-319 QA-10 WCAG 1.4.13: shows on focus, Escape hides, no duplicate description".
- **`context-menu.test.tsx`:**
  - "F-319 UX-70 QA-11: arrow keys, Home and End, Enter runs, Escape restores focus";
  - "disabled items are focusable with their reason".
- **`canvas-actions.test.ts`:**
  - "F-319 UX-26: node, edge and pane action lists";
  - "read-only shows only Open workflow, Copy, Fit view";
  - "Edit is disabled with the popupTarget reason".
- **`canvas-store.test.ts`:**
  - "F-319 UX-27: a viewport is kept per tab and cleared on project open";
  - "refusals raise toasts".
- **`status-bar.test.tsx`:** "F-319 UX-03 QA-12: errors > 0 marks the count data-severity=error with the glyph".
- **`plugin-strip.test.tsx`:**
  - "F-319 IO-33: one chip per declared plugin, hidden with none";
  - "a chip opens nextflow.config".
- **`welcome-screen.test.tsx`:**
  - "F-319 UX-60: heading, three buttons opening the dialog routes";
  - "projects listed by last opened".
- **`new-project-dialog.test.tsx`:**
  - "F-319 UX-60: Publish docs has its description and nf-docs link";
  - "the Import route has a Review step with Back".
- **`import-messages.test.ts`:** "F-319 UX-61 IO-14: each GitHub error kind maps to its actions".
- **`import-summary.test.tsx`:** "skip labels in plain words".
- **e2e `mvp-shell.spec.ts`:**
  - "F-319 step 1": adding nf-schema shows a toast and a plugin chip; the chip opens the config.
  - "F-319 step 2": pan and zoom in tab A, switch to B and back, and the viewport is unchanged.
  - "F-319 step 3": controls show tooltips on focus, and the context menu by Shift+F10 deletes a node in one undo step.
  - "F-319 step 4": delete the last project and the welcome shows; From template creates a project.
  - "F-319 step 5": a zip import goes Source, Review, Create, report.
  - "F-319 B7": Enter on a params node gives a short toast that clears; the details header has no notice.
  - Plus updated locators in the 1.3 specs and `watchForCspViolations`.

## 5. Tasks

Each task: tests first, then code; done when its command and `pnpm check` pass. e2e runs need `PW_CHROMIUM_EXECUTABLE` set (AGENTS.md).

**Task 0 (orchestrator, before either branch):** ADR 0070, the spec rows in section 6, F-318 and F-319, and the reworded F-503 step 2, as one PR with the `scope-change` label. Proven by `pnpm check` and CI.

**Branch A (`feat/F-318`):**

| # | Task | Proves done |
|---|---|---|
| A1 | lang-core `ValueMode` and fields; engine `value-mode.ts`; read and write rows; `DirectiveChoice.mode`; UpdateDeclaration empty problems; oracle case | `pnpm --filter @nf-builder/engine test`; `pnpm oracle` (or CI `oracle`) |
| A2 | `ValueModeField`; wire directives, outputs and topics in `configure-form.tsx`; empty input type; `PortForm` hint | `pnpm --filter @nf-builder/web test` |
| A3 | Config cards show set options only, Add option suggestions, Remove on all set rows | `pnpm --filter @nf-builder/web test -- config` |
| A4 | Markdown in the Add scope and Add option lists; Files "Configuration" button | `pnpm --filter @nf-builder/web test` |
| A5 | Registry search-only plus link; update F-502 and F-503 e2e as in 1.3 | `pnpm test:e2e -- --grep "F-50[23]"` |
| A6 | Palette order (`gen:palette`); blank `output {}` (`gen:templates`, oracle `template-blank`; stop if it isn't lint-clean) | `pnpm gen:palette 26.10 --check`; `pnpm gen:templates 26.10 --check`; `pnpm oracle` |
| A7 | `e2e/mvp-forms.spec.ts`; finish (`passes`, `progress.md`, PR); baselines from CI | `pnpm test:e2e -- --grep F-318`; `pnpm test:corpus` (form reader touched) |

**Branch B (`feat/F-319`):**

| # | Task | Proves done |
|---|---|---|
| B1 | Toast store, region and CSS tokens; mount in `AppShell` | `pnpm --filter @nf-builder/web test -- toast` |
| B2 | Move notices to toasts (2.6), B7 text and header; update the locators listed in 1.3 | `pnpm test:e2e -- --grep "F-301\|F-310\|F-307\|F-505"` |
| B3 | Plugin strip, plugin-add toast action | `pnpm test:e2e -- --grep F-505` |
| B4 | Viewport per tab; refit guard | `pnpm --filter @nf-builder/web test -- canvas-store` |
| B5 | `Tooltip`; own zoom and fit buttons; status error colour | `pnpm --filter @nf-builder/web test` |
| B6 | `ContextMenu` and `canvas-actions.ts`, wired to the canvas | `pnpm --filter @nf-builder/web test -- context-menu canvas-actions` |
| B7 | Welcome screen, header "New project…", Publish docs copy, `non-fetched-urls.ts` | `pnpm test:e2e -- --grep "F-203\|F-205"`; `pnpm build && pnpm check:hosts` |
| B8 | Import Review step, plain skip labels, `importErrorView` actions | `pnpm test:e2e -- --grep "F-401\|F-403"` |
| B9 | `e2e/mvp-shell.spec.ts`; finish; baselines from CI | `pnpm test:e2e -- --grep F-319`; `pnpm check:budget` after build (QA-01) |

## 6. Records (drafts for Task 0)

**ADR 0070**, "MVP feedback: value modes, set-only config options, search-only registry, toasts, context menu, welcome screen", Accepted (agent). It amends:
- ADR 0066: value modes, empty-type refusal, `DirectiveChoice.mode`;
- ADR 0061: pinned options become suggestions; every set option is removable; Markdown in pickers; the Files entry point;
- ADR 0058: search-only lists; F-503 step 2 reworded;
- ADRs 0060 and 0065: messages become toasts; the plugin strip ("no node is drawn" stays true);
- ADR 0046: own zoom and fit buttons;
- ADR 0047: header "New project…" and the Publish docs description;
- ADR 0057 and UX-61: the Review step.

It records the toast rules and the context menu keys.

**Spec rows:**
- UX-01: "New project…" replaces Templates.
- UX-03: error colour.
- UX-12: order.
- UX-14: search-only and the registry link.
- UX-15: toast messages.
- UX-20 and UX-27: viewport per tab for the session.
- UX-21: tooltips.
- UX-26 and UX-70: context menu, Shift+F10 and the ContextMenu key.
- UX-31: the plugin strip on the default workflow's canvas.
- UX-41: value modes.
- UX-60: welcome screen and the Publish docs description.
- UX-61: Review step and actionable errors.
- FI-02: set options only; FI-03: Markdown descriptions.
- LA-40 note: blank template output block.
- A new **UX-05** (proposed ID): "Transient messages appear as toasts in one live region …".

No new runtime dependency, stored or exported format, package boundary or workflow. A new `apps/web/src/ui/` folder is within `apps/web` rules.

## 7. Open points (none decided here)

1. **Output value modes.** `'*.html'` as a String output is valid but almost never meant. I recommend File (`file('…')`) by default plus Files, Text and Expression. The syntax of `file()` and `files()` with globs in typed outputs must be checked against docs.seqera.io and the oracle before building.
2. **`$` in string mode.** I recommend writing single quotes always plus a non-blocking hint. The alternative, auto-writing a double-quoted GString, hides a semantic switch.
3. **"Saved" toast.** I recommend none for autosave (the header already shows it), and an error toast only on save failure. The maintainer listed "saved"; confirm.
4. **Toasts over modal dialogs.** Whether a top-layer popover is inert under a modal `<dialog>` in Chromium, Firefox and WebKit is unverified; ask the researcher. Until then, outcomes are toasted after the dialog closes.
5. **Plugin add reveal.** I recommend toast, chip flash, and staying on the canvas. Auto-opening the config tab would contradict UX-15's "focus stays on the palette item".
6. **Config entry point when `nextflow.config` is missing.** I recommend hiding the button, as the summary link does. The alternative, "Create nextflow.config", adds a command path.
7. **Output block by default.** I recommend changing the blank template if it is lint-clean, else creating the block on first add (F-314). This changes the `template-blank` baseline and F-203's expectations for the blank template.
8. **Header Import versus F-406.** The welcome screen's Import opens the New project Import route, while the F-406 plan enables the header Import for backups. Two "Import" entries with different meanings need one decision before B7 or F-406. Don't run B and F-406 in parallel (`app-header.tsx`, `project-store.ts`).
9. **Publish docs copy** while F-606 is unbuilt. I recommend the description plus "Takes effect in a later version", or hiding the checkbox until F-606 (supersedes ADR 0047's choice).
10. **Binary copy.** I recommend "aren't imported in this version" and no promise, since F-407 is M8 and deferred (ADR 0030).
11. **"Report" link target.** It would be the nf-builder GitHub issues page; needs the canonical repo URL (F-704 names `ewels.github.io/nf-builder`), and no project data is put in the URL (IO-40).
12. **Feature IDs.** I recommend new features F-318 and F-319 (M3) so `--grep` and the Scope guard work. The alternative is notes on existing features with no new steps.
13. **Stage arguments** stay raw expressions. Confirm, or extend the modes to `stageAs` and `env` later.

## 8. Settled by the orchestrator (2026-11-28)

1. Output values default to File mode (`file('…')`) with Files, Text and Expression; the builder checks `file()`/`files()` with globs against the docs and the oracle first, and reports if the syntax differs.
2. Single quotes always in string mode; a non-blocking hint for `$`.
3. No toast for autosave (the header status stays); toasts for explicit outcomes and for failed saves.
4. Toasts must show above modal dialogs (top layer: popover or rendered inside the open dialog); the builder verifies in e2e. Until verified, outcomes are toasted after the dialog closes.
5. Plugin add: toast with "Open configuration" and flash the plugin chip; no tab switch.
6. Configuration button hidden when `nextflow.config` doesn't exist.
7. `output {}` in the blank template only if lint is clean; otherwise F-314 creates it on first add.
8. One Import: the header Import opens the New project dialog on its Import route; F-406 later detects a backup there. No second Import meaning.
9. Publish docs keeps its checkbox, with a description and a link to nf-docs; F-606 (in v0.1) makes it effective.
10. Binary files: "Images and other binary files aren't imported yet." F-407 (binary files) is in v0.1.
11. "Report a problem" links to https://github.com/ewels/nf-builder/issues with no project data in the URL.
12. Feature ids: F-318 (forms), F-319 (shell), and F-320 for "drop on a node to add a take or input" (see the maintainer decisions in README.md). F-407 moves from M8 to M7.
13. Stage arguments stay raw expressions.
- ADR numbers: 0070 is taken by the factory-inputs fix (`fix/factory-inputs`); the batch ADR is 0071.
