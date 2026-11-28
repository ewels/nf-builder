import { describe, expect, it } from "vitest";
import { pack } from "../src/index";
import { scaffold } from "../src/scaffold";

describe("F-111 the new-process template", () => {
  it("F-111 step 2 LA-12 LA-11: the new-process template sets nextflow.enable.types = true and defines one typed process", async () => {
    const { parseScript } = await pack.loadParser();
    for (const name of ["HELLO", "A", "FASTQC_2", "_x"]) {
      const text = scaffold.process(name);
      const parsed = parseScript(text);
      expect(parsed.status).toBe("modelled");
      expect(parsed.problems).toEqual([]);
      const body = parsed.ast?.body ?? [];
      expect(body.map((item) => item.kind)).toEqual(["FeatureFlag", "Process"]);
      const proc = body[1];
      if (proc?.kind !== "Process") throw new Error("no process");
      expect(proc.name.name).toBe(name);
      expect(proc.typed).toBe(true);
      expect(parsed.ast?.typesEnabled).toBe(true);
    }
  });

  it("F-111 LA-45 ADR-0032: the template is a printer fixed point", async () => {
    const { parseScript, printer } = await pack.loadParser();
    const text = scaffold.process("HELLO");
    const parsed = parseScript(text);
    if (!parsed.ast) throw new Error("no AST");
    const printed = printer.printScript(parsed.ast, {
      layout: printer.createLayout(text),
    });
    expect(printed.text).toBe(text);
  });

  it("F-111 LA-02: the pack provides the template without loading the parser", () => {
    expect(pack.scaffold).toBe(scaffold);
    expect(pack.scaffold.process("X")).toContain("process X {");
  });
});

describe("F-301 the new-workflow template", () => {
  it("F-301 LA-12 LA-11: the new-workflow template sets nextflow.enable.types = true and defines one named workflow", async () => {
    const { parseScript } = await pack.loadParser();
    for (const name of ["HELLO", "A", "X_2", "_x"]) {
      const parsed = parseScript(scaffold.workflow(name));
      expect(parsed.status).toBe("modelled");
      expect(parsed.problems).toEqual([]);
      const body = parsed.ast?.body ?? [];
      expect(body.map((item) => item.kind)).toEqual([
        "FeatureFlag",
        "Workflow",
      ]);
      const wf = body[1];
      if (wf?.kind !== "Workflow") throw new Error("no workflow");
      expect(wf.name?.name).toBe(name);
      expect(parsed.ast?.typesEnabled).toBe(true);
    }
  });

  it("F-301 LA-45 ADR-0032: the new-workflow template is a printer fixed point", async () => {
    const { parseScript, printer } = await pack.loadParser();
    const text = scaffold.workflow("HELLO");
    const parsed = parseScript(text);
    if (!parsed.ast) throw new Error("no AST");
    const printed = printer.printScript(parsed.ast, {
      layout: printer.createLayout(text),
    });
    expect(printed.text).toBe(text);
  });
});
