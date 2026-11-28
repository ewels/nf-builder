// The config catalogue as a clone-safe tree for the page (F-601, FI-03, FI-04): descriptions, docs links and value kinds.
import type {
  ConfigCatalogue,
  ConfigNode,
  ConfigRules,
} from "@nf-builder/lang-core";
import type { ConfigSchema, ConfigSchemaNode } from "./types";

function node(
  rules: ConfigRules,
  source: ConfigNode,
  parent: readonly string[],
  docs: (path: readonly string[]) => string | null,
): ConfigSchemaNode {
  const path = [...parent, source.name];
  const types = source.kind === "option" ? source.types : [];
  return {
    kind: source.kind,
    name: source.name,
    path,
    description: source.description,
    docsUrl: docs(path),
    types,
    valueKind: source.kind === "option" ? rules.valueKind(path, types) : null,
    children:
      source.kind === "scope" || source.kind === "placeholder"
        ? source.children.map((c) => node(rules, c, path, docs))
        : [],
  };
}

export function configSchema(
  version: string,
  catalogue: ConfigCatalogue,
  rules: ConfigRules,
  pluginsKey = "",
  /** Plugin-owned top-level scopes and their docs link (the plugin's project URL, or null for none; FI-04). */
  pluginDocs: ReadonlyMap<string, string | null> = new Map(),
): ConfigSchema {
  const docs = (path: readonly string[]): string | null => {
    const top = path[0];
    return top !== undefined && pluginDocs.has(top)
      ? (pluginDocs.get(top) ?? null)
      : rules.docsUrl(path);
  };
  return {
    version,
    pluginsKey,
    scopes: catalogue.scopes.map((s) => node(rules, s, [], docs)),
    forms: rules.forms,
  };
}
