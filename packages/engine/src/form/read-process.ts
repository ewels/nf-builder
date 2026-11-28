// Reading a typed process into the Configure form (F-303, UX-41) and the choices the form offers (UX-41, LA-34).
import type {
  AstNode,
  CatalogueEntry,
  Comment,
  ConfigRules,
  ConfigValueKind,
  DirectiveChoice,
  DirectiveRow,
  ExpressionStatement,
  FormChoices,
  InputRow,
  OutputRow,
  ProcessInput,
  ScriptCatalogue,
  ScriptSourceFile,
  Section,
  StageChoice,
  StageRow,
  TopicRow,
  TypedName,
  TypedProcess,
  TypedProcessForm,
} from "@nf-builder/lang-core";
import { firstParagraph, plainText } from "../palette-view";

const slice = (file: ScriptSourceFile, node: AstNode): string =>
  file.text.slice(node.range.start, node.range.end);

/** The doc comment of a declaration: the last doc comment before it. */
export function docComment(process: TypedProcess): Comment | null {
  const docs = (process.leadingComments ?? []).filter((c) => c.kind === "doc");
  return docs.at(-1) ?? null;
}

const docLines = (comment: Comment): string[] => {
  const lines = comment.text
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*? ?/, "").trimEnd());
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines;
};

/** A doc comment split at its first tag line: the text before it and the rest (null when there is no tag). */
export function docParts(comment: Comment | null): {
  description: string;
  tags: string | null;
} {
  if (comment === null) return { description: "", tags: null };
  const lines = docLines(comment);
  const at = lines.findIndex((l) => l.startsWith("@"));
  if (at < 0) return { description: lines.join("\n"), tags: null };
  const before = lines.slice(0, at);
  while (before.at(-1) === "") before.pop();
  return { description: before.join("\n"), tags: lines.slice(at).join("\n") };
}

/** `name args` of a statement that is a plain directive-style call; null for anything else. */
export function callParts(
  file: ScriptSourceFile,
  statement: ExpressionStatement,
): { name: string; args: string } | null {
  const e = statement.expression;
  if (e.kind !== "MethodCall" || e.receiver !== null) return null;
  if (e.method.kind !== "Identifier") return null;
  let args = file.text.slice(e.method.range.end, e.range.end).trim();
  if (e.parens) {
    if (e.closures.length > 0) return null;
    args = args.slice(1, -1).trim();
  }
  return { name: e.method.name, args };
}

/** The `value >> 'topic'` parts of a topic statement; null for anything else. */
export function emitParts(
  file: ScriptSourceFile,
  statement: ExpressionStatement,
): { value: string; topic: string } | null {
  const e = statement.expression;
  if (e.kind !== "Binary" || e.operator !== ">>" || e.right.kind !== "String")
    return null;
  return { value: slice(file, e.left), topic: e.right.value };
}

const noQuestion = (text: string): string => text.replace(/\?$/, "");

const inputRow = (
  file: ScriptSourceFile,
  item: ProcessInput,
  origin: number,
): InputRow => {
  if (item.kind !== "TypedName")
    return { origin, kind: "code", text: slice(file, item) };
  const typed = item as TypedName;
  return {
    origin,
    kind: "named",
    name: typed.name.name,
    type: typed.type ? noQuestion(slice(file, typed.type)) : "",
    nullable: typed.type?.nullable ?? false,
  };
};

/** The script or stub body as the form edits it: the source from its first item to its last, dedented by the first line's indent. */
export function sectionText(
  file: ScriptSourceFile,
  section: Section<AstNode> | null,
): string {
  const first = section?.items[0];
  const last = section?.items.at(-1);
  if (!first || !last) return "";
  const lineStart = file.text.lastIndexOf("\n", first.range.start - 1) + 1;
  const indent = /^[ \t]*/.exec(file.text.slice(lineStart))?.[0] ?? "";
  return file.text
    .slice(first.range.start, last.range.end)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l, i) => (i > 0 && l.startsWith(indent) ? l.slice(indent.length) : l))
    .join("\n");
}

/** The Configure form of a typed process, rows in source order. */
export function processForm(
  file: ScriptSourceFile,
  process: TypedProcess,
  catalogue: ScriptCatalogue,
): TypedProcessForm {
  const known = new Map(catalogue.directives.map((d) => [d.name, d]));
  const { description, tags } = docParts(docComment(process));
  const inputs = (process.inputs?.items ?? []).map((item, i) =>
    inputRow(file, item, i),
  );
  const stage = (process.stage?.items ?? []).flatMap(
    (statement, origin): StageRow[] => {
      const parts = callParts(file, statement);
      return parts ? [{ origin, directive: parts.name, args: parts.args }] : [];
    },
  );
  const outputs = (process.outputs?.items ?? []).map(
    (item, origin): OutputRow =>
      item.kind === "NamedOutput"
        ? {
            origin,
            name: item.name.name,
            type: item.type ? slice(file, item.type) : "",
            value: item.value ? slice(file, item.value) : "",
          }
        : {
            origin,
            name: "",
            type: "",
            value: slice(file, item.expression),
          },
  );
  const topics = (process.topics?.items ?? []).map(
    (statement, origin): TopicRow => {
      const parts = emitParts(file, statement);
      return parts
        ? { origin, kind: "emit", ...parts }
        : { origin, kind: "code", text: slice(file, statement) };
    },
  );
  const directives = (process.directives?.items ?? []).map(
    (statement, origin): DirectiveRow => {
      const parts = callParts(file, statement);
      if (parts === null)
        return { origin, kind: "code", text: slice(file, statement) };
      const entry = known.get(parts.name);
      return {
        origin,
        kind: "named",
        name: parts.name,
        args: parts.args,
        deprecated: entry?.deprecated ?? false,
        known: entry !== undefined,
      };
    },
  );
  const label = process.exec?.label;
  return {
    kind: "typedProcess",
    name: process.name.name,
    description,
    docTags: tags,
    inputs,
    stage,
    outputs,
    topics,
    directives,
    script: {
      label: label === "exec" || label === "shell" ? label : "script",
      text: sectionText(file, process.exec),
    },
    stub: process.stub ? sectionText(file, process.stub) : null,
    kept: process.when ? ["when: section"] : [],
  };
}

const DEFAULTS: Partial<Record<ConfigValueKind, string>> = {
  integer: "1",
  boolean: "true",
  memory: "1.GB",
  duration: "1.h",
};

/** `name(a: A, b: B)` of an entry's first signature. */
const signatureText = (entry: CatalogueEntry): string => {
  const params = entry.signatures[0]?.parameters ?? [];
  return `${entry.name}(${params.map((p) => `${p.name}: ${p.type}`).join(", ")})`;
};

const directiveChoice = (
  entry: CatalogueEntry,
  rules: ConfigRules,
): DirectiveChoice => {
  const types = entry.signatures
    .filter((s) => s.parameters.length === 1)
    .map((s) => s.parameters[0]?.type ?? "");
  const kind = rules.valueKind(["process", entry.name], types);
  return {
    name: entry.name,
    summary: firstParagraph(plainText(entry.description)),
    kind,
    defaultArgs: DEFAULTS[kind] ?? "",
  };
};

/**
 * What the form offers (UX-41): non-deprecated directives with the kind and default their catalogue type gives
 * (the page can't import the pack), the stage directives, and type names for an input; `local` are the project's
 * records and enums in scope.
 */
export function formChoices(
  catalogue: ScriptCatalogue,
  rules: ConfigRules,
  local: readonly string[] = [],
  standard: readonly string[] = [],
): FormChoices {
  const directives = catalogue.directives
    .filter((d) => !d.deprecated)
    .map((d) => directiveChoice(d, rules))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stage: StageChoice[] = catalogue.processSections.stage.map((e) => ({
    name: e.name,
    hint: signatureText(e),
  }));
  const types = new Set<string>();
  for (const { name } of catalogue.types) {
    const plain = name.replace(/^shim\./, "");
    if (plain !== "Channel" && plain !== "Value" && !plain.includes("."))
      types.add(plain);
  }
  for (const name of standard) types.add(name);
  for (const name of local) types.add(name);
  return { directives, stage, types: [...types].sort() };
}
