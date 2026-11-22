import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  genPalette,
  paletteJson,
  palettePaths,
} from "../scripts/gen-palette.ts";

/** A temp repo root with one pack (lang-2610) holding the given palette files. */
function tempRoot(files: { yaml: string; json?: string }): string {
  const root = mkdtempSync(join(tmpdir(), "gen-palette-"));
  const pack = join(root, "packages", "lang-2610");
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "palette.yaml"), files.yaml);
  if (files.json !== undefined)
    writeFileSync(join(pack, "palette.json"), files.json);
  return root;
}

describe("gen:palette", () => {
  it("F-109 ADR-0005: palette.json is up to date with palette.yaml for every pack (pnpm gen:palette --check)", () => {
    const packs = readdirSync(join(REPO_ROOT, "packages"))
      .filter((name) => /^lang-\d{4}$/.test(name))
      .map((name) => name.replace(/^lang-(\d+)(\d{2})$/, "$1.$2"));
    expect(packs).toContain("26.10");
    for (const version of packs) {
      const { status, message } = genPalette({ version, check: true });
      expect(status, `${version}: ${message}`).toBe(0);
    }
  });

  it("F-109 ADR-0005: gen:palette writes two-space JSON with a trailing newline in YAML key order", () => {
    const json = paletteJson(
      "categories:\n  - id: b\n    label: Bee\n  - id: a\n    label: Ay\n",
      "palette.yaml",
    );
    expect(json).toBe(
      `${JSON.stringify(
        {
          categories: [
            { id: "b", label: "Bee" },
            { id: "a", label: "Ay" },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("F-109 ADR-0005: gen:palette writes palette.json, then --check passes", () => {
    const root = tempRoot({ yaml: "categories: []\n" });
    expect(genPalette({ version: "26.10", repoRoot: root }).status).toBe(0);
    expect(
      genPalette({ version: "26.10", check: true, repoRoot: root }).status,
    ).toBe(0);
  });

  it("F-109 ADR-0005: gen:palette --check fails on a hand edit of palette.json and says to edit palette.yaml", () => {
    const root = tempRoot({
      yaml: "categories: []\n",
      json: '{"categories":[{"hand":"edit"}]}\n',
    });
    const { status, message } = genPalette({
      version: "26.10",
      check: true,
      repoRoot: root,
    });
    expect(status).toBe(1);
    expect(message).toContain("palette.yaml");
    expect(message).toContain("palette.json");
    expect(message).toContain("never hand-edit");
  });

  it("F-109: gen:palette rejects a duplicate key with the file and line", () => {
    expect(() =>
      paletteJson("categories: []\ncategories: []\n", "palette.yaml"),
    ).toThrow(/palette\.yaml:2/);
  });

  it("F-109: gen:palette rejects a version without a pack and lists the packs", () => {
    const root = tempRoot({ yaml: "categories: []\n" });
    expect(() => palettePaths("99.99", root)).toThrow(/26\.10/);
    expect(palettePaths("26.10", root).json).toBe(
      join(root, "packages", "lang-2610", "palette.json"),
    );
  });
});
