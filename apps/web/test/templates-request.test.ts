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

describe("F-203 the template list follows the chosen version", () => {
  it("F-203: currentState keeps a result only for the version and attempt now wanted", async () => {
    const { currentState } = await import("../src/project/templates");
    const result = {
      status: "ready" as const,
      list: { version: "26.10", templates: [] } as never,
    };
    const loaded = { version: "26.10", attempt: 0, result };
    expect(currentState(loaded, "26.10", 0)).toBe(result);
    expect(currentState(loaded, "26.04", 0)).toEqual({ status: "loading" });
    expect(currentState(loaded, "26.10", 1)).toEqual({ status: "loading" });
    expect(currentState(loaded, undefined, 0)).toEqual({ status: "loading" });
    expect(currentState(undefined, "26.10", 0)).toEqual({ status: "loading" });
  });
});
