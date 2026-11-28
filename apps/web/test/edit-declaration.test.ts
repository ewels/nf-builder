import {
  createEngineService,
  installedPackVersions,
  type TypedProcessForm,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";

const proc = (name: string) => `nextflow.enable.types = true

process ${name} {
    input:
    name: String

    output:
    text: Path = file('greeting.txt')

    script:
    """
    echo hi
    """
}
`;
const MAIN = `nextflow.enable.types = true

include { GREET } from './modules/local/greet/main.nf'
include { SAY } from './modules/local/say/main.nf'

workflow {
    a = GREET('world')
    b = SAY('world')
    a.view()
    b.view()
}
`;

async function setup(extra: Record<string, string> = {}) {
  const service = createEngineService();
  const store = createCanvasStore(() => service);
  await store.getState().open({
    version: installedPackVersions()[0] as string,
    files: [
      { path: "main.nf", text: MAIN },
      { path: "modules/local/greet/main.nf", text: proc("GREET") },
      { path: "modules/local/say/main.nf", text: proc("SAY") },
      ...Object.entries(extra).map(([path, text]) => ({ path, text })),
    ],
  });
  const nodeOf = async (name: string): Promise<string> => {
    const projected = await service.project("main.nf", null);
    if (!("projection" in projected) || projected.projection === null)
      throw new Error("no projection");
    const node = projected.projection.nodes.find((n) => n.label === name);
    if (node === undefined) throw new Error(`no node ${name}`);
    return node.id;
  };
  const formOf = async (name: string) => {
    const result = await service.declarationForm(
      "main.nf",
      null,
      await nodeOf(name),
    );
    if (!("form" in result)) throw new Error("no form");
    const target = result.target;
    return { form: result.form as TypedProcessForm, target };
  };
  const edit = async (
    name: string,
    change: (form: TypedProcessForm) => TypedProcessForm,
  ) => {
    const { form, target } = await formOf(name);
    return store.getState().editDeclaration({
      target,
      revision: store.getState().summary?.revision ?? 0,
      form: change(form),
      node: await nodeOf(name),
    });
  };
  return { service, store, edit };
}

describe("F-303 editDeclaration with the real engine", () => {
  it("F-303 AR-23: a refused rename after a name-only change keeps the earlier unrelated step", async () => {
    const { service, store, edit } = await setup();
    const first = await edit("SAY", (f) => ({ ...f, description: "Says." }));
    expect(first.ok).toBe(true);
    const steps = store.getState().history.undoCount;
    const refused = await edit("GREET", (f) => ({ ...f, name: "SAY" }));
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.message.match(/Nothing was changed/g)?.length).toBe(1);
    expect(store.getState().history.undoCount).toBe(steps);
    expect(await service.readFile("modules/local/greet/main.nf")).toBe(
      proc("GREET"),
    );
    const undone = await store.getState().undo();
    expect(undone.ok).toBe(true);
    expect(await service.readFile("modules/local/say/main.nf")).toBe(
      proc("SAY"),
    );
  });
});

describe("F-303 editDeclaration module folder", () => {
  it("F-303 LA-12: a case-only rename renames the process and keeps its folder", async () => {
    const { service, edit } = await setup();
    const outcome = await edit("GREET", (f) => ({ ...f, name: "Greet" }));
    expect(outcome.ok).toBe(true);
    expect(await service.readFile("modules/local/greet/main.nf")).toContain(
      "process Greet {",
    );
  });

  it("F-303 LA-12: a rename whose module folder is taken keeps the file where it is", async () => {
    const { service, edit } = await setup({
      "modules/local/hello/main.nf": proc("OTHER"),
    });
    const outcome = await edit("GREET", (f) => ({ ...f, name: "HELLO" }));
    expect(outcome.ok).toBe(true);
    expect(await service.readFile("modules/local/greet/main.nf")).toContain(
      "process HELLO {",
    );
    expect(await service.readFile("modules/local/hello/main.nf")).toContain(
      "process OTHER {",
    );
  });
});
