import { describe, expect, it } from "vitest";
import { exportFileName, exportSlug } from "../../src/export/name";

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
});
