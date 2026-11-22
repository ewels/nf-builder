// Palette checks (F-109, ADR 0005, ADR 0025). Lives with the 26.10 pack's tests until a second pack exists (ADR 0006),
// then moves to lang-core.
import type {
  ConfigCatalogue,
  PaletteCategory,
  PaletteDefinition,
  PaletteItem,
  ScriptCatalogue,
} from "@nf-builder/lang-core";

export type PaletteContext = {
  script: ScriptCatalogue;
  config: ConfigCatalogue;
  /** ScriptParser.ruleNames. */
  scriptRules: readonly string[];
};

export type PaletteProblem = {
  /** Item key, or category/group id. */
  key: string;
  rule:
    | "shape"
    | "unknown-name"
    | "legacy-only"
    | "duplicate"
    | "empty"
    | "docs";
  message: string;
};

/** Grammar rules only legacy code uses: ScriptParser.g4 marks the first three legacy; LA-34 adds `when:`. */
export const LEGACY_ONLY_RULES: readonly string[] = [
  "importDeclaration",
  "paramDeclarationV1",
  "legacyType",
  "processWhen",
];

const DOCS_PREFIX = "https://docs.seqera.io/nextflow/";
const KINDS = ["factory", "operator", "config", "construct"];

export function itemKey(item: PaletteItem): string {
  return item.kind === "construct" ? item.id : `${item.kind}:${item.name}`;
}

const catalogueEntries = (item: PaletteItem, ctx: PaletteContext) => {
  if (item.kind === "factory")
    return ctx.script.factories.filter((e) => e.name === item.name);
  if (item.kind === "operator")
    return ctx.script.operators.filter((e) => e.name === item.name);
  if (item.kind === "config")
    return ctx.config.scopes.filter((n) => n.name === item.name);
  return [];
};

/** factory/operator: every catalogue entry with that name is deprecated; construct: in LEGACY_ONLY_RULES; config: never (no flag). */
export function isLegacyOnly(item: PaletteItem, ctx: PaletteContext): boolean {
  if (item.kind === "construct") return LEGACY_ONLY_RULES.includes(item.name);
  if (item.kind === "config") return false;
  const entries = catalogueEntries(item, ctx) as { deprecated: boolean }[];
  return entries.length > 0 && entries.every((e) => e.deprecated);
}

export function paletteProblems(
  palette: PaletteDefinition,
  ctx: PaletteContext,
): PaletteProblem[] {
  const problems: PaletteProblem[] = [];
  const add = (key: string, rule: PaletteProblem["rule"], message: string) =>
    problems.push({ key, rule, message });
  const seen = new Set<string>();

  const checkItem = (item: PaletteItem) => {
    const key = itemKey(item);
    if (!KINDS.includes(item.kind)) {
      add(key, "shape", `unknown kind "${String(item.kind)}"`);
      return;
    }
    if (item.kind === "construct") {
      for (const field of ["id", "label", "description"] as const)
        if (!item[field]) add(key, "shape", `construct without ${field}`);
      if (!ctx.scriptRules.includes(item.name))
        add(key, "unknown-name", `no grammar rule "${item.name}"`);
    } else if (catalogueEntries(item, ctx).length === 0) {
      add(
        key,
        "unknown-name",
        `no ${item.kind} "${item.name}" in the catalogue`,
      );
    }
    if (isLegacyOnly(item, ctx))
      add(key, "legacy-only", `"${item.name}" is legacy-only`);
    if (item.preview === true && !item.docs)
      add(key, "shape", "preview without docs");
    if (item.docs !== undefined && !item.docs.startsWith(DOCS_PREFIX))
      add(key, "docs", `docs URL not under ${DOCS_PREFIX}: ${item.docs}`);
    if (seen.has(key)) add(key, "duplicate", `duplicate item ${key}`);
    seen.add(key);
  };

  const checkCategory = (category: PaletteCategory) => {
    const hasItems = category.items !== undefined;
    const hasGroups = category.groups !== undefined;
    if (hasItems === hasGroups)
      add(category.id, "shape", "needs exactly one of items or groups");
    if (hasItems && category.items?.length === 0)
      add(category.id, "empty", "category has no items");
    if (hasGroups && category.groups?.length === 0)
      add(category.id, "empty", "category has no groups");
    for (const item of category.items ?? []) checkItem(item);
    for (const group of category.groups ?? []) {
      if (group.items.length === 0)
        add(group.id, "empty", "group has no items");
      for (const item of group.items) checkItem(item);
    }
  };

  for (const category of palette.categories) checkCategory(category);
  return problems;
}
