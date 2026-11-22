// Ambient declarations for the CheerpJ loader's globals (defined in the worker by importScripts).
// CheerpJ's library-mode objects are dynamic proxies: every member lookup returns another proxy and
// every call returns a promise of one, so they cannot be typed more closely.
// biome-ignore lint/suspicious/noExplicitAny: dynamic Java proxy
type JavaProxy = any;

declare function importScripts(...urls: string[]): void;
declare function cheerpjInit(options: {
  version: number;
  status: "none" | "splash" | "default";
  wasmGC?: boolean;
  preloadResources?: Record<string, number[]>;
}): Promise<void>;
declare function cheerpjRunLibrary(classPath: string): Promise<JavaProxy>;
declare function cjGetRuntimeResources(): string;
