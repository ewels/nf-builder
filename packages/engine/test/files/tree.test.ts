import { describe, expect, it } from "vitest";
import { failedParse, fileTreeRows, folderSet } from "../../src/files/tree";
import type { FileSummary } from "../../src/service/types";

const file = (path: string, extra: Partial<FileSummary> = {}): FileSummary => ({
  path,
  language: "nextflow",
  status: "modelled",
  problems: 0,
  ...extra,
});
const files = [
  file("main.nf"),
  file("README.md", { language: "markdown", status: "plain" }),
  file("modules/local/b/main.nf"),
  file("modules/nf-core/fastqc/main.nf"),
  file("modules/nf-core/fastqc/meta.yml", {
    language: "yaml",
    status: "plain",
  }),
  file("assets/.gitkeep", { language: "text", status: "plain" }),
  file("item10.txt", { language: "text", status: "plain" }),
  file("Item2.txt", { language: "text", status: "plain" }),
  file(".nf-builder/layout.json", { language: "json", status: "plain" }),
];
const all = (paths: string[]) => new Set(paths);

describe("F-210 file tree rows", () => {
  it("F-210 UX-16: rows list files before folders at each level, each by case-insensitive natural name order, with aria levels, set sizes and positions", () => {
    const rows = fileTreeRows({
      files,
      registry: [],
      expanded: all(["modules", "modules/nf-core"]),
    });
    expect(rows.map((r) => r.path)).toEqual([
      "Item2.txt",
      "item10.txt",
      "main.nf",
      "README.md",
      ".nf-builder",
      "assets",
      "modules",
      "modules/local",
      "modules/nf-core",
      "modules/nf-core/fastqc",
    ]);
    const top = rows.filter((r) => r.level === 1);
    expect(top.map((r) => [r.setSize, r.posInSet])).toEqual(
      top.map((_, i) => [top.length, i + 1]),
    );
    expect(top.length).toBe(7);
    const modules = rows.find((r) => r.path === "modules");
    expect(modules).toMatchObject({ level: 1, kind: "folder", parent: null });
    expect(rows.find((r) => r.path === "modules/nf-core")).toMatchObject({
      level: 2,
      setSize: 2,
      posInSet: 2,
      parent: "modules",
    });
  });

  it("F-210 UX-16: a collapsed folder hides its descendants and an expanded one shows its children; parents are set", () => {
    const closed = fileTreeRows({ files, registry: [], expanded: all([]) });
    expect(closed.every((r) => r.level === 1)).toBe(true);
    expect(closed.find((r) => r.path === "modules")?.expanded).toBe(false);
    expect(closed.find((r) => r.path === "main.nf")?.expanded).toBeNull();
    const open = fileTreeRows({
      files,
      registry: [],
      expanded: all(["modules/local", "modules"]),
    });
    expect(open.map((r) => r.path)).toContain("modules/local/b");
    expect(open.map((r) => r.path)).not.toContain("modules/local/b/main.nf");
    // an expanded folder under a collapsed one stays hidden
    const hidden = fileTreeRows({
      files,
      registry: [],
      expanded: all(["modules/local"]),
    });
    expect(hidden.map((r) => r.path)).not.toContain("modules/local");
    expect(open.find((r) => r.path === "modules/local/b")?.parent).toBe(
      "modules/local",
    );
  });

  it("F-210 UX-16: a registry folder row carries its reference, a file that failed to parse carries failed and its problem count, plain files never fail", () => {
    const rows = fileTreeRows({
      files: [
        file("ok.nf"),
        file("partial.nf", { status: "partial" }),
        file("verbatim.nf", { status: "verbatim" }),
        file("errors.nf", { problems: 2 }),
        file("notes.md", { language: "markdown", status: "plain" }),
        file("modules/nf-core/x/main.nf"),
      ],
      registry: [{ path: "modules/nf-core/x", module: "nf-core/x" }],
      expanded: all(["modules", "modules/nf-core"]),
    });
    const by = (p: string) => rows.find((r) => r.path === p);
    expect(by("modules/nf-core/x")?.registry).toBe("nf-core/x");
    expect(by("modules/nf-core")?.registry).toBeNull();
    expect(by("ok.nf")).toMatchObject({ failed: false, problems: 0 });
    expect(by("partial.nf")?.failed).toBe(true);
    expect(by("verbatim.nf")?.failed).toBe(true);
    expect(by("errors.nf")).toMatchObject({ failed: true, problems: 2 });
    expect(by("notes.md")?.failed).toBe(false);
    expect(failedParse(file("x.nf", { status: "partial" }))).toBe(true);
  });

  it("F-210 UX-16 ADR-0045: a folder that holds only .gitkeep is listed with its .gitkeep; .nf-builder/ rows are read-only", () => {
    const rows = fileTreeRows({
      files,
      registry: [],
      expanded: all([".nf-builder", "assets"]),
    });
    expect(rows.map((r) => r.path)).toContain("assets/.gitkeep");
    expect(rows.find((r) => r.path === ".nf-builder")?.readOnly).toBe(
      "managed",
    );
    expect(
      rows.find((r) => r.path === ".nf-builder/layout.json")?.readOnly,
    ).toBe("managed");
    expect(rows.find((r) => r.path === "assets")?.readOnly).toBeNull();
    expect([...folderSet(files)].sort()).toEqual([
      ".nf-builder",
      "assets",
      "modules",
      "modules/local",
      "modules/local/b",
      "modules/nf-core",
      "modules/nf-core/fastqc",
    ]);
  });
});
