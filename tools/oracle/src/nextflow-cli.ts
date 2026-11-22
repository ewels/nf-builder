import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureNextflow, nextflowEnv } from "./nextflow.ts";
import { loadPin, type NextflowPin } from "./pin.ts";

export type CliDeps = {
  pin?: NextflowPin;
  ensure?: (pin: NextflowPin) => string;
  spawn?: (
    dist: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => number;
  env?: NodeJS.ProcessEnv;
};

const defaultSpawn: NonNullable<CliDeps["spawn"]> = (dist, args, cwd, env) =>
  spawnSync(dist, args, { cwd, env, stdio: "inherit" }).status ?? 1;

/** Returns Nextflow's exit status (1 if killed by a signal), 2 for a bad pin, 3 for a failed download or hash check. */
export function main(argv: readonly string[], deps: CliDeps = {}): number {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const baseEnv = deps.env ?? process.env;
  let pin: NextflowPin;
  try {
    pin = deps.pin ?? loadPin();
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  let dist: string;
  try {
    dist =
      deps.ensure?.(pin) ??
      ensureNextflow(pin, { log: (line) => console.error(line) });
  } catch (error) {
    console.error(`nextflow: ${(error as Error).message}`);
    return 3;
  }
  const spawn = deps.spawn ?? defaultSpawn;
  return spawn(
    dist,
    args,
    baseEnv.INIT_CWD ?? process.cwd(),
    nextflowEnv(baseEnv),
  );
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = main(process.argv.slice(2));
