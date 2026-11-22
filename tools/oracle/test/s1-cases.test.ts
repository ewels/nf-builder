import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../src/cases.ts";

const manifest = loadManifest();
const byId = new Map(manifest.cases.map((c) => [c.id, c]));
const ids = {
  interop: [
    "s1-typed-calls-legacy",
    "s1-typed-calls-legacy-module",
    "s1-typed-list-literal-tuple",
    "s1-legacy-calls-typed",
    "s1-legacy-calls-typed-module",
  ],
  mixed: ["s1-mixed-types-on", "s1-mixed-types-off"],
};
const FLAG = "nextflow.enable.types = true";
const files = (dir: string, ext: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));
const read = (file: string): string => readFileSync(file, "utf8");
const nfFiles = manifest.cases.flatMap((c) => files(c.dir, ".nf"));

describe("F-005 S1 cases", () => {
  it("F-005 LA-14 ADR-0007: cases.yaml has every S1 scenario with a lint and a run check", () => {
    for (const id of [...ids.interop, ...ids.mixed]) {
      const c = byId.get(id);
      expect(c, id).toBeDefined();
      expect(c?.lint, id).toBeDefined();
      expect(c?.run?.args, id).toEqual(["-stub"]);
    }
  });

  it("F-005 LA-14 ADR-0007: the cross-file cases include the other file, and only one side enables types", () => {
    for (const id of ids.interop) {
      const dir = byId.get(id)?.dir ?? "";
      const main = read(join(dir, "main.nf"));
      const include = /include \{[^}]*\} from '(\.\/[^']+)'/.exec(main);
      expect(include, id).not.toBeNull();
      const callee = read(join(dir, include?.[1] ?? ""));
      const mainTyped = main.includes(FLAG);
      expect(mainTyped !== callee.includes(FLAG), id).toBe(true);
      expect(mainTyped, id).toBe(id.startsWith("s1-typed-"));
    }
  });

  it("F-005 LA-14: typed code passes a legacy tuple input with tuple(), and a mixed list literal fails lint but only warns at run time", () => {
    const fixed = byId.get("s1-typed-calls-legacy-module");
    expect(read(join(fixed?.dir ?? "", "main.nf"))).toContain("tuple(");
    const pitfall = byId.get("s1-typed-list-literal-tuple");
    expect(read(join(pitfall?.dir ?? "", "main.nf"))).toContain(
      "[[id: reads.baseName], reads]",
    );
    expect(pitfall?.lint?.expect).toBe("error");
    expect(pitfall?.lint?.errors).toContain(
      "List expression has inconsistent element types",
    );
    expect(pitfall?.run?.expect).toBe("ok");
  });

  it("F-005 LA-14 ADR-0007: typed and legacy code across files is expected to pass lint and run -stub", () => {
    for (const id of ids.interop.filter(
      (i) => i !== "s1-typed-list-literal-tuple",
    )) {
      expect(byId.get(id)?.lint?.expect, id).toBe("ok");
      expect(byId.get(id)?.run?.expect, id).toBe("ok");
    }
  });

  it("F-005 LA-13: a script mixing typed and legacy definitions is expected to fail lint and run with the parser's message", () => {
    for (const id of ids.mixed) {
      const c = byId.get(id);
      expect(c?.lint?.expect, id).toBe("error");
      expect(c?.run?.expect, id).toBe("error");
      expect(c?.lint?.errors.length, id).toBeGreaterThan(0);
    }
  });

  it("F-005: every S1 Nextflow file starts with comments citing the nextflow-io/nextflow source it follows", () => {
    expect(nfFiles.length).toBeGreaterThan(0);
    for (const file of nfFiles) {
      const header = read(file)
        .split("\n")
        .slice(0, 8)
        .filter((l) => l.startsWith("//"))
        .join("\n");
      const name = relative(manifest.file, file);
      expect(header, name).toContain(
        "https://github.com/nextflow-io/nextflow/blob/v",
      );
      expect(read(file).startsWith("//"), name).toBe(true);
    }
  });

  it("F-005: every S1 process with a script: section has a stub: section, and no S1 file sets container, conda or plugins", () => {
    for (const file of nfFiles) {
      const text = read(file);
      const processes = text.split(/^process /m).slice(1);
      for (const p of processes) {
        const body = p.split(/^workflow /m)[0] ?? "";
        if (/^\s*script:/m.test(body)) {
          expect(body, file).toMatch(/^\s*stub:/m);
        }
      }
      expect(text, file).not.toMatch(/^\s*(container|conda)\s/m);
      expect(text, file).not.toMatch(/\bplugins\b/);
    }
  });
});
