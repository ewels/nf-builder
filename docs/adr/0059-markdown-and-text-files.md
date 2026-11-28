# 0059. Preview Markdown with marked and DOMPurify in a lazy chunk, open other project files in Monaco by extension, and keep binary files out of v0.1 projects

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

FI-30 asks for a sanitised Markdown preview next to the code, FI-31 for an outline of `.nf` files that hold no workflow, and FI-32 for every other text file in Monaco with its language taken from the extension, and for binary files to be listed but not opened. QA-31 says imported files are never executed.

Before F-605:
- File tabs (ADR 0054) showed code only, highlighted as Nextflow whatever the file was.
- The page had no Markdown renderer. Monaco bundles copies of marked 14.0.0 and DOMPurify 3.4.15, but they are internal, untyped and can't be updated apart from Monaco, and that DOMPurify has five low advisories.
- Projects hold text files only (ADR 0045). Imports skip binary files and list them in their summaries (ADRs 0053, 0055 and 0057), and F-407, a deferred M8 feature, owns schema v2 with stored bytes.
- Read-only below 1024 px (ADR 0056) shows "canvas and details only"; a file tab shows a note.

nf-core READMEs use raw HTML (`<h1><picture>`, `<details>`, `<p align>`), so escaping it would show logos and headers as source.

Measurements (the F-605 plan, sections 1.3 to 1.5): marked 18.2.1 and DOMPurify 3.4.18 together are about 28 kB gzipped and `npm audit` finds nothing in either; markdown-it is 41 kB; micromark would need DOMPurify as well. The 13 extra Shiki grammars are 34 kB gzipped and all work on the JavaScript regex engine. Creating the highlighter with one grammar takes 2 to 4 ms, with fourteen 38 to 107 ms.

Research: the F-605 plan (deleted in the F-605 PR; see `docs/plan/handoff/README.md`).

## Decision

- **Dependencies.** `marked` 18.2.1 and `dompurify` 3.4.18, pinned exactly, as runtime dependencies of `@nf-builder/web`, with their own DOMPurify instance (`createDOMPurify(window)`, no global hooks), separate from Monaco's copy. `jsdom` 31.0.1 as a dev dependency of `@nf-builder/web` for the sanitiser unit tests. Licence rows are in `docs/licences.md`; F-704 carries the texts.
- **Where it runs.** The renderer runs on the main thread, in a lazy chunk loaded on the first Preview or Split view of a Markdown tab, because DOMPurify needs a DOM and the worker has none. The chunk imports nothing from `code/`, so Preview never loads Monaco (AR-32, QA-01).
- **Render pipeline** (`apps/web/src/markdown/render-markdown.ts`):
  1. `new Marked({gfm: true, breaks: false})`, synchronous, GitHub-flavoured.
  2. A raw-HTML pre-filter in marked's `html` renderer removes `on*` attributes and `<base>` from raw-HTML tokens only. It exists only to stop Chromium logging CSP reports for markup that would be blocked anyway. DOMPurify stays the sanitiser: a miss in the pre-filter means a blocked and reported attempt, never execution.
  3. The HTML is parsed into an inert document, the content document of a `<template>`, with `Range.createContextualFragment`. That document has no browsing context and no policy, so nothing in it runs or fetches. `DOMParser` is not used, because Chromium logged CSP reports under the page's policy for the markup it parsed.
  4. DOMPurify cleans that tree with `IN_PLACE: true`, using the rules below.
  5. Links, images and inputs are rewritten on the cleaned tree, not in DOMPurify hooks.
  6. The nodes are imported into the page's document and appended with `replaceChildren`. No HTML string reaches the page: nothing uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML` or `document.write`.
- **`IN_PLACE` rather than `RETURN_DOM_FRAGMENT`.** The plan had rejected `IN_PLACE` over the 2026 advisories and chosen `RETURN_DOM_FRAGMENT`. As built, `RETURN_DOM_FRAGMENT` re-parses through `DOMParser`, which brings the CSP reports back. DOMPurify 3.4.18 hardens `IN_PLACE`: it refuses a forbidden root, tracks the nodes it has visited, and throws rather than return a half-cleaned tree. The root is our own `div`, and we still use no hooks.
- **Sanitising rules** (QA-31):
  - Allowed elements: `a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em h1`–`h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var`.
  - Allowed attributes: `href title alt src align colspan rowspan scope open checked disabled type start reversed id name lang dir width height`.
  - `ALLOW_DATA_ATTR` and `ALLOW_ARIA_ATTR` off; `FORBID_TAGS` `style script source`; `FORBID_ATTR` `style class`. Every element that runs code, loads, submits or restyles, every event handler, and every attribute that makes the browser fetch is dropped. Dropping `class` also stops content borrowing the app's classes.
  - `SANITIZE_NAMED_PROPS` on, so `id` and `name` values are prefixed `user-content-` and can't clobber the page's globals or ids.
- **Links** (`markdown-policy.ts`):
  - `http:` and `https:` open in a new tab with `rel="noopener noreferrer"` and visually hidden text "(opens in a new tab)"; `mailto:` gets the same `rel` and no `target`.
  - A relative path resolves against the Markdown file's folder (a leading `/` means the project root; query and fragment dropped) and becomes a focusable `role="link"` with `data-path` and no `href`; activating it opens the file through `openPath`, and a missing file says so in the status line.
  - Fragments, protocol-relative URLs, any other scheme, paths that leave the project, and any link containing a backslash lose their `href` and are inert text.
  - **IO-41:** opening a user's link in a new tab is navigation the user starts, not a request by the app, as with the React Flow attribution link.
- **Images.** Only `data:image/(png|gif|jpeg|webp|avif|svg+xml)` stays as an image. Any other source, remote or project-relative, becomes a placeholder `[alt]` with "Image not shown: <src>" as its title. The preview therefore makes no request at all. This is stricter than "data: and same-origin": same-origin would mean the app's own assets, never the project's files. Showing project images through `blob:` URLs is left to F-607.
- **Inputs.** Only checkboxes survive, forced to `disabled`.
- **No heading anchors, in-page links or code highlighting** in the preview in v0.1, and no size cap beyond IO-12's 1 MB per text file.
- **AR-30 extended to the preview.** Like an open editor model (ADR 0048), a mounted preview holds its own file's text on the main thread; the stores still hold paths only. It renders again when `lastChange.paths` includes its path, and drops results for an older session or read.
- **Modes and keys** (UX-27). `ViewMode` gains `preview`. Markdown tabs (`.md`, `.markdown`, matched case-sensitively as AR-01's `languageOf`) have Preview, Split and Code and open in Preview; other file tabs show code only, with no toggle. G, S and C pick the first, second and third mode of the active tab, so G is Preview on a Markdown tab. Modes are kept per tab for the session; nothing is stored. F-601 adds Form, Split and Code for configs the same way.
- **Opening files.** `canvasStore.openPath(path)` opens a file that holds a workflow in its workflow tab and any other file in a file tab, or answers `missing`. Preview links, the Files view (F-210) and the test hook use it. A file tab whose file is deleted closes. `README.md` opened from the Files view now opens in Preview (F-210's end-to-end test updated).
- **Other text files in Monaco** (FI-32). The language comes from the extension: Nextflow (`.nf`, `.config`), Groovy (`nf-test.config`, `.nf.test`, `.groovy`), JSON (`.json`, `.snap`), YAML (`.yml`, `.yaml`, `.cff`), Markdown, shell, Python, R, TOML, INI, CSV, TSV, diff and Mermaid (`.mmd`); anything else, including HTML, SVG, XML, `.txt`, `LICENSE` and `.gitignore`, opens as plain text and is never rendered. The extra grammars load in one lazy chunk on the first non-Nextflow file, with a second and last `shikiToMonaco` call. Markdown and plain text wrap. HTML, CSS, XML, JavaScript and Perl highlighting and shebang detection are later additions. JSON, YAML and Markdown are never refused for their content; validation belongs to F-602 and F-604.
- **Outline** (FI-31). `EngineApi.outline(path)` returns `{revision, items}` for a Nextflow script: each top-level declaration's kind, name, a detail capped at 80 characters, line and range, never its text. It amends ADR 0043's API list. A `.nf` file with no workflow opens code-only and the details pane lists its declarations under "Declarations"; a row reveals the declaration in the code. Other files show their path and language name.
- **Read-only below 1024 px** (amends ADR 0056). A Markdown tab shows the sanitised preview only, with no toggle; Monaco stays unmounted. Other file tabs keep the note. Outline rows are plain text, since nothing reveals code in read-only. This amends ADR 0056's "canvas and details only" and its rule that a file tab shows the note.
- **Binary files in v0.1** (FI-32, reading ADR 0045). Projects hold text files only. Binary files are listed where they are dropped (the import and add summaries) and never opened, because they are never stored. F-605 adds no binary code path. F-605's step 2, "A .png in the project is listed but not opened", moves to the deferred M8 feature F-407 "Binary files in projects" (ADR 0030), which stores binary files and lists them in the Files view without opening them.
- **Tests.** The step 1 end-to-end test (a hostile README with scripts, event handlers, frames, objects, forms, SVG, MathML, styles, a `<base>` tag and remote images) is tagged `@smoke`, so Firefox and WebKit run it too: mutation XSS depends on each browser's parser. The `markdown-preview` baseline is approved from CI (ADR 0021).

## Consequences

- A README previews as on GitHub, logos and `<details>` included, with no script, no styling from the content, no request and no CSP report.
- Two runtime dependencies to keep current; Renovate moves DOMPurify on after its waiting period. Monaco's internal copies stay as they are and are not used.
- The preview chunk and the extra grammars keep the initial JavaScript within QA-01; an end-to-end test checks that Preview loads no Monaco and that the initial chunk holds neither.
- Project images and badges show as placeholders until F-607 adds `blob:` images.
- Step 2 waits for F-407, past v0.1.
- Read-only visitors can read Markdown, so the read-only screen is no longer canvas and details only.

## Alternatives

- **Monaco's bundled marked and DOMPurify:** internal paths with no types, tied to Monaco's version, and that DOMPurify has advisories.
- **micromark:** raw HTML would show as text unless DOMPurify were added too.
- **markdown-it:** 41 kB gzipped.
- **Escaping all raw HTML:** simpler, but nf-core READMEs would show their headers as source.
- **`RETURN_DOM_FRAGMENT`:** re-parses through `DOMParser` and brings back the CSP reports.
- **`DOMParser` for the first parse:** Chromium logs CSP reports under the page's policy.
- **Same-origin images:** would only ever show the app's own assets, and project-relative paths would 404 against the site.
- **P for Preview:** adds a shortcut and leaves F-601's Form with no free key.
- **Ghost entries for skipped binary files, or schema v2 in v0.1:** change a stored format and touch four features, or reverse ADR 0053's decision.
- **An outline built on the main thread:** needs the AST, which stays in the worker (AR-30).
- **Hiding Markdown in read-only:** the preview edits nothing, and reading a README is useful on a phone.
