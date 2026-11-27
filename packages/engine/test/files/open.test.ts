import type { WorkflowRef } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { openTarget } from "../../src/files/open";

const range = { start: 0, end: 0 } as WorkflowRef["range"];
const ref = (path: string, name: string | null): WorkflowRef => ({
  path,
  name,
  modelled: true,
  typed: null,
  range,
});

describe("F-210 openTarget", () => {
  it("F-210 UX-20 UX-52: a script with an entry workflow opens it, one with only named workflows opens the first, anything else opens as a file, and .nf-builder/ files open read-only", () => {
    const workflows = [
      ref("a.nf", "B"),
      ref("a.nf", "A"),
      ref("main.nf", "X"),
      ref("main.nf", null),
    ];
    expect(openTarget("main.nf", workflows)).toEqual({
      kind: "workflow",
      path: "main.nf",
      workflow: null,
    });
    expect(openTarget("a.nf", workflows)).toEqual({
      kind: "workflow",
      path: "a.nf",
      workflow: "B",
    });
    for (const path of ["README.md", "nothing.nf"])
      expect(openTarget(path, workflows)).toEqual({
        kind: "file",
        path,
        readOnly: null,
      });
    expect(openTarget(".nf-builder/layout.json", workflows)).toEqual({
      kind: "file",
      path: ".nf-builder/layout.json",
      readOnly: "managed",
    });
  });
});
