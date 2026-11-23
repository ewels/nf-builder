import { unzipSync } from "fflate";
import { IMPORT_LIMITS, type ImportLimits } from "../import/limits.ts";
import { refuse } from "../import/messages.ts";
import {
  type EntryPath,
  entryPath,
  stripFolder,
  topFolder,
} from "../import/paths.ts";
import { decodeText } from "../import/text.ts";
import type {
  FixedSkipReason,
  ImportCandidate,
  ImportRefusal,
  ImportRefusalCode,
} from "../import/types.ts";

export interface ZipRead {
  readonly ok: true;
  /** Central-directory records: files, folders and `__MACOSX/` entries. */
  readonly entries: number;
  readonly stripped: string | null;
  readonly candidates: readonly ImportCandidate[];
}

export interface ReadZipOptions {
  readonly limits?: ImportLimits;
  readonly now?: () => number;
}

/** The smallest possible zip is an end-of-central-directory record of 22 bytes. */
const MIN_ZIP_BYTES = 22;
const PLAUSIBLE_SLACK = 1024;

interface ZipRecord {
  readonly name: string;
  readonly size: number;
  readonly originalSize: number;
  readonly compression: number;
}

class Breach extends Error {
  readonly code: ImportRefusalCode;
  readonly path: string | undefined;
  constructor(code: ImportRefusalCode, path?: string) {
    super(code);
    this.code = code;
    this.path = path;
  }
}

export function checkArchiveSize(
  size: number,
  limits: ImportLimits = IMPORT_LIMITS,
): ImportRefusal | null {
  if (size < MIN_ZIP_BYTES) return refuse("not-zip", {}, limits);
  if (size > limits.maxArchiveBytes) return refuse("too-big", { size }, limits);
  return null;
}

/** Pass 1: the central directory only. Nothing is inflated. */
function listRecords(bytes: Uint8Array, limits: ImportLimits): ZipRecord[] {
  const records: ZipRecord[] = [];
  let total = 0;
  unzipSync(bytes, {
    filter: (info) => {
      if (records.length >= limits.maxEntries)
        throw new Breach("too-many-entries");
      total += info.originalSize;
      if (total > limits.maxTotalBytes)
        throw new Breach("too-large-uncompressed");
      records.push({
        name: info.name,
        size: info.size,
        originalSize: info.originalSize,
        compression: info.compression,
      });
      return false;
    },
  });
  return records;
}

const isUnsafeFolder = (
  record: ZipRecord | undefined,
  path: EntryPath,
): boolean => path.kind === "unsafe" && /[/\\]$/.test(record?.name ?? "");

/** A deflated entry can't honestly be much bigger than its content; a stored one is the same size. */
function plausible(record: ZipRecord): boolean {
  return record.compression === 0
    ? record.size === record.originalSize
    : record.size <=
        record.originalSize + record.originalSize / 8 + PLAUSIBLE_SLACK;
}

interface Planned {
  readonly path: string;
  readonly size: number;
  readonly reason: FixedSkipReason | null;
  /** The record's raw name when it is to be inflated. */
  readonly inflate: string | null;
}

export function readZip(
  bytes: Uint8Array,
  options: ReadZipOptions = {},
): ZipRead | ImportRefusal {
  const limits = options.limits ?? IMPORT_LIMITS;
  const now = options.now ?? Date.now;
  const started = now();
  let last: string | undefined;
  try {
    const records = (() => {
      try {
        return listRecords(bytes, limits);
      } catch (error) {
        if (error instanceof Breach) throw error;
        throw new Breach("not-zip");
      }
    })();

    const parsed: EntryPath[] = records.map((record) => entryPath(record.name));
    // An unsafe folder entry holds no file, so it needs no row of its own.
    const stripped = topFolder(
      parsed.filter((p, i) => !isUnsafeFolder(records[i], p)),
    );

    const planned: Planned[] = [];
    const seen = new Set<string>();
    const admit = new Set<number>();
    for (const [index, record] of records.entries()) {
      const path = parsed[index] as EntryPath;
      if (path.kind === "folder" || isUnsafeFolder(record, path)) continue;
      if (path.kind === "unsafe") {
        planned.push({
          path: path.path,
          size: record.originalSize,
          reason: "unsafe-path",
          inflate: null,
        });
        continue;
      }
      const stripPath = stripFolder(path.path, stripped);
      const skip = (reason: FixedSkipReason): void => {
        planned.push({
          path: stripPath,
          size: record.originalSize,
          reason,
          inflate: null,
        });
      };
      if (seen.has(stripPath)) {
        skip("duplicate");
        continue;
      }
      seen.add(stripPath);
      if (record.compression !== 0 && record.compression !== 8)
        skip("unsupported");
      else if (record.originalSize > limits.maxTextFileBytes) skip("too-large");
      else if (!plausible(record)) throw new Breach("damaged", stripPath);
      else {
        admit.add(index);
        planned.push({
          path: stripPath,
          size: record.originalSize,
          reason: null,
          inflate: record.name,
        });
      }
    }

    // Pass 2: inflate the admitted records, each into a buffer of its recorded size.
    let position = -1;
    const files = unzipSync(bytes, {
      filter: (info) => {
        position += 1;
        if (!admit.has(position)) return false;
        last = info.name;
        if (now() - started > limits.unpackMs) throw new Breach("too-slow");
        return true;
      },
    });

    const candidates: ImportCandidate[] = planned.map((p) => {
      if (p.inflate === null)
        return { path: p.path, size: p.size, text: null, reason: p.reason };
      const data = Object.hasOwn(files, p.inflate)
        ? files[p.inflate]
        : undefined;
      if (data === undefined)
        return { path: p.path, size: p.size, text: null, reason: "binary" };
      const text = decodeText(data);
      return {
        path: p.path,
        size: data.length,
        text,
        reason: text === null ? "binary" : null,
      };
    });
    candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ok: true, entries: records.length, stripped, candidates };
  } catch (error) {
    if (error instanceof Breach) {
      return refuse(error.code, { path: error.path }, limits);
    }
    const cause = error instanceof Error ? error.message : "unknown error";
    return refuse("damaged", { path: last ?? "an entry", cause }, limits);
  }
}
