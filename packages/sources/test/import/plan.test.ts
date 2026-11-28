import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { binaryByName } from "../../src/import/binary";
import { DEFAULT_IGNORE } from "../../src/import/ignore";
import { IMPORT_LIMITS } from "../../src/import/limits";
import { type PlanCandidate, planImport } from "../../src/import/plan";

const file = (path: string, size: number | null = 10): PlanCandidate => ({
  path,
  size,
  kind: "file",
});

const reasons = (plan: ReturnType<typeof planImport>) =>
  Object.fromEntries(plan.summary.skipped.map((g) => [g.reason, g.paths]));

describe("GitHub import plan", () => {
  it("F-401 IO-12: binaryByName decides by extension, case-insensitively", () => {
    expect(binaryByName("a/b.PNG")).toBe(true);
    expect(binaryByName("x.tar.gz")).toBe(true);
    expect(binaryByName("main.nf")).toBe(false);
    expect(binaryByName("Makefile")).toBe(false);
    expect(binaryByName("dir.png/readme.md")).toBe(false);
  });

  it("F-401 IO-12 UX-61: each skip reason applies: unsafe path, symlink, submodule, ignored, binary, over 1,000,000 bytes", () => {
    const plan = planImport(
      [
        file("main.nf"),
        file("a/../b.nf"),
        { path: "link", size: 5, kind: "symlink" },
        { path: "sub", size: null, kind: "submodule" },
        file("work/x.nf"),
        file("logo.png"),
        file("big.txt", IMPORT_LIMITS.maxTextFileBytes + 1),
      ],
      "work/\n",
    );
    expect(plan.files).toEqual([{ path: "main.nf", size: 10 }]);
    const r = reasons(plan);
    expect(r["unsafe-path"]).toEqual(["a/../b.nf"]);
    expect(r.unsupported).toEqual(["link", "sub"]);
    expect(r.ignored).toEqual(["work/x.nf"]);
    expect(r.binary).toEqual(["logo.png"]);
    expect(r["too-large"]).toEqual(["big.txt"]);
  });

  it("F-401 IO-12: over 20,000 selected files or 200,000,000 bytes is a breach; ignored files don't count", () => {
    const many = Array.from({ length: 20_001 }, (_, i) => file(`f/${i}.nf`, 1));
    expect(planImport(many, "").breaches).toEqual([
      { limit: "files", actual: 20_001, max: 20_000 },
    ]);
    const ignored = Array.from({ length: 20_001 }, (_, i) =>
      file(`work/${i}.nf`, 1),
    );
    expect(
      planImport([...ignored, file("main.nf")], "work/\n").breaches,
    ).toEqual([]);
    const heavy = Array.from({ length: 201 }, (_, i) =>
      file(`d/${i}.txt`, 999_999),
    );
    expect(planImport(heavy, "").breaches).toEqual([
      { limit: "total-bytes", actual: 201 * 999_999, max: 200_000_000 },
    ]);
  });

  it("F-401 UX-61: a plan without a .nf file sets hasNextflow false", () => {
    expect(planImport([file("README.md")], "").hasNextflow).toBe(false);
    expect(planImport([file("a/main.nf")], "").hasNextflow).toBe(true);
    expect(planImport([file("work/main.nf")], "work/\n").hasNextflow).toBe(
      false,
    );
  });

  it("F-401 step 1 IO-12 UX-61: the fetchngs 1.13.0 tree plans 155 files and 2,287,680 bytes, and skips the 4 PNGs as binary", () => {
    const body = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/github/nf-core-fetchngs-955c892.tree.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      tree: { path: string; mode: string; type: string; size?: number }[];
    };
    const candidates = body.tree
      .filter((e) => e.type === "blob")
      .map((e) => file(e.path, e.size ?? 0));
    const plan = planImport(candidates, DEFAULT_IGNORE);
    expect(plan.files).toHaveLength(155);
    expect(plan.summary.bytes).toBe(2_287_680);
    expect(plan.summary.skipped.map((g) => [g.reason, g.count])).toEqual([
      ["binary", 4],
    ]);
    expect(plan.breaches).toEqual([]);
  });
});
