import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  genTemplates,
  readTemplateTree,
  templatePaths,
  templatesJson,
} from "../scripts/gen-templates.ts";

const YAML = `blank:
  id: blank
  name: Blank
  description: Nothing yet.
templates:
  - id: zeta
    name: Zeta
    description: Z.
  - id: alpha
    name: Alpha
    description: A.
`;

/** A temp repo root with one pack (lang-2610) holding templates/templates.yaml and the given trees. */
function tempRoot(trees: Record<string, Record<string, string>>, yaml = YAML) {
  const root = mkdtempSync(join(tmpdir(), "gen-templates-"));
  const dir = join(root, "packages", "lang-2610", "templates");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "templates.yaml"), yaml);
  for (const [id, files] of Object.entries(trees)) {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, id, path, ".."), { recursive: true });
      writeFileSync(join(dir, id, path), text);
    }
  }
  return { root, dir };
}

const TREES = {
  blank: { "main.nf": "b\n" },
  zeta: { "z.txt": "z\n", "a/b.txt": "ab\n", "a.txt": "a\n" },
  alpha: { "main.nf": "a\n" },
};

describe("gen:templates", () => {
  it("F-203 LA-02: templates.json is up to date with the template trees for every pack (pnpm gen:templates --check)", () => {
    const packs = readdirSync(join(REPO_ROOT, "packages"))
      .filter((name) => /^lang-\d{4}$/.test(name))
      .map((name) => name.replace(/^lang-(\d+)(\d{2})$/, "$1.$2"));
    expect(packs).toContain("26.10");
    for (const version of packs) {
      const { status, message } = genTemplates({ version, check: true });
      expect(status, `${version}: ${message}`).toBe(0);
    }
  });

  it("F-203: gen:templates sorts files by path, keeps exact bytes, puts blank first and the templates in templates.yaml order", () => {
    const { root } = tempRoot(TREES);
    const { status } = genTemplates({ version: "26.10", repoRoot: root });
    expect(status).toBe(0);
    const paths = templatePaths("26.10", root);
    const json = templatesJson(YAML, paths.yaml, (id) =>
      readTemplateTree(join(paths.dir, id)),
    );
    const set = JSON.parse(json) as {
      blank: { id: string; files: { path: string; text: string }[] };
      templates: { id: string; files: { path: string; text: string }[] }[];
    };
    expect(set.blank.id).toBe("blank");
    expect(set.templates.map((t) => t.id)).toEqual(["zeta", "alpha"]);
    expect(set.templates[0]?.files).toEqual([
      { path: "a.txt", text: "a\n" },
      { path: "a/b.txt", text: "ab\n" },
      { path: "z.txt", text: "z\n" },
    ]);
    expect(json.endsWith("}\n")).toBe(true);
    expect(
      genTemplates({ version: "26.10", check: true, repoRoot: root }).status,
    ).toBe(0);
    writeFileSync(join(paths.dir, "alpha", "main.nf"), "changed\n");
    const stale = genTemplates({
      version: "26.10",
      check: true,
      repoRoot: root,
    });
    expect(stale.status).toBe(1);
    expect(stale.message).toContain("gen:templates 26.10");
  });

  it("F-203 IO-01 IO-12: gen:templates refuses binary or non-UTF-8 files, CRLF, symlinks, dotfiles and files over 1 MB", () => {
    const bad = (setup: (dir: string) => void): string => {
      const { dir } = tempRoot({ blank: { "main.nf": "ok\n" } });
      const tree = join(dir, "blank");
      setup(tree);
      try {
        readTemplateTree(tree);
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    };
    expect(
      bad((d) => writeFileSync(join(d, "x.bin"), Buffer.from([0, 1, 2]))),
    ).toMatch(/x\.bin.*binary/);
    expect(
      bad((d) =>
        writeFileSync(join(d, "x.txt"), Buffer.from([0xff, 0xfe, 0x41])),
      ),
    ).toMatch(/x\.txt.*UTF-8/);
    expect(bad((d) => writeFileSync(join(d, "x.txt"), "a\r\nb\n"))).toMatch(
      /x\.txt.*CRLF/,
    );
    expect(
      bad((d) => symlinkSync(join(d, "main.nf"), join(d, "link"))),
    ).toMatch(/link.*symlink/);
    expect(bad((d) => writeFileSync(join(d, ".hidden"), "x\n"))).toMatch(
      /\.hidden.*dotfile/,
    );
    expect(
      bad((d) =>
        writeFileSync(join(d, "big.txt"), "a".repeat(1024 * 1024 + 1)),
      ),
    ).toMatch(/big\.txt.*1 MB/);
    expect(bad(() => {})).toBe("");
  });

  it("F-203: gen:templates refuses an unlisted template directory, a listed id without a directory, and duplicate or non-kebab ids", () => {
    const run = (
      trees: Record<string, Record<string, string>>,
      yaml = YAML,
    ) => {
      const { root } = tempRoot(trees, yaml);
      try {
        return genTemplates({ version: "26.10", repoRoot: root }).message;
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(run({ ...TREES, extra: { "main.nf": "x\n" } })).toContain("extra");
    expect(run({ blank: TREES.blank, zeta: TREES.zeta })).toMatch(
      /alpha.*no directory/,
    );
    expect(run(TREES, YAML.replace("id: alpha", "id: zeta"))).toContain(
      "duplicate",
    );
    expect(run(TREES, YAML.replace("id: alpha", "id: Not_Kebab"))).toContain(
      "kebab",
    );
  });
});
