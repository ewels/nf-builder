// F-111 step 1 (AR-22, AR-23, AR-24, LA-13, LA-45): random edit-command sequences over the pinned corpus, and a reprint
// of every workflow with no edit. Run by `pnpm test:corpus` after `pnpm corpus:fetch`; writes
// .cache/reports/edit-corpus.md (its own file: parse.corpus.ts rewrites parse-corpus.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EDIT_COMMAND_KINDS, type WorkflowDef } from "@nf-builder/lang-core";
import * as fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { createEditState, type EditState } from "../../src/edit/apply";
import { reprintDeclaration } from "../../src/edit/splice";
import { installedPackVersions } from "../../src/packs";
import { createSourceFile } from "../../src/source/source-file";
import {
  assertSequences,
  choiceArb,
  runFixedExamples,
  Stats,
} from "../edit/harness";
import { structure } from "../edit/structure";
import { readTree } from "../model/read-tree";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");
const version = installedPackVersions()[0] as string;

// pin, runs, longest sequence
const PINS: [string, number, number][] = [
  ["rnaseq-nf", 40, 4],
  ["rnaseq-nf-typed", 40, 4],
  ["fetchngs", 40, 4],
  ["rnaseq", 15, 3],
  ["sarek", 15, 3],
];

const states = new Map<string, EditState>();
const stats = new Map<string, Stats>();
const started = Date.now();

beforeAll(async () => {
  for (const [id] of PINS) {
    const dir = join(CORPUS, id);
    try {
      states.set(id, await createEditState(version, readTree(dir)));
    } catch (error) {
      throw new Error(
        `pin ${id} is not fetched (run pnpm corpus:fetch): ${error}`,
      );
    }
  }
});

describe("F-111 step 1 corpus properties", () => {
  for (const [id, runs, longest] of PINS)
    it(`F-111 step 1 AR-22 AR-23 AR-24 LA-13: random command sequences on ${id} parse, keep untargeted declarations equivalent and undo to exact bytes`, () => {
      const state = states.get(id) as EditState;
      const s = new Stats();
      stats.set(id, s);
      runFixedExamples(state, s);
      assertSequences(
        state,
        fc.array(choiceArb, { minLength: 1, maxLength: longest }),
        s,
        runs,
      );
      for (const kind of EDIT_COMMAND_KINDS)
        expect(
          s.accepted.get(kind) ?? 0,
          `${id}: ${kind} accepted`,
        ).toBeGreaterThan(0);
    });
});

describe("F-111 step 1 corpus reprint", () => {
  it("F-111 LA-45 AR-22: reprinting each corpus workflow unchanged keeps its structure", () => {
    let workflows = 0;
    for (const [id] of PINS) {
      const state = states.get(id) as EditState;
      for (const path of state.model.paths()) {
        const file = state.model.file(path)?.source;
        if (file?.language !== "nextflow" || file.ast === null) continue;
        const defs = file.ast.body.filter(
          (i): i is WorkflowDef => i.kind === "Workflow",
        );
        defs.forEach((def, index) => {
          const edit = reprintDeclaration(file, def, def, state.parser.printer);
          const text =
            file.text.slice(0, edit.start) +
            edit.text +
            file.text.slice(edit.end);
          const again = createSourceFile(path, text, state.parser);
          const after =
            again.ast?.kind === "Script"
              ? again.ast.body.filter(
                  (i): i is WorkflowDef => i.kind === "Workflow",
                )[index]
              : undefined;
          expect(
            after,
            `${id}/${path} workflow ${index} reparses`,
          ).toBeDefined();
          expect(structure(after), `${id}/${path} workflow ${index}`).toEqual(
            structure(def),
          );
          workflows += 1;
        });
      }
    }
    expect(workflows).toBeGreaterThan(100);
  });

  it("F-111 step 1: the edit properties are reported", () => {
    const lines = ["# Edit properties (F-111)", ""];
    lines.push(
      `Seed 111; wall time ${((Date.now() - started) / 1000).toFixed(0)} s.`,
      "",
    );
    lines.push(
      `| pin | runs | skipped | ${EDIT_COMMAND_KINDS.join(" | ")} | refusals |`,
      `|---|---|---|${EDIT_COMMAND_KINDS.map(() => "---").join("|")}|---|`,
    );
    for (const [id, runs] of PINS) {
      const s = stats.get(id);
      if (!s) continue;
      const refusals = [...s.refused]
        .sort()
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      lines.push(
        `| ${id} | ${runs} | ${s.skipped} | ${EDIT_COMMAND_KINDS.map((k) => s.accepted.get(k) ?? 0).join(" | ")} | ${refusals} |`,
      );
    }
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "edit-corpus.md"), `${lines.join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(4);
  });
});
