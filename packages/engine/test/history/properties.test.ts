import { join } from "node:path";
import type { EditCommand } from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  commit,
  createEditState,
  patchSequence,
} from "../../src/edit/apply";
import { History } from "../../src/history/history";
import { commandLabel } from "../../src/history/labels";
import { buildCommand, choiceArb, reset, snapshot } from "../edit/harness";
import { version } from "../edit/helpers";
import { readTree } from "../model/read-tree";

const root = new URL("../../../../", import.meta.url).pathname;
const runs = Number(process.env.F209_RUNS ?? 40);

const opArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      op: fc.constant("cmd" as const),
      choice: choiceArb,
      group: fc.constantFrom(null, null, "g1", "g2"),
    }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("undo" as const) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("redo" as const) }) },
);

describe("F-209 history properties", () => {
  it("F-209 AR-23 ADR-0011: over random commands (some grouped) interleaved with undos and redos, the project always equals the matching snapshot of a reference linear history", async () => {
    const files = readTree(join(root, "tools/oracle/cases/f111-start-typed"));
    const state = await createEditState(version, files);
    const base = snapshot(state);
    let accepted = 0;
    let undone = 0;
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
        try {
          const history = new History();
          const snaps = [snapshot(state)];
          let at = 0;
          let open: string | null = null;
          for (const op of ops) {
            if (op.op === "cmd") {
              const command: EditCommand | null = buildCommand(
                state,
                op.choice,
              );
              if (!command) continue;
              const result = applyCommand(state, command);
              if (!result.ok) continue;
              commit(state, result);
              history.record(
                { patches: result.patches, inverse: result.inverse },
                commandLabel(command),
                op.group,
              );
              if (result.patches.length === 0) continue;
              accepted += 1;
              if (op.group !== null && op.group === open)
                snaps[at] = snapshot(state);
              else {
                snaps.length = at + 1;
                snaps.push(snapshot(state));
                at += 1;
              }
              open = op.group;
            } else if (op.op === "undo") {
              const lists = history.undoLists();
              expect(lists === null).toBe(at === 0);
              if (!lists) continue;
              open = null;
              commit(state, { files: patchSequence(state.model, lists) });
              history.undone();
              at -= 1;
              undone += 1;
            } else {
              const lists = history.redoLists();
              expect(lists === null).toBe(at === snaps.length - 1);
              if (!lists) continue;
              open = null;
              commit(state, { files: patchSequence(state.model, lists) });
              history.redone();
              at += 1;
            }
            expect(snapshot(state)).toEqual(snaps[at]);
            const status = history.status();
            expect(status.undoCount).toBe(at);
            expect(status.redoCount).toBe(snaps.length - 1 - at);
          }
        } finally {
          reset(state, base);
        }
      }),
      { seed: 209, numRuns: runs },
    );
    expect(accepted).toBeGreaterThan(0);
    expect(undone).toBeGreaterThan(0);
  }, 180_000);
});
