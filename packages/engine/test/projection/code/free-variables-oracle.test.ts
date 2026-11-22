import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AstNode,
  type IfStatement,
  type IndexExpr,
  type MethodCall,
  type Statement,
  walk,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { statementVariables } from "../../../src/projection/free-variables";
import { scriptParser } from "./statement";

// The probe tree: each workflow holds one probe statement and a reader line (see free-variables/main.nf). The recorded
// lint errors come from a real run; `pnpm oracle` re-runs them (tools/oracle, F-108).
const FILE = fileURLToPath(
  new URL("./free-variables/main.nf", import.meta.url),
);
const text = readFileSync(FILE, "utf8");
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./free-variables.json", import.meta.url)),
    "utf8",
  ),
) as {
  fixtures: {
    file: string;
    lint: { line: number; column: number; message: string }[];
  }[];
};
const errors = manifest.fixtures[0]?.lint ?? [];
/** Names nf-lang defines for every script, which a statement reads but lint never reports. */
const GLOBALS = new Set(["params", "workflow", "log"]);

const parsedName = (message: string): string | null =>
  /^`(.+)` is not defined$/.exec(message)?.[1] ?? null;

interface Probe {
  name: string;
  statement: Statement;
  reader: Statement;
}
let probes: Probe[];
beforeAll(async () => {
  const workflows = (await scriptParser()).workflows(text);
  probes = [...workflows].map(([name, body]) => ({
    name,
    statement: body[0] as Statement,
    reader: body.at(-1) as Statement,
  }));
});

const within = (
  node: AstNode,
  e: { line: number; column: number },
): boolean => {
  const { range } = node;
  const after =
    e.line > range.line || (e.line === range.line && e.column >= range.column);
  const before =
    e.line < range.endLine ||
    (e.line === range.endLine && e.column < range.endColumn);
  return after && before;
};

/** Method names of implicit-this calls: lint reports them as undefined variables, but they are not reads. */
const methodNames = (statement: Statement): AstNode[] => {
  const out: AstNode[] = [];
  walk(statement, (node) => {
    const call = node as MethodCall;
    if (call.kind === "MethodCall" && call.receiver === null)
      out.push(call.method);
    return undefined;
  });
  return out;
};

/** Bare variables that are an `if` condition or the only index in `x[i]`: lint reports those at the opening delimiter, one column early. */
const bareConditions = (statement: Statement): AstNode[] => {
  const out: AstNode[] = [];
  walk(statement, (node) => {
    const conditional = node as IfStatement;
    if (conditional.kind === "If" && conditional.condition.kind === "Variable")
      out.push(conditional.condition);
    const index = node as IndexExpr;
    if (
      index.kind === "Index" &&
      index.indices.length === 1 &&
      index.indices[0]?.kind === "Variable"
    )
      out.push(index.indices[0]);
    return undefined;
  });
  return out;
};

const byPosition = (a: string, b: string): number => {
  const [al = 0, ac = 0] = a.split(" ")[0]?.split(":").map(Number) ?? [];
  const [bl = 0, bc = 0] = b.split(" ")[0]?.split(":").map(Number) ?? [];
  return al - bl || ac - bc;
};

describe("F-108 LA-27 ADR-0005 free-variable oracle", () => {
  it('F-108 LA-27 ADR-0005: the free reads of every probe statement are exactly nextflow lint\'s "is not defined" errors in it', () => {
    expect(probes.length).toBeGreaterThanOrEqual(30);
    const problems: string[] = [];
    for (const probe of probes) {
      const names = methodNames(probe.statement);
      const conditions = bareConditions(probe.statement);
      const lint = errors
        .filter((e) => within(probe.statement, e))
        .filter((e) => !names.some((n) => within(n, e)))
        .map((e) => `${e.line}:${e.column} ${parsedName(e.message)}`)
        .sort(byPosition);
      const ours = statementVariables(probe.statement)
        .reads.filter((r) => !r.compoundTarget && !GLOBALS.has(r.name))
        .map((r) => {
          const early = conditions.some((c) => c.range.start === r.range.start);
          return `${r.range.line}:${r.range.column - (early ? 1 : 0)} ${r.name}`;
        })
        .sort(byPosition);
      if (JSON.stringify(ours) !== JSON.stringify(lint))
        problems.push(
          `${probe.name}: ours ${ours.join(" | ")}; lint ${lint.join(" | ")}`,
        );
    }
    expect(problems).toEqual([]);
  });

  it("F-108 LA-27 ADR-0005: after every probe statement exactly its writes are defined", () => {
    const problems: string[] = [];
    for (const probe of probes) {
      const writes = new Set(
        statementVariables(probe.statement).writes.map((w) => w.name),
      );
      // the reader line lists every name the probe assigns anywhere, block-local ones included
      const listed = statementVariables(probe.reader).reads.map((r) => r.name);
      const ours = listed.filter((n) => !writes.has(n));
      const lint = errors
        .filter((e) => within(probe.reader, e))
        .map((e) => parsedName(e.message));
      if (JSON.stringify(ours) !== JSON.stringify(lint))
        problems.push(`${probe.name}: ours ${ours}; lint ${lint}`);
    }
    expect(problems).toEqual([]);
  });

  it("F-108: every probe has recorded messages and nothing else is recorded", () => {
    for (const probe of probes)
      expect(
        errors.some((e) => within(probe.statement, e)),
        probe.name,
      ).toBe(true);
    for (const e of errors) {
      expect(parsedName(e.message), e.message).not.toBeNull();
      expect(
        probes.some((p) => within(p.statement, e) || within(p.reader, e)),
        `${e.line}:${e.column}`,
      ).toBe(true);
    }
  });
});
