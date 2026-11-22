// Spike S5 (F-010, ADR 0024): fetch the pinned runtime files and inputs into .cache/spikes/s5/public, and render
// the CLI reference SVGs with a pinned nf-metro in a Python venv. Both parts are idempotent. Build-time only.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../../scripts/check-common.ts";
import { MAPS } from "./src/protocol.ts";

export const SPIKE_S5_DIR: string = dirname(fileURLToPath(import.meta.url));
export const SPIKE_S5_CACHE: string = join(REPO_ROOT, ".cache/spikes/s5");
export const PUBLIC_DIR: string = join(SPIKE_S5_CACHE, "public");
export const SPIKE_S5_PORT = 4175;
/** Hosts this build-time tool may call (ADR 0017, ADR 0024). pypi.org is reached by pip, not by this code. */
export const BUILD_HOSTS: readonly string[] = [
  "cdn.jsdelivr.net",
  "files.pythonhosted.org",
  "raw.githubusercontent.com",
];

export type SpikeAsset = {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
};
export type AssetsFile = {
  pyodide: string;
  nfMetro: { version: string; commit: string };
  assets: SpikeAsset[];
};

const ROOTS = ["pyodide/", "wheels/", "examples/"];

function checkAsset(asset: SpikeAsset, seen: Set<string>): void {
  const where = `assets.json: ${asset.path}`;
  const bad = (reason: string): never => {
    throw new Error(`${where}: ${reason}`);
  };
  if (
    typeof asset.path !== "string" ||
    isAbsolute(asset.path) ||
    asset.path.split("/").includes("..") ||
    !ROOTS.some((root) => asset.path.startsWith(root))
  )
    bad("the path must be relative and under pyodide/, wheels/ or examples/");
  const url = URL.parse(asset.url) ?? bad("the URL is not valid");
  if (url.protocol !== "https:") bad("the URL must be https");
  if (!BUILD_HOSTS.includes(url.hostname))
    bad(`the host ${url.hostname} is not in the build-time host list`);
  if (!/^[0-9a-f]{64}$/.test(asset.sha256))
    bad("sha256 must be 64 lowercase hex characters");
  if (!Number.isInteger(asset.bytes) || asset.bytes <= 0)
    bad("bytes must be a positive integer");
  if (seen.has(asset.path)) bad("the path appears twice");
  seen.add(asset.path);
}

export function readAssets(
  file: string = join(SPIKE_S5_DIR, "assets.json"),
): AssetsFile {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as AssetsFile;
  const seen = new Set<string>();
  for (const asset of parsed.assets) checkAsset(asset, seen);
  return parsed;
}

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

function isUpToDate(asset: SpikeAsset, file: string): boolean {
  try {
    return (
      statSync(file).size === asset.bytes &&
      sha256(readFileSync(file)) === asset.sha256
    );
  } catch {
    return false;
  }
}

export async function fetchAssets(
  assets: readonly SpikeAsset[],
  publicDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ fetched: number; upToDate: number }> {
  let fetched = 0;
  let upToDate = 0;
  for (const asset of assets) {
    const file = join(publicDir, asset.path);
    if (isUpToDate(asset, file)) {
      upToDate++;
      continue;
    }
    const response = await fetchImpl(asset.url);
    if (!response.ok)
      throw new Error(
        `${asset.path}: ${asset.url} answered ${response.status}`,
      );
    const data = new Uint8Array(await response.arrayBuffer());
    const got = sha256(data);
    if (got !== asset.sha256 || data.length !== asset.bytes)
      throw new Error(
        `${asset.path}: sha256 ${got} does not match the pin ${asset.sha256} (${asset.url}). If upstream changed, re-pin it in spikes/s5-nf-metro/assets.json in its own PR (ADR 0024).`,
      );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    fetched++;
  }
  return { fetched, upToDate };
}

type Command = { file: string; args: string[] };

export function referenceCommands(opts: {
  cacheDir: string;
  spikeDir: string;
  publicDir: string;
  maps: readonly string[];
}): Command[] {
  const venv = join(opts.cacheDir, "venv");
  const python = join(venv, "bin/python");
  return [
    { file: "python3", args: ["-m", "venv", venv] },
    {
      file: python,
      args: [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "-r",
        join(opts.spikeDir, "requirements-cli.txt"),
      ],
    },
    {
      file: python,
      args: [
        "-c",
        "import sys, nf_metro; print(nf_metro.__version__, sys.version.split()[0])",
      ],
    },
    ...opts.maps.map((name) => ({
      file: join(venv, "bin/nf-metro"),
      args: [
        "render",
        join(opts.publicDir, "examples", `${name}.mmd`),
        "-o",
        join(opts.publicDir, "reference", `${name}.svg`),
      ],
    })),
  ];
}

export type ReferenceManifest = {
  nfMetro: string;
  python: string;
  inputs: string;
  files: Record<string, string>;
};

/** sha256 of requirements-cli.txt plus the pinned example hashes: the references depend on nothing else. */
function referenceInputs(assets: readonly SpikeAsset[]): string {
  const examples = assets
    .filter((a) => a.path.startsWith("examples/"))
    .map((a) => `${a.path} ${a.sha256}`)
    .sort();
  return sha256(
    [
      readFileSync(join(SPIKE_S5_DIR, "requirements-cli.txt"), "utf8"),
      ...examples,
    ].join("\n"),
  );
}

/** The manifest when it was made from the same inputs and every reference SVG still has its recorded hash. */
export function freshManifest(
  publicDir: string,
  inputs: string,
): ReferenceManifest | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(publicDir, "reference/manifest.json"), "utf8"),
    ) as ReferenceManifest;
    const intact = Object.entries(manifest.files).every(
      ([name, hash]) =>
        sha256(readFileSync(join(publicDir, "reference", `${name}.svg`))) ===
        hash,
    );
    return manifest.inputs === inputs && intact ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function run(command: Command): string {
  const result = spawnSync(command.file, command.args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      `${[command.file, ...command.args].join(" ")} failed (${result.error?.message ?? `exit ${result.status}`}):\n${result.stderr}`,
    );
  return result.stdout;
}

function renderReferences(
  inputs: string,
  pinnedNfMetro: string,
): ReferenceManifest {
  const probe = spawnSync(
    "python3",
    ["-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
    { encoding: "utf8" },
  );
  const version = probe.stdout?.trim() ?? "";
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (
    probe.error ||
    probe.status !== 0 ||
    major < 3 ||
    (major === 3 && minor < 11)
  )
    throw new Error(
      `spike S5 needs Python 3.11+ for the nf-metro CLI (found ${probe.error ? "none" : version})`,
    );

  const maps = MAPS.map((m) => m.name);
  mkdirSync(join(PUBLIC_DIR, "reference"), { recursive: true });
  const commands = referenceCommands({
    cacheDir: SPIKE_S5_CACHE,
    spikeDir: SPIKE_S5_DIR,
    publicDir: PUBLIC_DIR,
    maps,
  });
  let probeOutput = "";
  for (const [index, command] of commands.entries()) {
    const out = run(command);
    if (index === 2) probeOutput = out.trim();
  }
  const [nfMetro = "", pythonVersion = ""] = probeOutput.split(" ");
  if (nfMetro !== pinnedNfMetro)
    throw new Error(
      `the CLI venv has nf-metro ${nfMetro} but assets.json pins ${pinnedNfMetro}`,
    );
  const files: Record<string, string> = {};
  for (const name of maps)
    files[name] = sha256(
      readFileSync(join(PUBLIC_DIR, "reference", `${name}.svg`)),
    );
  const manifest: ReferenceManifest = {
    nfMetro,
    python: pythonVersion,
    inputs,
    files,
  };
  writeFileSync(
    join(PUBLIC_DIR, "reference/manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** Fetches the pinned files, then renders the CLI references unless they are already up to date. */
export async function prepareSpikeS5(): Promise<void> {
  const pins = readAssets();
  const { fetched, upToDate } = await fetchAssets(pins.assets, PUBLIC_DIR);
  const inputs = referenceInputs(pins.assets);
  const existing = freshManifest(PUBLIC_DIR, inputs);
  const manifest = existing ?? renderReferences(inputs, pins.nfMetro.version);
  console.log(
    `spike S5: ${fetched} fetched, ${upToDate} up to date; references ${existing ? "up to date" : "rendered"} (nf-metro ${manifest.nfMetro}, Python ${manifest.python})`,
  );
}
