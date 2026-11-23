import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { basePath } from "../scripts/base-path.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";

describe("base path", () => {
  it("F-011 ADR-0040: basePath defaults to / and normalises /nf-builder and /nf-builder/ to /nf-builder/", () => {
    expect(basePath({})).toBe("/");
    expect(basePath({ BASE_PATH: "" })).toBe("/");
    expect(basePath({ BASE_PATH: "/" })).toBe("/");
    expect(basePath({ BASE_PATH: "/nf-builder" })).toBe("/nf-builder/");
    expect(basePath({ BASE_PATH: "/nf-builder/" })).toBe("/nf-builder/");
  });

  it.each([
    "./",
    "./nf-builder/",
    "nf-builder",
    "//host",
    "//host/x/",
    "https://example.com/nf-builder/",
  ])(
    "F-011 ADR-0040: basePath rejects ./, a bare name, //host and absolute URLs (%s)",
    (value) => {
      expect(() => basePath({ BASE_PATH: value })).toThrow(/BASE_PATH/);
    },
  );

  it("F-011 ADR-0040: no app source, index.html, public file, Vite config, build script or pages.yml hard-codes /nf-builder/", () => {
    // apps/web/public has no files since F-502 deleted the S4 probe page; scan it if it comes back.
    const files = (dir: string): string[] =>
      readdirSync(join(REPO_ROOT, dir), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name));
    const source = files("apps/web/src");
    const scripts = files("scripts");
    expect(source.length).toBeGreaterThan(0);
    expect(scripts.length).toBeGreaterThan(0);
    // Only this directory may be absent.
    const pub = existsSync(join(REPO_ROOT, "apps/web/public"))
      ? files("apps/web/public")
      : [];
    const targets = [
      ...source,
      ...pub.filter((f) => !f.includes("/registry/")),
      ...scripts,
      join(REPO_ROOT, "apps/web/index.html"),
      join(REPO_ROOT, "apps/web/vite.config.ts"),
      join(REPO_ROOT, ".github/workflows/pages.yml"),
    ];
    expect(targets.length).toBeGreaterThan(10);
    for (const file of targets)
      expect(readFileSync(file, "utf8"), file).not.toContain("/nf-builder/");
  });
});
