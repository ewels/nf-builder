# 0043. Run the engine in a module worker behind Comlink, and benchmark it in Chromium

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

AR-04 says parsing, modelling, projection and edits run in a Web Worker. ADR 0003 names Comlink for the bridge. QA-03 requires that the UI stays responsive while sarek parses and models within 30 s on the CI reference profile (ADR 0029), and QA-04 sets a 100 ms p95 for an edit. The reference profile throttles the CPU 4× (QA-02), but Chromium's CPU throttling applies only to the page, not to workers. The palette loaded the catalogues on the main thread, and the parser sat in the main build as a lazy chunk; QA-01 counts only initial JavaScript (ADR 0015). Research: the [F-113 plan](https://github.com/ewels/nf-builder/blob/fe8624e/docs/plan/handoff/plan-F-113.md).

## Decision

- **Engine service.** The engine exposes a pure `EngineApi`: `open` with progress, `apply`, `applyPatches`, `writeFiles`, `project`, `diagnostics`, `palette` and revisions. It is in `packages/engine/src/service/` and carries no Comlink.
- **Worker bridge.** Comlink 4.4.2 is a runtime dependency of `@nf-builder/web` only. `engine.worker.ts` exposes the service, and `getEngine()` starts the module worker lazily. Progress callbacks cross as Comlink proxies.
- **Main thread.** The main thread keeps only pack versions, from a pack-free `version` export, and palette search. The palette, parser, model, projection, edits and diagnostics run in the worker. `window.nfBuilderEngine` is a test hook.
- **Diagnostics.** They come from `ProjectModel.diagnostics()` until F-112's diagnoser is wired in.
- **Worker bundles.**
  - Vite builds workers as ES modules. A plugin pair records worker chunks in `.vite/worker-manifest.json`.
  - `check:hosts` skips worker chunks built from JSON and scans worker code (amends ADR 0028's JSON rule).
  - Worker chunks stay outside QA-01, as ADR 0015 excludes them; F-702 revisits this.
- **Benchmark.**
  - `pnpm bench` runs a Chromium Playwright benchmark on pinned sarek with the page throttled 4×. Worker timings are unthrottled, because Chromium can't throttle workers, and the report says so.
  - It measures the cold and warm open, progress and frame gaps, and the p95 of 50 edits of each kind.
  - The CI `bench` job runs it, writes the table to the job summary and uploads `engine-bench`. It gates only on the bench running: F-702 gates QA-03, and QA-04 is reported (ADR 0030).
- **Step 2 check.** A Chromium performance trace checks that no parser code runs or compiles on the main thread.
- **Not yet done.**
  - No double-parse optimisation: the guard parse plus `commit`'s parse.
  - Loading progress is shown by F-202.

## Consequences

- The main bundle no longer holds the parser or catalogues: initial JavaScript fell from about 77 kB to 75 kB gzipped.
- First measurements, locally:
  - the sarek cold open takes 18.6 s, within QA-03's 30 s;
  - the edit p95 is 271 ms, over QA-04's 100 ms.

  The edit p95 is dominated by re-projecting the 722-line workflow and by the double parse. F-702 owns both.
- This clarifies ADR 0029's "CI reference profile" for workers: the profile throttles the page, and the worker runs unthrottled because Chromium can't throttle it. QA-02 and QA-03 say so. The decision stands unless the maintainer reopens it.

## Alternatives

- **A hand-written `postMessage` protocol:** more code than Comlink for the same result.
- **Throttling the whole browser with a cgroup CPU quota:** at a real 4×, sarek would take about 60 s and fail ADR 0029's ceiling.
- **Counting worker chunks in QA-01:** they don't block first paint.
