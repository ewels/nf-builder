import { projectPathProblem } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { exportFileName, exportSlug } from "../../src/export/name";
import { zipProject } from "../../src/export/zip-project";
import { readZip } from "../../src/zip/read-zip";

describe("export names", () => {
  it("F-404 UX-62: exportFileName replaces unsafe characters, trims, caps at 100 characters and falls back to project.zip", () => {
    const table: [string, string][] = [
      ["hello-world", "hello-world.zip"],
      ["My pipeline", "My pipeline.zip"],
      ["a/b", "a-b.zip"],
      ['a:b*c?"d<e>f|g\\h', "a-b-c-d-e-f-g-h.zip"],
      ["a///b", "a-b.zip"],
      ["..", "project.zip"],
      [" .name. ", "name.zip"],
      ["--x--", "x.zip"],
      ["", "project.zip"],
      ["a\u0000b\nc", "a-b-c.zip"],
      ["rna 🧬", "rna 🧬.zip"],
      ["x".repeat(150), `${"x".repeat(100)}.zip`],
    ];
    for (const [name, file] of table)
      expect(exportFileName(name), name).toBe(file);
    expect(exportSlug("a/b")).toBe("a-b");
  });

  it("F-404 UX-62 IO-11: a name the importer skips or Windows reserves gets -project, and a re-import of such an export keeps every file", () => {
    for (const name of [
      "__MACOSX",
      "__macosx",
      "CON",
      "con",
      "Prn",
      "AUX",
      "NUL",
      "COM1",
      "com9",
      "LPT5",
      "nul.txt",
    ])
      expect(exportSlug(name), name).toBe(`${name}-project`);
    expect(exportSlug(".git")).toBe("git");
    expect(exportSlug("console")).toBe("console");
    expect(exportSlug("COM10")).toBe("COM10");
    const folder = exportSlug("__MACOSX");
    const files = [
      { path: "main.nf", text: "a" },
      { path: "modules/x.nf", text: "b" },
    ];
    const read = readZip(zipProject(files, { folder }));
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => c.path).sort()).toEqual(
      files.map((f) => f.path),
    );
    expect(projectPathProblem(folder)).toBeNull();
  });
});
