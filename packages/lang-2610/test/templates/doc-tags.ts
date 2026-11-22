import type { Comment, ProcessDef, WorkflowDef } from "@nf-builder/lang-core";

export interface DocCheck {
  /** The Markdown text above the first tag, with the comment markers removed. */
  readonly text: string;
  readonly params: readonly string[];
  readonly returns: readonly string[];
}

/** Splits a `/** ... *\/` comment into its text and its `@param` and `@return` tags (LA-50). */
export function readDoc(comment: Comment): DocCheck {
  const lines = comment.text
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*? ?/, "").trimEnd());
  const text: string[] = [];
  const params: string[] = [];
  const returns: string[] = [];
  for (const line of lines) {
    const param = /^@param\s+(\w+)/.exec(line);
    const ret = /^@return\s+(.*)/.exec(line);
    if (param) params.push(param[1] as string);
    else if (ret) returns.push(ret[1] as string);
    else if (!line.startsWith("@") && params.length + returns.length === 0)
      text.push(line);
  }
  return { text: text.join("\n").trim(), params, returns };
}

/** The doc comment directly above a process or workflow, or null. */
export function docOf(node: ProcessDef | WorkflowDef): DocCheck | null {
  const doc = node.leadingComments?.find((c) => c.kind === "doc");
  return doc ? readDoc(doc) : null;
}

/** What LA-50 expects as tags for a process or workflow: one `@param` per input or take, one `@return` per output or emit. */
export function expectedTags(node: ProcessDef | WorkflowDef): {
  params: string[];
  returns: number;
} {
  if (node.kind === "Process") {
    const inputs = node.typed ? (node.inputs?.items ?? []) : [];
    return {
      // A plain input is one @param by its name. A record or tuple input is one @param per field or component,
      // because each is a variable in the script.
      params: inputs.flatMap((i) =>
        i.kind === "TypedName"
          ? [i.name.name]
          : i.kind === "RecordInput"
            ? i.fields.map((f) => f.name.name)
            : i.components.map((c) => c.name.name),
      ),
      returns: node.outputs?.items.length ?? 0,
    };
  }
  return {
    params: (node.takes?.items ?? []).map((t) => t.name.name),
    returns: node.emits?.items.length ?? 0,
  };
}
