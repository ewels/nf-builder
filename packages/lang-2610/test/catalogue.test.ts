import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ConfigCatalogue,
  ConfigNode,
  ScriptCatalogue,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { configCatalogue, scriptCatalogue } from "../src/catalogue.ts";

const upstream = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../upstream.json", import.meta.url)),
    "utf8",
  ),
) as { languageServer: { tag: string; nfLang: string; sha256: string } };

const unique = (names: string[]) => new Set(names).size === names.length;

describe("26.10 catalogue", () => {
  it("ADR-0005: script.json has directives, operators and factories with unique names", () => {
    const script: ScriptCatalogue = scriptCatalogue;
    expect(script.directives.length).toBeGreaterThan(30);
    expect(script.operators.length).toBeGreaterThan(10);
    expect(script.factories.length).toBeGreaterThan(5);
    expect(unique(script.directives.map((d) => d.name))).toBe(true);
    expect(unique(script.factories.map((f) => f.name))).toBe(true);
    expect(unique(script.operators.map((o) => `${o.receiver}.${o.name}`))).toBe(
      true,
    );
    for (const o of script.operators)
      expect(["Channel", "Value"]).toContain(o.receiver);
    expect(script.directives.map((d) => d.name)).toContain("cpus");
    expect(script.factories.map((f) => f.name)).toContain("fromPath");
    expect(script.agentDirectives.length).toBeGreaterThan(0);
    expect(script.featureFlags.map((f) => f.name)).toContain(
      "nextflow.enable.dsl",
    );
  });

  it("ADR-0005: config.json has the process, params, profiles, env, plugins and nextflow scopes and the definitions.json scopes", () => {
    const config: ConfigCatalogue = configCatalogue;
    const names = config.scopes.map((s: ConfigNode) => s.name);
    for (const name of [
      "process",
      "params",
      "profiles",
      "env",
      "plugins",
      "nextflow",
      "docker",
      "wave",
      "aws",
    ])
      expect(names, name).toContain(name);
    expect(unique(names)).toBe(true);
  });

  it("ADR-0005: the catalogue source matches the language server pin in upstream.json", () => {
    const pin = upstream.languageServer;
    for (const { source } of [scriptCatalogue, configCatalogue])
      expect(source).toEqual({
        generator: "tools/spec-extract",
        languageServer: pin.tag,
        nfLang: pin.nfLang,
        jarSha256: pin.sha256,
      });
  });

  it("F-006 step 3 UX-13: operators discouraged with static typing are flagged deprecated", () => {
    const ops = scriptCatalogue.operators;
    expect(ops.some((o) => o.deprecated)).toBe(true);
    expect(ops.some((o) => !o.deprecated)).toBe(true);
    const map = ops.filter((o) => o.name === "map");
    expect(map.length).toBeGreaterThan(0);
    for (const o of map) expect(o.deprecated).toBe(false);
  });
});
