import { describe, expect, it } from "vitest";
import { parseIgnore } from "../../src/import/ignore";
import { importProblem, selectFiles, summarise } from "../../src/import/select";
import type { ImportCandidate } from "../../src/import/types";

const file = (
  path: string,
  over: Partial<ImportCandidate> = {},
): ImportCandidate => ({
  path,
  size: 10,
  text: "x",
  reason: null,
  ...over,
});

describe("import selection", () => {
  it("F-403 IO-12: selectFiles keeps text files no pattern ignores, sorted by path; ignored wins over binary and too-large; unsafe and duplicate win over ignored", () => {
    const candidates = [
      file("main.nf"),
      file("b/z.nf"),
      file("a.nf"),
      file("work/x.nf"),
      file("work/bin.png", { text: null, reason: "binary" }),
      file("work/big.txt", { text: null, reason: "too-large" }),
      file("pic.png", { text: null, reason: "binary" }),
      file("../work/evil", { text: null, reason: "unsafe-path" }),
      file("work/dup.nf", { text: null, reason: "duplicate" }),
    ];
    const list = parseIgnore("work/\n");
    expect(selectFiles(candidates, list)).toEqual([
      { path: "a.nf", text: "x" },
      { path: "b/z.nf", text: "x" },
      { path: "main.nf", text: "x" },
    ]);
    const summary = summarise({
      source: "s.zip",
      stripped: "T",
      candidates,
      ignore: "work/\n",
    });
    const reasons = Object.fromEntries(
      summary.skipped.map((g) => [g.reason, g.paths]),
    );
    expect(reasons.ignored).toEqual([
      "work/big.txt",
      "work/bin.png",
      "work/x.nf",
    ]);
    expect(reasons["unsafe-path"]).toEqual(["../work/evil"]);
    expect(reasons.duplicate).toEqual(["work/dup.nf"]);
    expect(reasons.binary).toEqual(["pic.png"]);
  });

  it("F-403 IO-12 UX-61: summarise gives files, bytes and skipped groups in a fixed order with at most 100 paths each, and carries the ignore problems", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      file(`w/${String(i).padStart(3, "0")}`, { size: 2 }),
    );
    const candidates = [
      file("a.nf", { size: 100 }),
      file("b.nf", { size: 50 }),
      file("u", { text: null, reason: "unsupported", size: 3 }),
      file("d", { text: null, reason: "duplicate", size: 4 }),
      file("big", { text: null, reason: "too-large", size: 2_000_000 }),
      file("i.png", { text: null, reason: "binary", size: 7 }),
      ...many,
    ];
    const summary = summarise({
      source: "s.zip",
      stripped: null,
      candidates,
      ignore: "w/\n!x\n",
    });
    expect(summary.source).toBe("s.zip");
    expect(summary.stripped).toBeNull();
    expect(summary.files).toBe(2);
    expect(summary.bytes).toBe(150);
    expect(summary.skipped.map((g) => g.reason)).toEqual([
      "ignored",
      "too-large",
      "binary",
      "duplicate",
      "unsupported",
    ]);
    const ignored = summary.skipped[0];
    expect(ignored?.count).toBe(150);
    expect(ignored?.bytes).toBe(300);
    expect(ignored?.paths).toHaveLength(100);
    expect(ignored?.paths[0]).toBe("w/000");
    expect(summary.ignore).toBe("w/\n!x\n");
    expect(summary.ignoreProblems.map((p) => p.line)).toEqual([2]);
  });

  it("F-403 IO-12: importProblem reports the first ignore-list problem and an import with no files", () => {
    const base = { source: "s.zip", stripped: null };
    const ok = summarise({ ...base, candidates: [file("a.nf")], ignore: "" });
    expect(importProblem(ok)).toBeNull();
    const bad = summarise({
      ...base,
      candidates: [file("a.nf")],
      ignore: "a\n!b\n[c]\n",
    });
    expect(importProblem(bad)).toMatch(
      /^Fix the ignore list first\. Line 2: .+/,
    );
    const none = summarise({
      ...base,
      candidates: [file("a.nf")],
      ignore: "*\n",
    });
    expect(importProblem(none)).toBe(
      "Nothing to import: every file was skipped.",
    );
  });

  it("F-403 IO-11: summarise groups 20,000 skipped files in linear time", () => {
    const candidates = Array.from({ length: 20_000 }, (_, i) =>
      file(`work/f${i}.txt`),
    );
    const input = { source: "a.zip", stripped: null, candidates };
    const started = performance.now();
    const summary = summarise({ ...input, ignore: "work/\n" });
    const elapsed = performance.now() - started;
    expect(summary.skipped[0]).toMatchObject({
      reason: "ignored",
      count: 20_000,
    });
    expect(elapsed).toBeLessThan(500);
  });
});
