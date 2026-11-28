import { describe, expect, it } from "vitest";
import { configSchema } from "../../src/config/schema";
import { pack, rules } from "./helpers";

describe("F-601 config schema", () => {
  it("F-601 FI-03 FI-04: the schema lists all top-level catalogue nodes with descriptions, docs URLs and value kinds, and survives structuredClone", async () => {
    const catalogue = (await pack.loadCatalogue()).config;
    const r = await rules();
    const schema = configSchema(pack.version, catalogue, r);
    expect(schema.version).toBe(pack.version);
    expect(schema.scopes).toHaveLength(catalogue.scopes.length);
    expect(schema.scopes.length).toBe(42);
    expect(schema.forms).toBe(r.forms);
    const docker = schema.scopes.find((s) => s.name === "docker");
    expect(docker?.kind).toBe("scope");
    expect(docker?.path).toEqual(["docker"]);
    expect(docker?.description.length).toBeGreaterThan(10);
    expect(docker?.docsUrl).toMatch(/^https:\/\/docs\.seqera\.io\/nextflow\//);
    const enabled = docker?.children.find((c) => c.name === "enabled");
    expect(enabled).toMatchObject({
      kind: "option",
      path: ["docker", "enabled"],
      types: ["Boolean"],
      valueKind: "boolean",
      children: [],
    });
    expect(docker?.valueKind).toBeNull();
    const plugins = schema.scopes.find((s) => s.name === "plugins");
    expect(plugins?.kind).toBe("dsl");
    expect(structuredClone(schema)).toEqual(schema);
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
