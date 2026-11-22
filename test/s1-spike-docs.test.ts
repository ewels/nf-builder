import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";

const read = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), "utf8");
const REPORT = "docs/research/2026-11-22-spike-s1-typed-legacy-interop.md";
const adr = (prefix: string): string =>
  `docs/adr/${readdirSync(join(REPO_ROOT, "docs/adr")).find((f) => f.startsWith(prefix))}`;

describe("F-005 spike S1 documents", () => {
  it("F-005 ADR-0007 ADR-0009 LA-14: the S1 report names every case, both ADRs link it, and LA-14 has no interim warning", () => {
    const ids = [
      ...read("tools/oracle/cases/cases.yaml").matchAll(/^\s*- id: (\S+)/gm),
    ]
      .map((m) => m[1] ?? "")
      .filter((id) => id.startsWith("s1-"));
    expect(ids.length).toBeGreaterThan(0);
    const report = read(REPORT);
    for (const id of ids) expect(report, id).toContain(id);
    for (const prefix of ["0007-", "0009-"]) {
      const text = read(adr(prefix));
      const section = text.split(/^## Spike result$/m)[1] ?? "";
      expect(section, prefix).toContain(
        "(../research/2026-11-22-spike-s1-typed-legacy-interop.md)",
      );
    }
    const row =
      read("docs/spec/language.md")
        .split("\n")
        .find((l) => l.startsWith("| LA-14 ")) ?? "";
    expect(row).not.toBe("");
    expect(row).not.toContain("shows a warning");
  });
});
