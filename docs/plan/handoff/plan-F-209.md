# Plan: F-209, undo and redo across all edit commands, one step per command

Planner output, 2026-11-22. I changed nothing in `/home/user/wt-main` (`main` at `874ddf3`).

**What I read:**
- F-209 and its neighbours in `features.json`: F-111, F-113, F-202, F-205, F-207, F-208, F-301, F-309 and F-310.
- AR-23 and AR-30 (`architecture.md`), UX-26 and UX-70 (`ux.md`), `files.md` line 3.
- ADRs 0004, 0008, 0039 and 0043.
- Plans `plan-F-202.md`, `plan-F-205.md`, `plan-F-207.md` and `plan-F-208.md`, plus `handoff/README.md` (settled points).
- Code on `main`: `packages/engine/src/{edit/apply.ts,edit/patches.ts,service/*}`, `apps/web/src/engine/*` and the edit test harness.
- Branches: `origin/feat/F-202` (`workspace.ts`, `types.ts`, engine `readFile` and `close`) and `origin/feat/F-205` (`workspace-store.ts`, `tab-strip.tsx`).

## 0. Scope

**In:**
- An undo and redo history for every `EditCommand` (the seven F-111 kinds now; AR-21's later kinds join automatically).
- One step per command, plus grouped steps for F-301 and F-310.
- Undo and redo are autosaved.
- Undo and Redo buttons, platform shortcuts, and how they interact with Monaco.
- History limits.

**Out:**
- Undoing node moves and auto-layout (F-207 settled that they aren't undoable in v0.1).
- Undoing raw file writes (open point 3).
- Keeping the history across a reload.
- Any UI that issues grouped commands (F-301, F-310).

## 1. Findings that shape the design

1. **AR-23:** "Every command is one undo step. Undo restores exact bytes." ADR 0004: "Undo restores the previous file snapshot." `files.md`: edits "go through edit commands, so undo and autosave behave the same everywhere". ADR 0039: "patches and inverses live in memory only". It credits history to F-207 by mistake; F-207's ADR corrects that.
2. **AR-30 keeps file text out of the main thread:** "Project content lives only in the engine and IndexedDB". F-208 reads this as "the store must hold no file text". Patches and inverses do hold file text: a `delete` inverse holds the whole file.
3. **The F-111 grouping note doesn't work as written.** F-301 and F-310 say "concatenating the inverses in reverse". But `applyPatches` (`patches.ts:24`) throws `PatchError("Two patches for <path>")` when a list patches the same path twice. CreateProcess followed by AddCall patches `main.nf` twice. So a group has to be applied as a **sequence** of patch lists.
4. **The service already has what undo needs** (`service.ts`):
   - `applyPatches` runs `patchResult` (no AR-24 guard) and then `accept`;
   - each change advances `revision` by 1;
   - `stale` and `no-project` refusals already exist;
   - a throw after a write has started moves the revision on.

   `ReplaceFileText` with unchanged text gives `patches: []` but still advances the revision.
5. **F-202 (branch):** the workspace runs in the worker and wraps the engine. `change()` autosaves the `files` of any successful result. Because `WorkspaceApi extends EngineApi`, new engine methods must be added to the workspace, and the compiler enforces it.
6. **F-207 (plan, settled):**
   - the sidecar is carried in the service's `accept`, `applyPatches` and `writeFiles`;
   - it is never in patches;
   - `setLayout` doesn't advance the revision;
   - a removed-positions memo lets "undoing a DeleteNode leave the sidecar byte-identical".
7. **F-208 (plan, settled):**
   - `workspace.apply(command)` is the single UI path;
   - the store holds `revision` and `lastChange` (paths only);
   - `TextSync.flush(): Promise<void>` exists;
   - `isEditableTarget` covers `.monaco-editor`;
   - a clean editor buffer follows engine changes through `pushEditOperations`;
   - Monaco's undo stays local to the editor (open point 10, accepted).
8. **Dependency gap.** F-209 lists only F-208, but autosave is F-202's, and F-202 isn't upstream of F-208. F-309 step 2 needs undo but doesn't depend on F-209 (open point 9).

## 2. Design

### 2.1 Where history lives: the engine worker, inside the engine service

The service owns a `History` per open project. Undo and redo apply the recorded lists through the same `patchSequence` → commit path that `applyPatches` uses. That is the F-113 note's mechanism, moved behind the bridge.

**Why the worker:**
- **(a) AR-30:** patches carry file text, which must not sit on the main thread.
- **(b) Revisions:** the service sees every revision change (`writeFiles`, internal failures, `open`, `close`). It can therefore guarantee that a step is only ever applied to the bytes it was recorded on. A main-thread stack can't see changes made elsewhere (for example through `window.nfBuilderEngine`).
- **(c) Atomic groups:** a grouped step applies as one change: one revision, one re-model, one F-207 carry, one autosave.
- **(d) No new autosave code:** undo and redo results go through F-202's `change()`.
- **(e)** Patches cross the bridge once.

**Cost:** `EngineApi` gains three methods and an optional argument, which amends ADR 0043's API list (open point 1).

### 2.2 Step model
- **Step contents:** a step is `{label, group, parts: StepPart[], units}`, where each `StepPart` is one accepted command's `{patches, inverse}`.
- **One command, one step.** An accepted `apply` with non-empty patches pushes a step and clears the redo stack.
- **Empty commands:** a command with empty patches records nothing and leaves both stacks alone.
- **Undo** applies the top step's part inverses, newest first, as a sequence. **Redo** re-applies its parts' original `patches`, oldest first. After an undo the bytes are exactly the pre-command bytes, so the stored patches and inverses stay valid indefinitely.
- **Groups (F-301, F-310):**
  - `apply(command, revision, {group, label})`. When `group` equals the history's open group, the command's part is appended to the top step instead of starting a new one.
  - The group stays open until anything else happens: another `apply` without that group, an undo, a redo, a raw write, `open` or `close`. Refusals and no-op commands don't close it.
  - The step's label is the first command's `label` option, otherwise `commandLabel(command)`.
  - Each grouped command is committed before the next one is built, so F-310 can re-resolve node ids between deletes.
  - If a command in a group is refused, the group keeps what was applied; F-301 and F-310 roll back with one `undo`.
- **`patchSequence(model, lists)`:**
  - applies the lists in order to copies of the current texts and returns each touched path's final `FileText`;
  - a path that is absent at both ends is omitted;
  - it throws `PatchError` before anything is written, which keeps undo atomic.
- **Labels** (`commandLabel`, British English, sentence case):

  | Command | Label |
  |---|---|
  | createProcess | `Create process REPORT` |
  | addCall | `Add call to ALIGN` |
  | connect | `Connect` |
  | disconnect | `Disconnect` |
  | deleteNode | `Delete node` |
  | renameDeclaration | `Rename COUNT to COUNT_LINES` |
  | replaceFileText | `Edit main.nf` |

  Steps keep labels, not commands, because a `ReplaceFileText` command would duplicate a whole file.

### 2.3 Refused and stale undo

**Engine** (`undo(revision)` and `redo(revision)`):

| Case | Result | History |
|---|---|---|
| No project | `no-project` | none |
| `revision` isn't current | `stale` (the existing message); nothing changed | unchanged |
| Empty stack | `no-history`: "There is nothing to undo." / "…to redo."; nothing changed | unchanged |
| `PatchError` (history out of step; only a bug can cause it) | `internal`: "Undo failed (…). Nothing was changed, and the undo history was cleared." | cleared; revision unchanged |
| Throw after commit started | the existing `guarded` path (revision moves on) | cleared |

- **No AR-24 or LA-13 guard on undo or redo.** Undo restores bytes that already existed, and ADR 0039 says pre-existing problems don't block. Redo replays a guarded result on identical bytes. So a `ReplaceFileText` that repaired a broken file can be undone back to the broken text.

**Main thread:**
- Buttons are disabled when the matching count is 0.
- On any refusal the store does three things:
  1. adopts a newer `revision` and reloads the projection;
  2. refreshes the status with `history()`;
  3. puts the message in the history live region.
- There is **no automatic retry**: after a stale refusal the top step may no longer be the one the user saw (open point 7).

### 2.4 Revisions and autosave
- **Revisions:** every undo and redo is a new change and advances the revision by 1. Revisions never go back.
- **What every change result carries:** `ProjectChange` gains `history: HistoryStatus`, so `apply`, `applyPatches`, `writeFiles`, `undo` and `redo` all report it.
- **Store:** it adopts `revision`, `history` and `lastChange`, then reloads the active projection.
- **Other effects:**
  - F-208's code panes follow through `lastChange`;
  - F-207's carry runs inside commit, so the sidecar comes back in `files`.
- **Autosave:** F-202's workspace routes `undo` and `redo` through `change()`, so their `files` (a deleted module file as `text: null`) are saved with the usual 500 ms debounce, and the header shows Saving… then Saved.
- **What clears the history:**
  - `writeFiles` (imports, uploads, deletes; ADR 0004 raw writes);
  - a raw external `applyPatches`;
  - `open` and `close` (project switch, delete, reload).
- **What doesn't:** `setLayout` (no revision change).

### 2.5 Keyboard shortcuts and Monaco
- **Keys** (`historyActionForKey`):
  - Windows and Linux: Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo.
  - Apple platforms: ⌘Z undoes; ⇧⌘Z redoes.
  - The listener is on `document` and calls `preventDefault` when it acts.
- **Ignored events:**
  - Alt, and the other platform's modifier;
  - `repeat`, `isComposing` and `defaultPrevented`;
  - editable targets (F-208's `isEditableTarget`: input, textarea, select, contenteditable, `.monaco-editor`).

  So the palette search and Monaco keep their own text undo.
- **Undo inside Monaco** (Ctrl+Z) reverts typing locally. The debounced `ReplaceFileText` then records it as a new project step, as F-208 decided. Project undo from Code mode uses the buttons, which are visible in every view mode.
- **Pending code edits:** before an undo or redo the store awaits every registered code-pane `flush()`, so a pending edit becomes the step that gets undone. This happens *outside* the store queue to avoid a deadlock.
- **Undo stops:** F-208's external-change path wraps `pushEditOperations` in `model.pushStackElement()` before and after, so a Monaco undo never merges the user's typing with an engine change.
- **A refused draft** (dirty buffer) is kept; last writer wins (F-208).

### 2.6 Limits
- **Steps:** 100 (a group counts as one).
- **Size:** 8,000,000 UTF-16 code units of patch and inverse text across both stacks (about 16 MB). `units` is the sum of the edit, create and path string lengths.
- **Trimming:** the oldest undo steps go first. A single step over the size budget is kept on its own, so the last command is always undoable.
- **Scope:** in memory, per open project. No history panel. The limits can be injected (`EngineServiceOptions.historyLimits`) for tests.

### 2.7 UI
- **`HistoryControls`** sits at the right end of the tab strip, before F-208's view-mode toggle. It is rendered whenever a project is open, so the F-201 no-project baseline is unchanged.
- **Buttons:** "Undo" and "Redo", with:
  - `title` "Undo: Add call to ALIGN (Ctrl+Z)";
  - `aria-keyshortcuts`;
  - `disabled` when the count is 0.
- **Announcements:** a visually hidden `role="status"` reads "Undone: …", "Redone: …" or the refusal message.
- **Tabs after a change:** the store re-points tabs from the workflow lists (one vanished and one new workflow in the same file), not from the command, so undoing a workflow rename keeps its tab. If F-207's store already does this keyed on the command, generalise it.

### 2.8 What the other features must provide

| Feature | Must provide |
|---|---|
| F-202 | `createWorkspace`'s `change()` wrapper; `WorkspaceApi extends EngineApi`; engine `readFile` and `close`; `e2e/projects.ts` `readStoredDatabase` and `saveState`; reopening after a reload |
| F-205 | `workspace-store.ts` (injected engine getter, generation-guarded `load`); `window.nfBuilderWorkspace`; `tab-strip.tsx`; `e2e/canvas.ts` (`canvasReady`, `node`) |
| F-208 | store `apply(command)`, `revision` and `lastChange`; `isEditableTarget`; `TextSync.flush()` **resolving after the send settles**; CodePane's clean-buffer follow; `e2e/code-view.ts` (`editor`, `insertAtLineEnd`, `readFile`); `data-sync` |
| F-207 (either order) | the carry hooked into the service's shared commit path (`commitFiles` below, not only `accept(result)`); the removed-positions memo; `setLayout` leaving history alone. If its carry needs rename hints, whichever lands second adds reversed `renames` to `StepPart` |

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/history/history.ts` | `HistoryStatus {undo: string\|null; redo: string\|null; undoCount: number; redoCount: number}`; `EMPTY_HISTORY`; `HistoryLimits {steps; units}`; `HISTORY_LIMITS = {steps: 100, units: 8_000_000}`; `StepPart {patches: readonly TextPatch[]; inverse: readonly TextPatch[]}`; `HistoryStep {label; group: string\|null; parts: readonly StepPart[]; units}`; `patchUnits(patches: readonly TextPatch[]): number`; `class History { constructor(limits?: HistoryLimits); record(part: StepPart, label: string, group: string\|null): void; undoLists(): readonly (readonly TextPatch[])[] \| null; redoLists(): readonly (readonly TextPatch[])[] \| null; undone(): string; redone(): string; seal(): void; clear(): void; status(): HistoryStatus }` (all readonly) |
| `packages/engine/src/history/labels.ts` | `commandLabel(command: EditCommand): string` (exhaustive switch) |
| `apps/web/src/history/history-keys.ts` | `HistoryAction = "undo"\|"redo"`; `HistoryKeyEvent {key; ctrlKey; metaKey; altKey; shiftKey; repeat; isComposing; defaultPrevented; target}`; `isApplePlatform(platform: string): boolean`; `historyActionForKey(e: HistoryKeyEvent, apple: boolean): HistoryAction\|null`; `shortcutText(a, apple): string`; `ariaKeyShortcuts(a, apple): string` |
| `apps/web/src/history/use-history-keys.ts` | `useHistoryKeys(): void` |
| `apps/web/src/history/history-controls.tsx` | `HistoryControls(): JSX.Element \| null` |
| `packages/engine/test/history/{history,labels,properties}.test.ts`, `packages/engine/test/service/history.test.ts`, `apps/web/test/{history-keys,history-controls}.test.ts(x)` | section 4 |
| `e2e/history.ts` | `HISTORY_FIXTURE` (`tools/oracle/cases/f111-start-typed`, already oracle-clean); `historyStatus(page)`; `applyThroughStore(page, command, options?)`; `portRef(page, local, port)` (via `nfBuilderEngine.project`); `storedFiles(page)` (after Saved, via `readStoredDatabase`); `engineFiles(page, paths)`; `pressUndo(page)` and `pressRedo(page)` (click `.react-flow__pane`, then `ControlOrMeta+z` or `ControlOrMeta+Shift+z`) |
| `e2e/undo.spec.ts` | section 4 |

### 3.2 Change
- **`packages/engine/src/edit/apply.ts`:**
  - `patchSequence(model: ProjectModel, lists: readonly (readonly TextPatch[])[]): readonly FileText[]`;
  - `commit(state, result: {readonly files: readonly FileText[]})`, widened from the full result type.
- **`packages/engine/src/service/types.ts`:**
  - `ApplyOptions {group?: string; label?: string}`;
  - `ProjectChange.history: HistoryStatus`;
  - `Undone extends ProjectChange {ok: true; label: string}`;
  - `HistoryOutcome = Undone | EngineRefusal`;
  - `EngineRefusalCode` adds `"no-history"`;
  - on `EngineApi`:
    - `apply(command, revision, options?: ApplyOptions)`;
    - `undo(revision): Promise<HistoryOutcome>`;
    - `redo(revision): Promise<HistoryOutcome>`;
    - `history(): Promise<HistoryStatus>` (`EMPTY_HISTORY` with no project).
- **`packages/engine/src/service/service.ts`:**
  - `History` on `Open`, created at `open` and dropped at `close`;
  - a `commitFiles(open, files, startedChanging)` shared by `accept`, undo and redo;
  - `record` in `apply`;
  - `clear` in `writeFiles`, raw `applyPatches` and the `guarded` catch once changing has started;
  - `seal` via `undone` and `redone`;
  - `historyLimits` in `EngineServiceOptions`.
- **`packages/engine/src/index.ts`:** export the history module and the new types.
- **`packages/engine/test/edit/harness.ts`:** export `snapshot`.
- **`apps/web/src/workspace/workspace.ts` (F-202):** `undo` and `redo` through `change()`; `history` passed straight through.
- **`apps/web/src/engine/engine-client.ts`:** `undo`, `redo` and `history`; `apply` passes `options`. `expose.ts` needs no change (it spreads).
- **`apps/web/src/workspace/workspace-store.ts`:**
  - state: `history: HistoryStatus` and `historyNotice: string | null`;
  - `apply(command, options?)`;
  - `undo()`, `redo()` and `registerFlush(flush: () => Promise<void>): () => void`;
  - one serial queue for apply, undo and redo;
  - history reset on `open`;
  - tab re-pointing (2.7);
  - `WorkspaceHook` gains `apply`, `undo`, `redo` and `history(): HistoryStatus`.
- **F-208's `code/code-editor.tsx` (or `code-pane.tsx`):** register its `TextSync.flush` with the store; add `pushStackElement` around external updates.
- **Shell:**
  - `shell/tab-strip.tsx`: `HistoryControls`;
  - `app-shell.tsx`: `useHistoryKeys()`;
  - `main.tsx`: the hook additions.
- **`e2e/engine.ts`:** `EngineHook` gains `readFile`, `undo`, `redo` and `history`.
- **Unchanged:**
  - dependencies;
  - dependency-cruiser (`history/` is inside the engine);
  - workflows;
  - stored and exported formats;
  - the AGENTS.md command table;
  - generated files;
  - oracle cases.

## 4. Tests (write first; each fails before its change)

| File: test name | Asserts |
|---|---|
| **`test/history/history.test.ts`** (pure) | |
| `F-209 AR-23: each recorded command is one step; undo and redo move the top step between the stacks` | counts, labels, the lists returned |
| `F-209 AR-23: recording after an undo clears the redo stack` | |
| `F-209 AR-23: a command with no patches records no step, leaves both stacks alone and keeps an open group open` | |
| `F-209 F-301 F-310: commands recorded in a row with one group make one step; undo lists the inverses newest first and redo lists the patches in order; undo, redo, seal or another group start a new step` | |
| `F-209: beyond 100 steps or 8,000,000 units the oldest steps are dropped; a single oversized step is kept alone` | injected limits |
| `F-209: a group takes its first command's label option, else that command's label` | |
| **`test/history/labels.test.ts`** | |
| `F-209 AR-21: commandLabel gives a sentence-case label for every EDIT_COMMAND_KINDS entry` | the 2.2 table |
| **`test/edit/apply.test.ts`** (extend) | |
| `F-209 F-111: CreateProcess then AddCall touch main.nf twice, so their concatenated inverses throw PatchError, while patchSequence applies them in order` | the finding-3 regression |
| `F-209 AR-23: patchSequence returns each touched path's final text, null when deleted, omits a path created then deleted, and throws without changing the model` | |
| **`test/history/properties.test.ts`** | |
| `F-209 AR-23 ADR-0011: over random commands (some grouped) interleaved with undos and redos, the project always equals the matching snapshot of a reference linear history` | fast-check, seed 209; harness `buildCommand`, `History`, `patchSequence`, `commit`; the trees of `properties.test.ts` |
| **`test/service/history.test.ts`** (real service, f111-start-typed, the 12 commands of `oracle-goldens.test.ts`) | |
| `F-209 step 1 AR-23: twelve undos after the f111 golden commands restore every file of f111-start-typed byte for byte, and the created module file is gone` | |
| `F-209 step 2 AR-23: twelve redos then give f111-edits-typed byte for byte` | |
| `F-209 AR-23: each apply adds one step and each undo or redo moves one, each with revision + 1 and the history status in the change` | |
| `F-209 ADR-0043: undo or redo on an older revision is refused as stale and changes nothing; with an empty stack the refusal is no-history` | |
| `F-209 ADR-0004: writeFiles, a raw applyPatches, open and close clear the history; a refused command leaves it unchanged` | |
| `F-209 AR-24 ADR-0039: undoing a ReplaceFileText that repaired a broken file restores the broken text` | |
| `F-209 F-301: createProcess and addCall with one group are one step; undo removes the module and restores main.nf exactly; redo brings both back with one revision each` | |
| `F-209 ADR-0003: undo, redo and history results survive structuredClone` | |
| `F-209 F-207: undoing a rename carries the sidecar back byte for byte` | only if F-207 has merged |
| **web `history-keys.test.ts`** | |
| `F-209 UX-70: Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes on Windows and Linux; ⌘Z and ⇧⌘Z on Apple platforms` | |
| `F-209 UX-70 F-208: editable targets (input, textarea, contenteditable, .monaco-editor), Alt, the other platform's modifier, repeats, composition and prevented events give nothing` | |
| **`history-controls.test.tsx`** (static markup) | |
| `F-209 UX-26 QA-11: Undo and Redo name the top step and shortcut, are disabled with nothing to undo or redo, and a polite status carries the notice` | |
| **`workspace-store.test.ts`** (extend; fake engine) | |
| `F-209 AR-23: undo and redo send the store's revision, adopt the new revision and history, record the changed paths and reload the active projection` | |
| `F-209: apply, undo and redo run one at a time, each at the revision the previous one produced` | |
| `F-209 F-208: undo first awaits the registered code-pane flushes` | |
| `F-209: a stale or no-history refusal adopts a newer revision, refreshes the history, sets the notice and isn't retried` | |
| `F-209 F-301: apply passes group and label to the engine; opening a project resets the history` | |
| `F-209 F-207: undoing a workflow rename keeps its tab, which follows the name back` | |
| **`workspace.test.ts`** (F-202; extend) | |
| `F-209 IO-01: undo and redo are autosaved like apply, including a deleted file; a refused undo saves nothing` | |
| **`engine-client.test.ts`** | |
| `F-209 ADR-0003: undo, redo, history and apply options cross the Comlink bridge` | |
| **e2e `undo.spec.ts`** (F-202 stored project from `HISTORY_FIXTURE`; the start is captured after canvas ready and Saved) | |
| `F-209 step 1 step 2 AR-23 IO-01: five different edits (add call ALIGN, connect reads to ALIGN, a code edit typed in Split mode, create process REPORT, rename COUNT) each add one step; five keyboard undos leave every stored and engine file byte-identical to the start; five keyboard redos give the edited state byte for byte` | `undoCount` +1 per edit; `storedFiles` and `engineFiles` equal (same key set); Monaco shows the start text; the canvas node ids equal the start's |
| `F-209 AR-23 UX-26: disconnect, delete node and connect are undone and redone with the buttons, whose titles name each step` | with test 1, covers all seven command kinds |
| `F-209 UX-70 F-208: Ctrl+Z inside the code editor undoes typing locally and doesn't undo the project's last command` | the ALIGN call stays; a new "Edit main.nf" step |
| `F-209 IO-01: an undo survives a reload; the history doesn't` | buttons disabled after the reload |

**Notes on the e2e tests:**
- Commands other than the code edit go through `window.nfBuilderWorkspace.apply` (the store's single path, as in F-207 step 3) until the canvas gains its own UI for them.
- The code edit appends a `//` comment line. The builder checks it against the syntax reference.
- The comparisons cover every stored file. When F-207 is present they include the sidecar; a sidecar difference is fixed in the carry, never by narrowing the assertion.

## 5. Tasks (branch `feat/F-209`; tasks 1 and 2 need only `main`)

1. **History core.**
   - Files: `history.ts`, `labels.ts`, `patchSequence`, the widened `commit`, the exports, the harness export and the four engine test files (excluding the service tests).
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/history test/edit/apply.test.ts` and `pnpm check` pass.
2. **Service.**
   - Files: the types, service wiring and `service/history.test.ts`. Rebase onto F-202's `readFile` and `close`, and onto F-207's carry if either has merged.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/service test/history` and `pnpm check` pass. Add `test/layout` to the vitest run if F-207 has merged.
3. **Bridge and workspace** (needs F-202 merged).
   - Files: `engine-client.ts`, F-202's `workspace.ts`, `e2e/engine.ts`, and their tests.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-113|F-202"` pass.
4. **Store and code pane** (needs F-205 and F-208 merged).
   - Files: the store changes, flush registration, undo stops, and the store tests.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm check` and `pnpm test:e2e -- --grep "F-208|F-205"` pass.
5. **Keys, controls and e2e.**
   - Files: `history-keys.ts`, the hook, `HistoryControls` in the tab strip, their unit tests, `e2e/history.ts` and `undo.spec.ts`.
   - Done when these pass:
     - `pnpm check`;
     - `pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-209|F-208|F-205|F-202"`;
     - `pnpm smoke` (under 60 s).
6. **CI and baselines** (orchestrator).
   - Push, then view and commit each changed tab-strip `-actual.png` from the `playwright-chromium` artefact (ADR 0021).
   - Done when every job of the `CI` and `Scope guard` workflows is green (`scope-change` label if point 9 is taken).
7. **Records** (section 7).
   - Done when `pnpm check` passes.

## 6. Open points (recommendations only; none decided here)

1. **History in the worker, inside the service** (2.1). This moves the F-113 note's main-thread `applyPatches` usage behind the bridge and adds `undo`, `redo`, `history` and `apply` options to `EngineApi`, which amends ADR 0043's API list. **Decide and record. Recommend:** accept, for the reasons in 2.1.
2. **Groups as sequential parts under a `group` token** rather than concatenated inverses (finding 3). **Recommend:** accept, and correct the F-301 and F-310 notes.
3. **Raw writes clear the history** (`writeFiles` and an external `applyPatches`). The alternative is recording `writeFiles` as an undoable step, with inverses computed in the service. **Recommend:** clear in F-209, and note for F-210 that its file operations should become commands if uploads need to be undoable.
4. **Limits of 100 steps and 8,000,000 units;** the spec is silent. **Recommend:** accept, and record them in the ADR.
5. **Shortcuts as in 2.5:** platform keys; editable targets keep their own undo; repeats ignored; flush before undo; Monaco undo stops (a small change to F-208's code). **Recommend:** accept, with a note for F-701.
6. **Control placement:** the tab strip, in every view mode, whenever a project is open. The alternative is React Flow's Controls (UX-26 literally), which aren't visible in Code mode. **Recommend:** the tab strip, and re-approve the F-205 and F-208 tab-strip baselines from CI.
7. **No automatic retry after a stale refusal.** **Recommend:** accept.
8. **Spec wording (spec behaviour; decide and record):**
   - **AR-23** becomes "Every command is one undo step; a user action that applies several commands (F-301, F-310) is one step. Undo restores exact bytes. History is kept in memory per open project; raw file writes clear it."
   - **UX-70** becomes "undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y; ⌘Z and ⇧⌘Z on Apple platforms); text fields and code editors keep their own undo".
9. **`features.json` dependencies** (needs the `scope-change` label):
   - add F-202 to F-209's `depends_on` (autosave);
   - add F-209 to F-309's (its step 2 needs undo).

   **Recommend:** both.
10. **The sidecar in the byte-identity checks.** Whichever of F-207 and F-209 lands second makes `undo.spec.ts` cover the sidecar. **Recommend:** keep the full-file comparison, and fix any difference in F-207's carry or memo.
11. **Node moves stay outside the history** (F-207 settled this). **Recommend:** confirm. Adding them later means recording `setLayout` changes as steps.

**Decide-and-record items (AGENTS.md):**
- **Runtime dependency:** none.
- **Package boundaries and dependency-cruiser:** none.
- **Stored or exported format:** none (the history is in memory, ADR 0039).
- **Workflows:** none.
- **`features.json` beyond notes:** point 9.
- **ADR interplay:** amends ADR 0043's API (point 1) and clarifies ADR 0039's history and grouping (point 2).
- **Spec behaviour:** point 8.
- **Open questions:** none.

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, the next free number at landing, since F-202, F-205, F-207 and F-208 each take one): "Undo history in the engine worker: one step per command or group, sequential parts, cleared by raw writes, bounded, with platform shortcuts outside editors".
  - It covers 2.1 to 2.7 and points 1 to 7, 10 and 11.
  - It amends ADR 0043's API and clarifies ADR 0039.
  - Add a row to `docs/adr/README.md`.
- **Spec:** AR-23 in `architecture.md` and UX-70 in `ux.md` (point 8).
- **`features.json`:**
  - **`depends_on`:** point 9.
  - **F-209:** "Verified …: steps 1 and 2 by `e2e/undo.spec.ts` and `test/service/history.test.ts`".
  - **F-301 and F-310:** use `workspace.apply(command, {group, label})`, not concatenated inverses; roll back a partial group with one `undo`.
  - **F-303:** Apply is one command, or one group.
  - **F-309:** a quick fix is one `ReplaceFileText` through `workspace.apply`, so it is one step.
  - **F-210:** `writeFiles` clears the history.
  - **F-304:** the popup editor's undo is local, and it registers its flush with the store.
  - **F-701:** the shortcut tooltips and the live region.
  - **F-702:** undo costs one commit without the guard parse; add an undo row to `pnpm bench`.
- **`progress.md` Decisions:** the ADR, the API change, the limits, the spec amendments, the `depends_on` change, and the baseline re-approval.
- **`docs/plan/handoff/README.md`:** an F-209 row and the settled points.
