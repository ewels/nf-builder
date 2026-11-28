import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type EngineRefusal,
  type OutlineResult,
} from "../../src";
import { installedPackVersions } from "../../src/packs";

const version = installedPackVersions()[0] as string;
const CASE = join(
  import.meta.dirname,
  "../../../../tools/oracle/cases/f605-library",
);

function readCase(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else
        out.push({
          path: relative(CASE, full),
          text: readFileSync(full, "utf8"),
        });
    }
  };
  walk(CASE);
  return out;
}

const must = (r: OutlineResult | EngineRefusal): OutlineResult => {
  if ("ok" in r) throw new Error(`refused: ${r.code}`);
  return r;
};

describe("F-605 engine service outline", () => {
  it("F-605 FI-31: outline answers at the current revision; an unknown path is refused as not-found, and no project as no-project", async () => {
    const service = createEngineService();
    const none = await service.outline("main.nf");
    expect(none).toMatchObject({ ok: false, code: "no-project" });
    const summary = await service.open({ version, files: readCase() });
    const result = must(await service.outline("lib/samples.nf"));
    expect(result.revision).toBe(summary.revision);
    const missing = await service.outline("nope.nf");
    expect(missing).toMatchObject({
      ok: false,
      code: "not-found",
      path: "nope.nf",
    });
    // a file with no outline (Markdown) answers with no items
    expect(must(await service.outline("README.md")).items).toEqual([]);
  });

  it("F-605 FI-31: the f605-library case outlines lib/samples.nf as a function, a record and an enum", async () => {
    const service = createEngineService();
    await service.open({ version, files: readCase() });
    const { items } = must(await service.outline("lib/samples.nf"));
    expect(items.map((i) => [i.kind, i.name])).toEqual([
      ["featureFlag", "nextflow.enable.types"],
      ["enum", "Kind"],
      ["record", "Sample"],
      ["function", "greet"],
    ]);
  });

  it("F-605 ADR-0003: outline results survive structuredClone", async () => {
    const service = createEngineService();
    await service.open({ version, files: readCase() });
    const result = must(await service.outline("lib/samples.nf"));
    expect(structuredClone(result)).toEqual(result);
  });
});
