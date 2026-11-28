import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewPathDialog } from "../src/files/new-path-dialog";

const html = (kind: "file" | "folder", folder: string) =>
  renderToStaticMarkup(
    <NewPathDialog
      kind={kind}
      folder={folder}
      check={() => null}
      onSubmit={async () => null}
      onClose={() => undefined}
    />,
  );

describe("F-210 new path dialog", () => {
  it("F-210 UX-16: the dialogs name the target folder and are titled for what they make", () => {
    const file = html("file", "modules/local");
    expect(file).toContain(">New file<");
    expect(file).toContain(
      "In modules/local/. Use / to make folders on the way.",
    );
    expect(html("folder", "")).toContain(">New folder<");
    expect(html("folder", "")).toContain("At the top of the project.");
    expect(file).toContain(">Name<");
    expect(file).not.toContain('role="alert"');
  });
});
