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
): ConfigSchemaNode {
  const path = [...parent, source.name];
  const types = source.kind === "option" ? source.types : [];
  return {
    kind: source.kind,
    name: source.name,
    path,
    description: source.description,
    docsUrl: rules.docsUrl(path),
    types,
    valueKind: source.kind === "option" ? rules.valueKind(path, types) : null,
    children:
      source.kind === "scope" || source.kind === "placeholder"
        ? source.children.map((c) => node(rules, c, path))
        : [],
  };
}

export function configSchema(
  version: string,
  catalogue: ConfigCatalogue,
  rules: ConfigRules,
): ConfigSchema {
  return {
    version,
    scopes: catalogue.scopes.map((s) => node(rules, s, [])),
    forms: rules.forms,
  };
}
