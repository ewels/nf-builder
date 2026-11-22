// F-105 steps 1 and 2 (AR-03, AR-04, FI-05): the semantic model over every pinned corpus pipeline. Every script include
// resolves (or gets a diagnostic naming the missing path), every entry binds, and a change re-models only the changed
// file and its dependants. The project is every file under each pin except `.git`. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch` and `pnpm corpus:lint`; writes .cache/reports/model-corpus.md.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { IncludeRules } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  installedPackVersions,
  type ModelEvent,
  openProject,
  type ProjectFile,
  type ProjectModel,
} from "../../src/index";
import { describeModel, modelAll } from "../model/describe";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const LINT = join(ROOT, ".cache/corpus-lint");
const REPORTS = join(ROOT, ".cache/reports");
const version = installedPackVersions()[0] as string;

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

function readProject(id: string): ProjectFile[] {
  const dir = join(CORPUS, id);
  const out: ProjectFile[] = [];
  const visit = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path);
      else out.push({ path, text: readFileSync(join(dir, path), "utf8") });
    }
  };
  visit("");
  return out;
}

interface Pin {
  id: string;
  files: ProjectFile[];
  project: ProjectModel;
  events: ModelEvent[];
}
const pins: Pin[] = [];

beforeAll(async () => {
  for (const id of IDS) {
    if (!existsSync(join(CORPUS, id)) || !existsSync(join(LINT, `${id}.json`)))
      continue;
    const files = readProject(id);
    const events: ModelEvent[] = [];
    const project = await openProject(version, files, {
      trace: (e) => events.push(e),
    });
    events.length = 0;
    pins.push({ id, files, project, events });
  }
});

/** Deterministic pick of `n` items. */
function seeded<T>(items: readonly T[], n: number, seed: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let s = seed;
  while (out.length < n && pool.length > 0) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    out.push(...pool.splice((s >>> 0) % pool.length, 1));
  }
  return out;
}

/** Target path to the files that include it, computed by scanning every model (not from the project's own indexes). */
function includers(pin: Pin): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const path of pin.project.paths()) {
    const model = pin.project.file(path);
    for (const i of model?.includes ?? [])
      if (i.target.kind === "file") {
        const list = map.get(i.target.path) ?? [];
        if (!list.includes(path)) list.push(path);
        map.set(i.target.path, list);
      }
  }
  return map;
}

/** The sampled targets of a pin (plan section 4). */
function sample(pin: Pin): string[] {
  const map = includers(pin);
  const targets = [...map.keys()].sort();
  if (["rnaseq-nf", "rnaseq-nf-typed", "fetchngs"].includes(pin.id))
    return targets;
  const byFanIn = [...targets].sort(
    (a, b) =>
      (map.get(b)?.length ?? 0) - (map.get(a)?.length ?? 0) || (a < b ? -1 : 1),
  );
  const top = byFanIn.slice(0, 10);
  return [
    ...top,
    ...seeded(
      targets.filter((t) => !top.includes(t)),
      10,
      20261122,
    ),
  ];
}

const counts = {
  files: 0,
  scriptIncludes: 0,
  local: 0,
  plugin: 0,
  registry: 0,
  entries: 0,
  boundEntries: 0,
  configConstant: 0,
  configResolved: 0,
  configExternal: 0,
  diagnostics: 0,
  maxFanIn: [] as string[],
};
const samples = { deleted: 0, deletedIncluders: 0, changed: 0, remodelled: 0 };

describe("F-105 step 1: include resolution over the corpus", () => {
  it("F-105 step 1 AR-03: on every corpus pipeline, every include resolves or produces a diagnostic naming the missing path", () => {
    expect(
      pins.map((p) => p.id),
      "run pnpm corpus:fetch and corpus:lint",
    ).toEqual(IDS);
    for (const pin of pins) {
      const lint = JSON.parse(
        readFileSync(join(LINT, `${pin.id}.json`), "utf8"),
      ) as { errors: unknown[] };
      const diagnostics = pin.project.diagnostics();
      for (const path of pin.project.paths()) {
        const model = pin.project.file(path);
        counts.files++;
        for (const i of model?.includes ?? []) {
          const where = `${pin.id}/${path}:${i.node.range.line}`;
          if (i.kind === "script") {
            counts.scriptIncludes++;
            if (i.target.kind === "plugin") counts.plugin++;
            else if (i.target.kind === "file") {
              if (i.target.module) counts.registry++;
              else counts.local++;
            }
            expect(["file", "plugin"], where).toContain(i.target.kind);
            for (const e of i.entries) {
              counts.entries++;
              if (i.target.kind === "plugin") continue;
              if (e.declaration) counts.boundEntries++;
              expect(
                e.declaration,
                `${where} ${e.entry.name.name}`,
              ).not.toBeNull();
            }
          } else {
            let source = i.node.source;
            while (source.kind === "Parenthesized") source = source.expression;
            if (source.kind === "String") {
              counts.configConstant++;
              expect(i.target.kind, where).toBe("file");
              counts.configResolved++;
            } else {
              counts.configExternal++;
              expect(i.target.kind, where).toBe("external");
            }
          }
          if (i.target.kind === "missing") {
            const d = diagnostics.find(
              (x) =>
                x.path === path &&
                x.range.start === i.node.range.start &&
                x.message.includes(
                  i.target.kind === "missing" ? (i.target.path as string) : "",
                ),
            );
            expect(d, where).toBeDefined();
          }
        }
      }
      // lint reports no errors over the corpus, so parity means no include diagnostics
      expect(lint.errors, `lint errors in ${pin.id}`).toEqual([]);
      expect(
        diagnostics.map((d) => `${pin.id}/${d.path}: ${d.message}`),
      ).toEqual([]);
      counts.diagnostics += diagnostics.length;
      const fan = includers(pin);
      const top = [...fan].sort((a, b) => b[1].length - a[1].length)[0];
      if (top) counts.maxFanIn.push(`${pin.id}: ${top[0]} (${top[1].length})`);
    }
    // the counts of the regex scan in the F-105 plan (the corpus is pinned)
    expect([
      counts.scriptIncludes,
      counts.local,
      counts.plugin,
      counts.registry,
      counts.boundEntries,
      counts.configConstant,
      counts.configExternal,
    ]).toEqual([589, 549, 40, 0, 550, 117, 8]);
  });

  it("F-105 step 1: deleting an included corpus file gives each includer a diagnostic naming that path, and restoring it restores the model", () => {
    for (const pin of pins) {
      const text = new Map(pin.files.map((f) => [f.path, f.text]));
      for (const target of sample(pin)) {
        const dependants = pin.project.dependants(target);
        expect(dependants.length, target).toBeGreaterThan(0);
        const before = [target, ...dependants].map((p) =>
          describeModel(pin.project.file(p) as never),
        );
        const dir = target.slice(0, target.lastIndexOf("/"));
        pin.project.deleteFile(target);
        // a directory-form include still names main.nf while the directory has other files
        const dirStays = pin.project
          .paths()
          .some((p) => p.startsWith(`${dir}/`));
        for (const path of dependants) {
          const model = pin.project.file(path);
          const missing = (model?.includes ?? []).filter(
            (i) => i.target.kind === "missing",
          );
          expect(
            missing.length,
            `${pin.id} ${path} after deleting ${target}`,
          ).toBeGreaterThan(0);
          const named = model?.diagnostics.filter(
            (d) =>
              d.code === "include-target" &&
              (!dirStays || d.message.includes(target)),
          );
          expect(
            named?.length,
            `${pin.id} ${path} names ${target}`,
          ).toBeGreaterThan(0);
        }
        pin.project.setFile(target, text.get(target) as string);
        const after = [target, ...dependants].map((p) =>
          describeModel(pin.project.file(p) as never),
        );
        expect(after, `${pin.id} restoring ${target}`).toEqual(before);
        samples.deleted++;
        samples.deletedIncluders += dependants.length;
      }
    }
    expect(samples.deleted).toBeGreaterThan(0);
  });
});

describe("F-105 step 2 AR-04: incremental updates over the corpus", () => {
  it("F-105 step 2 AR-04: changing one corpus file re-parses only it and re-models only it and its dependants (instrumented)", () => {
    for (const pin of pins) {
      const text = new Map(pin.files.map((f) => [f.path, f.text]));
      const mains = pin.project
        .paths()
        .filter((p) => p.endsWith("/main.nf") || p === "main.nf");
      const configIncluded = pin.project
        .dependencies("nextflow.config")
        .slice(0, 1);
      const picks = [
        ...new Set([...sample(pin), ...seeded(mains, 5, 7), ...configIncluded]),
      ];
      for (const file of picks) {
        const dependants = includers(pin).get(file) ?? [];
        const expected = [...new Set([file, ...dependants])].sort();
        const models = new Map(
          pin.project.paths().map((p) => [p, pin.project.file(p)]),
        );
        pin.events.length = 0;
        const change = pin.project.setFile(file, `${text.get(file)}\n`);
        expect(
          pin.events.filter((e) => e.kind === "parse").map((e) => e.path),
          file,
        ).toEqual([file]);
        expect(
          pin.events.filter((e) => e.kind === "model").map((e) => e.path),
          file,
        ).toEqual(expected);
        expect(change.remodelled).toEqual(expected);
        for (const [p, m] of models)
          if (!expected.includes(p))
            expect(pin.project.file(p), `${pin.id} ${p} untouched`).toBe(m);
        pin.project.setFile(file, text.get(file) as string);
        samples.changed++;
        samples.remodelled += expected.length;
      }
    }
  });

  it("F-105 step 2 AR-04: after the changes every pipeline's model equals a fresh build", async () => {
    const { installedPacks } = await import("../../src/packs");
    const { loadParser } = await import("../../src/index");
    const parser = await loadParser(version);
    const rules = (
      installedPacks.find((p) => p.version === version) as {
        includes: IncludeRules;
      }
    ).includes;
    for (const pin of pins) {
      const fresh = modelAll(pin.files, parser, rules);
      expect(pin.project.paths()).toEqual([...fresh.keys()].sort());
      for (const [path, model] of fresh)
        expect(
          describeModel(pin.project.file(path) as never),
          `${pin.id}/${path}`,
        ).toEqual(describeModel(model));
    }
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(
      join(REPORTS, "model-corpus.md"),
      `${[
        "# Semantic model over the corpus (F-105)",
        "",
        "## Include resolution (F-105)",
        "",
        `- Files modelled: ${counts.files}`,
        `- Script includes: ${counts.scriptIncludes} (local ${counts.local}, registry ${counts.registry}, plugin ${counts.plugin})`,
        `- Include entries: ${counts.entries}, bound to a declaration: ${counts.boundEntries} (plugin entries bind to none)`,
        `- includeConfig with a constant path: ${counts.configConstant}, resolved: ${counts.configResolved}`,
        `- includeConfig with an expression (external, not checked, as nf-lang): ${counts.configExternal}`,
        `- Include diagnostics: ${counts.diagnostics} (lint reports 0 errors)`,
        `- Highest fan-in: ${counts.maxFanIn.join("; ")}`,
        "",
        "## Deletion and change samples",
        "",
        `- Targets deleted and restored: ${samples.deleted}, includers checked: ${samples.deletedIncluders}`,
        `- Files changed: ${samples.changed}, models recomputed in total: ${samples.remodelled}`,
      ].join("\n")}\n`,
    );
  });
});
