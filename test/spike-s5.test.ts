import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cspProblems,
  SITE_POLICY_HEADERS,
} from "../scripts/security-policy.ts";
import {
  addToScriptSrc,
  spikeS5Headers,
  WASM_UNSAFE_EVAL,
} from "../spikes/s5-nf-metro/headers.ts";
import {
  BUILD_HOSTS,
  fetchAssets,
  freshManifest,
  readAssets,
  referenceCommands,
  SPIKE_S5_DIR,
  type SpikeAsset,
} from "../spikes/s5-nf-metro/prepare.ts";
import {
  normaliseSvg,
  pixelDiff,
  type Raster,
} from "../spikes/s5-nf-metro/src/compare.ts";
import { MAPS, WHEELS } from "../spikes/s5-nf-metro/src/protocol.ts";

const sha = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const temps: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "spike-s5-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true });
});

const entry = (over: Partial<SpikeAsset> = {}): SpikeAsset => ({
  path: "examples/a.mmd",
  url: "https://raw.githubusercontent.com/x/a.mmd",
  sha256: "a".repeat(64),
  bytes: 3,
  ...over,
});

function assetsFile(assets: unknown[]): string {
  const file = join(temp(), "assets.json");
  writeFileSync(
    file,
    JSON.stringify({
      pyodide: "314.0.8",
      nfMetro: { version: "2.1.0", commit: "c" },
      assets,
    }),
  );
  return file;
}

describe("F-010 spike S5 pins", () => {
  it("F-010 ADR-0013: assets.json pins Pyodide 314.0.8, five wheels and the example inputs, each by an https URL on a recorded build-time host and a sha256", () => {
    const file = readAssets();
    expect(file.pyodide).toBe("314.0.8");
    expect(file.nfMetro.version).toBe("2.1.0");
    for (const asset of file.assets)
      expect(BUILD_HOSTS, asset.path).toContain(new URL(asset.url).hostname);
    const paths = file.assets.map((a) => a.path);
    for (const core of [
      "pyodide.mjs",
      "pyodide.asm.mjs",
      "pyodide.asm.wasm",
      "python_stdlib.zip",
      "pyodide-lock.json",
    ])
      expect(paths).toContain(`pyodide/${core}`);
  });

  it("F-010 ADR-0013: the browser installs nf-metro, lark, drawsvg, networkx and Pillow only: no av, resvg-py, click or micropip", () => {
    const paths = readAssets().assets.map((a) => a.path);
    const wheels = paths
      .filter((p) => p.startsWith("wheels/"))
      .map((p) => p.slice("wheels/".length));
    expect(wheels).toEqual([...WHEELS]);
    expect(WHEELS[0]).toMatch(/^nf_metro-/);
    for (const wheel of wheels)
      expect(wheel).not.toMatch(/^(av|resvg|click|micropip)/i);
    for (const map of MAPS) {
      expect(paths).toContain(`examples/${map.name}.mmd`);
      for (const logo of map.logos) expect(paths).toContain(`examples/${logo}`);
    }
  });

  it("F-010: readAssets rejects a path outside the cache, a non-https URL, an unrecorded host, a malformed sha256 and a duplicate path, naming the entry", () => {
    const cases: [string, unknown[]][] = [
      ["/etc/passwd", [entry({ path: "/etc/passwd" })]],
      ["examples/../x", [entry({ path: "examples/../x" })]],
      ["other/a.mmd", [entry({ path: "other/a.mmd" })]],
      [
        "examples/http.mmd",
        [
          entry({
            path: "examples/http.mmd",
            url: "http://raw.githubusercontent.com/a",
          }),
        ],
      ],
      [
        "examples/host.mmd",
        [entry({ path: "examples/host.mmd", url: "https://example.com/a" })],
      ],
      [
        "examples/sha.mmd",
        [entry({ path: "examples/sha.mmd", sha256: "ABC" })],
      ],
      ["examples/bytes.mmd", [entry({ path: "examples/bytes.mmd", bytes: 0 })]],
      ["examples/a.mmd", [entry(), entry()]],
    ];
    for (const [path, assets] of cases)
      expect(() => readAssets(assetsFile(assets)), path).toThrow(path);
  });
});

describe("F-010 spike S5 fetch", () => {
  const body = new TextEncoder().encode("abc");

  it("F-010: fetchAssets verifies size and sha256, keeps no file on a mismatch, and names the file, both hashes and the URL", async () => {
    const dir = temp();
    const asset = entry({ sha256: sha(body) });
    const fetchImpl = vi.fn(async () => new Response("xyz"));
    const error = await fetchAssets([asset], dir, fetchImpl as never).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(error).toContain(asset.path);
    expect(error).toContain(sha("xyz"));
    expect(error).toContain(asset.sha256);
    expect(error).toContain(asset.url);
    expect(existsSync(join(dir, asset.path))).toBe(false);
    expect(existsSync(join(dir, `${asset.path}.part`))).toBe(false);
  });

  it("F-010: a second fetchAssets run with every file present and verified makes no request", async () => {
    const dir = temp();
    const asset = entry({ sha256: sha(body) });
    const fetchImpl = vi.fn(async () => new Response(body));
    expect(await fetchAssets([asset], dir, fetchImpl as never)).toEqual({
      fetched: 1,
      upToDate: 0,
    });
    expect(readFileSync(join(dir, asset.path), "utf8")).toBe("abc");
    fetchImpl.mockClear();
    expect(await fetchAssets([asset], dir, fetchImpl as never)).toEqual({
      fetched: 0,
      upToDate: 1,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("F-010 spike S5 references", () => {
  it("F-010 step 2: referenceCommands creates a venv, installs requirements-cli.txt and renders each map with nf-metro render into reference/<name>.svg", () => {
    const commands = referenceCommands({
      cacheDir: "/c",
      spikeDir: "/s",
      publicDir: "/c/public",
      maps: ["rnaseq_metro", "sarek_metro"],
    });
    expect(commands).toEqual([
      { file: "python3", args: ["-m", "venv", "/c/venv"] },
      {
        file: "/c/venv/bin/python",
        args: [
          "-m",
          "pip",
          "install",
          "--disable-pip-version-check",
          "-r",
          "/s/requirements-cli.txt",
        ],
      },
      {
        file: "/c/venv/bin/python",
        args: [
          "-c",
          "import sys, nf_metro; print(nf_metro.__version__, sys.version.split()[0])",
        ],
      },
      {
        file: "/c/venv/bin/nf-metro",
        args: [
          "render",
          "/c/public/examples/rnaseq_metro.mmd",
          "-o",
          "/c/public/reference/rnaseq_metro.svg",
        ],
      },
      {
        file: "/c/venv/bin/nf-metro",
        args: [
          "render",
          "/c/public/examples/sarek_metro.mmd",
          "-o",
          "/c/public/reference/sarek_metro.svg",
        ],
      },
    ]);
    expect(SPIKE_S5_DIR).toMatch(/spikes\/s5-nf-metro$/);
  });
});

describe("F-010 spike S5 headers", () => {
  const site = SITE_POLICY_HEADERS;
  const CSP = "Content-Security-Policy";

  it("F-010 QA-30 ADR-0014: spikeS5Headers is the site policy (`SITE_POLICY_HEADERS`) with only 'wasm-unsafe-eval' added to script-src, and the CSP still passes cspProblems", () => {
    const spike = spikeS5Headers();
    expect(Object.keys(spike)).toEqual(Object.keys(site));
    for (const [name, value] of Object.entries(site))
      if (name !== CSP) expect(spike[name], name).toBe(value);
    expect(WASM_UNSAFE_EVAL).toBe("'wasm-unsafe-eval'");
    expect(spike[CSP]).toBe(
      (site[CSP] ?? "").replace(
        "script-src 'self';",
        "script-src 'self' 'wasm-unsafe-eval';",
      ),
    );
    expect(spike[CSP]).not.toBe(site[CSP]);
    expect(cspProblems(spike[CSP] ?? "")).toEqual([]);
    expect(spikeS5Headers("production")).toEqual(site);
    expect(() => addToScriptSrc("default-src 'self'", "x")).toThrow(
      /script-src/,
    );
  });
});

describe("F-010 spike S5 comparison", () => {
  const raster = (width: number, height: number, fill = 0): Raster => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(fill),
  });

  it("F-010 step 2: pixelDiff is 0 for identical rasters, counts pixels whose largest channel difference exceeds the threshold, and reports different sizes as a full mismatch", () => {
    const a = raster(2, 2, 100);
    expect(pixelDiff(a, raster(2, 2, 100))).toEqual({
      sameSize: true,
      mismatchPixels: 0,
      mismatchRatio: 0,
    });
    const over = raster(2, 2, 100);
    over.data[4] = 126;
    expect(pixelDiff(a, over)).toEqual({
      sameSize: true,
      mismatchPixels: 1,
      mismatchRatio: 0.25,
    });
    const at = raster(2, 2, 100);
    at.data[4] = 125;
    expect(pixelDiff(a, at).mismatchPixels).toBe(0);
    expect(pixelDiff(raster(2, 2), raster(3, 2))).toEqual({
      sameSize: false,
      mismatchPixels: 6,
      mismatchRatio: 1,
    });
  });

  it("F-010 step 2: normaliseSvg ignores trailing whitespace only", () => {
    expect(normaliseSvg("<svg/>\n")).toBe(normaliseSvg("<svg/>"));
    expect(normaliseSvg("<svg a=1  b=2/>")).not.toBe(
      normaliseSvg("<svg a=1 b=2/>"),
    );
  });
});

describe("F-010 spike S5 reference cache", () => {
  it("F-010 step 2: freshManifest accepts the references only while their files still have the recorded hashes", () => {
    const dir = temp();
    mkdirSync(join(dir, "reference"));
    writeFileSync(join(dir, "reference/a.svg"), "<svg/>");
    const manifest = {
      nfMetro: "2.1.0",
      python: "3.13.0",
      inputs: "in",
      files: { a: sha("<svg/>") },
    };
    writeFileSync(
      join(dir, "reference/manifest.json"),
      JSON.stringify(manifest),
    );
    expect(freshManifest(dir, "in")).toEqual(manifest);
    expect(freshManifest(dir, "other")).toBeUndefined();
    writeFileSync(join(dir, "reference/a.svg"), "<svg>changed</svg>");
    expect(freshManifest(dir, "in")).toBeUndefined();
    rmSync(join(dir, "reference/a.svg"));
    expect(freshManifest(dir, "in")).toBeUndefined();
  });
});
