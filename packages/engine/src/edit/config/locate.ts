// Finding where a config command acts (F-601, plan 2.5 and 2.6). Options and blocks are addressed by name and resolved
// here, at apply time (ADR 0039). "The last one wins" throughout, as in Nextflow.
import type {
  ConfigApply,
  ConfigApplyBlock,
  ConfigAssign,
  ConfigAst,
  ConfigBlock,
  ConfigContext,
  ConfigSelector,
  ConfigSelectorRef,
  ConfigStatement,
} from "@nf-builder/lang-core";
import { configBlock, configSelector } from "./nodes";

/** A node that holds statements. */
export type Container = ConfigBlock | ConfigSelector | ConfigApplyBlock;

/** A statement that sets or applies something, with the containers around it from the top level down. */
export interface Occurrence<S> {
  readonly node: S;
  readonly ancestors: readonly Container[];
}

export const topStatements = (ast: ConfigAst): readonly ConfigStatement[] =>
  ast.statements.filter((s): s is ConfigStatement => s.kind !== "Unparsed");

export const isSelectorKey = (name: string): boolean =>
  name.startsWith("withName:") || name.startsWith("withLabel:");

const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

const blocks = (
  statements: readonly ConfigStatement[],
  name: string,
): ConfigBlock[] =>
  statements.filter(
    (s): s is ConfigBlock => s.kind === "ConfigBlock" && s.name.name === name,
  );

const matches = (s: ConfigSelector, ref: ConfigSelectorRef): boolean =>
  s.selector.name === ref.kind && s.target.name === ref.pattern;

/** Where the statements of a context live: the profile blocks, then the selector blocks inside their `process` blocks. */
interface Layers {
  /** The profile blocks (all of that name) and their `profiles` parents; null without a profile in the context. */
  readonly profile: { block: ConfigBlock; parent: ConfigBlock }[] | null;
  /** The selector blocks and their `process` parents; null without a selector in the context. */
  readonly selector: { block: ConfigSelector; parent: ConfigBlock }[] | null;
}

function layers(ast: ConfigAst, context: ConfigContext): Layers {
  const top = topStatements(ast);
  let profile: Layers["profile"] = null;
  let here: readonly ConfigStatement[] = top;
  if (context.profile !== null) {
    const name = context.profile;
    profile = blocks(top, "profiles").flatMap((parent) =>
      blocks(parent.statements, name).map((block) => ({ block, parent })),
    );
    here = profile.flatMap((p) => p.block.statements);
  }
  let selector: Layers["selector"] = null;
  if (context.selector !== null) {
    const ref = context.selector;
    selector = blocks(here, "process").flatMap((parent) =>
      parent.statements
        .filter((s): s is ConfigSelector => s.kind === "ConfigSelector")
        .filter((s) => matches(s, ref))
        .map((block) => ({ block, parent })),
    );
  }
  return { profile, selector };
}

/** The assignments that set `option` in the context, in any form (dotted or in blocks), in source order. */
export function occurrences(
  ast: ConfigAst,
  context: ConfigContext,
  option: readonly string[],
): Occurrence<ConfigAssign>[] {
  const l = layers(ast, context);
  const out: Occurrence<ConfigAssign>[] = [];
  const prefix = context.selector === null ? [] : ["process"];
  const visit = (
    statements: readonly ConfigStatement[],
    names: readonly string[],
    ancestors: readonly Container[],
  ) => {
    for (const s of statements) {
      if (s.kind === "ConfigAssign") {
        const keys = s.path.map((n) => n.name);
        if (keys.some(isSelectorKey)) continue;
        const full = [...names, ...keys];
        if (
          full.length === option.length &&
          full.every((n, i) => n === option[i])
        )
          out.push({ node: s, ancestors });
      } else if (s.kind === "ConfigBlock" && !isSelectorKey(s.name.name)) {
        visit(s.statements, [...names, s.name.name], [...ancestors, s]);
      }
    }
  };
  // a layer's parents hold the statements directly; contexts are gathered across repeated blocks
  if (l.selector !== null)
    for (const { block, parent } of l.selector) {
      const above = l.profile?.find((p) => p.block.statements.includes(parent));
      const chain: Container[] = above
        ? [above.parent, above.block, parent, block]
        : [parent, block];
      visit(block.statements, prefix, chain);
    }
  else if (l.profile !== null)
    for (const { block, parent } of l.profile)
      visit(block.statements, [], [parent, block]);
  else visit(topStatements(ast), [], []);
  return out;
}

/** The containers, outermost first, that hold the context's statements: the last occurrence of each layer. */
export interface Placement {
  /** The context exists: its statements, and its owner (the last container, null at the top level) with its ancestors. */
  readonly ready: boolean;
  readonly statements: readonly ConfigStatement[];
  readonly owner: Container | null;
  /** From the top level down to and including `owner`; empty at the top level. */
  readonly chain: readonly Container[];
  /** When not ready: where to insert, and how to wrap the context's statements into the nodes that are missing. */
  readonly into: Container | null;
  readonly intoChain: readonly Container[];
  readonly wrap: (leaf: readonly ConfigStatement[]) => ConfigStatement;
}

/** Resolves the profile and selector of a context to the last block of each, or says what is missing and where to put it. */
export function placement(ast: ConfigAst, context: ConfigContext): Placement {
  const top = topStatements(ast);
  const keep = (
    statements: readonly ConfigStatement[],
    owner: Container | null,
    chain: readonly Container[],
  ): Placement => ({
    ready: true,
    statements,
    owner,
    chain,
    into: null,
    intoChain: [],
    wrap: (leaf) => leaf[0] as ConfigStatement,
  });
  const missing = (
    into: Container | null,
    intoChain: readonly Container[],
    wrap: Placement["wrap"],
  ): Placement => ({
    ready: false,
    statements: [],
    owner: null,
    chain: [],
    into,
    intoChain,
    wrap,
  });
  const selectorNode =
    (ref: ConfigSelectorRef) => (leaf: readonly ConfigStatement[]) =>
      configSelector(ref, leaf);
  const ref = context.selector;

  let statements: readonly ConfigStatement[] = top;
  let owner: Container | null = null;
  let chain: readonly Container[] = [];
  if (context.profile !== null) {
    const name = context.profile;
    const parents = blocks(top, "profiles");
    const parent = lastOf(parents);
    const found = lastOf(
      parents.flatMap((p) =>
        blocks(p.statements, name).map((block) => ({ block, parent: p })),
      ),
    );
    if (!found) {
      const profile = (leaf: readonly ConfigStatement[]) => {
        const inner = ref
          ? [configBlock("process", [selectorNode(ref)(leaf)])]
          : leaf;
        return configBlock(name, inner);
      };
      if (parent) return missing(parent, [parent], profile);
      return missing(null, [], (leaf) =>
        configBlock("profiles", [profile(leaf)]),
      );
    }
    statements = found.block.statements;
    owner = found.block;
    chain = [found.parent, found.block];
  }
  if (ref === null) return keep(statements, owner, chain);

  const processBlock = lastOf(blocks(statements, "process"));
  const selected = lastOf(
    blocks(statements, "process").flatMap((p) =>
      p.statements
        .filter((s): s is ConfigSelector => s.kind === "ConfigSelector")
        .filter((s) => matches(s, ref))
        .map((block) => ({ block, parent: p })),
    ),
  );
  if (!selected) {
    if (processBlock)
      return missing(processBlock, [...chain, processBlock], (leaf) =>
        selectorNode(ref)(leaf),
      );
    return missing(owner, chain, (leaf) =>
      configBlock("process", [selectorNode(ref)(leaf)]),
    );
  }
  return keep(selected.block.statements, selected.block, [
    ...chain,
    selected.parent,
    selected.block,
  ]);
}

/** The last chain of nested blocks named by `scope` that exists in `statements`, outermost first. */
export function descend(
  statements: readonly ConfigStatement[],
  scope: readonly string[],
): ConfigBlock[] {
  const chain: ConfigBlock[] = [];
  let here = statements;
  for (const name of scope) {
    const block = lastOf(blocks(here, name));
    if (!block) break;
    chain.push(block);
    here = block.statements;
  }
  return chain;
}

/** The last dotted assignment under the same top-level scope. */
export function lastDotted(
  statements: readonly ConfigStatement[],
  scope: string,
): ConfigAssign | null {
  let found: ConfigAssign | null = null;
  for (const s of statements)
    if (
      s.kind === "ConfigAssign" &&
      s.path.length > 1 &&
      s.path[0]?.name === scope
    )
      found = s;
  return found;
}

/** The `id` lines of every `plugins` block, with their containers. */
export function plugins(ast: ConfigAst): Occurrence<ConfigApply>[] {
  const out: Occurrence<ConfigApply>[] = [];
  for (const s of topStatements(ast))
    if (s.kind === "ConfigApplyBlock" && s.name.name === "plugins")
      for (const apply of s.statements)
        out.push({ node: apply, ancestors: [s] });
  return out;
}

export const lastPluginsBlock = (ast: ConfigAst): ConfigApplyBlock | null =>
  lastOf(
    topStatements(ast).filter(
      (s): s is ConfigApplyBlock =>
        s.kind === "ConfigApplyBlock" && s.name.name === "plugins",
    ),
  ) ?? null;
