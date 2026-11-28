// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "../src/project/export-dialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LAYOUT = ".nf-builder/layout.json";
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function show(
  over: Partial<Parameters<typeof ExportDialog>[0]> = {},
  paths: readonly string[] = ["main.nf", LAYOUT],
) {
  const props = {
    projectName: "My pipe",
    imported: false,
    list: async () => paths,
    onExport: vi.fn(async (_layout: boolean) => undefined),
    onClose: vi.fn(),
    ...over,
  };
  await act(async () => root.render(<ExportDialog {...props} />));
  await flush();
  return props;
}
const box = () =>
  host.querySelector<HTMLInputElement>('input[type="checkbox"]');
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(name),
  );

describe("F-404 export dialog", () => {
  it("F-404 UX-62: the layout box is checked by default; unticking it exports with layout false", async () => {
    const p = await show();
    expect(host.textContent).toContain("Export project");
    expect(host.textContent).toContain("My pipe.zip");
    expect(host.textContent).toContain("2 files");
    expect(host.textContent).toContain(
      "Include the layout (.nf-builder/layout.json)",
    );
    expect(box()?.checked).toBe(true);
    await act(async () => box()?.click());
    expect(box()?.checked).toBe(false);
    await act(async () => button("Export")?.click());
    await flush();
    expect(p.onExport).toHaveBeenCalledWith(false);
  });

  it("F-404 UX-62: without a sidecar the box is disabled with its note", async () => {
    await show({}, ["main.nf"]);
    expect(box()?.disabled).toBe(true);
    expect(box()?.checked).toBe(false);
    expect(host.textContent).toContain("This project has no layout yet.");
  });

  it("F-404 ADR-0055: case-only clashes and file-and-folder paths are listed as warnings and Export stays enabled", async () => {
    await show({}, ["README.md", "readme.md", "x", "x/y"]);
    expect(host.textContent).toContain(
      "These paths differ only by case and clash on macOS and Windows: README.md, readme.md",
    );
    expect(host.textContent).toContain(
      "x is both a file and a folder; some tools can't unzip both.",
    );
    expect((button("Export") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F-404 IO-13: an imported project shows the skipped-files note; a template project doesn't", async () => {
    const note =
      "Files skipped when this project was imported (binary files, for example) aren't in the export.";
    await show({ imported: true });
    expect(host.textContent).toContain(note);
    act(() => root.unmount());
    root = createRoot(host);
    await show({ imported: false });
    expect(host.textContent).not.toContain(note);
  });

  it("F-404 QA-10: a failure shows inline and keeps the dialog open; success closes it", async () => {
    const onExport = vi
      .fn<(layout: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const p = await show({ onExport });
    await act(async () => button("Export")?.click());
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't export the project: boom",
    );
    expect(p.onClose).not.toHaveBeenCalled();
    await act(async () => button("Export")?.click());
    await flush();
    expect(p.onClose).toHaveBeenCalled();
  });
});
