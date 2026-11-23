# 0048. Edit code in a lazily loaded Monaco with Shiki highlighting, allowing inline styles in the policy

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

UX-27 asks for Graph, Split and Code view modes per tab, and ADR 0003 names Monaco for the code view and Shiki for highlighting. AR-24 sends every text edit through the engine as a command, and AR-30 keeps file text out of the main-thread store. QA-01 caps the initial JavaScript. ADR 0040 set a strict meta-element policy with `style-src 'self'`. ADR 0014 had expected Monaco to need inline styles and Shiki to need `'wasm-unsafe-eval'`. A probe under the strict policy found 31 violations from Monaco 0.57.0: 2 `style-src-elem` (its injected `<style>` sheets) and 29 `style-src-attr` (`style=` attributes written through `innerHTML`). Monaco has no nonce hook. With `'unsafe-inline'` for styles there were none. Research: the [F-208 plan](https://github.com/ewels/nf-builder/blob/ce1c450/docs/plan/handoff/plan-F-208.md).

## Decision

- **Policy.** This amends ADR 0040's policy bullet. The policy becomes:

  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`

  The rest of ADR 0040 stands.
  - Only styles are loosened. `default-src`, the script directives, `worker-src`, `img-src`, `font-src` and `connect-src` are unchanged, and QA-30's "no inline scripts" keeps its meaning.
  - There is no `'wasm-unsafe-eval'`: Shiki runs on its JavaScript regex engine.
  - `cspProblems` allows only `'self'` and `'unsafe-inline'` in `style-src`, `style-src-elem` and `style-src-attr`. A nonce or hash is rejected, because its presence would switch `'unsafe-inline'` off.
  - Accepted risk: CSS injection. React escapes text, and `url()` and fonts stay under the strict `img-src` and `font-src`, so injected CSS can't reach other hosts. Any HTML the app renders from user content strips `<style>` elements and `style` attributes (F-605's sanitiser).
  - Embedding is unaffected (ADR 0044).
- **Dependencies.** Three runtime dependencies of `@nf-builder/web`, pinned: `monaco-editor` 0.57.0 (MIT), `shiki` 4.6.0 and `@shikijs/monaco` 4.6.0 (MIT).
  - Monaco uses lean imports: the editor API plus the contributions the view needs. There is no React wrapper: `@monaco-editor/react` loads Monaco from a CDN, against ADR 0002.
  - Monaco's editor worker is a bundled module worker returned by `MonacoEnvironment.getWorker`, never a `blob:` URL, so it runs under `worker-src 'self'` and in frames.
  - Highlighting uses Shiki's `nextflow` grammar and the `github-light` theme through `@shikijs/monaco`. If Shiki fails to initialise, the editor opens with plain text. If the Code view's chunk fails to load, the pane says so and the rest of the app keeps working, as the canvas does (ADR 0046).
  - Size: the Code view is a lazy chunk of about 900 kB gzipped, plus its CSS, worker and codicon font, all outside QA-01. An end-to-end test checks that Monaco never enters the initial JavaScript.
- **Editing (AR-24).**
  - Typing sends `ReplaceFileText` after a 300 ms pause, when the editor loses focus, and when the mode or tab changes.
  - A `stale` refusal is retried once at the new revision.
  - A refused edit keeps its text in the editor, marked with the refusal's problems and a status line. The graph and the saved file stay at the last version that parsed. The draft lasts for the session only, so ADR 0004's "code is never lost" is read as "the stored file is never overwritten by text that didn't parse".
  - A clean buffer follows changes made elsewhere; a buffer with an unsent or refused draft keeps it.
  - Drafts belong to one project: opening another project disposes every editor model, drops unsent text and refuses commands queued for the old project.
- **AR-30 reading.** Editor models hold the open files' text on the main thread, as any editor must. The Zustand stores still hold no file text: `lastChange` carries paths only.
- **Modes.** The toggle is a radio group in the tab strip, with G, S and C as shortcuts outside text fields, the editor and dialogs (UX-70). Modes are kept per tab for the session. Split is a fixed half-and-half layout. The graph re-fits whenever its pane changes size, as on a mode switch or a window resize, which resets the user's pan and zoom; F-207 may refine this. The editor highlights the current line only while it has focus.
- **IO-41.** Eight URLs in Monaco's chunk (messages, product configuration, a markdown helper, a console warning and a CSS comment) are listed in `scripts/non-fetched-urls.ts`; none is fetched.

## Consequences

- F-304 and F-605 reuse the Monaco loader, the language registration and the marker code. Refusal markers have their own owner, so the file's own diagnostics can use another.
- F-209's undo goes through the same `apply` path as the editor, and Monaco's own undo stays local to the editor.
- F-704's notices page must carry the texts for Monaco, its bundled DOMPurify and marked, the codicons and the grammars, because the minified chunk drops their licence comments.
- A future HTML-rendering feature must strip styles, or the CSS-injection risk grows.

## Alternatives

- **A constructable-stylesheet shim or a patched Monaco:** fragile across Monaco releases.
- **Nonces or hashes:** a static site can't mint nonces, and Monaco's attributes change at run time.
- **A sandboxed iframe for the editor:** adds a messaging layer for every keystroke.
- **CodeMirror 6:** no inline styles needed, but it would supersede ADR 0003 and lose Monaco's editing features.
- **Shiki's Oniguruma WebAssembly engine:** needs `'wasm-unsafe-eval'`; the JavaScript engine handles the Nextflow grammar.
