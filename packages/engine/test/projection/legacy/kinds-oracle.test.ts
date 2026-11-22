import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readTree } from "../../model/read-tree";
import { openFiles, projectorFor } from "../open";

const cases = fileURLToPath(
  new URL("../../../../../tools/oracle/cases/", import.meta.url),
);

interface Manifest {
  cases: { id: string; run?: { output?: string[] } }[];
}

/** Where the projection puts each probed expression: the node key and its output port. */
const WHERE: Record<string, [string, string]> = {
  a: ["a", "out"],
  b: ["b", "out"],
  c: ["c", "out"],
  "ECHO.out.same": ["ECHO@1", "same"],
  "ONE.out[0]": ["ONE@1", "out"],
  "TWO.out[0]": ["TWO@1", "out"],
  concat: ["d", "out"],
  last: ["e", "out"],
  "value.map": ["f", "out"],
};

describe("F-107 LA-28 ADR-0005 legacy kinds", () => {
  it("F-107 LA-28 ADR-0005: legacy queue and value kinds match the class nextflow run -stub prints", async () => {
    const manifest = parse(
      readFileSync(`${cases}cases.yaml`, "utf8"),
    ) as Manifest;
    const probes = (
      manifest.cases.find((c) => c.id === "f107-legacy-kinds")?.run?.output ??
      []
    ).map((line) => /^probe (\S+) (\w+)$/.exec(line));
    expect(probes.length).toBeGreaterThan(5);
    const projector = await projectorFor(
      await openFiles(readTree(`${cases}f107-legacy-kinds`)),
    );
    const p = projector.project("main.nf", null);
    if (p === null) throw new Error("no projection");
    let compared = 0;
    for (const match of probes) {
      if (match === null) throw new Error("not a probe line");
      const [, expression, cls] = match as unknown as [string, string, string];
      // a call result (ChannelOut) has no kind of its own
      if (cls === "ChannelOut") continue;
      const where = WHERE[expression];
      if (where === undefined) throw new Error(`no place for ${expression}`);
      const port = p.nodes
        .find((n) => n.id === `main.nf#/${where[0]}`)
        ?.outputs.find((o) => o.id === where[1]);
      const expected =
        cls === "DataflowVariable"
          ? "value"
          : cls === "DataflowBroadcast" || cls === "DataflowQueue"
            ? "channel"
            : cls;
      expect(port?.type?.dataflow, expression).toBe(expected);
      compared += 1;
    }
    expect(compared).toBe(probes.length);
  });
});
