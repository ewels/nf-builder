// The config editor's view of one file (F-601, FI-01 to FI-06, AR-30): the top-level statements grouped into scope
// cards, include rows and code rows. It reads the AST once and carries excerpts, never the file.
import type {
  Comment,
  ConfigApplyBlock,
  ConfigAssign,
  ConfigBlock,
  ConfigContext,
  ConfigInclude,
  ConfigItem,
  ConfigRules,
  ConfigSelector,
  ConfigSelectorRef,
  ConfigSourceFile,
  ConfigStatement,
  ConfigValueKind,
  Diagnostic,
  Expression,
  Range,
} from "@nf-builder/lang-core";
import type { ConfigIncludeModel } from "../model/file-model";
import { matchSelector } from "./selectors";
import {
  type CodeRow,
  type ConfigRow,
  type ConfigView,
  type ConfigViewItem,
  EXCERPT_LIMIT,
  type IncludeRow,
  type OptionRow,
  type PluginRow,
  type ProcessUses,
  type ProfileCard,
  type ScopeCard,
  type SelectorCard,
} from "./types";
import { readValue } from "./values";

export interface ConfigViewInput {
  readonly file: ConfigSourceFile;
  readonly rules: ConfigRules;
  readonly uses: ProcessUses;
  /** The file's diagnostics. */
  readonly diagnostics: readonly Diagnostic[];
  readonly includes: readonly ConfigIncludeModel[];
}

const ROOT: ConfigContext = { profile: null, selector: null };

const span = (a: Range, b: Range): Range => ({
  start: Math.min(a.start, b.start),
  end: Math.max(a.end, b.end),
  line: a.start <= b.start ? a.line : b.line,
  column: a.start <= b.start ? a.column : b.column,
  endLine: a.end >= b.end ? a.endLine : b.endLine,
  endColumn: a.end >= b.end ? a.endColumn : b.endColumn,
});

const isSelectorKey = (name: string): boolean =>
  name.startsWith("withName:") || name.startsWith("withLabel:");

/** Rows of one card or selector, one per option path in order of first appearance; the last statement wins. */
class Rows {
  readonly rows: ConfigRow[] = [];
  readonly #options = new Map<string, number>();

  option(key: string, row: OptionRow): void {
    const at = this.#options.get(key);
    const old = at === undefined ? undefined : (this.rows[at] as OptionRow);
    if (at === undefined || old === undefined) {
      this.#options.set(key, this.rows.length);
      this.rows.push(row);
      return;
    }
    this.rows[at] = {
      ...row,
      occurrences: old.occurrences + 1,
      diagnostics: [...old.diagnostics, ...row.diagnostics],
    };
  }
}

interface SelectorBuilder {
  readonly key: string;
  readonly selector: ConfigSelectorRef | null;
  readonly written: string;
  readonly rows: Rows;
  range: Range;
}

interface ProfileBuilder {
  readonly name: string;
  readonly statements: ConfigStatement[];
  range: Range;
}

interface ScopeBuilder {
  readonly scope: string;
  readonly rows: Rows;
  readonly selectors: Map<string, SelectorBuilder>;
  readonly profiles: Map<string, ProfileBuilder>;
  readonly plugins: PluginRow[];
  range: Range;
}

type Slot =
  | { readonly kind: "scope"; readonly builder: ScopeBuilder }
  | { readonly kind: "row"; readonly item: IncludeRow | CodeRow };

export function configView(input: ConfigViewInput): ConfigView {
  const { file, rules, uses, diagnostics, includes } = input;
  const text = file.text;
  const comments: readonly Comment[] = file.comments;

  const excerpt = (range: Range): string => {
    const flat = text.slice(range.start, range.end).replace(/\s+/g, " ").trim();
    return flat.length > EXCERPT_LIMIT
      ? `${flat.slice(0, EXCERPT_LIMIT - 1)}…`
      : flat;
  };

  const diagnosticsIn = (range: Range): Diagnostic[] =>
    diagnostics.filter(
      (d) => d.range.start >= range.start && d.range.end <= range.end,
    );

  const hasCommentIn = (range: Range): boolean =>
    comments.some(
      (c) => c.range.start >= range.start && c.range.end <= range.end,
    );

  /** What the form calls a literal in a free-named row (`params`, `env`, keys of a map option). */
  const inferKind = (expr: Expression): ConfigValueKind => {
    switch (expr.kind) {
      case "String":
        return "string";
      case "Boolean":
        return "boolean";
      case "Number":
        return expr.integer ? "integer" : "decimal";
      case "Unary":
        return expr.operator === "-" && expr.operand.kind === "Number"
          ? expr.operand.integer
            ? "integer"
            : "decimal"
          : "code";
      default:
        return "code";
    }
  };

  const problemsIn = (range: Range): string[] =>
    file.problems
      .filter((p) => p.line >= range.line && p.line <= range.endLine)
      .map((p) => p.message);

  const codeRow = (
    key: string,
    range: Range,
    reason: CodeRow["reason"],
    problems: readonly string[] = problemsIn(range),
  ): CodeRow => ({
    kind: "code",
    key,
    range,
    text: excerpt(range),
    reason,
    problems,
  });

  const includeRow = (key: string, node: ConfigInclude): IncludeRow => {
    const model = includes.find((i) => i.node === node);
    const target = model?.target;
    return {
      kind: "include",
      key,
      range: node.range,
      source: excerpt(node.source.range),
      target:
        target?.kind === "file"
          ? { kind: "file", path: target.path }
          : target?.kind === "missing"
            ? { kind: "missing", message: target.message }
            : { kind: "external" },
    };
  };

  const optionRow = (
    key: string,
    names: readonly string[],
    assign: ConfigAssign,
    readOnly: boolean,
    scoped: boolean,
  ): OptionRow => {
    const cls = rules.classify(names);
    const types = cls.kind === "option" ? cls.types : [];
    let valueKind: ConfigValueKind = "code";
    if (!readOnly) {
      if (cls.kind === "option") valueKind = rules.valueKind(names, types);
      else if (cls.kind === "free") valueKind = inferKind(assign.value);
    }
    const value =
      valueKind === "code" || hasCommentIn(assign.value.range)
        ? null
        : readValue(assign.value, valueKind);
    const first = assign.path[0];
    const last = assign.path[assign.path.length - 1];
    return {
      kind: "option",
      key,
      option: names,
      label: (scoped ? names.slice(1) : names).join("."),
      class: cls.kind,
      types,
      valueKind,
      value,
      code: value === null ? excerpt(assign.value.range) : null,
      occurrences: 1,
      range: assign.range,
      nameRange: span((first ?? assign).range, (last ?? assign).range),
      diagnostics: diagnosticsIn(assign.range),
    };
  };

  const selectorRef = (
    s: ConfigSelector,
    scope: string,
  ): ConfigSelectorRef | null =>
    scope === "process" &&
    (s.selector.name === "withName" || s.selector.name === "withLabel")
      ? { kind: s.selector.name, pattern: s.target.name }
      : null;

  const build = (
    statements: readonly ConfigItem[],
    ctxKey: string,
  ): ConfigViewItem[] => {
    const slots: Slot[] = [];
    const scopes = new Map<string, ScopeBuilder>();
    const slotOf = (scope: string, range: Range): ScopeBuilder => {
      let builder = scopes.get(scope);
      if (!builder) {
        builder = {
          scope,
          rows: new Rows(),
          selectors: new Map(),
          profiles: new Map(),
          plugins: [],
          range,
        };
        scopes.set(scope, builder);
        slots.push({ kind: "scope", builder });
      } else builder.range = span(builder.range, range);
      return builder;
    };
    const rowKey = (kind: string, range: Range) =>
      `${kind}:${ctxKey}:${range.start}`;

    /** Statements of a block (or a selector), as rows of `rows`; `prefix` is the option path so far. */
    const collect = (
      builder: ScopeBuilder,
      rows: Rows,
      statements: readonly ConfigStatement[],
      prefix: readonly string[],
      readOnly: boolean,
    ): void => {
      for (const s of statements) {
        if (s.kind === "ConfigAssign") {
          const keys = s.path.map((n) => n.name);
          const names = [...prefix, ...keys.filter((k) => !isSelectorKey(k))];
          const dotted = keys.some(isSelectorKey);
          const key = `opt:${ctxKey}:${names.join(".")}`;
          rows.option(
            key,
            optionRow(
              key,
              names,
              s,
              readOnly || dotted,
              prefix.length > 0 || names.length > 1,
            ),
          );
        } else if (s.kind === "ConfigBlock") {
          const name = s.name.name;
          collect(
            builder,
            rows,
            s.statements,
            isSelectorKey(name) ? prefix : [...prefix, name],
            readOnly || isSelectorKey(name),
          );
        } else if (s.kind === "ConfigSelector") {
          const ref = selectorRef(s, prefix[0] ?? "");
          const written = excerpt(span(s.selector.range, s.target.range));
          const key = `sel:${ctxKey}:${builder.scope}:${ref ? `${ref.kind}:${ref.pattern}` : written}`;
          let selector = builder.selectors.get(key);
          if (!selector) {
            selector = {
              key,
              selector: ref,
              written,
              rows: new Rows(),
              range: s.range,
            };
            builder.selectors.set(key, selector);
          } else selector.range = span(selector.range, s.range);
          collect(
            builder,
            selector.rows,
            s.statements,
            prefix,
            readOnly || ref === null,
          );
        } else if (s.kind === "ConfigInclude") {
          rows.rows.push(includeRow(rowKey("include", s.range), s));
        } else if (s.kind === "ConfigIncomplete") {
          rows.rows.push(
            codeRow(rowKey("code", s.range), s.range, "incomplete"),
          );
        } else if (s.kind === "ConfigInvalid") {
          rows.rows.push(codeRow(rowKey("code", s.range), s.range, "invalid"));
        } else {
          rows.rows.push(codeRow(rowKey("code", s.range), s.range, "value"));
        }
        builder.range = span(builder.range, s.range);
      }
    };

    const addProfiles = (builder: ScopeBuilder, block: ConfigBlock): void => {
      for (const inner of block.statements) {
        if (inner.kind !== "ConfigBlock") {
          builder.rows.rows.push(
            codeRow(rowKey("code", inner.range), inner.range, "value"),
          );
          continue;
        }
        const name = inner.name.name;
        const known = builder.profiles.get(name);
        if (known) {
          known.statements.push(...inner.statements);
          known.range = span(known.range, inner.range);
        } else
          builder.profiles.set(name, {
            name,
            statements: [...inner.statements],
            range: inner.range,
          });
      }
    };

    const addPlugins = (
      builder: ScopeBuilder,
      block: ConfigApplyBlock,
    ): void => {
      for (const apply of block.statements) {
        const arg = apply.args[0];
        if (apply.name.name === "id" && arg?.kind === "String") {
          const at = arg.value.indexOf("@");
          builder.plugins.push({
            key: `plugin:${ctxKey}:${apply.range.start}`,
            id: arg.value,
            name: at < 0 ? arg.value : arg.value.slice(0, at),
            version: at < 0 ? null : arg.value.slice(at + 1),
            range: apply.range,
          });
        } else
          builder.rows.rows.push(
            codeRow(rowKey("code", apply.range), apply.range, "value"),
          );
      }
    };

    for (const s of statements) {
      if (s.kind === "Unparsed") {
        slots.push({
          kind: "row",
          item: codeRow(
            rowKey("code", s.range),
            s.range,
            "unparsed",
            s.problems.map((p) => p.message),
          ),
        });
      } else if (s.kind === "ConfigInclude") {
        slots.push({
          kind: "row",
          item: includeRow(rowKey("include", s.range), s),
        });
      } else if (s.kind === "ConfigIncomplete" || s.kind === "ConfigInvalid") {
        slots.push({
          kind: "row",
          item: codeRow(
            rowKey("code", s.range),
            s.range,
            s.kind === "ConfigIncomplete" ? "incomplete" : "invalid",
          ),
        });
      } else if (s.kind === "ConfigSelector") {
        slots.push({
          kind: "row",
          item: codeRow(rowKey("code", s.range), s.range, "value"),
        });
      } else if (s.kind === "ConfigAssign") {
        const keys = s.path.map((n) => n.name);
        if (keys.length > 1 && keys[0] === "profiles") {
          slots.push({
            kind: "row",
            item: codeRow(rowKey("code", s.range), s.range, "value"),
          });
          continue;
        }
        const builder = slotOf(
          keys.length === 1 ? "" : (keys[0] as string),
          s.range,
        );
        collect(builder, builder.rows, [s], [], false);
      } else if (s.kind === "ConfigApplyBlock") {
        const builder = slotOf(s.name.name, s.range);
        if (s.name.name === "plugins") addPlugins(builder, s);
        else
          builder.rows.rows.push(
            codeRow(rowKey("code", s.range), s.range, "value"),
          );
      } else {
        const name = s.name.name;
        const builder = slotOf(name, s.range);
        if (name === "profiles") addProfiles(builder, s);
        else collect(builder, builder.rows, s.statements, [name], false);
      }
    }

    return slots.map((slot): ConfigViewItem => {
      if (slot.kind === "row") return slot.item;
      const b = slot.builder;
      const form =
        b.scope === ""
          ? null
          : rules.forms.scopes.find((f) => f.scope === b.scope);
      const known =
        b.scope === "" ||
        form !== undefined ||
        rules.classify([b.scope]).kind !== "unknown";
      const selectors = [...b.selectors.values()].map(
        (sel): SelectorCard => ({
          key: sel.key,
          selector: sel.selector,
          written: sel.written,
          range: sel.range,
          rows: sel.rows.rows,
          match: sel.selector ? matchSelector(sel.selector, uses) : null,
        }),
      );
      const profiles = [...b.profiles.values()].map(
        (p): ProfileCard => ({
          key: `profile:${ctxKey}:${p.name}`,
          name: p.name,
          range: p.range,
          items: build(p.statements, `${ctxKey}/${p.name}`),
        }),
      );
      const card: ScopeCard = {
        key: `scope:${ctxKey}:${b.scope}`,
        scope: b.scope,
        known,
        form: b.scope === "" ? "unscoped" : (form?.form ?? "generic"),
        pinned: form?.pinned ?? [],
        rows: b.rows.rows,
        selectors,
        profiles,
        plugins: b.plugins,
        range: b.range,
      };
      return { kind: "scope", card };
    });
  };

  /** A file nothing could be modelled in is one code row: its problems, and the start of its text. */
  const verbatim = (): ConfigViewItem[] => {
    const lines = text.split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (text.trim() === "") return [];
    return [
      codeRow(
        "code:top:0",
        {
          start: 0,
          end: text.length,
          line: 1,
          column: 1,
          endLine: lines.length,
          endColumn: [...last].length + 1,
        },
        "unparsed",
        file.problems.map((p) => p.message),
      ),
    ];
  };

  return {
    path: file.path,
    status: file.status,
    editable: file.status === "modelled" && file.problems.length === 0,
    context: ROOT,
    items: file.ast === null ? verbatim() : build(file.ast.statements, "top"),
  };
}
