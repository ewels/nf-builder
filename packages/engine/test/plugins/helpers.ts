import { readFileSync } from "node:fs";
import type { SnapshotPluginFile } from "@nf-builder/lang-core";

const read = (path: string): SnapshotPluginFile =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

export const nfSchema = (): SnapshotPluginFile =>
  read(
    "../../../../tools/registry-snapshot/test/fixtures/expected/registry/plugins/nf-schema/3.1.0.json",
  );
export const nfHand = (): SnapshotPluginFile => read("./fixtures/nf-hand.json");
