// Mirrors nextflow-io/nextflow v26.10.7, modules/nextflow/src/main/groovy/nextflow/config/ConfigValidator.groovy
// `validate`, `isSelector`, `validateOption`, `isValid`, `isMissingCorePluginScope` and `isMapOption` (L107-L231; Apache-2.0,
// see ../../grammar/NOTICE and ../../grammar/LICENSE). Upstream validates the resolved config, which is a tree of
// maps; here the walk is over the config AST, one path per assignment (F-601, FI-03).
import type {
  ConfigAssign,
  ConfigAst,
  ConfigCatalogue,
  ConfigNode,
  ConfigPathClass,
  ConfigStatement,
  Range,
} from "@nf-builder/lang-core";

/** L42-L52: options the config builder adds. */
export const HIDDEN_OPTIONS: readonly string[] = [
  "cacheable",
  "dumpChannels",
  "dumpHashes",
  "libDir",
  "outputFormat",
  "poolSize",
  "preview",
  "runName",
  "stubRun",
];

/** L58-L66: scopes of core plugins, which can only be checked when the plugin is loaded. */
export const CORE_PLUGIN_SCOPES: readonly string[] = [
  "aws",
  "azure",
  "cloudcache",
  "google",
  "k8s",
  "tower",
  "wave",
];

/** The catalogue node a path names (nf-lang's `SpecNode.getChild`); a placeholder matches any name. */
function child(
  catalogue: ConfigCatalogue,
  names: readonly string[],
): ConfigNode | null {
  let nodes: readonly ConfigNode[] = catalogue.scopes;
  let found: ConfigNode | null = null;
  for (const name of names) {
    found =
      nodes.find((n) => n.kind !== "placeholder" && n.name === name) ??
      nodes.find((n) => n.kind === "placeholder") ??
      null;
    if (found === null) return null;
    nodes =
      found.kind === "scope" || found.kind === "placeholder"
        ? found.children
        : [];
  }
  return found;
}

/** L214-L231: an option typed `Map` (or `Map<K, V>`), whose keys nobody validates. */
const isMapOption = (catalogue: ConfigCatalogue, names: readonly string[]) => {
  const node = child(catalogue, names);
  return (
    node?.kind === "option" &&
    node.types.some((t) => t === "Map" || t.startsWith("Map<"))
  );
};

/**
 * What a full option path is (L142-L168). `names` are as the validator names them: selectors dropped, the contents of a
 * profile as top level. The prefixes of the path are checked for a Map option first, as the walk skips such a map.
 */
export function classifyPath(
  catalogue: ConfigCatalogue,
  names: readonly string[],
): ConfigPathClass {
  const [scope] = names;
  if (scope === undefined) return { kind: "unknown" };
  if (scope === "env") return { kind: "free", owner: "env" };
  if (scope === "params") return { kind: "free", owner: "params" };
  for (let i = 1; i < names.length; i++)
    if (isMapOption(catalogue, names.slice(0, i)))
      return { kind: "free", owner: "map" };
  if (names.length === 1 && HIDDEN_OPTIONS.includes(scope))
    return { kind: "hidden" };
  const node = child(catalogue, names);
  if (node?.kind === "option")
    return {
      kind: "option",
      types: node.types,
      description: node.description,
    };
  if (node?.kind === "dsl") return { kind: "dsl" };
  if (node?.kind === "scope" || node?.kind === "placeholder")
    return { kind: "scope", description: node.description };
  // the catalogue doesn't describe the scope of a core plugin (`cloudcache`): its options can't be checked
  if (
    CORE_PLUGIN_SCOPES.includes(scope) &&
    !catalogue.scopes.some((n) => n.name === scope)
  )
    return { kind: "unchecked" };
  return { kind: "unknown" };
}

export interface OptionPath {
  /** The option as the validator names it. */
  readonly names: string[];
  readonly node: ConfigAssign;
  /** The assignment's name path. */
  readonly range: Range;
}

/** L126-L130: `withLabel:` and `withName:` blocks, and `executor.$name`. */
const isSelector = (names: readonly string[], key: string): boolean =>
  key.startsWith("withLabel:") ||
  key.startsWith("withName:") ||
  (key.startsWith("$") && names.length === 2 && names[0] === "executor");

/** L116-L117: the contents of a profile (`profiles.<name>`) are validated as top level. */
const enter = (scopes: readonly string[], key: string): string[] => {
  const names = [...scopes, key];
  return names.length === 2 && names[0] === "profiles" ? [] : names;
};

const span = (first: Range, last: Range): Range => ({
  start: first.start,
  end: last.end,
  line: first.line,
  column: first.column,
  endLine: last.endLine,
  endColumn: last.endColumn,
});

/**
 * The validator's walk (L107-L131) over the AST: for each assignment the option path it validates, with a selector
 * dropped and a profile's contents as top level. An unknown selector kind stays a path segment, as at run time. Keys
 * under a Map option still come out; `classifyPath` calls them free. An assignment that would validate nothing (the
 * name of a profile) gives no path.
 */
export function* optionPaths(ast: ConfigAst): Iterable<OptionPath> {
  const visit = function* (
    statements: readonly ConfigStatement[],
    scopes: readonly string[],
  ): Iterable<OptionPath> {
    for (const statement of statements) {
      if (statement.kind === "ConfigBlock") {
        const key = statement.name.name;
        const names = enter(scopes, key);
        if (isSelector(names, key)) names.pop();
        yield* visit(statement.statements, names);
      } else if (statement.kind === "ConfigSelector") {
        const key = `${statement.selector.name}:${statement.target.name}`;
        const names = enter(scopes, key);
        if (isSelector(names, key)) names.pop();
        yield* visit(statement.statements, names);
      } else if (statement.kind === "ConfigAssign") {
        let current = [...scopes];
        const keys = statement.path.map((n) => n.name);
        for (const key of keys.slice(0, -1)) {
          current = enter(current, key);
          if (isSelector(current, key)) current.pop();
        }
        const names = enter(current, keys[keys.length - 1] as string);
        if (names.length === 0) continue;
        const first = statement.path[0] as { range: Range };
        const last = statement.path[statement.path.length - 1] as {
          range: Range;
        };
        yield { names, node: statement, range: span(first.range, last.range) };
      }
    }
  };
  yield* visit(
    ast.statements.filter((s): s is ConfigStatement => s.kind !== "Unparsed"),
    [],
  );
}
