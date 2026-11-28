import { join } from "node:path";
import type { Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type DeclarationFormResult,
  type EngineRefusal,
  type ProjectChange,
} from "../../src";
import { installedPackVersions } from "../../src/packs";
import { readTree } from "../model/read-tree";

const version = installedPackVersions()[0] as string;
const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const MODULE = "modules/local/greet/main.nf";

const opened = async () => {
  const service = createEngineService();
  await service.open({
    version,
    files: readTree(join(cases, "f303-configure-start")),
  });
  const projection = (
    (await service.project("main.nf", null)) as { projection: Projection }
  ).projection;
  const node = projection.nodes.find((n) => n.label === "GREET")?.id ?? "";
  const form = (await service.declarationForm(
    "main.nf",
    null,
    node,
  )) as DeclarationFormResult;
  return { service, node, form };
};
const must = <T extends object>(r: T | EngineRefusal): T => {
  if ("ok" in r && r.ok === false)
    throw new Error(`refused: ${r.code}: ${r.message}`);
  return r as T;
};

describe("F-304 engine service declaration code", () => {
  it("F-304 UX-43: declarationForm returns the declaration's text and span", async () => {
    const { form } = await opened();
    const file = readTree(join(cases, "f303-configure-start")).find(
      (f) => f.path === MODULE,
    )?.text as string;
    expect(file.slice(form.span.start, form.span.end)).toBe(form.text);
    expect(form.text.startsWith("/**\n * Writes a greeting.")).toBe(true);
    expect(form.text.endsWith("}")).toBe(true);
  });

  it("F-304 step 1 UX-44: parseDeclaration gives the form of the edited text", async () => {
    const { service, form } = await opened();
    const text = form.text.replace("    input:", "    cpus 2\n\n    input:");
    const parsed = must(
      await service.parseDeclaration({ path: MODULE, name: "GREET", text }),
    );
    expect(parsed.name).toBe("GREET");
    expect(parsed.form.kind).toBe("typedProcess");
    if (parsed.form.kind === "typedProcess")
      expect(parsed.form.directives[0]).toMatchObject({
        name: "cpus",
        args: "2",
      });
    expect(parsed.choices.directives.length).toBeGreaterThan(20);
    expect(structuredClone(parsed)).toEqual(parsed);
  });

  it("F-304 step 2 UX-44: a text that doesn't parse is refused with problems on the declaration's lines", async () => {
    const { service, form } = await opened();
    const result = await service.parseDeclaration({
      path: MODULE,
      name: "GREET",
      text: form.text.replace("    cpus", "").replace("input:", "input: )"),
    });
    expect(result).toMatchObject({ ok: false, code: "does-not-parse" });
    const refusal = result as EngineRefusal;
    expect(refusal.problems[0]?.line).toBe(5);
  });

  it("F-304 step 3 UX-43: formatDeclaration prints the declaration the way the formatter does", async () => {
    const { service, form } = await opened();
    const messy = form.text
      .replace("    input:", "  input:")
      .replace("name: String", "name:   String");
    const result = must(
      await service.formatDeclaration({
        path: MODULE,
        name: "GREET",
        text: messy,
      }),
    );
    expect(result.text).toBe(form.text);
  });

  it("F-304 UX-44: declarationText with no base is what UpdateDeclaration writes for the form", async () => {
    const { service, form } = await opened();
    const edited = { ...form.form, description: "Says hello." };
    const shown = must(
      await service.declarationText({
        path: MODULE,
        name: "GREET",
        base: null,
        form: edited,
      }),
    );
    const applied = must(
      await service.apply(
        {
          kind: "updateDeclaration",
          path: MODULE,
          name: "GREET",
          form: edited,
        },
        form.revision,
      ),
    ) as ProjectChange;
    const text = applied.files.find((f) => f.path === MODULE)?.text as string;
    expect(text).toContain(shown.text);
    expect(shown.text).toContain("Says hello.");
  });

  it("F-304 UX-44: declarationText over a code text keeps a comment only the code text has", async () => {
    const { service, form } = await opened();
    const base = form.text.replace(
      "    script:",
      "    // only in the code\n    script:",
    );
    const parsed = must(
      await service.parseDeclaration({
        path: MODULE,
        name: "GREET",
        text: base,
      }),
    );
    const shown = must(
      await service.declarationText({
        path: MODULE,
        name: "GREET",
        base,
        form: { ...parsed.form, description: "Says hello." },
      }),
    );
    expect(shown.text).toContain("// only in the code");
    expect(shown.text).toContain("Says hello.");
  });

  it("F-304: the three calls refuse with no project", async () => {
    const service = createEngineService();
    const request = { path: MODULE, name: "GREET", text: "" };
    for (const result of [
      await service.parseDeclaration(request),
      await service.formatDeclaration(request),
    ])
      expect(result).toMatchObject({ ok: false, code: "no-project" });
    const { form } = await opened();
    expect(
      await service.declarationText({
        path: MODULE,
        name: "GREET",
        base: null,
        form: form.form,
      }),
    ).toMatchObject({ ok: false, code: "no-project" });
  });
});
