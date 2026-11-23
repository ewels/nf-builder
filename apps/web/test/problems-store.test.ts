import {
  type ApplyOutcome,
  type Diagnostic,
  EMPTY_HISTORY,
  type EngineApi,
  type EngineRefusal,
  type ProjectSummary,
  problemKey,
  type QuickFix,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createProblemsStore } from "../src/problems/problems-store";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const entry: WorkflowRef = {
  path: "main.nf",
  name: null,
  modelled: true,
  typed: true,
  range,
};
const summaryAt = (revision: number): ProjectSummary => ({
  revision,
  version: "26.10",
  files: [],
  workflows: [entry],
});
const fix: QuickFix = {
  title: "Replace `Channel` with `channel`",
  path: "main.nf",
  edits: [{ start: 95, end: 102, text: "channel" }],
};
const warning: Diagnostic = {
  path: "main.nf",
  range: { ...range, start: 95, end: 102 },
  severity: "warning",
  message: "The use of `Channel` is deprecated",
  code: "deprecated-channel",
  fix,
};
const suggestion: Diagnostic = {
  path: "main.nf",
  range: { ...range, start: 70, end: 78 },
  severity: "suggestion",
  message: "Legacy workflow",
  code: "legacy-workflow",
};

const refusal = (
  code: EngineRefusal["code"],
  message: string,
): EngineRefusal => ({
  ok: false,
  revision: null,
  code,
  message,
  path: null,
  problems: [],
});

/** A fake engine that records its calls; `diagnose` answers each pull. */
function fake(
  options: {
    diagnose?: (call: number) => Promise<Diagnostic[]> | Diagnostic[];
    revision?: () => number;
    applyFix?: () => Promise<ApplyOutcome>;
  } = {},
) {
  const calls: string[] = [];
  let pulls = 0;
  const revision = options.revision ?? (() => 1);
  const engine = {
    open: async () => summaryAt(revision()),
    project: async () => {
      calls.push("project");
      return {
        revision: revision(),
        projection: { workflow: entry, nodes: [], edges: [], statements: [] },
      };
    },
    diagnostics: async () => {
      const call = ++pulls;
      calls.push("diagnostics");
      const at = revision();
      const list = await (options.diagnose?.(call) ?? [warning, suggestion]);
      return { revision: at, diagnostics: list };
    },
    applyFix: async (...args: unknown[]) => {
      calls.push(`applyFix@${args[1]}`);
      return (
        options.applyFix?.() ??
        refusal("stale", "main.nf changed after its problems were checked.")
      );
    },
    history: async () => EMPTY_HISTORY,
    details: async () => refusal("no-project", "none"),
  } as unknown as EngineApi;
  return { engine, calls };
}

function setup(options: Parameters<typeof fake>[0] = {}) {
  const { engine, calls } = fake(options);
  const workspace = createCanvasStore(() => engine);
  const queue: (() => void)[] = [];
  const problems = createProblemsStore({
    engine: () => engine,
    workspace,
    schedule: (fn) => queue.push(fn),
  });
  /** Runs what was scheduled, then lets the pulls settle. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      while (queue.length > 0) queue.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { engine, calls, workspace, problems, settle };
}

describe("problems store", () => {
  it("F-309 UX-03 AR-30: showing a project pulls the diagnostics after the projection request and keeps them with their revision", async () => {
    const { workspace, problems, calls, settle } = setup();
    expect(problems.getState().status).toBe("idle");
    await workspace.getState().show(summaryAt(1));
    expect(problems.getState().status).toBe("loading");
    await settle();
    expect(calls).toEqual(["project", "diagnostics"]);
    const state = problems.getState();
    expect(state.status).toBe("ready");
    expect(state.revision).toBe(1);
    expect(state.sections.counts).toEqual({
      errors: 0,
      warnings: 1,
      suggestions: 1,
      problems: 1,
    });
    expect(state.diagnostics).toEqual([warning, suggestion]);
  });

  it("F-309: each new revision pulls again; one pull is in flight, the latest revision wins and an older result is dropped", async () => {
    let current = 1;
    const gates: (() => void)[] = [];
    const { workspace, problems, calls, settle } = setup({
      revision: () => current,
      diagnose: (call) =>
        call === 1
          ? new Promise((resolve) =>
              gates.push(() => resolve([warning, suggestion])),
            )
          : [suggestion],
    });
    await workspace.getState().show(summaryAt(1));
    await settle();
    expect(calls.filter((c) => c === "diagnostics")).toHaveLength(1);
    // the revision moves on while the first pull is still in flight
    current = 2;
    await workspace.getState().changed({
      revision: 2,
      files: [],
      workflows: [entry],
      history: EMPTY_HISTORY,
    } as never);
    await settle();
    // still one in flight: the second request waits for it
    expect(calls.filter((c) => c === "diagnostics")).toHaveLength(1);
    gates[0]?.();
    await settle();
    expect(calls.filter((c) => c === "diagnostics")).toHaveLength(2);
    const state = problems.getState();
    expect(state.revision).toBe(2);
    expect(state.diagnostics).toEqual([suggestion]);
    expect(state.status).toBe("ready");
  });

  it("F-309: closing or switching the project resets the diagnostics and closes the panel", async () => {
    const { workspace, problems, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await settle();
    problems.getState().show("suggestions", "k");
    expect(problems.getState().open).toBe(true);
    await workspace.getState().show(summaryAt(1));
    expect(problems.getState()).toMatchObject({
      status: "loading",
      open: false,
      diagnostics: [],
      focus: null,
    });
    await settle();
    expect(problems.getState().status).toBe("ready");
    workspace.setState({ summary: null, session: 99 });
    expect(problems.getState()).toMatchObject({
      status: "idle",
      diagnostics: [],
      open: false,
    });
  });

  it("F-309 UX-03: a failed pull reports its message", async () => {
    const { workspace, problems, settle } = setup({
      diagnose: () => Promise.reject(new Error("worker gone")),
    });
    await workspace.getState().show(summaryAt(1));
    await settle();
    expect(problems.getState()).toMatchObject({
      status: "failed",
      message: "worker gone",
    });
  });

  it("F-309 ADR-0042: a fix is sent with the diagnostics' revision and announces its title; a stale refusal pulls again and announces the refusal, with no retry", async () => {
    const applied = {
      ok: true,
      revision: 2,
      files: [],
      remodelled: [],
      workflows: [entry],
      history: EMPTY_HISTORY,
      label: fix.title,
    } as unknown as ApplyOutcome;
    let result: ApplyOutcome | null = applied;
    let current = 1;
    const { workspace, problems, calls, settle } = setup({
      revision: () => current,
      applyFix: async () =>
        result ?? refusal("stale", "main.nf changed after its problems."),
    });
    await workspace.getState().show(summaryAt(1));
    await settle();
    const outcome = await problems.getState().applyFix(warning);
    expect(outcome?.ok).toBe(true);
    expect(calls).toContain("applyFix@1");
    expect(problems.getState().notice).toBe(`Applied: ${fix.title}`);
    expect(problems.getState().applying).toBeNull();

    result = null;
    current = 2;
    await settle();
    const before = calls.filter((c) => c === "diagnostics").length;
    const refused = await problems.getState().applyFix(warning);
    expect(refused?.ok).toBe(false);
    expect(problems.getState().notice).toBe(
      "main.nf changed after its problems.",
    );
    await settle();
    expect(calls.filter((c) => c === "diagnostics").length).toBe(before + 1);
    expect(calls.filter((c) => c.startsWith("applyFix"))).toHaveLength(2);
    // a diagnostic without a fix is not sent
    expect(await problems.getState().applyFix(suggestion)).toBeNull();
  });

  it("F-309 UX-03: toggle opens the panel on a tab, switches tabs, and closes it on the open tab", () => {
    const { problems } = setup();
    const s = () => problems.getState();
    expect([s().open, s().view]).toEqual([false, "problems"]);
    s().toggle("suggestions");
    expect([s().open, s().view]).toEqual([true, "suggestions"]);
    s().toggle("problems");
    expect([s().open, s().view]).toEqual([true, "problems"]);
    s().toggle("problems");
    expect(s().open).toBe(false);
    s().show("problems", problemKey(warning));
    expect(s().focus).toBe(problemKey(warning));
    s().close();
    expect(s()).toMatchObject({ open: false, focus: null });
  });
});
