import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTree } from "../model/read-tree";
import {
  accepted,
  commit,
  projection,
  refused,
  stateFor,
  texts,
} from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const tree = (id: string) =>
  Object.fromEntries(
    readTree(join(cases, id)).map((f) => [f.path, f.text] as const),
  );

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

describe("F-111 ReplaceFileText targets the whole file", () => {
  const other = "process P {\n    script:\n    'p'\n}\n";

  it("F-111 AR-22 AR-24: appending text to a file that ends in an unclosed brace is accepted; the trailing Unparsed item takes it and other files are untouched", async () => {
    const text = "workflow {\n    A()\n";
    const state = await stateFor({ "main.nf": text, "p.nf": other });
    const r = accepted(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${text}// note\n`,
    });
    expect(r.patches.map((p) => p.path)).toEqual(["main.nf"]);
    commit(state, r);
    const file = state.model.file("main.nf")?.source;
    // the same problems as before (AR-24), and the note is now part of the unparsed item
    expect(file?.problems.map((p) => p.message)).toEqual(
      (await stateFor({ "main.nf": text })).model
        .file("main.nf")
        ?.source.problems.map((p) => p.message),
    );
    expect(state.model.file("p.nf")?.source.text).toBe(other);
  });

  it("F-111 AR-22 AR-24: inserting /* so that it swallows a later line comment is accepted when nothing new is wrong; other files are untouched", async () => {
    const text = "// line\n/* two */\nworkflow {\n    A()\n}\n";
    const state = await stateFor({ "main.nf": text, "p.nf": other });
    const r = accepted(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `/*${text}`,
    });
    expect(r.patches.map((p) => p.path)).toEqual(["main.nf"]);
    commit(state, r);
    const comments = state.model.file("main.nf")?.source.comments ?? [];
    expect(comments.some((c) => c.text === "// line")).toBe(false);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    expect(state.model.file("p.nf")?.source.text).toBe(other);
  });

  it("F-111 AR-22 AR-24: deleting a line break joins a line comment to the next line; the result is accepted and other files are untouched", async () => {
    const text = "// first\nworkflow {\n    A()\n}\n";
    const state = await stateFor({ "main.nf": text, "p.nf": other });
    const r = accepted(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: text.replace("// first\n", "// first "),
    });
    commit(state, r);
    const comments = state.model.file("main.nf")?.source.comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe("// first workflow {");
    expect(r.patches.map((p) => p.path)).toEqual(["main.nf"]);
    expect(state.model.file("p.nf")?.source.text).toBe(other);
  });
});

describe("F-208 the Code view fixture", () => {
  it("F-208 step 2 AR-24 ADR-0039: the f208 invalid edit is refused with does-not-parse and a problem on the edited line; the valid edit is accepted, its text equals f208-code-edit-after, and the projection gains one node", async () => {
    const before = tree("f208-code-edit");
    const after = tree("f208-code-edit-after");
    const state = await stateFor(before);
    const nodes = projection(state).nodes.length;

    const line = "    greeted = GREET(names)";
    const lineNumber =
      (before["main.nf"] as string).split("\n").indexOf(line) + 1;
    const bad = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: (before["main.nf"] as string).replace(line, `${line} )`),
    });
    expect(bad.code).toBe("does-not-parse");
    expect(bad.problems.map((p) => p.line)).toContain(lineNumber);
    expect(texts(state)).toEqual(before);

    commit(
      state,
      accepted(state, {
        kind: "replaceFileText",
        path: "main.nf",
        text: after["main.nf"] as string,
      }),
    );
    expect(texts(state)["main.nf"]).toBe(after["main.nf"]);
    expect(projection(state).nodes.length).toBe(nodes + 1);
  });
});
