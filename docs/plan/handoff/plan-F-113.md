# Plan: F-113, the engine in a Web Worker behind Comlink, with the QA-03 and QA-04 benchmark in CI

Planner output, 2026-11-22. I changed nothing in the repo: `/home/user/wt-main` is clean on `main` at `3e20916`. I measured in a local clone in the scratchpad (`/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/repo`), using the corpus in `/home/user/wt-F-106/.cache/corpus`. Section 8 lists the probes.

## 0. Scope

F-113 adds the following:
- **An engine service** (`packages/engine/src/service/`). It is pure, has no Comlink and no DOM, and is testable in Node. It owns one open project, a revision counter, a projector snapshot per revision, and a serial call queue.
  - Its API covers: palette, open with progress, raw file writes, apply command, apply patches (undo and redo), project a workflow, and diagnostics.
  - Every result is plain data.
- **A Comlink bridge in `apps/web`**:
  - the module worker entry (`expose`);
  - a main-thread client (`wrap`, with progress callbacks passed through `proxy`);
  - a lazily started `getEngine()`;
  - a `window.nfBuilderEngine` hook for e2e tests.
- **Moving the palette into the worker.** Pack versions stay synchronous on the main thread, through a pack-free `version` export. After this, the main build contains no parser and no catalogue (measured, section 1.2).
- **Build plumbing:**
  - `worker.format: "es"`;
  - a worker-chunk manifest, `.vite/worker-manifest.json`;
  - `check:hosts` skips worker chunks built from JSON.
- **Step 2:** a Chromium performance-trace e2e test showing that no parser code runs on `CrRendererMain`, plus a structural test that the parser exists only in the worker build.
- **Step 1:**
  - a Playwright bench, `pnpm bench`, that measures sarek's cold open and the edit p95 in the worker;
  - its report, `.cache/reports/bench.{json,md}` plus the step summary;
  - QA-03 and QA-04 time budgets in `scripts/budgets.json`;
  - a `bench` job in `ci.yml`. It is reported, not gated, and fails only when a measurement fails.

**Out of scope:**
- showing progress in the UI (no feature opens a project yet; F-202 shows it, open point 9);
- persistence (F-202);
- the undo stack (F-209);
- gating QA-03 (F-702's step);
- counting worker bundles in QA-01 (F-702, ADR 0015);
- F-112's diagnoser, unless F-112 has merged by then (open point 6).

## 1. Findings

### 1.1 Spec and ADRs
- **Architecture:** the engine runs in a Web Worker behind a Comlink API, and the UI keeps a read-only copy of the projection and diagnostics.
- **AR-04:** a change re-parses that one file and re-models the files that depend on it. F-105's `ProjectModel.setFile` and `deleteFile` already do this, and its `trace` hook can count the work.
- **QA-03 (ADR 0029):**
  - the UI stays responsive and shows loading progress;
  - sarek (pinned) parses and models within 30 s "on the CI reference profile".
- **QA-02 defines that profile:** "Playwright, 4× CPU throttle".
- **QA-04:** applying an edit to a file under 2,000 lines, re-parsing and re-projecting takes at most 100 ms at p95.
- **ADR 0030:**
  - QA-04 is reported, not gated;
  - the QA-03 ceiling gates CI, and F-702's step is the one that makes it a gate.
- **ADR 0003:** names Comlink for workers. Engine has no DOM and runs in a worker. apps/web may import engine but never a pack.
- **ADR 0014:** CSP `worker-src 'self'; script-src 'self'`.
- **ADR 0015:**
  - one CI workflow with one job per check;
  - QA-01 counts the entry chunk and its static imports, and excludes worker bundles until F-702;
  - the IO-41 scan skips chunks whose Vite-manifest `src` is `.json`, as amended by ADR 0028.
- **ADR 0016:** `pnpm smoke` must stay under 60 s.
- **ADR 0028:** the palette view "can move into the worker unchanged (F-113)".
- **ADR 0033:** `loadParser()` is a lazy chunk holding the parser and the printer.
- **ADR 0034:** the model is incremental, and F-113 drives it from file events.
- **The F-201 note** asks to move pack versions behind the worker "once a pack's entry holds the parser". That condition is not met, because the parser is lazy. Open point 2 still moves the palette.

### 1.2 Measurements (sandbox: 4 vCPU Xeon 2.1 GHz, Node 22.23.5, Chromium 157 headless shell)

| What | Result |
|---|---|
| sarek project in Node (`openProject`, every file except `.git`: 885 files, 276 `.nf`/`.config`, 26.6 M characters including PDFs and PNGs) | cold 16.2 s, warm 1.66 s. One file's first parse took up to 2.9 s, so progress must be reported per file. |
| `setFile("workflows/sarek.nf")` in Node (722 lines; re-parses it, re-models 2 files) | p50 38 ms, p95 83 ms (40 runs). `fastq_preprocess_gatk/main.nf` (494 lines): p50 22, p95 30. |
| Small trees in Node, cold | `f105-includes-resolve` (17 files) 0.9 s; `s1-typed-calls-legacy-module` (3 files) 0.2 s |
| sarek in a Comlink module worker, under the production CSP (`vite preview`), page throttled 4× | cold open 15.2 s inside the worker, 15.5 s round trip from the main thread; no CSP violation or console error |
| `setFile(sarek.nf)` round trip from the main thread | p50 36 ms, p95 52 ms (60 runs) |
| **CPU throttle and workers** | Page throttle 4×: a main-thread loop went from 697 to 4,006 ms, a **worker loop from 822 to 971 ms**. `Emulation.setCPUThrottlingRate` sent on the worker's own CDP session fails with *"Operation is only supported for pages, not workers"*. **Chromium can't put the worker on QA-02's 4× profile.** With a true 4× slowdown, sarek would take about 60 s. |
| Main thread during the sarek open (4×) | longest frame gap 364 ms. That is posting 26.6 MB of files to the worker; parsing adds nothing. |
| Performance trace (`browser.startTracing`, categories in 2.6) of a 60-file open | `Profile` events (`ph: "P"`) name each sampled thread, and `ProfileChunk` samples carry `callFrame.url`. **CrRendererMain: 0 samples in the parser chunk** (31,986 idle). **DedicatedWorker thread: 29,707 samples in the parser chunk.** `v8.compileModule` and `v8.evaluateModule` of the parser chunk appear only on the worker thread. |
| Bundles today | initial JS 77.3 kB gz; parser and printer chunk 653 kB raw / 148 kB gz; catalogue chunks 22.5 + 14.4 kB gz |
| Spike with a worker while the main thread still imports `installedPackVersions` and `loadPalette` | initial JS 78.9 kB gz. **The parser and both catalogue chunks are built twice** (a dead lazy copy in the main build and the worker's copy), so the catalogue would be downloaded twice. |
| Spike with the palette in the worker and versions from a pack-free `version` export | **initial JS 75.1 kB gz; the main build emits no parser or catalogue chunk**; worker entry 21.9 kB raw / 7.6 kB gz (model and Comlink only) |
| **Vite 8 worker build** | `worker.format: "es"` is needed for the worker's dynamic imports. Worker chunks are absent from `.vite/manifest.json`: the worker appears only under `index.html.assets`. **So `pnpm check:hosts` fails** on the worker's `script.json` chunk (docs URLs). A small plugin pair (a `worker.plugins` `generateBundle` hook that collects, and a main `generateBundle` hook that emits `.vite/worker-manifest.json`) records `{file, src, isEntry, dynamicImports}` for each worker chunk; I tested it. |
| Comlink 4.4.2 | Apache-2.0, no dependencies, released 2024-11-07 (latest). `comlink.min.mjs` is 4.5 kB, 2.0 kB gz. No `eval` or `Function`. Ships ESM through `module`, types through `types`. **It worked under the production CSP in Chromium.** In Node, over a `MessageChannel`, proxied callbacks and thrown errors both cross. Progress callbacks travel on their own port, so they can arrive after the call resolves. |

### 1.3 Code facts
- **`ProjectModel`** (F-105) is synchronous. Its constructor parses every file, firing a `trace({kind: "parse"})` event before each one, then re-models all files (`{kind: "model"}` events). `openProject(version, files, {trace})` awaits `loadParser`, so progress needs no change to F-105.
- **apps/web uses engine on the main thread through four calls:**
  - `installedPackVersions()`, synchronously at module load in `app-shell.tsx`;
  - `loadPalette()`, in `palette/use-palette-view.ts`, inside an effect;
  - `searchPalette()` and `paletteItemCount()`, which are pure.
- **Web unit tests** render with `renderToStaticMarkup`, so effects never run, and Node has no `Worker`. `getEngine()` must therefore start the worker lazily.
- **`e2e/parser-chunk.spec.ts`** (F-104) and the F-204 lazy-catalogue test scan every file in `assets/`, so both still pass when the only copies live in the worker build.
- **`test/workflows.test.ts`** asserts the job list in `ci.yml`. **`test/agents-md.test.ts`** asserts that the Commands table matches the root scripts.
- **`scripts/budgets.json`:** `readBudget` validates only the id it is asked for, so adding entries keyed on `maxMs` breaks nothing.

### 1.4 Unbuilt names this plan relies on

| From | Name | Used for |
|---|---|---|
| F-106 (on `feat/F-106`) | `createProjector(model, catalogue)`; `Projector.workflows()` and `project(path, workflow)`; lang-core `Projection` and `WorkflowRef` | projections; workflow lists |
| F-111 | lang-core `EditCommand`, `TextPatch`, `FileText`, `RefusalCode`, `CommandResult`; engine `EditState`, `createEditState(version, files, options)`, `applyCommand(state, command)`, `commit(state, result): readonly string[]`, `applyPatches(files, patches)`, `PatchError`; oracle case `tools/oracle/cases/f111-start-typed` | apply, undo, test tree |
| F-111 (an extension) | `createEditState` options gain `trace?: (event: ModelEvent) => void`, passed to `openProject` | progress |
| F-112 (optional) | `createDiagnoser`, `loadLints` | diagnostics (open point 6) |

## 2. Design

### 2.1 Where things live

| Piece | Package |
|---|---|
| `EngineApi` and its result types, `createEngineService` | engine `src/service/` (pure) |
| `version` export | `lang-2610` entry; engine's `installedPackVersions()` reads it, so `pack` is tree-shaken out of the main build |
| `exposeEngine`, `connectEngine`, `getEngine`, the worker entry, the `window.nfBuilderEngine` hook | `apps/web/src/engine/` (Comlink lives only here) |
| Worker manifest plugin, bench report | root `scripts/` (build- and test-time, ADR 0014) |
| Trace analysis, bench spec | `e2e/` |

### 2.2 Service behaviour

- **Serial queue.** Every method runs to completion before the next one starts, in arrival order. An `apply` sent during an `open` therefore sees the opened project.
- **Open:**
  - emits `{phase: "loading", done: 0, total: n, path: null}`;
  - then calls `createEditState(version, files, {trace})`;
  - each `parse` event emits `{phase: "parsing", done: k, total: n, path}`;
  - the first `model` event emits `{phase: "modelling", done: n, total: n, path: null}`;
  - progress is advisory: callers ignore events that arrive after the promise settles.
- **Revision:**
  - one counter across opens, so a command from a previous project is stale;
  - it goes up on every change;
  - `apply` and `applyPatches` refuse a mismatched revision as `stale` and change nothing.
- **apply:**
  1. `applyCommand(state, command)`;
  2. if refused, return the refusal with the revision unchanged;
  3. otherwise `commit`, which calls `setFile` or `deleteFile`, so only the changed files are parsed and only they and their dependants are re-modelled (AR-04);
  4. increment the revision and drop the projector and diagnostics snapshot;
  5. return `{ok, revision, patches, inverse, files, remodelled, workflows}`.
- **applyPatches** (undo and redo):
  - F-111's `applyPatches` runs over the current texts of the patched paths;
  - then `commit`;
  - there is no AR-24 guard, because undo restores earlier bytes;
  - a `PatchError` is refused as `invalid`.
- **writeFiles** (imports, uploads, deletes): calls `setFile` or `deleteFile` directly with no guard (ADR 0004).
- **project** and **diagnostics:**
  - computed from a snapshot that is built lazily once per revision (the F-106 projector);
  - each result carries its `revision`;
  - without a project they answer `no-project`.
- **Errors:**
  - exceptions become `internal` refusals, except in `open` and `palette`, where they reject;
  - after either kind of failure, the service keeps working (IO-14).

### 2.3 Main thread
- **What the main thread imports from engine:** types, `installedPackVersions` (now built from constants), `searchPalette` and `paletteItemCount`. Nothing else.
- **`usePaletteView`** calls `getEngine().palette(version)`.
- **`getEngine()`** creates `new Worker(new URL("./engine.worker.ts", import.meta.url), {type: "module", name: "engine"})` on first use and logs `error` events to `console.error`.
- **`connectEngine`** returns a plain facade object rather than the Comlink proxy. It wraps `onProgress` with `proxy()`, and the worker side releases that proxy when `open` settles.
- **`main.tsx`** defines a getter: `Object.defineProperty(window, "nfBuilderEngine", { get: getEngine })`.

### 2.4 Build
- `vite.config.ts` sets `worker: { format: "es", plugins: () => [workerChunks.collect()] }` and adds `workerChunks.emit` to `plugins`.
- The manifest's `src` paths are relative to the root, as in Vite's own manifest.
- `check-hosts` also skips the worker chunks whose `src` ends in `.json`.

### 2.5 Bench (`e2e/bench/engine.bench.ts`, `pnpm bench`, Chromium only)

**Setup:**
1. Read `.cache/corpus/sarek`: every file except `.git`, as F-105's corpus test does. If it is missing, fail with "run pnpm corpus:fetch".
2. Apply `Emulation.setCPUThrottlingRate {rate: 4}` to the page (QA-02's profile; it doesn't reach the worker, see 1.2).
3. `goto("/")`.
4. Place the files on `window`; this is not timed.

**QA-03:**
- **cold:** `open` timed from the main thread, plus the progress-event count, the largest gap between progress events, and the largest main-thread frame gap (`requestAnimationFrame`);
- **warm:** a second open, in the same worker.

**QA-04:**
- the target is `workflows/sarek.nf`, workflow `SAREK` (722 lines);
- the commands alternate `AddCall {callee: "FASTQC"}` and `ReplaceFileText` (a comment line added inside `main:`);
- each command is followed by an unmeasured undo through `applyPatches(inverse)`;
- 5 warm-up commands of each kind, then 50 measured of each;
- one sample is `apply` plus `project(path, "SAREK")`, timed from the main thread;
- the report gives p50, p95 (nearest rank) and max, overall and per kind.

**Output and failure:**
- `scripts/bench-report.ts` writes `.cache/reports/bench.json` and `bench.md`, and appends the markdown to `$GITHUB_STEP_SUMMARY`.
- The markdown has one row per budget (measured, limit, within or over) and states "reported, not gated (ADR 0030); worker timings unthrottled (Chromium can't throttle workers)".
- The test fails only when a measurement fails: a refused command, a missing corpus, or a non-finite number.

### 2.6 Step 2 trace
- Uses `browser.startTracing(page, {categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "v8", "toplevel", "disabled-by-default-v8.cpu_profiler"]})`.
- Inside the trace:
  1. open `tools/oracle/cases/f105-includes-resolve`;
  2. apply a `ReplaceFileText` to `main.nf`;
  3. call `project`.
- Then `stopTracing()`.
- Parser chunks are the worker-manifest chunks whose `src` ends in `packages/lang-2610/src/source/index.ts`.
- `scriptActivity(trace, isParserUrl)` attributes samples and module compiles to thread names.
- Assertions: `CrRendererMain` has 0 samples and 0 compiles; `DedicatedWorker thread` has at least 1 sample (the positive control).

## 3. Files

### 3.1 Create

| Path | Exports |
|---|---|
| `packages/engine/src/service/types.ts` | `OpenRequest { version; files: readonly ProjectFile[] }`; `type LoadPhase = "loading" \| "parsing" \| "modelling"`; `LoadProgress { phase; done; total; path: string \| null }`; `FileSummary { path; language: SourceLanguage; status: ParseStatus; problems: number }`; `ProjectSummary { revision; version; files: readonly FileSummary[]; workflows: readonly WorkflowRef[] }`; `ProjectChange { revision; files: readonly FileText[]; remodelled: readonly string[]; workflows: readonly WorkflowRef[] }`; `type EngineRefusalCode = RefusalCode \| "stale" \| "no-project"`; `EngineRefusal { ok: false; revision: number \| null; code; message; path: string \| null; problems: readonly ParseProblem[] }`; `Applied extends ProjectChange { ok: true; patches; inverse }`; `type ApplyOutcome = Applied \| EngineRefusal`; `ProjectionResult { revision; projection: Projection \| null }`; `DiagnosticsResult { revision; diagnostics: readonly Diagnostic[] }`; `interface EngineApi { palette(version): Promise<PaletteView>; open(request, onProgress?: (p: LoadProgress) => void): Promise<ProjectSummary>; writeFiles(files: readonly FileText[]): Promise<ProjectChange \| EngineRefusal>; apply(command: EditCommand, revision: number): Promise<ApplyOutcome>; applyPatches(patches: readonly TextPatch[], revision: number): Promise<ApplyOutcome>; project(path, workflow: string \| null): Promise<ProjectionResult \| EngineRefusal>; diagnostics(): Promise<DiagnosticsResult \| EngineRefusal> }`. All fields readonly. |
| `packages/engine/src/service/service.ts` | `interface EngineServiceOptions { packs?: readonly LanguagePack[]; trace?: (e: ModelEvent) => void }`; `createEngineService(options?): EngineApi` |
| `packages/engine/src/service/index.ts` | re-exports |
| `packages/engine/test/service/service.test.ts` | section 4 |
| `apps/web/src/engine/expose.ts` | `exposeEngine(api: EngineApi, endpoint: Endpoint): void` |
| `apps/web/src/engine/engine-client.ts` | `connectEngine(endpoint: Endpoint): EngineApi & { dispose(): void }`; `getEngine(): EngineApi`; `declare global { interface Window { nfBuilderEngine?: EngineApi } }` |
| `apps/web/src/engine/engine.worker.ts` | none; it runs `exposeEngine(createEngineService(), self)` |
| `apps/web/test/engine-client.test.ts` | section 4 |
| `scripts/worker-manifest.ts` | `interface WorkerChunk { file; src: string \| null; isEntry: boolean; dynamicImports: readonly string[] }`; `workerManifest(root: string): { collect(): Plugin; emit: Plugin }`; `readWorkerManifest(distDir: string): WorkerChunk[]` (`[]` when the file is absent) |
| `scripts/bench-report.ts` | `percentile(values: readonly number[], p: number): number`; `readTimeBudget(id: "QA-03" \| "QA-04", file?): { id; description; maxMs; reason }`; `interface BenchResult { browser; cpuThrottle; open: { files; coldMs; warmMs; progressEvents; maxProgressGapMs; maxFrameGapMs }; edits: readonly { kind: string; ms: number }[] }`; `benchReport(result): BenchReport`; `benchMarkdown(report): string`; `writeBenchReport(report, dir?): void` |
| `e2e/engine.ts` | `readProject(dir): {path; text}[]`; `parserChunks(): string[]` (from the worker manifest); a local `EngineHook` interface (the subset of the API the tests call) |
| `e2e/trace.ts` | `scriptActivity(trace: unknown, isTarget: (url: string) => boolean): Map<string, { samples: number; compiles: number }>` (throws when the trace has no thread names or no `Profile` events) |
| `e2e/engine-worker.spec.ts` | step 2 and smoke tests |
| `e2e/bench.config.ts` | testDir `bench`, testMatch `**/*.bench.ts`, Chromium only (`PW_CHROMIUM_EXECUTABLE`), workers 1, timeout 10 min, preview webServer as in the root config, outputDir `test-results/bench` |
| `e2e/bench/engine.bench.ts` | the bench |
| `test/worker-manifest.test.ts`, `test/bench-report.test.ts`, `test/e2e-trace.test.ts` | section 4 |

### 3.2 Change
- **`packages/lang-2610/src/index.ts`:** `export const version = "26.10"`, and `pack.version = version`.
- **`packages/engine/src/packs.ts`:** `installedPackVersions()` returns `[version2610]`.
- **`packages/engine/src/index.ts`:** export the service and its types.
- **F-111's `packages/engine/src/edit/apply.ts`:** a `trace` option on `createEditState`.
- **`apps/web/package.json`:** `"comlink": "4.4.2"`, then `pnpm install`.
- **`apps/web/vite.config.ts`:** the settings in 2.4.
- **`apps/web/src/main.tsx`:** the hook.
- **`apps/web/src/palette/use-palette-view.ts`:** call `getEngine().palette`.
- **`scripts/check-hosts.ts`:** read the worker manifest, and update its header comment.
- **`scripts/budgets.json`:**
  - `"QA-03": {description, "maxMs": 30000, reason: "ADR 0029; reported by the bench job until F-702 gates it"}`;
  - `"QA-04": {…, "maxMs": 100, reason: "QA-04; reported, not gated (ADR 0030)"}`.
- **Root `package.json`:** `"bench": "node scripts/run-playwright.ts --config e2e/bench.config.ts"`.
- **`AGENTS.md`:** a `pnpm bench` row: "After `pnpm corpus:fetch`: sarek open time (QA-03) and edit p95 (QA-04) in the engine worker on Chromium; report in `.cache/reports/bench.{json,md}`; CI job `bench`, reported not gated".
- **`.github/workflows/ci.yml`:** a `bench` job on `ubuntu-24.04` with timeout 20. Steps:
  - checkout (`persist-credentials: false`);
  - `./.github/actions/setup`;
  - `./.github/actions/corpus`;
  - `pnpm exec playwright install --with-deps chromium`;
  - `pnpm bench`;
  - `actions/upload-artifact` (same SHA as the other jobs), `.cache/reports/bench.*`, `if: always()`.
- **READMEs:** `packages/engine/README.md` and `apps/web/README.md`, one line each.
- **`docs/licences.md`:** a Comlink row.
- **Not changed:** dependency-cruiser, the `LanguagePack` interface, F-105's `ProjectModel`, generated files.

## 4. Tests (written before the implementation)

| File: test | Asserts |
|---|---|
| **service.test.ts** (fixtures `tools/oracle/cases/f105-includes-resolve` and `f111-start-typed`) | |
| `F-113 QA-03 ADR-0029: open reports loading, one parsing event per file in order, then modelling, and returns a summary of every file` | event sequence, totals, summary paths and statuses |
| `F-113 AR-04: apply re-parses only the files the command changed and re-models them and their dependants` | trace events after `apply(ReplaceFileText)` = parse of that file only; `remodelled` = the file plus `dependants` |
| `F-113 AR-04 ADR-0004: writeFiles creates, changes and deletes files without the AR-24 guard` | a broken text is accepted; `remodelled` matches F-105's |
| `F-113 AR-23: applyPatches with a command's inverse restores the exact bytes` | texts byte-equal to before; the new inverse equals the command's patches; revision +1 |
| `F-113 AR-20 AR-24: a refused command changes nothing` | refusal code and message; same revision and texts |
| `F-113 AR-10: project returns the current projection and reflects an applied AddCall` | node present after AddCall; `revision` matches; missing workflow gives `null` |
| `F-113: a command or patch list built on an older revision is refused as stale` | code `stale`, nothing written |
| `F-113: calls run one at a time in arrival order` | an `apply` issued before `open` resolves sees the opened project |
| `F-113: without an open project, apply, applyPatches, writeFiles, project and diagnostics answer no-project` | |
| `F-113 ADR-0028: palette(version) equals loadPalette(version)` | |
| `F-113 ADR-0003: every result survives structuredClone unchanged` | `toEqual(structuredClone(x))` for every method |
| `F-113 IO-14: a failing open rejects and the next open works` | unknown version rejects; a valid one then succeeds |
| **engine-client.test.ts** (Node `MessageChannel`) | |
| `F-113 ADR-0003: the Comlink client opens a project and receives progress callbacks` | summary arrives; progress events received (after settle allowed) |
| `F-113: a service error rejects the client call with its message; a refusal crosses as data` | |
| `F-113: importing the client starts no worker` | no `Worker` access at import time |
| **Root tests** | |
| `test/worker-manifest.test.ts`: `F-113 IO-41: the worker manifest records each worker chunk with its root-relative source` | plugin hooks on a fake bundle; `readWorkerManifest` gives `[]` when absent |
| `test/worker-manifest.test.ts`: `F-113 ADR-0003: the web build bundles workers as ES modules with the manifest plugin` | |
| `test/check-hosts.test.ts`: `F-113 IO-41 ADR-0028: a worker chunk built from JSON is skipped; a worker code chunk is scanned` | |
| `test/e2e-trace.test.ts`: `F-113 step 2: scriptActivity attributes CPU samples and module compiles to threads by URL` | synthetic trace with two threads |
| `test/e2e-trace.test.ts`: `F-113 step 2: a trace without thread names or profiles is rejected` | |
| `test/bench-report.test.ts`: `F-113 step 1 QA-04: p95 is the nearest-rank percentile` | |
| `test/bench-report.test.ts`: `F-113 step 1 QA-03 QA-04 ADR-0030: the report states each measurement against its budget and never fails on a breach` | |
| `test/bench-report.test.ts`: `F-113 step 1: budgets.json holds QA-03 (30000 ms) and QA-04 (100 ms) with reasons` | |
| `test/workflows.test.ts`: `F-113 step 1 ADR-0015: ci.yml has a bench job that restores the corpus, installs Chromium, runs pnpm bench and uploads the report` | step order |
| **Package tests** | |
| `engine/test/packs.test.ts`: `F-113 F-201: installedPackVersions equals the installed packs' versions` | |
| `lang-2610/test/index.test.ts`: `F-113: the pack entry's version export equals pack.version` | |
| **E2E** (`e2e/engine-worker.spec.ts`) | |
| `F-113 AR-04 QA-20 QA-30: the engine worker opens a project and applies an edit with no CSP violation or console error @smoke` | progress received; `remodelled` lists only the changed file and its dependants; runs on Firefox and WebKit too |
| `F-113 step 2 AR-04: the main thread does no parsing (Chromium performance trace)` | 2.6 |
| `F-113 step 2 QA-01 ADR-0033: the parser and the catalogue are built only into the worker` | no main-manifest key for the parser source or the catalogue; `PARSER_MARKER` only in worker-manifest chunks; the parser is a dynamic import of the worker entry |
| **Bench** (`e2e/bench/engine.bench.ts`) | |
| `F-113 step 1 QA-03 QA-04: sarek open time and edit p95 in the engine worker, reported against budgets` | 2.5 |

## 5. Tasks (in order; one builder run each)

Branch `feat/F-113` after F-111 merges. In every task, write the tests first and watch them fail.

1. **Engine service.**
   - Files: `service/*`, the `createEditState` `trace` option, engine exports, `service.test.ts`.
   - Done when `pnpm --filter @nf-builder/engine exec vitest run test/service` and `pnpm check` pass.
2. **Comlink bridge.**
   - Files: Comlink 4.4.2 in apps/web (`pnpm install`), `expose.ts`, `engine-client.ts`, `engine.worker.ts`, `engine-client.test.ts`. Nothing in the app calls `getEngine` yet.
   - Done when `pnpm --filter @nf-builder/web test`, `pnpm audit --audit-level high` and `pnpm check` pass.
3. **Worker manifest and the hosts check.**
   - Files: `scripts/worker-manifest.ts`, `check-hosts.ts` and their tests.
   - Done when `pnpm exec vitest run --project repo test/worker-manifest.test.ts test/check-hosts.test.ts` and `pnpm check` pass.
4. **Wire the app.**
   - Vite `worker` config and plugins; the `version` export and `installedPackVersions`; palette through the worker; the `main.tsx` hook; `e2e/engine.ts`; the @smoke and structural e2e tests.
   - If the F-201 @visual test races the palette, wait for the palette tree before the screenshot. The baseline must not change.
   - Done when these pass:
     - `pnpm check && pnpm build && pnpm check:budget && pnpm check:hosts`;
     - `pnpm test:e2e -- --grep "F-113|F-104|F-201|F-204"`;
     - `pnpm smoke` (under 60 s).
5. **Step 2 trace.**
   - Files: `e2e/trace.ts`, `test/e2e-trace.test.ts`, the trace e2e test.
   - Done when `pnpm exec vitest run --project repo test/e2e-trace.test.ts`, `pnpm test:e2e -- --grep F-113` and `pnpm check` pass.
6. **Bench.**
   - Files: `scripts/bench-report.ts` and its test, `budgets.json`, `e2e/bench.config.ts`, `engine.bench.ts`, the root `bench` script, the AGENTS.md row.
   - Done when `pnpm corpus:fetch && pnpm bench` writes `.cache/reports/bench.md` with QA-03 and QA-04 rows, and `pnpm check` passes.
7. **CI job.**
   - Files: the `bench` job in `ci.yml` and its `workflows.test.ts` case.
   - Done when `pnpm check` passes and the PR's `bench` job is green, with the table in its summary and the `engine-bench` artefact.
8. **Records** (orchestrator, section 7).
   - Done when `pnpm check` passes and the Scope guard passes without `scope-change`.

## 6. Open points (each with a recommendation; none decided here)

1. **Comlink 4.4.2 as a runtime dependency of `@nf-builder/web`** (decide and record).
   - **Recommendation:** accept. ADR 0003 already names it, and the facts are in 1.2. Add a licences row (Apache-2.0); Renovate keeps it current.
   - Alternative: hand-written postMessage RPC, about 100 lines plus tests for callbacks and errors.
2. **What stays on the main thread.**
   - **Recommendation:** synchronous pack versions from a pack-free `version` export, the palette through the worker, and only types and pure search helpers from engine. This gives one copy of the parser and the catalogue, and none in the main build (measured).
   - Alternatives:
     - everything async, versions included: churns the header and status bar, and risks the visual test;
     - keep the palette on the main thread: duplicate chunks, and the catalogue downloaded twice.
3. **Comlink only in apps/web; the engine service stays pure.**
   - **Recommendation:** accept.
4. **The reference profile can't throttle the worker** (spec ambiguity in QA-02 and QA-03; touches ADR 0029's ceiling).
   - **Recommendation:**
     - throttle the page 4× as QA-02 says, and report worker timings unthrottled, saying so in the report;
     - clarify `quality.md` (the profile throttles the page; Chromium can't throttle workers);
     - record it in the F-113 ADR.
   - Alternative for F-702: a cgroup CPU quota on the whole browser. At a real 4×, sarek would be about 60 s and fail the 30 s ceiling, which would need the maintainer's view on ADR 0029.
5. **QA-03 gating.**
   - **Recommendation:** F-113 only reports. F-702 makes the 30 s ceiling a gate, as its step says. The `bench` job fails only when a measurement fails.
6. **Diagnostics source.**
   - **Recommendation:** use F-105's `ProjectModel.diagnostics()` now. Whichever of F-112 and F-113 lands second wires `createDiagnoser` (with `loadLints()` in the worker), and F-112's notes say so.
7. **Test hook `window.nfBuilderEngine`.**
   - **Recommendation:** accept and document it. It is same-origin under the strict CSP and gives page scripts nothing new.
   - Alternative: gate it behind a query flag.
8. **Double parse on apply** (F-111's guard parse plus `commit`'s `setFile`).
   - **Recommendation:** don't optimise in F-113, because QA-04 is reported only.
   - If the bench's p95 is over 100 ms, note a follow-up in F-702's notes: `setFile(path, text, parsed?)` reusing the guard's `SourceFile` (F-111 plan 2.6).
9. **Where loading progress shows** (no UX ID covers it).
   - **Recommendation:** F-202, the first feature to open a project, shows "Opening: n of m files" in the canvas area, adds a UX row, asks for the palette before opening (the serial queue), and considers reading IndexedDB inside the worker so the main thread never clones files (the 364 ms gap).
   - Add these to F-202's notes.
10. **Bench inputs.**
    - **Recommendation:**
      - every file except `.git`, as in F-105 and F-006, so the numbers compare;
      - edits on `workflows/sarek.nf` / `SAREK` with the 2.5 command mix;
      - a sample is `apply` plus `project` from the main thread.
    - If F-111 refuses AddCall on SAREK, that is an F-111 bug, not a reason to change the bench.
11. **Worker manifest and the IO-41 amendment.**
    - **Recommendation:** accept `.vite/worker-manifest.json`. It is a build artefact like Vite's manifest, not a stored format.
    - `check:hosts` skipping JSON-sourced worker chunks amends ADR 0015 and ADR 0028.
12. **Workflow edit and the new script** (decide and record): the `bench` job in `ci.yml` (ADR 0015's single workflow) and `pnpm bench`.
    - **Recommendation:** accept.
13. **Worker bundles in QA-01.**
    - **Recommendation:** keep ADR 0015's exclusion, and F-702 revisits it.
    - Numbers for F-702's notes: worker entry about 8 kB gz before the projection and edit code is added; parser 146 kB gz; catalogues 37 kB gz.

**AGENTS.md decide-and-record items:**
- **New runtime dependency:** Comlink (1).
- **Package boundaries or dependency-cruiser:** no change; the pack entry gains one export.
- **Stored or exported format:** none (11).
- **Workflows:** `ci.yml` (12).
- **Contradicting an accepted ADR:** nothing, but ADR 0015 and ADR 0028 are amended (11), and ADR 0029's profile is clarified (4).
- **Open questions:** none affected (Q10 is consistent).

## 7. Records (drafts for the orchestrator)

- **ADR** (`Accepted (agent)`, next free number at landing): "Run the engine in a module worker behind Comlink, and benchmark it in Chromium". It covers points 1 to 5, 7 and 9 to 13, and the measurements in 1.2.
- **Spec:**
  - `quality.md`: the QA-02 and QA-03 profile clarification;
  - `architecture.md` Data flow: the main thread uses only pack versions and palette search; parsing, modelling, projection and edits run in the worker.
- **`features.json` notes** (no scope change):
  - **F-113:** "Verified …: step 1 by the CI `bench` job (report artefact), step 2 by `e2e/engine-worker.spec.ts` (trace)".
  - **F-202:** points 9 and 2.
  - **F-702:** points 4, 5, 8 and 13.
  - **F-112:** point 6.
  - **F-205, F-208 and F-209:** `project` and `revision`, `apply`, `applyPatches` for undo.
  - **F-401 and F-403:** `open` or `writeFiles`.
- **`progress.md` Decisions:** the ADR, Comlink, the ci.yml `bench` job, `pnpm bench`, the worker manifest.
- **Other:** a `docs/licences.md` Comlink row; delete this plan in the merging PR.

## 8. Evidence and how to repeat it

Scratchpad: `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/`.

| Probe | Path and how to run |
|---|---|
| Node sarek open and `setFile` | `bench/open.bench-test.ts`; `node_modules/.bin/vitest run --root <scratch>/bench --config <scratch>/bench/vitest.config.mts` from `/home/user/wt-main` |
| Small cold trees | `bench/small.bench-test.ts`, run as above with `BT=small.bench-test.ts` |
| Spike clone | `repo/` (local clone of `main` with Comlink and the spike worker): `apps/web/src/engine/*`, `apps/web/worker-manifest-spike.ts`, `vite.config.ts` |
| Browser probes against `vite preview --port 4190` in `repo/apps/web` (`PW_CHROMIUM_EXECUTABLE` set) | `pw/spike.mjs` (`throttle`, `sarek 4`, `trace`), `pw/worker-throttle.mjs` (CDP on the worker target), `pw/longtask.mjs` (frame gaps and progress), `pw/analyse.mjs trace.json` |
| Comlink over a Node `MessageChannel` | `pw/comlink-node.mjs` |
| Comlink tarball | `comlink-dl/x/package/` |
