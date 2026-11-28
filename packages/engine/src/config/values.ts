// Config values the form can read and write (F-601, FI-02; plan 2.4). Reading is strict: anything the form can't model
// exactly gives null, and the page shows the code instead.
import {
  type ConfigValue,
  type ConfigValueKind,
  type DurationUnitName,
  type Expression,
  type Identifier,
  type MemoryUnitName,
  NO_RANGE,
  type NumberLiteral,
  type StringLiteral,
  walk,
} from "@nf-builder/lang-core";

const MEMORY_UNITS: readonly MemoryUnitName[] = [
  "B",
  "KB",
  "MB",
  "GB",
  "TB",
  "PB",
  "EB",
  "ZB",
];
/** What a duration unit is written as, to the unit it names; `m` is minutes. */
const DURATION_UNITS: Readonly<Record<string, DurationUnitName>> = {
  ms: "ms",
  s: "s",
  m: "min",
  min: "min",
  h: "h",
  d: "d",
};

const memoryUnit = (text: string): MemoryUnitName | null =>
  MEMORY_UNITS.find((u) => u === text.toUpperCase()) ?? null;
const durationUnit = (text: string, exact = false): DurationUnitName | null => {
  const key = exact ? text : text.toLowerCase();
  return Object.hasOwn(DURATION_UNITS, key)
    ? (DURATION_UNITS[key] ?? null)
    : null;
};

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const MEMORY_TEXT = /^(\d+)\s*\.?\s*([A-Za-z]+)$/;

const safe = (n: number): boolean => Number.isSafeInteger(n);

/** A comment attached anywhere inside the expression. */
function hasComment(expr: Expression): boolean {
  let found = false;
  walk(expr, (node) => {
    if (
      (node.leadingComments?.length ?? 0) > 0 ||
      (node.trailingComments?.length ?? 0) > 0 ||
      (node.danglingComments?.length ?? 0) > 0
    )
      found = true;
    return found ? false : undefined;
  });
  return found;
}

/** `-` before a number literal, as the number's sign and the literal. */
function signed(
  expr: Expression,
): { negative: boolean; number: NumberLiteral } | null {
  if (expr.kind === "Number") return { negative: false, number: expr };
  if (
    expr.kind === "Unary" &&
    expr.operator === "-" &&
    expr.operand.kind === "Number"
  )
    return { negative: true, number: expr.operand };
  return null;
}

function readMemoryText(text: string): ConfigValue | null {
  const m = MEMORY_TEXT.exec(text.trim());
  const unit = m && memoryUnit(m[2] as string);
  const amount = m ? Number(m[1]) : Number.NaN;
  return unit && safe(amount) ? { kind: "memory", amount, unit } : null;
}

function readDurationText(text: string): ConfigValue | null {
  const m = MEMORY_TEXT.exec(text.trim());
  const unit = m && durationUnit(m[2] as string);
  const amount = m ? Number(m[1]) : Number.NaN;
  return unit && safe(amount) ? { kind: "duration", amount, unit } : null;
}

/** `8.GB` or `2.h`: a whole number and a unit property. */
function readUnitProperty(
  expr: Expression,
  kind: "memory" | "duration",
): ConfigValue | null {
  if (
    expr.kind !== "Property" ||
    expr.navigation !== "." ||
    expr.object.kind !== "Number" ||
    expr.property.kind !== "Identifier"
  )
    return null;
  const { text, integer } = expr.object;
  const unitName = expr.property.name;
  if (!integer || !WHOLE.test(text) || !safe(Number(text))) return null;
  const amount = Number(text);
  if (kind === "memory") {
    const unit = MEMORY_UNITS.find((u) => u === unitName);
    return unit ? { kind: "memory", amount, unit } : null;
  }
  const unit = durationUnit(unitName, true);
  return unit ? { kind: "duration", amount, unit } : null;
}

function readInteger(expr: Expression): ConfigValue | null {
  const s = signed(expr);
  if (!s || !s.number.integer || !WHOLE.test(s.number.text)) return null;
  const value = Number(s.number.text);
  if (!safe(value)) return null;
  return { kind: "integer", value: s.negative ? -value : value };
}

function readDecimal(expr: Expression): ConfigValue | null {
  const s = signed(expr);
  if (!s || !DECIMAL.test(s.number.text)) return null;
  return { kind: "decimal", text: `${s.negative ? "-" : ""}${s.number.text}` };
}

const readString = (expr: Expression): ConfigValue | null =>
  expr.kind === "String" ? { kind: "string", value: expr.value } : null;

/** A map's entries have no layout kind here, so each value is read as whatever literal it is. */
function readAny(expr: Expression): ConfigValue | null {
  if (expr.kind === "Boolean") return { kind: "boolean", value: expr.value };
  return (
    readUnitProperty(expr, "memory") ??
    readUnitProperty(expr, "duration") ??
    readInteger(expr) ??
    readDecimal(expr) ??
    readString(expr)
  );
}

/** The value `expr` holds as `kind`, or null when it isn't a plain literal of that kind (closures, GStrings, references, comments inside). */
export function readValue(
  expr: Expression,
  kind: ConfigValueKind,
): ConfigValue | null {
  if (kind === "code" || hasComment(expr)) return null;
  switch (kind) {
    case "string":
      return readString(expr);
    case "boolean":
      return expr.kind === "Boolean"
        ? { kind: "boolean", value: expr.value }
        : null;
    case "integer":
      return readInteger(expr);
    case "decimal":
      return readDecimal(expr);
    case "memory":
      return (
        readUnitProperty(expr, "memory") ??
        (expr.kind === "String" ? readMemoryText(expr.value) : null)
      );
    case "duration":
      return (
        readUnitProperty(expr, "duration") ??
        (expr.kind === "String" ? readDurationText(expr.value) : null)
      );
    case "stringList": {
      if (expr.kind !== "List") return null;
      const values: string[] = [];
      for (const element of expr.elements) {
        if (element.kind !== "String") return null;
        values.push(element.value);
      }
      return { kind: "stringList", values };
    }
    case "map": {
      if (expr.kind !== "Map") return null;
      const entries: { key: string; value: ConfigValue }[] = [];
      for (const entry of expr.entries) {
        const key =
          entry.key.kind === "Identifier"
            ? entry.key.name
            : entry.key.kind === "String"
              ? entry.key.value
              : null;
        const value = key === null ? null : readAny(entry.value);
        if (key === null || value === null) return null;
        entries.push({ key, value });
      }
      return { kind: "map", entries };
    }
  }
}

const node = <K extends string>(kind: K) => ({ kind, range: NO_RANGE });
const identifier = (name: string): Identifier => ({
  ...node("Identifier"),
  name,
});
const number = (text: string, integer: boolean): Expression => {
  const literal: NumberLiteral = { ...node("Number"), text, integer };
  return text.startsWith("-")
    ? {
        ...node("Unary"),
        operator: "-",
        operand: { ...literal, text: text.slice(1) },
      }
    : literal;
};

/** A string as a single-quoted literal: backslash, quote and line breaks escaped. */
export const stringLiteral = (value: string): StringLiteral => ({
  ...node("String"),
  text: `'${value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}'`,
  value,
  quote: "'",
});

/** The expression that writes `value`, built from nodes with no source range (the printer lays them out). Throws for a number the config can't hold. */
export function valueExpression(value: ConfigValue): Expression {
  switch (value.kind) {
    case "string":
      return stringLiteral(value.value);
    case "boolean":
      return { ...node("Boolean"), value: value.value };
    case "integer":
      if (!safe(value.value))
        throw new RangeError(`${value.value} isn't a whole number`);
      return number(String(value.value), true);
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(value.text))
        throw new RangeError(`${value.text} isn't a plain decimal number`);
      return number(value.text, !value.text.includes("."));
    case "memory":
    case "duration":
      if (!safe(value.amount) || value.amount < 0)
        throw new RangeError(`${value.amount} isn't a whole number`);
      return {
        ...node("Property"),
        object: number(String(value.amount), true),
        navigation: ".",
        property: identifier(value.unit),
      };
    case "stringList":
      return {
        ...node("List"),
        elements: value.values.map(stringLiteral),
        trailingComma: false,
      };
    case "map":
      return {
        ...node("Map"),
        entries: value.entries.map((e) => ({
          ...node("MapEntry"),
          key: identifier(e.key),
          value: valueExpression(e.value),
        })),
        trailingComma: false,
      };
  }
}

const UNIT_HINT = (example: string) =>
  `Use a whole number and a unit, for example ${example}`;

/** What a field's text means as `kind`, or why not. */
export function parseValueText(
  kind: ConfigValueKind,
  text: string,
): { ok: true; value: ConfigValue } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  const done = (value: ConfigValue) => ({ ok: true as const, value });
  switch (kind) {
    case "string":
      return done({ kind: "string", value: text });
    case "boolean":
      return text === "true" || text === "false"
        ? done({ kind: "boolean", value: text === "true" })
        : fail("Choose true or false");
    case "integer": {
      const value = Number(text.trim());
      return /^-?\d+$/.test(text.trim()) && safe(value)
        ? done({ kind: "integer", value })
        : fail("Use a whole number, for example 4");
    }
    case "decimal":
      return /^-?\d+(\.\d+)?$/.test(text.trim())
        ? done({ kind: "decimal", text: text.trim() })
        : fail("Use a number, for example 0.5");
    case "memory": {
      const value = readMemoryText(text);
      return value ? done(value) : fail(UNIT_HINT("8.GB"));
    }
    case "duration": {
      const value = readDurationText(text);
      return value ? done(value) : fail(UNIT_HINT("2.h"));
    }
    case "stringList":
      return done({
        kind: "stringList",
        values: text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      });
    case "map":
      return fail("Edit each field of the map on its own");
    case "code":
      return fail("This value can't be edited in the form. Edit it in code");
  }
}

/** The text a field shows for `value`; `parseValueText` reads it back. */
export function valueText(value: ConfigValue): string {
  switch (value.kind) {
    case "string":
      return value.value;
    case "boolean":
      return String(value.value);
    case "integer":
      return String(value.value);
    case "decimal":
      return value.text;
    case "memory":
    case "duration":
      return `${value.amount}.${value.unit}`;
    case "stringList":
      return value.values.join("\n");
    case "map":
      return value.entries
        .map((e) => `${e.key}: ${valueText(e.value)}`)
        .join("\n");
  }
}
