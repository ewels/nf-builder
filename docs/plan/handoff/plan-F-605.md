# Plan: F-605, a Markdown preview and editor (sanitised), Monaco for other text files, and binaries listed but not opened

Planner output, 2026-11-23. I changed nothing in the repository.

**Sources I read:**
- `origin/main`, first at `893c900` and then at `d195424`, after F-209 merged as PR #50 during this session. I read it through a scratch detached worktree, which I have since removed.
- The F-209 branch as it was before it merged.
- The F-403 branch `feat/F-403` at `088d397` in `/home/user/wt-F-403` (three commits, records not yet written).
- `docs/plan/handoff/plan-F-309.md`, `plan-F-403.md`, `plan-F-401.md` and their settled points in `handoff/README.md`.
- `AGENTS.md`, `CLAUDE.md`, the mockups `4-subworkflow.png` and `5-config.png`, and `docs/licences.md`.

**In flight while I wrote this:**
- F-309 has started in `/home/user/wt-F-309` (branch at `d195424`, no commits yet).
- Another planner has a scratch worktree for F-210 (`scratchpad/p210`). I didn't touch it.

**What the feature cites:**
- Requirements: FI-30, FI-31, FI-32 and QA-31. The design also touches UX-20, UX-27, UX-52, UX-70, AR-23, AR-24, AR-30, AR-32, QA-01, QA-30 and IO-41.
- Dependency: F-208.
- ADRs read: 0003, 0040, 0043, 0044, 0045, 0048 and 0051, plus 0030 for how deferrals are recorded.

## 0. Scope

**In scope:**
- **Markdown (FI-30):**
  - files `.md` and `.markdown` open in a file tab in Preview, with Split and Code modes;
  - the preview is GitHub-flavoured Markdown, sanitised (2.2), built in a lazy chunk;
  - Code is F-208's Monaco with Markdown highlighting;
  - edits go through F-208's `ReplaceFileText` text sync and undo through F-209.
- **Other text files (FI-32, UX-52):**
  - they open in a file tab, in Monaco only;
  - the language comes from the extension (2.6), and an unknown extension opens as plain text.
- **`.nf` files with no workflow (FI-31):**
  - they open in a Code-only file tab;
  - the details pane shows an outline of their declarations through a new `EngineApi.outline(path)`.
- **Opening:** `openPath(path)` routes a file with workflows to its workflow tab and any other file to a file tab (UX-52). It is used by:
  - preview links;
  - the test hook;
  - later, F-210's tree.
- **QA-31:** imported files are never executed. HTML, SVG and every other non-Markdown file are shown as source in Monaco, and never rendered.
- **Binary files (FI-32's second sentence, step 2):** a recommendation only. Projects can't hold binary files in v0.1 (2.9, open point 1).
- **Lazy loading and QA-01, IO-41 entries, keyboard and accessibility, oracle fixture, tests.**

**Out of scope:**

| What | Owner |
|---|---|
| Storing binary files in projects, listing them in the Files view and refusing to open them | The M8 "Binary files in projects" feature that F-403's PR adds (settled point 4), once open point 1 is decided |
| The Files tree that a user opens files from, uploads and drops | F-210, which calls `openPath` |
| File tabs as a primitive (`kind`, `fileTabFor`, `openFile`), and `revealCode` | F-309 (plan 2.5 and 2.4). F-605 builds on them (open point 8) |
| Closing tabs | F-307 or F-701 (note) |
| Config forms (Form, Split and Code) | F-601, which reuses the per-kind modes of 2.4 |
| The schema builder, the `meta.yml` form, and validating JSON or YAML | F-602, F-604 |
| Showing a project SVG (FI-54's metro map) inside the README preview | F-607 (open point 5) |
| Inline diagnostics for the file's own problems in Monaco | F-304 |
| Highlighting code blocks inside the preview; heading anchors and in-page links | Later (open point 6) |
| Highlighting HTML, CSS, XML, JavaScript or Perl, and detecting a language from a shebang | Later (open point 11) |
| The third-party notices page | F-704 |
| Read-only mode below 1024 px | F-703 |

## 1. Findings

### 1.1 Spec and ADRs
- **FI-30:** "`README.md` and other Markdown: preview and code, with the preview sanitised."
- **FI-31:** "`.nf` files with no workflow (function libraries, record definitions) open in Monaco, with an outline of their declarations in the details pane." This is cited, but no step tests it.
- **FI-32:** "Everything else that is text opens in Monaco with language detected from the extension. Binary files are listed but not opened."
- **QA-31:** "Markdown previews are sanitised. Imported files are never executed."
- **UX-52:** "Opening a file from the Files view uses its editor (`files.md`). Unknown text files open in Monaco." No feature cites UX-52, but F-605 is its natural owner.
- **UX-20:** "Tabs above the canvas hold open workflows and open files."
- **`files.md` preamble:** "Editors that offer a form also offer the raw text (Form, Split or Code), and both go through edit commands, so undo and autosave behave the same everywhere." The mockup (`5-config.png`) shows a Form, Split and Code toggle on a file tab, with icons and full file names on the tabs.
- **ADR 0048:**
  - The policy has `style-src 'self' 'unsafe-inline'` and `img-src 'self' data: blob:`.
  - "Any HTML the app renders from user content strips `<style>` elements and `style` attributes (F-605's sanitiser)."
  - "F-304 and F-605 reuse the Monaco loader, the language registration and the marker code."
  - Its AR-30 reading is "Editor models hold the open files' text on the main thread".
  - The notices page must carry "its bundled DOMPurify and marked".
- **ADR 0051:**
  - A sent `ReplaceFileText` is one step labelled `Edit <path>`.
  - Monaco keeps its own undo.
  - An undo first awaits every code pane's registered flush.
  - The Undo and Redo controls sit in the tab strip whatever the mode.
- **ADR 0045, the glossary and F-403's settled point 4:**
  - Schema v1 `files` is `{projectId, path, text}`, and binary content needs a version bump.
  - The glossary defines a project as "a set of text files".
  - F-403 settled point 4 skips binary files on import and lists them in the summary ("Binary files"). It adds a deferred M8 feature, "Binary files in projects" (schema v2, import and export passthrough), with `scope-change`. That feature is not yet in `features.json` on any branch.
  - F-401 does the same, and its rule is that "an additive optional field doesn't bump the version; anything an older build would misread does".
- **ADR 0044:** the app runs in cross-origin frames, where `target="_blank"` works only if the embedder allows pop-ups.

### 1.2 Code as it stands (main at `d195424`)

**`apps/web/src/code/`:**
- `models.ts` creates every model with `NEXTFLOW_LANGUAGE_ID`.
- `nextflow-language.ts` calls `createHighlighterCore({langs: [nextflow]})` and then `shikiToMonaco` once.
- `@shikijs/monaco` binds token providers only for the languages loaded at the moment it is called. Each call defines the themes again and wraps `monaco.editor.setTheme` and `create`, so a second call works but adds one wrapper.
- `code-editor.tsx`:
  - awaits `readFile` and `registerNextflow()`;
  - syncs through `canvasStore.apply(..., session)`;
  - registers its flush with F-209's `registerFlush`;
  - follows `lastChange` while the buffer is clean;
  - says "`<path>` is not in the project." when the file is missing.
- `CodePane` (`code-pane.tsx`) is path-based and is keyed `code:${session}:${path}`, so file tabs can reuse it unchanged.

**Engine:**
- `languageOf(path)` is exported and case-sensitive: `.md` and `.markdown` are `markdown`, `.json` is `json`, `.yml` and `.yaml` are `yaml`, and everything else is `text`.
- `checkResult` guards only `nextflow` and `config` files, so `ReplaceFileText` on Markdown, JSON or YAML is never refused for its content.
- `ProjectChange.files` carries `{path, text | null}`, where null means the file was deleted.
- `summary.files` is set at open and never updated, and nothing in `apps/web` reads it.

**Tabs:**
- `WorkflowTab` is workflow-only: `{id, path, workflow, label, mode}`.
- `ViewMode` is `"graph" | "split" | "code"`, from a fixed `VIEW_MODES` list.
- `PanelLayout(mode, canvas, code)` and `viewModeForKey(e)` work off that list.
- F-209 added `TabStripView`, so the strip can be unit tested.
- `changed()` re-points renamed workflow tabs, keyed by `tabFor(w).id`, and re-projects the active tab.

**Left column:** the Files panel is a placeholder that reads "No project open".

**Test hook:** `nfBuilderWorkspace` holds `{open, openWorkflow, apply(command, options?), history()}`. Two e2e locators use the tablist name "Workflows" (`canvas.spec.ts` lines 53 and 539).

**Templates:** each has a `README.md`. Hello world's is benign. The `f205-canvas` oracle case holds `modules/nf-core/wordcount/meta.yml`, `data/words.txt` and several module `main.nf` files with no workflow.

### 1.3 Renderer candidates
These were measured on 2026-11-23 from the npm registry, bundled with rolldown 1.2.19, minified and gzipped with node zlib. The sizes are approximate; Vite's output will differ slightly.

| Candidate | Version (published) | Licence | Bundle min / gzip | Notes |
|---|---|---|---|---|
| **marked + DOMPurify** | 18.2.1 (2026-11-16) and 3.4.18 (2026-11-14) | MIT; MPL-2.0 OR Apache-2.0 | 79.8 / **26.6 kB** | marked passes raw HTML through, and DOMPurify sanitises it. `npm audit` is clean. |
| marked alone | 18.2.1 | MIT | 50.6 / 15.2 kB | |
| DOMPurify alone | 3.4.18 | (MPL-2.0 OR Apache-2.0) | 29.0 / 11.6 kB | 3.5.0 came out on 2026-11-22. That is inside Renovate's `minimumReleaseAge` of 3 days. |
| micromark + micromark-extension-gfm | 4.0.3 and 3.0.0 | MIT | 74.6 / 20.7 kB | Safe by default because raw HTML is escaped. Raw HTML would need DOMPurify as well, and the package brings about 20 sub-packages. |
| markdown-it | 15.0.3 | MIT | 98.4 / 40.9 kB | |
| Monaco's own copies (marked 14.0.0, DOMPurify 3.4.15 vendored under `monaco-editor/esm/vs/base/...`) | pinned by `monaco-editor` 0.57.0 | MIT; MPL/Apache | 62.0 / 21.3 kB | See below. |

**What is wrong with Monaco's copies:**
- They are reachable only through internal paths (`monaco-editor/base/common/marked/marked.js` and `monaco-editor/base/browser/dompurify/dompurify.js`) and have no `.d.ts`. Monaco's ESM imports its own copies, not the npm packages, even though its `package.json` lists `marked` 14.0.0 and `dompurify` 3.4.15 as dependencies.
- **`npm audit` reports five advisories for DOMPurify 3.4.15** (all low): GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-c6gr-qvv4-5v3f, GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr, fixed by 3.4.17. A copy pinned through Monaco can only move when Monaco does, and Renovate can't bump it on its own.

### 1.4 Sanitiser probe
I ran marked 18.2.1 and DOMPurify 3.4.18 under jsdom 31.0.1, using the allowlists in 2.2 plus a post-processing pass, on a hostile README. The input had:
- `<script>`, `<img onerror>`, `javascript:`, `JaVaScRiPt:`, `data:` and `vbscript:` links;
- `<style>`, a `style`/`class` paragraph, `iframe srcdoc`, `object` and `embed`;
- `svg>script`, `math`, `form`/`button formaction`, `meta refresh`, `base` and `link rel=stylesheet`;
- `details ontoggle`, a `picture`/`source srcset`, a remote badge and a `data:` PNG;
- task lists, a table, clobbering `id`/`name`, a `noscript` mXSS and a `template`.

The output has none of those elements, and no `on*`, `style` or `class` attributes. Only the `data:` image is left as an `<img>`; the others are replaced by alt-text placeholders. External links carry `target=_blank rel="noopener noreferrer"`, unsafe links lose their `href`, and relative links carry the path. Ids and names come out as `user-content-…`, and the checkboxes are disabled. The output is in `mdtools/sanitise-probe.out`.

### 1.5 Shiki grammars for other languages
These are from `@shikijs/langs` 4.6.0, the version already pinned.
- **Compatibility:** markdown, yaml, json, shellscript, python, r, groovy, toml, ini, csv, tsv, diff and mermaid all tokenise with the JavaScript regex engine, as nextflow does. No WebAssembly is needed.
- **Size:** together they are 34.3 kB gzipped, and none contains an absolute URL.
- **Cost of creating a highlighter** (Node, unthrottled, three runs):
  - nextflow only: 2–4 ms;
  - all 14 languages: 38–107 ms.
  - So the extra grammars should load only when the first non-Nextflow file opens.
- **Left out:** HTML (it embeds JavaScript and CSS), CSS, XML (it embeds Java) and Perl (it embeds HTML and SQL). Each would be 12–17 kB gzipped or more.

### 1.6 Binary files
- No v0.1 write path stores bytes:
  - templates, F-111 commands and `writeFiles` all take `FileText` strings;
  - F-403 and F-401 skip binary files;
  - F-210's upload will reuse F-403's text check.
- So a `.png` can't be "in the project" in v0.1. Step 2 can't pass as written unless projects hold binary files (schema v2, with import, export and the Files view). That is the M8 feature F-403 settled on. This is the main open point (open point 1).

## 2. Design

### 2.1 Renderer (open points 2 and 3)
- **Choice:** `marked` 18.2.1 and `dompurify` 3.4.18, pinned exactly, as runtime dependencies of `@nf-builder/web`. This is a decide-and-record item.
  - Both run on the main thread in one lazy chunk, because DOMPurify needs a DOM and the worker has none.
  - The parser is `new Marked({gfm: true, breaks: false})`, and parsing is synchronous.
- **The DOMPurify instance:** a dedicated one, `createDOMPurify(window)`, with no global hooks. It shares nothing with Monaco's internal copy.
- **Post-processing:** links, images and inputs are rewritten on the returned fragment, not inside DOMPurify hooks. The 2026 advisories all concern hooks that mutate nodes or `IN_PLACE` mode, and we use neither.
- **How the HTML reaches the page:** never as a string. The fragment is appended with `container.replaceChildren(fragment)`. Nothing uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML` or `document.write`, and a unit test scans the sources for them.

### 2.2 Sanitising rules (QA-31, ADR 0048, open point 4)
**Raw HTML in Markdown is rendered and sanitised, as GitHub does.** This matters because nf-core READMEs use `<h1><picture>`, `<details>` and `<p align>`.

**DOMPurify configuration:**
- `ALLOWED_TAGS`: `a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var`.
- `ALLOWED_ATTR`: `href title alt src align colspan rowspan scope open checked disabled type start reversed id name lang dir width height`.
- `ALLOW_DATA_ATTR: false`, `ALLOW_ARIA_ATTR: false`, `SANITIZE_NAMED_PROPS: true`, `RETURN_DOM_FRAGMENT: true`.
- `FORBID_TAGS: [style, script, source]`, `FORBID_ATTR: [style, class]`.

**What that excludes:**
- Every element that runs code, loads something, submits or restyles: script, style, link, meta, base, iframe, frame, object, embed, form, button, textarea, select, svg, math, template, noscript, video, audio and source.
- Every `on*` attribute, `style` and `class`. Dropping `class` also stops content from borrowing the app's own classes.
- Every attribute that makes the browser fetch: `srcset`, `background`, `poster`, `ping`, `action`, `formaction` and `xlink:href`.

**Post-processing, with pure rules in `markdown-policy.ts`:**
- **Links** (`classifyLink`):
  - `http:` and `https:` open in a new tab: `target="_blank"` and `rel="noopener noreferrer"`, plus visually hidden text "(opens in a new tab)".
  - `mailto:` gets the same `rel` and no `target`.
  - **A relative path** resolves against the Markdown file's folder; a leading `/` means the project root, and the query and fragment are dropped. It becomes `role="link" tabindex="0" data-path="<resolved>"` with no `href`, and activating it calls `openPath` (2.5).
  - **Fragments, protocol-relative URLs, any other scheme, and paths that leave the project** lose their `href` and become inert text.
- **Images** (`isAllowedImageSource`):
  - only `data:image/(png|gif|jpeg|webp|avif|svg+xml)` stays as an `<img>`, keeping `alt`, `title`, `width` and `height`;
  - anything else becomes `<span class="markdown-image" title="Image not shown: <src>">[<alt or "Image">]</span>`.
  - **So the preview never makes a request.** That means no CSP violation from `img-src`, no 404 for project-relative paths (which would resolve against the site, not the project), and no address leaked to badge hosts.
  - **This tightens the brief's "data: and same-origin".** Same-origin images would be the app's own assets, never the project's files. Showing a project SVG through a `blob:` URL made from its text is open point 5.
- **Inputs:** only `type="checkbox"` survives, and it is forced to `disabled`.

**Reading of "links opened safely" under IO-41:** opening a user's link in a new tab is navigation started by the user, not a network call by the app. This follows the React Flow attribution precedent in `non-fetched-urls.ts`, and the ADR records it.

### 2.3 Preview component and data flow (AR-30)
- **The eager part:** `MarkdownPane({path})` holds a header with the path and a status line, plus a `Suspense` around the lazy `MarkdownPreview`. A `CanvasErrorBoundary` covers a failed chunk load with the message "The preview couldn't load. Reload the page."
- **`MarkdownPreview`, the lazy default export:**
  - **On mount:** it captures the session, then `readFile(path)`, then `renderMarkdown(text, {path})`, then `replaceChildren`.
  - **Updates:** it renders again when `lastChange.paths` includes its path. In Split, the preview therefore follows an edit after F-208's 300 ms send.
  - **Stale reads:** results for an older session or an older read are dropped.
  - **States:** `data-preview-state="loading|ready|unavailable"`. A missing file reads "`<path>` is not in the project."; a render error reads "The preview couldn't be shown: …".
  - **Link clicks:** one delegated click and Enter handler on `[data-path]` calls `canvasStore.openPath`. A `missing` answer sets the status line to "`docs/usage.md` is not in this project."
  - **Its own container:** `<article class="markdown-preview" aria-label="Preview of <path>" tabIndex=0>`, focusable so it can be scrolled by keyboard.
- **The preview imports nothing from `code/`,** so Preview mode never loads Monaco.
- **The AR-30 reading:** the preview, like an editor model (ADR 0048), holds its own file's text on the main thread while it is mounted. The stores still hold paths only.

### 2.4 Markdown modes and keys (UX-27, UX-70; open points 6 and 7)
- `ViewMode` becomes `"graph" | "preview" | "split" | "code"`.
- `modesFor(kind, path)` gives the mode list for a tab:
  - workflow tabs: Graph, Split and Code (unchanged);
  - Markdown tabs: Preview, Split and Code;
  - other file tabs: none, so the toggle is hidden and the tab is Code only;
  - F-601 will add Form, Split and Code.
- **Keys are positional:** G, S and C pick the first, second and third mode of the active tab, so G means Preview on a Markdown tab. The toggle's titles read "Preview (G)".
- **Default:** a Markdown tab opens in Preview. Modes are kept per tab for the session (no stored format).
- **Layout:** `PanelLayout(mode, visual, code)` (the `canvas` prop is renamed `visual`) shows the visual pane in Graph or Preview, the code in Code, and both in Split, with the visual pane first, as in the mockup.

### 2.5 File tabs and opening (UX-20, UX-52; open points 8 to 10)
**What F-605 builds on:** F-309 plan 2.5, which is being built now:
- `WorkflowTab.kind: "workflow" | "file"` and `title`;
- `fileTabFor(path)`, with id `file:<path>`, `workflow: null`, and the label rule (the last two segments for `main.nf`, otherwise the file name);
- `openFile(path)`: added once, activated, no projection loaded, the selection cleared;
- `changed` and `load` skip file tabs, and F-209's re-pointing ignores them.

**What F-605 adds:**
- `fileTabFor` sets `mode` to `"preview"` for Markdown (`fileEditorOf(path) === "markdown"`) and to `"code"` otherwise.
- **`openPath(path): Promise<OpenOutcome>`** (`"workflow" | "file" | "missing"`):
  - It captures the session.
  - If `openTargetOf(path, summary.workflows)` finds a workflow in the file, it calls `openWorkflow(path, entry ?? first)`, keeping that tab's mode.
  - Otherwise it calls `readFile(path)`: null gives `missing` and no tab; text gives `openFile(path)`.
  - Shared with F-210: the Files tree calls `openPath`.
- **`changed`:** a file tab whose path arrives with `text: null` (deleted) is removed. If it was active, the previous tab is activated.
- **`TabStripView`:**
  - shows the toggle from `modesFor(active)`;
  - sets `title={tab.title}`;
  - the tablist is renamed from "Workflows" to "Open workflows and files" (open point 9), and the two e2e locators are updated.
- **Test hook:** `nfBuilderWorkspace.openPath`.
- **Until F-210 lands,** users reach files only through preview links and F-309's problem navigation; the e2e tests use the hook (open point 10).

### 2.6 Other text files in Monaco (FI-32; open point 11)
**`editorLanguageOf(path)` (pure, eager):**
- Extensions are matched without case; specific names win over extensions.

| Match | Language |
|---|---|
| `.nf`, `.config` (but not `nf-test.config`) | `nextflow`, as today; `.config` until F-601 |
| `nf-test.config`, `.nf.test`, `.groovy` | `groovy` |
| `.json`, `.snap` (nf-test snapshots) | `json` |
| `.yml`, `.yaml`, `.cff` | `yaml` |
| `.md`, `.markdown` | `markdown` |
| `.sh`, `.bash` | `shellscript` |
| `.py` | `python` |
| `.r` | `r` |
| `.toml` | `toml` |
| `.ini`, `.cfg` | `ini` |
| `.csv` | `csv` |
| `.tsv` | `tsv` |
| `.diff`, `.patch` | `diff` |
| `.mmd` | `mermaid` (FI-55) |
| anything else, including `.html`, `.svg`, `.xml`, `.txt`, `LICENSE` and `.gitignore` | `plaintext` |

**Which editor a file gets:** `fileEditorOf(path)` is `"markdown"` exactly when the engine's `languageOf(path) === "markdown"`. This keeps AR-01's case-sensitive rule, so `README.MD` opens as code.

**`code/languages.ts`, inside the Monaco chunk:**
- `registerLanguage(id)` builds on F-208's `registerNextflow`. The first call creates the highlighter with nextflow and `github-light`, exactly as now.
- **Two stages:**
  - The first non-Nextflow, non-plain-text language triggers one dynamic `import("./extra-grammars")`, a chunk that statically imports the 13 grammars of 1.5.
  - That call runs `highlighter.loadLanguage(...)` for all of them, `monaco.languages.register({id})` for each, and `shikiToMonaco(highlighter, monaco)` a second and last time. That keeps the wrapper chain at two (1.2).
- **Failure:** if this fails, the editor opens with plain tokens and the next mount tries again, as F-208 does.
- `plaintext` is Monaco's built-in language id.

**`models.ts`:** `modelFor(path, text)` creates the model with `editorLanguageOf(path)`.

**`code-editor.tsx`:**
- awaits `registerLanguage(language)` instead of `registerNextflow()`;
- sets `data-language` on `.code-editor-host` for tests;
- turns on `wordWrap` for `markdown` and `plaintext`.
- No visible label is added to the Code pane, so the F-208 and F-209 baselines don't change.

### 2.7 Edits and undo (AR-23, AR-24, ADRs 0048 and 0051)
- **Nothing new on the edit path.** The reused `CodePane` and `CodeEditor` send `ReplaceFileText` through `canvasStore.apply(command, session)`.
- **Markdown, JSON, YAML and plain text are never refused for their content** (1.2). `ADR 0004` means an invalid JSON file is saved as written; validating it belongs to F-602 and F-604. `.config` keeps the AR-24 guard.
- **Undo:** each sent edit is one F-209 step, "Edit README.md". The tab-strip Undo and Redo work in every mode, Preview included, and the preview follows `lastChange`. In Split, F-209's registered flush sends pending text before an undo.
- **The preview never edits.**

### 2.8 FI-31 outline (open point 12)
**Engine, in the worker:**
- `fileOutline(file: SourceFile): readonly OutlineItem[] | null` builds the list from `topLevelItems`. It returns null unless the file is a Nextflow script.
- `OutlineItem` is `{kind, name, detail, line, range: {start, end}}`. The kinds are:
  - `featureFlag`, `include` (entries `A, B as C`, with the source path as `detail`), `import`;
  - `params`, `legacyParam` (`params.x`);
  - `record`, `enum`, `process`, `agent`, `workflow`, `output`, `function`;
  - `unparsed` (its head keyword and name);
  - `statement`.
- `detail` is capped at 80 characters, so the outline carries names and ranges, never text (AR-30, the ADR 0049 reading).
- `EngineApi.outline(path): Promise<OutlineResult | EngineRefusal>`, where `OutlineResult` is `{revision, items}`. An unknown path is refused as `not-found`, and no project as `no-project`.
- This amends ADR 0043's API list.
- It is added to `connectEngine` (not announced), to `workspace.ts` (passed straight through) and to `e2e/engine.ts`.

**Page:**
- `FileDetails({path})` shows in the details pane while a file tab is active.
- **For a Nextflow file:** a "Declarations" list, with one row per item: the kind word, the name in monospace and "line N". It is fetched on mount and on `lastChange` of its path.
  - Each row is a button that calls F-309's `revealCode(path, range)`, which is why task 6 waits for F-309.
- **For any other file:** its path and language name ("Markdown", "YAML", "Plain text").

### 2.9 Binary files (FI-32, step 2; open point 1)
**v0.1 reading:**
- Projects hold text files only (glossary, ADR 0045).
- Binary files are "listed" where they are dropped: F-403's and F-401's import summaries ("Binary files", up to 100 paths) and F-210's upload or drop result.
- They are "not opened" because they are never stored.
- F-605 adds no binary code path, because it would be dead code in v0.1.

**Recommendation:**
- Move step 2, "A .png in the project is listed but not opened", to the M8 "Binary files in projects" feature, which lists binary files in the Files view with a `binary` tag and never opens them.
- Amend FI-32 to say so.
- This defers part of a step, so it needs an ADR and the `scope-change` label.

### 2.10 Lazy loading and QA-01 (AR-32)

| Chunk | Contents | Loaded |
|---|---|---|
| Initial | `files/file-kinds.ts`, `markdown/markdown-pane.tsx`, `details/file-details.tsx`, store and tab changes (estimate under 4 kB gzipped) | Page load; QA-01 has about 360 kB of headroom |
| Markdown preview | `markdown-preview.tsx`, `render-markdown.ts`, `markdown-policy.ts`, marked, DOMPurify, `markdown.css` (about 28 kB gzipped plus CSS) | The first Preview or Split view of a Markdown tab |
| Code view (F-208) | Monaco, `languages.ts` and the nextflow grammar | The first Split or Code view, as now |
| Extra grammars | 13 grammars (34 kB gzipped) | The first non-Nextflow file in Code or Split |

- An e2e test checks four things:
  - Preview loads no Monaco chunk;
  - the initial JavaScript has neither the preview's marker nor Monaco's;
  - the preview chunk has no Monaco marker;
  - Code loads Monaco.
- `pnpm check:budget` confirms QA-01.

### 2.11 IO-41
- Building marked and DOMPurify 3.4.18 brings in these absolute URLs:
  - `http://` (no host, so it is skipped);
  - `https://github.com/markedjs/marked.`, already listed (reword its reason to cover our copy);
  - the w3.org namespaces, already listed;
  - `https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE`, from DOMPurify's `/*! regenerator-runtime … */` legal comment.
- If Vite keeps that last one, add an exact `NON_FETCHED_URLS` entry ("a licence comment inside DOMPurify (F-605); never fetched").
- The grammars hold no URLs.
- The builder runs `pnpm build && pnpm check:hosts` and records exactly what shows up.

### 2.12 Accessibility (QA-10 to QA-13)
- The toggle stays the F-208 radio group, fed with `modes`.
- Project links in the preview are `role="link"`, focusable, and open with Enter.
- External links carry hidden text announcing the new tab.
- An image placeholder is text in brackets with the source as its title.
- The preview `article` is focusable, so it can be scrolled.
- The outline rows are buttons in a list under an `h3` "Declarations".
- `markdown.css` uses the existing colour tokens (QA-13), and tables have visible borders.
- There is no animation.

### 2.13 Fixtures
- **`tools/oracle/cases/f605-library/`:**
  - `main.nf` is typed, with `nextflow.enable.types = true` and an entry workflow that uses an item from `lib/samples.nf`;
  - `lib/samples.nf` has no workflow and holds one function, one record and one enum;
  - `lint: {expect: ok}`, `run: {expect: ok}`, `spec: [F-605, FI-31]`;
  - plus non-Nextflow files: a benign `README.md` (heading, table, task list, a link to `docs/usage.md`, an external link, a `data:` image and a remote badge), `docs/usage.md`, `conf/params.yml` and `assets/email_template.html`, whose body contains `<script>window.__f605 = 1</script>` (QA-31).
- **Sources:** `docs/reference/syntax.mdx` and `docs/module.mdx` at v26.10.7, and the AST fixtures `function.nf`, `enum.nf` and `record.nf`.
- **The builder checks** whether 26.10 lets `include` import records and enums. If it doesn't, `main.nf` includes only the function, and the record and enum stay local to the library. Nothing is copied from this plan unchecked; the oracle decides.
- **The hostile README** lives as a constant in `e2e/markdown.ts`, not as a committed `README.md`, so GitHub never shows it as a page.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `apps/web/src/markdown/markdown-policy.ts` | `MARKDOWN_TAGS: readonly string[]`; `MARKDOWN_ATTRIBUTES: readonly string[]`; `LinkTarget = {kind: "external"; url: string; newTab: boolean} \| {kind: "project"; path: string} \| {kind: "inert"; reason: "fragment" \| "scheme" \| "outside" \| "empty"}`; `classifyLink(href: string, from: string): LinkTarget`; `resolveProjectPath(from: string, href: string): string \| null`; `isAllowedImageSource(src: string): boolean` (all readonly; no DOM, no dependencies) |
| `apps/web/src/markdown/render-markdown.ts` | `RenderOptions {path: string; window?: Window}`; `renderMarkdown(text: string, options: RenderOptions): DocumentFragment`; `projectLinkOf(target: EventTarget \| null): string \| null`; `MARKDOWN_PREVIEW_MARKER: string` (a unique string for the chunk tests) |
| `apps/web/src/markdown/markdown-preview.tsx` | `default function MarkdownPreview(props: {path: string}): JSX.Element` (lazy) |
| `apps/web/src/markdown/markdown-pane.tsx` | `MarkdownPane(props: {path: string}): JSX.Element` (eager; lazy-imports the preview) |
| `apps/web/src/markdown/markdown.css` | preview typography, placeholders, status line |
| `apps/web/src/files/file-kinds.ts` | `EditorLanguage = "nextflow" \| "markdown" \| "yaml" \| "json" \| "shellscript" \| "python" \| "r" \| "groovy" \| "toml" \| "ini" \| "csv" \| "tsv" \| "diff" \| "mermaid" \| "plaintext"`; `editorLanguageOf(path: string): EditorLanguage`; `LANGUAGE_NAMES: Record<EditorLanguage, string>`; `FileEditor = "markdown" \| "code"`; `fileEditorOf(path: string): FileEditor`; `OpenTarget = {kind: "workflow"; ref: WorkflowRef} \| {kind: "file"}`; `openTargetOf(path: string, workflows: readonly WorkflowRef[]): OpenTarget` |
| `apps/web/src/code/languages.ts` | `registerLanguage(id: EditorLanguage): Promise<void>` (keeps `registerNextflow` working as `registerLanguage("nextflow")`) |
| `apps/web/src/code/extra-grammars.ts` | `EXTRA_GRAMMARS: readonly {id: EditorLanguage; grammar: LanguageRegistration[]}[]` (static imports of the 13 `shiki/langs/*.mjs`) |
| `apps/web/src/details/file-details.tsx` | `OutlineState = {status: "loading"} \| {status: "ready"; items: readonly OutlineItem[]} \| {status: "unavailable"; message: string}`; `FileDetailsView(props: {path; language: string; outline: OutlineState \| null; onReveal?(item: OutlineItem): void}): JSX.Element`; `FileDetails(props: {path: string}): JSX.Element` |
| `packages/engine/src/details/outline.ts` | `fileOutline(file: SourceFile): readonly OutlineItem[] \| null` |
| `tools/oracle/cases/f605-library/**` | 2.13 |
| `e2e/markdown.ts` | `F605_FIXTURE`; `HOSTILE_README: string`; `openF605(page, overrides?: {path; text}[])`; `openPathInUi(page, path): Promise<"workflow" \| "file" \| "missing">`; `preview(page): Locator`; `auditPreview(page): Promise<{forbidden: string[]; handlerOrStyleAttributes: string[]; unsafeLinks: string[]; imageSources: string[]}>`; `sentinel(page): Promise<unknown>`; `recordForeignRequests(page): () => string[]` |
| `e2e/markdown.spec.ts` | section 4 |
| Tests | `apps/web/test/{markdown-policy,render-markdown,file-kinds,code-languages,file-details}.test.ts(x)`; `packages/engine/test/details/outline.test.ts`; `packages/engine/test/service/outline.test.ts` |

### 3.2 Change
- **`apps/web/package.json` and `pnpm-lock.yaml`:** dependencies `marked: "18.2.1"` and `dompurify: "3.4.18"`; dev dependency `jsdom: "31.0.1"` (open point 13).
- **`apps/web/src/views/view-mode.ts`:**
  - `ViewMode` gains `"preview"`;
  - `ModeOption {mode; label; key: "g" | "s" | "c"}`;
  - `WORKFLOW_MODES`, `MARKDOWN_MODES`;
  - `modesFor(kind: "workflow" | "file", path: string): readonly ModeOption[]`;
  - `viewModeForKey(e: ViewModeKey, modes: readonly ModeOption[]): ViewMode | null`;
  - `VIEW_MODES` is kept as an alias of `WORKFLOW_MODES`.
- **`apps/web/src/views/view-mode-toggle.tsx`:** `ViewModeToggle({modes, mode, onChange})`.
- **`apps/web/src/views/use-view-mode-keys.ts`:** pass `modesFor(active)`.
- **`apps/web/src/views/tab-panel.tsx`:**
  - `PanelLayout({mode, visual, code})`;
  - a file tab renders `MarkdownPane` and `CodePane` by mode, or `CodePane` only.
- **`apps/web/src/shell/tab-strip.tsx`:** the toggle from `modesFor`, `title`, and the tablist label.
- **`apps/web/src/canvas/canvas-store.ts`:**
  - Markdown mode in `fileTabFor`;
  - `openPath(path): Promise<"workflow" | "file" | "missing">`;
  - deleted file tabs are removed in `changed`;
  - if F-309 hasn't merged by task 4, F-309 plan 2.5 exactly as written (open point 8).
- **`apps/web/src/code/models.ts`:** the language comes from the path.
- **`apps/web/src/code/nextflow-language.ts`:** delegates to `languages.ts`.
- **`apps/web/src/code/code-editor.tsx`:** `registerLanguage`, `data-language`, `wordWrap`.
- **`apps/web/src/details/details-pane.tsx`:** `FileDetails` when a file tab is active.
- **`apps/web/src/main.tsx`:** `openPath` in the `nfBuilderWorkspace` hook.
- **`apps/web/src/engine/engine-client.ts` and `apps/web/src/workspace/workspace.ts`:** `outline`.
- **`packages/engine/src/details/types.ts`, `service/types.ts`, `service/service.ts` and `index.ts`:** `OutlineKind`, `OutlineItem`, `OutlineResult` and `EngineApi.outline`.
- **`e2e/engine.ts`:** `EngineHook.outline`.
- **`e2e/canvas.spec.ts`:** the tablist name, if open point 9 is taken.
- **`tools/oracle/cases/cases.yaml`:** the f605 case.
- **`scripts/non-fetched-urls.ts`:** 2.11.
- **Unchanged:**
  - package boundaries and dependency-cruiser;
  - workflows;
  - stored and exported formats;
  - the AGENTS.md command table;
  - generated files;
  - the F-201, F-205, F-206, F-208 and F-209 baselines.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **web `markdown-policy.test.ts`** (pure) | |
| `F-605 FI-30 QA-31: classifyLink opens http, https and mailto links outside the app, sends relative paths to the project, and makes fragments and every other scheme inert` | `HTTPS://x`, `mailto:`; `javascript:` in mixed case, with leading spaces and with tabs; `data:`, `vbscript:`, `file:`; `//host/x`; `#frag`; `./a.md?x#y` gives `a.md` |
| `F-605 FI-30: resolveProjectPath resolves against the Markdown file's folder, treats a leading slash as the project root, decodes percent escapes and refuses paths that leave the project` | |
| `F-605 FI-30 IO-41: only data: images of raster or SVG types are shown` | remote, protocol-relative, relative, `blob:` and `data:text/html` are refused |
| `F-605 QA-31 ADR-0048: the allowlists hold no element that runs, loads, submits or restyles, and no style, class, on* or fetching attribute` | |
| **web `render-markdown.test.ts`** (`@vitest-environment jsdom`) | |
| `F-605 step 1 FI-30 QA-31: a README with script tags, event handlers, javascript: links, frames, forms, SVG and a meta refresh renders with none of them and keeps its text` | the 1.4 battery |
| `F-605 ADR-0048 QA-30: style elements and style and class attributes are stripped` | the F-208 note |
| `F-605 FI-30: GitHub-flavoured Markdown renders headings, lists, tables, task lists with disabled checkboxes, code blocks, strikethrough and autolinks` | |
| `F-605 FI-30 IO-41: remote and relative images become their alt text with the source as a title, data: images stay, and srcset and picture sources are dropped` | |
| `F-605 FI-30: external links open in a new tab with noopener and noreferrer, mailto has no target, project links carry their resolved path and no href, and unsafe or fragment links lose their href` | |
| `F-605 QA-31: ids and names gain the user-content- prefix, so content can't clobber document properties` | |
| `F-605 QA-31: the preview modules never write HTML strings into the page` | scans `src/markdown/` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML` and `document.write` |
| **web `file-kinds.test.ts`** | |
| `F-605 FI-32: editorLanguageOf picks the language from the extension, and unknown files are plain text` | the 2.6 table |
| `F-605 FI-30 AR-01: a file opens in the Markdown editor exactly when languageOf says markdown` | `README.md` yes, `x.markdown` yes, `README.MD` no |
| `F-605 FI-31 UX-52: openTargetOf sends a file with workflows to its entry workflow, else its first, and every other file to a file tab` | |
| **web `code-languages.test.ts`** (Monaco and Shiki mocked, as in `nextflow-language.test.ts`) | |
| `F-605 FI-32 QA-01: Nextflow and plain text load no extra grammars; the first other language loads them all once, registers each Monaco language and binds the highlighting a second time only` | |
| `F-605 FI-32 ADR-0048: a failed grammar load leaves plain tokens and a later file tries again` | |
| `F-605 FI-32: a model takes its language from its path` | |
| **web `view-mode.test.ts`** (extend) | |
| `F-605 UX-27 UX-70: workflow tabs offer Graph, Split and Code, Markdown tabs Preview, Split and Code, other file tabs none; G, S and C pick the first, second and third mode` | |
| **web `view-mode-toggle.test.tsx`** (extend) | |
| `F-605 UX-27: the toggle renders the modes it is given, with their shortcuts in titles and aria-keyshortcuts` | |
| **web `canvas-store.test.ts`** (extend, with a fake engine) | |
| `F-605 FI-30 UX-20: a Markdown file tab opens in Preview and another file tab in Code; neither loads a projection` | |
| `F-605 UX-52: openPath opens a workflow file's default workflow tab, opens other files in a file tab, and reports a missing path without adding a tab` | |
| `F-605: deleting a file closes its file tab and activates the previous tab` | |
| `F-605 AR-30: file tabs hold paths and modes, never text` | |
| **web `tab-panel.test.tsx`** (extend) | |
| `F-605 UX-27 FI-30: a Markdown tab shows the preview in Preview, both with the preview first in Split, and the code in Code; another file tab shows only the code` | |
| **web `tab-strip.test.tsx`** (extend) | |
| `F-605 UX-27 UX-20: a Markdown tab shows the Preview, Split and Code toggle, a plain file tab shows none, file tabs carry their path as a title, and the tablist is "Open workflows and files"` | |
| **web `file-details.test.tsx`** (static markup) | |
| `F-605 FI-31: a .nf file with no workflow lists its declarations with kind, name and line` | |
| `F-605 FI-32: another file shows its path and language name` | |
| **web `engine-client.test.ts` and `workspace.test.ts`** (extend) | |
| `F-605: the facade forwards outline and announces no change; the workspace passes it straight through and saves nothing` | |
| **engine `test/details/outline.test.ts`** | |
| `F-605 FI-31: fileOutline lists every top-level declaration of a script in source order with its kind, name and line` | the `function.nf`, `enum.nf` and `record.nf` AST fixtures by path, plus include, params, output and feature-flag text |
| `F-605 FI-31: an unparsed declaration keeps its keyword and name, and top-level statements are listed as statements` | |
| `F-605 FI-31 AR-30: an outline carries names and ranges, with details capped at 80 characters` | |
| `F-605: config, Markdown and plain files have no outline` | |
| **engine `test/service/outline.test.ts`** (the real service) | |
| `F-605 FI-31: outline answers at the current revision; an unknown path is refused as not-found, and no project as no-project` | |
| `F-605 FI-31: the f605-library case outlines lib/samples.nf as a function, a record and an enum` | |
| `F-605 ADR-0003: outline results survive structuredClone` | |
| **oracle** | `f605-library`: lint ok, `run -stub` ok |
| **e2e `e2e/markdown.spec.ts`** (Chromium) | |
| `F-605 step 1 FI-30 QA-31 QA-30: a README containing a script tag previews without executing it @smoke` | Open f605 with README replaced by `HOSTILE_README`, then `openPath("README.md")`. Then: `data-view-mode="preview"`; the heading is visible; `window.__f605` is undefined; `auditPreview` is empty on every count; every `a[href]` is `http(s)` with `target=_blank` and `rel` containing `noopener` and `noreferrer`; every `img` is `data:image/`; no request leaves the preview origin; no CSP violation and no console error (`watchForCspViolations`). Tagged `@smoke`, so Firefox and WebKit run it (open point 14). |
| `F-605 AR-32 QA-01: the Markdown preview loads without Monaco, and marked and DOMPurify are not in the initial JavaScript` | No `monacoChunks()` request in Preview; the initial files lack `MARKDOWN_PREVIEW_MARKER` and `MONACO_MARKER`; the chunk holding the marker lacks `MONACO_MARKER`; pressing C loads Monaco. |
| `F-605 FI-30 AR-24 AR-23: an edit to README in Split updates the preview and the saved file, and one undo restores the file byte for byte` | Type a line in Monaco. Expect the preview to show it, `readFile` to equal the edit, and `historyStatus` to read "Edit README.md". Switch to Preview and click Undo: `readFile` is byte-identical to the fixture and the preview reverts. |
| `F-605 FI-30 UX-52: a project link in the preview opens that file in a tab, and a missing one says so` | Activate `docs/usage.md` by click and by Enter: the tab "usage.md" is selected in Preview. A broken link gives the status line and no tab. |
| `F-605 UX-27 UX-70: a Markdown tab switches Preview, Split and Code with the toggle and with G, S and C; a YAML tab has no toggle` | |
| `F-605 FI-32 QA-31: other text files open in Monaco with their extension's language, and an HTML file shows its source without running it` | `conf/params.yml` gives `data-language="yaml"`; `assets/email_template.html` gives `plaintext`, the editor contains `<script>`, and `window.__f605` stays undefined |
| `F-605 FI-31: a .nf file with no workflow opens in Code view with an outline of its declarations in the details pane, and a row shows its declaration in the code` | `lib/samples.nf`; the rows "function", "record" and "enum"; F-309's `data-selection` after activation |
| `F-605 FI-30: the Markdown preview matches its approved baseline @visual` | `.markdown-preview` of the f605 README; the baseline comes from CI only |
| **Step 2** | None in F-605 under open point 1; it moves with its test to the M8 feature. Under option B or C, the test is "a .png from an imported zip is listed in the Files view and activating it opens nothing". |

## 5. Tasks

**Starting point:** branch `feat/F-605` from `main`. Run `pnpm check` before every commit. Export `PW_CHROMIUM_EXECUTABLE` for the end-to-end tests. Tasks 1 to 3 don't depend on F-309; tasks 4 to 7 start once F-309 has merged (open point 8).

1. **The renderer core.**
   - Files:
     - the two dependencies and jsdom;
     - `markdown-policy.ts` and `render-markdown.ts`;
     - their two test files.
   - Done when these pass:
     - `pnpm --filter @nf-builder/web test`;
     - `pnpm check`;
     - `pnpm audit --audit-level high`.
2. **Editor languages.**
   - Files:
     - `file-kinds.ts`, `languages.ts` and `extra-grammars.ts`;
     - `models.ts`, `nextflow-language.ts` and `code-editor.tsx` (`data-language`, `wordWrap`);
     - `file-kinds.test.ts` and `code-languages.test.ts`.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-208|F-209"`, with the baselines unchanged.
3. **The engine outline and the fixture.**
   - Files:
     - `outline.ts`, its types, `service.outline`, the exports;
     - the bridge, workspace and hook;
     - the oracle case and its `cases.yaml` entry;
     - the engine and web tests.
   - Done when these pass:
     - `pnpm oracle -- --case f605-library`;
     - `pnpm --filter @nf-builder/engine test`;
     - `pnpm check`;
     - `pnpm test:e2e -- --grep "F-113|F-202"`.
   - If F-309's `applyFix` is in flight, rebase on it; both changes are additive.
4. **File tabs, opening and modes** (after F-309 merges).
   - Files:
     - `canvas-store.ts` (`openPath`, Markdown mode, closing deleted tabs);
     - `view-mode.ts`, `view-mode-toggle.tsx`, `use-view-mode-keys.ts`;
     - `tab-strip.tsx` and its label;
     - `tab-panel.tsx`, with a placeholder visual pane;
     - the `main.tsx` hook;
     - the `canvas.spec.ts` locators;
     - the unit tests.
   - Done when these pass:
     - `pnpm check`;
     - `pnpm test:e2e -- --grep "F-205|F-208|F-209|F-309"`.
5. **The Markdown pane and preview.**
   - Files:
     - `markdown-pane.tsx`, `markdown-preview.tsx` and `markdown.css`;
     - the TabPanel wiring;
     - `e2e/markdown.ts`;
     - the end-to-end tests for step 1, lazy loading, edit and undo, links, and modes;
     - the IO-41 entries.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-605|F-208|F-209"`;
     - `pnpm smoke`, in under 60 s.
6. **File details** (FI-31 and FI-32).
   - Files:
     - `file-details.tsx` and the `details-pane.tsx` branch;
     - outline rows wired to F-309's `revealCode`;
     - the unit tests, and the end-to-end tests for other text files and FI-31.
   - Done when the task 5 commands pass again, together with `pnpm test:e2e -- --grep "F-206"`.
7. **Visual test.**
   - Files: the `@visual` test.
   - Done when `pnpm check` passes and the PR's Chromium job has run it. The orchestrator then views each `-actual.png` in the `playwright-chromium` artefact and commits it (ADR 0021). CI must then be green, with every earlier baseline unchanged.
8. **Records** (section 7).
   - Done when `pnpm check` and the Scope guard pass, with the `scope-change` label if open point 1 is taken.

## 6. Open points (recommendations only; none decided here)

1. **Binary files and step 2.** Decide and record: scope.
   - **Recommendation:** read FI-32 for v0.1 as "projects hold text files only; imports and uploads list binary files as skipped and never open them". Move step 2 to the M8 "Binary files in projects" feature that F-403's PR adds. If F-403's PR hasn't added it, F-605's PR does.
   - Amend FI-32, record it in the ADR, and use the `scope-change` label.
   - This matches the glossary, ADR 0045 and F-403's settled point 4, and F-605 then carries no dead code.
   - **Option B:** keep step 2 with "ghost" entries.
     - Imports record the binary files they skipped as an optional `ProjectMeta.skipped` field (no version bump under F-401's rule).
     - F-210's tree lists them, tagged "not imported", and activating one shows a notice.
     - This changes a stored format, touches F-403, F-401, F-210 and F-404, and needs F-210 and F-403 in F-605's `depends_on`.
   - **Option C:** bring schema v2 (stored bytes) into v0.1. That reverses F-403's point 4 and is the size of a feature in itself.
   - **Option D:** satisfy step 2 through F-403's import summary. That weakens "in the project" and still needs an ADR.
2. **The renderer.** Decide and record: two new runtime dependencies.
   - **Recommendation:** marked 18.2.1 and DOMPurify 3.4.18, pinned (2.1, 1.3).
   - **Alternatives:**
     - Monaco's copies: DOMPurify 3.4.15 has five advisories, the paths are internal with no types, it can't be updated apart from Monaco, and it would tie the preview to Monaco's internals;
     - micromark: raw HTML in nf-core READMEs would show as text, unless DOMPurify is added as well;
     - markdown-it: 41 kB gzipped;
     - escaping all raw HTML through marked's renderer: simpler, but README logos, `<details>` and centred headers would render as source.
3. **The DOMPurify version.**
   - **Recommendation:** 3.4.18, the newest release without a known advisory. 3.5.0 is a day old, inside Renovate's three-day wait; Renovate moves us to it.
4. **The sanitising rules** (2.2).
   - **Recommendation:** accept them, including the images rule (`data:` only, and nothing fetched), which is stricter than the brief's "same-origin" for the reason given in 2.2.
5. **Project images in the preview.**
   - **Recommendation:** placeholders in v0.1.
   - Note for F-607: FI-54's README embeds `docs/images/metro_map.svg`. It can be shown through a `blob:` URL made from the project text (`img-src` allows `blob:`; an SVG in `<img>` runs no script). Revoke the URL on unmount.
6. **Heading anchors, in-page links and code highlighting in the preview.**
   - **Recommendation:** leave them out. Fragment links are inert. A GitHub-style slug is about 20 lines if wanted later.
7. **Markdown modes and keys** (2.4). This changes user-visible behaviour in the spec.
   - **Recommendation:** Preview, Split and Code, opening in Preview, with G, S and C positional (G picks Preview). F-601 then gets Form on G without clashing with F (fit).
   - Amend UX-27 to list the file-tab modes and the positional keys. UX-70's list stays as it is.
   - **Alternative:** P for Preview. That adds a shortcut, and F-601's Form would have no free mnemonic.
8. **Coordinating with F-309.**
   - F-309 is building file tabs and `revealCode` now, and both features touch `canvas-store.ts`, `tab-panel.tsx`, `tab-strip.tsx`, `code-editor.tsx`, `service.ts`, `engine-client.ts` and `workspace.ts`.
   - **Recommendation:**
     - tasks 1 to 3 run now;
     - tasks 4 to 7 start after F-309 merges;
     - `depends_on` stays unchanged and the dependency is recorded in F-605's notes, as F-309 did for F-206.
   - If F-309 stalls, task 4 builds F-309 plan 2.5 under its names, and F-309 rebases.
9. **The tablist label.**
   - **Recommendation:** "Open workflows and files", UX-20's wording, with the two e2e locators updated. This doesn't weaken them.
10. **How users reach files before F-210.**
    - **Recommendation:** no `depends_on` change. Users reach files through preview links and F-309's problem navigation, and the tests use the hook, as F-207 did with `apply` until F-303.
    - Note for F-210: activating a file in the tree calls `canvasStore.openPath`, and an end-to-end test opens README from the tree.
    - **Alternative:** add F-210 to `depends_on` (`scope-change`). F-605 then waits for F-403 and F-210.
11. **The language set** (2.6).
    - **Recommendation:** the 2.6 table, with the extra grammars loaded in one stage on first use.
    - HTML, CSS, XML, JavaScript and Perl open as plain text, and there is no shebang detection. The ADR names these as later additions.
12. **`EngineApi.outline`.** It amends ADR 0043's API list, so decide and record it.
    - **Recommendation:** accept it.
    - **Alternative:** derive the outline on the main thread. That needs the AST, which stays in the worker under AR-30.
13. **jsdom 31.0.1 as a dev dependency of `@nf-builder/web`,** for the sanitiser unit tests.
    - **Recommendation:** accept. DOMPurify's own tests run on jsdom, while happy-dom is known to diverge.
    - The real-browser check is the step 1 end-to-end test (point 14).
14. **The `@smoke` tag on the step 1 end-to-end test.**
    - **Recommendation:** tag it, because mutation XSS depends on each browser's HTML parser, and only `@smoke` runs in Firefox and WebKit (QA-20). Confirm that `pnpm smoke` stays under 60 s.
15. **AR-30.**
    - **Recommendation:** extend ADR 0048's reading to the preview: it holds its own file's text while mounted. Amend the data-flow sentence in `architecture.md`.
16. **Tab closing.**
    - **Recommendation:** leave it to F-307, with a note. The mockup's × appears on a workflow tab.
17. **A size cap on the preview.**
    - **Recommendation:** none. IO-12 caps text files at 1 MB, and marked and DOMPurify handle that in tens of milliseconds.

**Decide-and-record items (AGENTS.md):**
- **New runtime dependencies:** marked and dompurify (point 2). jsdom is a dev dependency (point 13).
- **Package boundaries and dependency-cruiser:** none.
- **Stored or exported formats:** none, unless option B of point 1 is chosen.
- **Workflows:** none.
- **`features.json`:** step 2 moves (point 1, `scope-change`), and notes are added.
- **ADR interplay:**
  - amends ADR 0043's API list (`outline`);
  - extends ADR 0048 (languages, and its "F-605's sanitiser" clause fulfilled);
  - records the v0.1 binary-file reading of ADR 0045.
- **Spec:** FI-30, FI-31, FI-32, UX-27, and the data-flow sentence in `architecture.md`.
- **Open questions:** none relevant.

## 7. Records (drafts for the orchestrator)

**ADR** (`Accepted (agent)`, the next free number when it lands; 0052 is free on main now, but F-403 and F-309 may take numbers first):
- **Title:** "Preview Markdown with marked and DOMPurify in a lazy chunk, open other project files in Monaco by extension, and keep binary files out of v0.1 projects".
- **It covers:**
  - 2.1 to 2.11;
  - the measurements in 1.3 and 1.5;
  - the sanitising rules, the IO-41 reading of user links, the AR-30 reading, and `EngineApi.outline`;
  - points 1, 2, 3, 7, 11 and 12.
- **It amends** ADR 0043's API list, and extends ADR 0048.
- Add a row to `docs/adr/README.md`.

**Spec:**
- **FI-30:** "`README.md` and other Markdown (`.md`, `.markdown`) open in Preview, with Split and Code. The preview renders GitHub-flavoured Markdown and is sanitised:
  - no scripts, styles, frames, forms or event handlers;
  - external links open in a new tab with `noopener`;
  - links to project files open them;
  - only `data:` images are shown, and others appear as their alt text, so the preview makes no requests (ADR …)."
- **FI-31:** add "Each declaration is listed with its kind, name and line; selecting one shows it in the code."
- **FI-32:** "Everything else that is text opens in Monaco, highlighted by extension; unknown extensions open as plain text (ADR …). In v0.1, projects hold text files only (ADR 0045): imports and uploads list binary files as skipped and never open them. Once projects hold binary files (F-…), the Files view lists them and they don't open."
- **UX-27:** add "Markdown tabs have Preview, Split and Code; other file tabs show code only. G, S and C pick the first, second and third mode of the active tab."
- **`architecture.md`, data flow:** "… file text never sits on the main thread (ADR 0045), apart from open editors and previews (ADRs 0048, …)."

**`docs/licences.md` rows:**
- "marked 18.2.1 | Markdown preview (F-605, ADR …) | MIT | Lazy chunk; F-704 carries the text."
- "DOMPurify 3.4.18 | Markdown preview sanitiser (F-605) | MPL-2.0 OR Apache-2.0, used under Apache-2.0 | includes a regenerator-runtime helper (MIT)."
- The 13 extra Shiki grammars, with each grammar's source and licence from Shiki's grammar list (the builder checks each one).

**`features.json`:**
- **F-605 notes:** "Verified …: step 1 by `e2e/markdown.spec.ts` (also `@smoke` on Firefox and WebKit) and `render-markdown.test.ts`. Step 2 moved to F-… (ADR …). FI-31 by the outline tests on `f605-library`. F-309 is a dependency in practice (file tabs, `revealCode`)."
- **The M8 binary feature:** add the step "A .png in the project is listed in the Files view but not opened".
- **F-210:** activating a tree item calls `openPath`; uploads list skipped binary files; the tablist is "Open workflows and files".
- **F-304:** `registerLanguage` and `data-language`.
- **F-601:** add `[form, split, code]` to `modesFor`, with G, S and C positional.
- **F-602 and F-604:** JSON and YAML are never refused for their content; validation is theirs.
- **F-607:** show project SVGs in the README preview through `blob:` URLs.
- **F-307:** closing file tabs.
- **F-703:** the preview works read-only.
- **F-704:** notices for marked, DOMPurify, regenerator-runtime and the extra grammars.

**Other records:**
- **`progress.md` Decisions:**
  - the ADR and both dependencies;
  - jsdom;
  - the step 2 move;
  - the positional keys;
  - the tablist label;
  - the new baseline.
- **`docs/plan/handoff/README.md`:** an F-605 row and its settled points; delete this plan in the PR that merges F-605.

## 8. Evidence

The scratchpad is `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`. The probes used the node_modules in `/home/user/wt-F-309`, read-only, and saved their results below.

| Probe | Path | Result |
|---|---|---|
| Candidate packages, installed with `--ignore-scripts` | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdpkgs/package.json` | `npm audit`: 0 vulnerabilities (marked 18.2.1, DOMPurify 3.4.18, micromark 4.0.3, markdown-it 15.0.3, jsdom 31.0.1) |
| Bundle sizes (rolldown 1.2.19, minified, gzipped) | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/size.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/size.out` | the table in 1.3 |
| Audit of Monaco's vendored versions | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdaudit/package.json`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdaudit/audit.out` | DOMPurify 3.4.15: five low advisories; marked 14.0.0: none |
| Sanitiser prototype under jsdom | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/sanitise-probe.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/sanitise-probe.out` | 1.4 |
| Shiki grammars on the JavaScript engine | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/shiki-langs.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/shiki-langs.out` | all 14 OK |
| Highlighter creation, one language against fourteen | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/shiki-init.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/shiki-init.out` | 2–4 ms against 38–107 ms |
| Absolute URLs in the marked and DOMPurify bundle | `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/urls.mjs`, `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/mdtools/urls.out` | 2.11 |
| npm metadata (versions, dates, licences), queried 2026-11-23 | `npm view` | 1.3 |

**Files read for the design (main at `d195424`):**
- `apps/web/src/code/{monaco,nextflow-language,models,code-editor,code-pane,text-sync,markers}.ts(x)`;
- `apps/web/src/canvas/canvas-store.ts`;
- `apps/web/src/views/{tab-panel,view-mode,view-mode-toggle,use-view-mode-keys}.ts(x)`;
- `apps/web/src/shell/{tab-strip,left-column}.tsx`, `apps/web/src/details/{details-pane,details-header}.tsx` and `apps/web/src/main.tsx`;
- `packages/engine/src/{service/types.ts,edit/guards.ts,edit/commands/replace-file-text.ts,source/language.ts,source/items.ts}`;
- `packages/lang-core/src/ast/script.ts`;
- `scripts/{non-fetched-urls,check-hosts,check-bundle-budget}.ts` and `scripts/budgets.json`;
- `e2e/{code-view,canvas,csp,projects}.ts` and `e2e/code-view.spec.ts`;
- `playwright.config.ts`, `renovate.json` and `.dependency-cruiser.cjs`.