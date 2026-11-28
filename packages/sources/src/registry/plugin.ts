import type {
  PluginConfigChild,
  PluginDefinition,
  SnapshotPluginFile,
} from "@nf-builder/lang-core";
import { RegistryError } from "./errors.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isName = (v: unknown): boolean => typeof v === "string" && v !== "";

function isTypeRef(v: unknown): boolean {
  if (typeof v === "string") return v !== "";
  if (!isObj(v) || !isName(v.name)) return false;
  return (
    v.typeArguments === undefined ||
    (Array.isArray(v.typeArguments) && v.typeArguments.every(isTypeRef))
  );
}

/** The scope with its malformed children dropped, or null when the scope itself is malformed. */
function cleanScope(spec: unknown): Obj | null {
  if (!isObj(spec) || !isName(spec.name)) return null;
  if (spec.children === undefined) return spec;
  if (!Array.isArray(spec.children)) return null;
  const children = spec.children.flatMap((c: unknown) => {
    if (!isObj(c)) return [];
    if (c.type === "ConfigScope") {
      const inner = cleanScope(c.spec);
      return inner ? [{ ...c, spec: inner }] : [];
    }
    const o = c.spec;
    const ok =
      c.type === "ConfigOption" &&
      isObj(o) &&
      isName(o.name) &&
      isTypeRef(o.type) &&
      (o.additionalTypes === undefined ||
        (Array.isArray(o.additionalTypes) &&
          o.additionalTypes.every(isTypeRef)));
    return ok ? [c] : [];
  });
  return { ...spec, children: children as PluginConfigChild[] };
}

function cleanDefinition(d: unknown): PluginDefinition | null {
  if (!isObj(d)) return null;
  if (d.type === "ConfigScope") {
    const spec = cleanScope(d.spec);
    return spec ? ({ ...d, spec } as unknown as PluginDefinition) : null;
  }
  if (d.type !== "Function" && d.type !== "Operator" && d.type !== "Factory")
    return null;
  const f = d.spec;
  if (!isObj(f) || !isName(f.name)) return null;
  if (f.returnType !== undefined && !isTypeRef(f.returnType)) return null;
  if (f.parameters !== undefined) {
    if (!Array.isArray(f.parameters)) return null;
    if (
      !f.parameters.every(
        (p) => isObj(p) && isName(p.name) && isTypeRef(p.type),
      )
    )
      return null;
  }
  return d as unknown as PluginDefinition;
}

/** Throws RegistryError("invalid") unless format 1 for exactly this id and version, with a definitions array; malformed definitions are dropped. */
export function parsePluginFile(
  value: unknown,
  url: string,
  id: string,
  version: string,
): SnapshotPluginFile {
  const o = value as Record<string, unknown> | null;
  const bad = (why: string) =>
    new RegistryError("invalid", url, `Registry plugin spec ${why}.`);
  if (typeof o !== "object" || o === null) throw bad("is not an object");
  if (o.format !== 1) throw bad(`has format ${String(o.format)}, not 1`);
  if (o.id !== id) throw bad(`is for ${String(o.id)}, not ${id}`);
  if (o.version !== version) {
    throw bad(`is for version ${String(o.version)}, not ${version}`);
  }
  if (!Array.isArray(o.definitions)) throw bad("has no definitions list");
  // a malformed definition is dropped rather than failing the whole spec: the palette reads every field it keeps
  const definitions = o.definitions.flatMap((d: unknown) => {
    const clean = cleanDefinition(d);
    return clean ? [clean] : [];
  });
  return { ...o, definitions } as unknown as SnapshotPluginFile;
}
