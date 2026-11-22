import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Tree = {
  name: string;
  input: string | null;
  formatted: string;
  printed: string;
};
type Entry = {
  tree: string;
  path: string;
  kind: "parsed" | "support" | "synthesised" | "edited";
  knownDifference?: string;
  spec?: string[];
};
type Manifest = {
  trees: Tree[];
  knownDifferences: Record<string, string>;
  files: Entry[];
};

const here = import.meta.dirname;
const manifest = JSON.parse(
  readFileSync(join(here, "fixtures.json"), "utf8"),
) as Manifest;

const walk = (dir: string, prefix = ""): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .flatMap((name) =>
          statSync(join(dir, name)).isDirectory()
            ? walk(join(dir, name), `${prefix}${name}/`)
            : [`${prefix}${name}`],
        )
    : [];

const dir = (tree: Tree, key: "input" | "formatted" | "printed") =>
  resolve(here, tree[key] as string);

describe("printer fixture manifest", () => {
  for (const tree of manifest.trees) {
    const entries = manifest.files.filter((f) => f.tree === tree.name);
    const printable = entries.filter(
      (f) => f.kind === "parsed" || f.kind === "support",
    );

    it(`F-110 ADR-0019: the ${tree.name} tree lists every script of its input, and each has a formatted golden`, () => {
      if (tree.input === null) return;
      const scripts = walk(dir(tree, "input")).filter((p) => p.endsWith(".nf"));
      expect(printable.map((f) => f.path).sort()).toEqual([...scripts].sort());
      expect(
        walk(dir(tree, "formatted")).filter((p) => p.endsWith(".nf")),
      ).toEqual(scripts);
    });

    it(`F-110 ADR-0005: printed/ of the ${tree.name} tree holds exactly the files with a known difference or no input`, () => {
      const expected = entries
        .filter(
          (f) =>
            f.knownDifference ||
            f.kind === "synthesised" ||
            f.kind === "edited",
        )
        .map((f) => f.path)
        .sort();
      expect(
        walk(dir(tree, "printed")).filter((p) => p.endsWith(".nf")),
      ).toEqual(expected);
    });
  }

  it("F-110 ADR-0005: known differences are defined, used, and only on parsed files; each says what the printer does", () => {
    const used = new Set<string>();
    for (const f of manifest.files) {
      if (!f.knownDifference) continue;
      used.add(f.knownDifference);
      expect(manifest.knownDifferences).toHaveProperty(f.knownDifference);
      expect(f.kind).toBe("parsed");
    }
    expect([...used].sort()).toEqual(
      Object.keys(manifest.knownDifferences).sort(),
    );
    expect(Object.keys(manifest.knownDifferences).sort()).toEqual([
      "call-wrap",
      "catch-package",
      "directive-comment",
      "named-args-comma",
      "string-reindent",
      "type-rename",
    ]);
  });

  it("F-110 LA-45: each printer-tree parsed file cites the spec", () => {
    for (const f of manifest.files.filter(
      (f) => f.tree === "printer" && f.kind === "parsed",
    ))
      expect(f.spec, f.path).toContain("LA-45");
  });
});
