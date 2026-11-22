import type { Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import type { ProjectFile } from "../../src/model/project";
import type { Projector } from "../../src/projection/project";
import { equivalent } from "../../src/source/equivalent";
import { openFiles, projectorFor } from "./open";
import { fixtureSets } from "./sets";
import { type PerturbKind, perturbWhitespace } from "./whitespace";

/** What must survive a whitespace-only change: ids, kinds, labels, ports, edges. Ranges are left out. */
function shape(projection: Projection) {
  const { workflow } = projection;
  return {
    workflow: { ...workflow, range: undefined },
    nodes: projection.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      extra:
        n.kind === "call"
          ? n.callee
          : n.kind === "chain"
            ? n.steps.map((s) => [s.operator, s.known])
            : n.kind === "factory"
              ? [n.namespace, n.factory]
              : n.kind === "take" || n.kind === "emit"
                ? n.name
                : null,
      inputs: n.inputs.map((p) => [p.id, p.label, p.type, p.argumentType]),
      outputs: n.outputs.map((p) => [p.id, p.label, p.type, p.argumentType]),
    })),
    edges: projection.edges.map((e) => [
      e.from,
      e.to,
      e.type,
      e.variable,
      e.direct,
    ]),
  };
}

function shapes(projector: Projector) {
  return projector.workflows().map((ref) => {
    const p = projector.project(ref.path, ref.name);
    return {
      ref: { ...ref, range: undefined },
      shape: p === null ? null : shape(p),
    };
  });
}

const KINDS: PerturbKind[] = ["indent", "blank", "trailing", "crlf", "all"];
const SEEDS = [1, 2, 3];

describe("F-106 step 2 AR-11 projection identity", async () => {
  for (const set of fixtureSets()) {
    const model = await openFiles(set.files);
    const base = shapes(await projectorFor(model));
    for (const kind of KINDS)
      for (const seed of SEEDS)
        it(`F-106 step 2 AR-11: ids, ports and edges are unchanged after a whitespace-only re-parse (${kind}, seed ${seed}) of ${set.name}`, async () => {
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
          // the guard: the perturbation really is whitespace-only
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
  }
});

describe("F-106 AR-11 ADR-0008 ids of untouched nodes", async () => {
  const set = fixtureSets().find((s) => s.name === "types");
  if (set === undefined) throw new Error("no types set");
  const ids = async (edit: (text: string) => string) => {
    const files = set.files.map((f) =>
      f.path === "main.nf" ? { ...f, text: edit(f.text) } : f,
    );
    const projector = await projectorFor(await openFiles(files));
    const p = projector.project("main.nf", null);
    if (p === null) throw new Error("no projection");
    return p.nodes.map((n) => n.id);
  };
  const replace = (from: string, to: string) => (text: string) => {
    if (!text.includes(from)) throw new Error(`missing ${from}`);
    return text.replace(from, to);
  };

  it("F-106 AR-11 ADR-0008: ids survive an edited closure body, a changed literal argument, an added comment and an added include", async () => {
    const original = await ids((t) => t);
    expect(original.length).toBeGreaterThan(10);
    for (const edit of [
      replace("b.size() > 0", "b.size() > 1"),
      replace("QA('how?')", "QA('why?')"),
      replace(
        "    prepared = PREPARE",
        "    // the prepared reads\n    prepared = PREPARE",
      ),
      replace(
        "include { QA }",
        "include { ALIGN } from './modules/local/align'\ninclude { QA }",
      ),
    ])
      expect(await ids(edit)).toEqual(original);
  });

  it("F-106 AR-11 ADR-0008: a statement appended to main adds one node and leaves every other id and its order alone", async () => {
    const original = await ids((t) => t);
    const after = await ids(
      replace(
        "    single = QA('how?')\n",
        "    single = QA('how?')\n    extra = channel.of(1)\n",
      ),
    );
    expect(after.filter((id) => original.includes(id))).toEqual(original);
    expect(after.filter((id) => !original.includes(id))).toEqual([
      "main.nf#/extra",
    ]);
  });
});
