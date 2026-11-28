import { describe, expect, it, vi } from "vitest";
import { downloadBytes } from "../src/project/download";

describe("F-404 download", () => {
  it("F-404: downloadBytes clicks a hidden download link to a blob URL and revokes it after 60 s", async () => {
    const link = {
      href: "",
      download: "",
      hidden: false,
      click: vi.fn(),
      remove: vi.fn(),
    };
    const doc = {
      createElement: vi.fn(() => link),
      body: { append: vi.fn() },
    } as unknown as Document;
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const timers: [() => void, number][] = [];
    downloadBytes(new Uint8Array([1, 2]), "P.zip", doc, (fn, ms) =>
      timers.push([fn, ms]),
    );
    const blob = create.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/zip");
    expect(blob.size).toBe(2);
    expect(doc.createElement).toHaveBeenCalledWith("a");
    expect(link).toMatchObject({
      href: "blob:x",
      download: "P.zip",
      hidden: true,
    });
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    expect(timers.map(([, ms]) => ms)).toEqual([60_000]);
    timers[0]?.[0]();
    expect(revoke).toHaveBeenCalledWith("blob:x");
    create.mockRestore();
    revoke.mockRestore();
  });
});
