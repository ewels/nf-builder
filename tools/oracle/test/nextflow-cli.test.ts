import { describe, expect, it, vi } from "vitest";
import { main } from "../src/nextflow-cli.ts";

const pin = { version: "1.2.3", sha256: "a".repeat(64) };

describe("F-005 pnpm nextflow", () => {
  it("F-005: pnpm nextflow drops one leading -- and passes the rest to Nextflow in the directory pnpm was started from", () => {
    const spawn = vi.fn(() => 7);
    const code = main(["--", "lint", "x.nf"], {
      pin,
      ensure: () => "/dist",
      spawn,
      env: { INIT_CWD: "/work" },
    });
    expect(code).toBe(7);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [dist, args, cwd] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      string,
    ];
    expect([dist, args, cwd]).toEqual(["/dist", ["lint", "x.nf"], "/work"]);
  });

  it("F-005: pnpm nextflow exits 3 with the reason when the download or hash check fails", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = main(["-version"], {
      pin,
      ensure: () => {
        throw new Error("hash mismatch");
      },
      spawn: () => 0,
      env: {},
    });
    expect(code).toBe(3);
    expect(err.mock.calls.flat().join(" ")).toContain("hash mismatch");
    err.mockRestore();
  });
});
