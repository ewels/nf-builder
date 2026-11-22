import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pack } from "@nf-builder/lang-2610";
import type {
  RegistrySnapshotIndex,
  SnapshotModuleBundle,
  SourceParser,
} from "@nf-builder/lang-core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createRegistryApi,
  type RegistryApi,
  RegistryHttpError,
} from "../src/api.ts";
import {
  type BuildOptions,
  buildSnapshot,
  type PreviousSnapshot,
  readPreviousSnapshot,
  SnapshotBuildError,
} from "../src/build.ts";
import {
  moduleBundlePath,
  pluginFilePath,
  serialise,
  writeSnapshot,
} from "../src/files.ts";
import { replayFetch } from "../src/recording.ts";
import { reportMarkdown, snapshotSizes } from "../src/report.ts";
import { readModuleTarGz } from "../src/tar.ts";
import { expectedDir, recordedDir, recordedTarGz } from "./support/recorded.ts";

const NOW = new Date("2026-11-22T00:00:00.000Z");
const ONLY = {
  modules: ["nf-core/fastqc", "nextflow-io/hello", "nf-core/bam_applybqsr"],
  plugins: ["nf-schema", "nf-ffq"],
};
const FASTQC = "nf-core/fastqc";

let parser: SourceParser;
beforeAll(async () => {
  parser = await pack.loadParser();
});
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "nf-build-"));
  dirs.push(d);
  return d;
};

function replayApi(): { api: RegistryApi; requested: () => readonly string[] } {
  const fetch = replayFetch(recordedDir);
  return {
    api: createRegistryApi({ fetch, sleep: async () => {} }),
    requested: () => fetch.requested,
  };
}
const options = (
  api: RegistryApi,
  extra: Partial<BuildOptions> = {},
): BuildOptions => ({
  api,
  parser,
  language: "26.10",
  nextflow: "26.10.7",
  now: () => NOW,
  only: ONLY,
  ...extra,
});

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? walk(path, base)
      : [relative(base, path).split("\\").join("/")];
  });
}

describe("F-501 snapshot build", () => {
  it("F-501 IO-31: replaying the recording gives the golden snapshot", async () => {
    const { files } = await buildSnapshot(options(replayApi().api));
    if (process.env.UPDATE_GOLDEN === "1") {
      writeSnapshot(expectedDir, files);
      return;
    }
    expect(walk(expectedDir).sort()).toEqual([...files.keys()].sort());
    for (const [path, text] of files)
      expect(readFileSync(join(expectedDir, path), "utf8") === text, path).toBe(
        true,
      );
  });

  it("F-501 IO-31: the index lists modules and plugins sorted, classified, with ports apart", async () => {
    const { files } = await buildSnapshot(options(replayApi().api));
    const index = JSON.parse(
      files.get("registry/index.json") ?? "",
    ) as RegistrySnapshotIndex;
    expect(index).toMatchObject({
      format: 1,
      generatedAt: NOW.toISOString(),
      registry: "https://registry.nextflow.io",
      language: "26.10",
      nextflow: "26.10.7",
    });
    expect(
      index.modules.map((m) => [m.name, m.kind, m.component, m.typed]),
    ).toEqual([
      ["nextflow-io/hello", "process", "HELLO", true],
      ["nf-core/bam_applybqsr", "workflow", "BAM_APPLYBQSR", false],
      ["nf-core/fastqc", "process", "FASTQC", false],
    ]);
    expect(index.plugins.map((p) => [p.id, p.version, p.definitions])).toEqual([
      ["nf-ffq", "0.2.0", 0],
      ["nf-schema", "3.1.0", 21],
    ]);
    expect(JSON.stringify(index)).not.toContain("greeting:string");
  });

  it("F-501 IO-31: each module bundle holds every file of its registry tar.gz and the verified checksum", async () => {
    const { files } = await buildSnapshot(options(replayApi().api));
    const tar = await recordedTarGz(FASTQC, "0.0.0-6d1763b");
    const bundle = JSON.parse(
      files.get(moduleBundlePath(FASTQC, "0.0.0-6d1763b")) ?? "",
    ) as SnapshotModuleBundle;
    expect(bundle.files).toEqual(readModuleTarGz(tar));
    expect(bundle.checksum).toBe(
      `sha256:${createHash("sha256").update(tar).digest("hex")}`,
    );
    expect(bundle).toMatchObject({
      format: 1,
      name: FASTQC,
      version: "0.0.0-6d1763b",
      component: "FASTQC",
      requires: [],
    });
  });

  it("F-501 IO-31: a workflow module's pinned dependency versions get their own bundles", async () => {
    const { files, report } = await buildSnapshot(options(replayApi().api));
    const workflow = JSON.parse(
      files.get(moduleBundlePath("nf-core/bam_applybqsr", "0.0.0-df69bf6")) ??
        "",
    ) as SnapshotModuleBundle;
    expect(workflow.requires).toEqual([
      { name: "nf-core/gatk4/applybqsr", version: "0.0.0-6d1763b" },
      { name: "nf-core/samtools/merge", version: "0.0.0-df69bf6" },
    ]);
    for (const pin of workflow.requires)
      expect(files.has(moduleBundlePath(pin.name, pin.version)), pin.name).toBe(
        true,
      );
    expect(report.pins).toBe(2);
    // Pinned versions are bundles only: they aren't in the index.
    expect(files.get("registry/index.json")).not.toContain(
      "nf-core/gatk4/applybqsr",
    );
  });

  it("F-501: bundles in --previous with a matching checksum are reused without a download", async () => {
    const previous = readPreviousSnapshot(expectedDir) as PreviousSnapshot;
    expect(previous).toBeDefined();
    const { api, requested } = replayApi();
    const { files, report } = await buildSnapshot(options(api, { previous }));
    expect(
      requested().filter((u) => u.includes("/download") || u.includes("blobs")),
    ).toEqual([]);
    expect(report).toMatchObject({ reused: 5, downloaded: 0 });
    expect(files.get("registry/index.json")).toBe(
      readFileSync(join(expectedDir, "registry/index.json"), "utf8"),
    );
  });

  it("F-501: a module failing after retries keeps its previous entry or is left out, and the report lists it", async () => {
    const { api } = replayApi();
    const failing: RegistryApi = {
      ...api,
      getModule: async (name) => {
        if (name === FASTQC)
          throw new RegistryHttpError("https://registry.example/x", 500);
        return api.getModule(name);
      },
    };
    const lenient = { maxFailureRatio: 1, minCountRatio: 0 };
    const previous = readPreviousSnapshot(expectedDir) as PreviousSnapshot;

    const kept = await buildSnapshot(
      options(failing, { previous, limits: lenient }),
    );
    expect(kept.report.failures).toEqual([
      { id: FASTQC, error: expect.stringContaining("500"), kept: true },
    ]);
    expect(kept.files.get("registry/index.json")).toBe(
      readFileSync(join(expectedDir, "registry/index.json"), "utf8"),
    );
    expect(kept.files.has(moduleBundlePath(FASTQC, "0.0.0-6d1763b"))).toBe(
      true,
    );

    const left = await buildSnapshot(options(failing, { limits: lenient }));
    expect(left.report.failures).toEqual([
      { id: FASTQC, error: expect.stringContaining("500"), kept: false },
    ]);
    const index = JSON.parse(
      left.files.get("registry/index.json") ?? "",
    ) as RegistrySnapshotIndex;
    expect(index.modules.map((m) => m.name)).not.toContain(FASTQC);
    expect(left.files.has(moduleBundlePath(FASTQC, "0.0.0-6d1763b"))).toBe(
      false,
    );
    expect(reportMarkdown(left.report, snapshotSizes(left.files))).toContain(
      `${FASTQC} (left out)`,
    );
  });

  it("F-501: a failed workflow module that keeps its previous bundle also keeps its pinned dependency versions", async () => {
    const { api } = replayApi();
    const failing: RegistryApi = {
      ...api,
      getModule: async (name) => {
        if (name === "nf-core/bam_applybqsr")
          throw new RegistryHttpError("https://registry.example/x", 500);
        return api.getModule(name);
      },
    };
    const previous = readPreviousSnapshot(expectedDir) as PreviousSnapshot;
    const { files, report } = await buildSnapshot(
      options(failing, {
        previous,
        limits: { maxFailureRatio: 1, minCountRatio: 0 },
      }),
    );
    expect(report.failures).toEqual([
      expect.objectContaining({ id: "nf-core/bam_applybqsr", kept: true }),
    ]);
    expect(
      files.has(moduleBundlePath("nf-core/gatk4/applybqsr", "0.0.0-6d1763b")),
    ).toBe(true);
    expect(
      files.has(moduleBundlePath("nf-core/samtools/merge", "0.0.0-df69bf6")),
    ).toBe(true);
  });

  it("F-501: names, versions and plugin ids are validated before they become paths; an invalid item is a failure", async () => {
    for (const bad of [
      "../x/y",
      "nf-core/../../etc",
      "nf-core",
      "NF/x",
      "a/b c",
      "/a/b",
      "a//b",
    ])
      expect(() => moduleBundlePath(bad, "1.0.0"), bad).toThrow(/invalid/);
    for (const bad of ["../1", "1/2", "", "-1", "1 0"])
      expect(() => moduleBundlePath("nf-core/x", bad), bad).toThrow(/invalid/);
    for (const bad of ["../p", "a/b", "", ".hidden"])
      expect(() => pluginFilePath(bad, "1.0.0"), bad).toThrow(/invalid/);
    expect(moduleBundlePath("nf-core/samtools/merge", "0.0.0-df69bf6")).toBe(
      "registry/modules/nf-core/samtools/merge/0.0.0-df69bf6.json",
    );
    expect(pluginFilePath("nf-schema", "3.1.0")).toBe(
      "registry/plugins/nf-schema/3.1.0.json",
    );

    const { api } = replayApi();
    const hostile: RegistryApi = {
      ...api,
      getPlugin: async (id) => ({ id, releases: [] }),
    };
    const { report } = await buildSnapshot(
      options(hostile, {
        only: { modules: ["nf-core/../../evil", FASTQC], plugins: ["../evil"] },
        limits: { maxFailureRatio: 1, minCountRatio: 0 },
      }),
    );
    expect(report.failures.map((f) => f.id)).toEqual([
      "nf-core/../../evil",
      "../evil",
    ]);
    expect(report.modules).toBe(1);
  });

  it("F-501: a checksum mismatch fails the module", async () => {
    const { api } = replayApi();
    const corrupt: RegistryApi = {
      ...api,
      downloadModule: async () => new Uint8Array([1, 2, 3]),
    };
    const { report } = await buildSnapshot(
      options(corrupt, {
        only: { modules: [FASTQC], plugins: [] },
        limits: { maxFailureRatio: 1, minCountRatio: 0 },
      }),
    );
    expect(report.failures[0]?.error).toContain("checksum");
  });

  it("F-501: more than 2% failures, or under 90% of the previous count, throws SnapshotBuildError", async () => {
    const { api } = replayApi();
    const failing: RegistryApi = {
      ...api,
      getModule: async () => {
        throw new RegistryHttpError("https://registry.example/x", 500);
      },
    };
    await expect(buildSnapshot(options(failing))).rejects.toThrow(
      SnapshotBuildError,
    );

    const previous = readPreviousSnapshot(expectedDir) as PreviousSnapshot;
    const crowded: PreviousSnapshot = {
      ...previous,
      index: {
        ...previous.index,
        modules: Array.from({ length: 10 }, (_, i) => ({
          ...(previous.index.modules[0] as object),
          name: `a/m${i}`,
        })) as never,
      },
    };
    const small: RegistryApi = {
      ...api,
      listModules: async () => [FASTQC],
      listPlugins: async () => [],
    };
    await expect(
      buildSnapshot(options(small, { only: undefined, previous: crowded })),
    ).rejects.toThrow(/under 90%/);
    const same: PreviousSnapshot = {
      ...previous,
      index: {
        ...previous.index,
        modules: previous.index.modules.filter((m) => m.name === FASTQC),
      },
    };
    await expect(
      buildSnapshot(options(small, { only: undefined, previous: same })),
    ).resolves.toBeDefined();
  });

  it("F-501: two builds with the same clock give identical bytes", async () => {
    const a = await buildSnapshot(options(replayApi().api));
    const b = await buildSnapshot(options(replayApi().api));
    expect([...a.files]).toEqual([...b.files]);
  });

  it("F-501: the report states the index size and that fastqc is legacy", async () => {
    const { files, report } = await buildSnapshot(options(replayApi().api));
    const markdown = reportMarkdown(report, snapshotSizes(files));
    expect(markdown).toContain("nf-core/fastqc: legacy process FASTQC");
    expect(markdown).toMatch(
      /index\.json \| [\d.]+ kB, [\d.]+ kB gzipped \(QA-06\)/,
    );
  });

  it("F-501: writeSnapshot replaces <dir>/registry and serialise is minified", () => {
    const dir = tmp();
    mkdirSync(join(dir, "registry"), { recursive: true });
    writeFileSync(join(dir, "registry/stale.json"), "{}");
    writeSnapshot(
      dir,
      new Map([[pluginFilePath("nf-x", "1.0.0"), serialise({ a: [1] })]]),
    );
    expect(existsSync(join(dir, "registry/stale.json"))).toBe(false);
    expect(
      readFileSync(join(dir, "registry/plugins/nf-x/1.0.0.json"), "utf8"),
    ).toBe('{"a":[1]}');
    expect(dirname(moduleBundlePath("nf-core/samtools/merge", "1"))).toBe(
      "registry/modules/nf-core/samtools/merge",
    );
  });
});
