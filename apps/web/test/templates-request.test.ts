import { afterEach, describe, expect, it, vi } from "vitest";

const templates = vi.fn();
vi.mock("../src/engine/engine-client", () => ({
  getEngine: () => ({ templates }),
}));

afterEach(() => {
  templates.mockReset();
  vi.resetModules();
});

describe("F-203 templates request", () => {
  it("F-203: requestTemplates sends one request per version and forgets a rejected one", async () => {
    const { requestTemplates } = await import("../src/project/templates");
    templates.mockResolvedValue({ version: "26.10", templates: [] });
    const a = requestTemplates("26.10");
    const b = requestTemplates("26.10");
    expect(a).toBe(b);
    await a;
    await requestTemplates("26.04");
    expect(templates).toHaveBeenCalledTimes(2);
    templates.mockReset();
    templates.mockRejectedValueOnce(new Error("worker failed"));
    templates.mockResolvedValueOnce({ version: "27.01", templates: ["ok"] });
    await expect(requestTemplates("27.01")).rejects.toThrow("worker failed");
    await expect(requestTemplates("27.01")).resolves.toEqual({
      version: "27.01",
      templates: ["ok"],
    });
    expect(templates).toHaveBeenCalledTimes(2);
  });
});
