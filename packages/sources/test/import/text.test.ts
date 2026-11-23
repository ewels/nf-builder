import { describe, expect, it } from "vitest";
import { decodeText, SNIFF_BYTES } from "../../src/import/text";

const enc = new TextEncoder();

describe("import text check", () => {
  it("F-403 IO-12: a NUL in the first 8,000 bytes or invalid UTF-8 makes a file binary; a NUL after byte 8,000 doesn't", () => {
    expect(SNIFF_BYTES).toBe(8000);
    expect(decodeText(enc.encode("process X {}\n"))).toBe("process X {}\n");
    expect(decodeText(new Uint8Array([97, 0, 98]))).toBeNull();
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    const late = new Uint8Array(8001).fill(97);
    late[8000] = 0;
    expect(decodeText(late)).toBe(`${"a".repeat(8000)}\u0000`);
    const early = new Uint8Array(8001).fill(97);
    early[7999] = 0;
    expect(decodeText(early)).toBeNull();
    expect(decodeText(new Uint8Array())).toBe("");
  });

  it("F-403 IO-20: a BOM and CRLF line endings are kept, so the text re-encodes to the same bytes", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...enc.encode("a\r\nb\r\n"),
    ]);
    const text = decodeText(bytes);
    expect(text).toBe("\uFEFFa\r\nb\r\n");
    expect(enc.encode(text ?? "")).toEqual(bytes);
  });
});
