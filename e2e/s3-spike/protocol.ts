import type { JsonRpcMessage } from "./lsp-framing.ts";

export const CHEERPJ_ORIGIN = "https://cjrtnc.leaningtech.com";
export const JAR_APP_PATH = "/app/language-server-all.jar";

export type Variant = {
  cheerpj: "5.0";
  java: 17 | 21;
  wasmGC: boolean;
  preload: boolean;
};

export const DEFAULT_VARIANT: Variant = {
  cheerpj: "5.0",
  java: 17,
  wasmGC: false,
  preload: false,
};

function flag(key: string, value: string): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`variant ${key}=${value}: use 0 or 1`);
}

/** "java=21&wasmGC=1&preload=1"; unknown keys and values throw. */
export function parseVariant(query: string): Variant {
  const variant: Variant = { ...DEFAULT_VARIANT };
  for (const [key, value] of new URLSearchParams(query)) {
    if (key === "java") {
      if (value !== "17" && value !== "21")
        throw new Error(`variant java=${value}: use 17 or 21`);
      variant.java = value === "17" ? 17 : 21;
    } else if (key === "wasmGC") variant.wasmGC = flag(key, value);
    else if (key === "preload") variant.preload = flag(key, value);
    else throw new Error(`variant: unknown key "${key}"`);
  }
  return variant;
}

export function variantLabel(variant: Variant): string {
  return `CheerpJ ${variant.cheerpj}, Java ${variant.java}${variant.wasmGC ? ", wasmGC" : ""}${variant.preload ? ", preload" : ""}`;
}

export function loaderUrl(variant: Variant): string {
  return `${CHEERPJ_ORIGIN}/${variant.cheerpj}/loader.js`;
}

export type WorkerStage =
  | "workerStarted"
  | "loaderLoaded"
  | "cheerpjReady"
  | "libraryLoaded"
  | "serverStarted";

export type PageToWorker =
  | {
      type: "start";
      variant: Variant;
      preloadResources?: Record<string, number[]>;
    }
  | { type: "send"; message: JsonRpcMessage }
  | { type: "runtimeResources" };

export type WorkerToPage =
  | { type: "mark"; stage: WorkerStage }
  | { type: "message"; message: JsonRpcMessage }
  | { type: "csp"; directive: string; blockedURI: string }
  | { type: "error"; stage: WorkerStage | "pump"; message: string }
  | { type: "runtimeResources"; json: string };
