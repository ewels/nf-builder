import { afterEach, describe, expect, it, vi } from "vitest";

const palette = vi.fn();
vi.mock("../src/engine/engine-client", () => ({
  getEngine: () => ({ palette }),
}));

afterEach(() => {
  palette.mockReset();
  vi.resetModules();
});

describe("F-202 palette request", () => {
  it("F-202 ADR-0028: requestPaletteView sends one request per version and forgets a rejected one", async () => {
    const { requestPaletteView } = await import(
      "../src/palette/use-palette-view"
    );
    palette.mockResolvedValue({ groups: [] });
    const a = requestPaletteView("26.10");
    const b = requestPaletteView("26.10");
    expect(a).toBe(b);
    await a;
    await requestPaletteView("26.04");
    expect(palette).toHaveBeenCalledTimes(2);
    expect(palette).toHaveBeenCalledWith("26.10");
    expect(palette).toHaveBeenCalledWith("26.04");
    // a rejected request is forgotten, so the next call asks again
    palette.mockReset();
    palette.mockRejectedValueOnce(new Error("worker failed"));
    palette.mockResolvedValueOnce({ groups: ["ok"] });
    await expect(requestPaletteView("27.01")).rejects.toThrow("worker failed");
    await expect(requestPaletteView("27.01")).resolves.toEqual({
      groups: ["ok"],
    });
    expect(palette).toHaveBeenCalledTimes(2);
  });
});
