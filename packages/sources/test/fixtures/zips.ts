import { type ZipOptions, zipSync } from "fflate";

type Content = string | Uint8Array | [Uint8Array, { level: 0 | 1 | 6 }];
type ZipFiles = Record<string, Content>;

const text = new TextEncoder();

/** A zip of the given files (fflate `zipSync`). A name ending in `/` is a folder entry. */
export function zipOf(
  files: ZipFiles,
  options: { comment?: string } = {},
): Uint8Array {
  const zippable: Record<string, Uint8Array | [Uint8Array, ZipOptions]> = {};
  for (const [name, content] of Object.entries(files)) {
    zippable[name] =
      typeof content === "string"
        ? text.encode(content)
        : content instanceof Uint8Array
          ? content
          : [content[0], { level: content[1].level }];
  }
  const zip = zipSync(zippable);
  const comment = text.encode(options.comment ?? "");
  if (comment.length === 0) return zip;
  // the end-of-central-directory record has no comment yet: its last two bytes are the comment length
  const out = new Uint8Array(zip.length + comment.length);
  out.set(zip);
  out.set(comment, zip.length);
  view(out).setUint16(zip.length - 2, comment.length, true);
  return out;
}

const view = (zip: Uint8Array) =>
  new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

function findHeaders(
  zip: Uint8Array,
  name: string,
): { central: number; local: number } {
  const v = view(zip);
  const want = text.encode(name);
  const matches = (at: number, nameAt: number, lenAt: number): boolean => {
    if (v.getUint16(at + lenAt, true) !== want.length) return false;
    return want.every((b, i) => zip[at + nameAt + i] === b);
  };
  let central = -1;
  let local = -1;
  for (let i = 0; i + 46 <= zip.length; i += 1) {
    if (
      v.getUint32(i, true) === 0x02014b50 &&
      central < 0 &&
      matches(i, 46, 28)
    ) {
      central = i;
      local = v.getUint32(i + 42, true);
    }
  }
  if (central < 0) throw new Error(`no entry named ${name}`);
  return { central, local };
}

/** Rewrites the uncompressed size recorded for one entry, in its central record and local header. */
export function withRecordedSizes(
  zip: Uint8Array,
  name: string,
  sizes: { originalSize: number },
): Uint8Array {
  const out = zip.slice();
  const v = view(out);
  const { central, local } = findHeaders(out, name);
  v.setUint32(central + 24, sizes.originalSize, true);
  v.setUint32(local + 22, sizes.originalSize, true);
  return out;
}

/** Rewrites the compression method of one entry. */
export function withCompression(
  zip: Uint8Array,
  name: string,
  method: number,
): Uint8Array {
  const out = zip.slice();
  const v = view(out);
  const { central, local } = findHeaders(out, name);
  v.setUint16(central + 10, method, true);
  v.setUint16(local + 8, method, true);
  return out;
}

/** Sets the general-purpose flag bits of one entry (bit 0 marks it as encrypted). */
export function withFlags(
  zip: Uint8Array,
  name: string,
  flags: number,
): Uint8Array {
  const out = zip.slice();
  const v = view(out);
  const { central, local } = findHeaders(out, name);
  v.setUint16(central + 8, flags, true);
  v.setUint16(local + 6, flags, true);
  return out;
}

/** Replaces every occurrence of one entry name with another of the same length. */
export function renameEntry(
  zip: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  const a = text.encode(from);
  const b = text.encode(to);
  if (a.length !== b.length) throw new Error("names must have the same length");
  const out = zip.slice();
  for (let i = 0; i + a.length <= out.length; i += 1) {
    if (a.every((byte, k) => out[i + k] === byte)) out.set(b, i);
  }
  return out;
}

/** A one-entry zip around data that is already compressed, with any recorded original size. */
export function rawEntryZip(
  name: string,
  data: Uint8Array,
  options: { method: 0 | 8; originalSize: number },
): Uint8Array {
  const nameBytes = text.encode(name);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = view(local);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint16(8, options.method, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, options.originalSize, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = view(central);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, options.method, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, options.originalSize, true);
  cv.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = view(end);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const zip = new Uint8Array(
    local.length + data.length + central.length + end.length,
  );
  zip.set(local, 0);
  zip.set(data, local.length);
  zip.set(central, local.length + data.length);
  zip.set(end, local.length + data.length + central.length);
  return zip;
}
