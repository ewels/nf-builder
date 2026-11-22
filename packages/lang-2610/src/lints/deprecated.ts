// Rules for deprecated syntax (LA-34, F-112): `when`, `shell`, `Channel`, the implicit closure parameter and deprecated
// directives. Messages keep nf-lang's wording (v26.10.7) as their start.
import {
  type AgentDef,
  type Closure,
  type LintFinding,
  type LintRule,
  type MethodCall,
  type ProcessDef,
  type TextEdit,
  walk,
} from "@nf-builder/lang-core";
import { directiveCalls, forEachIt, methodName, scriptOf } from "./scan.ts";

const processes = (
  context: Parameters<LintRule["check"]>[0],
): (ProcessDef | AgentDef)[] =>
  (scriptOf(context)?.body ?? []).filter(
    (item): item is ProcessDef | AgentDef =>
      item.kind === "Process" || item.kind === "Agent",
  );

/** `ScriptAstBuilder.java#L824`: the `when` section is deprecated. */
export const deprecatedWhen: LintRule = {
  code: "deprecated-when",
  check: (context) => {
    const out: LintFinding[] = [];
    for (const def of processes(context))
      if (def.kind === "Process" && def.when?.labelRange)
        out.push({
          range: def.when.labelRange,
          message:
            "The `when` section is deprecated -- use conditional logic in the calling workflow, or the `process.when` config option to disable a process at runtime",
        });
    return out;
  },
};

/** `ScriptAstBuilder.java#L836`: the `shell` block is deprecated. */
export const deprecatedShell: LintRule = {
  code: "deprecated-shell",
  check: (context) => {
    const out: LintFinding[] = [];
    for (const def of processes(context))
      if (
        def.kind === "Process" &&
        def.exec?.label === "shell" &&
        def.exec.labelRange
      )
        out.push({
          range: def.exec.labelRange,
          message: "The `shell` block is deprecated, use `script` instead",
        });
    return out;
  },
};

/** `VariableScopeVisitor.java#L765`: `Channel.of(...)` is deprecated, a method call on the variable `Channel`. */
export const deprecatedChannel: LintRule = {
  code: "deprecated-channel",
  check: (context) => {
    const ast = scriptOf(context);
    const out: LintFinding[] = [];
    if (ast)
      walk(ast, (node) => {
        if (node.kind !== "MethodCall") return;
        const { receiver } = node as MethodCall;
        if (receiver?.kind === "Variable" && receiver.name === "Channel")
          out.push({
            range: receiver.range,
            message:
              "The use of `Channel` to access channel factories is deprecated -- use `channel` instead",
            fix: {
              title: "Replace `Channel` with `channel`",
              edits: [
                {
                  start: receiver.range.start,
                  end: receiver.range.end,
                  text: "channel",
                },
              ],
            },
          });
      });
    return out;
  },
};

/** The edit that declares `it` as the closure's parameter. */
function declareIt(text: string, closure: Closure): TextEdit | null {
  const at = closure.range.start + 1;
  if (closure.params === null)
    return {
      start: at,
      end: at,
      text: /^\s/.test(text.charAt(at)) ? " it ->" : " it -> ",
    };
  const arrow = /^\s*/.exec(text.slice(at))?.[0].length ?? 0;
  if (!text.startsWith("->", at + arrow)) return null;
  return { start: at + arrow, end: at + arrow, text: "it " };
}

/** `VariableScopeVisitor.java#L885` (script) and config `#L343`: an `it` that resolves to a closure's implicit parameter. */
export const implicitIt: LintRule = {
  code: "implicit-it",
  check: (context) => {
    const root = context.file.ast;
    const out: LintFinding[] = [];
    if (root)
      forEachIt(root, (it, closure) => {
        const edit = declareIt(context.file.text, closure);
        out.push({
          range: it.range,
          message:
            "Implicit closure parameter is deprecated, declare an explicit parameter instead",
          ...(edit
            ? {
                fix: {
                  title: "Declare `it` as the closure parameter",
                  edits: [edit],
                },
              }
            : {}),
        });
      });
    return out;
  },
};

/** What to do instead, by directive name; the catalogue says which directives are deprecated (`storeDir`: store-dir.mdx). */
export const DIRECTIVE_ADVICE: Readonly<Record<string, string>> = {
  storeDir:
    "use explicit workflow logic that reuses an existing output instead",
};

/** `VariableScopeChecker.java#L285`: a directive the catalogue marks deprecated. nf-lang reports it, `nextflow lint` hides it. */
export const deprecatedDirective: LintRule = {
  code: "deprecated-directive",
  check: (context) => {
    const out: LintFinding[] = [];
    const deprecated = (list: { name: string; deprecated: boolean }[]) =>
      new Set(list.filter((d) => d.deprecated).map((d) => d.name));
    const forProcess = deprecated(context.catalogue.script.directives);
    const forAgent = deprecated(context.catalogue.script.agentDirectives);
    for (const def of processes(context)) {
      const names = def.kind === "Agent" ? forAgent : forProcess;
      for (const call of directiveCalls(def)) {
        const name = methodName(call);
        if (!names.has(name)) continue;
        out.push({
          range: call.range,
          message: `The \`${name}\` directive is deprecated -- ${DIRECTIVE_ADVICE[name] ?? "remove it, or use its replacement"}`,
        });
      }
    }
    return out;
  },
};
