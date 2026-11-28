// F-505 (IO-33, FI-01, FI-03): the declared plugins and their config scopes through the engine service.
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type EngineRefusal,
  type PluginsResult,
  pluginConfigNodes,
} from "../../src";
import { installedPackVersions } from "../../src/packs";
import { nfSchema } from "../plugins/helpers";

const version = installedPackVersions()[0] as string;
const files = [
  {
    path: "main.nf",
    text: "process A {\n    script:\n    'a'\n}\n\nworkflow {\n    A()\n}\n",
  },
  {
    path: "nextflow.config",
    text: "validation.monochromeLogs = true\nprocess.cpus = 1\n",
  },
];
const scopes = () => [
  { id: "nf-schema", version: "3.1.0", nodes: pluginConfigNodes(nfSchema()) },
];
const plugins = (r: PluginsResult | EngineRefusal): PluginsResult => {
  if ("ok" in r) throw new Error(`refused: ${r.code}`);
  return r;
};
const unknown = async (service: ReturnType<typeof createEngineService>) => {
  const result = await service.diagnostics();
  if ("ok" in result) throw new Error("refused");
  return result.diagnostics.filter(
    (d) => d.code === "config-unknown-option" && d.path === "nextflow.config",
  );
};

describe("F-505 engine service plugins", () => {
  it("F-505 IO-33: plugins() follows the revision after addConfigPlugin and removeConfigPlugin", async () => {
    const service = createEngineService();
    expect(await service.plugins()).toMatchObject({ code: "no-project" });
    const summary = await service.open({ version, files });
    expect(plugins(await service.plugins())).toEqual({
      revision: summary.revision,
      plugins: [],
    });
    const added = await service.apply(
      {
        kind: "addConfigPlugin",
        path: "nextflow.config",
        id: "nf-schema@3.1.0",
      },
      summary.revision,
    );
    expect(added.ok).toBe(true);
    const after = plugins(await service.plugins());
    expect(after.revision).toBe(summary.revision + 1);
    expect(after.plugins.map((p) => [p.id, p.version])).toEqual([
      ["nf-schema", "3.1.0"],
    ]);
    expect(structuredClone(after)).toEqual(after);
    await service.apply(
      {
        kind: "removeConfigPlugin",
        path: "nextflow.config",
        id: "nf-schema@3.1.0",
      },
      summary.revision + 1,
    );
    expect(plugins(await service.plugins()).plugins).toEqual([]);
  });

  it("F-505 FI-03: after setPluginScopes(nf-schema) the config-unknown-option warning on validation.monochromeLogs is gone and pluginsKey changes", async () => {
    const service = createEngineService();
    await service.open({ version, files });
    const before = await service.diagnostics();
    if ("ok" in before) throw new Error("refused");
    expect(before.pluginsKey).toBe("");
    expect((await unknown(service)).map((d) => d.range.line)).toEqual([1]);
    expect(await service.setPluginScopes(scopes())).toEqual({
      pluginsKey: "nf-schema@3.1.0",
    });
    expect(await unknown(service)).toEqual([]);
    const after = await service.diagnostics();
    if ("ok" in after) throw new Error("refused");
    expect(after.pluginsKey).toBe("nf-schema@3.1.0");
    expect(after.revision).toBe(before.revision);
    const view = await service.configView("nextflow.config");
    if ("ok" in view) throw new Error("refused");
    expect(view.pluginsKey).toBe("nf-schema@3.1.0");
    // the scope is a known card now, and an edit through the form is accepted
    const card = view.view?.items.find(
      (i) => i.kind === "scope" && i.card.scope === "validation",
    );
    expect(card?.kind === "scope" && card.card.known).toBe(true);
    // cleared when the project is closed or another one opens
    await service.close();
    await service.open({ version, files });
    expect((await unknown(service)).map((d) => d.range.line)).toEqual([1]);
    expect(plugins(await service.plugins()).plugins).toEqual([]);
    await service.setPluginScopes(scopes());
    await service.close();
    await service.open({ version, files });
    const reopened = await service.diagnostics();
    if ("ok" in reopened) throw new Error("refused");
    expect(reopened.pluginsKey).toBe("");
  });

  it("F-505 FI-01: configSchema lists the validation scope only while nf-schema's scopes are set", async () => {
    const service = createEngineService();
    const names = async () =>
      (await service.configSchema(version)).scopes.map((s) => s.name);
    expect(await names()).not.toContain("validation");
    expect((await service.configSchema(version)).pluginsKey).toBe("");
    await service.open({ version, files });
    await service.setPluginScopes(scopes());
    const schema = await service.configSchema(version);
    expect(schema.pluginsKey).toBe("nf-schema@3.1.0");
    const validation = schema.scopes.find((s) => s.name === "validation");
    expect(validation?.children).toHaveLength(11);
    expect(
      validation?.children.find((c) => c.name === "monochromeLogs"),
    ).toMatchObject({ kind: "option", valueKind: "boolean" });
    await service.setPluginScopes([]);
    expect(await names()).not.toContain("validation");
  });

  it("F-505 FI-04: a plugin scope's docs link is the plugin's project URL, else none; core scopes keep theirs", async () => {
    const service = createEngineService();
    await service.open({ version, files });
    const url = "https://nextflow-io.github.io/nf-schema/";
    await service.setPluginScopes([
      { ...scopes()[0], projectUrl: url } as never,
    ]);
    const withUrl = await service.configSchema(version);
    const at = (name: string) => withUrl.scopes.find((s) => s.name === name);
    expect(at("validation")?.docsUrl).toBe(url);
    expect(at("validation")?.children[0]?.docsUrl).toBe(url);
    expect(at("process")?.docsUrl).toContain("docs.seqera.io");
    await service.setPluginScopes(scopes());
    const none = await service.configSchema(version);
    const validation = none.scopes.find((s) => s.name === "validation");
    expect(validation?.docsUrl).toBeNull();
    expect(validation?.children[0]?.docsUrl).toBeNull();
  });
});
