// Planning a paste (F-310, UX-26): which files a target project lacks, which includes a call needs, and which callees
// have to come in under an alias. Pure; the service runs the plan as one group of commands.
import type {
  AddCall,
  AddInclude,
  Connect,
  CreateFile,
  EditCommand,
  PortRef,
  Projection,
  WorkflowTarget,
} from "@nf-builder/lang-core";
import type { EditState } from "../edit/apply";
import { callsAlready } from "../edit/commands/add-call";
import {
  builtinNames,
  freshName,
  namesInWorkflow,
  relativeSource,
} from "../edit/names";
import { EditRefusal } from "../edit/refusal";
import { locateWorkflow } from "../edit/workflow";
import type { Binding } from "../model/file-model";
import type { FragmentFile, FragmentNode, NodeFragment } from "./fragment";

/** A callee that has to be included again under another name in the target (F-111, ADR 0039). */
export interface PasteAlias {
  readonly name: string;
  readonly alias: string;
  /** `called`: the workflow already calls the process; `taken`: the name is bound to another definition. */
  readonly reason: "called" | "taken";
}

export interface PlannedNode {
  /** The id of the node in the source project. */
  readonly source: string;
  /** The name the pasted call uses in the target workflow. */
  readonly bound: string;
}

export interface PlannedInclude {
  readonly name: string;
  readonly alias: string | null;
  readonly source: string;
}

export interface PastePlan {
  readonly aliases: readonly PasteAlias[];
  /** The nodes in the order they are called: a node comes after the nodes that feed it. */
  readonly nodes: readonly PlannedNode[];
  /** The includes to add, in order. */
  readonly includes: readonly PlannedInclude[];
  /** The fragment's files the target lacks. */
  readonly creates: readonly FragmentFile[];
}

const invalid = (message: string, path?: string) =>
  new EditRefusal("invalid", message, path);

/** The nodes ordered so every edge goes forwards; ties keep the fragment's order. */
function ordered(fragment: NodeFragment): readonly FragmentNode[] {
  const left = [...fragment.nodes];
  const out: FragmentNode[] = [];
  while (left.length > 0) {
    const next =
      left.find(
        (n) =>
          !fragment.edges.some(
            (e) =>
              e.to.node === n.source &&
              e.from.node !== n.source &&
              left.some((l) => l.source === e.from.node),
          ),
      ) ?? (left[0] as FragmentNode);
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}

/** Whether `binding` is the declaration of `callee` in the file `definition`. */
function resolvesTo(
  binding: Binding,
  here: string,
  definition: string,
  callee: string,
): boolean {
  if (binding.kind === "declaration")
    return (
      here === definition &&
      (binding.declaration as { name?: { name: string } | null }).name?.name ===
        callee
    );
  const { include, entry } = binding;
  return (
    include.target.kind === "file" &&
    include.target.path === definition &&
    entry.entry.name.name === callee
  );
}

/**
 * Decides how each copied node is called in `target`, what to include and which files to create. `sameProject` says
 * the nodes come from the project being pasted into, which is the only place a definition that sits in its source
 * workflow's own file can be called. Refuses a file that exists with other content, and an inline definition that
 * can't be reached from the target.
 */
export function planPaste(
  state: EditState,
  fragment: NodeFragment,
  target: WorkflowTarget,
  sameProject: boolean,
): PastePlan {
  const { file, def } = locateWorkflow(state, target);
  const creates: FragmentFile[] = [];
  for (const f of fragment.files) {
    const present = state.model.file(f.path)?.source.text;
    if (present === undefined) creates.push(f);
    else if (present !== f.text)
      throw invalid(
        `${f.path} already exists with different content, so these nodes can't be pasted here. Nothing was changed.`,
        f.path,
      );
  }
  const scope =
    state.model.file(file.path)?.scope ?? new Map<string, Binding>();
  const taken = new Set([
    ...scope.keys(),
    ...namesInWorkflow(def),
    ...builtinNames(state.catalogue),
  ]);
  const used = new Set<string>();
  const planned = new Map<string, { callee: string; definition: string }>();
  const aliases: PasteAlias[] = [];
  const includes: PlannedInclude[] = [];
  const nodes: PlannedNode[] = [];
  for (const node of ordered(fragment)) {
    const { callee, definition } = node;
    if (node.inline) {
      const local = scope.get(callee);
      if (
        !sameProject ||
        file.path !== definition ||
        local?.kind !== "declaration"
      )
        throw invalid(
          `${callee} is defined in the same file as the workflow it was copied from. Move ${callee} to its own module to copy it.`,
        );
      if (
        node.kind === "process" &&
        (used.has(callee) || callsAlready(def, callee))
      )
        throw invalid(
          `\`${callee}\` is already called in ${def.name ? `workflow \`${def.name.name}\`` : "the entry workflow"}, and Nextflow can call a process only once per workflow. \`${callee}\` is defined in this file, so it can't be included again under another name. Move it to its own module to call it twice.`,
        );
      used.add(callee);
      nodes.push({ source: node.source, bound: callee });
      continue;
    }
    // names in the target that already stand for this definition
    const candidates = [
      ...[...scope.entries()]
        .filter(([, b]) => resolvesTo(b, file.path, definition, callee))
        .map(([name]) => name),
      ...[...planned.entries()]
        .filter(([, p]) => p.callee === callee && p.definition === definition)
        .map(([name]) => name),
    ].sort((a, b) => Number(b === callee) - Number(a === callee));
    const free = candidates.find(
      (name) =>
        node.kind === "workflow" ||
        (!used.has(name) && !callsAlready(def, name)),
    );
    if (free !== undefined) {
      used.add(free);
      nodes.push({ source: node.source, bound: free });
      continue;
    }
    // a new include: as it is when its name is free, else under an alias
    const source = relativeSource(file.path, definition);
    if (!taken.has(callee)) {
      taken.add(callee);
      planned.set(callee, { callee, definition });
      used.add(callee);
      includes.push({ name: callee, alias: null, source });
      nodes.push({ source: node.source, bound: callee });
      continue;
    }
    const alias = freshName(`${callee}_2`, taken);
    taken.add(alias);
    planned.set(alias, { callee, definition });
    used.add(alias);
    aliases.push({
      name: callee,
      alias,
      reason: candidates.length > 0 ? "called" : "taken",
    });
    includes.push({ name: callee, alias, source });
    nodes.push({ source: node.source, bound: alias });
  }
  return { aliases, nodes, includes, creates };
}

/** The commands that bring in the files and includes: first the files, then the includes. */
export function setupCommands(
  plan: PastePlan,
  target: WorkflowTarget,
): EditCommand[] {
  const files = plan.creates.map(
    (f): CreateFile => ({ kind: "createFile", path: f.path, text: f.text }),
  );
  const includes = plan.includes.map(
    (i): AddInclude => ({
      kind: "addInclude",
      caller: target.path,
      name: i.name,
      alias: i.alias,
      source: i.source,
    }),
  );
  return [...files, ...includes];
}

/** One bare call per planned node, in order. */
export const callCommands = (
  plan: PastePlan,
  target: WorkflowTarget,
): AddCall[] =>
  plan.nodes.map((n) => ({ kind: "addCall", target, callee: n.bound }));

export const connectCommand = (
  target: WorkflowTarget,
  from: PortRef,
  to: PortRef,
): Connect => ({ kind: "connect", target, from, to });

/** How many call nodes of each name the projection has: taken before the paste, to tell the pasted ones apart. */
export function callCounts(
  projection: Projection,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const n of projection.nodes)
    if (n.kind === "call")
      counts.set(n.callee.name, (counts.get(n.callee.name) ?? 0) + 1);
  return counts;
}

/**
 * The ids of the pasted nodes in `projection`, by the id of the copied node. The pasted calls are the last ones of
 * each name in source order: a paste appends them, and `plan.nodes` is ordered so no connect moves one.
 */
export function pastedIds(
  projection: Projection,
  plan: PastePlan,
  before: ReadonlyMap<string, number>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const planned of plan.nodes) {
    const calls = projection.nodes
      .filter((n) => n.kind === "call" && n.callee.name === planned.bound)
      .sort((a, b) => a.range.start - b.range.start);
    const k = seen.get(planned.bound) ?? 0;
    seen.set(planned.bound, k + 1);
    const found = calls[(before.get(planned.bound) ?? 0) + k];
    if (!found)
      throw new EditRefusal(
        "internal",
        `The pasted call of ${planned.bound} wasn't found.`,
      );
    result.set(planned.source, found.id);
  }
  return result;
}

/** Refuses a fragment copied from another Nextflow version than the project's. */
export function checkVersion(fragment: NodeFragment, version: string): void {
  if (fragment.languageVersion !== version)
    throw invalid(
      `These nodes were copied from a Nextflow ${fragment.languageVersion} project; this project uses ${version}.`,
    );
}
