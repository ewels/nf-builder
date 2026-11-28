# 0071. Apply the MVP feedback with value modes, set-only config options, a search-only registry, toasts, tooltips, a context menu and a welcome screen

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

The maintainer tried the MVP (the visual editing loop, after F-304) on the live site and sent twelve items of feedback, recorded in `docs/plan/handoff/README.md`, "Maintainer decisions, 2026-11-28". In short:

- **Forms.** Directive, output and topic values in the edit popup are raw Nextflow text (UX-41, ADR 0066), so typing `*.html` as an output gives "Unexpected input" and a container URL must be quoted by hand. Placeholders such as `Channel<Path>` look like values. Config scope cards show every pinned layout option as an unset row, and a set pinned option can't be removed (FI-02, ADR 0061). The Add scope and Add option lists show catalogue Markdown as raw text. There is no obvious way to open `nextflow.config` from the Files view.
- **Registry.** The registry section lists the whole index, 2,330 modules in collapsible namespace groups, before anything is searched (UX-14, ADR 0058).
- **Palette.** Params & outputs sits below Channel factories and Operators (UX-12), and the blank template has no `output` block although LA-40 asks for one.
- **Messages.** Outcomes are announced in seven different places: the palette's live region (ADRs 0060, 0065), three canvas notices, the history and layout notices, and the popup's refusal paragraph, which is never cleared (B7). Adding a plugin draws nothing, so it looks as if nothing happened (B4).
- **Shell.** The viewport is refitted every time a workflow tab is shown (B5). Canvas controls have no visible tooltips, the problems count has no error colour, and there is no context menu. With no project open the app shows empty columns. "Templates" in the header and "New project…" in the switcher open the same dialog by different names. "Publish docs to GitHub Pages" doesn't say what it does (ADR 0047). The import summary is inline and its skip reasons and GitHub errors are terse (UX-61, ADR 0057).
- **Scope.** Nothing is deferred past the first release except F-211 and F-402: F-313 to F-317 and F-407 (binary files) are in v0.1. Visual polish (custom type-ahead and select, icon buttons, row layout, styling) waits for one design pass the maintainer will run from a handover bundle. A new feature lets a dragged output be dropped on a node to add a take or input.

Research: `docs/plan/handoff/plan-mvp-feedback.md` (the planner's plan, read on `main` at `cd942de`), whose section 8 settles the open points of its section 7.

## Decision

The work is two features built in parallel, F-318 (forms) and F-319 (shell), and a third, F-320 (drop on a node to add a take or input), which gets its own ADR when it is built. F-407 moves from M8 to M7.

### Forms (F-318)

- **Value modes** (UX-41; amends ADR 0066). The engine form gives each directive, output and topic value a mode: `string`, `file`, `files` or `expression` (`ValueMode` in `@nf-builder/lang-core`). Directives and topics have `string` and `expression`; outputs have all four. Outside `expression` the form holds the unquoted text.
  - Reading: one plain string literal (single or double quotes, no interpolation) is `string`; for outputs, `file(<plain string>)` is `file` and `files(<plain string>)` is `files`; anything else is `expression`, kept as written.
  - Writing: `'text'`, `file('text')` or `files('text')`, always single-quoted with `\` and `'` escaped, or the raw text in `expression` mode. A mode switch is a change; untouched rows keep their text and comments.
  - Defaults: a new directive whose catalogue kind is a string starts in `string` (`DirectiveChoice.mode`), others in `expression` with ADR 0066's defaults; a new output starts in `file`; a new topic in `string`. The builder checks `file()` and `files()` with globs in typed outputs against docs.seqera.io and the oracle before building, and reports if the syntax differs.
  - Text containing `${` or `$name` outside `expression` gets a hint that doesn't block Apply: "Written as plain text: `$` isn't replaced. Switch to Expression to insert a value." Single quotes are never switched to a GString silently.
  - Switching to `expression` turns the text into its source (`'*.html'`); switching from `expression` to `string` unquotes a plain literal and otherwise keeps the text as the string's content.
  - `UpdateDeclaration` refuses an empty type ("Enter a type, for example Path") and empty text outside `expression` ("Enter a value"; for outputs "Enter a file name or pattern") as field problems.
- **No values in placeholders.** A new input row's type is empty. Placeholders only name an action ("Search …", "Filter") or say "Not set"; examples go in a visible hint tied by `aria-describedby` ("For example Channel<Path>").
- **Config cards list set options only** (FI-02; amends ADR 0061). A scope card shows the options the file sets, plus "Add option…"; with none it says "No options set". A card shows when the file has its scope or the user has just added it, never because the pack's layout names it. The layout's pinned options now only order suggestions: the Add option dialog lists them first under "Suggested", then "All options". Every set option has Remove, pinned ones included.
- **Markdown in pickers** (FI-03; amends ADR 0061). The Add scope and Add option lists render each one-line description with the details pane's safe inline renderer: inline code and `https` links only, no HTML from the catalogue.
- **Configuration entry point** (UX-16). The Files view has a "Configuration" button above the tree that opens the root `nextflow.config` in its config tab; it is hidden when the file doesn't exist.
- **Registry search only** (UX-14; amends ADR 0058). With an empty query the registry section shows its heading, source and refresh line, "Type to search modules and plugins" and a link "Browse registry.nextflow.io" (new tab, `rel="noopener noreferrer"`). With a query it shows the grouped results in ADR 0058's 100-row windows with "Show N more (of T)". The namespace accordions and their collapse state go. F-503 step 2 now scrolls search results: "Search a term matching 2,500 modules: results load more as they scroll without blocking input", with the same fixture and thresholds (100 rows first, at least 400 after four scrolls, no long task over 200 ms, a typed key showing at once).
- **Palette order** (UX-12). Processes, Workflows, Params & outputs, Channel factories, Operators, Types, functions & includes, Plugins & config.
- **Output block** (LA-40). The blank template gains an empty `output` block only if it is lint-clean and stub-runs on the pinned release (oracle case `template-blank`); otherwise F-314's `UpdateOutputs` creates the block on the first add and the blank template is unchanged.

### Shell (F-319)

- **Toasts** (new UX-05; amends ADRs 0060 and 0065). Transient outcomes appear as toasts in one `role="status"`, `aria-live="polite"` region mounted once in the app shell, bottom centre above the status bar.
  - At most three are visible and the oldest is dropped. Info and success toasts last 6 s, errors 10 s; timers pause while a toast is hovered or focused. Each has a dismiss button, and Escape dismisses a focused toast. Toasts never take focus. A toast with the same key replaces the last one and is announced again. There is no transition under `prefers-reduced-motion: reduce`.
  - A toast may have one action button, whose action must also be reachable elsewhere (WCAG 2.2.1).
  - Toasts must show above modal dialogs (in the top layer, as a popover or inside the open dialog); F-319 verifies this in e2e. Until it is verified, outcomes of a dialog are toasted after it closes, and messages about a dialog's own fields stay inline.
  - Moved to toasts: palette and registry add results, plugin adds, the canvas, navigation and clipboard notices, the popup's closed-state refusal, export done, import created ("Imported <name>: N files") and failed saves. Autosave raises no toast; the header's save state stays.
  - Stay in place: persistent states in the canvas notices ("Laying out nodes…", content notices, auto-layout unavailable), the history notice by the undo buttons, and refusals tied to a field.
  - B7 (amends ADR 0066): the popup's refusal paragraph is removed. `popupTarget` reasons become "<Kind> nodes have no Configure form yet." and show as the disabled Edit button's tooltip and as a toast on Enter or double-click.
- **Plugin strip** (UX-31; amends ADR 0065). The default workflow's canvas has a "Plugins" strip under the breadcrumb, outside React Flow, with one chip per declared plugin (`id@version`); it is hidden when none are declared and shows in read-only. A chip opens the `nextflow.config` config tab. Adding a plugin raises "Added plugin <id>@<version> to nextflow.config." with an "Open configuration" action and outlines the new chip for 3 s; the active tab doesn't change. No node is drawn, as ADR 0065 says.
- **Viewport per tab** (UX-20, UX-27). Each canvas tab keeps its viewport for the session, written when a move ends and cleared when a project opens or closes or the tab closes. A tab with a kept viewport is shown at it without a first fit, and a resize doesn't refit it. F-301's rule that adds keep the viewport is unchanged.
- **Tooltips** (UX-21; amends ADR 0046). One shared tooltip component shows on hover after 500 ms and at once on focus, stays while the pointer is over it, closes on Escape (WCAG 1.4.13), has `role="tooltip"`, and is linked by `aria-describedby` only when its text differs from the accessible name. React Flow's own zoom and fit controls are replaced by our buttons so they get tooltips: "Zoom in", "Zoom out", "Fit view (F)", "Port labels", and "Auto-layout all nodes (L)" or "Auto-layout selected nodes (L)".
- **Status colour** (UX-03). With errors the problems count is drawn in the error colour (`data-severity="error"`), keeping its glyph and word (QA-12) at a contrast of at least 4.5:1 (QA-13).
- **Context menu** (UX-26, UX-70). A `role="menu"` popup opened by right-click (which selects its target first), Shift+F10 or the ContextMenu key on a focused node, edge or the pane. Arrow keys, Home and End move; Enter or Space runs; Escape or a click outside closes it and focus returns to the opener. Disabled items stay focusable with their reason. One list of actions (`actionsFor`) serves the menu, the keys and the details header:
  - node: Edit, Code (disabled with the `popupTarget` reason when the popup doesn't open), Open workflow (workflow calls), Copy, Delete, Auto-layout selected;
  - edge: Disconnect;
  - pane: Paste N nodes, Auto-layout all, Fit view;
  - read-only: Open workflow, Copy and Fit view only.
- **Welcome screen and one New project flow** (UX-01, UX-60; amends ADRs 0047 and 0062). With no project open and none opening (a first visit, or after deleting the open project) the centre shows a welcome screen: a heading, "Build Nextflow pipelines visually in your browser. Projects are stored in this browser only.", buttons New project, From template and Import, and "Projects in this browser" with Open, most recently opened first. The header's "Templates" becomes "New project…". The header, the switcher and the welcome screen open one New project dialog, on the route they name or the last one used. The header Import opens that dialog on its Import route; F-406 later detects a backup zip there, so Import has one meaning.
- **Publish docs** (UX-60; amends ADR 0047). The checkbox stays, with the description "Adds docs/usage.md, docs/output.md and a GitHub Actions workflow that builds documentation with nf-docs and publishes it to GitHub Pages." and a link to https://github.com/ewels/nf-docs (ADR 0013). F-606, in v0.1, makes it take effect.
- **Import review** (UX-61; amends ADR 0057). The Import route has two steps in the dialog: Source (GitHub or zip) with "Review", then a Review page with the summary, skipped files, the ignore list, Back and Create. The report afterwards is unchanged. Skip reasons are in plain words: "Matched the ignore list", "Larger than 1 MB, too big to edit here", "Images and other binary files aren't imported yet.", "Paths that aren't safe to write", "Same path twice" and "Compressed in a way the browser can't read", each with one sentence of help. GitHub errors offer actions: Retry for network, rate-limit, refused, download and incomplete errors; Open on GitHub and Change ref for not-found and no-such-ref; Add ignore patterns for a truncated tree and limit breaches; "Report a problem" for unknown errors, linking https://github.com/ewels/nf-builder/issues with no project data in the URL (IO-40).

### Scope and design

- **F-407 in v0.1** (amends ADRs 0030, 0053 and 0059). Binary files move from M8 to M7. M8 keeps F-211 and F-402.
- **Design pass deferred.** Visual polish waits for one design pass from a handover bundle (screenshots of every screen and state, the component inventory with states and accessibility needs, CSS tokens, constraints). Until then new UI is plain, consistent markup in shared components under `apps/web/src/ui/` (value field, toast, tooltip, context menu) with minimal CSS tokens (`--radius-1`, `--shadow-1`, `--motion-fast` beside the existing ones), so the pass can restyle them in one place.
- **Unchanged.** Stage directive arguments (`stageAs`, `env`) stay raw expressions. Config-form values keep their typed kinds (ADR 0061). No new runtime dependency, stored or exported format, package boundary or workflow.

## Consequences

- Typing a file pattern, a container URL or a tag no longer needs Nextflow quoting, and what is written is checked by the oracle (`f318-value-modes`). Users who want an interpolated value switch to Expression explicitly.
- Config cards get shorter and every set option is removable; the pack's layout lists still matter, but only as suggestions.
- The registry section loads nothing until a search, so the palette opens faster and the 2,330-module list no longer hides the generic items. Browsing the whole registry happens on registry.nextflow.io.
- All transient feedback goes through one region, so tests find messages in one place. Tests that read the palette's live region or the canvas notices change their locators, not their assertions (`plan-mvp-feedback.md` section 1.3). Toasts are transient, so every toast action has a second route.
- Existing e2e and unit tests listed in the plan's section 1.3 change how they reach the UI and keep what they assert; F-503 step 2 keeps its fixture and thresholds.
- The app has a defined state with no project, and one dialog for every way of starting a project.
- The design pass can restyle the shared components without touching feature code.
- Checked by F-318's and F-319's steps, the unit tests and e2e specs in the plan's section 4, the `oracle` CI job, and QA-01's bundle budget after F-319.

## Alternatives

- Keep raw text in value fields and add quoting help: the feedback was that raw Nextflow text is the problem.
- Write `$` text in string mode as a double-quoted GString automatically: it hides a change of meaning.
- Keep pinned options as unset rows: they read as set values and couldn't be removed.
- Keep browsing the registry by namespace with no query: 2,330 rows nobody scrolls, and registry.nextflow.io already browses it.
- Auto-open the config tab after adding a plugin: it takes focus away from the palette, contrary to UX-15.
- Hide Publish docs until F-606: the maintainer wants the choice visible, and F-606 is in v0.1.
- A second header Import for backups (the F-406 plan): two Import buttons with different meanings.
- Restyle the UI now: the maintainer will do one design pass; restyling twice wastes work.
