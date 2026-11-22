// The AST-derived part of a node's details (F-206, UX-30): description, directives, topics, operators and a short
// preview. Runs in the worker, where the AST lives (AR-04, AR-31); the result is plain data.

import type {
  AstNode,
  Comment,
  ExpressionStatement,
  GraphNode,
  IncludableDeclaration,
  Include,
  Projection,
  Range,
  ScriptCatalogue,
  Section,
  Statement,
} from "@nf-builder/lang-core";
import type { ProjectModel } from "../model/project";
import {
  factoryDescription,
  firstParagraph,
  operatorDescription,
  plainText,
} from "../palette-view";
import {
  type DeclarationDetails,
  type DetailRow,
  type OperatorDetail,
  PREVIEW_LINES,
  type Preview,
  VALUE_CHARS,
} from "./types";

export interface CalleeDeclaration {
  /** The declaration; for a pipeline the entry workflow, never the whole-file `ScriptAst`. */
  readonly declaration: IncludableDeclaration | null;
  /** The file that holds it; null when the include does not resolve to a file. */
  readonly path: string | null;
  /** The include statement that binds the name; null for a declaration in the same file. */
  readonly include: Include | null;
}

/** What `name` means in `path`: its declaration, the file it is in and the include that binds it. */
export function resolveCallee(
  model: ProjectModel,
  path: string,
  name: string,
): CalleeDeclaration | null {
  const binding = model.lookup(path, name);
  if (binding === undefined) return null;
  if (binding.kind === "declaration")
    return { declaration: binding.declaration, path, include: null };
  const { target } = binding.include;
  return {
    declaration: entryOf(binding.entry.declaration),
    path: target.kind === "file" ? target.path : null,
    include: binding.include.node,
  };
}

/** A pipeline include binds the whole script; its details are those of the entry workflow. */
function entryOf(
  declaration: IncludableDeclaration | null,
): IncludableDeclaration | null {
  if (declaration?.kind !== "Script") return declaration;
  return (
    declaration.body.find(
      (item): item is Extract<typeof item, { kind: "Workflow" }> =>
        item.kind === "Workflow" && item.name === null,
    ) ?? null
  );
}

const TAG = /^(@\w+|inputs?:|outputs?:)/i;

/** The text of the last doc comment before the first `@tag`, `Inputs:` or `Outputs:` line, as plain text; null when empty. */
export function docSummary(
  comments: readonly Comment[] | undefined,
): string | null {
  const doc = comments?.filter((c) => c.kind === "doc").at(-1);
  if (doc === undefined) return null;
  const lines: string[] = [];
  for (const raw of doc.text
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")) {
    const line = raw.replace(/^\s*\*?\s?/, "").trimEnd();
    if (TAG.test(line.trim())) break;
    lines.push(line);
  }
  const text = plainText(lines.join("\n").trim());
  return text === "" ? null : text;
}

/** Collapses whitespace to single spaces and cuts at `max` characters, ending in "…". */
export function oneLine(text: string, max = VALUE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The text of `range`, dedented, without blank edge lines, cut to `lines` lines. */
export function previewText(
  text: string,
  range: Range,
  lines = PREVIEW_LINES,
): { text: string; truncated: boolean } {
  const source =
    " ".repeat(Math.max(0, range.column - 1)) +
    text.slice(range.start, range.end);
  const all = source.split("\n").map((l) => l.trimEnd());
  while (all.length > 0 && all[0] === "") all.shift();
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const indent = Math.min(
    ...all.filter((l) => l !== "").map((l) => l.length - l.trimStart().length),
  );
  const dedented = all.map((l) =>
    l.slice(Number.isFinite(indent) ? indent : 0),
  );
  return {
    text: dedented.slice(0, lines).join("\n"),
    truncated: dedented.length > lines,
  };
}

export interface DetailsInput {
  readonly model: ProjectModel;
  readonly catalogue: ScriptCatalogue;
  readonly projection: Projection;
}

const textOf = (model: ProjectModel, path: string | null): string =>
  (path === null ? undefined : model.file(path)?.source.text) ?? "";

const slice = (text: string, node: AstNode) =>
  text.slice(node.range.start, node.range.end);

/** The statements of a section as a preview; a lone triple-quoted string shows what is inside the quotes. */
function sectionPreview(
  text: string,
  title: Preview["title"],
  section: Section<Statement> | null,
): Preview | null {
  const first = section?.items[0];
  const last = section?.items.at(-1);
  if (first === undefined || last === undefined) return null;
  let range: Range = {
    ...first.range,
    end: last.range.end,
    endLine: last.range.endLine,
    endColumn: last.range.endColumn,
  };
  if (section?.items.length === 1 && first.kind === "ExpressionStatement") {
    const e = first.expression;
    const quote = e.kind === "GString" || e.kind === "String" ? e.quote : null;
    if (quote === '"""' || quote === "'''")
      range = {
        ...e.range,
        start: e.range.start + 3,
        end: e.range.end - 3,
        column: 1,
      };
  }
  const { text: body, truncated } = previewText(text, range);
  return body === "" ? null : { title, text: body, truncated };
}

const SECTION_TITLE = {
  script: "Script",
  shell: "Shell",
  exec: "Exec",
} as const;

function directiveRows(
  text: string,
  section: Section<ExpressionStatement> | null,
): DetailRow[] {
  return (section?.items ?? []).map((item) => {
    const e = item.expression;
    if (e.kind !== "MethodCall" || e.receiver !== null)
      return { name: oneLine(slice(text, item)), value: "" };
    const first = e.args[0];
    const last = e.args.at(-1);
    return {
      name: e.method.kind === "Identifier" ? e.method.name : e.method.value,
      value:
        first === undefined || last === undefined
          ? ""
          : oneLine(text.slice(first.range.start, last.range.end)),
    };
  });
}

const isTopicKey = (key: AstNode): boolean =>
  (key.kind === "Identifier" && (key as { name?: string }).name === "topic") ||
  (key.kind === "String" && (key as { value?: string }).value === "topic");

function typedTopics(
  text: string,
  section: Section<ExpressionStatement> | null,
): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const item of section?.items ?? []) {
    const e = item.expression;
    if (e.kind !== "Binary" || e.operator !== ">>") continue;
    rows.push({
      name:
        e.right.kind === "String"
          ? e.right.value
          : oneLine(slice(text, e.right)),
      value: oneLine(slice(text, e.left)),
    });
  }
  return rows;
}

function legacyTopics(
  text: string,
  section: Section<ExpressionStatement | AstNode> | null,
): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const item of section?.items ?? []) {
    if (item.kind !== "ExpressionStatement") continue;
    const e = (item as ExpressionStatement).expression;
    if (e.kind !== "MethodCall") continue;
    for (const arg of e.args)
      if (arg.kind === "NamedArgument" && isTopicKey(arg.name))
        rows.push({
          name: oneLine(slice(text, arg.value)),
          value: oneLine(slice(text, item)),
        });
  }
  return rows;
}

const EMPTY: DeclarationDetails = {
  path: null,
  line: null,
  description: null,
  directives: [],
  topics: [],
  operators: [],
  preview: null,
};

function operatorsOf(
  script: ScriptCatalogue,
  steps: readonly { operator: string; known: boolean }[],
): OperatorDetail[] {
  return steps.map((step) => {
    const entries = script.operators.filter((o) => o.name === step.operator);
    const markdown = operatorDescription(script, step.operator);
    const text =
      markdown === undefined ? "" : firstParagraph(plainText(markdown));
    return {
      name: step.operator,
      description: text === "" ? null : text,
      legacy: !step.known || entries.every((o) => o.deprecated),
    };
  });
}

function calleeDetails(
  input: DetailsInput,
  callee: CalleeDeclaration | null,
  fallbackPath: string | null,
): DeclarationDetails {
  const declaration = callee?.declaration ?? null;
  const path = callee?.path ?? fallbackPath;
  if (declaration === null) return { ...EMPTY, path };
  const text = textOf(input.model, callee?.path ?? null);
  const base = {
    ...EMPTY,
    path,
    line: declaration.range.line,
    description: docSummary(declaration.leadingComments),
  };
  switch (declaration.kind) {
    case "Process":
      return {
        ...base,
        directives: directiveRows(text, declaration.directives),
        topics: declaration.typed
          ? typedTopics(text, declaration.topics)
          : legacyTopics(text, declaration.outputs),
        preview: sectionPreview(
          text,
          SECTION_TITLE[
            declaration.exec?.label as keyof typeof SECTION_TITLE
          ] ?? "Script",
          declaration.exec,
        ),
      };
    case "Agent":
      return {
        ...base,
        directives: directiveRows(text, declaration.directives),
        preview: sectionPreview(text, "Prompt", declaration.prompt),
      };
    case "Unparsed": {
      const { text: body, truncated } = previewText(text, declaration.range);
      return {
        ...base,
        preview:
          body === "" ? null : { title: "Source", text: body, truncated },
      };
    }
    default:
      return base;
  }
}

/** The declaration details of `node`: `callee` is what `resolveCallee` gave for a call, null otherwise. */
export function declarationDetails(
  input: DetailsInput,
  node: GraphNode,
  callee: CalleeDeclaration | null,
): DeclarationDetails {
  const { projection, model, catalogue } = input;
  if (node.kind === "call")
    return calleeDetails(input, callee, node.callee.path);
  const path = projection.workflow.path;
  const text = textOf(model, path);
  const here = { ...EMPTY, path, line: node.range.line };
  const source = (t: string, range: Range): Preview => {
    const p = previewText(t, range);
    return { title: "Source", text: p.text, truncated: p.truncated };
  };
  switch (node.kind) {
    case "chain":
      return {
        ...here,
        operators: operatorsOf(catalogue, node.steps),
        preview: source(text, node.range),
      };
    case "factory": {
      const markdown = factoryDescription(catalogue, node.factory);
      const description =
        markdown === undefined ? "" : firstParagraph(plainText(markdown));
      return {
        ...here,
        description: description === "" ? null : description,
        preview: source(text, node.range),
      };
    }
    case "code":
      return {
        ...here,
        preview: source(node.text, {
          ...node.range,
          start: 0,
          end: node.text.length,
        }),
      };
    case "params":
    case "output": {
      const whole = projection.workflow.range;
      const spansWorkflow =
        node.range.start === whole.start && node.range.end === whole.end;
      return {
        ...here,
        preview: spansWorkflow ? null : source(text, node.range),
      };
    }
    default:
      return here;
  }
}
