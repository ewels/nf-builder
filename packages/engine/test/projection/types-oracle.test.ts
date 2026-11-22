import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GraphNode, Projection } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { parseNodeKey } from "../../src/projection/keys";
import type { Projector } from "../../src/projection/project";
import { formatFlowType, formatType } from "../../src/projection/types";
import { openTree, projectorFor } from "./open";
import {
  type NfType,
  parseNfType,
  parseNfTypeText,
  stripProbes,
} from "./probes";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures.json", import.meta.url)),
    "utf8",
  ),
) as {
  fixtures: {
    file: string;
    lint: { line: number; column: number; message: string }[];
  }[];
};
const original = (file: string) => readFileSync(`${FIXTURES}/${file}`, "utf8");

let projector: Projector;
beforeAll(async () => {
  projector = await projectorFor(
    await openTree(FIXTURES, { stripProbes: true }),
  );
});

type Ours = { dataflow: string | null; element: string | null };
const ours = (type: GraphNode["outputs"][number]["type"]): Ours => ({
  dataflow: type?.dataflow ?? null,
  element: type?.element ? formatType(type.element) : null,
});

/** Compares what lint printed with a port's type: the kind always, the element when we infer one. */
function compare(
  label: string,
  nf: NfType,
  port: Ours,
  info: string[],
): string[] {
  if (nf.kind === "unknown") return [];
  if (nf.kind === "record") return [`${label}: lint says a record`];
  const problems: string[] = [];
  if (port.dataflow !== nf.kind)
    problems.push(`${label}: lint ${nf.kind}, ours ${port.dataflow}`);
  else if (port.element === null)
    info.push(`${label}: element ${nf.element} not inferred`);
  else if (port.element !== nf.element)
    problems.push(`${label}: lint ${nf.element}, ours ${port.element}`);
  return problems;
}

/** The node and port a probe expression names, in the workflow containing the (stripped) line. */
function target(
  projection: Projection,
  line: number,
  expression: string,
): { node: GraphNode; port: string | null } | string {
  const [root, property] = expression.split(".") as [
    string,
    string | undefined,
  ];
  const candidates = projection.nodes.filter((n) => {
    if (n.range.line >= line) return false;
    const key = parseNodeKey(n.id)?.local;
    if (root === "params") return key?.kind === "params";
    return (
      (key?.kind === "assigned" && key.variable === root) ||
      (key?.kind === "take" && key.name === root)
    );
  });
  const node = candidates.at(-1);
  if (node === undefined) return `no node for ${expression}`;
  if (property === undefined)
    return {
      node,
      port: node.outputs.length === 1 ? (node.outputs[0]?.id ?? null) : null,
    };
  if (!node.outputs.some((o) => o.id === property))
    return `${node.id} has no output ${property}`;
  return { node, port: property };
}

describe("F-106 LA-28 ADR-0005 type oracle", () => {
  it("F-106 LA-28 ADR-0005: the dataflow kind of every probed value matches nextflow lint, and so does the element type wherever the projection infers one", () => {
    const problems: string[] = [];
    const info: string[] = [];
    let checked = 0;
    for (const fixture of manifest.fixtures) {
      const { text, probes } = stripProbes(original(fixture.file));
      expect(text.length).toBeGreaterThan(0);
      const workflows = projector
        .workflows()
        .filter((w) => w.path === fixture.file && w.modelled);
      for (const [index, probe] of probes.entries()) {
        const label = `${fixture.file}:${probe.line} ${probe.expression}`;
        const message = fixture.lint.find(
          (l) => l.line === probe.line,
        )?.message;
        const nf = message === undefined ? null : parseNfType(message);
        if (nf === null) {
          problems.push(`${label}: no lint message`);
          continue;
        }
        // the probe's line in the stripped text is its line minus the probes before it
        const line = probe.line - index;
        const ref = workflows.find(
          (w) => w.range.line <= line && line <= w.range.endLine,
        );
        const projection =
          ref === undefined ? null : projector.project(ref.path, ref.name);
        if (projection === null) {
          problems.push(`${label}: no workflow`);
          continue;
        }
        const found = target(projection, line, probe.expression);
        if (typeof found === "string") {
          problems.push(`${label}: ${found}`);
          continue;
        }
        checked += 1;
        if (nf.kind === "record") {
          // a multi-output value: the same fields, with the same kinds
          const names = found.node.outputs.map((o) => o.id);
          expect(
            nf.fields.map((f) => f.name),
            label,
          ).toEqual(names);
          for (const [i, f] of nf.fields.entries())
            problems.push(
              ...compare(
                `${label}.${f.name}`,
                f.type,
                ours(found.node.outputs[i]?.type ?? null),
                info,
              ),
            );
          continue;
        }
        const port = found.node.outputs.find((o) => o.id === found.port);
        if (port === undefined) {
          problems.push(`${label}: ${found.node.id} has several outputs`);
          continue;
        }
        problems.push(...compare(label, nf, ours(port.type), info));
      }
    }
    // elements we don't infer are printed, not failed
    if (info.length > 0)
      console.info(`type oracle, not inferred:\n${info.join("\n")}`);
    expect(problems).toEqual([]);
    expect(checked).toBe(
      manifest.fixtures.reduce((n, f) => n + f.lint.length, 0),
    );
  });

  it("F-106 LA-28: every probe line has exactly one recorded lint message, and nothing else is recorded", () => {
    for (const fixture of manifest.fixtures) {
      const { probes } = stripProbes(original(fixture.file));
      expect(
        fixture.lint.map((l) => l.line).sort((a, b) => a - b),
        fixture.file,
      ).toEqual(probes.map((p) => p.line));
      for (const l of fixture.lint)
        expect(
          parseNfType(l.message),
          `${fixture.file}:${l.line}`,
        ).not.toBeNull();
    }
  });

  it("F-106 LA-28: printed nf-lang types parse", () => {
    expect(parseNfTypeText("Channel<Path>")).toEqual({
      kind: "channel",
      element: "Path",
    });
    expect(parseNfTypeText("Value<Bag<Path>>")).toEqual({
      kind: "value",
      element: "Bag<Path>",
    });
    expect(parseNfTypeText("Path")).toEqual({ kind: "plain", element: "Path" });
    expect(parseNfTypeText("?")).toEqual({ kind: "unknown" });
    expect(
      parseNfTypeText("Record {\n  a: Channel<Path>\n  b: Value<String>\n}"),
    ).toEqual({
      kind: "record",
      fields: [
        { name: "a", type: { kind: "channel", element: "Path" } },
        { name: "b", type: { kind: "value", element: "String" } },
      ],
    });
    expect(formatFlowType({ dataflow: "channel", element: null })).toBe(
      "Channel<?>",
    );
  });
});
