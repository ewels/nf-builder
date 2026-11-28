// F-405 (UX-23, ADR 0007, LA-35, ADR 0004): an imported legacy pipeline, nf-core/rnaseq at its pin. No canvas node
// carries the typed badge, nf-core module calls are modelled and legacy, LA-35 flags every process and workflow (the
// registry module files among them) and each workflow summary's modelled share equals its committed projection
// snapshot. rnaseq-nf-typed is the positive control. Run by `pnpm test:corpus` after `pnpm corpus:fetch`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canvasView } from "../../src/canvas/view";
import { workflowSummary } from "../../src/details/summary";
import { registryFolders } from "../../src/files/registry";
import { installedPacks } from "../../src/packs";
import { registryModuleOf } from "../../src/problems";
import { diagnoseFiles } from "../diagnostics/open";
import { readTree } from "../model/read-tree";
import { projectorFor } from "../projection/open";
import { snapshotName as name } from "../projection/sets";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const SNAPSHOTS = join(import.meta.dirname, "snapshots/legacy-projection");

async function open(id: string) {
  if (!existsSync(join(CORPUS, id)))
    throw new Error(`pin ${id} is not fetched (run pnpm corpus:fetch)`);
  const opened = await diagnoseFiles(readTree(join(CORPUS, id)));
  const projector = await projectorFor(opened.model);
  const projections = projector.workflows().flatMap((w) => {
    const p = projector.project(w.path, w.name);
    return p === null ? [] : [p];
  });
  return { ...opened, projector, projections };
}

const rnaseq = await open("rnaseq");

function registryOf({ model }: { model: typeof rnaseq.model }) {
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  return registryFolders(model.paths(), pack.includes, model.tree);
}

describe("F-405 imported legacy pipelines", () => {
  it("F-405 UX-23 ADR-0007: no node of any rnaseq workflow carries the typed badge, and at least ten calls of modules/nf-core processes are modelled and legacy", () => {
    expect(rnaseq.projections.length).toBeGreaterThan(20);
    for (const p of rnaseq.projections)
      for (const n of canvasView(p, { portLabels: true }).nodes)
        expect(n.badge, `${p.workflow.path} ${n.id}`).toBeNull();
    const modules = rnaseq.projections.flatMap((p) =>
      p.nodes.filter(
        (n) =>
          n.kind === "call" &&
          n.callee.path?.startsWith("modules/nf-core/") &&
          n.callee.typed === false &&
          n.callee.status === "modelled",
      ),
    );
    expect(modules.length).toBeGreaterThanOrEqual(10);
  });

  it("F-405 UX-23: rnaseq-nf-typed's typed calls carry the badge", async () => {
    const typed = await open("rnaseq-nf-typed");
    const badges = typed.projections.flatMap((p) =>
      canvasView(p, { portLabels: true }).nodes.filter(
        (n) => n.badge === "typed",
      ),
    );
    expect(badges.length).toBeGreaterThan(0);
  });

  it("F-405 LA-35: rnaseq has one legacy-process suggestion per process and one legacy-workflow per workflow, and 75 of the legacy-process ones are in registry module files", () => {
    const { diagnoser } = rnaseq;
    const registry = registryOf(rnaseq);
    const all = diagnoser.all();
    const processes = all.filter((d) => d.code === "legacy-process");
    const workflows = all.filter((d) => d.code === "legacy-workflow");
    expect(processes).toHaveLength(79);
    expect(workflows).toHaveLength(rnaseq.projector.workflows().length);
    expect(
      processes.filter((d) => registryModuleOf(d.path, registry) !== null),
    ).toHaveLength(75);
  });

  it("F-405 ADR-0004: every rnaseq workflow summary's coverage equals the snapshot header", () => {
    let compared = 0;
    for (const p of rnaseq.projections) {
      const file = `${SNAPSHOTS}/rnaseq/${name(p.workflow.path, p.workflow.name)}`;
      if (!existsSync(file)) continue;
      compared++;
      const m = /^statements (\d+), modelled (\d+)$/m.exec(
        readFileSync(file, "utf8"),
      );
      const { coverage } = workflowSummary(p);
      expect([coverage.statements, coverage.modelled], p.workflow.path).toEqual(
        [Number(m?.[1]), Number(m?.[2])],
      );
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("F-405 ADR-0055: rnaseq's workflow summaries list the nf-core modules their calls include by relative path", () => {
    const registry = registryOf(rnaseq);
    let listed = 0;
    for (const p of rnaseq.projections) {
      const expected = new Set(
        p.nodes.flatMap((n) => {
          const m =
            n.kind === "call"
              ? /^modules\/(nf-core\/.+)\/[^/]+$/.exec(n.callee.path ?? "")
              : null;
          return m?.[1] ? [m[1]] : [];
        }),
      );
      const modules = workflowSummary(p, registry).modules.map((m) => m.module);
      expect(new Set(modules), p.workflow.path).toEqual(expected);
      listed += modules.length;
    }
    expect(listed).toBeGreaterThan(20);
  });
});
