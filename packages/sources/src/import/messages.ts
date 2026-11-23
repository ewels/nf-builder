import {
  formatBytes,
  formatCount,
  IMPORT_LIMITS,
  type ImportLimits,
} from "./limits.ts";
import type { ImportRefusal, ImportRefusalCode } from "./types.ts";

export interface RefusalDetail {
  readonly size?: number;
  readonly path?: string;
  readonly cause?: string;
}

export function refuse(
  code: ImportRefusalCode,
  detail: RefusalDetail = {},
  limits: ImportLimits = IMPORT_LIMITS,
): ImportRefusal {
  return { ok: false, code, message: message(code, detail, limits) };
}

function message(
  code: ImportRefusalCode,
  detail: RefusalDetail,
  limits: ImportLimits,
): string {
  switch (code) {
    case "too-big":
      return `This zip is ${formatBytes(detail.size ?? 0)}. Imports take zips of up to ${formatBytes(limits.maxArchiveBytes)}.`;
    case "too-many-entries":
      return `This zip has more than ${formatCount(limits.maxEntries)} files and folders. Imports take up to ${formatCount(limits.maxEntries)}.`;
    case "too-large-uncompressed":
      return `This zip expands to more than ${formatBytes(limits.maxTotalBytes)}. Imports take up to ${formatBytes(limits.maxTotalBytes)} uncompressed.`;
    case "not-zip":
      return "This file isn't a zip archive, or it is damaged.";
    case "damaged":
      return detail.cause === undefined
        ? `This zip is damaged: ${detail.path ?? "an entry"} doesn't match its recorded size.`
        : `This zip couldn't be unpacked at ${detail.path ?? "an entry"} (${detail.cause}). It may be damaged or password-protected.`;
    case "too-slow":
      return `This zip took more than ${limits.unpackMs / 1000} seconds to unpack and was stopped. It may be damaged.`;
    case "gone":
      return "That import is no longer available. Choose the zip file again.";
  }
}
