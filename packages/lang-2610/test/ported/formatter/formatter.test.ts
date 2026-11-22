// The format cases of nf-lang's ScriptFormatterTest at the pinned commit (see cases.json and transcribe.py). Each case
// is a checkFormat call (format(in) == out and format(out) == out) or one of three direct format() checks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../../src/ast/index.ts";
import { createLayout, printScript } from "../../../src/printer/index.ts";

type Case = {
  id: string;
  upstream: string;
  line: number;
  test: string;
  section: string;
  kind:
    | "check-format"
    | "format-equals"
    | "format-equals-input"
    | "format-contains";
  in: string;
  out?: string;
  contains?: string[];
  excluded?: string;
  /** The printer deliberately differs from upstream here (ADR 0032); the case checks it still does, and is stable. */
  knownDifference?: string;
};
type Manifest = {
  upstream: { repo: string; tag: string; commit: string; file: string };
  cases: Case[];
};

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, path), "utf8");
const manifest = JSON.parse(read("cases.json")) as Manifest;
const upstream = JSON.parse(read("../../../upstream.json")) as {
  nextflow: { tag: string; commit: string };
};

function format(text: string): string {
  const parsed = parseScriptAst(text);
  expect(parsed.ok && parsed.errors).toEqual([]);
  if (!parsed.ok) throw new Error("parse failed");
  const result = printScript(parsed.ast, { layout: createLayout(text) });
  expect(result.missingComments).toEqual([]);
  return result.text;
}

describe("ported nf-lang ScriptFormatterTest cases", () => {
  for (const c of manifest.cases) {
    if (c.excluded) continue;
    it(`F-110 LA-45 ADR-0005: nf-lang ScriptFormatterTest "${c.test}" (L${c.line}) formats as upstream`, () => {
      const input = read(c.in);
      if (c.kind === "format-contains") {
        const result = format(input);
        for (const needle of c.contains ?? []) expect(result).toContain(needle);
        return;
      }
      const output =
        c.kind === "format-equals-input" ? input : read(c.out as string);
      if (c.knownDifference) {
        // a known difference that no longer differs must be removed from cases.json
        const printed = format(input);
        expect(printed).not.toBe(output);
        expect(format(printed)).toBe(printed);
        return;
      }
      expect(format(input)).toBe(output);
      if (c.kind === "check-format") expect(format(output)).toBe(output);
    });
  }

  it("F-110: the ported formatter cases cite the pinned test file and cover every non-Harshil case", () => {
    expect(manifest.upstream.tag).toBe(upstream.nextflow.tag);
    expect(manifest.upstream.commit).toBe(upstream.nextflow.commit);
    expect(manifest.cases).toHaveLength(86);
    expect(manifest.cases.filter((c) => c.excluded)).toHaveLength(5);
    expect(
      manifest.cases
        .filter((c) => c.excluded)
        .every((c) => c.section === "HARSHIL ALIGNMENT"),
    ).toBe(true);
    const lines = manifest.cases.map((c) => c.line);
    expect(new Set(lines).size).toBe(lines.length);
    for (const c of manifest.cases) {
      expect(c.upstream).toBe(
        `script/formatter/ScriptFormatterTest.groovy#L${c.line}`,
      );
      expect(read(c.in)).not.toBe("");
    }
    // one pair of files per case, except the contains case, which has no expected text
    const files = manifest.cases.flatMap((c) =>
      c.out ? [c.in, c.out] : [c.in],
    );
    expect(files).toHaveLength(171);
  });
});
