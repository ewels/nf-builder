import "fake-indexeddb/auto";
import {
  createEngineService,
  installedPackVersions,
  LAYOUT_PATH,
} from "@nf-builder/engine";
import { readZip } from "@nf-builder/sources/import";
import { IDBFactory } from "fake-indexeddb";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openProjectDb } from "../src/workspace/project-db";
import type { ExportResult } from "../src/workspace/types";
import { createWorkspace } from "../src/workspace/workspace";

const version = installedPackVersions()[0] as string;

const CASES = "../../../tools/oracle/cases/";
const raw = import.meta.glob<string>(
  [
    "../../../tools/oracle/cases/f111-start-typed/**/*.nf",
    "../../../tools/oracle/cases/f208-code-edit/**/*",
    "../../../tools/oracle/cases/f208-code-edit-after/**/*",
  ],
  { query: "?raw", import: "default", eager: true },
);
const tree = (id: string): Record<string, string> => {
  const prefix = `${CASES}${id}/`;
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, text]) => [path.slice(prefix.length), text]),
  );
};

function setup() {
  const factory = new IDBFactory();
  let ids = 0;
  const workspace = createWorkspace({
    engine: createEngineService(),
    openDb: () => openProjectDb(factory),
    newId: () => `id${++ids}`,
  });
  return { workspace, watching: workspace.watch(() => undefined) };
}
type Setup = ReturnType<typeof setup>;

/** Imports a tree through a zip with one top-level folder, as a GitHub archive has, and opens it. */
async function importTree(
  s: Setup,
  name: string,
  files: Record<string, string>,
) {
  await s.watching;
  const data: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files))
    data[`repo-1/${path}`] = new TextEncoder().encode(text);
  const staged = await s.workspace.stageZip(new Blob([zipSync(data)]), "x.zip");
  if (!staged.ok) throw new Error(staged.message);
  const meta = await s.workspace.createProject({
    name,
    languageVersion: version,
    files: [],
    import: { id: staged.id, ignore: staged.summary.ignore },
  });
  await s.workspace.openProject(meta.id);
}

const exported = async (s: Setup, layout: boolean) => {
  const result = await s.workspace.exportProject({ layout });
  if (!result.ok) throw new Error(result.message);
  return result;
};

/** The export's files by path, read back with the importer's reader (the folder stripped). */
function filesOf(result: ExportResult): Record<string, string> {
  const read = readZip(result.bytes);
  if (!read.ok) throw new Error(read.message);
  return Object.fromEntries(read.candidates.map((c) => [c.path, c.text ?? ""]));
}

describe("F-404 workspace export", () => {
  it("F-404 step 1 IO-20: after one renameDeclaration, every file outside the command's patches is byte-identical in the export (so equivalent) to its import", async () => {
    const s = setup();
    const source = tree("f111-start-typed");
    await importTree(s, "Typed start", source);
    const { revision } = (await s.workspace.diagnostics()) as {
      revision: number;
    };
    const applied = await s.workspace.apply(
      {
        kind: "renameDeclaration",
        path: "modules/local/count/main.nf",
        name: "COUNT",
        newName: "TALLY",
      },
      revision,
    );
    if (!applied.ok) throw new Error(applied.message);
    const touched = new Set(applied.patches.map((p) => p.path));
    expect(touched.size).toBeGreaterThan(0);
    const result = await exported(s, false);
    expect(result.fileName).toBe("Typed start.zip");
    const got = filesOf(result);
    expect(Object.keys(got).sort()).toEqual(Object.keys(source).sort());
    for (const [path, text] of Object.entries(source))
      if (touched.has(path)) expect(got[path], path).not.toBe(text);
      else expect(got[path], path).toBe(text);
  });

  it("F-404 step 2 IO-21: f208-code-edit imported from a zip, one replaceFileText, exported: the files equal f208-code-edit-after byte for byte (the CI oracle lints both cases)", async () => {
    const s = setup();
    await importTree(s, "Code edit", tree("f208-code-edit"));
    const after = tree("f208-code-edit-after");
    const { revision } = (await s.workspace.diagnostics()) as {
      revision: number;
    };
    const applied = await s.workspace.apply(
      {
        kind: "replaceFileText",
        path: "main.nf",
        text: after["main.nf"] as string,
      },
      revision,
    );
    if (!applied.ok) throw new Error(applied.message);
    expect(filesOf(await exported(s, false))).toEqual(after);
  });

  it("F-404 UX-62 ADR-0008: the sidecar is in the export only with layout true; .gitkeep files are always in it", async () => {
    const s = setup();
    await importTree(s, "Kept", {
      "main.nf":
        "process A {\n    script:\n    'A'\n}\n\nworkflow {\n    A()\n}\n",
      "modules/local/.gitkeep": "",
    });
    const { revision } = (await s.workspace.diagnostics()) as {
      revision: number;
    };
    const written = await s.workspace.setLayout({
      revision,
      path: "main.nf",
      workflow: null,
      positions: { "main.nf#/A@1": { x: 12, y: 34 } },
      replace: false,
    });
    if ("ok" in written) throw new Error(written.message);
    const sidecar = await s.workspace.readFile(LAYOUT_PATH);
    expect(sidecar).toContain("12");
    const without = filesOf(await exported(s, false));
    expect(Object.keys(without).sort()).toEqual([
      "main.nf",
      "modules/local/.gitkeep",
    ]);
    const withLayout = filesOf(await exported(s, true));
    expect(withLayout[LAYOUT_PATH]).toBe(sidecar);
    expect(withLayout["modules/local/.gitkeep"]).toBe("");
  });

  it("F-404 IO-20: a file with a byte order mark and a CRLF file come out byte for byte as they went in", async () => {
    const s = setup();
    const files = {
      "main.nf": "workflow {\n}\n",
      "bom.config": "\uFEFFparams.x = 1\n",
      "crlf.md": "one\r\ntwo\r\n",
    };
    await importTree(s, "Bytes", files);
    const out = unzipSync((await exported(s, false)).bytes);
    for (const [path, text] of Object.entries(files))
      expect(out[`Bytes/${path}`], path).toEqual(
        new TextEncoder().encode(text),
      );
  });

  it("F-404: exportProject refuses with no project and with no files, and is ordered after a pending apply", async () => {
    const s = setup();
    await s.watching;
    const none = await s.workspace.exportProject({ layout: true });
    expect(none).toMatchObject({ ok: false, code: "no-project" });
    const meta = await s.workspace.createProject({
      name: "Empty",
      languageVersion: version,
      files: [],
    });
    await s.workspace.openProject(meta.id);
    expect(await s.workspace.exportProject({ layout: true })).toMatchObject({
      ok: false,
      code: "invalid",
      message: "Nothing to export.",
    });
    // ordering: an apply queued first is in the export
    await s.workspace.writeFiles([{ path: "README.md", text: "one\n" }]);
    const { revision } = (await s.workspace.diagnostics()) as {
      revision: number;
    };
    const applying = s.workspace.apply(
      { kind: "replaceFileText", path: "README.md", text: "two\n" },
      revision,
    );
    const exporting = s.workspace.exportProject({ layout: false });
    await applying;
    const result = await exporting;
    if (!result.ok) throw new Error(result.message);
    expect(filesOf(result)["README.md"]).toBe("two\n");
  });
});
