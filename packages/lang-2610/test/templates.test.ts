import type {
  ConfigBlock,
  ProjectTemplate,
  ScriptAst,
  TemplateSet,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { pack } from "../src/index";
import { docOf, expectedTags } from "./templates/doc-tags";

const EXPECTED = [{ id: "blank", name: "Blank" }] as const;

async function all(): Promise<{ set: TemplateSet; list: ProjectTemplate[] }> {
  const set = await pack.loadTemplates();
  return { set, list: [set.blank, ...set.templates] };
}
const file = (t: ProjectTemplate, path: string): string | undefined =>
  t.files.find((f) => f.path === path)?.text;

describe("F-203 the 26.10 templates", () => {
  it("F-203 LA-02 Q6: loadTemplates gives blank, then the other templates, with sentence-case names and descriptions", async () => {
    const { set, list } = await all();
    expect(set.blank.id).toBe("blank");
    expect(list.map((t) => ({ id: t.id, name: t.name }))).toEqual(EXPECTED);
    for (const t of list) {
      expect(t.name).toMatch(/^[A-Z][a-z0-9]*( [a-z0-9]+| MultiQC)*$/);
      expect(t.description).toMatch(/^[A-Z].*\.$/);
      expect(t.files.map((f) => f.path)).toEqual(
        t.files.map((f) => f.path).sort(),
      );
      expect(t.files.map((f) => f.path)).toEqual(
        expect.arrayContaining([
          "main.nf",
          "nextflow.config",
          "nextflow_schema.json",
          "README.md",
        ]),
      );
    }
    expect(await pack.loadTemplates()).toEqual(set);
  });

  it("F-203 LA-03: every template's nextflow.config sets manifest.nextflowVersion to '>=26.10.6'", async () => {
    const { parseConfig } = await pack.loadParser();
    for (const t of (await all()).list) {
      const parsed = parseConfig(file(t, "nextflow.config") ?? "");
      expect(parsed.status, t.id).toBe("modelled");
      expect(parsed.problems, t.id).toEqual([]);
      const manifest = parsed.ast?.statements.find(
        (s): s is ConfigBlock =>
          s.kind === "ConfigBlock" && s.name.name === "manifest",
      );
      const assign = manifest?.statements.find(
        (s) =>
          s.kind === "ConfigAssign" && s.path[0]?.name === "nextflowVersion",
      );
      expect(assign?.kind === "ConfigAssign" && assign.value.kind, t.id).toBe(
        "String",
      );
      expect(
        assign?.kind === "ConfigAssign" &&
          assign.value.kind === "String" &&
          assign.value.value,
        t.id,
      ).toBe(">=26.10.6");
    }
  });

  async function scripts() {
    const { parseScript } = await pack.loadParser();
    const out: {
      t: ProjectTemplate;
      path: string;
      text: string;
      ast: ScriptAst;
    }[] = [];
    for (const t of (await all()).list) {
      for (const f of t.files.filter((x) => x.path.endsWith(".nf"))) {
        const parsed = parseScript(f.text);
        expect(parsed.status, `${t.id}/${f.path}`).toBe("modelled");
        expect(parsed.problems, `${t.id}/${f.path}`).toEqual([]);
        if (!parsed.ast) throw new Error(`${t.id}/${f.path}: no AST`);
        out.push({ t, path: f.path, text: f.text, ast: parsed.ast });
      }
    }
    return out;
  }

  it("F-203 LA-11 LA-12: every .nf file starts with nextflow.enable.types = true; each process is alone in modules/local/<lower name>/main.nf", async () => {
    for (const { t, path, text, ast } of await scripts()) {
      const id = `${t.id}/${path}`;
      expect(text.startsWith("nextflow.enable.types = true\n"), id).toBe(true);
      expect(ast.typesEnabled, id).toBe(true);
      const processes = ast.body.filter((i) => i.kind === "Process");
      if (processes.length === 0) continue;
      expect(processes, id).toHaveLength(1);
      expect(
        ast.body.filter((i) => i.kind === "Workflow"),
        id,
      ).toEqual([]);
      const name = processes[0]?.kind === "Process" && processes[0].name.name;
      expect(path, id).toBe(
        `modules/local/${String(name).toLowerCase()}/main.nf`,
      );
    }
  });

  it("F-203 LA-40: every main.nf has a typed params block; a template that publishes does it through an output block; no publishDir anywhere", async () => {
    for (const { t, path, text, ast } of await scripts()) {
      expect(text, `${t.id}/${path}`).not.toContain("publishDir");
      if (path !== "main.nf") continue;
      expect(
        ast.body.filter((i) => i.kind === "ParamsBlock"),
        t.id,
      ).toHaveLength(1);
      const publishes = ast.body.some(
        (i) =>
          i.kind === "Workflow" && i.name === null && i.publishers !== null,
      );
      const output = ast.body.some((i) => i.kind === "OutputBlock");
      expect(output, t.id).toBe(publishes);
    }
  });

  it("F-203 LA-45 ADR-0032: every template script is a printer fixed point", async () => {
    const { parseScript, printer } = await pack.loadParser();
    for (const { t, path, text } of await scripts()) {
      const parsed = parseScript(text);
      if (!parsed.ast) throw new Error("no AST");
      const printed = printer.printScript(parsed.ast, {
        layout: printer.createLayout(text),
      });
      expect(printed.text, `${t.id}/${path}`).toBe(text);
    }
  });

  it("F-203 step 3 LA-50 ADR-0013: every process and workflow, the entry workflow included, has a doc comment with Markdown text, an @param per input or take and an @return per output or emit", async () => {
    for (const { t, path, ast } of await scripts()) {
      for (const item of ast.body) {
        if (item.kind !== "Process" && item.kind !== "Workflow") continue;
        const id = `${t.id}/${path} ${item.name?.name ?? "entry workflow"}`;
        const doc = docOf(item);
        expect(doc, id).not.toBeNull();
        expect(doc?.text.length, id).toBeGreaterThan(0);
        const want = expectedTags(item);
        expect(doc?.params, id).toEqual(want.params);
        expect(doc?.returns.length, id).toBe(want.returns);
      }
    }
  });

  it("F-203 step 3 LA-53: every params-block parameter has a non-empty description in nextflow_schema.json, and the schema lists no other parameters", async () => {
    for (const { t, path, ast } of await scripts()) {
      if (path !== "main.nf") continue;
      const block = ast.body.find((i) => i.kind === "ParamsBlock");
      const names =
        block?.kind === "ParamsBlock"
          ? block.params.map((p) => p.name.name)
          : [];
      const schema = JSON.parse(file(t, "nextflow_schema.json") ?? "{}") as {
        $schema: string;
        $id?: string;
        $defs: Record<
          string,
          { properties: Record<string, { description?: string }> }
        >;
      };
      expect(schema.$schema, t.id).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.$id, t.id).toBeUndefined();
      const described = Object.values(schema.$defs).flatMap((d) =>
        Object.entries(d.properties),
      );
      for (const [name, prop] of described) {
        expect(prop.description?.length, `${t.id} ${name}`).toBeGreaterThan(0);
      }
      expect(described.map(([n]) => n).sort(), t.id).toEqual([...names].sort());
    }
  });
});
