import type {
  ConfigCatalogue,
  ConfigNode,
  PluginConfigChild,
  PluginConfigScope,
  PluginTypeRef,
  SnapshotPluginFile,
} from "@nf-builder/lang-core";

export interface PluginScopes {
  readonly id: string;
  readonly version: string;
  readonly nodes: readonly ConfigNode[];
  /** The plugin's project page from the registry index: the docs link of its scopes' options (FI-04); none when absent. */
  readonly projectUrl?: string | null;
}

type ScopeNode = Extract<ConfigNode, { kind: "scope" }>;

/** A type as the catalogue writes it: `String`, `Map<String, Object>`. */
export function typeRefText(t: PluginTypeRef): string {
  if (typeof t === "string") return t;
  const args = t.typeArguments ?? [];
  return args.length === 0
    ? t.name
    : `${t.name}<${args.map(typeRefText).join(", ")}>`;
}

const scopeNode = (spec: PluginConfigScope): ScopeNode => ({
  kind: "scope",
  name: spec.name,
  description: spec.description ?? "",
  children: (spec.children ?? []).map(childNode),
});

const childNode = (child: PluginConfigChild): ConfigNode =>
  child.type === "ConfigScope"
    ? scopeNode(child.spec)
    : {
        kind: "option",
        name: child.spec.name,
        description: child.spec.description ?? "",
        types: [child.spec.type, ...(child.spec.additionalTypes ?? [])].map(
          typeRefText,
        ),
      };

/** The plugin's `ConfigScope` definitions as config catalogue scopes (FI-01). */
export function pluginConfigNodes(spec: SnapshotPluginFile): ConfigNode[] {
  return spec.definitions.flatMap((d) =>
    d.type === "ConfigScope" ? [scopeNode(d.spec)] : [],
  );
}

export const pluginsKey = (scopes: readonly PluginScopes[]): string =>
  scopes.map((s) => `${s.id}@${s.version}`).join(",");

/** `into` with the children of `from` it lacks; the nodes `into` has win, recursively for scopes. */
function mergeNode(into: ConfigNode, from: ConfigNode): ConfigNode {
  if (into.kind !== "scope" || from.kind !== "scope") return into;
  return { ...into, children: mergeChildren(into.children, from.children) };
}

function mergeChildren(
  into: readonly ConfigNode[],
  from: readonly ConfigNode[],
): ConfigNode[] {
  const others = new Map<string, ConfigNode>();
  for (const f of from) if (!others.has(f.name)) others.set(f.name, f);
  const have = new Set<string>();
  const merged = into.map((n) => {
    have.add(n.name);
    const other = others.get(n.name);
    return other ? mergeNode(n, other) : n;
  });
  for (const f of from) if (!have.has(f.name)) merged.push(f);
  return merged;
}

let memo: {
  base: ConfigCatalogue;
  key: string;
  value: ConfigCatalogue;
} | null = null;

/**
 * The catalogue with the plugins' scopes added. A scope the pack already has (a core one) keeps the pack's node and
 * gains only the children it lacks. Memoised on the base and the key.
 */
export function mergePluginScopes(
  config: ConfigCatalogue,
  scopes: readonly PluginScopes[],
): ConfigCatalogue {
  if (scopes.length === 0) return config;
  const key = pluginsKey(scopes);
  if (memo?.base === config && memo.key === key) return memo.value;
  const value = {
    ...config,
    scopes: mergeChildren(
      config.scopes,
      scopes.flatMap((s) => s.nodes),
    ),
  };
  memo = { base: config, key, value };
  return value;
}

/** The docs link of each scope only a plugin defines (a core scope keeps the pack's): its project URL, or null (FI-04). */
export function pluginDocs(
  base: ConfigCatalogue,
  scopes: readonly PluginScopes[],
): Map<string, string | null> {
  const docs = new Map<string, string | null>();
  for (const plugin of scopes)
    for (const node of plugin.nodes)
      if (
        node.kind === "scope" &&
        !base.scopes.some((s) => s.name === node.name)
      )
        docs.set(node.name, plugin.projectUrl ?? null);
  return docs;
}
