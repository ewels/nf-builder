// F-401 step 3 and UX-61: the import report over the pinned corpus. Run by `pnpm test:corpus` after `pnpm corpus:fetch`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyShare, projectReport } from "../../src/report/report";
import { diagnoseFiles } from "../diagnostics/open";
import { readTree } from "../model/read-tree";
import { projectorFor } from "../projection/open";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

async function reportOf(id: string) {
  const { model, diagnoser } = await diagnoseFiles(readTree(join(CORPUS, id)));
  const projector = await projectorFor(model);
  return projectReport(model, projector.workflows(), diagnoser.all());
}

describe("F-401 corpus report", () => {
  it("F-401 step 3 UX-61: fetchngs has no parse failures and 9 legacy processes and 7 legacy workflows (100%); every pinned pipeline has no parse failures", async () => {
    const present = IDS.filter((id) => existsSync(join(CORPUS, id)));
    expect(present).toContain("fetchngs");
    for (const id of present) {
      const report = await reportOf(id);
      expect(report.parseFailures, id).toEqual([]);
      if (id === "fetchngs") {
        expect(report.processes).toEqual({ typed: 0, legacy: 9 });
        expect(report.workflows).toEqual({ typed: 0, legacy: 7 });
        expect(legacyShare(report)).toEqual({ legacy: 16, total: 16 });
      }
    }
  });
});
