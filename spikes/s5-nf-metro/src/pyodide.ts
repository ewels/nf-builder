// The only Pyodide surface the spike uses, typed by hand so that there is no npm dependency (ADR 0024).
export interface PyodideApi {
  version: string;
  loadPackage(
    names: string[],
    options?: { messageCallback?: (message: string) => void },
  ): Promise<unknown>;
  runPython(code: string): unknown;
  globals: {
    get(name: string): unknown;
    set(name: string, value: unknown): void;
  };
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
  };
}

type PyodideModule = {
  loadPyodide(options: { indexURL: string }): Promise<PyodideApi>;
};

/** Loads `${indexURL}pyodide.mjs` and starts the runtime. Rejects after timeoutMs: a CSP without 'wasm-unsafe-eval'
 *  makes loadPyodide hang without an error. */
export async function loadPyodideFrom(
  indexURL: string,
  timeoutMs: number,
): Promise<PyodideApi> {
  const module = (await import(
    /* @vite-ignore */ `${indexURL}pyodide.mjs`
  )) as PyodideModule;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Pyodide did not start within ${timeoutMs / 1000} s (a CSP without 'wasm-unsafe-eval' makes it hang)`,
          ),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([module.loadPyodide({ indexURL }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
