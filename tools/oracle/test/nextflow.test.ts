import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DROPPED_ENV,
  ensureNextflow,
  nextflowEnv,
  parseVersion,
  sha256File,
} from "../src/nextflow.ts";
import { distPath, distUrl } from "../src/pin.ts";

const BYTES = "fake nextflow";
const setup = () => {
  const cache = mkdtempSync(join(tmpdir(), "oracle-nf-"));
  const probe = join(cache, "probe");
  writeFileSync(probe, BYTES);
  const pin = { version: "1.2.3", sha256: sha256File(probe) };
  const download = vi.fn((_url: string, dest: string) =>
    writeFileSync(dest, BYTES),
  );
  return { cache, pin, download, dist: distPath(pin.version, cache) };
};

describe("F-005 ensureNextflow", () => {
  it("F-005: ensureNextflow downloads a missing -dist once, verifies its SHA-256 and makes it executable", () => {
    const { cache, pin, download, dist } = setup();
    const got = ensureNextflow(pin, { nextflowCache: cache, download });
    expect(got).toBe(dist);
    expect(download).toHaveBeenCalledTimes(1);
    expect(statSync(dist).mode & 0o100).toBe(0o100);
  });

  it("F-005: ensureNextflow makes no download when the cached file has the pinned SHA-256", () => {
    const { cache, pin, download, dist } = setup();
    mkdirSync(dirname(dist), { recursive: true });
    writeFileSync(dist, BYTES);
    ensureNextflow(pin, { nextflowCache: cache, download });
    expect(download).not.toHaveBeenCalled();
  });

  it("F-005: ensureNextflow deletes a download with the wrong SHA-256 and names the expected and actual hashes and the URL", () => {
    const { cache, pin, dist } = setup();
    const wrong = vi.fn((_u: string, dest: string) =>
      writeFileSync(dest, "other"),
    );
    expect(() =>
      ensureNextflow(pin, { nextflowCache: cache, download: wrong }),
    ).toThrow(pin.sha256);
    expect(() =>
      ensureNextflow(pin, { nextflowCache: cache, download: wrong }),
    ).toThrow(distUrl(pin.version));
    expect(existsSync(dist)).toBe(false);
    expect(existsSync(`${dist}.part`)).toBe(false);
  });

  it("F-005: ensureNextflow replaces a cached file whose SHA-256 differs from the pin", () => {
    const { cache, pin, download, dist } = setup();
    mkdirSync(dirname(dist), { recursive: true });
    writeFileSync(dist, "corrupt");
    ensureNextflow(pin, { nextflowCache: cache, download });
    expect(download).toHaveBeenCalledTimes(1);
    expect(sha256File(dist)).toBe(pin.sha256);
  });
});

describe("F-005 environment", () => {
  it("F-005: nextflowEnv runs offline from .cache/nextflow/home with the strict parser and drops variables that could switch the version", () => {
    const base: NodeJS.ProcessEnv = {
      PATH: "/bin",
      JAVA_HOME: "/jdk",
      NXF_OPTS: "-Xmx1g",
    };
    for (const key of DROPPED_ENV) base[key] = "x";
    const env = nextflowEnv(base, "/c");
    expect(env.NXF_HOME).toBe("/c/home");
    expect(env.NXF_OFFLINE).toBe("true");
    expect(env.NXF_DISABLE_CHECK_LATEST).toBe("true");
    expect(env.NXF_ANSI_LOG).toBe("false");
    expect(env.NXF_SYNTAX_PARSER).toBe("v2");
    for (const key of DROPPED_ENV) expect(env[key], key).toBeUndefined();
    expect(env.JAVA_HOME).toBe("/jdk");
    expect(env.NXF_OPTS).toBe("-Xmx1g");
    expect(env.PATH).toBe("/bin");
  });

  it("F-005 LA-03: parseVersion reads the version from nextflow -version output", () => {
    expect(
      parseVersion(
        "\n      N E X T F L O W\n      version 26.10.7 build 12345\n",
      ),
    ).toBe("26.10.7");
    expect(parseVersion("no banner")).toBeNull();
  });
});
