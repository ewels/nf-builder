import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_NAME,
  normaliseProjectName,
  PROJECT_NAME_MAX,
} from "../src/workspace/project-name";

describe("F-202 project names", () => {
  it("F-202 UX-01: names are trimmed and must hold 1 to 100 characters", () => {
    expect(normaliseProjectName("  RNA-seq  ")).toBe("RNA-seq");
    expect(normaliseProjectName("   ")).toBeNull();
    expect(normaliseProjectName("")).toBeNull();
    expect(normaliseProjectName("x".repeat(PROJECT_NAME_MAX))).not.toBeNull();
    expect(normaliseProjectName("x".repeat(PROJECT_NAME_MAX + 1))).toBeNull();
    expect(normaliseProjectName("😀".repeat(PROJECT_NAME_MAX))).not.toBeNull();
    expect(normaliseProjectName(DEFAULT_PROJECT_NAME)).toBe(
      DEFAULT_PROJECT_NAME,
    );
  });
});
