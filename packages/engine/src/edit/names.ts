// Names and paths for edit commands (LA-12, F-111).
import {
  type ScriptCatalogue,
  type WorkflowDef,
  walk,
} from "@nf-builder/lang-core";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isIdentifier = (name: string): boolean => IDENTIFIER.test(name);

/** `base`, else `base_2`, `base_3`, until the name isn't in `taken`. */
export function freshName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Names a new variable must not shadow: the pack's global constants and functions, and the script-scope ones it doesn't list. */
export function builtinNames(catalogue: ScriptCatalogue): Set<string> {
  return new Set([
    ...catalogue.constants.map((c) => c.name),
    ...catalogue.functions.map((f) => f.name),
    "params",
    "Channel",
    "task",
  ]);
}

/** Every variable a workflow reads or declares, and its take names. */
export function namesInWorkflow(def: WorkflowDef): Set<string> {
  const names = new Set<string>();
  walk(def, (node) => {
    const n = node as unknown as Record<string, unknown>;
    if (node.kind === "Variable") names.add(n.name as string);
    if (node.kind === "TypedName") names.add((n.name as { name: string }).name);
    return undefined;
  });
  return names;
}

/** The directory of a new local module: lower case, as nf-core and the registry name them (LA-12). */
export const moduleDirectory = (name: string): string =>
  `modules/local/${name.toLowerCase()}`;

/** The include source for `toPath` as written in the script at `fromPath`: `./x/y.nf` or `../x/y.nf`. */
export function relativeSource(fromPath: string, toPath: string): string {
  const from = fromPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  let common = 0;
  while (
    common < from.length &&
    common < to.length - 1 &&
    from[common] === to[common]
  )
    common += 1;
  const up = from.length - common;
  const rest = to.slice(common).join("/");
  return up === 0 ? `./${rest}` : `${"../".repeat(up)}${rest}`;
}
