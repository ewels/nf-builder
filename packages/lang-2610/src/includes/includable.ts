// The names a script can be included by. Ported from nextflow-io/nextflow v26.10.7 (Apache-2.0; see ../../grammar/NOTICE),
// modules/nf-lang/src/main/java/nextflow/script/control/ResolveIncludeVisitor.java: `getDefinitions` (L182) gives the
// order (workflows, processes, agents, functions, types), `definitionName` (L198) names the entry workflow `workflow`
// and `paramsBlockType` (L149) lets `params` name the params block when no definition claims it.
import type {
  Includable,
  IncludableDeclaration,
  ScriptAst,
} from "@nf-builder/lang-core";

type Slot = "workflow" | "process" | "agent" | "function" | "type";
const SLOTS: readonly Slot[] = [
  "workflow",
  "process",
  "agent",
  "function",
  "type",
];

/** The slot and name a body item defines, or null when it cannot be included. `Unparsed` items count by their head. */
function definition(
  item: ScriptAst["body"][number],
): { slot: Slot | "params"; name: string; pipeline: boolean } | null {
  switch (item.kind) {
    case "Workflow":
      return item.name === null
        ? { slot: "workflow", name: "workflow", pipeline: true }
        : { slot: "workflow", name: item.name.name, pipeline: false };
    case "Process":
      return { slot: "process", name: item.name.name, pipeline: false };
    case "Agent":
      return { slot: "agent", name: item.name.name, pipeline: false };
    case "Function":
      return { slot: "function", name: item.name.name, pipeline: false };
    case "Record":
    case "Enum":
      return { slot: "type", name: item.name.name, pipeline: false };
    case "ParamsBlock":
      return { slot: "params", name: "params", pipeline: true };
    case "Unparsed": {
      const head = item.head;
      if (!head) return null;
      switch (head.keyword) {
        case "workflow":
          return head.name === null
            ? { slot: "workflow", name: "workflow", pipeline: true }
            : { slot: "workflow", name: head.name, pipeline: false };
        case "process":
        case "agent":
        case "function":
          return head.name === null
            ? null
            : { slot: head.keyword, name: head.name, pipeline: false };
        case "record":
        case "enum":
          return head.name === null
            ? null
            : { slot: "type", name: head.name, pipeline: false };
        case "params":
          return { slot: "params", name: "params", pipeline: true };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

export function includable(ast: ScriptAst): ReadonlyMap<string, Includable> {
  const defs = ast.body.flatMap((item) => {
    const d = definition(item);
    return d ? [{ ...d, item }] : [];
  });
  const result = new Map<string, Includable>();
  const add = (d: (typeof defs)[number]) => {
    if (result.has(d.name)) return;
    result.set(d.name, {
      declaration: d.item as IncludableDeclaration,
      pipeline: d.pipeline,
    });
  };
  for (const slot of SLOTS) for (const d of defs) if (d.slot === slot) add(d);
  // the params block names itself only when no definition claimed `params`
  const params = defs.find((d) => d.slot === "params");
  if (params) add(params);
  return result;
}
