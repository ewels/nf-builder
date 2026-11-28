// UpdateDeclaration (F-303, UX-41, UX-44, AR-21): the Configure form's rows become the declaration's parts. Unchanged
// rows keep their nodes and comments; new and changed rows are written as text, parsed by the pack and detached; the
// declaration is reprinted (LA-45) and refused if that would lose a comment.
import {
  type AstNode,
  type Comment,
  childFields,
  type Declaration,
  type FieldProblem,
  type FormField,
  isAstNode,
  type MethodCall,
  NO_RANGE,
  type ScriptSourceFile,
  type Section,
  type TextEdit,
  type TextPatch,
  type TypedProcess,
  type TypedProcessForm,
  type UpdateDeclaration,
  walk,
} from "@nf-builder/lang-core";
import { formChanged, inputOrigins, isIdentifier } from "../../form/form-diff";
import { docComment, docParts, processForm } from "../../form/read-process";
import {
  FORM_PROCESS,
  formSource,
  type RowChanges,
  rowChanges,
} from "../../form/write-rows";
import type { EditState } from "../apply";
import { processCalls, remapArguments } from "../call-sites";
import { identifier, replaceNode, variable } from "../nodes";
import { EditRefusal } from "../refusal";
import { reprintDeclaration } from "../splice";

/** A copy of `node` and everything under it with `NO_RANGE`, so the printer lays it out freshly (ADR 0032). */
function detach<T extends AstNode>(node: T): T {
  const copy = { ...node, range: NO_RANGE } as unknown as Record<
    string,
    unknown
  >;
  for (const [key, value] of childFields(node)) {
    if (Array.isArray(value))
      copy[key] = value.map((v) => (isAstNode(v) ? detach(v) : v));
    else if (isAstNode(value)) copy[key] = detach(value);
    else if (key.endsWith("Range") && typeof value === "object" && value)
      copy[key] = NO_RANGE;
  }
  for (const slot of [
    "leadingComments",
    "trailingComments",
    "danglingComments",
  ] as const) {
    const comments = node[slot];
    if (comments) copy[slot] = comments.map((c) => ({ ...c, range: NO_RANGE }));
  }
  return copy as unknown as T;
}

/** The comment slots of `from` on `node`. */
function carry<T extends AstNode>(node: T, from: AstNode | undefined): T {
  if (!from) return node;
  const copy = { ...node } as unknown as Record<string, unknown>;
  for (const slot of [
    "leadingComments",
    "trailingComments",
    "danglingComments",
  ] as const)
    if (from[slot]) copy[slot] = from[slot];
  return copy as unknown as T;
}

/** A node that only holds comments, to say they may go (`reprintDeclaration`'s `removed`). */
const holder = (comments: readonly Comment[]): AstNode => ({
  kind: "CommentHolder",
  range: NO_RANGE,
  leadingComments: comments,
});

const problem = (
  section: FormField["section"],
  row: number | null,
  part: string | null,
  message: string,
): FieldProblem => ({ field: { section, row, part }, message });

/** What can be said about the form without parsing it. */
function checkForm(
  form: TypedProcessForm,
  changes: RowChanges,
): FieldProblem[] {
  const out: FieldProblem[] = [];
  const seen = new Set<string>();
  form.inputs.forEach((row, i) => {
    if (row.kind !== "named" || !changes.rows.inputs[i]) {
      if (row.kind === "named") seen.add(row.name);
      return;
    }
    if (!isIdentifier(row.name))
      out.push(
        problem(
          "inputs",
          i,
          "name",
          `"${row.name}" isn't a valid name. Use letters, digits and underscores, starting with a letter or underscore.`,
        ),
      );
    else if (seen.has(row.name))
      out.push(
        problem(
          "inputs",
          i,
          "name",
          `Another input is already called ${row.name}.`,
        ),
      );
    seen.add(row.name);
    if (row.type.trim() === "")
      out.push(problem("inputs", i, "type", `Enter a type for ${row.name}.`));
  });
  form.outputs.forEach((row, i) => {
    if (!changes.rows.outputs[i]) return;
    if (row.name === "" && form.outputs.length > 1)
      out.push(problem("outputs", i, "name", "Name this output."));
    else if (row.name !== "" && !isIdentifier(row.name))
      out.push(
        problem(
          "outputs",
          i,
          "name",
          `"${row.name}" isn't a valid name. Use letters, digits and underscores, starting with a letter or underscore.`,
        ),
      );
    if (row.value.trim() === "")
      out.push(
        problem(
          "outputs",
          i,
          "value",
          `Enter a value for ${row.name === "" ? "the output" : row.name}.`,
        ),
      );
  });
  form.directives.forEach((row, i) => {
    if (row.kind !== "named" || !changes.rows.directives[i]) return;
    if (!isIdentifier(row.name))
      out.push(
        problem(
          "directives",
          i,
          "name",
          `"${row.name}" isn't a valid directive name.`,
        ),
      );
    else if (row.args.trim() === "")
      out.push(
        problem("directives", i, "args", `Enter a value for ${row.name}.`),
      );
  });
  form.stage.forEach((row, i) => {
    if (!changes.rows.stage[i]) return;
    if (!isIdentifier(row.directive))
      out.push(problem("stage", i, "directive", "Pick a stage directive."));
    else if (row.args.trim() === "")
      out.push(
        problem("stage", i, "args", `Enter a value for ${row.directive}.`),
      );
  });
  form.topics.forEach((row, i) => {
    if (row.kind !== "emit" || !changes.rows.topics[i]) return;
    if (row.value.trim() === "")
      out.push(problem("topics", i, "value", "Enter a value for the topic."));
    if (row.topic.trim() === "")
      out.push(problem("topics", i, "topic", "Enter a topic name."));
  });
  if (changes.script && form.script.text.trim() === "")
    out.push(problem("script", null, "text", "Enter the script."));
  if (changes.stub && form.stub !== null && form.stub.trim() === "")
    out.push(problem("stub", null, "text", "Enter the stub or remove it."));
  return out;
}

const refuse = (fields: readonly FieldProblem[], path: string): never => {
  const first = fields[0]?.message ?? "The form has a problem.";
  throw new EditRefusal(
    "invalid",
    `${first} Nothing was changed.`,
    path,
    [],
    fields,
  );
};

/** Rebuilds a section from its rows: kept rows are the original items, the others the parsed ones. */
function rebuild<T extends AstNode>(
  original: Section<T> | null,
  parsed: Section<T> | null,
  rows: readonly { origin: number | null; keep: boolean }[],
  removed: AstNode[],
): Section<T> | null {
  const items = original?.items ?? [];
  const fresh = parsed?.items ?? [];
  const used = new Set<number>();
  let next = 0;
  const out: T[] = [];
  for (const row of rows) {
    if (row.keep && row.origin !== null) {
      used.add(row.origin);
      out.push(items[row.origin] as T);
    } else {
      const node = fresh[next++];
      if (!node)
        throw new EditRefusal(
          "internal",
          "The form's rows didn't parse as expected.",
        );
      out.push(
        carry(
          detach(node),
          row.origin === null ? undefined : items[row.origin],
        ),
      );
    }
  }
  items.forEach((item, i) => {
    if (!used.has(i)) removed.push(item);
  });
  if (out.length === 0) {
    if (original) removed.push(original);
    return null;
  }
  if (original) return { ...original, items: out };
  if (!parsed) return null;
  return { ...detach(parsed), items: out };
}

/** A whole section replaced by the parsed one's items; the original's items may go. */
function swap<T extends AstNode>(
  original: Section<T> | null,
  parsed: Section<T> | null,
  removed: AstNode[],
): Section<T> | null {
  if (!parsed)
    throw new EditRefusal(
      "internal",
      "The form's text didn't parse as a section.",
    );
  const items = parsed.items.map((i) => detach(i));
  if (!original) return { ...detach(parsed), items };
  removed.push(...original.items);
  return { ...original, items };
}

const docText = (description: string, tags: string | null): string => {
  const lines = description === "" ? [] : description.split("\n");
  if (tags !== null)
    lines.push(...(lines.length > 0 ? [""] : []), ...tags.split("\n"));
  return `/**\n${lines.map((l) => (l === "" ? " *" : ` * ${l}`)).join("\n")}\n */`;
};

export function updateDeclaration(
  state: EditState,
  command: UpdateDeclaration,
): TextPatch[] {
  const { path, name, form } = command;
  const model = state.model.file(path);
  if (model?.source.language !== "nextflow")
    throw new EditRefusal("not-found", `There is no script ${path}.`, path);
  const found = model.declarations.get(name);
  if (!found)
    throw new EditRefusal(
      "not-found",
      `${path} doesn't declare ${name}.`,
      path,
    );
  const declaration = found.declaration;
  if (declaration.kind === "Unparsed")
    throw new EditRefusal(
      "invalid",
      `${name} has code that doesn't parse. Fix it in the Code tab before editing it here.`,
      path,
    );
  if (declaration.kind !== "Process" || !declaration.typed)
    throw new EditRefusal(
      "invalid",
      `${name} isn't a typed process, so the form can't edit it.`,
      path,
    );
  if (form.kind !== "typedProcess")
    throw new EditRefusal(
      "invalid",
      "That form is not for a typed process.",
      path,
    );
  const file = model.source as ScriptSourceFile;
  const process: TypedProcess = declaration;
  const original = processForm(file, process, state.catalogue);
  // the name is not applied here: a rename is its own command (RenameDeclaration)
  const wanted = { ...form, name: original.name };
  if (!formChanged(original, wanted)) return [];

  const changes = rowChanges(original, wanted);
  const checked = checkForm(wanted, changes);
  if (checked.length > 0) refuse(checked, path);

  const { text, lines } = formSource(wanted, changes);
  const parse = state.parser.parseScript(text);
  if (parse.problems.length > 0) {
    const fields: FieldProblem[] = [];
    for (const p of parse.problems) {
      // a problem often shows up on a later line (an unclosed bracket): the nearest row above it is the likeliest culprit
      let at = p.line;
      while (at > 0 && !lines.has(at)) at -= 1;
      const field = lines.get(at);
      if (field)
        fields.push({
          field: {
            ...field,
            part: field.part ?? partOf(field),
          },
          message: p.message,
        });
    }
    if (fields.length === 0)
      throw new EditRefusal(
        "invalid",
        `${parse.problems[0]?.message}. Nothing was changed.`,
        path,
      );
    refuse(fields, path);
  }
  const synthetic = parse.ast?.body.find(
    (i): i is TypedProcess =>
      i.kind === "Process" && i.name.name === FORM_PROCESS,
  );
  if (!synthetic)
    throw new EditRefusal(
      "internal",
      "The form didn't parse as a process.",
      path,
    );

  // an input renamed in the form is renamed in the rows the user didn't touch (F-303 point 4)
  const renames = new Map<string, string>();
  wanted.inputs.forEach((row, i) => {
    if (row.kind !== "named" || row.origin === null || !changes.rows.inputs[i])
      return;
    const before = original.inputs.find((r) => r.origin === row.origin);
    if (before?.kind === "named" && before.name !== row.name)
      renames.set(before.name, row.name);
  });
  const untouched = <T extends AstNode>(
    node: T | null,
    kept: boolean,
  ): T | null =>
    node && kept && renames.size > 0 ? renameUses(node, renames) : node;
  const keepRows = <T extends AstNode>(
    section: Section<T> | null,
    rows: readonly boolean[],
    origins: readonly (number | null)[],
  ): Section<T> | null => {
    if (!section || renames.size === 0) return section;
    const keptOrigins = new Set(
      origins.filter((o, i) => o !== null && !rows[i]),
    );
    return {
      ...section,
      items: section.items.map((item, i) =>
        keptOrigins.has(i) ? renameUses(item, renames) : item,
      ),
    };
  };
  const base: TypedProcess = {
    ...process,
    directives: keepRows(
      process.directives,
      changes.rows.directives,
      wanted.directives.map((r) => r.origin),
    ),
    stage: keepRows(
      process.stage,
      changes.rows.stage,
      wanted.stage.map((r) => r.origin),
    ),
    outputs: keepRows(
      process.outputs,
      changes.rows.outputs,
      wanted.outputs.map((r) => r.origin),
    ),
    topics: keepRows(
      process.topics,
      changes.rows.topics,
      wanted.topics.map((r) => r.origin),
    ),
    when: untouched(process.when, true),
    exec: untouched(process.exec, !changes.script),
    stub: untouched(process.stub, !changes.stub),
  };
  const removed: AstNode[] = [];
  const keep = (section: keyof RowChanges["rows"]) =>
    (wanted[section] as readonly { origin: number | null }[]).map((r, i) => ({
      origin: r.origin,
      keep: r.origin !== null && !changes.rows[section][i],
    }));
  const exec = changes.script
    ? swap(base.exec, synthetic.exec, removed)
    : base.exec;
  let stub = base.stub;
  if (wanted.stub === null) {
    if (base.stub) removed.push(base.stub);
    stub = null;
  } else if (changes.stub) stub = swap(base.stub, synthetic.stub, removed);

  let leading = process.leadingComments;
  const doc = docComment(process);
  const parts = docParts(doc);
  if (
    wanted.description !== parts.description ||
    wanted.docTags !== parts.tags
  ) {
    const rest = (leading ?? []).filter((c) => c !== doc);
    if (doc) removed.push(holder([doc]));
    if (wanted.description === "" && wanted.docTags === null) leading = rest;
    else
      leading = [
        ...rest,
        {
          kind: "doc",
          text: docText(wanted.description, wanted.docTags),
          range: NO_RANGE,
          ownLine: true,
        },
      ];
  }

  const updated: TypedProcess = {
    ...base,
    directives: rebuild(
      base.directives,
      synthetic.directives,
      keep("directives"),
      removed,
    ),
    inputs: rebuild(base.inputs, synthetic.inputs, keep("inputs"), removed),
    stage: rebuild(base.stage, synthetic.stage, keep("stage"), removed),
    outputs: rebuild(base.outputs, synthetic.outputs, keep("outputs"), removed),
    topics: rebuild(base.topics, synthetic.topics, keep("topics"), removed),
    exec,
    stub,
    ...(leading ? { leadingComments: leading } : {}),
  };
  const edit = reprintDeclaration(
    file,
    process,
    updated,
    state.parser.printer,
    removed,
  );
  return mergePatches([
    { path, edit },
    ...callSiteEdits(
      state,
      command,
      wanted,
      process,
      outputRenames(original, wanted),
    ),
  ]);
}

/** The outputs renamed in the form, old name to new, when the process has two or more before and after: a sole output is read without its name. */
function outputRenames(
  original: TypedProcessForm,
  form: TypedProcessForm,
): Map<string, string> {
  const out = new Map<string, string>();
  if (original.outputs.length < 2 || form.outputs.length < 2) return out;
  for (const row of form.outputs) {
    const before = original.outputs.find(
      (r) => r.origin !== null && r.origin === row.origin,
    );
    if (
      before &&
      before.name !== "" &&
      row.name !== "" &&
      before.name !== row.name
    )
      out.set(before.name, row.name);
  }
  return out;
}

/**
 * `item` with every read of a renamed output changed: `r.old` where `r = CALL(...)`, and `CALL(...).old`. `item` is the
 * original top-level item; `current` the copy being edited, whose nodes are shared with it.
 */
function renameReads(
  current: AstNode,
  calls: readonly MethodCall[],
  renames: ReadonlyMap<string, string>,
  item: AstNode,
): AstNode {
  const called = new Set<AstNode>(calls);
  // variables the item assigns a call's result to
  const holders = new Set<string>();
  const reads: AstNode[] = [];
  walk(item, (n) => {
    const r = n as unknown as Record<string, unknown>;
    if (
      (n.kind === "Assignment" && called.has(r.value as AstNode)) ||
      (n.kind === "VariableDeclaration" && called.has(r.initializer as AstNode))
    ) {
      const target =
        n.kind === "Assignment" ? [r.target] : (r.targets as AstNode[]);
      for (const t of target as { kind: string; name?: unknown }[]) {
        const id = t.name as string | { name: string } | undefined;
        if (typeof id === "string") holders.add(id);
        else if (id) holders.add(id.name);
      }
    }
    return undefined;
  });
  walk(item, (n) => {
    if (n.kind !== "Property") return undefined;
    const { object, property } = n as unknown as {
      object: AstNode & { name?: string };
      property: { kind: string; name?: string };
    };
    if (
      property.kind === "Identifier" &&
      renames.has(property.name as string) &&
      (called.has(object) ||
        (object.kind === "Variable" && holders.has(object.name as string)))
    )
      reads.push(property as unknown as AstNode);
    return undefined;
  });
  let result = current;
  for (const id of reads)
    result = replaceNode(
      result,
      id,
      identifier(
        renames.get((id as unknown as { name: string }).name) as string,
      ),
    );
  return result;
}

/** One `edit` patch per path, its edits in order. */
function mergePatches(
  edits: readonly { path: string; edit: TextEdit }[],
): TextPatch[] {
  const byPath = new Map<string, TextEdit[]>();
  for (const { path, edit } of edits)
    byPath.set(path, [...(byPath.get(path) ?? []), edit]);
  return [...byPath].map(([path, list]) => ({
    kind: "edit",
    path,
    edits: [...list].sort((a, b) => a.start - b.start),
  }));
}

/** The edits that make every call of the process pass what its changed inputs take (ADR 0039). */
function callSiteEdits(
  state: EditState,
  command: UpdateDeclaration,
  form: TypedProcessForm,
  process: TypedProcess,
  outputs: ReadonlyMap<string, string>,
): { path: string; edit: TextEdit }[] {
  const origins = inputOrigins(form);
  const before = process.inputs?.items.length ?? 0;
  const inputsSame =
    origins.length === before && origins.every((o, i) => o === i);
  if (inputsSame && outputs.size === 0) return [];
  const sites = processCalls(state.model, command.path, command.name);
  const piped = sites.find((s) => s.call === null);
  if (piped && !inputsSame)
    throw new EditRefusal(
      "invalid",
      `${command.name} is called with a pipe in ${piped.path}; change its inputs in the Code tab. Nothing was changed.`,
      piped.path,
    );
  const out: { path: string; edit: TextEdit }[] = [];
  const items = new Map<AstNode, { path: string; calls: MethodCall[] }>();
  for (const site of sites) {
    if (site.call === null) continue;
    const entry = items.get(site.item) ?? { path: site.path, calls: [] };
    entry.calls.push(site.call as MethodCall);
    items.set(site.item, entry);
  }
  for (const [item, { path, calls }] of items) {
    const file = state.model.file(path)?.source as ScriptSourceFile;
    const removed: AstNode[] = [];
    let updated: AstNode = item;
    for (const call of calls) {
      if (!inputsSame) {
        const args = remapArguments(call, origins);
        const kept = new Set<unknown>(args);
        removed.push(...call.args.filter((a) => !kept.has(a)));
        updated = replaceNode(updated, call, { ...call, args } as MethodCall);
      }
    }
    if (outputs.size > 0) updated = renameReads(updated, calls, outputs, item);
    out.push({
      path,
      edit: reprintDeclaration(
        file,
        item as Declaration,
        updated as Declaration,
        state.parser.printer,
        removed,
      ),
    });
  }
  return out;
}

/** The part of a row a parse problem is about, when the row is one line: its value is the likeliest culprit. */
function partOf(field: FormField): string | null {
  switch (field.section) {
    case "outputs":
      return "value";
    case "directives":
    case "stage":
      return "args";
    case "topics":
      return "value";
    case "inputs":
      return "type";
    default:
      return null;
  }
}

/** `node` with each `Variable` named in `renames` renamed; the node itself when it reads none. */
function renameUses<T extends AstNode>(
  node: T,
  renames: ReadonlyMap<string, string>,
): T {
  let result: AstNode = node;
  const found: AstNode[] = [];
  walk(node, (n) => {
    if (
      n.kind === "Variable" &&
      renames.has((n as unknown as { name: string }).name)
    )
      found.push(n);
    return undefined;
  });
  for (const v of found) {
    const next = variable(
      renames.get((v as unknown as { name: string }).name) as string,
    );
    result = replaceNode(result, v, carry(next, v));
  }
  return result as T;
}
