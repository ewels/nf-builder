import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/app-shell";

describe("@nf-builder/web", () => {
  it("ADR-0003: the entry module loads", () => {
    expect(AppShell).toBeTypeOf("function");
  });

  it("UX-01: the header shows the app name nf-builder", () => {
    const html = renderToStaticMarkup(<AppShell />);
    expect(html).toMatch(
      /<header[^>]*>[\s\S]*<h1[^>]*>nf-builder<\/h1>[\s\S]*<\/header>/,
    );
  });

  it("UX-02: three labelled columns sit under the header", () => {
    const html = renderToStaticMarkup(<AppShell />);
    const landmarks = [
      ...html.matchAll(/<(aside|main)[^>]*aria-label="([^"]+)"/g),
    ].map((m) => [m[1], m[2]]);
    expect(landmarks).toEqual([
      ["aside", "Components and files"],
      ["main", "Canvas and editor"],
      ["aside", "Details"],
    ]);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<aside"));
  });
});
