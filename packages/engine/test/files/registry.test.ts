import { join } from "node:path";
import { pack } from "@nf-builder/lang-2610";
import { describe, expect, it } from "vitest";
import { projectTreeOf } from "../../src/files/paths";
import { registryFolders } from "../../src/files/registry";
import { readTree } from "../model/read-tree";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const of = (paths: string[]) =>
  registryFolders(paths, pack.includes, projectTreeOf(paths));
const pathsOf = (id: string) => readTree(join(cases, id)).map((f) => f.path);

describe("F-210 registry folders", () => {
  it("F-210 UX-16 AR-03: a modules/<scope>/<name>/ folder with main.nf and meta.yml is a registry folder with its reference, including multi-segment names", () => {
    expect(
      of([
        "modules/nf-core/fastqc/main.nf",
        "modules/nf-core/fastqc/meta.yml",
        "modules/nf-core/bwa/mem/main.nf",
        "modules/nf-core/bwa/mem/meta.yml",
      ]),
    ).toEqual([
      { path: "modules/nf-core/bwa/mem", module: "nf-core/bwa/mem" },
      { path: "modules/nf-core/fastqc", module: "nf-core/fastqc" },
    ]);
  });

  it("F-210 UX-16 AR-03 ADR-0034: a module vendored under another module's modules/ folder is found with the innermost reference", () => {
    expect(of(pathsOf("f105-includes-resolve"))).toEqual([
      { path: "modules/nf-core/sub", module: "nf-core/sub" },
      {
        path: "modules/nf-core/sub/modules/nf-core/dep",
        module: "nf-core/dep",
      },
      { path: "modules/nf-core/top", module: "nf-core/top" },
    ]);
  });

  it("F-210 UX-16: modules/local/ folders, folders missing main.nf or meta.yml, references the pack rejects, modules/b and subworkflows/ folders are not registry folders", () => {
    expect(
      of([
        "modules/local/a/main.nf",
        "modules/local/a/meta.yml",
        "modules/nf-core/nometa/main.nf",
        "modules/nf-core/nomain/meta.yml",
        "modules/Bad_Scope/x/main.nf",
        "modules/Bad_Scope/x/meta.yml",
        "modules/b/main.nf",
        "modules/b/meta.yml",
        "subworkflows/nf-core/s/main.nf",
        "subworkflows/nf-core/s/meta.yml",
        "meta.yml",
      ]),
    ).toEqual([]);
  });

  it("F-210 UX-16: the f205-canvas fixture has exactly one registry folder, modules/nf-core/wordcount", () => {
    expect(of(pathsOf("f205-canvas"))).toEqual([
      { path: "modules/nf-core/wordcount", module: "nf-core/wordcount" },
    ]);
  });
});
