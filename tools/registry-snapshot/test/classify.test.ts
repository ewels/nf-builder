import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const toolDir = fileURLToPath(new URL("..", import.meta.url));

describe("F-501 classification", () => {
  it("F-501: the pack's parser loads and parses under plain Node type stripping", () => {
    const script = `
      import { pack } from "@nf-builder/lang-2610";
      const parser = await pack.loadParser();
      const parse = parser.parseScript("process FOO {\\n  script:\\n  'true'\\n}\\n");
      console.log(JSON.stringify({ status: parse.status, name: parse.ast?.body[0]?.name?.name }));
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: toolDir, encoding: "utf8" },
    );
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "modelled",
      name: "FOO",
    });
  });
});
