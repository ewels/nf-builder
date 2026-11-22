import { describe, expect, it } from "vitest";
import type { ProjectFile } from "../../../src/model/project";
import { equivalent } from "../../../src/source/equivalent";
import { printSourceFile } from "../../../src/source/print";
import { openFiles, projectorFor } from "../open";
import { shapes } from "../shape";
import { type PerturbKind, perturbWhitespace } from "../whitespace";
import { allSets } from "./fixtures";
import { codeNodes, plain, statementOf, wrapped } from "./helpers";
import { scriptParser } from "./statement";

describe("F-108 step 2 ADR-0004 code node text", async () => {
  const parsers = {
    plain: await scriptParser(),
    typed: await scriptParser(true),
  };
  for (const set of allSets()) {
    const model = await openFiles(set.files);
    const projector = await projectorFor(model);
    const nodes = codeNodes(model, projector);

    it(`F-108 step 2 ADR-0004: every code node's text is exactly its statement's source (${set.name})`, () => {
      if (set.name === "f108-code-nodes")
        expect(nodes.length).toBeGreaterThan(10);
      for (const { node, text } of nodes)
        expect(node.text, node.id).toBe(
          text.slice(node.range.start, node.range.end),
        );
    });

    it(`F-108 step 2 ADR-0004: a code node's text re-parses on its own to the same statement (${set.name})`, () => {
      for (const { node, typed, ast } of nodes) {
        const parser = typed ? parsers.typed : parsers.plain;
        const body =
          [...parser.workflows(wrapped(node, typed)).values()][0] ?? [];
        expect(body, node.id).toHaveLength(1);
        const original = statementOf(ast, node);
        expect(original, node.id).toBeDefined();
        expect(plain(body[0]), node.id).toBe(plain(original));
      }
    });

    it(`F-108 step 2 IO-20: projecting leaves files unchanged (${set.name})`, async () => {
      const fresh = await openFiles(set.files);
      const before = JSON.stringify(
        set.files.map((f) => fresh.file(f.path)?.source),
      );
      const p = await projectorFor(fresh);
      for (const ref of p.workflows()) p.project(ref.path, ref.name);
      expect(
        JSON.stringify(set.files.map((f) => fresh.file(f.path)?.source)),
      ).toBe(before);
      for (const f of set.files) {
        const source = fresh.file(f.path)?.source;
        if (source === undefined) throw new Error(f.path);
        expect(printSourceFile(source), f.path).toBe(f.text);
        expect(equivalent(source, source), f.path).toEqual({
          equivalent: true,
        });
      }
    });
  }
});

describe("F-108 AR-11 code node identity", async () => {
  const set = allSets().find((s) => s.name === "f108-code-nodes");
  if (set === undefined) throw new Error("no f108 set");
  const model = await openFiles(set.files);
  const base = shapes(await projectorFor(model));
  const kinds: PerturbKind[] = ["indent", "blank", "trailing", "crlf", "all"];
  for (const kind of kinds)
    for (const seed of [1, 2, 3])
      it(`F-108 AR-11: code node ids and ports are unchanged after whitespace-only re-parses (${kind}, seed ${seed})`, async () => {
        const perturbed: ProjectFile[] = set.files.map((f) => {
          const source = model.file(f.path)?.source;
          return source?.language === "nextflow"
            ? {
                path: f.path,
                text: perturbWhitespace(f.text, source.ast, seed, kind),
              }
            : f;
        });
        expect(perturbed.some((f, i) => f.text !== set.files[i]?.text)).toBe(
          true,
        );
        expect(shapes(await projectorFor(await openFiles(perturbed)))).toEqual(
          base,
        );
      });
});
