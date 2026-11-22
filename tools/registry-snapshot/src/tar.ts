import { gunzipSync } from "node:zlib";
import type { SnapshotFile } from "@nf-builder/lang-core";

const BLOCK = 512;
/** The largest module is about 150 kB of text; a bundle expanding past this is not a module. */
const MAX_TAR_BYTES = 64 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const latin = new TextDecoder("latin1");

const cString = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  return utf8.decode(end < 0 ? bytes : bytes.subarray(0, end));
};

/** Pax records: "<len> <key>=<value>\n", one after another. */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const length = Number(latin.decode(data.subarray(at, space)));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = utf8.decode(data.subarray(space + 1, at + length - 1));
    const eq = record.indexOf("=");
    records.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return records;
}

function checkPath(path: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path))
    throw new Error(`tar: absolute path ${path}`);
  if (path.split("/").includes(".."))
    throw new Error(`tar: path with '..' segment ${path}`);
  return path.replace(/^(\.\/)+/, "");
}

/**
 * Every regular file of a module's tar.gz (IO-31): ustar headers, pax `path` and GNU `L` long names. Rejects absolute
 * and `..` paths, links and devices. Content that is not valid UTF-8 becomes `base64`. Sorted by path.
 */
export function readModuleTarGz(bytes: Uint8Array): SnapshotFile[] {
  const tar = new Uint8Array(
    gunzipSync(bytes, { maxOutputLength: MAX_TAR_BYTES }),
  );
  const files: SnapshotFile[] = [];
  let pax = new Map<string, string>();
  let longName: string | null = null;
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break;
    const sizeField = cString(header.subarray(124, 136)).trim() || "0";
    if (!/^[0-7]+$/.test(sizeField))
      throw new Error(`tar: invalid size field ${JSON.stringify(sizeField)}`);
    const size = Number.parseInt(sizeField, 8);
    if (at + BLOCK + size > tar.length)
      throw new Error("tar: truncated archive");
    const type = String.fromCharCode(header[156] || 0x30);
    const data = tar.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      pax = paxRecords(data);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = cString(data);
      continue;
    }
    const prefix = cString(header.subarray(345, 500));
    const own = cString(header.subarray(0, 100));
    const name =
      pax.get("path") ?? longName ?? (prefix ? `${prefix}/${own}` : own);
    pax = new Map();
    longName = null;

    if (type === "1" || type === "2")
      throw new Error(`tar: link entry ${name}`);
    if (type === "5") {
      checkPath(name);
      continue;
    }
    if (type !== "0")
      throw new Error(
        `tar: unsupported entry type '${type}' for ${name} (device or special file)`,
      );
    const path = checkPath(name);
    try {
      files.push({ path, text: utf8.decode(data) });
    } catch {
      files.push({ path, base64: Buffer.from(data).toString("base64") });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
