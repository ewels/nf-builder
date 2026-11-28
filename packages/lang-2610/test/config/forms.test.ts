// F-601 FI-02: the form layout and the option kinds.

import type { ConfigNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { configCatalogue } from "../../src/catalogue.ts";
import { createConfigRules } from "../../src/config/index.ts";

const rules = createConfigRules(configCatalogue);

const find = (names: readonly string[]): ConfigNode | undefined => {
  let nodes: readonly ConfigNode[] = configCatalogue.scopes;
  let found: ConfigNode | undefined;
  for (const name of names) {
    found = nodes.find((n) => n.name === name);
    if (!found) return undefined;
    nodes = "children" in found ? found.children : [];
  }
  return found;
};

describe("config forms", () => {
  it("F-601 FI-02: the form layout covers exactly the FI-02 scopes and names only catalogue options", () => {
    expect(rules.forms.scopes.map((s) => s.scope)).toEqual([
      "manifest",
      "params",
      "process",
      "profiles",
      "plugins",
      "docker",
      "singularity",
      "apptainer",
      "conda",
      "wave",
      "executor",
    ]);
    for (const form of rules.forms.scopes) {
      expect(find([form.scope]), form.scope).toBeDefined();
      for (const option of form.pinned)
        expect(
          find([form.scope, ...option.split(".")])?.kind,
          `${form.scope}.${option}`,
        ).toBe("option");
    }
    for (const path of Object.keys(rules.forms.maps))
      expect(find(path.split("."))?.kind, path).toBe("option");
  });

  it("F-601 FI-02: valueKind maps every catalogue type, the first type with a widget winning, and Map, Object and Closure to code", () => {
    const kind = rules.valueKind;
    expect(kind(["x"], ["String"])).toBe("string");
    expect(kind(["x"], ["Boolean"])).toBe("boolean");
    expect(kind(["x"], ["boolean"])).toBe("boolean");
    expect(kind(["x"], ["Integer"])).toBe("integer");
    for (const t of ["Float", "Double", "float"])
      expect(kind(["x"], [t]), t).toBe("decimal");
    expect(kind(["x"], ["MemoryUnit"])).toBe("memory");
    expect(kind(["x"], ["Duration"])).toBe("duration");
    for (const t of ["List<String>", "String[]", "Set<String>"])
      expect(kind(["x"], [t]), t).toBe("stringList");
    expect(kind(["x"], ["List<String>", "String"])).toBe("stringList");
    expect(kind(["x"], ["Boolean", "String"])).toBe("boolean");
    expect(kind(["x"], ["Integer", "Map"])).toBe("integer");
    for (const t of [
      "Map",
      "Map<String, String>",
      "Object",
      "Closure",
      "List",
      "Closure<String>",
      "List<Integer>",
    ])
      expect(kind(["x"], [t]), t).toBe("code");
    expect(kind(["process", "resourceLimits"], ["Map"])).toBe("map");
    // every type the catalogue uses gets a kind
    const types = new Set<string>();
    const walk = (nodes: readonly ConfigNode[]) => {
      for (const n of nodes) {
        if (n.kind === "option") for (const t of n.types) types.add(t);
        if ("children" in n) walk(n.children);
      }
    };
    walk(configCatalogue.scopes);
    for (const t of types) expect(kind(["x"], [t]), t).toBeTypeOf("string");
  });
});
