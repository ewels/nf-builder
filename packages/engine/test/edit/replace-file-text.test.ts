import { describe, expect, it } from "vitest";
import { accepted, refused, stateFor } from "./helpers";

describe("F-111 ReplaceFileText", () => {
  it("F-111 AR-21 UX-44: ReplaceFileText applies parsing text as one trimmed edit", async () => {
    const state = await stateFor({
      "main.nf": "workflow {\n    A()\n}\n",
      "nextflow.config": "docker.enabled = true\n",
    });
    const r = accepted(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: "workflow {\n    A()\n    B()\n}\n",
    });
    expect(r.patches).toEqual([
      {
        kind: "edit",
        path: "main.nf",
        edits: [{ start: 19, end: 19, text: "    B()\n" }],
      },
    ]);
    expect(r.files).toEqual([
      { path: "main.nf", text: "workflow {\n    A()\n    B()\n}\n" },
    ]);
    // an unchanged text is a no-op
    const same = accepted(state, {
      kind: "replaceFileText",
      path: "nextflow.config",
      text: "docker.enabled = true\n",
    });
    expect(same.patches).toEqual([]);
    expect(same.files).toEqual([]);
  });

  it("F-111 AR-24 UX-44: text that doesn't parse is refused with the parser's message", async () => {
    const state = await stateFor({
      "main.nf": "workflow {\n    A()\n}\n",
      "nextflow.config": "docker.enabled = true\n",
    });
    const r = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: "workflow {\n    A(\n}\n",
    });
    expect(r.code).toBe("does-not-parse");
    expect(r.message).toContain(r.problems[0]?.message ?? "?");
    const c = refused(state, {
      kind: "replaceFileText",
      path: "nextflow.config",
      text: "docker {\n",
    });
    expect(c.code).toBe("does-not-parse");
  });

  it("F-111: plain files are always replaced; a missing path is refused", async () => {
    const state = await stateFor({ "README.md": "# hi\n", "main.nf": "" });
    const r = accepted(state, {
      kind: "replaceFileText",
      path: "README.md",
      text: "{ not ( parsed\n",
    });
    expect(r.files[0]?.text).toBe("{ not ( parsed\n");
    const m = refused(state, {
      kind: "replaceFileText",
      path: "nope.nf",
      text: "",
    });
    expect(m.code).toBe("not-found");
    expect(m.path).toBe("nope.nf");
  });
});
