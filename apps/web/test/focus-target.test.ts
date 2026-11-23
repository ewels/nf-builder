import { describe, expect, it } from "vitest";
import { focusTarget } from "../src/project/focus-target";

const body = { isConnected: true };
const el = (isConnected: boolean, ownerBody = body) =>
  ({
    isConnected,
    ownerDocument: { body: ownerBody },
  }) as unknown as HTMLElement;
const fallback = { name: "switcher" } as unknown as HTMLElement;

describe("F-203 focus returns to the opener (WCAG 2.4.3)", () => {
  it("F-203: a live opener gets the focus", () => {
    const opener = el(true);
    expect(focusTarget(opener, fallback)).toBe(opener);
  });

  it("F-203: a disconnected opener falls back to the switcher button", () => {
    expect(focusTarget(el(false), fallback)).toBe(fallback);
  });

  it("F-203: <body> as the opener (WebKit doesn't focus clicked buttons) falls back to the switcher button", () => {
    const opener = { isConnected: true } as unknown as HTMLElement;
    (opener as unknown as { ownerDocument: unknown }).ownerDocument = {
      body: opener,
    };
    expect(focusTarget(opener, fallback)).toBe(fallback);
  });

  it("F-203: no opener falls back to the switcher button, and no fallback gives null", () => {
    expect(focusTarget(null, fallback)).toBe(fallback);
    expect(focusTarget(null, null)).toBeNull();
  });
});
