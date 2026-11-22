# Plan: F-208, view modes Graph, Split and Code per tab, with a lazily loaded Monaco editing the whole file via ReplaceFileText

Written by the planner on 2026-11-22. I changed nothing in `/home/user/wt-main`; it is clean on `main` at `006d570`. Paths below are relative to the repository root. I took measurements in a throwaway clone under the scratchpad (section 8).

## 0. Scope

**In scope:**
- a view mode per tab (`graph`, `split`, `code`), with a toggle and the G, S and C shortcuts (UX-27, UX-70);
- the Split layout: the graph plus live code of the tab's workflow file;
- Code mode: the whole file in Monaco, loaded on first use (AR-32);
- debounced `ReplaceFileText` through one store action. After a valid edit the graph re-projects. A refused edit keeps the user's text, marks its problems inline and shows a status line, and the graph stays unchanged (step 2 and F-111's note);
- the CSP change Monaco needs;
- IO-41 entries;
- Nextflow highlighting with Shiki, if open point 3 is accepted.

**Out of scope:**
- the declaration-only popup editor, Format and hover help (F-304);
- the file's existing engine diagnostics as markers, the Problems panel and the status-bar problem counts (F-304, F-309);
- undo and redo (F-209);
- opening files that are not workflows (F-605, F-210);
- read-only mode below 1024 px (F-703);
- resizing the split (open point 6);
- persisting modes (open point 7).

## 1. Findings

- **Spec:**
  - UX-27: "View mode toggle per tab: Graph, Split (graph plus live code of the workflow's file), Code."
  - AR-32: "Monaco loads lazily on first use of a code view."
  - UX-70: "switch view mode (`G`, `S`, `C`)".
  - AR-30: view modes live in Zustand, and project content does not (the store must hold no file text).
  - AR-24 as read by ADR 0039: "no problem the file didn't have", so `ReplaceFileText` can also repair a broken file.
  - QA-01: Monaco is excluded from the 450 kB budget.
  - ADR 0015: only lazy loading keeps Monaco out of the count.
- **ADRs on the CSP:**
  - ADR 0014 already expected this change: "Monaco (`style-src 'unsafe-inline'`)".
  - ADR 0040 (on main; its code is on `origin/feat/F-011`, not merged) quotes the policy with `style-src 'self'` and says "A loosening is recorded in the PR that needs it". Its single source is `scripts/security-policy.ts`.
  - `cspProblems` restricts script directives and `connect-src`, not `style-src`.
  - `test/security-policy.test.ts` asserts the exact policy string.
- **ADR 0003:** "Monaco with Shiki's Nextflow grammar"; Monaco is lazy-loaded, and phones get read-only mode. `docs/licences.md` has a row for the Nextflow TextMate grammar marked "Check during F-304".
- **What F-208 relies on from other branches:**
  - **Engine API (F-113, `origin/feat/F-113`):**
    - `EngineApi.apply(command, revision): Promise<ApplyOutcome>`.
    - `EngineRefusal {ok: false, revision, code ("stale" | "no-project" | RefusalCode), message, path, problems: ParseProblem[]}`. `revision` here is the project's current revision.
    - `project()` returns `{revision, projection}`.
    - There is no `readFile`. F-202's plan adds `readFile(path): Promise<string | null>`; F-208 adds it with that signature if F-202 hasn't landed.
  - **Edit commands (F-111, on main):** `replaceFileText` diffs the old and new text. `checkResult` refuses `does-not-parse` and `mixed-definitions`, with problems located in the new text. `ParseProblem` columns are 1-based code points with an exclusive end; Monaco columns are UTF-16.
  - **Canvas (F-205 plan):** `workspace-store.ts` with `WorkflowTab {id, path, workflow, label}`, `content`, `openWorkflow` and `selectTab`; `CanvasHost` is the tabpanel. `e2e/canvas.ts` provides `openProject`, `canvasReady` and `node`. The plan notes "F-208: tabs gain a mode" and keeps the toggle area at the top right.
- **Monaco 0.57.0** (MIT, latest; 0.58.0-rc.2 is out):
  - it depends on `marked` 14.0.0 (MIT) and `dompurify` 3.4.15 (MPL-2.0 OR Apache-2.0);
  - `MonacoEnvironment.getWorker` is honoured before its `blob:` fallback;
  - it has no CSP nonce hook;
  - `domStylesheets.js` creates `<style>` elements, and the view parts write `style="top:…"` through innerHTML (`viewLine.js`, `viewOverlays.js`, `lineNumbers.js`, `selections.js`, `viewLineRenderer.js`);
  - subpaths resolve only in the exports-map form `monaco-editor/editor/…js`. `monaco-editor/esm/vs/…?worker` fails in Vite 8.
- **Probes** (main plus Monaco, `vite preview` with the current CSP header, Chromium 1243):

  | What | Result |
  |---|---|
  | Initial JS | unchanged at **77.6 kB gz** (QA-01 passes) |
  | Lean Monaco (`editor.api` plus 15 contributions) | lazy chunk **3,281 kB / 835 kB gz**, CSS 147 kB / 21.6 kB gz, `codicon.ttf` 153 kB, `editor.worker` 304 kB (never started, even after typing) |
  | Full `import("monaco-editor")` | 706 + 326 kB gz of core, about 60 language chunks, and ts/css/html/json workers (ts.worker alone is 6.9 MB); dist grows to 15 MB |
  | `style-src 'self'` | **31 violations**: 2 `style-src-elem` (`monaco-colors` 154 kB and a 1.6 kB sheet, both without a `sheet`) and 29 `style-src-attr`. 31 console errors; the editor is unthemed and the squiggle unstyled |
  | `style-src 'self' 'unsafe-inline'` | **0 violations, 0 console errors**, themed, squiggle rendered, ready about 0.73 s after navigation |
  | `pnpm check:hosts` | 9 URLs in the lean chunk: `code.visualstudio.com/docs/editor/codebasics#_multicursor-modifier` and `#_find-and-replace`; `http://www.w3.org/1999/xhtml`; `github.com/microsoft/monaco-editor#faq`; `github.com/microsoft/vscode/issues/new`; `github.com/microsoft/vscode/blob/main/LICENSE.txt`; `github.com/markedjs/marked.`; `https://microsoft.com`; `github.com/microsoft/vscode/issues/103170` (a CSS comment) |
  | Types | `tsc` passes with `monaco-editor/editor/editor.api.js` and `?worker` (`vite/client` types) |
  | Shiki 4.6.0 (MIT), `@shikijs/monaco` 4.6.0 | the `nextflow` grammar (tm-grammars; from nextflow-io/vscode-language-nextflow@928fc02, **MIT**; it embeds `nextflow-groovy`) compiles with the **JavaScript regex engine, non-forgiving**, in Node. So there is no WASM and no `'wasm-unsafe-eval'`. `shiki/langs/nextflow.mjs` and `shiki/themes/github-light.mjs` exist. Browser size was not measured. |

## 2. Design

### 2.1 Mode state (AR-30)
- **Mode on the tab:** `WorkflowTab` gains `mode: ViewMode`, `"graph"` for new tabs. It is kept per tab for the session, and selecting a tab restores its mode.
- **New store fields and actions:**
  - `revision: number | null`;
  - `lastChange: {revision, paths: readonly string[]} | null`, which holds paths only and never text;
  - `setMode(tabId, mode)`;
  - `apply(command): Promise<ApplyOutcome>`, the single UI path for edit commands, which F-209 later hooks for history:
    1. call `engine.apply(command, revision)`;
    2. on `ok`, set `revision`, the workflows and `lastChange`, then reload the active tab's projection;
    3. on a refusal whose `revision` is newer than the store's, adopt it and reload the projection;
    4. return the outcome.
- **No project:** `apply` returns a `no-project` refusal.

### 2.2 Toggle and shortcuts
- **Toggle:** `ViewModeToggle` sits at the right end of the tab strip for the active tab, and only when a tab is open, so the F-201 baseline is unchanged.
  - It is `role="radiogroup"`, `aria-label="View mode"`, with radios Graph, Split and Code, roving tabindex and arrow keys (the pattern in `left-column.tsx`).
  - Each radio has `aria-keyshortcuts` and a `title` such as "Graph (G)".
  - The toggle stays available when a tab's projection is unavailable, so a broken file can be fixed in Code mode.
- **Shortcuts:** `useViewModeKeys()` adds one document `keydown` listener. `g`, `s` or `c` (either case) set the active tab's mode. The listener ignores:
  - Ctrl, Meta and Alt;
  - repeats;
  - `isComposing`;
  - `defaultPrevented`;
  - editable targets (`input`, `textarea`, `select`, `[contenteditable]`, inside `.monaco-editor`);
  - having no tab open.
- **Leaving Monaco by keyboard:** include the `toggleTabFocusMode` contribution (Ctrl+M). F-701 audits it.

### 2.3 Layouts
- **`TabPanel`** replaces F-205's `CanvasHost` as the `role="tabpanel"`, with `data-view-mode`:
  - Graph shows the canvas;
  - Code shows `CodePane` only. The canvas unmounts and refits when it returns;
  - Split shows them side by side, graph left and code right, in a fixed 50/50 CSS grid with a 1 px divider.
- **Canvas position:** the canvas keeps the same position in the tree in Graph and Split, so switching between them keeps the viewport.
- **`CodePane`** (eager and light) has a header with the file path and a status line (`role="status"`, `data-sync="idle|pending|refused|failed"`). It renders `<Suspense fallback="Loading editor…">` around `lazy(() => import("./code-editor"))`.

### 2.4 Monaco loading and bundle (AR-32, QA-01)
- **`code/monaco.ts`** is imported only by the lazy `code-editor.tsx`. It contains:
  - `import * as monaco from "monaco-editor/editor/editor.api.js"`;
  - the curated contributions: `coreCommands`, `find`, `folding`, `bracketMatching`, `comment`, `hover`, `gotoError`, `clipboard`, `contextmenu`, `multicursor`, `linesOperations`, `wordHighlighter`, `wordOperations`, `indentation`, `cursorUndo`, `toggleTabFocusMode`. These internal paths are pinned by the exact version, and `tsc` fails if one disappears;
  - `import EditorWorker from "monaco-editor/editor/editor.worker.js?worker"` and `globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker({ name: "monaco-editor" }) }`, so there are no `blob:` workers (`worker-src 'self'`).
- **Not `@monaco-editor/react`:** its loader defaults to a CDN (ADR 0002).
- **Models:** one model per path for the session, with a URI such as `nf-builder:/main.nf`, reused by Split and Code. All models are disposed when another project opens.
- **Editor options:**
  - `automaticLayout: true`;
  - `fixedOverflowWidgets: true`;
  - `minimap: {enabled: false}`;
  - `ariaLabel: "Code of <path>"`;
  - `cursorBlinking: "solid"` and `smoothScrolling: false` under `prefers-reduced-motion` (QA-13).

### 2.5 CSP (QA-30): decide and record
- Change `style-src 'self'` to `style-src 'self' 'unsafe-inline'`:
  - in `scripts/security-policy.ts` once F-011 has merged;
  - otherwise in `netlify.toml` and its test, and F-011's merge carries the change across.
- Add a `cspProblems` rule: `style-src` may contain only `'self'` and `'unsafe-inline'`. This keeps any further loosening visible.
- Script directives are unchanged.
- The probe shows that nothing narrower works: Monaco needs both `<style>` elements and inline `style` attributes. Open point 1 has the alternatives and the risk.

### 2.6 Nextflow language
- `code/nextflow-language.ts` registers `nextflow` (`.nf`) with a LanguageConfiguration: comments `//` and `/* */`, brackets, auto-closing and surrounding pairs.
- If open point 3 A is chosen, it also creates `createHighlighterCore({ langs: [shiki/langs/nextflow.mjs], themes: [shiki/themes/github-light.mjs], engine: createJavaScriptRegexEngine() })` and calls `shikiToMonaco(highlighter, monaco)`.
- F-304 reuses the module.

### 2.7 Editing pipeline
- **`createTextSync`** (pure, timers injected) drives the edits:
  1. `edit(text)` re-arms a **300 ms** trailing debounce.
  2. At most one `ReplaceFileText` is in flight. The latest text follows when it settles, and a text equal to the last synced one is not sent.
  3. `flush()` sends at once, on blur, on a mode or tab switch and on unmount.
  4. A `stale` refusal is retried once.
- **Results:**
  - `ok`: `syncedText` becomes the sent text, markers are cleared and the status is `idle`.
  - `does-not-parse` or `mixed-definitions`: the buffer is kept. `problemsToMarkers` sets error markers (owner `nf-builder-refusal`), converting code points to UTF-16 and clamping, but only if the buffer still equals the sent text. The status reads `Not applied: <refusal message> The graph shows the last version that parsed.` Revision and projection are unchanged.
  - Other refusals: status `failed` with the message.
- **External changes:** when `lastChange` includes the pane's path and the change wasn't its own, the pane calls `readFile`.
  - If the buffer is clean (equal to `syncedText`), it applies a minimal prefix/suffix replace with `pushEditOperations`, so the cursor and undo stack are kept.
  - If the buffer is dirty, it keeps the buffer; the next send overwrites the file, so the last writer wins.
- **Unapplied draft:** a refused draft lives in the model for the session (open point 4). On mount, a dirty model re-sends so its markers and status come back.

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `apps/web/src/views/view-mode.ts` | `type ViewMode = "graph" \| "split" \| "code"`; `VIEW_MODES: readonly {mode; label; key: "g"\|"s"\|"c"}[]`; `isEditableTarget(target: EventTarget \| null): boolean`; `viewModeForKey(e: {key; ctrlKey; metaKey; altKey; repeat; isComposing; defaultPrevented; target}): ViewMode \| null` |
| `apps/web/src/views/view-mode-toggle.tsx` | `ViewModeToggle(props: {mode: ViewMode; onChange(mode: ViewMode): void}): JSX.Element` |
| `apps/web/src/views/use-view-mode-keys.ts` | `useViewModeKeys(): void` |
| `apps/web/src/views/tab-panel.tsx` | `TabPanel(): JSX.Element` |
| `apps/web/src/code/code-pane.tsx` | `CodePane(props: {path: string}): JSX.Element` |
| `apps/web/src/code/code-editor.tsx` (lazy) | `default function CodeEditor(props: {path: string; onSync(state: SyncState): void}): JSX.Element` |
| `apps/web/src/code/monaco.ts` (lazy only) | `monaco`; `NEXTFLOW_LANGUAGE_ID = "nextflow"` |
| `apps/web/src/code/nextflow-language.ts` (lazy only) | `registerNextflow(m: typeof monaco): Promise<void>` |
| `apps/web/src/code/models.ts` (lazy only) | `modelFor(m, path, text): {model; synced: {text: string}}`; `disposeModels(): void` |
| `apps/web/src/code/text-sync.ts` | `type SyncState = {status: "idle"} \| {status: "pending"} \| {status: "refused"; message; problems: readonly ParseProblem[]; text} \| {status: "failed"; message}`; `TextSyncOptions {delayMs; send(text): Promise<ApplyOutcome>; onState(s: SyncState): void; timers?}`; `TextSync {edit(text); flush(): Promise<void>; reset(synced: string); dispose()}`; `createTextSync(synced: string, o: TextSyncOptions): TextSync`; `SYNC_DELAY_MS = 300` |
| `apps/web/src/code/markers.ts` | `MarkerSpec {startLineNumber; startColumn; endLineNumber; endColumn; message}`; `problemsToMarkers(problems: readonly ParseProblem[], lineAt: (line: number) => string \| null): MarkerSpec[]` |
| `apps/web/src/code/code.css`, `apps/web/src/views/views.css` | pane, status line, toggle, split grid |
| `apps/web/test/{view-mode,text-sync,markers,view-mode-toggle,tab-panel}.test.ts(x)` | section 4 |
| `tools/oracle/cases/f208-code-edit/**`, `tools/oracle/cases/f208-code-edit-after/**` | a small typed project before the e2e's valid edit, and the same project after it. The builder writes them from the syntax reference and skills and checks them with the oracle. The valid edit adds exactly one modelled statement; the invalid edit is a one-line token that fails to parse. |
| `e2e/code-view.ts` | `MONACO_MARKER` (a Monaco-only string, confirmed in dist, for example the `MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker` message); `monacoChunks(): string[]`; `editor(page)`; `insertAtLineEnd(page, line, text)` (`ControlOrMeta+Home`, `ArrowDown`, `End`, `Enter`, `keyboard.insertText`); `refusalMarkers(page)`; `canvasIds(page)`; `readFile(page, path)` |
| `e2e/view-modes.spec.ts` | section 4 |

### 3.2 Change
- **`apps/web/package.json`:** `"monaco-editor": "0.57.0"`, plus `"shiki": "4.6.0"` and `"@shikijs/monaco": "4.6.0"` if open point 3 A is chosen.
- **`apps/web/src/workspace/workspace-store.ts`** (F-205): `mode`, `revision`, `lastChange`, `setMode` and `apply`. The workspace hook gains `setMode(mode)` and `apply(command)`.
- **`shell/tab-strip.tsx`:** the toggle.
- **`app-shell.tsx`:** `TabPanel` and `useViewModeKeys()`.
- **`canvas/canvas-host.tsx`:** no longer the tabpanel.
- **`readFile`, only if F-202 hasn't landed:** `packages/engine/src/service/{types,service}.ts`, `apps/web/src/engine/engine-client.ts` and `e2e/engine.ts`.
- **CSP:** `scripts/security-policy.ts` and `test/security-policy.test.ts`, or `netlify.toml` and its test before F-011 (2.5).
- **`scripts/non-fetched-urls.ts`:** exact entries for the 9 URLs, each with its reason. `http://www.w3.org/1999/xhtml` may already exist from F-205. The builder re-runs `check:hosts` after Shiki.
- **`packages/engine/test/edit/`:** the fixture test in section 4.
- **Unchanged:**
  - dependency-cruiser (external packages are unrestricted);
  - workflows;
  - persisted formats;
  - the AGENTS.md command table (no new script);
  - the F-201 baseline.

## 4. Tests (write first)

| File: test name | Asserts |
|---|---|
| **engine `test/edit/replace-file-text.test.ts`** (extend) | |
| `F-208 step 2 AR-24 ADR-0039: the f208 invalid edit is refused with does-not-parse and a problem on the edited line; the valid edit is accepted, its text equals f208-code-edit-after, and the projection gains one node` | uses the oracle trees |
| **`test/service/service.test.ts`** (only if F-208 adds `readFile`) | |
| `F-202 F-208 IO-01: readFile returns the current text after open and apply, and null for a missing path or with no project` | |
| **web `view-mode.test.ts`** | |
| `F-208 step 1 UX-70: viewModeForKey maps g, s and c, in either case, to Graph, Split and Code` | |
| `F-208 UX-70: modifier keys, repeats, composition, prevented events and editable targets (input, textarea, contenteditable, .monaco-editor) give no mode` | |
| **`view-mode-toggle.test.tsx`** (static markup) | |
| `F-208 step 1 UX-27 QA-11: the toggle is a radio group "View mode" with Graph, Split and Code, the current mode checked, and G, S, C shortcuts` | |
| **`tab-panel.test.tsx`** | |
| `F-208 UX-27: Graph renders only the canvas, Code only the code pane, Split both with the graph first` | |
| **`workspace-store.test.ts`** (extend; fake EngineApi) | |
| `F-208 UX-27 AR-30: tabs open in Graph mode; setMode changes only that tab, and selecting a tab keeps its mode` | |
| `F-208 step 2: apply sends the command at the current revision, then adopts the new revision, records the changed paths and reloads the active projection` | |
| `F-208 step 2 AR-24: a refused command leaves the revision and projection unchanged` | |
| `F-208: a refusal reporting a newer revision adopts it and reloads the projection` | |
| **`text-sync.test.ts`** (fake timers) | |
| `F-208: an edit is sent once, 300 ms after the last change` | |
| `F-208: one request in flight; the latest text follows when it settles; a text equal to the synced one is not sent` | |
| `F-208 AR-24: a refusal reports its message and problems for the text sent; the next accepted edit returns to idle` | |
| `F-208: a stale refusal is retried once; flush sends at once; dispose cancels the timer` | |
| **`markers.test.ts`** | |
| `F-208 AR-24: parse problems become markers on the same lines, with code-point columns converted to UTF-16` | |
| `F-208: positions beyond the text are clamped` | |
| **root `test/security-policy.test.ts`** | |
| `F-208 QA-30 ADR-<new>: the policy allows inline styles for Monaco and keeps script-src 'self'` | the exact string is updated |
| `QA-30: cspProblems rejects a style-src source other than 'self' and 'unsafe-inline'` | |
| **e2e `view-modes.spec.ts`** | |
| `F-208 step 1 UX-27 AR-30: the toggle switches the active tab between Graph, Split and Code, and each tab keeps its own mode` | two tabs (F-205 `openWorkflow`); `data-view-mode`, `aria-checked`, canvas and editor present or absent |
| `F-208 step 1 UX-70: G, S and C switch the mode; the same letters typed into the editor or the palette search do not` | the editor text gains "gsc" |
| `F-208 step 2 UX-27: in Split mode a valid edit updates the graph` | node count +1, the new node id, status-bar count, `readFile` equals f208-code-edit-after |
| `F-208 step 2 AR-24 ADR-0039: an invalid edit shows a diagnostic and leaves the graph unchanged` | `.squiggly-error` visible, `data-sync="refused"` with the problem text, `canvasIds` and revision unchanged, `readFile` unchanged; removing the token clears the marker |
| `F-208 UX-27: an engine-side change to the file updates an editor with no pending edit` | through `nfBuilderWorkspace.apply` |
| `F-208 AR-32: no Monaco chunk is requested until the first Split or Code view` | requests recorded; `S` triggers the chunk and `.monaco-editor` |
| `F-208 step 3 QA-01 AR-32: Monaco is absent from the initial JavaScript and present in a lazy chunk` | Node only, the `parser-chunk.spec.ts` pattern (`initialJsFiles` and `MONACO_MARKER`); CI's `budget` job report is the bundle report |
| `F-208 QA-30 UX-27: Code mode shows Monaco with no CSP violation or console error @smoke` | also runs on Firefox and WebKit |
| `F-208 UX-27: Split and Code views of the f208 fixture match their approved baselines @visual` | editor blurred, `.cursors-layer` masked; baselines from CI only |

## 5. Tasks

Branch `feat/F-208`, after F-205 merges. Run `pnpm check` before every commit.

1. **Fixture and engine checks** (plus `readFile` if F-202 hasn't merged).
   - Files: the two oracle cases and `cases.yaml` entries; the engine test; `readFile` and its test.
   - Done when `pnpm oracle -- --case f208-code-edit --case f208-code-edit-after`, `pnpm --filter @nf-builder/engine test` and `pnpm check` pass.
2. **Modes without Monaco.**
   - Files: `view-mode.ts`, the toggle, the keys hook, `TabPanel` and `CodePane` with its Suspense placeholder, and the store's `mode` and `setMode`; their unit tests and the two step 1 e2e tests (asserting the code pane rather than `.monaco-editor`).
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-208 step 1|F-205|F-201"` pass.
3. **Monaco and CSP.**
   - Files:
     - the dependency;
     - `monaco.ts` (lean), the worker, `models.ts`, and a `code-editor.tsx` that shows the file from `readFile`;
     - the CSP change and its tests;
     - the IO-41 entries;
     - the AR-32, step 3 and @smoke e2e tests.
   - Done when:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts` pass;
     - `pnpm audit --audit-level high` passes;
     - `pnpm test:e2e -- --grep F-208` passes;
     - `pnpm smoke` stays under 60 s.
4. **Editing.**
   - Files: `text-sync.ts`, `markers.ts`, the store's `apply`, `revision` and `lastChange`; the status line; the external-update path; the workspace-hook additions; their unit tests and the step 2 and external-change e2e tests.
   - Done when `pnpm check` and `pnpm test:e2e -- --grep "F-208|F-205"` pass.
5. **Highlighting** (only if open point 3 A is chosen).
   - Files: Shiki, `nextflow-language.ts`, and an e2e assertion that a keyword and an identifier get different token classes.
   - Done when the task 3 commands pass again.
6. **Visual tests.**
   - Files: the `@visual` test.
   - Done when `pnpm check` passes and the PR's Chromium job runs the test. The orchestrator then views each `-actual.png` from the `playwright-chromium` artefact and commits it (ADR 0021). That includes re-approving F-205's centre-column corpus baselines, which now show the toggle.
7. **Records** (section 7).
   - Done when `pnpm check` passes.

## 6. Open points (none decided here)

1. **CSP loosening.** Decide and record: it contradicts ADR 0040's literal policy line, so a new ADR amends that line.
   - **Recommendation:** accept `style-src 'self' 'unsafe-inline'`, add the `cspProblems` style rule, and amend QA-30 with "styles allow `'unsafe-inline'`, which Monaco needs (ADR …)".
   - **Risk:** CSS injection. CSS-based data leaks are already blocked: `url()` loads fall under `img-src`, `font-src` and `connect-src`, which stay strict, and React escapes text. F-605's markdown sanitiser must strip `<style>` and `style` attributes (note for F-605).
   - **Rejected alternatives:**
     - a constructable-stylesheet shim (fixes `<style>` but not the 29 inline attributes);
     - patching Monaco (fragile);
     - a nonce (a static site can't rotate one, and Monaco has no hook);
     - a sandboxed iframe with its own policy (the frame guard, messaging and focus make it heavy);
     - CodeMirror 6 (works under the strict policy, but supersedes ADR 0003's choice, which the maintainer asked for).
2. **`monaco-editor` 0.57.0.** Decide and record: a new runtime dependency.
   - **Recommendation:** pin it exactly; lean imports (835 kB gz lazy, compared with over 1 MB gz plus 9 MB of workers for the full import); no React wrapper.
   - **Licences row:** Monaco bundles DOMPurify (MPL-2.0 OR Apache-2.0, take Apache-2.0) and its `ThirdPartyNotices.txt`. Notices page for F-704.
   - Let Renovate bring 0.58.
3. **Highlighting now or in F-304.** Decide and record: dependencies.
   - **A (recommended):** `shiki` 4.6.0 with `@shikijs/monaco` 4.6.0, the JavaScript regex engine (no `'wasm-unsafe-eval'`) and the `github-light` theme (comments #6A737D on white are 4.8:1, which meets QA-13). This settles the licences row "Check during F-304" as MIT (vscode-language-nextflow@928fc02), and F-304 reuses the module.
   - **B:** language id, brackets and comments only; Shiki arrives with F-304. Skip task 5.
4. **Spec gap: refused text.** ADR 0004 says code is never lost; AR-24 refuses unparseable text before it touches any file.
   - **Recommendation:** keep the draft in the session model (marked, with a status line); the graph and the saved file stay at the last parsed version. Record that a reload loses an unapplied draft, and clarify UX-27.
5. **Debounce 300 ms,** flushed on blur, mode switch and tab switch. The spec is silent. **Recommendation:** accept.
6. **Split layout:** graph left, code right, fixed 50/50, no resizing in F-208.
   - **Recommendation:** accept. Resizing later, if persisted, changes the `nf-builder:layout` format (ADR 0021), which is decide-and-record.
7. **Mode persistence.** **Recommendation:** per tab, for the session only (AR-30). Persisting it is a stored format.
8. **Shortcut scope** as in 2.2; from inside Monaco, use Ctrl+M and then Tab. **Recommendation:** accept, with a note for F-701.
9. **Which diagnostics show.** **Recommendation:** only the refusal's problems, as markers and the status line. The file's engine diagnostics are F-304's (inline) and F-309's (panel and counts). F-309 decides whether pending-edit errors are listed.
10. **External changes and undo.** A clean buffer follows the engine; a dirty one is kept and wins on its next send. Monaco's own undo stays local to the editor.
    - **Recommendation:** accept, with a note for F-209 on how Ctrl+Z in the editor relates to project undo.
11. **Step 3 evidence.** **Recommendation:** the Node-side marker test plus CI's `check:budget` report. Add no new budget machinery.
12. **Interplay with other features:**
    - if F-202 has merged, add `F-208 IO-01: a Code view edit survives a reload` (F-202's note);
    - if F-011 hasn't merged, the policy change goes in `netlify.toml`, and F-011's merge carries it;
    - Monaco read-only below 1024 px is a note for F-703.

**AGENTS.md decide-and-record items:**
- **New runtime dependencies:** points 2 and 3.
- **Contradicts an accepted ADR:** ADR 0040's policy line (point 1).
- **Spec behaviour:** QA-30, and UX-27 (points 4 and 6).
- **None:** package boundaries, workflows, persisted or exported formats, `features.json` beyond notes.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number): "Code view: lean Monaco 0.57 loaded on first use, inline styles allowed for it, Shiki Nextflow highlighting, debounced whole-file ReplaceFileText".
  - It covers points 1 to 11 and the probe numbers, and amends ADR 0040's policy line.
  - Add a row to `docs/adr/README.md`.
- **Spec:**
  - `quality.md` QA-30: the style clause;
  - `ux.md` UX-27: side-by-side Split; a refused edit keeps its text and errors, and the graph is unchanged.
- **`docs/licences.md`:** resolve the Nextflow TextMate grammar row (MIT, source and commit); add a Monaco row (bundled DOMPurify and marked; ThirdPartyNotices for F-704).
- **`features.json` notes:**
  - **F-208:** "Verified …: steps 1 and 2 by `e2e/view-modes.spec.ts`, step 3 by its Node-side test and the `budget` job's report".
  - **F-209:** `workspace.apply` is the single path; Monaco undo is local.
  - **F-304:** reuse `code/monaco.ts`, `nextflow-language.ts` and `markers.ts`.
  - **F-309:** refusal problems are transient.
  - **F-605:** the sanitiser strips `<style>` and `style` attributes; reuse Monaco.
  - **F-701:** Ctrl+M; G, S and C are done.
  - **F-703:** Monaco read-only.
- **`progress.md` Decisions:** the dependencies, the CSP loosening, the IO-41 entries, the spec clarifications, and the `readFile` addition if F-208 made it.

## 8. Evidence

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`

| Probe | Path |
|---|---|
| Clone with Monaco and the lazy probe (`apps/web/src/code/monaco-lean.ts`, `code-probe.tsx`, `app-shell.tsx` edited); builds, `check:budget`, `check:hosts` | `mon/`, logs in `mon-build-lean.log` and `mon-build-full.log` |
| CSP probes: strict, then with `'unsafe-inline'` (`netlify.toml` edited in the clone; the original is in `mon-netlify.orig`) | `monpw/probe.mjs`, `monpw/type.mjs`, screenshots `monpw/strict.png` and `monpw/inline.png` |
| Monaco 0.57.0 tarball (CSS and nonce source reading) | `monaco-dl/x/package/` |
| Shiki JavaScript-engine Nextflow check | `shiki-scripts/try.mjs`, run against `shiki-try/` |
