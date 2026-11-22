import { readFileSync } from "node:fs";
import { isRecord } from "./cases.ts";
import { PIN_FILE } from "./paths.ts";

export type NextflowPin = { version: string; sha256: string };

export function distUrl(version: string): string {
  return `https://github.com/nextflow-io/nextflow/releases/download/v${version}/nextflow-${version}-dist`;
}

export function distPath(version: string, nextflowCache: string): string {
  return `${nextflowCache}/${version}/nextflow-${version}-dist`;
}

/** Reads and validates upstream.json. Throws Error("<file>: <field> ...") for a bad version, url or sha256. */
export function loadPin(file: string = PIN_FILE): NextflowPin {
  const root: unknown = JSON.parse(readFileSync(file, "utf8"));
  const nextflow = isRecord(root) ? root.nextflow : undefined;
  const dist = isRecord(root) ? root.nextflowDist : undefined;
  const version = isRecord(nextflow) ? nextflow.version : undefined;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `${file}: nextflow.version must be a string like x.y.z, got ${JSON.stringify(version)}`,
    );
  }
  const url = isRecord(dist) ? dist.url : undefined;
  if (url !== distUrl(version)) {
    throw new Error(
      `${file}: nextflowDist.url must be ${distUrl(version)}, got ${JSON.stringify(url)}`,
    );
  }
  const sha256 = isRecord(dist) ? dist.sha256 : undefined;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `${file}: nextflowDist.sha256 must be 64 lowercase hex digits, got ${JSON.stringify(sha256)}`,
    );
  }
  return { version, sha256 };
}
