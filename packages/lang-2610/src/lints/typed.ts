// Warnings for typed code that `nextflow lint` prints (LA-37, F-112): missing type annotations, several typed process
// outputs and a type in a `publish:` statement. Messages keep nf-lang's wording (v26.10.7) as their start.
import type {
  LintFinding,
  LintRule,
  ProcessInput,
  Range,
  TypedName,
} from "@nf-builder/lang-core";
import { scriptOf } from "./scan.ts";

const missing = (what: string, name: TypedName["name"]): LintFinding => ({
  range: name.range,
  message: `${what} should have a type annotation -- add a type, such as \`${name.name}: String\``,
});

/** The untyped names among the inputs of a typed process or agent. */
function untypedInputs(items: readonly ProcessInput[]): LintFinding[] {
  const out: LintFinding[] = [];
  for (const input of items) {
    if (input.kind === "TypedName") {
      if (input.type === null) out.push(missing("Process input", input.name));
    } else if (input.kind === "RecordInput") {
      for (const f of input.fields)
        if (f.type === null) out.push(missing("Record field", f.name));
    } else {
      for (const c of input.components)
        if (c.type === null) out.push(missing("Tuple component", c.name));
    }
  }
  return out;
}

/** `ScriptAstBuilder.java#L597`, `#L619`, `#L634` and `#L977`: an input, record field, tuple component or take without a type. */
export const missingType: LintRule = {
  code: "missing-type",
  check: (context) =>
    (scriptOf(context)?.body ?? []).flatMap((item): LintFinding[] => {
      if (item.kind === "Agent" || (item.kind === "Process" && item.typed))
        return untypedInputs(item.inputs?.items ?? []);
      if (item.kind === "Workflow" && item.typed)
        return (item.takes?.items ?? []).flatMap((take) =>
          take.type === null
            ? [missing("Typed workflow input", take.name)]
            : [],
        );
      return [];
    }),
};

/** `ScriptAstBuilder.java#L695`: a typed process whose outputs are all named, and more than one. */
export const typedProcessOutputs: LintRule = {
  code: "typed-process-outputs",
  check: (context) =>
    (scriptOf(context)?.body ?? []).flatMap((item): LintFinding[] => {
      if (item.kind !== "Process" || !item.typed) return [];
      const outputs = item.outputs;
      if (!outputs?.labelRange || outputs.items.length < 2) return [];
      if (outputs.items.some((o) => o.kind === "ExpressionStatement"))
        return [];
      return [
        {
          range: outputs.labelRange,
          message:
            "Typed process should have only one output -- consider combining outputs into a record",
        },
      ];
    }),
};

/** `ScriptAstBuilder.java#L1059`: `name: Type = value` in `publish:`. The fix deletes the annotation. */
export const publishTypeIgnored: LintRule = {
  code: "publish-type-ignored",
  check: (context) =>
    (scriptOf(context)?.body ?? []).flatMap((item): LintFinding[] => {
      if (item.kind !== "Workflow") return [];
      return (item.publishers?.items ?? []).flatMap((target): LintFinding[] => {
        if (target.type === null) return [];
        const range: Range = {
          start: target.name.range.start,
          end: target.type.range.end,
          line: target.name.range.line,
          column: target.name.range.column,
          endLine: target.type.range.endLine,
          endColumn: target.type.range.endColumn,
        };
        return [
          {
            range,
            message:
              "Workflow output type should be declared in the output block -- the type annotation in the publish statement is ignored",
            fix: {
              title: "Remove the type annotation",
              edits: [
                {
                  start: target.name.range.end,
                  end: target.type.range.end,
                  text: "",
                },
              ],
            },
          },
        ];
      });
    }),
};
