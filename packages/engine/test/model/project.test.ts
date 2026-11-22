import type { IncludeRules, SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type ModelEvent,
  openProject,
  type ProjectFile,
  ProjectModel,
} from "../../src/model/project";
import { installedPacks, installedPackVersions } from "../../src/packs";
import { loadParser } from "../../src/source/parser";
import { describeModel, modelAll } from "./describe";

const version = installedPackVersions()[0] as string;
let parser: SourceParser;
let rules: IncludeRules;
beforeAll(async () => {
  parser = await loadParser(version);
  rules = (
    installedPacks.find((p) => p.version === version) as {
      includes: IncludeRules;
    }
  ).includes;
});

const proc = (name: string) => `process ${name} {\n    script:\n    'x'\n}\n`;
const inc = (name: string, from: string) =>
  `include { ${name} } from '${from}'\n`;

function open(files: ProjectFile[]) {
  const events: ModelEvent[] = [];
  const project = new ProjectModel(files, {
    parser,
    includes: rules,
    trace: (e) => events.push(e),
  });
  events.length = 0;
  const take = (kind: ModelEvent["kind"]) =>
    events.filter((e) => e.kind === kind).map((e) => e.path);
  return { project, events, take };
}

const same = (project: ProjectModel, files: ProjectFile[]) => {
  const fresh = modelAll(files, parser, rules);
  expect(project.paths()).toEqual([...fresh.keys()].sort());
  for (const [path, model] of fresh)
    expect(describeModel(project.file(path) as never), path).toEqual(
      describeModel(model),
    );
};

describe("ProjectModel", () => {
  it("F-105 step 2 AR-04: changing a file re-parses only it and re-models only it and its dependants", () => {
    const { project, events, take } = open([
      { path: "main.nf", text: inc("LIB", "./lib") },
      { path: "lib.nf", text: proc("LIB") },
      { path: "other.nf", text: inc("X", "./nope") + proc("OTHER") },
    ]);
    const change = project.setFile("lib.nf", proc("LIB") + proc("MORE"));
    expect(take("parse")).toEqual(["lib.nf"]);
    expect(take("model")).toEqual(["lib.nf", "main.nf"]);
    expect(events[0]).toEqual({ kind: "parse", path: "lib.nf" });
    expect(change.remodelled).toEqual(["lib.nf", "main.nf"]);
  });

  it("F-105 step 2 AR-04: a change re-models neither the file's dependencies nor its dependants' dependants", () => {
    const { project, take } = open([
      { path: "c.nf", text: inc("A", "./a") },
      { path: "a.nf", text: inc("B", "./b") + proc("A") },
      { path: "b.nf", text: proc("B") },
    ]);
    const change = project.setFile("b.nf", `${proc("B")}\n`);
    expect(change.remodelled).toEqual(["a.nf", "b.nf"]);
    expect(take("model")).toEqual(["a.nf", "b.nf"]);
    expect(project.dependants("b.nf")).toEqual(["a.nf"]);
    expect(project.dependencies("c.nf")).toEqual(["a.nf"]);
  });

  it("F-105 step 2 AR-04: untouched files keep the same FileModel object", () => {
    const { project } = open([
      { path: "main.nf", text: inc("LIB", "./lib") },
      { path: "lib.nf", text: proc("LIB") },
      { path: "other.nf", text: proc("OTHER") },
    ]);
    const before = ["main.nf", "lib.nf", "other.nf"].map((p) =>
      project.file(p),
    );
    project.setFile("lib.nf", `${proc("LIB")}\n`);
    expect(project.file("other.nf")).toBe(before[2]);
    expect(project.file("lib.nf")).not.toBe(before[1]);
    expect(project.file("main.nf")).not.toBe(before[0]);
    expect(project.file("nothing.nf")).toBeUndefined();
  });

  it("F-105 step 2 AR-04: creating a missing target re-models its includers and clears their diagnostics; deleting it brings back a diagnostic naming the path", () => {
    const { project } = open([
      { path: "main.nf", text: inc("LIB", "./lib") },
      { path: "other.nf", text: proc("OTHER") },
    ]);
    expect(project.file("main.nf")?.diagnostics.map((d) => d.message)).toEqual([
      "Invalid include source: 'lib.nf'",
    ]);
    const created = project.setFile("lib.nf", proc("LIB"));
    expect(created.remodelled).toEqual(["lib.nf", "main.nf"]);
    expect(project.file("main.nf")?.diagnostics).toEqual([]);
    expect(project.lookup("main.nf", "LIB")).toMatchObject({
      kind: "include",
      entry: { declaration: { kind: "Process" } },
    });
    const deleted = project.deleteFile("lib.nf");
    expect(deleted.remodelled).toEqual(["main.nf"]);
    expect(project.file("lib.nf")).toBeUndefined();
    expect(project.diagnostics().map((d) => [d.path, d.message])).toEqual([
      ["main.nf", "Invalid include source: 'lib.nf'"],
    ]);
    expect(project.deleteFile("lib.nf").remodelled).toEqual([]);
  });

  it("F-105 step 2 AR-04: a directory appearing switches ./x from x.nf to x/main.nf", () => {
    const { project } = open([
      { path: "main.nf", text: inc("A", "./x") },
      { path: "x.nf", text: proc("A") },
    ]);
    expect(project.file("main.nf")?.diagnostics).toEqual([]);
    expect(project.dependencies("main.nf")).toEqual(["x.nf"]);
    const change = project.setFile("x/README.md", "# x\n");
    expect(change.remodelled).toEqual(["main.nf", "x/README.md"]);
    expect(project.file("main.nf")?.diagnostics.map((d) => d.message)).toEqual([
      "Invalid include source: 'x/main.nf'",
    ]);
    project.setFile("x/main.nf", proc("A"));
    expect(project.file("main.nf")?.diagnostics).toEqual([]);
    expect(project.dependencies("main.nf")).toEqual(["x/main.nf"]);
    expect(project.dependants("x.nf")).toEqual([]);
    const gone = project.deleteFile("x/main.nf");
    expect(gone.remodelled).toEqual(["main.nf"]);
    project.deleteFile("x/README.md");
    expect(project.file("main.nf")?.diagnostics).toEqual([]);
    expect(project.dependencies("main.nf")).toEqual(["x.nf"]);
  });

  it("F-105 AR-03: dependencies and dependants follow resolved includes in both directions, configs included", () => {
    const { project } = open([
      { path: "main.nf", text: inc("A", "./a") + inc("P", "plugin/p") },
      { path: "a.nf", text: proc("A") },
      {
        path: "nextflow.config",
        text: "includeConfig 'conf/base.config'\nincludeConfig 'conf/missing.config'\n",
      },
      { path: "conf/base.config", text: "includeConfig 'more.config'\n" },
      { path: "conf/more.config", text: "process.cpus = 1\n" },
    ]);
    expect(project.dependencies("main.nf")).toEqual(["a.nf"]);
    expect(project.dependants("a.nf")).toEqual(["main.nf"]);
    expect(project.dependencies("nextflow.config")).toEqual([
      "conf/base.config",
    ]);
    expect(project.dependants("conf/more.config")).toEqual([
      "conf/base.config",
    ]);
    expect(project.dependants("main.nf")).toEqual([]);
    expect(project.dependencies("nothing")).toEqual([]);
    expect(project.paths()).toEqual([
      "a.nf",
      "conf/base.config",
      "conf/more.config",
      "main.nf",
      "nextflow.config",
    ]);
  });

  it("F-105 IO-14: modelling never throws", () => {
    const { project } = open([
      { path: "self.nf", text: inc("S", "./self") + proc("S") },
      { path: "a.nf", text: inc("B", "./b") },
      { path: "b.nf", text: inc("A", "./a") },
      { path: "broken.nf", text: "\u0000 {{{ include" },
      { path: "README.md", text: "# x\n" },
    ]);
    expect(project.file("self.nf")?.diagnostics).toEqual([]);
    expect(
      project.setFile("a.nf", "include {").remodelled.length,
    ).toBeGreaterThan(0);
    expect(() => project.setFile("b.nf", "")).not.toThrow();
    expect(() => project.deleteFile("broken.nf")).not.toThrow();
  });

  it("F-105 AR-04: after any sequence of changes the model equals a fresh build", () => {
    let seed = 20261122;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)] as T;
    const paths = [
      "main.nf",
      "a.nf",
      "b.nf",
      "lib/main.nf",
      "lib/c.nf",
      "x.nf",
      "x/main.nf",
      "modules/nf-core/x/main.nf",
      "modules/nf-core/x/meta.yml",
      "nextflow.config",
      "conf/base.config",
      "x/README.md",
    ];
    const sources = [
      "./a",
      "./b",
      "./lib",
      "./lib/c",
      "./x",
      "nf-core/x",
      "plugin/p",
      "../up",
      "./nope",
    ];
    const names = ["P_a", "P_b", "P_c", "P_x", "P_main", "workflow", "ZZ"];
    const textFor = (path: string): string => {
      if (path.endsWith(".md")) return "# hi\n";
      if (path.endsWith("meta.yml")) return "name: x\n";
      if (path.endsWith(".config")) {
        const lines = Array.from({ length: rand(3) }, () =>
          pick([
            `includeConfig 'conf/base.config'`,
            `includeConfig 'base.config'`,
            `includeConfig 'nextflow.config'`,
            `includeConfig params.x`,
          ]),
        );
        return `${lines.join("\n")}\nprocess.cpus = 1\n`;
      }
      const lines = Array.from({ length: rand(4) }, () =>
        inc(pick(names), pick(sources)),
      );
      const stem = path.replace(/\.nf$/, "").split("/").pop();
      const body = rand(5) === 0 ? "process BROKEN {\n" : proc(`P_${stem}`);
      return lines.join("") + (rand(4) === 0 ? "" : body);
    };
    const files = new Map<string, string>();
    for (const p of paths.slice(0, 7)) files.set(p, textFor(p));
    const toFiles = () => [...files].map(([path, text]) => ({ path, text }));
    const { project } = open(toFiles());
    same(project, toFiles());
    for (let step = 0; step < 200; step++) {
      const path = pick(paths);
      if (files.has(path) && rand(3) === 0) {
        files.delete(path);
        project.deleteFile(path);
      } else {
        const text = textFor(path);
        files.set(path, text);
        project.setFile(path, text);
      }
      same(project, toFiles());
    }
  });

  it("F-105: openProject loads the pack's parser and rules; an unknown version rejects", async () => {
    const project = await openProject(version, [
      { path: "main.nf", text: inc("LIB", "./lib") },
      { path: "lib.nf", text: proc("LIB") },
    ]);
    expect(project.file("main.nf")?.diagnostics).toEqual([]);
    expect(project.lookup("main.nf", "LIB")?.kind).toBe("include");
    await expect(openProject("0.00", [])).rejects.toThrow(
      "No language pack for 0.00",
    );
  });
});
