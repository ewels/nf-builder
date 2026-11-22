import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readModuleTarGz } from "../src/tar.ts";
import { recordedTarGz } from "./support/recorded.ts";

/** One ustar entry (header plus padded data). */
function entry(
  name: string,
  data: Uint8Array | string = "",
  type = "0",
  linkname = "",
): Uint8Array {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const header = new Uint8Array(512);
  const put = (s: string, at: number) =>
    header.set(new TextEncoder().encode(s), at);
  put(name, 0);
  put("0000644\0", 100);
  put("0000000\0", 108);
  put("0000000\0", 116);
  put(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
  put("00000000000\0", 136);
  put("        ", 148);
  put(type, 156);
  put(linkname, 157);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const body = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  body.set(bytes);
  return Buffer.concat([header, body]);
}
const tarGz = (...entries: Uint8Array[]) =>
  new Uint8Array(gzipSync(Buffer.concat([...entries, new Uint8Array(1024)])));

describe("F-501 module tar reader", () => {
  it("F-501 IO-31: reads every regular file of the recorded fastqc bundle, honouring pax headers", async () => {
    const files = readModuleTarGz(
      await recordedTarGz("nf-core/fastqc", "0.0.0-6d1763b"),
    );
    expect(files.map((f) => f.path)).toEqual([
      ".conda-lock/linux_amd64-bd-b342db7b694c9af4_1.txt",
      ".conda-lock/linux_arm64-bd-7c8a53b986d9a000_1.txt",
      "environment.yml",
      "main.nf",
      "meta.yml",
      "tests/main.nf.test",
      "tests/main.nf.test.snap",
    ]);
    const main = files.find((f) => f.path === "main.nf");
    expect(main && "text" in main ? main.text : "").toContain("process FASTQC");
  });

  it("F-501: rejects absolute paths, .. segments, symlinks and hard links", () => {
    expect(() => readModuleTarGz(tarGz(entry("/etc/passwd", "x")))).toThrow(
      /absolute/i,
    );
    expect(() => readModuleTarGz(tarGz(entry("a/../../b", "x")))).toThrow(
      /\.\./,
    );
    expect(() =>
      readModuleTarGz(tarGz(entry("l", "", "2", "main.nf"))),
    ).toThrow(/link/i);
    expect(() =>
      readModuleTarGz(tarGz(entry("l", "", "1", "main.nf"))),
    ).toThrow(/link/i);
    expect(() => readModuleTarGz(tarGz(entry("dev", "", "3")))).toThrow(
      /device|unsupported/i,
    );
  });

  it("F-501: a non-UTF-8 file is kept as base64", () => {
    const bytes = new Uint8Array([0x03, 0xf3, 0x0d, 0x0a, 0xff]);
    const files = readModuleTarGz(
      tarGz(entry("b/mod.pyc", bytes), entry("a.txt", "hé")),
    );
    expect(files).toEqual([
      { path: "a.txt", text: "hé" },
      { path: "b/mod.pyc", base64: Buffer.from(bytes).toString("base64") },
    ]);
  });

  it("F-501: honours a GNU long name and skips directories", () => {
    const long = `${"d/".repeat(60)}file.txt`;
    const gnu = entry("././@LongLink", `${long}\0`, "L");
    const files = readModuleTarGz(
      tarGz(entry("d/", "", "5"), gnu, entry("short", "x")),
    );
    expect(files).toEqual([{ path: long, text: "x" }]);
  });
});
