import { join } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/edit/apply";
import { carryHints, matchNodes } from "../../src/layout";
import { buildCommand, reset, sequenceArb } from "../edit/harness";
import { stateFor } from "../edit/helpers";
import { readTree } from "../model/read-tree";
import { seedLayout, snapshot, step } from "./helpers";

const root = new URL("../../../../", import.meta.url).pathname;
const runs = Number(process.env.F207_RUNS ?? 25);

describe("F-207 carry properties", () => {
  for (const name of ["f111-start-typed", "f111-start-legacy"])
    it(`F-207 ADR-0008: over random F-111 command sequences on ${name}, matching is injective and kind-preserving, and a rename maps every node`, async () => {
      const files = readTree(join(root, "tools/oracle/cases", name));
      const state = await stateFor(
        Object.fromEntries(files.map((f) => [f.path, f.text])),
      );
      const base = new Map(files.map((f) => [f.path, f.text]));
      let accepted = 0;
      let renames = 0;
      fc.assert(
        fc.property(sequenceArb, (choices) => {
          try {
            let doc = seedLayout(snapshot(state));
            for (const choice of choices) {
              const command = buildCommand(state, choice);
              if (!command) continue;
              const probe = applyCommand(state, command);
              if (!probe.ok) continue;
              const next = step(state, doc, command);
              accepted += 1;
              for (const { before: b, after: a } of next.pairs) {
                if (a === null) continue;
                const map = matchNodes(b, a, carryHints(command));
                const kinds = new Map(a.nodes.map((n) => [n.id, n.kind]));
                const old = new Map(b.nodes.map((n) => [n.id, n.kind]));
                expect(new Set(map.values()).size, "injective").toBe(map.size);
                for (const [from, to] of map) {
                  expect(old.has(from), `${from} is a node before`).toBe(true);
                  expect(kinds.get(to), `${from} to ${to}: kind`).toBe(
                    old.get(from),
                  );
                }
                if (command.kind === "renameDeclaration") {
                  renames += 1;
                  expect(map.size, "a rename maps every node").toBe(
                    b.nodes.length,
                  );
                }
              }
              // every entry names a node that exists, and no position is held twice
              const ids = new Set(
                [...next.after.projections.values()].flatMap((p) =>
                  p.nodes.map((n) => n.id),
                ),
              );
              for (const key of Object.keys(next.doc.nodes))
                expect(ids.has(key), `${key} is a node`).toBe(true);
              const positions = Object.values(next.doc.nodes).map(
                (p) => `${p.x},${p.y}`,
              );
              expect(new Set(positions).size).toBe(positions.length);
              doc = next.doc;
            }
          } finally {
            reset(state, base);
          }
        }),
        { seed: 207, numRuns: runs },
      );
      expect(accepted).toBeGreaterThan(0);
      expect(renames).toBeGreaterThan(0);
    });
});
