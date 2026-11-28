import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filesStore } from "../src/files/files-store";
import { LeftColumn, syncFilesVisible } from "../src/shell/left-column";

describe("left column", () => {
  it("F-204 UX-10: the left column has a Components and Files tab list, Components selected, the Files panel hidden", () => {
    const html = renderToStaticMarkup(<LeftColumn languageVersion="26.10" />);
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Left column view"/);
    expect(html).toMatch(
      /<button[^>]*role="tab"[^>]*id="left-tab-components"[^>]*aria-selected="true"[^>]*>Components<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*role="tab"[^>]*id="left-tab-files"[^>]*aria-selected="false"[^>]*>Files<\/button>/,
    );
    expect(html).toMatch(/id="left-panel-files"[^>]*hidden=""/);
    expect(html).not.toMatch(/id="left-panel-components"[^>]*hidden/);
  });

  it("F-210 F-703 UX-04: the Files panel stops pulling when the left column unmounts, as it does when read-only", () => {
    const stop = syncFilesVisible(true);
    expect(filesStore.getState().visible).toBe(true);
    stop();
    expect(filesStore.getState().visible).toBe(false);
  });
});
