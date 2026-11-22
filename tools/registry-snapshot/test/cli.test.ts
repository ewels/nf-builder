import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { recordedDir } from "./support/recorded.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("F-501 registry:snapshot CLI", () => {
  it("F-501 IO-31: --replay with --only builds the snapshot into --out and writes the report", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = mkdtempSync(join(tmpdir(), "nf-cli-"));
    dirs.push(out);
    const code = await main([
      "--replay",
      recordedDir,
      "--only",
      "nf-core/fastqc",
      "--out",
      out,
      "--report",
      join(out, "report.md"),
      "--now",
      "2026-11-22T00:00:00.000Z",
    ]);
    expect(code).toBe(0);
    const index = JSON.parse(
      readFileSync(join(out, "registry/index.json"), "utf8"),
    );
    expect(index.modules.map((m: { name: string }) => m.name)).toEqual([
      "nf-core/fastqc",
    ]);
    expect(index.plugins).toEqual([]);
    expect(
      existsSync(
        join(out, "registry/modules/nf-core/fastqc/0.0.0-6d1763b.json"),
      ),
    ).toBe(true);
    expect(readFileSync(join(out, "report.md"), "utf8")).toContain(
      "legacy process FASTQC",
    );
  });

  it("F-501: usage errors exit 2, a build error exits 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--bogus"])).toBe(2);
    expect(await main(["--record", "a", "--replay", "b"])).toBe(2);
    expect(await main(["--now", "yesterday"])).toBe(2);
    const out = mkdtempSync(join(tmpdir(), "nf-cli-"));
    dirs.push(out);
    expect(
      await main([
        "--replay",
        recordedDir,
        "--only",
        "nf-core/unrecorded",
        "--out",
        out,
      ]),
    ).toBe(1);
  });
});
