import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type BenchResult,
  benchReport,
  writeBenchReport,
} from "../../scripts/bench-report.ts";
import { REPO_ROOT } from "../../scripts/check-common.ts";
import { type EngineHook, readProject } from "../engine.ts";

const SAREK = join(REPO_ROOT, ".cache/corpus/sarek");
// Every process sarek.nf includes is already called in SAREK, and AddCall refuses a second call. So the bench first
// includes FASTQC again under another name (unmeasured), and AddCall adds a call to that.
const CALLEE = "FASTQC_BENCH";
const TARGET = { path: "workflows/sarek.nf", workflow: "SAREK" };
const WARMUP = 5;
const MEASURED = 50;

test("F-113 step 1 QA-03 QA-04: sarek open time and edit p95 in the engine worker, reported against budgets", async ({
  page,
  browserName,
}) => {
  if (!existsSync(SAREK))
    throw new Error("The sarek corpus is missing: run pnpm corpus:fetch");
  // corpus:fetch removes .git, so this is every project file
  const files = readProject(SAREK);
  const cdp = await page.context().newCDPSession(page);
  // QA-02's profile. It reaches the page but not the worker (Chromium can't throttle workers).
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("./");
  // not timed: place the files in the page
  await page.evaluate((f) => {
    (window as unknown as { __files: unknown }).__files = f;
  }, files);

  const measured = await page.evaluate(
    async ({ target, callee, warmup, count }) => {
      const w = window as unknown as {
        nfBuilderEngine: EngineHook;
        __files: { path: string; text: string }[];
      };
      const engine = w.nfBuilderEngine;
      const request = { version: "26.10", files: w.__files };

      let frameGap = 0;
      let last = performance.now();
      let watching = true;
      const tick = () => {
        const now = performance.now();
        frameGap = Math.max(frameGap, now - last);
        last = now;
        if (watching) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const timedOpen = async () => {
        let events = 0;
        let maxGap = 0;
        let lastEvent = performance.now();
        const start = lastEvent;
        const summary = await engine.open(request, () => {
          const now = performance.now();
          events += 1;
          maxGap = Math.max(maxGap, now - lastEvent);
          lastEvent = now;
        });
        return { summary, ms: performance.now() - start, events, maxGap };
      };
      const cold = await timedOpen();
      const warm = await timedOpen();
      watching = false;

      const original =
        w.__files.find((f) => f.path === target.path)?.text ?? "";
      const includeAt = original.indexOf("include { FASTQC ");
      if (includeAt < 0) throw new Error(`no FASTQC include in ${target.path}`);
      const text = `${original.slice(0, includeAt)}include { FASTQC as ${callee} } from '../modules/nf-core/fastqc'\n${original.slice(includeAt)}`;
      const written = await engine.writeFiles([{ path: target.path, text }]);
      if (written.revision === undefined) throw new Error("writeFiles failed");
      const at = text.indexOf("    main:\n");
      if (at < 0) throw new Error(`no main: block in ${target.path}`);
      const withComment = `${text.slice(0, at + 10)}    // bench\n${text.slice(at + 10)}`;
      const commands = {
        addCall: { kind: "addCall", target, callee },
        replaceFileText: {
          kind: "replaceFileText",
          path: target.path,
          text: withComment,
        },
      };
      let revision = written.revision;
      const edits: { kind: string; ms: number }[] = [];
      const failures: string[] = [];
      for (const kind of ["addCall", "replaceFileText"] as const) {
        for (let i = 0; i < warmup + count; i++) {
          const start = performance.now();
          const applied = await engine.apply(commands[kind], revision);
          if (!applied.ok) {
            failures.push(`${kind}: ${applied.code}: ${applied.message}`);
            break;
          }
          await engine.project(target.path, target.workflow);
          const ms = performance.now() - start;
          if (i >= warmup) edits.push({ kind, ms });
          // unmeasured undo
          const undone = await engine.applyPatches(
            applied.inverse,
            applied.revision ?? revision,
          );
          if (!undone.ok) {
            failures.push(`${kind}: undo refused`);
            break;
          }
          revision = undone.revision ?? revision;
        }
      }
      return {
        open: {
          files: request.files.length,
          coldMs: cold.ms,
          warmMs: warm.ms,
          progressEvents: cold.events,
          maxProgressGapMs: cold.maxGap,
          maxFrameGapMs: frameGap,
        },
        edits,
        failures,
      };
    },
    { target: TARGET, callee: CALLEE, warmup: WARMUP, count: MEASURED },
  );

  expect(measured.failures).toEqual([]);
  const result: BenchResult = {
    browser: browserName,
    cpuThrottle: 4,
    open: measured.open,
    edits: measured.edits,
  };
  expect(measured.edits).toHaveLength(2 * MEASURED);
  for (const n of [
    result.open.coldMs,
    result.open.warmMs,
    ...result.edits.map((e) => e.ms),
  ])
    expect(Number.isFinite(n)).toBe(true);
  const report = benchReport(result);
  writeBenchReport(report);
  console.log(
    report.rows
      .map((r) => `${r.id}: ${Math.round(r.measured)} ms of ${r.limit} ms`)
      .join("\n"),
  );
});
