import type { RegistrySnapshotPorts } from "@nf-builder/lang-core";
import { RegistryError } from "./errors.ts";

/** Throws RegistryError("invalid") unless format 1 with a string generatedAt and a modules object. */
export function parseSnapshotPorts(
  value: unknown,
  url: string,
): RegistrySnapshotPorts {
  const o = value as Record<string, unknown> | null;
  const bad = (why: string) =>
    new RegistryError("invalid", url, `Registry ports ${why}.`);
  if (typeof o !== "object" || o === null) throw bad("is not an object");
  if (o.format !== 1) throw bad(`has format ${String(o.format)}, not 1`);
  if (typeof o.generatedAt !== "string") throw bad("has no generatedAt");
  if (
    typeof o.modules !== "object" ||
    o.modules === null ||
    Array.isArray(o.modules)
  ) {
    throw bad("has no modules object");
  }
  return o as unknown as RegistrySnapshotPorts;
}
