// F-601 (ADR 0032): printConfigStatement prints new config statements in the fresh layout.
import {
  type ConfigApply,
  type ConfigAssign,
  type ConfigBlock,
  type ConfigName,
  type ConfigSelector,
  type ConfigStatement,
  type Expression,
  NO_RANGE,
  PrintError,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { printConfigStatement } from "../../src/printer/index.ts";

const range = NO_RANGE;
const name = (value: string): ConfigName => ({
  kind: "ConfigName",
  range,
  name: value,
  form: "identifier",
});
const number = (text: string): Expression => ({
  kind: "Number",
  range,
  text,
  integer: !text.includes("."),
});
const memory = (amount: string, unit: string): Expression => ({
  kind: "Property",
  range,
  object: number(amount),
  navigation: ".",
  property: { kind: "Identifier", range, name: unit },
});
const string = (value: string): Expression => ({
  kind: "String",
  range,
  text: `'${value}'`,
  value,
  quote: "'",
});
const assign = (path: string[], value: Expression): ConfigAssign => ({
  kind: "ConfigAssign",
  range,
  path: path.map(name),
  value,
});
const block = (
  blockName: string,
  statements: ConfigStatement[] = [],
): ConfigBlock => ({
  kind: "ConfigBlock",
  range,
  name: name(blockName),
  statements,
});
const selector = (
  kind: string,
  target: string,
  statements: ConfigStatement[] = [],
): ConfigSelector => ({
  kind: "ConfigSelector",
  range,
  selector: name(kind),
  target: name(target),
  statements,
});

describe("printConfigStatement", () => {
  it("F-601 ADR-0032: printConfigStatement prints a new assignment, block, selector and plugin line in the fresh layout at a given indent", () => {
    expect(
      printConfigStatement(assign(["process", "memory"], memory("8", "GB")))
        .text,
    ).toBe("process.memory = 8.GB\n");
    expect(
      printConfigStatement(assign(["queue"], string("long")), { indent: 2 })
        .text,
    ).toBe("        queue = 'long'\n");
    expect(printConfigStatement(block("docker")).text).toBe("docker {\n}\n");
    expect(
      printConfigStatement(
        block("process", [
          selector("withLabel", "big_mem", [
            assign(["memory"], memory("8", "GB")),
          ]),
        ]),
        { indent: 1 },
      ).text,
    ).toBe(
      [
        "    process {",
        "        withLabel: big_mem {",
        "            memory = 8.GB",
        "        }",
        "    }",
        "",
      ].join("\n"),
    );
    // a name that isn't an identifier is quoted
    expect(printConfigStatement(block("gpu-test")).text).toBe(
      "'gpu-test' {\n}\n",
    );
    const apply: ConfigApply = {
      kind: "ConfigApply",
      range,
      name: { kind: "Identifier", range, name: "id" },
      args: [string("nf-schema@2.5.1")],
    };
    expect(printConfigStatement(block("plugins", [])).text).toBe(
      "plugins {\n}\n",
    );
    expect(printConfigStatement(apply, { indent: 1 }).text).toBe(
      "    id 'nf-schema@2.5.1'\n",
    );
  });

  it("F-601: printConfigStatement throws PrintError for ConfigInvalid and ConfigIncomplete and reports no missing comments for printable nodes", () => {
    const invalid = { kind: "ConfigInvalid", range } as ConfigStatement;
    const incomplete: ConfigStatement = {
      kind: "ConfigIncomplete",
      range,
      path: [name("process")],
      trailingDot: true,
    };
    expect(() => printConfigStatement(invalid)).toThrow(PrintError);
    expect(() => printConfigStatement(incomplete)).toThrow(PrintError);

    const text =
      "// lead\nprocess {\n    cpus = 1 // trail\n    // dangling\n}\n";
    const parsed = parseConfigAst(text);
    if (!parsed.ok) throw new Error("parse failed");
    const result = printConfigStatement(
      parsed.ast.statements[0] as ConfigStatement,
    );
    expect(result.missingComments).toEqual([]);
    expect(result.text).toBe(text);
  });
});
