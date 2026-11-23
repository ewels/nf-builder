// F-206 IO-14: node details over the pinned corpus. Every node of every workflow of every pinned pipeline gets its
// node view and its worker details without throwing, and every summary builds. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch`; writes .cache/reports/details-corpus.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeDetails } from "../../src/details/details";
import { nodeView } from "../../src/details/node-view";
import { workflowSummary } from "../../src/details/summary";
import { createDiagnoser } from "../../src/diagnostics/diagnose";
import { loadLints } from "../../src/diagnostics/lints";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { createProjector } from "../../src/projection/project";
import { readTree } from "../model/read-tree";
import { openFiles } from "../projection/open";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

describe("F-206 corpus details", () => {
  it("F-206 IO-14: every node of every pinned corpus workflow gets details without throwing", async () => {
    const version = installedPackVersions()[0] as string;
    const pack = installedPacks[0];
    if (pack === undefined) throw new Error("no pack installed");
    const catalogue = await pack.loadCatalogue();
    const lints = await loadLints(version);
    const rows: string[] = [];
    let total = 0;
    for (const id of IDS) {
      if (!existsSync(join(CORPUS, id))) continue;
      const model = await openFiles(readTree(join(CORPUS, id)));
      const projector = createProjector(model, catalogue.script, {
        legacyOperators: pack.legacyOperators,
      });
      const diagnoser = createDiagnoser({ model, projector, catalogue, lints });
      let nodes = 0;
      for (const ref of projector.workflows()) {
        const projection = projector.project(ref.path, ref.name);
        if (projection === null) continue;
        workflowSummary(projection);
        for (const node of projection.nodes) {
          expect(nodeView(projection, node.id), node.id).not.toBeNull();
          const details = nodeDetails(
            {
              model,
              catalogue: catalogue.script,
              projection,
              diagnostics: (p) => diagnoser.file(p),
            },
            node.id,
          );
          expect(details, node.id).not.toBeNull();
          nodes++;
        }
      }
      total += nodes;
      rows.push(`| ${id} | ${nodes} |`);
    }
    expect(total).toBeGreaterThan(0);
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(
      join(REPORTS, "details-corpus.md"),
      `# Node details over the corpus (F-206)\n\n| Pin | Nodes |\n|---|---|\n${rows.join("\n")}\n`,
    );
  }, 600_000);
});
