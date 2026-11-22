// Pins, downloads, verifies and stages the language server jar for the spike (ADR 0022).
// Uses curl, like the catalogue generator, so it honours the agent proxy. Tools can't be imported from here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIXTURE_PATH,
  LANGUAGE_SERVER_CACHE,
  PUBLIC_DIR,
  REPO_ROOT,
} from "./paths.ts";

export type LanguageServerPin = { tag: string; url: string; sha256: string };

const NO_PIN =
  "packages/lang-2610/upstream.json has no languageServer pin yet; F-006 (ADR 0020) adds it: rebase on main, or set S3_LANGUAGE_SERVER_JAR for a trial run";

/** Reads the pin by path, so no Nextflow version literal lives here (LA-02). */
export function readLanguageServerPin(
  repoRoot: string = REPO_ROOT,
): LanguageServerPin {
  const file = join(repoRoot, "packages/lang-2610/upstream.json");
  if (!existsSync(file)) throw new Error(NO_PIN);
  const pin = (
    JSON.parse(readFileSync(file, "utf8")) as {
      languageServer?: Partial<LanguageServerPin>;
    }
  ).languageServer;
  if (!pin?.tag || !pin.url || !pin.sha256) throw new Error(NO_PIN);
  return { tag: pin.tag, url: pin.url, sha256: pin.sha256 };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifySha256(path: string, expected: string): void {
  const actual = sha256File(path);
  if (actual !== expected)
    throw new Error(
      `SHA-256 mismatch for ${path}: expected ${expected}, got ${actual}`,
    );
}

function verified(path: string, expected: string): boolean {
  if (!existsSync(path)) return false;
  try {
    verifySha256(path, expected);
    return true;
  } catch {
    return false;
  }
}

/** .cache/language-server/<tag>/language-server-all.jar; no network when it is already there and verified. */
export function ensureJar(
  pin: LanguageServerPin,
  cacheRoot: string = LANGUAGE_SERVER_CACHE,
): string {
  const dir = join(cacheRoot, pin.tag);
  const jar = join(dir, "language-server-all.jar");
  if (verified(jar, pin.sha256)) return jar;
  mkdirSync(dir, { recursive: true });
  const temp = `${jar}.download`;
  const curl = spawnSync(
    "curl",
    ["-fsSL", "--retry", "3", "-o", temp, pin.url],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (curl.status !== 0)
    throw new Error(`curl could not download ${pin.url} (exit ${curl.status})`);
  try {
    verifySha256(temp, pin.sha256);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  renameSync(temp, jar);
  return jar;
}

/** Copies the jar and the oracle case into the directory the spike serves as its public files. */
export function stagePublicDir(
  jarPath: string,
  fixturePath: string,
  publicDir: string = PUBLIC_DIR,
): string {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(jarPath, join(publicDir, "language-server-all.jar"));
  copyFileSync(fixturePath, join(publicDir, "fixture.nf"));
  return publicDir;
}

export function main(env: NodeJS.ProcessEnv): number {
  try {
    const override = env.S3_LANGUAGE_SERVER_JAR;
    let jar: string;
    if (override) {
      if (!existsSync(override))
        throw new Error(`S3_LANGUAGE_SERVER_JAR does not exist: ${override}`);
      jar = override;
      console.log(`S3 prepare: ${jar} sha256 ${sha256File(jar)}`);
      console.log("S3 prepare: trial run: results need the pinned jar");
    } else {
      const pin = readLanguageServerPin();
      jar = ensureJar(pin);
      console.log(`S3 prepare: ${pin.tag} ${jar} (sha256 verified)`);
    }
    stagePublicDir(jar, FIXTURE_PATH);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.env);
