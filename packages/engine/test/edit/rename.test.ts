import { describe, expect, it } from "vitest";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const files = {
  "a.nf": `${proc("COUNT")}\nworkflow SUB {\n    take:\n    x\n\n    main:\n    COUNT()\n    COUNT.out.view()\n}\n`,
  "main.nf":
    "include { COUNT } from './a.nf'\ninclude { SUB } from './a.nf'\n\nworkflow {\n    COUNT()\n    SUB(channel.of(1))\n}\n",
  "other.nf":
    "include { COUNT as TOTAL } from './a.nf'\n\nworkflow W {\n    TOTAL()\n}\n",
  "types.nf":
    "nextflow.enable.types = true\n\nrecord Sample {\n    id: String\n}\n\nprocess P {\n    input:\n    s: Sample\n\n    script:\n    'p'\n}\n",
  "user.nf":
    "nextflow.enable.types = true\n\ninclude { Sample } from './types.nf'\n\nworkflow W {\n    take:\n    s: Sample\n\n    main:\n    println(s)\n}\n",
};

describe("F-111 RenameDeclaration", () => {
  it("F-111 AR-21 AR-03: RenameDeclaration renames the declaration, its references, and the include entries and references in includers", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "renameDeclaration",
      path: "a.nf",
      name: "COUNT",
      newName: "TALLY",
    });
    const out = Object.fromEntries(r.files.map((f) => [f.path, f.text]));
    expect(out["a.nf"]).toBe(
      files["a.nf"]
        .replace("process COUNT", "process TALLY")
        .replace("    COUNT()", "    TALLY()")
        .replace("COUNT.out", "TALLY.out"),
    );
    expect(out["main.nf"]).toBe(files["main.nf"].replaceAll("COUNT", "TALLY"));
    commit(state, r);
    expect(state.model.diagnostics()).toEqual([]);
    expect(state.model.lookup("main.nf", "TALLY")?.kind).toBe("include");
  });

  it("F-111: an aliased include keeps its alias and call sites; record type references are renamed", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "renameDeclaration",
      path: "a.nf",
      name: "COUNT",
      newName: "TALLY",
    });
    const other = r.files.find((f) => f.path === "other.nf")?.text;
    expect(other).toBe(files["other.nf"].replace("{ COUNT as", "{ TALLY as"));
    const rec = accepted(state, {
      kind: "renameDeclaration",
      path: "types.nf",
      name: "Sample",
      newName: "Row",
    });
    const out = Object.fromEntries(rec.files.map((f) => [f.path, f.text]));
    expect(out["types.nf"]).toBe(files["types.nf"].replaceAll("Sample", "Row"));
    expect(out["user.nf"]).toBe(files["user.nf"].replaceAll("Sample", "Row"));
  });

  it("F-111 AR-22: RenameDeclaration only replaces identifier text", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "renameDeclaration",
      path: "a.nf",
      name: "COUNT",
      newName: "TALLY",
    });
    expect(r.patches.length).toBeGreaterThan(1);
    for (const p of r.patches) {
      if (p.kind !== "edit") throw new Error("not an edit");
      const before = state.model.file(p.path)?.source.text as string;
      for (const e of p.edits) {
        expect(before.slice(e.start, e.end)).toBe("COUNT");
        expect(e.text).toBe("TALLY");
      }
    }
  });

  it("F-111: RenameDeclaration refuses invalid or clashing names and unparsed declarations", async () => {
    const state = await stateFor({
      ...files,
      "broken.nf": `${proc("OK")}\nprocess BAD {\n    nope nope\n`,
      "clash.nf":
        "include { COUNT } from './a.nf'\ninclude { TALLY } from './t.nf'\n",
      "t.nf": proc("TALLY"),
    });
    const rename = (path: string, name: string, newName: string) =>
      refused(state, { kind: "renameDeclaration", path, name, newName });
    expect(rename("a.nf", "COUNT", "1x").code).toBe("invalid");
    expect(rename("a.nf", "COUNT", "COUNT").code).toBe("invalid");
    expect(rename("a.nf", "COUNT", "SUB").code).toBe("invalid"); // declared
    expect(rename("a.nf", "COUNT", "TALLY").code).toBe("invalid"); // bound in clash.nf
    expect(rename("a.nf", "NOPE", "X").code).toBe("not-found");
    expect(rename("nope.nf", "A", "X").code).toBe("not-found");
    expect(rename("broken.nf", "BAD", "X").code).toBe("invalid");
    expect(texts(state)["a.nf"]).toBe(files["a.nf"]);
  });
});
