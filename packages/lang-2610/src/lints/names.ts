// Name, include and agent-output checks that nf-lang reports as errors (LA-31, AR-05, F-112). Messages keep nf-lang's
// wording (v26.10.7) as their start; the clause after ` -- ` says what to do.
import type {
  ConfigStatement,
  Include,
  IncludeEntry,
  LintContext,
  LintFinding,
  LintInclude,
  LintRule,
  MethodCall,
  NamedOutput,
  Range,
  TextEdit,
  TypeRef,
  Wildcard,
} from "@nf-builder/lang-core";
import { walk } from "@nf-builder/lang-core";
import { methodName, scriptOf } from "./scan.ts";

/** `VariableScopeVisitor.java#L249`: a feature flag the catalogue doesn't list. */
export const featureFlag: LintRule = {
  code: "feature-flag",
  check: (context) => {
    const known = context.catalogue.script.featureFlags.map((f) => f.name);
    return (scriptOf(context)?.body ?? []).flatMap((item): LintFinding[] =>
      item.kind === "FeatureFlag" && !known.includes(item.name.name)
        ? [
            {
              range: item.range,
              message: `Unrecognized feature flag '${item.name.name}' -- use one of ${known.join(", ")}, or remove it`,
            },
          ]
        : [],
    );
  },
};

const isType = (i: LintInclude): boolean =>
  i.binding.declaration?.kind === "Record" ||
  i.binding.declaration?.kind === "Enum";

/** `VariableScopeVisitor.java#L140` and `#L144`: pipelines must be aliased, other types must not be. */
export const includeAlias: LintRule = {
  code: "include-alias",
  check: (context) =>
    context.includes.flatMap((i): LintFinding[] => {
      if (i.pipeline && i.entry.alias === null)
        return [
          {
            range: i.entry.range,
            message: `An included pipeline must be aliased, e.g. \`${i.entry.name.name} as MY_PIPELINE\``,
          },
        ];
      if (!i.pipeline && isType(i) && i.entry.alias !== null)
        return [
          {
            range: i.entry.range,
            message: "Included types cannot be aliased -- remove the alias",
          },
        ];
      return [];
    }),
};

/** `ResolveIncludeVisitor.java#L139-L142`: including a pipeline needs types in both scripts. Paths are project-relative. */
export const pipelineIncludeTypes: LintRule = {
  code: "pipeline-include-types",
  check: (context) => {
    const ast = scriptOf(context);
    const seen = new Set<Include>();
    const out: LintFinding[] = [];
    for (const i of context.includes) {
      if (!i.pipeline || seen.has(i.include)) continue;
      seen.add(i.include);
      if (ast && !ast.typesEnabled)
        out.push({
          range: i.include.range,
          message:
            "Including a pipeline requires `nextflow.enable.types = true` in the including script -- add `nextflow.enable.types = true` to this script",
        });
      const path = i.target.kind === "file" ? i.target.path : null;
      if (i.binding.typesEnabled === false)
        out.push({
          range: i.include.range,
          message: `An included pipeline must enable static typing -- set \`nextflow.enable.types = true\` in '${path}'`,
        });
    }
    return out;
  },
};

const ADVICE = "remove the duplicate, or rename one or alias it with `as`";

/** The text of `include` and the newline after it. */
function includeEdit(text: string, include: Include): TextEdit {
  const end = include.range.end;
  const after = text.startsWith("\r\n", end)
    ? 2
    : text.startsWith("\n", end)
      ? 1
      : 0;
  return { start: include.range.start, end: end + after, text: "" };
}

/** Removes entry `index` of `include` when `dups` are the entries that duplicate an earlier one. */
function entryEdit(
  text: string,
  include: Include,
  index: number,
  dups: ReadonlySet<IncludeEntry>,
): TextEdit {
  const entries = include.entries;
  if (entries.every((e) => dups.has(e))) return includeEdit(text, include);
  const entry = entries[index] as IncludeEntry;
  const trailing = entries.slice(index + 1).every((e) => dups.has(e));
  if (trailing && index > 0)
    return {
      start: (entries[index - 1] as IncludeEntry).range.end,
      end: entry.range.end,
      text: "",
    };
  return {
    start: entry.range.start,
    end: (entries[index + 1] as IncludeEntry).range.start,
    text: "",
  };
}

interface Registered {
  readonly entry: IncludeEntry;
  readonly same: string;
}

/**
 * `VariableScopeVisitor.java#L150`, `#L183`, `#L189`, `#L210`, `#L217`, `#L260`: a name included twice, declared twice
 * or declared and included. Functions may overload. Only an identical include entry (same name, alias and target)
 * has a fix: remove it.
 */
export const duplicateName: LintRule = {
  code: "duplicate-name",
  check: (context: LintContext) => {
    const ast = scriptOf(context);
    if (!ast) return [];
    const text = context.file.text;
    const out: LintFinding[] = [];
    const flag = (range: Range, what: string, fix?: LintFinding["fix"]) =>
      out.push({
        range,
        message: `${what} -- ${ADVICE}`,
        ...(fix ? { fix } : {}),
      });

    // includes, in order; entries nf-lang cannot resolve or rejects for their alias are not registered
    const included = new Map<string, Registered>();
    const dups = new Set<IncludeEntry>();
    const found: { i: LintInclude; first: Registered }[] = [];
    for (const i of context.includes) {
      const resolved =
        i.binding.declaration !== null ||
        i.target.kind === "plugin" ||
        i.target.kind === "external";
      if (!resolved) continue;
      if (i.pipeline && i.entry.alias === null) continue;
      if (!i.pipeline && isType(i) && i.entry.alias !== null) continue;
      const name = (i.entry.alias ?? i.entry.name).name;
      const target =
        i.target.kind === "file"
          ? i.target.path
          : i.target.kind === "plugin"
            ? i.target.plugin
            : "";
      const same = `${i.entry.name.name} as ${i.entry.alias?.name ?? ""} from ${i.target.kind}:${target}`;
      const first = included.get(name);
      if (first) {
        found.push({ i, first });
        if (first.same === same) dups.add(i.entry);
      }
      included.set(name, { entry: i.entry, same });
    }
    for (const { i, first } of found) {
      const name = (i.entry.alias ?? i.entry.name).name;
      const identical = dups.has(i.entry);
      const index = i.include.entries.indexOf(i.entry);
      flag(
        i.include.range,
        `\`${name}\` is already included`,
        identical
          ? {
              title: "Remove the duplicate include",
              edits: [entryEdit(text, i.include, index, dups)],
            }
          : undefined,
      );
    }

    // parameters
    for (const item of ast.body) {
      if (item.kind !== "ParamsBlock") continue;
      const seen = new Set<string>();
      for (const p of item.params) {
        if (seen.has(p.name.name))
          flag(p.range, `Parameter \`${p.name.name}\` is already declared`);
        seen.add(p.name.name);
      }
    }

    // methods: named workflows, then processes, agents and functions; a function never conflicts with a function
    const body = ast.body;
    const methods = [
      ...body.filter((d) => d.kind === "Workflow" && d.name !== null),
      ...body.filter((d) => d.kind === "Process"),
      ...body.filter((d) => d.kind === "Agent"),
      ...body.filter((d) => d.kind === "Function"),
    ] as { kind: string; name: { name: string }; range: Range }[];
    const declared: typeof methods = [];
    for (const m of methods) {
      const name = m.name.name;
      if (included.has(name)) flag(m.range, `\`${name}\` is already included`);
      const other = declared.find(
        (d) =>
          d.name.name === name &&
          !(m.kind === "Function" && d.kind === "Function"),
      );
      if (other) {
        const second = m.range.start > other.range.start ? m : other;
        flag(second.range, `\`${name}\` is already declared`);
        continue;
      }
      declared.push(m);
    }

    // types
    const types = body.filter((d) => d.kind === "Record" || d.kind === "Enum");
    types.forEach((second, j) => {
      const name = second.name.name;
      if (included.has(name))
        flag(second.range, `\`${name}\` is already included`);
      for (const first of types.slice(0, j))
        if (first.name.name === name)
          flag(second.range, `\`${name}\` is already declared`);
    });
    return out;
  },
};

const SUPPORTED = new Set(["Boolean", "Float", "Integer", "Path", "String"]);
const SUPPORTED_TYPES =
  "supported types are Boolean, Float, Integer, List<E>, Path, String, or a record type";

const typeName = (type: TypeRef | Wildcard): string =>
  type.kind === "Wildcard"
    ? "?"
    : type.typeArguments.length === 0
      ? type.name
      : `${type.name}<${type.typeArguments.map(typeName).join(", ")}>`;

/**
 * `ScriptResolveVisitor.java#L174` and `#L179`: an agent output `name: Type` is answered by the model under a JSON
 * schema, so it needs a supported type; `VariableScopeVisitor.java#L803`: `env` and `eval` exist in processes only.
 */
export const agentOutput: LintRule = {
  code: "agent-output",
  check: (context) => {
    const out: LintFinding[] = [];
    // the description of the unsupported part of a type, or null; record fields are followed once
    const unsupported = (
      type: TypeRef | Wildcard | null,
      visited: Set<unknown>,
    ): string | null => {
      if (type === null) return "type Object";
      if (type.kind === "Wildcard") return "type ?";
      if (type.name === "List") {
        const [arg] = type.typeArguments;
        if (type.typeArguments.length !== 1 || !arg)
          return `type ${typeName(type)}`;
        const r = unsupported(arg, visited);
        return r === null || r.startsWith("field ")
          ? r
          : `type ${typeName(type)}`;
      }
      const declaration = context.lookup(type.name)?.declaration;
      if (declaration?.kind === "Record") {
        if (visited.has(declaration)) return null;
        visited.add(declaration);
        for (const field of declaration.fields) {
          const r = unsupported(field.type, visited);
          if (r !== null)
            return r.startsWith("field ")
              ? r
              : `field \`${field.name.name}\` with ${r}`;
        }
        return null;
      }
      return SUPPORTED.has(type.name) ? null : `type ${typeName(type)}`;
    };
    const check = (output: NamedOutput) => {
      if (output.value !== null) return;
      const name = output.name.name;
      if (output.type === null)
        return out.push({
          range: output.name.range,
          message: `Agent output \`${name}\` should declare a type -- typed outputs are answered by the model`,
        });
      const bad = unsupported(output.type, new Set());
      if (bad !== null)
        out.push({
          range: output.name.range,
          message: `Agent output \`${name}\` has unsupported ${bad} -- ${SUPPORTED_TYPES}`,
        });
    };
    for (const item of scriptOf(context)?.body ?? []) {
      if (item.kind !== "Agent") continue;
      for (const output of item.outputs?.items ?? []) {
        if (output.kind === "NamedOutput") check(output);
        walk(output, (node) => {
          if (node.kind !== "MethodCall") return;
          const call = node as MethodCall;
          const name = methodName(call);
          if (
            call.receiver === null &&
            (name === "eval" || name === "env") &&
            !context.lookup(name)
          )
            out.push({
              range: call.method.range,
              message: `\`${name}\` is not defined -- use \`stdout()\`, \`file()\` or \`files()\` in an agent output`,
            });
        });
      }
    }
    return out;
  },
};

/** Config `VariableScopeVisitor.java#L204`: `includeConfig` only at the top level or directly in a profile. */
export const configIncludePlacement: LintRule = {
  code: "config-include-placement",
  check: (context) => {
    if (context.file.language !== "config" || !context.file.ast) return [];
    const out: LintFinding[] = [];
    // `scopes` holds the names of the enclosing blocks; selectors open no scope
    const visit = (statement: ConfigStatement, scopes: readonly string[]) => {
      if (statement.kind === "ConfigInclude") {
        const ok =
          scopes.length === 0 ||
          (scopes.length === 2 && scopes[0] === "profiles");
        if (!ok)
          out.push({
            range: statement.range,
            message:
              "Config includes are only allowed at the top-level or in a profile -- move it to the top level or into a profile",
          });
      } else if (statement.kind === "ConfigBlock") {
        for (const s of statement.statements)
          visit(s, [...scopes, statement.name.name]);
      } else if (statement.kind === "ConfigSelector") {
        for (const s of statement.statements) visit(s, scopes);
      }
    };
    for (const item of context.file.ast.statements)
      if (item.kind !== "Unparsed") visit(item, []);
    return out;
  },
};
