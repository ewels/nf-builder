import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../src/cases.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-cases-"));

describe("F-005 manifest", () => {
  it("F-005: loadManifest applies the defaults (run script main.nf, args [-stub], no errors or output texts)", () => {
    const dir = tmp();
    mkdirSync(join(dir, "one"));
    writeFileSync(join(dir, "one", "main.nf"), "");
    const file = join(dir, "cases.yaml");
    writeFileSync(
      file,
      `cases:
  - id: one
    about: a
    spec: [F-005]
    sources: [https://example.com]
    lint: { expect: ok }
    run: { expect: ok }
`,
    );
    const [c] = loadManifest(file).cases;
    expect(c?.dir).toBe(join(dir, "one"));
    expect(c?.lint).toEqual({ expect: "ok", errors: [] });
    expect(c?.run).toEqual({
      expect: "ok",
      output: [],
      script: "main.nf",
      args: ["-stub"],
    });
  });

  it("F-005: loadManifest reports duplicate ids, unknown keys, a missing case directory, a missing run script and an expect other than ok or error, all in one error", () => {
    const dir = tmp();
    mkdirSync(join(dir, "dup"));
    writeFileSync(join(dir, "dup", "main.nf"), "");
    mkdirSync(join(dir, "noscript"));
    const file = join(dir, "cases.yaml");
    const base = "about: a\n    spec: [F-005]\n    sources: [u]\n";
    writeFileSync(
      file,
      `cases:
  - id: dup
    ${base}    run: { expect: ok }
  - id: dup
    ${base}    run: { expect: ok }
    colour: red
  - id: gone
    ${base}    run: { expect: ok }
  - id: noscript
    ${base}    run: { expect: ok }
  - id: bad
    ${base}    lint: { expect: maybe }
`,
    );
    mkdirSync(join(dir, "bad"));
    let message = "";
    try {
      loadManifest(file);
    } catch (error) {
      message = (error as Error).message;
    }
    const lines = message.split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(`${file}: case `);
    expect(message).toContain("duplicate");
    expect(message).toContain("colour");
    expect(message).toContain("gone");
    expect(message).toContain("main.nf");
    expect(message).toContain("maybe");
  });
});
