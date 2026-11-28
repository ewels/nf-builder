export interface CentralEntry {
  readonly name: string;
  /** The creator OS in "version made by" (3 is Unix). */
  readonly os: number;
  /** The Unix file mode held in the high half of the external attributes. */
  readonly mode: number;
  /** General-purpose flag bit 11: the name is UTF-8. */
  readonly utf8: boolean;
}

/** The central directory of a zip, read by hand (F-404): fflate's reader doesn't expose attributes. */
export function centralEntries(bytes: Uint8Array): CentralEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50)
      throw new Error("bad central header");
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    out.push({
      name: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ),
      os: v.getUint16(at + 4, true) >>> 8,
      mode: v.getUint32(at + 38, true) >>> 16,
      utf8: (v.getUint16(at + 8, true) & 0x800) !== 0,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
