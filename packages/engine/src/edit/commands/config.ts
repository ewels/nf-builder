// The five config commands (F-601, AR-21, FI-02, plan 2.5 and 2.6). Each gives one `TextEdit` on one file.
import type {
  AddConfigBlock,
  AddConfigPlugin,
  AstNode,
  ConfigAst,
  ConfigContext,
  ConfigSourceFile,
  ConfigStatement,
  RemoveConfigOption,
  RemoveConfigPlugin,
  SetConfigOption,
  TextEdit,
  TextPatch,
} from "@nf-builder/lang-core";
import { PLUGIN_ID } from "../../config/plugins";
import { valueExpression } from "../../config/values";
import type { EditState } from "../apply";
import {
  type Container,
  descend,
  lastDotted,
  lastOf,
  lastPluginsBlock,
  occurrences,
  placement,
  plugins,
} from "../config/locate";
import {
  bareSafe,
  configApply,
  configApplyBlock,
  configAssign,
  configBlock,
} from "../config/nodes";
import {
  type Insertion,
  insertStatement,
  removeStatements,
  replaceValue,
} from "../config/splice";
import { EditRefusal } from "../refusal";

/** A config file that parsed, or the refusal that says why not. */
function configFile(
  state: EditState,
  path: string,
): ConfigSourceFile & { readonly ast: ConfigAst } {
  const source = state.model.file(path)?.source;
  if (source?.language !== "config")
    throw new EditRefusal(
      "not-found",
      `${path} isn't a config file, so there is nothing to edit.`,
      path,
    );
  if (source.ast === null)
    throw new EditRefusal(
      "does-not-parse",
      `${path} has errors the form can't work around. Fix them in code first. Nothing was changed.`,
      path,
      source.problems,
    );
  return source as ConfigSourceFile & { readonly ast: ConfigAst };
}

const patch = (
  path: string,
  edits: readonly (TextEdit | null)[],
): TextPatch[] => {
  const real = edits.filter((e): e is TextEdit => e !== null);
  return real.length === 0
    ? []
    : [
        {
          kind: "edit",
          path,
          edits: [...real].sort((a, b) => a.start - b.start),
        },
      ];
};

function checkContext(context: ConfigContext, path: string): void {
  if (context.profile === "")
    throw new EditRefusal("invalid", "A profile needs a name.", path);
  if (context.selector !== null && context.selector.pattern.trim() === "")
    throw new EditRefusal("invalid", "A selector needs a pattern.", path);
}

function checkOption(
  option: readonly string[],
  context: ConfigContext,
  path: string,
): void {
  checkContext(context, path);
  if (option.length === 0 || option.some((n) => n === ""))
    throw new EditRefusal("invalid", "An option needs a name.", path);
  if (context.selector !== null && option[0] !== "process")
    throw new EditRefusal(
      "invalid",
      "A selector sets process options only, so the option has to start with process.",
      path,
    );
  const bad = option.find((n) => !bareSafe(n));
  if (bad !== undefined)
    throw new EditRefusal(
      "invalid",
      `${JSON.stringify(bad)} can't be written by the form: ${option[0] === "params" || option[0] === "env" ? `a ${option[0]} name` : "an option name"} has to be an identifier (letters, digits and underscores, not starting with a digit, and not a reserved word). Nothing was changed.`,
      path,
    );
}

/** Insert after the last statement of `into` (a new top-level block, after the last item, with a blank line before it). */
const append = (
  into: Container | null,
  chain: readonly Container[],
  blank = into === null,
): Insertion => ({
  into,
  chain,
  after: into === null ? null : (lastOf<AstNode>(into.statements) ?? null),
  blank,
});

export function setConfigOption(
  state: EditState,
  command: SetConfigOption,
): TextPatch[] {
  const { path, context, option } = command;
  const file = configFile(state, path);
  checkOption(option, context, path);
  let value: ReturnType<typeof valueExpression>;
  try {
    value = valueExpression(command.value);
  } catch (error) {
    throw new EditRefusal(
      "invalid",
      `The value isn't a whole number or a plain decimal the config can hold (${error instanceof RangeError ? error.message : "invalid"}). Nothing was changed.`,
      path,
    );
  }
  const printer = state.parser;
  const ast = file.ast;

  const found = occurrences(ast, context, option);
  const latest = found[found.length - 1];
  if (latest) {
    return patch(path, [
      replaceValue(file, printer, latest.node, value, latest.ancestors.length),
    ]);
  }

  const insert = (node: ConfigStatement, at: Insertion) =>
    patch(path, [insertStatement(file, printer, node, at)]);

  const place = placement(ast, context);
  const skip = context.selector === null ? 0 : 1;
  if (!place.ready) {
    // the profile or selector is missing: create it holding the statement
    const leaf = configAssign(option.slice(skip), value);
    return insert(place.wrap([leaf]), append(place.into, place.intoChain));
  }

  const local = option.slice(skip);
  const scope = local.slice(0, -1);
  const name = local[local.length - 1] as string;
  const chain = descend(place.statements, scope);
  const owner = place.owner;

  if (scope.length === 0) {
    const node = configAssign([name], value);
    if (owner !== null) return insert(node, append(owner, place.chain));
    // a top-level assignment goes after the last one without a blank line
    return insert(
      node,
      append(null, [], lastOf(ast.statements)?.kind !== "ConfigAssign"),
    );
  }
  if (chain.length > 0) {
    // some of the scope's blocks exist: the statement goes into the innermost, under the names that are left
    const inner = chain[chain.length - 1] as Container;
    const node = configAssign([...scope.slice(chain.length), name], value);
    return insert(node, append(inner, [...place.chain, ...chain]));
  }
  // nothing of the scope's blocks exists in the context
  if (context.selector === null) {
    const sibling = lastDotted(place.statements, scope[0] as string);
    const full = configAssign(local, value);
    if (sibling)
      return insert(full, {
        into: owner,
        chain: place.chain,
        after: sibling,
      });
    if (owner === null) {
      const node = configBlock(scope[0] as string, [
        configAssign([...scope.slice(1), name], value),
      ]);
      return insert(node, append(null, []));
    }
    return insert(full, append(owner, place.chain));
  }
  return insert(configAssign(local, value), append(owner, place.chain));
}

export function removeConfigOption(
  state: EditState,
  command: RemoveConfigOption,
): TextPatch[] {
  const { path, context, option } = command;
  const file = configFile(state, path);
  checkOption(option, context, path);
  const found = occurrences(file.ast, context, option);
  if (found.length === 0)
    throw new EditRefusal(
      "not-found",
      `There is nothing to remove: ${option.join(".")} isn't set there.`,
      path,
    );
  return patch(path, removeStatements(file, state.parser, found));
}

export function addConfigBlock(
  state: EditState,
  command: AddConfigBlock,
): TextPatch[] {
  const { path, context, scope } = command;
  const file = configFile(state, path);
  checkContext(context, path);
  if (scope.some((n) => n === ""))
    throw new EditRefusal("invalid", "A scope needs a name.", path);
  const printer = state.parser;
  const ast = file.ast;
  const place = placement(ast, context);
  const nest = (names: readonly string[]): ConfigStatement[] => {
    const [first, ...rest] = names;
    return first === undefined ? [] : [configBlock(first, nest(rest))];
  };
  if (!place.ready) {
    return patch(path, [
      insertStatement(
        file,
        printer,
        place.wrap(nest(scope)),
        append(place.into, place.intoChain),
      ),
    ]);
  }
  const chain = descend(place.statements, scope);
  if (chain.length === scope.length) return [];
  const into: Container | null =
    chain.length > 0 ? (chain[chain.length - 1] as Container) : place.owner;
  const intoChain: Container[] =
    chain.length > 0 ? [...place.chain, ...chain] : [...place.chain];
  const [node] = nest(scope.slice(chain.length)) as [ConfigStatement];
  return patch(path, [
    insertStatement(file, printer, node, append(into, intoChain)),
  ]);
}

const pluginName = (id: string): string => id.split("@")[0] as string;

export function addConfigPlugin(
  state: EditState,
  command: AddConfigPlugin,
): TextPatch[] {
  const { path, id } = command;
  const file = configFile(state, path);
  if (!PLUGIN_ID.test(id))
    throw new EditRefusal(
      "invalid",
      `${JSON.stringify(id)} isn't a plugin id. Use name or name@version, with letters, digits and . _ - (and . _ + - in the version).`,
      path,
    );
  for (const { node } of plugins(file.ast)) {
    const arg = node.args[0];
    if (
      node.name.name === "id" &&
      arg?.kind === "String" &&
      pluginName(arg.value) === pluginName(id)
    )
      throw new EditRefusal(
        "invalid",
        `The plugin ${pluginName(id)} is already in plugins (${arg.value}). Remove it first to change its version.`,
        path,
      );
  }
  const printer = state.parser;
  const block = lastPluginsBlock(file.ast);
  if (block === null)
    return patch(path, [
      insertStatement(
        file,
        printer,
        configApplyBlock("plugins", [configApply(id)]),
        append(null, []),
      ),
    ]);
  return patch(path, [
    insertStatement(file, printer, configApply(id), append(block, [block])),
  ]);
}

export function removeConfigPlugin(
  state: EditState,
  command: RemoveConfigPlugin,
): TextPatch[] {
  const { path, id } = command;
  const file = configFile(state, path);
  const found = plugins(file.ast).filter(({ node }) => {
    const arg = node.args[0];
    return (
      node.name.name === "id" && arg?.kind === "String" && arg.value === id
    );
  });
  if (found.length === 0)
    throw new EditRefusal(
      "not-found",
      `There is nothing to remove: ${id} isn't in plugins.`,
      path,
    );
  return patch(path, removeStatements(file, state.parser, found));
}
