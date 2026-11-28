import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScriptSourceFile } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { createEditState } from "../../src/edit/apply";
import {
  declarationSource,
  flagPrefix,
  formatDeclarationText,
  parseDeclarationText,
} from "../../src/form/declaration-text";
import { version } from "../edit/helpers";

const PROCESS = `/**
 * Writes a greeting.
 */
process GREET {
    cpus 1

    input:
    name: String

    output:
    text: Path = file('greeting.txt')

    script:
    """
    echo 'Hello \${name}' > greeting.txt
    """
}`;

const FILE = `nextflow.enable.types = true

include { OTHER } from './other.nf'

${PROCESS}

process SECOND {
    input:
    x: String

    output:
    y: String = x

    exec:
    y = x
}
`;

const load = async (text = FILE) => {
  const state = await createEditState(version, [{ path: "main.nf", text }]);
  const file = state.model.file("main.nf")?.source as ScriptSourceFile;
  const declaration = state.model.file("main.nf")?.declarations.get("GREET")
    ?.declaration as never;
  return { state, file, declaration, parser: state.parser };
};

describe("F-304 declaration text", () => {
  it("F-304 UX-43: declarationSource is the itemSpan slice, doc comment included", async () => {
    const { file, declaration } = await load();
    const source = declarationSource(file, declaration);
    expect(source.text).toBe(PROCESS);
    expect(FILE.slice(source.start, source.end)).toBe(PROCESS);
    expect(source.text.startsWith("/**")).toBe(true);
  });

  it("F-304 UX-44: parseDeclarationText reads a typed process alone, with the file's types flag", async () => {
    const { file, declaration, parser } = await load();
    expect(flagPrefix(file, declaration)).toBe("nextflow.enable.types = true");
    const parsed = parseDeclarationText(
      parser,
      flagPrefix(file, declaration),
      PROCESS,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.process.name.name).toBe("GREET");
      expect(parsed.process.typed).toBe(true);
    }
  });

  it("F-304 step 2 UX-44: a syntax error gives problems on the declaration's own lines and columns", async () => {
    const { file, declaration, parser } = await load();
    const broken = PROCESS.replace("    cpus 1\n", "    cpus 1 )\n");
    const parsed = parseDeclarationText(
      parser,
      flagPrefix(file, declaration),
      broken,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).not.toBe("");
    const first = parsed.problems[0];
    expect(first?.line).toBe(5);
    expect(first?.column).toBeGreaterThan(1);
    const noClose = PROCESS.slice(0, PROCESS.lastIndexOf("}"));
    const open = parseDeclarationText(
      parser,
      flagPrefix(file, declaration),
      noClose,
    );
    expect(open.ok).toBe(false);
    if (!open.ok)
      for (const p of open.problems)
        expect(p.line).toBeLessThanOrEqual(noClose.split("\n").length);
  });

  it("F-304 UX-44 UX-42: two declarations, an include, a statement, a workflow or a legacy process are refused", async () => {
    const { file, declaration, parser } = await load();
    const prefix = flagPrefix(file, declaration);
    const refuse = (text: string) => {
      const parsed = parseDeclarationText(parser, prefix, text);
      expect(parsed.ok, text).toBe(false);
      return parsed;
    };
    refuse(`${PROCESS}\n\nprocess OTHER2 {\n    exec:\n    true\n}`);
    refuse(`include { A } from './a.nf'\n\n${PROCESS}`);
    refuse(`nextflow.enable.types = true\n\n${PROCESS}`);
    const workflow = refuse("workflow {\n}");
    if (!workflow.ok)
      expect(workflow.message).toMatch(/can't change what kind/);
    refuse("");
    // under the file's types flag a legacy process is a syntax error
    refuse(
      "process OLD {\n    input:\n    val x\n\n    script:\n    'true'\n}",
    );
  });

  it("F-304 step 3 UX-43: formatDeclarationText equals the process's slice of formatted/f304-format.nf", async () => {
    const root = join(import.meta.dirname, "../../../..");
    const start = readFileSync(
      join(root, "packages/lang-2610/test/printer/input/f304-format.nf"),
      "utf8",
    );
    const golden = readFileSync(
      join(root, "packages/lang-2610/test/printer/formatted/f304-format.nf"),
      "utf8",
    );
    const find = async (text: string) => {
      const s = await createEditState(version, [{ path: "a.nf", text }]);
      const f = s.model.file("a.nf");
      const d = f?.declarations.get("COUNT")?.declaration as never;
      return {
        file: f?.source as ScriptSourceFile,
        d,
        parser: s.parser,
      };
    };
    const a = await find(start);
    const g = await find(golden);
    const source = declarationSource(a.file, a.d);
    const expected = declarationSource(g.file, g.d).text;
    const formatted = formatDeclarationText(
      a.parser,
      flagPrefix(a.file, a.d),
      source.text,
    );
    expect(formatted.ok).toBe(true);
    if (formatted.ok) expect(formatted.text).toBe(expected);
  });

  it("F-304: formatDeclarationText is a fixed point", async () => {
    const { file, declaration, parser } = await load();
    const prefix = flagPrefix(file, declaration);
    const once = formatDeclarationText(parser, prefix, PROCESS);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = formatDeclarationText(parser, prefix, once.text);
    expect(twice.ok && twice.text).toBe(once.text);
  });

  it("F-304 UX-44: a legacy process in a file without the types flag parses as legacy, with no flag put in front", async () => {
    const legacy =
      "process OLD {\n    input:\n    val x\n\n    script:\n    'true'\n}";
    const state = await createEditState(version, [
      { path: "main.nf", text: `${legacy}\n` },
    ]);
    const file = state.model.file("main.nf")?.source as ScriptSourceFile;
    const declaration = state.model.file("main.nf")?.declarations.get("OLD")
      ?.declaration as never;
    const prefix = flagPrefix(file, declaration);
    expect(prefix).toBe("");
    const parsed = parseDeclarationText(state.parser, prefix, legacy);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.process.typed).toBe(false);
  });
});
