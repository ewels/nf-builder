import { readFileSync } from "node:fs";
import type { ParseProblem, ScriptAst } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { parseScriptSource } from "../../src/source/parse-source.ts";

const flag = "nextflow.enable.types = true\n\n";
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../../tools/corpus/fixtures/${name}`, import.meta.url),
    "utf8",
  );

// The five builder sites that report a definition in the other style (process.ts and workflow.ts).
const sites: Record<string, { text: string; message: string }> = {
  "legacy input in a typed process": {
    text: `${flag}process P {\n    input:\n    val x\n\n    script:\n    'x'\n}\n`,
    message: "Invalid input declaration in typed process",
  },
  "typed input in a legacy process": {
    text: "process P {\n    input:\n    x: String\n\n    script:\n    'x'\n}\n",
    message: "Typed input declaration is not allowed in legacy process",
  },
  "typed output in a legacy process": {
    text: "process P {\n    input:\n    val x\n\n    output:\n    out: Path = file('a')\n\n    script:\n    'x'\n}\n",
    message: "Typed output declaration is not allowed in legacy process",
  },
  "typed take in a legacy workflow": {
    text: "workflow W {\n    take:\n    x: String\n\n    main:\n    x.view()\n}\n",
    message: "Typed input is not allowed in legacy workflow",
  },
  "typed emit in a legacy workflow": {
    text: "workflow W {\n    take:\n    x\n\n    main:\n    y = x\n\n    emit:\n    z: String = y\n}\n",
    message: "Typed output is not allowed in legacy workflow",
  },
};

const valid = "\nprocess OK {\n    script:\n    'ok'\n}\n";

const unparsedProblems = (ast: ScriptAst | null): ParseProblem[] =>
  (ast?.body ?? []).flatMap((item) =>
    item.kind === "Unparsed" ? [...item.problems] : [],
  );

describe("F-111 LA-13: mixing problems carry a code", () => {
  for (const [label, { text, message }] of Object.entries(sites)) {
    it(`F-111 LA-13: ${label} carries code mixed-definitions, also inside Unparsed`, () => {
      const built = parseScriptAst(text);
      const hits = built.errors.filter((e) => e.message.startsWith(message));
      expect(hits.length).toBe(1);
      expect(hits[0]?.code).toBe("mixed-definitions");

      const parsed = parseScriptSource(text);
      expect(
        parsed.problems.filter((p) => p.code === "mixed-definitions"),
      ).toHaveLength(1);

      // next to a valid declaration the file is partial and the problem sits on the Unparsed item
      const partial = parseScriptSource(text + valid);
      expect(partial.status).toBe("partial");
      expect(
        unparsedProblems(partial.ast).filter(
          (p) => p.code === "mixed-definitions",
        ),
      ).toHaveLength(1);
    });
  }

  it("F-111 LA-13: the malformed fixtures typed-legacy-mixed.nf and typed-without-flag.nf are tagged", () => {
    for (const name of ["typed-legacy-mixed.nf", "typed-without-flag.nf"]) {
      const parsed = parseScriptSource(fixture(name));
      expect(
        parsed.problems.some((p) => p.code === "mixed-definitions"),
        name,
      ).toBe(true);
    }
  });

  it("F-111 LA-13: other errors have no code", () => {
    const parsed = parseScriptSource("process {\n");
    expect(parsed.problems.length).toBeGreaterThan(0);
    for (const p of parsed.problems) expect(p.code).toBeUndefined();
    const built = parseScriptAst("params {\n}\nparams {\n}\n");
    expect(built.errors.length).toBeGreaterThan(0);
    for (const p of built.errors) expect(p.code).toBeUndefined();
  });
});
