import { describe, expect, it } from "vitest";
import { scriptActivity } from "../e2e/trace.ts";

const url = "http://localhost:4173/assets/source-abc.js";
const thread = (pid: number, tid: number, name: string) => ({
  ph: "M",
  name: "thread_name",
  pid,
  tid,
  args: { name },
});
const profile = (pid: number, tid: number, id: string) => ({
  ph: "P",
  name: "Profile",
  pid,
  tid,
  id,
  args: { data: { startTime: 0 } },
});
const chunk = (
  pid: number,
  tid: number,
  id: string,
  nodes: { id: number; url: string }[],
  samples: number[],
) => ({
  ph: "P",
  name: "ProfileChunk",
  pid,
  tid,
  id,
  args: {
    data: {
      cpuProfile: {
        nodes: nodes.map((n) => ({ id: n.id, callFrame: { url: n.url } })),
        samples,
      },
    },
  },
});

describe("trace analysis", () => {
  it("F-113 step 2: scriptActivity attributes CPU samples and module compiles to threads by URL", () => {
    const trace = {
      traceEvents: [
        thread(1, 10, "CrRendererMain"),
        thread(1, 20, "DedicatedWorker thread"),
        thread(1, 30, "v8:ProfEvntProc"),
        profile(1, 10, "0x1"),
        profile(1, 20, "0x2"),
        chunk(
          1,
          10,
          "0x1",
          [
            { id: 1, url: "" },
            { id: 2, url: "http://localhost:4173/assets/index.js" },
          ],
          [1, 2, 2],
        ),
        // the nodes arrive in one chunk and samples in the next
        chunk(1, 30, "0x2", [{ id: 1, url }], [1, 1]),
        chunk(1, 30, "0x2", [], [1]),
        {
          ph: "X",
          name: "v8.compileModule",
          pid: 1,
          tid: 20,
          args: { fileName: url },
        },
        {
          ph: "X",
          name: "v8.compileModule",
          pid: 1,
          tid: 10,
          args: { fileName: "http://localhost:4173/assets/index.js" },
        },
        {
          ph: "X",
          name: "v8.evaluateModule",
          pid: 1,
          tid: 20,
          args: { fileName: url },
        },
      ],
    };
    const activity = scriptActivity(trace, (u) => u.includes("source-"));
    expect(activity.get("CrRendererMain")).toEqual({
      samples: 0,
      total: 3,
      compiles: 0,
    });
    expect(activity.get("DedicatedWorker thread")).toEqual({
      samples: 3,
      total: 3,
      compiles: 1,
    });
  });

  it("F-113 step 2: a trace without thread names or profiles is rejected", () => {
    expect(() => scriptActivity({ traceEvents: [] }, () => true)).toThrow(
      /thread/i,
    );
    expect(() =>
      scriptActivity(
        { traceEvents: [thread(1, 10, "CrRendererMain")] },
        () => true,
      ),
    ).toThrow(/profile/i);
  });

  it("F-113 step 2: a thread whose profile has no samples reports a zero total (main thread not profiled)", () => {
    const trace = {
      traceEvents: [
        thread(1, 10, "CrRendererMain"),
        thread(1, 20, "DedicatedWorker thread"),
        thread(1, 30, "v8:ProfEvntProc"),
        profile(1, 10, "0x1"),
        profile(1, 20, "0x2"),
        chunk(1, 30, "0x2", [{ id: 1, url }], [1]),
      ],
    };
    const activity = scriptActivity(trace, (u) => u.includes("source-"));
    expect(activity.get("CrRendererMain")).toEqual({
      samples: 0,
      total: 0,
      compiles: 0,
    });
    expect(activity.get("DedicatedWorker thread")?.total).toBe(1);
  });
});
