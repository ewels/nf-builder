// pnpm spike:s5 (F-010, ADR 0024): prepare the pinned files, build the test page and serve it on port 4175.
import { join } from "node:path";
import { build, preview } from "vite";
import { isMain } from "../../scripts/check-common.ts";
import { prepareSpikeS5, SPIKE_S5_DIR, SPIKE_S5_PORT } from "./prepare.ts";

export const SPIKE_S5_URL = `http://localhost:${SPIKE_S5_PORT}/`;

export async function startSpikeS5() {
  await prepareSpikeS5();
  const configFile = join(SPIKE_S5_DIR, "vite.config.ts");
  await build({ configFile, logLevel: "warn" });
  return preview({ configFile, logLevel: "warn" });
}

if (isMain(import.meta)) {
  const server = await startSpikeS5();
  console.log(`Spike S5 test page: ${SPIKE_S5_URL}`);
  process.on("SIGINT", () => {
    void server.close().finally(() => process.exit(0));
  });
}
