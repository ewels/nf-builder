import type {
  ConfigCatalogue,
  ConfigNode,
  LanguagePack,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { installedPacks } from "../../src/packs";
import {
  mergePluginScopes,
  pluginConfigNodes,
  pluginsKey,
  typeRefText,
} from "../../src/plugins/config-scopes";
import { nfHand, nfSchema } from "./helpers";

const base: ConfigCatalogue = {
  source: { nextflow: "x", generated: "y" } as never,
  scopes: [
    {
      kind: "scope",
      name: "process",
      description: "pack",
      children: [
        {
          kind: "option",
          name: "cpus",
          description: "pack",
          types: ["Integer"],
        },
      ],
    },
  ],
};

describe("plugin config scopes", () => {
  it("F-505 FI-01: nf-schema's validation scope becomes catalogue nodes with its 11 children and printed types", () => {
    const nodes = pluginConfigNodes(nfSchema());
    expect(nodes).toHaveLength(1);
    const validation = nodes[0] as Extract<ConfigNode, { kind: "scope" }>;
    expect(validation.name).toBe("validation");
    expect(validation.children).toHaveLength(11);
    const ignore = validation.children.find(
      (c) => c.name === "defaultIgnoreParams",
    );
    expect(ignore).toMatchObject({ kind: "option", types: ["Set<String>"] });
    expect(
      validation.children.every((c) => typeof c.description === "string"),
    ).toBe(true);
    expect(
      typeRefText({ name: "Map", typeArguments: ["String", "Object"] }),
    ).toBe("Map<String, Object>");
  });

  it("F-505 FI-01: nested scopes, additional types and missing descriptions come out as the catalogue writes them", () => {
    const [hand] = pluginConfigNodes(nfHand()) as [
      Extract<ConfigNode, { kind: "scope" }>,
    ];
    expect(hand.description).toBe("");
    expect(hand.children).toEqual([
      {
        kind: "option",
        name: "level",
        description: "",
        types: ["Integer", "String"],
      },
      { kind: "scope", name: "inner", description: "Nested.", children: [] },
    ]);
  });

  it("F-505 FI-01: a plugin scope named like a pack scope keeps the pack's nodes and adds only new children", () => {
    const merged = mergePluginScopes(base, [
      {
        id: "p",
        version: "1",
        nodes: [
          {
            kind: "scope",
            name: "process",
            description: "plugin",
            children: [
              {
                kind: "option",
                name: "cpus",
                description: "plugin",
                types: ["String"],
              },
              {
                kind: "option",
                name: "extra",
                description: "plugin",
                types: ["String"],
              },
            ],
          },
          { kind: "scope", name: "mine", description: "", children: [] },
        ],
      },
    ]);
    expect(merged.scopes.map((s) => s.name)).toEqual(["process", "mine"]);
    const process = merged.scopes[0] as Extract<ConfigNode, { kind: "scope" }>;
    expect(process.description).toBe("pack");
    expect(process.children.map((c) => [c.name, c.description])).toEqual([
      ["cpus", "pack"],
      ["extra", "plugin"],
    ]);
    expect(base.scopes).toHaveLength(1);
    expect(mergePluginScopes(base, [])).toBe(base);
  });

  it("F-505 FI-01: merging is memoised on the plugins key", () => {
    const scopes = [
      { id: "nf-hand", version: "1.0.0", nodes: pluginConfigNodes(nfHand()) },
    ];
    expect(pluginsKey(scopes)).toBe("nf-hand@1.0.0");
    expect(pluginsKey([])).toBe("");
    const a = mergePluginScopes(base, scopes);
    expect(mergePluginScopes(base, [...scopes])).toBe(a);
    expect(installedPacks.length).toBeGreaterThan(0);
  });

  it("F-505 FI-01 FI-03: with nf-schema merged, classifyPath calls validation.monochromeLogs an option; without it, unknown", async () => {
    const pack = installedPacks[0] as LanguagePack;
    const catalogue = await pack.loadCatalogue();
    const merged = mergePluginScopes(catalogue.config, [
      {
        id: "nf-schema",
        version: "3.1.0",
        nodes: pluginConfigNodes(nfSchema()),
      },
    ]);
    const path = ["validation", "monochromeLogs"];
    const rules = await pack.loadConfigRules(merged);
    expect(rules.classify(path)).toMatchObject({
      kind: "option",
      types: ["Boolean"],
    });
    expect((await pack.loadConfigRules()).classify(path).kind).toBe("unknown");
    expect(rules.classify(["validation", "monochromeLog"]).kind).toBe(
      "unknown",
    );
  });
});
