import { describe, expect, it, vi } from "vitest";

const createHighlighterCore = vi.fn();
const shikiToMonaco = vi.fn();
const register = vi.fn();

vi.mock("../src/code/monaco", () => ({
  NEXTFLOW_LANGUAGE_ID: "nextflow",
  monaco: {
    languages: { register, setLanguageConfiguration: vi.fn() },
  },
}));
vi.mock("shiki/core", () => ({ createHighlighterCore }));
vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: () => ({}),
}));
vi.mock("shiki/langs/nextflow.mjs", () => ({ default: {} }));
vi.mock("shiki/themes/github-light.mjs", () => ({ default: {} }));
vi.mock("@shikijs/monaco", () => ({ shikiToMonaco }));

describe("F-208 Nextflow language", () => {
  it("F-208 UX-27 ADR-0003: a Shiki failure leaves the editor usable with plain tokens, and a later mount tries again", async () => {
    const { registerLanguage } = await import("../src/code/languages");
    createHighlighterCore.mockRejectedValueOnce(new Error("no highlighter"));
    await expect(registerLanguage("nextflow")).resolves.toBeUndefined();
    expect(shikiToMonaco).not.toHaveBeenCalled();
    createHighlighterCore.mockResolvedValueOnce({});
    await registerLanguage("nextflow");
    expect(createHighlighterCore).toHaveBeenCalledTimes(2);
    expect(shikiToMonaco).toHaveBeenCalledTimes(1);
    // once highlighted, nothing is registered again
    await registerLanguage("nextflow");
    expect(createHighlighterCore).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
