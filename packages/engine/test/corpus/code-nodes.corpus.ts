// F-108 step 2 and IO-14 (ADR-0004, IO-20): code nodes over the pinned corpus. Every code node's text is exactly its
// statement's source and re-parses on its own to the same statement; projecting leaves files unchanged; every workflow
// projects with the free-variable analysis without throwing. Run by `pnpm test:corpus` after `pnpm corpus:fetch`; writes
// .cache/reports/code-nodes-corpus.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFile, ProjectModel } from "../../src/index";
import type { Projector } from "../../src/projection/project";
import { printSourceFile } from "../../src/source/print";
import { readTree } from "../model/read-tree";
import {
  codeNodes,
  plain,
  statementOf,
  wrapped,
} from "../projection/code/helpers";
import { scriptParser } from "../projection/code/statement";
import { openFiles, projectorFor } from "../projection/open";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

interface Pin {
  id: string;
  files: ProjectFile[];
  model: ProjectModel;
  projector: Projector;
}
const pins: Pin[] = [];
beforeAll(async () => {
  for (const id of IDS) {
    if (!existsSync(join(CORPUS, id))) continue;
    const files = readTree(join(CORPUS, id));
    const model = await openFiles(files);
    pins.push({ id, files, model, projector: await projectorFor(model) });
  }
});

describe("F-108 step 2 corpus code nodes", () => {
  it("F-108 step 2 ADR-0004 IO-20: on every pinned pipeline, code node text is exact and re-parses to the same statement, and projection leaves files unchanged", async () => {
    expect(pins.length).toBeGreaterThan(0);
    const parsers = {
      plain: await scriptParser(),
      typed: await scriptParser(true),
    };
    const rows: string[] = [];
    for (const pin of pins) {
      const before = JSON.stringify(
        pin.files.map((f) => pin.model.file(f.path)?.source),
      );
      const nodes = codeNodes(pin.model, pin.projector);
      let inputs = 0;
      let outputs = 0;
      for (const { node, text, typed, ast } of nodes) {
        const where = `${pin.id}: ${node.id}`;
        expect(node.text, where).toBe(
          text.slice(node.range.start, node.range.end),
        );
        const parser = typed ? parsers.typed : parsers.plain;
        const body = [...parser.workflows(wrapped(node, typed)).values()][0];
        expect(body, where).toHaveLength(1);
        expect(plain(body?.[0]), where).toBe(plain(statementOf(ast, node)));
        // a read of `params.x` is wired to its own port, never to the whole of `:params`
        expect(
          node.inputs.map((i) => i.id),
          where,
        ).not.toContain("params");
        inputs += node.inputs.length;
        outputs += node.outputs.length;
      }
      for (const ref of pin.projector.workflows())
        pin.projector.project(ref.path, ref.name);
      expect(
        JSON.stringify(pin.files.map((f) => pin.model.file(f.path)?.source)),
        pin.id,
      ).toBe(before);
      for (const f of pin.files) {
        const source = pin.model.file(f.path)?.source;
        if (source?.language === "nextflow" && source.ast !== null)
          expect(printSourceFile(source), `${pin.id}:${f.path}`).toBe(f.text);
      }
      let edges = 0;
      for (const ref of pin.projector.workflows()) {
        if (!ref.modelled) continue;
        const p = pin.projector.project(ref.path, ref.name);
        for (const e of p?.edges ?? [])
          if (nodes.some((n) => n.node.id === e.to.node && n.path === ref.path))
            edges += 1;
      }
      rows.push(
        `| ${pin.id} | ${nodes.length} | ${inputs} | ${outputs} | ${edges} |`,
      );
    }
    const lines = [
      "## Code nodes (F-108)",
      "",
      "Per pin: code nodes, their input and output ports, and the edges into them.",
      "",
      "| Pin | Code nodes | Inputs | Outputs | Edges in |",
      "|---|---|---|---|---|",
      ...rows,
      "",
    ];
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "code-nodes-corpus.md"), lines.join("\n"));
  });

  it("F-108 IO-14: every corpus workflow projects with code-node analysis without throwing", () => {
    for (const pin of pins)
      for (const ref of pin.projector.workflows())
        if (ref.modelled)
          expect(
            () => pin.projector.project(ref.path, ref.name),
            `${pin.id}:${ref.path}`,
          ).not.toThrow();
  });
});
