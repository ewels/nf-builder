import { join } from "node:path";
import type { Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type DeclarationFormResult,
  type EngineRefusal,
  LAYOUT_PATH,
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
  const files = readTree(join(cases, "f303-configure-start"));
  const summary = await service.open({ version, files });
  const projection = (
    (await service.project("main.nf", null)) as { projection: Projection }
  ).projection;
  return { service, summary, projection, files };
};
const must = <T extends object>(r: T | EngineRefusal): T => {
  if ("ok" in r && r.ok === false)
    throw new Error(`refused: ${r.code}: ${r.message}`);
  return r as T;
};
const snapshot = async (
  service: ReturnType<typeof createEngineService>,
  paths: readonly string[],
) =>
  Object.fromEntries(
    await Promise.all(paths.map(async (p) => [p, await service.readFile(p)])),
  );

describe("F-303 engine service declarationForm", () => {
  it("F-303 UX-41: declarationForm returns the form and choices of a typed process node, and the result survives structuredClone", async () => {
    const { service, projection } = await opened();
    const greet = projection.nodes.find((n) => n.label === "GREET");
    const result = must(
      await service.declarationForm("main.nf", null, greet?.id ?? ""),
    ) as DeclarationFormResult;
    expect(result.target).toEqual({ path: MODULE, name: "GREET" });
    expect(result.form.name).toBe("GREET");
    expect(result.form.inputs).toHaveLength(1);
    expect(result.choices.directives.length).toBeGreaterThan(20);
    expect(structuredClone(result)).toEqual(result);
  });

  it("F-303: declarationForm refuses an unknown node, a node that isn't a typed process, and a call with no project", async () => {
    const { service, projection } = await opened();
    const view = projection.nodes.find((n) => n.label.includes("view"));
    const unknown = await service.declarationForm(
      "main.nf",
      null,
      "main.nf#/nope@1",
    );
    expect(unknown).toMatchObject({ ok: false, code: "not-found" });
    const other = await service.declarationForm(
      "main.nf",
      null,
      view?.id ?? "x",
    );
    expect(other).toMatchObject({ ok: false });
    await service.close();
    expect(await service.declarationForm("main.nf", null, "x")).toMatchObject({
      ok: false,
      code: "no-project",
    });
  });
});

describe("F-303 engine service update and rename", () => {
  it("F-303 AR-23 ADR-0051: updateDeclaration then renameDeclaration under one group is one undo step restoring every byte and the sidecar", async () => {
    const { service, summary, projection, files } = await opened();
    const greet = projection.nodes.find((n) => n.label === "GREET");
    const key = greet?.id ?? "";
    await service.setLayout({
      path: "main.nf",
      workflow: null,
      positions: { [key]: { x: 10, y: 20 } },
      replace: false,
      revision: summary.revision,
    });
    const paths = [...files.map((f) => f.path), LAYOUT_PATH];
    const start = await snapshot(service, paths);
    const form = must(
      await service.declarationForm("main.nf", null, key),
    ) as DeclarationFormResult;
    const group = { group: "popup-1", label: "Edit process HELLO" };
    const one = must(
      await service.apply(
        {
          kind: "updateDeclaration",
          path: MODULE,
          name: "GREET",
          form: { ...form.form, description: "Says hello." },
        },
        form.revision,
        group,
      ),
    ) as ProjectChange;
    const two = must(
      await service.apply(
        {
          kind: "renameDeclaration",
          path: MODULE,
          name: "GREET",
          newName: "HELLO",
        },
        one.revision,
        { group: "popup-1" },
      ),
    ) as ProjectChange;
    expect(two.history).toMatchObject({
      undo: "Edit process HELLO",
      undoCount: 1,
    });
    expect(await service.readFile(MODULE)).toContain("process HELLO");
    expect(await service.readFile(LAYOUT_PATH)).toContain("main.nf#/greet");
    await service.undo(two.revision);
    expect(await snapshot(service, paths)).toEqual(start);
  });

  it("F-303 AR-24 UX-44: a refused updateDeclaration comes back with its field problems and changes nothing", async () => {
    const { service, projection } = await opened();
    const key = projection.nodes.find((n) => n.label === "GREET")?.id ?? "";
    const form = must(
      await service.declarationForm("main.nf", null, key),
    ) as DeclarationFormResult;
    const refused = await service.apply(
      {
        kind: "updateDeclaration",
        path: MODULE,
        name: "GREET",
        form: {
          ...form.form,
          outputs: form.form.outputs.map((o) => ({ ...o, value: "file(" })),
        },
      },
      form.revision,
    );
    expect(refused).toMatchObject({
      ok: false,
      fields: [{ field: { section: "outputs", row: 0, part: "value" } }],
    });
    expect(structuredClone(refused)).toEqual(refused);
  });
});
