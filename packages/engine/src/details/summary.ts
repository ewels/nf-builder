// The open workflow's summary (F-206, UX-31): take, emit, calls and registry modules; for the entry workflow also its
// parameters and published outputs. Pure.

import type { GraphNode, Port, Projection } from "@nf-builder/lang-core";
import { typeText } from "../canvas/view";
import type { RegistryFolder } from "../files/types";
import { registryModuleOf } from "../problems/sections";
import { modelledShare, projectionCoverage } from "../projection/coverage";
import { kindLabel } from "./node-view";
import type {
  SummaryCall,
  SummaryModule,
  SummaryPort,
  WorkflowSummary,
} from "./types";

const portsOf = (node: GraphNode, ports: readonly Port[]): SummaryPort[] =>
  ports.map((p) => ({
    node: node.id,
    name: p.label,
    type: typeText(p.type),
  }));

/** `registry` is the project's registry module folders: a call belongs to the one holding its file, as in the problems panel (ADR 0055). */
export function workflowSummary(
  projection: Projection,
  registry: readonly RegistryFolder[] = [],
): WorkflowSummary {
  const { workflow, nodes } = projection;
  const takes: SummaryPort[] = [];
  const emits: SummaryPort[] = [];
  const params: SummaryPort[] = [];
  const outputs: SummaryPort[] = [];
  const calls: SummaryCall[] = [];
  const modules = new Map<string, string[]>();
  for (const node of nodes) {
    switch (node.kind) {
      case "take":
        takes.push({
          node: node.id,
          name: node.name,
          type: typeText(node.outputs[0]?.type ?? null),
        });
        break;
      case "emit":
        emits.push({
          node: node.id,
          name: node.name,
          type: typeText(node.inputs[0]?.type ?? null),
        });
        break;
      case "params":
        if (workflow.name === null) params.push(...portsOf(node, node.outputs));
        break;
      case "output":
        if (workflow.name === null) outputs.push(...portsOf(node, node.inputs));
        break;
      case "call": {
        calls.push({
          node: node.id,
          name: node.label,
          callee: node.callee.name,
          kindLabel: kindLabel(node),
          module: node.callee.module,
          status: node.callee.status,
        });
        const module =
          node.callee.path === null
            ? null
            : registryModuleOf(node.callee.path, registry);
        if (module !== null) {
          const list = modules.get(module) ?? [];
          list.push(node.label);
          modules.set(module, list);
        }
        break;
      }
      default:
        break;
    }
  }
  const moduleRows: SummaryModule[] = [...modules].map(([module, list]) => ({
    module,
    calls: list,
  }));
  return {
    name: workflow.name ?? "Entry workflow",
    path: workflow.path,
    entry: workflow.name === null,
    typed: workflow.typed,
    takes,
    emits,
    params,
    outputs,
    calls,
    modules: moduleRows,
    coverage: modelledShare(projectionCoverage(projection)),
  };
}
