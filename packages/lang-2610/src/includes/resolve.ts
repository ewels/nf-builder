// Ported from nextflow-io/nextflow v26.10.7 (Apache-2.0; see ../../grammar/NOTICE):
// - modules/nf-lang/src/main/java/nextflow/script/control/ResolveIncludeVisitor.java `visitInclude` (L90-L141)
// - .../script/control/ModuleResolver.java `isLocalModule` (L139), `getIncludeUri` (L150), `getLocalIncludeUri` (L172-L181)
// - .../module/spi/RemoteModuleResolver.java `resolveBaseDir` (L61), `isVendoredModuleDir` (L93)
// - .../module/spi/FallbackRemoteModuleResolver.java (L34)
// - modules/nextflow/src/main/groovy/nextflow/module/ModuleReference.groovy (pattern L37, `parse`)
// - .../module/ModuleResolver.groovy L60 and InstalledModule.groovy L53 (main.nf and meta.yml are both required)
// - .../config/control/ResolveIncludeVisitor.java `visitConfigInclude` (L65), `getIncludeUri` (L78)
// Pure: reads the project only through `ProjectTree`, never throws. The two registry messages for a module that is not
// installed are ours: nf-lang would download it or abort (F-105 plan, open point 3).
import type {
  Expression,
  IncludeTarget,
  ProjectTree,
} from "@nf-builder/lang-core";
import { dirname, joinPath, resolvePath } from "./paths.ts";

/** ModuleReference.groovy `MODULE_NAME_PATTERN`. */
export const MODULE_REFERENCE =
  /^([a-z0-9][a-z0-9._-]*)\/([a-z][a-z0-9._-]*(?:\/[a-z][a-z0-9._-]*)*)$/;

const missing = (
  path: string | null,
  message: string,
  module: string | null = null,
): IncludeTarget => ({ kind: "missing", path, module, message });

const invalidSource = (path: string) => `Invalid include source: '${path}'`;

/** ModuleResolver.isLocalModule */
const isLocalModule = (source: string) =>
  source.startsWith("/") || source.startsWith("./") || source.startsWith("../");

/**
 * RemoteModuleResolver.resolveBaseDir: the including script's own directory when it lies in a `modules/` directory
 * (nested vendoring), else the project root ("").
 */
export function registryBase(from: string): string {
  const dir = dirname(from);
  const segments = dir.split("/");
  if (dir.startsWith("/") || segments[0] === "..") return "";
  return segments.includes("modules") ? dir : "";
}

/**
 * `Files.isDirectory` on the path as `Path.resolve` leaves it, before `normalize()`: a `..` after a component needs that
 * component to exist, as the filesystem resolves it. A path that leaves the project never exists.
 */
function isDirectoryRaw(
  tree: ProjectTree,
  dir: string,
  source: string,
): boolean {
  if (source.startsWith("/")) return tree.isDirectory(resolvePath(dir, source));
  const stack = dir.split("/").filter((p) => p !== "");
  const known = stack.length; // the including file's own directories exist
  for (const part of source.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") stack.push(part);
    else if (stack.length > 0 && stack[stack.length - 1] !== "..") {
      if (stack.length > known && !tree.isDirectory(stack.join("/")))
        return false;
      stack.pop();
    } else stack.push("..");
  }
  return tree.isDirectory(stack.join("/"));
}

export function scriptInclude(
  from: string,
  source: string,
  tree: ProjectTree,
): IncludeTarget {
  if (source.startsWith("plugin/")) {
    return { kind: "plugin", plugin: source.slice("plugin/".length) };
  }
  if (isLocalModule(source)) {
    const resolved = resolvePath(dirname(from), source);
    const target = isDirectoryRaw(tree, dirname(from), source)
      ? joinPath(resolved, "main.nf")
      : source.endsWith(".nf")
        ? resolved
        : `${resolved}.nf`;
    return tree.isFile(target)
      ? { kind: "file", path: target, module: null }
      : missing(target, invalidSource(target));
  }
  if (source === "") return missing(null, "Module reference cannot be empty");
  const reference = source.trim();
  if (isLocalModule(reference)) {
    return missing(
      null,
      `Invalid module reference: '${reference}' -- expected a registry module (scope/name), not a local path`,
    );
  }
  if (!MODULE_REFERENCE.test(reference)) {
    return missing(
      null,
      `Invalid module reference: '${reference}'. Expected format: scope/name where scope is lowercase alphanumeric with dots/underscores/hyphens and name is lowercase alphanumeric with underscores/hyphens, optionally with slash-separated segments`,
    );
  }
  const main = joinPath(registryBase(from), "modules", reference, "main.nf");
  if (!tree.isFile(main)) {
    return missing(
      main,
      `Module '${reference}' is not in the project: '${main}' does not exist`,
      reference,
    );
  }
  const meta = joinPath(dirname(main), "meta.yml");
  if (!tree.isFile(meta)) {
    return missing(
      meta,
      `Module '${reference}' is incomplete: '${meta}' does not exist`,
      reference,
    );
  }
  return { kind: "file", path: main, module: reference };
}

/** Groovy `ConstantExpression.getText()`: the value of a string, number, boolean or null constant; null for anything else. */
function constantText(e: Expression): string | null {
  switch (e.kind) {
    case "String":
      return e.value;
    case "Boolean":
      return String(e.value);
    case "Null":
      return "null";
    case "Number": {
      const t = e.text.replaceAll("_", "");
      if (/^0[xXbB]/.test(t))
        return BigInt(t.replace(/[lLiIgG]$/, "")).toString();
      return t.replace(/[lLiIgGfFdD]$/, "");
    }
    default:
      return null;
  }
}

export function configInclude(
  from: string,
  source: Expression,
  tree: ProjectTree,
): IncludeTarget {
  let expression = source;
  while (expression.kind === "Parenthesized") {
    expression = expression.expression;
  }
  const value = constantText(expression);
  if (value === null) return { kind: "external" };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  let path: string;
  if (scheme) {
    if (scheme[1]?.toLowerCase() !== "file") return { kind: "external" };
    path = resolvePath("", value.replace(/^file:(\/\/)?/i, ""));
  } else {
    path = resolvePath(dirname(from), value);
  }
  return tree.isFile(path)
    ? { kind: "file", path, module: null }
    : missing(path, invalidSource(path));
}
