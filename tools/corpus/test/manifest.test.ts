import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManifest, parseManifest } from "../src/manifest.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SHA = "a".repeat(40);
const entry = (extra = "") =>
  `  - id: alpha\n    repo: owner/alpha\n    ref: main\n    sha: ${SHA}\n${extra}`;

describe("corpus.yaml", () => {
  it("F-009 step 1 ADR-0011: corpus.yaml pins nf-core/rnaseq, sarek and fetchngs and nextflow-io/rnaseq-nf master and static-typing by full commit SHA", () => {
    const { pipelines } = loadManifest();
    expect(pipelines).toHaveLength(5);
    expect(pipelines.map((p) => p.repo).sort()).toEqual(
      [
        "nf-core/rnaseq",
        "nf-core/sarek",
        "nf-core/fetchngs",
        "nextflow-io/rnaseq-nf",
        "nextflow-io/rnaseq-nf",
      ].sort(),
    );
    expect(
      pipelines
        .filter((p) => p.repo === "nextflow-io/rnaseq-nf")
        .map((p) => p.ref)
        .sort(),
    ).toEqual(["master", "static-typing"]);
    for (const p of pipelines.filter((p) => p.repo.startsWith("nf-core/")))
      expect(p.ref).toMatch(/^\d+\.\d+\.\d+$/);
    for (const p of pipelines) expect(p.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(new Set(pipelines.map((p) => p.id)).size).toBe(pipelines.length);
  });

  it.each([
    [
      "short sha",
      `pipelines:\n  - id: alpha\n    repo: owner/alpha\n    ref: main\n    sha: abc123\n`,
      ["pipelines[0]", "sha"],
    ],
    [
      "unquoted numeric ref",
      `pipelines:\n  - id: alpha\n    repo: owner/alpha\n    ref: 1.13\n    sha: ${SHA}\n`,
      ["pipelines[0]", "ref", "quote it"],
    ],
    [
      "duplicate id",
      `pipelines:\n${entry()}${entry()}`,
      ["pipelines[1]", "duplicate id"],
    ],
    [
      "unknown key",
      `pipelines:\n${entry("    branch: main\n")}`,
      ["pipelines[0]", "branch"],
    ],
    [
      "repo not owner/name",
      `pipelines:\n  - id: alpha\n    repo: rnaseq\n    ref: main\n    sha: ${SHA}\n`,
      ["pipelines[0]", "repo"],
    ],
    [
      "bad id",
      `pipelines:\n  - id: RNAseq\n    repo: owner/alpha\n    ref: main\n    sha: ${SHA}\n`,
      ["pipelines[0]", "id"],
    ],
    [
      "missing sha",
      `pipelines:\n  - id: alpha\n    repo: owner/alpha\n    ref: main\n`,
      ["pipelines[0]", "missing", "sha"],
    ],
    ["empty pipelines", "pipelines: []\n", ["pipelines", "non-empty"]],
    [
      "unknown top-level key",
      `pipelines:\n${entry()}extra: 1\n`,
      ["unknown top-level key", "extra"],
    ],
  ])(
    "F-009: parseManifest rejects a bad pin and names the entry and field (%s)",
    (_name, text, parts) => {
      const result = parseManifest(text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const joined = result.problems.join("\n");
      for (const part of parts) expect(joined).toContain(part);
    },
  );

  it("F-009: parseManifest reports YAML syntax errors with their line", () => {
    const result = parseManifest("pipelines: [a, b\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/line \d+/);
  });

  it("F-009: loadManifest throws with the file path and every problem", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "nf-builder-corpus-")));
    dirs.push(dir);
    const file = join(dir, "bad.yaml");
    writeFileSync(
      file,
      `pipelines:\n  - id: RNAseq\n    repo: rnaseq\n    ref: main\n    sha: ${SHA}\n`,
    );
    let message = "";
    try {
      loadManifest(file);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(file);
    expect(message).toContain('"id"');
    expect(message).toContain('"repo"');
  });
});
