import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type EngineRefusal,
  type ProjectFiles,
} from "../../src";
import { installedPackVersions } from "../../src/packs";

const version = installedPackVersions()[0] as string;
const proc = "process A {\n    script:\n    'a'\n}\n";
const start = [
  { path: "main.nf", text: "workflow {\n}\n" },
  { path: "README.md", text: "# Hi\n" },
  { path: "modules/nf-core/a/main.nf", text: proc },
];

const ok = (r: ProjectFiles | EngineRefusal): ProjectFiles => {
  if ("ok" in r) throw new Error(`refused: ${r.message}`);
  return r;
};
const opened = async () => {
  const service = createEngineService();
  const summary = await service.open({ version, files: start });
  return { service, summary };
};

describe("F-210 engine listFiles", () => {
  it("F-210 UX-16: listFiles gives each file's language, parse status and problem count, sorted, and the registry folders, at the current revision", async () => {
    const { service, summary } = await opened();
    const r = ok(await service.listFiles());
    expect(r.revision).toBe(summary.revision);
    expect(r.files).toEqual(summary.files);
    expect(r.files.map((f) => f.path)).toEqual([
      "README.md",
      "main.nf",
      "modules/nf-core/a/main.nf",
    ]);
    expect(r.files[0]).toMatchObject({ language: "markdown", status: "plain" });
    expect(r.files[1]).toMatchObject({ status: "modelled", problems: 0 });
    expect(r.registry).toEqual([]);
  });

  it("F-210 UX-16: after writeFiles adds meta.yml beside a main.nf, listFiles lists the registry folder; after a syntax error is written, that file fails", async () => {
    const { service } = await opened();
    await service.writeFiles([
      { path: "modules/nf-core/a/meta.yml", text: "name: a\n" },
    ]);
    expect(ok(await service.listFiles()).registry).toEqual([
      { path: "modules/nf-core/a", module: "nf-core/a" },
    ]);
    await service.writeFiles([{ path: "main.nf", text: "workflow {\n" }]);
    const main = ok(await service.listFiles()).files.find(
      (f) => f.path === "main.nf",
    );
    expect(main && (main.problems > 0 || main.status !== "modelled")).toBe(
      true,
    );
  });

  it("F-210 AR-23 ADR-0051: createFile is one undo step that undo removes; writeFiles clears the history", async () => {
    const { service, summary } = await opened();
    const applied = await service.apply(
      { kind: "createFile", path: "notes.txt" },
      summary.revision,
      { label: "Create notes.txt" },
    );
    expect(applied.ok).toBe(true);
    const has = async () =>
      ok(await service.listFiles()).files.some((f) => f.path === "notes.txt");
    expect(await has()).toBe(true);
    expect((await service.history()).undoCount).toBe(1);
    const undone = await service.undo(ok(await service.listFiles()).revision);
    expect(undone.ok).toBe(true);
    expect(await has()).toBe(false);
    await service.apply(
      { kind: "createFile", path: "b.txt" },
      ok(await service.listFiles()).revision,
    );
    expect((await service.history()).undoCount).toBe(1);
    await service.writeFiles([{ path: "c.txt", text: "c" }]);
    expect((await service.history()).undoCount).toBe(0);
  });

  it("F-210 ADR-0003: listFiles survives structuredClone", async () => {
    const { service } = await opened();
    const r = await service.listFiles();
    expect(structuredClone(r)).toEqual(r);
  });

  it("F-210 UX-16: listFiles with no project open is refused", async () => {
    const r = await createEngineService().listFiles();
    expect(r).toMatchObject({ ok: false, code: "no-project" });
  });
});
