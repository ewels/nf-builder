// The names a script can be included by. Ported from nextflow-io/nextflow v26.10.7 (Apache-2.0; see ../../grammar/NOTICE),
// modules/nf-lang/src/main/java/nextflow/script/control/ResolveIncludeVisitor.java: `getDefinitions` (L182) gives the
// order (workflows, processes, agents, functions, types), `definitionName` (L198) names the entry workflow `workflow`
// and `paramsBlockType` (L149) lets `params` name the params block when no definition claims it. The unnamed workflow
// that ScriptAstBuilder.java (L276-L283) wraps around top-level statements is a workflow too, added after the declared ones.
import type {
  DeclarationHead,
  Includable,
  IncludableDeclaration,
  ScriptAst,
} from "@nf-builder/lang-core";

// params last: the params block names itself only when no definition claimed `params`
const SLOTS = [
  "workflow",
  "process",
  "agent",
  "function",
  "type",
  "params",
] as const;
type Slot = (typeof SLOTS)[number];
type Item = ScriptAst["body"][number];

/** The keyword and name a body item declares; an `Unparsed` item gives its head. */
function head(item: Item): DeclarationHead | null {
  switch (item.kind) {
    case "Workflow":
      return { keyword: "workflow", name: item.name?.name ?? null };
    case "Process":
    case "Agent":
    case "Function":
    case "Record":
    case "Enum":
      return { keyword: item.kind.toLowerCase(), name: item.name.name };
    case "ParamsBlock":
      return { keyword: "params", name: null };
    case "Unparsed":
      return item.head;
    default:
      return null;
  }
}

/** The slot and name a body item defines, or null when it cannot be included. */
function definition(
  item: Item,
): { slot: Slot; name: string; pipeline: boolean } | null {
  const h = head(item);
  switch (h?.keyword) {
    case "workflow":
      return h.name === null
        ? { slot: "workflow", name: "workflow", pipeline: true }
        : { slot: "workflow", name: h.name, pipeline: false };
    case "process":
    case "agent":
    case "function":
      return h.name === null
        ? null
        : { slot: h.keyword, name: h.name, pipeline: false };
    case "record":
    case "enum":
      return h.name === null
        ? null
        : { slot: "type", name: h.name, pipeline: false };
    case "params":
      return { slot: "params", name: "params", pipeline: true };
    default:
      return null;
  }
}

// Items that are neither statements nor stand-ins for one. Everything else is a top-level statement, and so is an
// `Unparsed` the builder made out of an `InvalidDeclaration`.
const NOT_STATEMENTS = new Set([
  "FeatureFlag",
  "Include",
  "Import",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Function",
  "IncompleteDeclaration",
  "Unparsed",
]);
const isStatement = (item: Item) =>
  item.kind === "Unparsed"
    ? item.invalidDeclaration === true
    : !NOT_STATEMENTS.has(item.kind);

export function includable(ast: ScriptAst): ReadonlyMap<string, Includable> {
  const defs: {
    slot: Slot;
    name: string;
    pipeline: boolean;
    item: IncludableDeclaration;
  }[] = ast.body.flatMap((item) => {
    const d = definition(item);
    return d ? [{ ...d, item: item as IncludableDeclaration }] : [];
  });
  if (ast.body.some(isStatement))
    defs.push({
      slot: "workflow",
      name: "workflow",
      pipeline: true,
      item: ast,
    });
  const result = new Map<string, Includable>();
  for (const slot of SLOTS)
    for (const d of defs)
      if (d.slot === slot && !result.has(d.name))
        result.set(d.name, { declaration: d.item, pipeline: d.pipeline });
  return result;
}
