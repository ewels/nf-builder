import { describe, expect, it } from "vitest";
import type { ProjectFile } from "../../../src/model/project";
import { equivalent } from "../../../src/source/equivalent";
import { openFiles, projectorFor } from "../open";
import { shapes } from "../shape";
import { type PerturbKind, perturbWhitespace } from "../whitespace";
import { legacySets } from "./sets";

const KINDS: PerturbKind[] = ["indent", "blank", "trailing", "crlf", "all"];

describe("F-107 AR-11 legacy projection identity", async () => {
  const set = legacySets()[0];
  if (set === undefined) throw new Error("no legacy set");
  const model = await openFiles(set.files);
  const base = shapes(await projectorFor(model));
  for (const kind of KINDS)
    for (const seed of [1, 2])
      it(`F-107 AR-11: legacy ids, ports and edges are unchanged after a whitespace-only re-parse (${kind}, seed ${seed})`, async () => {
        const perturbed: ProjectFile[] = set.files.map((f) => {
          const source = model.file(f.path)?.source;
          return source?.language === "nextflow"
            ? {
                path: f.path,
                text: perturbWhitespace(f.text, source.ast, seed, kind),
              }
            : f;
        });
        const again = await openFiles(perturbed);
        let changed = 0;
        for (const f of set.files) {
          const a = model.file(f.path)?.source;
          const b = again.file(f.path)?.source;
          if (a === undefined || b === undefined) throw new Error(f.path);
          if (b.text !== a.text) changed += 1;
          expect(equivalent(a, b), f.path).toEqual({ equivalent: true });
        }
        expect(changed).toBeGreaterThan(0);
        expect(shapes(await projectorFor(again))).toEqual(base);
      });
});
