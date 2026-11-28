import type { SnapshotPlugin } from "@nf-builder/lang-core";
import type { RegistryIndex, RegistryModule } from "./types.ts";

export interface ModuleGroup {
  readonly namespace: string;
  readonly modules: readonly RegistryModule[];
}

export interface RegistryMatches {
  readonly modules: readonly RegistryModule[];
  readonly plugins: readonly SnapshotPlugin[];
}

/** The text before the first "/". */
export function namespaceOf(name: string): string {
  const i = name.indexOf("/");
  return i < 0 ? name : name.slice(0, i);
}

/** The text after the first "/" ("samtools/merge"). */
export function shortName(name: string): string {
  const i = name.indexOf("/");
  return i < 0 ? name : name.slice(i + 1);
}

/** The namespace listed first (ADR 0058: it holds nearly every module). */
const FIRST_NAMESPACE = "nf-core";

const byNamespace = (a: string, b: string) =>
  a === b
    ? 0
    : a === FIRST_NAMESPACE
      ? -1
      : b === FIRST_NAMESPACE
        ? 1
        : a < b
          ? -1
          : 1;

/** Groups by namespace: nf-core first, then code-point order; modules keep their (name) order. */
export function groupModules(
  modules: readonly RegistryModule[],
): readonly ModuleGroup[] {
  const groups = new Map<string, RegistryModule[]>();
  for (const m of modules) {
    const ns = namespaceOf(m.name);
    const list = groups.get(ns);
    if (list) list.push(m);
    else groups.set(ns, [m]);
  }
  return [...groups.keys()].sort(byNamespace).map((namespace) => ({
    namespace,
    modules: groups.get(namespace) ?? [],
  }));
}

/**
 * A matcher over modules (name, description, keywords) and plugins (id, summary). Every term must be a substring of
 * one field, case-insensitively, as in `searchPalette` (UX-11). Haystacks are lower-cased once per index; empty
 * terms return the index's own arrays.
 */
export function createRegistrySearch(
  index: Pick<RegistryIndex, "modules" | "plugins">,
): (terms: readonly string[]) => RegistryMatches {
  const moduleFields = index.modules.map((m) =>
    [m.name, m.description, ...m.keywords].map((f) => f.toLowerCase()),
  );
  const pluginFields = index.plugins.map((p) =>
    [p.id, p.summary].map((f) => f.toLowerCase()),
  );
  const keep = <T>(
    items: readonly T[],
    fields: readonly (readonly string[])[],
    terms: readonly string[],
  ) =>
    items.filter((_, i) =>
      terms.every((t) => fields[i]?.some((f) => f.includes(t))),
    );
  return (terms) =>
    terms.length === 0
      ? { modules: index.modules, plugins: index.plugins }
      : {
          modules: keep(index.modules, moduleFields, terms),
          plugins: keep(index.plugins, pluginFields, terms),
        };
}

/** The tag `typed` shows only for a typed module that has a version (a live-only module has none). */
export function moduleMarks(m: RegistryModule): {
  kind: "process" | "workflow";
  typed: boolean;
} {
  return { kind: m.kind, typed: m.typed === true && m.version !== null };
}
