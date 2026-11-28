import type { SnapshotPluginFile } from "@nf-builder/lang-core";
import { RegistryError } from "./errors.ts";

/** Throws RegistryError("invalid") unless format 1 for exactly this id and version, with a definitions array. */
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
  return o as unknown as SnapshotPluginFile;
}
