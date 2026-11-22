import { readFileSync } from "node:fs";
import type { ScriptSourceFile, SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/edit/apply";
import { definitionStyles, problemKeys } from "../../src/edit/guards";
import { loadParser } from "../../src/source/parser";
import { createSourceFile } from "../../src/source/source-file";
import { accepted, refused, stateFor, texts, version } from "./helpers";

let parser: SourceParser;
beforeAll(async () => {
  parser = await loadParser(version);
});

const mixedAfterFlag = readFileSync(
  new URL(
    "../../../../tools/oracle/cases/f111-mixed-after-flag/main.nf",
    import.meta.url,
  ),
  "utf8",
);
const legacy =
  "process L {\n    input:\n    val x\n\n    script:\n    'l'\n}\n";
const typed =
  "process T {\n    input:\n    x: String\n\n    script:\n    'l'\n}\n";
const flag = "nextflow.enable.types = true\n\n";
const wf = "workflow {\n    L(1)\n}\n";

describe("F-111 guards", () => {
  it("F-111 AR-24: a result with a problem the file didn't have is refused, and nothing is written", async () => {
    const state = await stateFor({ "main.nf": wf });
    const before = texts(state);
    const r = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: "workflow {\n    L(1\n}\n",
    });
    expect(r.code).toBe("does-not-parse");
    expect(r.path).toBe("main.nf");
    expect(r.message).toContain("main.nf");
    expect(r.problems.length).toBeGreaterThan(0);
    expect(texts(state)).toEqual(before);
  });

  it("F-111 AR-24 ADR-0004: problems the file already had don't block an edit elsewhere", async () => {
    const state = await stateFor({
      "main.nf": `${legacy}\nworkflow {\n    L(1)\n}\n\nprocess {\n`,
    });
    expect(state.model.file("main.nf")?.source.status).toBe("partial");
    const ok = accepted(state, {
      kind: "addCall",
      target: { path: "main.nf", workflow: null },
      callee: "L",
    });
    expect(ok.files[0]?.text).toContain("L()");
    // and a repair that removes the problem is accepted too
    accepted(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${legacy}\nworkflow {\n    L(1)\n}\n`,
    });
  });

  it("F-111 step 3 LA-13: a legacy process before the types flag and a typed one after is refused with an explanation, though nextflow lint accepts it", async () => {
    const file = createSourceFile(
      "main.nf",
      mixedAfterFlag,
      parser,
    ) as ScriptSourceFile;
    expect(file.problems).toEqual([]);
    const state = await stateFor({ "main.nf": `${legacy}\n${wf}` });
    const r = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${legacy}\n${flag}${typed}\n${wf}`,
    });
    expect(r.code).toBe("mixed-definitions");
    expect(r.message).toContain("typed: T");
    expect(r.message).toContain("legacy: L");
    expect(r.message).toMatch(/can't mix/);
    expect(r.message).not.toMatch(/LA-13|26\.10/);
  });

  it("F-111 step 3 LA-13: legacy definitions added after the flag, or typed ones in a script without it, are refused with the explanation and nf-lang's message", async () => {
    const state = await stateFor({ "main.nf": `${flag}${typed}\n` });
    const a = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${flag}${typed}\n${legacy}`,
    });
    expect(a.code).toBe("mixed-definitions");
    expect(a.message).toContain("Invalid input declaration in typed process");
    expect(a.problems.some((p) => p.code === "mixed-definitions")).toBe(true);
    // the wrong-style definition is named under its own style, and nothing repeats
    expect(a.message).toContain("legacy: L");
    expect(a.message).not.toContain("none");
    expect(
      a.message.split("Invalid input declaration in typed process"),
    ).toHaveLength(2);
    const keys = a.problems.map((p) => `${p.message}@${p.line}:${p.column}`);
    expect(new Set(keys).size).toBe(keys.length);
    const state2 = await stateFor({ "main.nf": legacy });
    const b = refused(state2, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${legacy}\n${typed}`,
    });
    expect(b.code).toBe("mixed-definitions");
    expect(b.message).toContain(
      "Typed input declaration is not allowed in legacy process",
    );
    expect(b.message).toContain("typed: T");
    expect(b.message).not.toContain("none");
    expect(
      b.message.split("Typed input declaration is not allowed").length,
    ).toBe(2);
  });

  it("F-111 LA-13: the entry workflow is called the entry workflow in the refusal, and each nf-lang message is a sentence with its line", async () => {
    const state = await stateFor({ "main.nf": `${flag}${typed}\n${wf}` });
    const r = refused(state, {
      kind: "replaceFileText",
      path: "main.nf",
      text: `${flag}${typed}\n${legacy}\n${wf}`,
    });
    expect(r.code).toBe("mixed-definitions");
    expect(r.message).toContain("the entry workflow");
    expect(r.message).toContain("typed: T, the entry workflow");
    expect(r.message).not.toContain("none");
    expect(r.message).toMatch(
      /Invalid input declaration in typed process \(line \d+\)\./,
    );
  });

  it("F-111 LA-13 ADR-0004: a script that was already mixed can still be edited", async () => {
    const state = await stateFor({ "main.nf": mixedAfterFlag });
    const ok = accepted(state, {
      kind: "addCall",
      target: { path: "main.nf", workflow: null },
      callee: "TYPED_HELLO",
    });
    expect(ok.files[0]?.text).toContain("TYPED_HELLO()");
  });

  it("F-111 LA-13: problemKeys and definitionStyles describe a file", () => {
    const file = createSourceFile(
      "main.nf",
      `${legacy}\n${flag}${typed}`,
      parser,
    ) as ScriptSourceFile;
    expect(problemKeys(file)).toEqual([]);
    if (!file.ast) throw new Error("no ast");
    expect(definitionStyles(file.ast)).toMatchObject({
      typed: ["T"],
      legacy: ["L"],
      tagged: [],
    });
    const bad = createSourceFile(
      "main.nf",
      `${flag}${legacy}\nprocess {\n`,
      parser,
    ) as ScriptSourceFile;
    expect(problemKeys(bad).length).toBeGreaterThan(0);
    expect(problemKeys(bad)).toEqual([...problemKeys(bad)].sort());
  });

  it("F-111 AR-20: applyCommand never throws on an unknown command", async () => {
    const state = await stateFor({ "main.nf": wf });
    const r = applyCommand(state, { kind: "nope" } as never);
    expect(r.ok).toBe(false);
  });
});
