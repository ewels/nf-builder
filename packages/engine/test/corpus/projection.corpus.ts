// F-106 steps 1 and 2 (AR-10, AR-11, LA-28, IO-14): the projection over the pinned corpus. The typed rnaseq-nf branch's
// workflows match committed snapshots and keep their ids, ports and edges under whitespace-only changes; every workflow
// of every pin projects without throwing, with unique ids and every main statement represented. Run by
// `pnpm test:corpus` after `pnpm corpus:fetch`; writes .cache/reports/projection-corpus.md (F-107's baseline).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Projection } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectFile, ProjectModel } from "../../src/index";
import type { Projector } from "../../src/projection/project";
import { equivalent } from "../../src/source/equivalent";
import { readTree } from "../model/read-tree";
import { openFiles, projectorFor } from "../projection/open";
import { renderProjection } from "../projection/render";
import { shapes } from "../projection/shape";
import { type PerturbKind, perturbWhitespace } from "../projection/whitespace";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");
const SNAPSHOTS = join(import.meta.dirname, "../projection/snapshots");

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
const pin = (id: string): Pin => {
  const found = pins.find((p) => p.id === id);
  if (found === undefined) throw new Error(`pin ${id} is not fetched`);
  return found;
};

beforeAll(async () => {
  for (const id of IDS) {
    if (!existsSync(join(CORPUS, id))) continue;
    const files = readTree(join(CORPUS, id));
    const model = await openFiles(files);
    pins.push({ id, files, model, projector: await projectorFor(model) });
  }
});

const TYPED = "rnaseq-nf-typed";
const SNAPSHOT_WORKFLOWS: [string, string | null][] = [
  ["main.nf", null],
  ["modules/rnaseq.nf", "RNASEQ"],
];

describe("F-106 step 1 corpus snapshots", () => {
  for (const [path, name] of SNAPSHOT_WORKFLOWS)
    it(`F-106 step 1: the typed rnaseq-nf branch's ${path}#${name ?? ""} matches its projection snapshot`, async () => {
      const { projector, model } = pin(TYPED);
      const projection = projector.project(path, name);
      if (projection === null) throw new Error(`no projection for ${path}`);
      const text = model.file(path)?.source.text ?? "";
      await expect(renderProjection(projection, text)).toMatchFileSnapshot(
        `${SNAPSHOTS}/${TYPED}/${path.replaceAll("/", "__")}--${name ?? "entry"}.txt`,
      );
    });
});

const KINDS: PerturbKind[] = ["indent", "blank", "trailing", "crlf", "all"];
describe("F-106 step 2 corpus identity", () => {
  for (const kind of KINDS)
    for (const seed of [1, 2, 3])
      it(`F-106 step 2 AR-11: rnaseq-nf-typed ids are stable across whitespace-only re-parses (${kind}, seed ${seed})`, async () => {
        const { files, model, projector } = pin(TYPED);
        const perturbed = files.map((f) => {
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
        for (const f of files) {
          const a = model.file(f.path)?.source;
          const b = again.file(f.path)?.source;
          if (a === undefined || b === undefined) throw new Error(f.path);
          if (a.text !== b.text) changed += 1;
          expect(equivalent(a, b), f.path).toEqual({ equivalent: true });
        }
        expect(changed).toBeGreaterThan(0);
        expect(shapes(await projectorFor(again))).toEqual(shapes(projector));
      });
});

interface Stats {
  workflows: number;
  unparsed: number;
  nodes: Record<string, number>;
  statements: number;
  code: number;
}

describe("F-106 IO-14 AR-10 corpus projection", () => {
  it("F-106 IO-14 AR-10: every workflow of every pinned pipeline projects without throwing, with unique ids and every statement represented", () => {
    expect(pins.length).toBeGreaterThan(0);
    const rows: [string, Stats][] = [];
    for (const pinned of pins) {
      const stats: Stats = {
        workflows: 0,
        unparsed: 0,
        nodes: {},
        statements: 0,
        code: 0,
      };
      const seen = new Set<string>();
      for (const ref of pinned.projector.workflows()) {
        if (!ref.modelled) {
          stats.unparsed += 1;
          expect(pinned.projector.project(ref.path, ref.name)).toBeNull();
          continue;
        }
        let projection: Projection | null = null;
        expect(() => {
          projection = pinned.projector.project(ref.path, ref.name);
        }, `${pinned.id}:${ref.path}`).not.toThrow();
        const p = projection as Projection | null;
        if (p === null) throw new Error(`${pinned.id}: ${ref.path} gave null`);
        stats.workflows += 1;
        for (const n of p.nodes) {
          expect(seen.has(n.id), `${pinned.id}: ${n.id}`).toBe(false);
          seen.add(n.id);
          stats.nodes[n.kind] = (stats.nodes[n.kind] ?? 0) + 1;
        }
        // F-107: every statement is listed once, with the nodes it made or the names it bound (a transparent `if` by its branches)
        stats.statements += p.statements.length;
        for (const s of p.statements)
          expect(
            s.nodes.length + s.binds.length,
            `${pinned.id}:${ref.path}:${s.range.line}`,
          ).toBeGreaterThan(0);
        for (const e of p.edges) {
          expect(p.nodes.some((n) => n.id === e.from.node)).toBe(true);
          expect(p.nodes.some((n) => n.id === e.to.node)).toBe(true);
        }
      }
      stats.code = stats.nodes.code ?? 0;
      rows.push([pinned.id, stats]);
    }
    const kinds = [
      "call",
      "chain",
      "factory",
      "take",
      "emit",
      "params",
      "output",
      "code",
    ];
    const lines = [
      "## Projection (F-106)",
      "",
      "Per pin: the workflows projected (unparsed ones are listed, not projected), the nodes by kind, the main statements and the code nodes among them. F-107's baseline.",
      "",
      `| Pin | Workflows | Unparsed | ${kinds.join(" | ")} | Main statements | Code nodes |`,
      `|---|---|---|${kinds.map(() => "---").join("|")}|---|---|`,
      ...rows.map(
        ([id, s]) =>
          `| ${id} | ${s.workflows} | ${s.unparsed} | ${kinds.map((k) => s.nodes[k] ?? 0).join(" | ")} | ${s.statements} | ${s.code} |`,
      ),
      "",
    ];
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "projection-corpus.md"), lines.join("\n"));
  });
});
