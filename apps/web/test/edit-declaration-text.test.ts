import {
  createEngineService,
  type DeclarationFormResult,
  installedPackVersions,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createPopupStore } from "../src/popup/popup-store";

const MODULE = "modules/local/greet/main.nf";
const GREET = `nextflow.enable.types = true

/**
 * Writes a greeting.
 */
process GREET {
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

workflow {
    a = GREET('world')
    a.view()
}
`;

async function setup() {
  const service = createEngineService();
  const store = createCanvasStore(() => service);
  await store.getState().open({
    version: installedPackVersions()[0] as string,
    files: [
      { path: "main.nf", text: MAIN },
      { path: MODULE, text: GREET },
    ],
  });
  const projected = await service.project("main.nf", null);
  if (!("projection" in projected) || projected.projection === null)
    throw new Error("no projection");
  const node = projected.projection.nodes.find((n) => n.label === "GREET")?.id;
  const read = (await service.declarationForm(
    "main.nf",
    null,
    node ?? "",
  )) as DeclarationFormResult;
  const edit = (text: string, name = "GREET", revision?: number) =>
    store.getState().editDeclarationText({
      target: read.target,
      revision: revision ?? store.getState().summary?.revision ?? 0,
      text,
      name,
      node: node ?? "",
    });
  return { service, store, read, edit };
}

describe("F-304 editDeclarationText with the real engine", () => {
  it("F-304 step 1 UX-44 AR-23: a code edit is one undo step labelled Edit process, and undo restores the bytes", async () => {
    const { service, store, read, edit } = await setup();
    const outcome = await edit(
      read.text.replace("    input:", "    cpus 2\n\n    input:"),
    );
    expect(outcome.ok).toBe(true);
    expect(await service.readFile(MODULE)).toContain("    cpus 2\n");
    expect(store.getState().history).toMatchObject({
      undo: "Edit process GREET",
      undoCount: 1,
    });
    expect((await store.getState().undo()).ok).toBe(true);
    expect(await service.readFile(MODULE)).toBe(GREET);
  });

  it("F-304 UX-44 AR-23: a renamed declaration is rename, replace and the module folder's move in one undo step", async () => {
    const { service, store, read, edit } = await setup();
    const outcome = await edit(read.text.replaceAll("GREET", "HELLO"), "HELLO");
    expect(outcome.ok).toBe(true);
    expect(await service.readFile("modules/local/hello/main.nf")).toContain(
      "process HELLO {",
    );
    expect(await service.readFile("main.nf")).toContain("HELLO('world')");
    expect(store.getState().history).toMatchObject({
      undo: "Edit process HELLO",
      undoCount: 1,
    });
    await store.getState().undo();
    expect(await service.readFile(MODULE)).toBe(GREET);
    expect(await service.readFile("main.nf")).toBe(MAIN);
  });

  it("F-304 UX-44 ADR-0066: a stale revision is refused with nothing changed", async () => {
    const { service, store, read, edit } = await setup();
    const outcome = await edit(read.text, "GREET", 999);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/changed since/);
    expect(store.getState().history.undoCount).toBe(0);
    expect(await service.readFile(MODULE)).toBe(GREET);
  });

  it("F-304 AR-24 UX-44: a refused part is discarded and the popup is told why", async () => {
    const { service, store, read, edit } = await setup();
    const outcome = await edit(`${read.text.slice(0, -1)}`);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/Couldn't apply/);
    expect(store.getState().history.undoCount).toBe(0);
    expect(await service.readFile(MODULE)).toBe(GREET);
    // a rename whose replace is refused leaves the rename undone too
    const renamed = await edit(
      read.text.replaceAll("GREET", "HELLO").slice(0, -1),
      "HELLO",
    );
    expect(renamed.ok).toBe(false);
    expect(await service.readFile("main.nf")).toBe(MAIN);
    expect(store.getState().history.undoCount).toBe(0);
  });

  it("F-304 UX-44 AR-23: a rename made in Configure after a Code edit renames the file, folder and calls in one undo step", async () => {
    const { service, store, read } = await setup();
    const popup = createPopupStore({
      canvas: store,
      engine: () => service,
      readOnly: () => false,
    });
    const projected = await service.project("main.nf", null);
    if (!("projection" in projected) || projected.projection === null)
      throw new Error("no projection");
    const node = projected.projection.nodes.find((n) => n.label === "GREET");
    await popup
      .getState()
      .openPopup({ tab: "main.nf#", node: node?.id ?? "", opener: null });
    await popup.getState().showSection("code");
    popup.getState().editCode(read.text.replace("    input:", "    cpus 2\n\n    input:"));
    await popup.getState().flushCode();
    await popup.getState().showSection("configure");
    popup.getState().updateDraft((d) => ({ ...d, name: "HELLO" }));
    await popup.getState().applyPopup();
    expect(popup.getState().status).toBe("closed");
    const moved = await service.readFile("modules/local/hello/main.nf");
    expect(moved).toContain("process HELLO {");
    expect(moved).toContain("    cpus 2\n");
    expect(await service.readFile("main.nf")).toContain("HELLO('world')");
    expect(store.getState().history).toMatchObject({ undoCount: 1 });
    await store.getState().undo();
    expect(await service.readFile(MODULE)).toBe(GREET);
    expect(await service.readFile("main.nf")).toBe(MAIN);
  });
});
