// Ported from nextflow-io/nextflow v26.10.7 (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE):
// `nextflow.script.dsl.Types.getName` and `typeName` (L277-L372 and L398-L402) and `Formatter.hasType` (L966-L987),
// except that type names are printed as written, not renamed through the Java class hierarchy (ADR 0005, plan F-110
// 4.5: known difference `type-rename`).
import type { LegacyType, TypeRef, Wildcard } from "@nf-builder/lang-core";

/** The receivers `Types.isNamespace` accepts: the catalogue constants of a `Namespace` type. */
export const NAMESPACES: ReadonlySet<string> = new Set([
  "channel",
  "log",
  "nextflow",
  "workflow",
]);

const isObject = (type: TypeRef) =>
  type.name === "Object" || type.name === "java.lang.Object";

/** `Types.getName(String)`: `Object` prints as `?`. */
const argumentName = (arg: TypeRef | Wildcard): string =>
  arg.kind === "Wildcard" ? "?" : isObject(arg) ? "?" : typeName(arg);

/** A type as written, with its arguments separated by ", " and a trailing `?` when nullable. */
export function typeName(type: TypeRef): string {
  const args =
    type.typeArguments.length > 0
      ? `<${type.typeArguments.map(argumentName).join(", ")}>`
      : "";
  return `${type.name}${args}${type.nullable ? "?" : ""}`;
}

/** `Formatter.hasType`: `Object` is equivalent to no type annotation. */
export function hasType(type: TypeRef | null): type is TypeRef {
  return type !== null && !isObject(type);
}

const legacyArgument = (arg: TypeRef | Wildcard): string =>
  arg.kind === "Wildcard" ? "?" : legacyName(arg);

const legacyName = (type: TypeRef): string => {
  const args =
    type.typeArguments.length > 0
      ? `<${type.typeArguments.map(legacyArgument).join(",")}>`
      : "";
  return `${type.name}${args}`;
};

/** The text of a legacy annotation (`LEGACY_TYPE` metadata): as written, without whitespace. */
export function legacyTypeText(type: LegacyType): string {
  return legacyName(type.type) + "[]".repeat(type.dimensions);
}

/** `Formatter.hasType` for a legacy annotation: one that has no modern equivalent (`Object`, an array) is skipped. */
export function hasLegacyType(type: LegacyType | null): type is LegacyType {
  return type !== null && type.dimensions === 0 && !isObject(type.type);
}

/** The default imports of a Groovy script: its classes need no package. */
const DEFAULT_PACKAGES = new Set([
  "java.lang",
  "java.util",
  "java.io",
  "java.net",
  "groovy.lang",
  "groovy.util",
]);
const DEFAULT_CLASSES = new Set([
  "java.math.BigInteger",
  "java.math.BigDecimal",
]);

/**
 * The type of a `catch` clause. Upstream drops the package of every type (`getNameWithoutPackage`), which can leave an
 * undefined name; the printer drops it only for default imports, where the class stays the same (known difference
 * `catch-package`).
 */
export function catchTypeName(type: TypeRef): string {
  const dot = type.name.lastIndexOf(".");
  if (dot < 0) return typeName(type);
  const pkg = type.name.slice(0, dot);
  if (!DEFAULT_PACKAGES.has(pkg) && !DEFAULT_CLASSES.has(type.name))
    return typeName(type);
  return typeName({ ...type, name: type.name.slice(dot + 1) });
}
