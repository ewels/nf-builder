import type {
  SnapshotModulePorts,
  SnapshotOutput,
  SnapshotPort,
} from "@nf-builder/lang-core";
import { parse } from "yaml";
import type { ApiModuleChannel, ApiModuleMetadata } from "./api-types.ts";

const SYNTHETIC = /^output_\d+$/;
/** Keys of an unnamed schema-v1 output item, which never name a channel. */
const ITEM_KEYS = new Set(["type", "description", "pattern", "ontologies"]);

function channelPort(channel: ApiModuleChannel): SnapshotPort {
  const items = (channel.items ?? []).map(
    (item) => `${item.name ?? ""}:${item.type ?? ""}`,
  );
  return channel.tuple === true || items.length > 1 ? items : (items[0] ?? ":");
}

/**
 * The output names of a module's `meta.yml`, in file order (LA-23): a map's keys, or for a list each element's single
 * key, its `name`, or `output_<position>`.
 */
export function metaYmlOutputNames(metaYml: string): string[] {
  let output: unknown;
  try {
    output = (parse(metaYml) as { output?: unknown } | null)?.output;
  } catch {
    return [];
  }
  if (Array.isArray(output))
    return output.map((element: unknown, index) => {
      if (
        element !== null &&
        typeof element === "object" &&
        !Array.isArray(element)
      ) {
        const record = element as Record<string, unknown>;
        if (typeof record.name === "string") return record.name;
        const keys = Object.keys(record);
        if (keys.length === 1 && !ITEM_KEYS.has(keys[0] as string))
          return keys[0] as string;
      }
      return `output_${index + 1}`;
    });
  if (output !== null && typeof output === "object") return Object.keys(output);
  return [];
}

/**
 * Ports from the registry's normalised metadata, with the outputs in `meta.yml` order (the API sorts them differently).
 * Names that `meta.yml` doesn't list stay at the end in API order. Synthetic `output_<n>` names become null.
 */
export function modulePorts(
  metadata: ApiModuleMetadata | undefined,
  metaYml: string | null,
): SnapshotModulePorts {
  const inputs = (metadata?.input ?? []).map(channelPort);
  const entries = Object.entries(metadata?.output ?? {});
  const order = metaYml === null ? [] : metaYmlOutputNames(metaYml);
  const rank = (name: string): number => {
    const at = order.indexOf(name);
    return at < 0 ? order.length : at;
  };
  const outputs: SnapshotOutput[] = entries
    .map(([name, channel], index) => ({ name, channel, index }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.index - b.index)
    .map(({ name, channel }) => ({
      name: SYNTHETIC.test(name) ? null : name,
      port: channelPort(channel),
    }));
  return { inputs, outputs };
}
