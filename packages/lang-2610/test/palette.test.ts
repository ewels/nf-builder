import type {
  OperatorGroupId,
  PaletteDefinition,
  PaletteItem,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { configCatalogue, scriptCatalogue } from "../src/catalogue.ts";
import { ScriptParser } from "../src/generated/ScriptParser.ts";
import { palette } from "../src/palette.ts";
import {
  isLegacyOnly,
  itemKey,
  LEGACY_ONLY_RULES,
  type PaletteContext,
  paletteProblems,
} from "./palette-problems.ts";

const ctx: PaletteContext = {
  script: scriptCatalogue,
  config: configCatalogue,
  scriptRules: ScriptParser.ruleNames,
};

const items = (def: PaletteDefinition): PaletteItem[] =>
  def.categories.flatMap((c) => [
    ...(c.items ?? []),
    ...(c.groups ?? []).flatMap((g) => g.items),
  ]);

const synthetic = (...list: PaletteItem[]): PaletteDefinition => ({
  categories: [
    { id: "operators", label: "Operators", icon: "operator", items: list },
  ],
});

const construct = (name: string, id = name): PaletteItem => ({
  kind: "construct",
  name,
  id,
  label: id,
  description: "x",
});

const rulesOf = (def: PaletteDefinition, rule: string) =>
  paletteProblems(def, ctx).filter((p) => p.rule === rule);

describe("26.10 palette", () => {
  it("F-109 step 1 ADR-0005 UX-12: every palette.yaml item names a 26.10 catalogue entry or script grammar rule", () => {
    expect(rulesOf(palette, "unknown-name")).toEqual([]);
    expect(items(palette).length).toBeGreaterThan(30);
  });

  it("F-109 step 1 ADR-0005: the checker reports names the 26.10 pack lacks", () => {
    const problems = rulesOf(
      synthetic(
        { kind: "factory", name: "fromSRA" },
        { kind: "operator", name: "buffer" },
        { kind: "config", name: "nope" },
        construct("fooDef"),
      ),
      "unknown-name",
    );
    expect(problems.map((p) => p.key)).toEqual([
      "factory:fromSRA",
      "operator:buffer",
      "config:nope",
      "fooDef",
    ]);
  });

  it("F-109 step 3 UX-13 ADR-0007: no palette item is legacy-only", () => {
    expect(rulesOf(palette, "legacy-only")).toEqual([]);
    expect(items(palette).filter((i) => isLegacyOnly(i, ctx))).toEqual([]);
  });

  it("F-109 step 3 UX-13: the checker flags deprecated catalogue entries and legacy grammar rules", () => {
    const problems = rulesOf(
      synthetic(
        { kind: "operator", name: "groupTuple" },
        { kind: "operator", name: "branch" },
        { kind: "factory", name: "fromFilePairs" },
        construct("importDeclaration"),
        construct("paramDeclarationV1"),
        construct("processWhen"),
      ),
      "legacy-only",
    );
    expect(problems.map((p) => p.key)).toEqual([
      "operator:groupTuple",
      "operator:branch",
      "factory:fromFilePairs",
      "importDeclaration",
      "paramDeclarationV1",
      "processWhen",
    ]);
  });

  it("F-109 step 3 LA-34: every legacy-only grammar rule exists in the 26.10 ScriptParser", () => {
    for (const rule of LEGACY_ONLY_RULES)
      expect(ScriptParser.ruleNames, rule).toContain(rule);
  });

  it("F-109 UX-12: categories are the seven generic categories in UX-12 order with UX-12 labels; operators use UX-12 group ids; nothing is empty", () => {
    expect(palette.categories.map((c) => [c.id, c.label])).toEqual([
      ["processes", "Processes"],
      ["workflows", "Workflows"],
      ["factories", "Channel factories"],
      ["operators", "Operators"],
      ["params-outputs", "Params & outputs"],
      ["types-functions-includes", "Types, functions & includes"],
      ["plugins-config", "Plugins & config"],
    ]);
    expect(palette.categories.filter((c) => c.groups).map((c) => c.id)).toEqual(
      ["operators"],
    );
    const groupIds: OperatorGroupId[] = [
      "transform",
      "filter",
      "combine",
      "fork",
      "split",
      "reduce",
      "inspect",
    ];
    for (const g of palette.categories.find((c) => c.id === "operators")
      ?.groups ?? [])
      expect(groupIds).toContain(g.id);
    expect(rulesOf(palette, "empty")).toEqual([]);
    expect(rulesOf(palette, "shape")).toEqual([]);
  });

  it("F-109 UX-12: Processes, Workflows and Types, functions & includes list the UX-12 items", () => {
    const ids = (category: string) =>
      (palette.categories.find((c) => c.id === category)?.items ?? []).map(
        itemKey,
      );
    expect(ids("processes")).toEqual(["process", "exec-process", "agent"]);
    expect(ids("workflows")).toEqual(["workflow", "include-pipeline"]);
    expect(ids("types-functions-includes")).toEqual([
      "record",
      "enum",
      "function",
      "include",
    ]);
  });

  it("F-109 UX-13: Agent is marked preview, and every preview item links to the docs", () => {
    const agent = items(palette).find((i) => itemKey(i) === "agent");
    expect(agent?.preview).toBe(true);
    for (const item of items(palette).filter((i) => i.preview))
      expect(item.docs, itemKey(item)).toMatch(
        /^https:\/\/docs\.seqera\.io\/nextflow\//,
      );
    expect(rulesOf(palette, "docs")).toEqual([]);
    expect(
      rulesOf(synthetic({ ...construct("agentDef"), preview: true }), "shape"),
    ).toHaveLength(1);
    expect(
      rulesOf(
        synthetic({ ...construct("agentDef"), docs: "https://example.com/" }),
        "docs",
      ),
    ).toHaveLength(1);
  });

  it("F-109 ADR-0005: every non-legacy channel factory and operator in the catalogue is in the palette", () => {
    const modern = (entries: { name: string; deprecated: boolean }[]) =>
      [
        ...new Set(entries.filter((e) => !e.deprecated).map((e) => e.name)),
      ].sort();
    const inPalette = (kind: string) =>
      items(palette)
        .filter((i) => i.kind === kind)
        .map((i) => i.name)
        .sort();
    expect(inPalette("factory")).toEqual(modern(scriptCatalogue.factories));
    expect(inPalette("operator")).toEqual(modern(scriptCatalogue.operators));
  });

  it("F-109 ADR-0005: palette item keys are unique", () => {
    expect(rulesOf(palette, "duplicate")).toEqual([]);
    expect(
      rulesOf(
        synthetic(
          { kind: "operator", name: "map" },
          { kind: "operator", name: "map" },
        ),
        "duplicate",
      ),
    ).toHaveLength(1);
  });
});
