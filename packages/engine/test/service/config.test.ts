// F-601 (AR-30, FI-06): the config view and schema through the engine service.
import { describe, expect, it } from "vitest";
import {
  type ConfigViewResult,
  createEngineService,
  type EngineRefusal,
} from "../../src";
import { installedPackVersions } from "../../src/packs";

const version = installedPackVersions()[0] as string;
const proc = (n: string, label = "") =>
  `process ${n} {\n${label}    script:\n    '${n}'\n}\n`;
const main = (label: string) => `${proc("A", label)}\nworkflow {\n    A()\n}\n`;
const config =
  "process {\n    withLabel: big {\n        cpus = 2\n    }\n}\ndocker.enabled = true\n";
const project = (label = "") => [
  { path: "main.nf", text: main(label) },
  { path: "nextflow.config", text: config },
  { path: "README.md", text: "# hi\n" },
];

const view = (r: ConfigViewResult | EngineRefusal): ConfigViewResult => {
  if ("ok" in r) throw new Error(`refused: ${r.code} ${r.message}`);
  return r;
};

describe("F-601 engine service config", () => {
  it("F-601: configView answers at the current revision and refuses a path that isn't a config file", async () => {
    const service = createEngineService();
    expect(await service.configView("nextflow.config")).toMatchObject({
      ok: false,
      code: "no-project",
    });
    const summary = await service.open({ version, files: project() });
    const result = view(await service.configView("nextflow.config"));
    expect(result.revision).toBe(summary.revision);
    expect(result.view?.path).toBe("nextflow.config");
    expect(result.view?.editable).toBe(true);
    expect(structuredClone(result)).toEqual(result);
    for (const path of ["main.nf", "README.md", "missing.config"])
      expect(await service.configView(path)).toMatchObject({
        ok: false,
        code: "not-found",
        revision: summary.revision,
      });
    // an edit moves the revision and the view follows
    const applied = await service.apply(
      {
        kind: "setConfigOption",
        path: "nextflow.config",
        context: { profile: null, selector: null },
        option: ["docker", "registry"],
        value: { kind: "string", value: "quay.io" },
      },
      summary.revision,
    );
    expect(applied.ok).toBe(true);
    const next = view(await service.configView("nextflow.config"));
    expect(next.revision).toBe(summary.revision + 1);
    const docker = next.view?.items.find(
      (i) => i.kind === "scope" && i.card.scope === "docker",
    );
    expect(
      docker?.kind === "scope" &&
        docker.card.rows.map((r) => r.kind === "option" && r.label),
    ).toEqual(["enabled", "registry"]);
  });

  it("F-601 FI-06: after a change to main.nf the next view's selector counts follow", async () => {
    const service = createEngineService();
    const summary = await service.open({ version, files: project() });
    const count = async () => {
      const result = view(await service.configView("nextflow.config"));
      const card = result.view?.items.find(
        (i) => i.kind === "scope" && i.card.scope === "process",
      );
      return card?.kind === "scope"
        ? card.card.selectors[0]?.match?.count
        : undefined;
    };
    expect(await count()).toBe(0);
    const changed = await service.apply(
      {
        kind: "replaceFileText",
        path: "main.nf",
        text: main("    label 'big'\n"),
      },
      summary.revision,
    );
    expect(changed.ok).toBe(true);
    expect(await count()).toBe(1);
  });

  it("F-601: configSchema needs no open project; results survive structuredClone", async () => {
    const service = createEngineService();
    const schema = await service.configSchema(version);
    expect(schema.version).toBe(version);
    expect(schema.scopes.length).toBeGreaterThan(30);
    expect(structuredClone(schema)).toEqual(schema);
    await expect(service.configSchema("0.0")).rejects.toThrow(/0\.0/);
    // the same answer with a project open
    await service.open({ version, files: project() });
    expect(await service.configSchema(version)).toEqual(schema);
  });
});
