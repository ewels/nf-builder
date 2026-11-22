// pnpm spike:s5 (F-010, ADR 0024): prepare the pinned files, build the test page and serve it on port 4175.
import { join } from "node:path";
import { build, preview } from "vite";
import { isMain } from "../../scripts/check-common.ts";
import { prepareSpikeS5, SPIKE_S5_DIR } from "./prepare.ts";

export const SPIKE_S5_PORT = 4175;
export const SPIKE_S5_URL = `http://localhost:${SPIKE_S5_PORT}/`;

export async function startSpikeS5(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  await prepareSpikeS5();
  const configFile = join(SPIKE_S5_DIR, "vite.config.ts");
  await build({ configFile, logLevel: "warn" });
  const server = await preview({ configFile, logLevel: "warn" });
  return { url: SPIKE_S5_URL, close: () => server.close() };
}

if (isMain(import.meta)) {
  const server = await startSpikeS5();
  console.log(`Spike S5 test page: ${server.url}`);
  process.on("SIGINT", () => {
    void server.close().finally(() => process.exit(0));
  });
}
