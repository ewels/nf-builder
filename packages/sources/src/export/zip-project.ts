import { type Zippable, zipSync } from "fflate";

export interface ExportEntry {
  readonly path: string;
  readonly text: string;
}

export interface ZipProjectOptions {
  /** The one folder every entry sits under, so re-import (IO-11) strips exactly it. */
  readonly folder: string;
  /** Milliseconds since the epoch; defaults to now. */
  readonly mtime?: number;
}

const EXECUTABLE = 0o100755;
const PLAIN = 0o100644;

/**
 * The Unix mode of an exported file (ADR 0057): files under the root `bin/` are executable, and so are
 * module binaries in `resources/usr/bin/`. "Only executable scripts in resources/usr/bin/ are made
 * accessible to the process script", checked at
 * https://docs.seqera.io/nextflow/modules/developing-modules (module binaries).
 */
export function exportMode(path: string): number {
  return path.startsWith("bin/") || /(^|\/)resources\/usr\/bin\//.test(path)
    ? EXECUTABLE
    : PLAIN;
}

/** A zip of the project's text files under one folder, UTF-8 names, no folder entries (F-404, IO-20). */
export function zipProject(
  files: readonly ExportEntry[],
  options: ZipProjectOptions,
): Uint8Array {
  const encoder = new TextEncoder();
  const mtime = options.mtime ?? Date.now();
  const zippable: Zippable = {};
  for (const file of files) {
    zippable[`${options.folder}/${file.path}`] = [
      encoder.encode(file.text),
      { os: 3, attrs: exportMode(file.path) << 16, mtime },
    ];
  }
  return zipSync(zippable);
}
