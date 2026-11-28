// UpdateDeclaration (F-303, UX-41, UX-44, AR-21): the Configure form's rows become the declaration's parts. Unchanged
// rows keep their nodes and comments; new and changed rows are written as text, parsed by the pack and detached; the
// declaration is reprinted (LA-45) and refused if that would lose a comment.
import {
  type AstNode,
  type Comment,
  childFields,
  type FieldProblem,
  type FormField,
  isAstNode,
  NO_RANGE,
  type ScriptSourceFile,
  type Section,
  type TextPatch,
  type TypedProcess,
  type TypedProcessForm,
  type UpdateDeclaration,
} from "@nf-builder/lang-core";
import { formChanged, isIdentifier } from "../../form/form-diff";
import { docComment, docParts, processForm } from "../../form/read-process";
import {
  FORM_PROCESS,
  formSource,
  type RowChanges,
  rowChanges,
} from "../../form/write-rows";
import type { EditState } from "../apply";
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

  const removed: AstNode[] = [];
  const keep = (section: keyof RowChanges["rows"]) =>
    (wanted[section] as readonly { origin: number | null }[]).map((r, i) => ({
      origin: r.origin,
      keep: r.origin !== null && !changes.rows[section][i],
    }));
  const exec = changes.script
    ? swap(process.exec, synthetic.exec, removed)
    : process.exec;
  let stub = process.stub;
  if (wanted.stub === null) {
    if (process.stub) removed.push(process.stub);
    stub = null;
  } else if (changes.stub) stub = swap(process.stub, synthetic.stub, removed);

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
    ...process,
    directives: rebuild(
      process.directives,
      synthetic.directives,
      keep("directives"),
      removed,
    ),
    inputs: rebuild(process.inputs, synthetic.inputs, keep("inputs"), removed),
    stage: rebuild(process.stage, synthetic.stage, keep("stage"), removed),
    outputs: rebuild(
      process.outputs,
      synthetic.outputs,
      keep("outputs"),
      removed,
    ),
    topics: rebuild(process.topics, synthetic.topics, keep("topics"), removed),
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
  return [{ kind: "edit", path, edits: [edit] }];
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
