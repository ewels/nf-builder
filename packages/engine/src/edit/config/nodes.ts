// Building config nodes for edit commands (F-601, ADR 0032). Nodes have no source range, so the printer lays them out
// fresh. A name is written bare only when the config grammar reads it back as a name.
import {
  type ConfigApply,
  type ConfigApplyBlock,
  type ConfigAssign,
  type ConfigBlock,
  type ConfigName,
  type ConfigSelector,
  type ConfigSelectorRef,
  type ConfigStatement,
  type Expression,
  NO_RANGE,
} from "@nf-builder/lang-core";
import { stringLiteral } from "../../config/values";

/** The words the config lexer reserves (ConfigLexer.g4), which a name has to quote; `config.mdx` says so. */
const RESERVED = new Set(
  (
    "as def in trait threadsafe var abstract assert boolean break yield byte case catch char class const continue " +
    "default do double else enum extends final finally float for if goto implements import instanceof int interface " +
    "long native new package permits private protected public record return sealed short static strictfp super " +
    "switch synchronized this throw throws transient try void volatile while includeConfig true false null"
  ).split(" "),
);

/** The formatter's `IDENTIFIER`, and not a reserved word. */
export const bareSafe = (name: string): boolean =>
  /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && !RESERVED.has(name);

export function configName(name: string): ConfigName {
  return {
    kind: "ConfigName",
    range: NO_RANGE,
    name,
    form: bareSafe(name) ? "identifier" : "string",
  };
}

export function configAssign(
  path: readonly string[],
  value: Expression,
): ConfigAssign {
  return {
    kind: "ConfigAssign",
    range: NO_RANGE,
    path: path.map(configName),
    value,
  };
}

export function configBlock(
  name: string,
  statements: readonly ConfigStatement[] = [],
): ConfigBlock {
  return {
    kind: "ConfigBlock",
    range: NO_RANGE,
    name: configName(name),
    statements,
  };
}

export function configSelector(
  ref: ConfigSelectorRef,
  statements: readonly ConfigStatement[] = [],
): ConfigSelector {
  return {
    kind: "ConfigSelector",
    range: NO_RANGE,
    selector: { ...configName(ref.kind), form: "identifier" },
    target: configName(ref.pattern),
    statements,
  };
}

/** `id 'nf-schema@2.5.1'` */
export function configApply(id: string): ConfigApply {
  return {
    kind: "ConfigApply",
    range: NO_RANGE,
    name: { kind: "Identifier", range: NO_RANGE, name: "id" },
    args: [stringLiteral(id)],
  };
}

/** `plugins { ... }` */
export function configApplyBlock(
  name: string,
  statements: readonly ConfigApply[] = [],
): ConfigApplyBlock {
  return {
    kind: "ConfigApplyBlock",
    range: NO_RANGE,
    name: configName(name),
    statements,
  };
}
