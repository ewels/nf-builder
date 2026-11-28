import type { PluginFunction, SnapshotPluginFile } from "@nf-builder/lang-core";
import { typeRefText } from "./config-scopes.ts";

export type PluginItemKind = "function" | "operator" | "factory";

export interface PluginPaletteItem {
  /** `plugin:<id>:<kind>:<name>` */
  readonly key: string;
  readonly kind: PluginItemKind;
  readonly name: string;
  /** The first paragraph of the description, else the first signature. */
  readonly summary: string;
  readonly description: string;
  /** One per overload: `samplesheetToList(String, Path) -> List`. */
  readonly signatures: readonly string[];
}

export interface PluginPaletteGroup {
  readonly id: string;
  readonly version: string;
  /** The spec is from the snapshot's release, not the declared one. */
  readonly approximate: boolean;
  readonly items: readonly PluginPaletteItem[];
}

const KINDS = {
  Function: "function",
  Operator: "operator",
  Factory: "factory",
} as const;

const signature = (f: PluginFunction): string => {
  const params = (f.parameters ?? []).map((p) => typeRefText(p.type));
  const ret =
    f.returnType === undefined ? "" : ` -> ${typeRefText(f.returnType)}`;
  return `${f.name}(${params.join(", ")})${ret}`;
};

/** A plugin's functions, operators and factories, one item per kind and name (IO-33), in the spec's order. */
export function pluginPaletteGroup(
  spec: SnapshotPluginFile,
  version: string,
  approximate: boolean,
): PluginPaletteGroup {
  const items = new Map<
    string,
    { item: Omit<PluginPaletteItem, "summary">; signatures: string[] }
  >();
  for (const d of spec.definitions) {
    if (d.type === "ConfigScope") continue;
    const kind = KINDS[d.type];
    const key = `plugin:${spec.id}:${kind}:${d.spec.name}`;
    let entry = items.get(key);
    if (!entry) {
      entry = {
        item: {
          key,
          kind,
          name: d.spec.name,
          description: d.spec.description ?? "",
          signatures: [],
        },
        signatures: [],
      };
      items.set(key, entry);
    }
    if (!entry.item.description && d.spec.description)
      entry = {
        ...entry,
        item: { ...entry.item, description: d.spec.description },
      };
    entry.signatures.push(signature(d.spec));
    items.set(key, entry);
  }
  return {
    id: spec.id,
    version,
    approximate,
    items: [...items.values()].map(({ item, signatures }) => ({
      ...item,
      signatures,
      summary:
        item.description.split(/\n\s*\n/)[0]?.trim() || (signatures[0] ?? ""),
    })),
  };
}

/** Items where every term is in the name, plugin id, description or a signature; empty groups dropped. [] returns `groups`. */
export function searchPluginGroups(
  groups: readonly PluginPaletteGroup[],
  terms: readonly string[],
): PluginPaletteGroup[] {
  if (terms.length === 0) return groups as PluginPaletteGroup[];
  const result: PluginPaletteGroup[] = [];
  for (const g of groups) {
    const items = g.items.filter((i) => {
      const fields = [i.name, g.id, i.description, ...i.signatures].map((f) =>
        f.toLowerCase(),
      );
      return terms.every((t) => fields.some((f) => f.includes(t)));
    });
    if (items.length > 0) result.push({ ...g, items });
  }
  return result;
}
