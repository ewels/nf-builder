import { describe, expect, it, vi } from "vitest";
import { PatchError } from "../../src/edit/patches";

let failNext = false;
vi.mock("../../src/edit/apply", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/edit/apply")>();
  return {
    ...original,
    patchSequence: (...args: Parameters<typeof original.patchSequence>) => {
      if (failNext) {
        failNext = false;
        throw new PatchError("the text moved");
      }
      return original.patchSequence(...args);
    },
  };
});

const { createEngineService } = await import("../../src");
const { installedPackVersions } = await import("../../src/packs");

const version = installedPackVersions()[0] as string;
const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const files = [
  {
    path: "main.nf",
    text: "include { A } from './a.nf'\n\nworkflow {\n    A()\n}\n",
  },
  { path: "a.nf", text: proc("A") },
];
const edit = (n: number) => ({
  kind: "replaceFileText" as const,
  path: "a.nf",
  text: `${proc("A")}// ${n}\n`,
});

describe("F-209 engine history failures", () => {
  it("F-209 AR-23: a PatchError while undoing is an internal refusal that changes nothing and clears the history", async () => {
    const service = createEngineService();
    const summary = await service.open({ version, files });
    const applied = await service.apply(edit(1), summary.revision);
    if (!applied.ok) throw new Error("apply refused");
    expect((await service.history()).undoCount).toBe(1);
    failNext = true;
    const refused = await service.undo(applied.revision);
    expect(refused).toMatchObject({ ok: false, code: "internal" });
    if (refused.ok) throw new Error("expected a refusal");
    expect(refused.message).toMatch(/history was cleared/);
    expect(await service.readFile("a.nf")).toBe(`${proc("A")}// 1\n`);
    expect(await service.history()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    expect(await service.undo(applied.revision)).toMatchObject({
      code: "no-history",
    });
  });
});
