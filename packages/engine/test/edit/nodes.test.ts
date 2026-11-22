import type {
  Declaration,
  Statement,
  WorkflowDef,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assignment,
  attachedComments,
  call,
  expressionStatement,
  findByRange,
  includeOf,
  nullLiteral,
  property,
  replaceNode,
  stringLiteral,
  variable,
} from "../../src/edit/nodes";
import { loadParser } from "../../src/source/parser";
import { version } from "./helpers";

let printer: Awaited<ReturnType<typeof loadParser>>["printer"];
let parse: Awaited<ReturnType<typeof loadParser>>["parseScript"];
beforeAll(async () => {
  const parser = await loadParser(version);
  printer = parser.printer;
  parse = parser.parseScript;
});

const text = [
  "workflow {",
  "    // keep",
  "    a = channel.of(1)",
  "    A(a, 2) // tail",
  "}",
  "",
].join("\n");

const workflow = (): WorkflowDef => {
  const item = parse(text).ast?.body[0];
  if (item?.kind !== "Workflow") throw new Error("no workflow");
  return item;
};
const print = (node: Declaration) => printer.printDeclaration(node).text;

describe("F-111 AR-20: node helpers", () => {
  it("F-111 AR-20: synthesised nodes print as the code they stand for", () => {
    const def = workflow();
    const stmts = def.main?.items as Statement[];
    const added = [
      assignment("x", call("F", [variable("a"), nullLiteral()])),
      expressionStatement(property(variable("params"), "reads")),
      expressionStatement(call("G", [stringLiteral("it's")])),
    ];
    const updated = {
      ...def,
      main: def.main && { ...def.main, items: [...stmts, ...added] },
    };
    expect(print(updated)).toContain(
      "x = F(a, null)\n    params.reads\n    G('it\\'s')\n",
    );
    const include = includeOf("HELLO", "./modules/local/hello/main.nf");
    expect(printer.printDeclaration(include).text).toBe(
      "include { HELLO } from './modules/local/hello/main.nf'\n",
    );
  });

  it("F-111 AR-22: assignment keeps the comment slots of the statement it wraps", () => {
    const def = workflow();
    const last = def.main?.items[1] as Statement;
    const wrapped = assignment(
      "r",
      (last as unknown as { expression: never }).expression,
      last,
    );
    expect(wrapped.trailingComments).toEqual(last.trailingComments);
    expect(wrapped.trailingComments?.length).toBe(1);
  });

  it("F-111 AR-22: replaceNode shares what it doesn't change and removes from arrays on null", () => {
    const def = workflow();
    const items = def.main?.items as Statement[];
    const [first, second] = items as [Statement, Statement];
    const copy = replaceNode(def, second, null);
    expect(copy.main?.items).toEqual([first]);
    expect(copy.main?.items[0]).toBe(first);
    const same = replaceNode(def, workflow().main as never, null);
    expect(same).toBe(def);
    const swapped = replaceNode(def, first, expressionStatement(variable("z")));
    expect(swapped.main?.items[1]).toBe(second);
    expect(swapped.main?.items[0]).not.toBe(first);
  });

  it("F-111: findByRange finds the outermost expression with exactly that range", () => {
    const def = workflow();
    const stmt = def.main?.items[1] as Statement & {
      expression: { range: never; args: { range: never }[] };
    };
    const arg = stmt.expression.args[1] as { range: never };
    expect(findByRange(def, arg.range)?.kind).toBe("Number");
    expect(findByRange(def, stmt.expression.range)?.kind).toBe("MethodCall");
    expect(
      findByRange(def, { ...(arg.range as object), start: 0 } as never),
    ).toBeNull();
  });

  it("F-111 ADR-0004: attachedComments lists every comment attached under a node", () => {
    const def = workflow();
    expect(attachedComments(def).map((c) => c.text)).toEqual([
      "// keep",
      "// tail",
    ]);
  });
});
