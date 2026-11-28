import { describe, expect, it } from "vitest";
import {
  createRegistryClient,
  createRegistrySearch,
  groupModules,
  moduleMarks,
  namespaceOf,
  type RegistryModule,
  shortName,
} from "../src/index";
import { fakeFetch, goldenText, jsonResponse, SNAPSHOT_URL } from "./helpers";

const mod = (
  over: Partial<RegistryModule> & { name: string },
): RegistryModule => ({
  version: "1.0.0",
  kind: "process",
  component: null,
  typed: false,
  description: "",
  keywords: [],
  ...over,
});

const plugin = (id: string, summary: string) => ({
  id,
  version: "1.0.0",
  requires: "",
  summary,
  provider: "x",
  projectUrl: "",
  definitions: 0,
});

describe("registry view", () => {
  it("F-503 UX-14: namespaceOf and shortName split at the first slash, including three-segment names (cellgeni/anndata/concat -> cellgeni, anndata/concat)", () => {
    expect(namespaceOf("cellgeni/anndata/concat")).toBe("cellgeni");
    expect(shortName("cellgeni/anndata/concat")).toBe("anndata/concat");
    expect(namespaceOf("nf-core/fastqc")).toBe("nf-core");
    expect(shortName("nf-core/fastqc")).toBe("fastqc");
  });

  it("F-503 UX-14: groupModules puts nf-core first, then the other namespaces in code-point order, and keeps name order inside each group", () => {
    const groups = groupModules([
      mod({ name: "cellgeni/a" }),
      mod({ name: "nextflow-io/hello" }),
      mod({ name: "nf-core/a" }),
      mod({ name: "nf-core/b" }),
      mod({ name: "seqera/x" }),
    ]);
    expect(groups.map((g) => g.namespace)).toEqual([
      "nf-core",
      "cellgeni",
      "nextflow-io",
      "seqera",
    ]);
    expect(groups[0]?.modules.map((m) => m.name)).toEqual([
      "nf-core/a",
      "nf-core/b",
    ]);
  });

  it("F-503 step 1 UX-11: searching [fastqc] over the fixture index returns nf-core/fastqc and not nextflow-io/hello", async () => {
    const f = fakeFetch(() => jsonResponse(goldenText()));
    const index = await createRegistryClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    }).index();
    const { modules } = createRegistrySearch(index)(["fastqc"]);
    expect(modules.map((m) => m.name)).toEqual(["nf-core/fastqc"]);
  });

  it("F-503 UX-11: a module matches on description or keyword, case-insensitively, and only when every term matches; a plugin matches on id or summary", () => {
    const search = createRegistrySearch({
      modules: [
        mod({
          name: "a/one",
          description: "Align READS",
          keywords: ["Quality"],
        }),
        mod({ name: "a/two", description: "Align" }),
      ],
      plugins: [plugin("nf-schema", "Validates sheets"), plugin("nf-x", "")],
    });
    expect(search(["reads"]).modules.map((m) => m.name)).toEqual(["a/one"]);
    expect(search(["quality", "align"]).modules.map((m) => m.name)).toEqual([
      "a/one",
    ]);
    expect(search(["quality", "zzz"]).modules).toEqual([]);
    expect(search(["schema"]).plugins.map((p) => p.id)).toEqual(["nf-schema"]);
    expect(search(["sheets"]).plugins.map((p) => p.id)).toEqual(["nf-schema"]);
    expect(search(["nf-x"]).plugins.map((p) => p.id)).toEqual(["nf-x"]);
  });

  it("F-503 UX-11: empty terms return the index's own arrays", () => {
    const index = {
      modules: [mod({ name: "a/b" })],
      plugins: [plugin("p", "")],
    };
    const all = createRegistrySearch(index)([]);
    expect(all.modules).toBe(index.modules);
    expect(all.plugins).toBe(index.plugins);
  });

  it("F-503 UX-14: moduleMarks tags typed only when typed is true and version is not null; typed null and live-only modules get no tag", () => {
    expect(moduleMarks(mod({ name: "a/b", typed: true }))).toEqual({
      kind: "process",
      typed: true,
    });
    expect(moduleMarks(mod({ name: "a/b", typed: null })).typed).toBe(false);
    expect(moduleMarks(mod({ name: "a/b", typed: false })).typed).toBe(false);
    expect(
      moduleMarks(
        mod({ name: "a/b", typed: true, version: null, kind: "workflow" }),
      ),
    ).toEqual({ kind: "workflow", typed: false });
  });
});
