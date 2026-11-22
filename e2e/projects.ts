import type { Locator, Page } from "@playwright/test";

/** The subset of the workspace API the tests call, on `window.nfBuilderEngine` (F-202). */
export interface WorkspaceHook {
  writeFiles(
    files: { path: string; text: string | null }[],
  ): Promise<{ ok?: boolean; revision?: number }>;
  apply(
    command: unknown,
    revision: number,
  ): Promise<{ ok: boolean; revision: number | null }>;
  readFile(path: string): Promise<string | null>;
  flush(): Promise<{ status: string; error: string | null }>;
}

declare global {
  interface Window {
    __persistCalls?: number;
    __usageFraction?: number;
    __saveLog?: { text: string; at: number }[];
  }
}

/** The header button that opens the project panel. */
export const switcher = (page: Page): Locator =>
  page.getByRole("banner").locator(".project-switcher-button");

/** The save-state text in the header. */
export const saveState = (page: Page): Locator =>
  page.getByRole("banner").locator(".save-state");

/** Creates and opens a project through the header panel and the New project dialog. */
export async function createProjectInUi(
  page: Page,
  name: string,
): Promise<void> {
  await switcher(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("banner")
    .getByRole("button", { name, exact: true })
    .waitFor();
}

/**
 * Writes `before` to README.md, then applies a replace command to `after`, as the Code view will. Returns the page's
 * `performance.now()` taken just before the command.
 */
export function editReadme(
  page: Page,
  before: string,
  after: string,
): Promise<number> {
  return page.evaluate(
    async ({ before, after }) => {
      const engine = (window as unknown as { nfBuilderEngine: WorkspaceHook })
        .nfBuilderEngine;
      const written = await engine.writeFiles([
        { path: "README.md", text: before },
      ]);
      const t0 = performance.now();
      const applied = await engine.apply(
        { kind: "replaceFileText", path: "README.md", text: after },
        written.revision ?? 0,
      );
      if (!applied.ok) throw new Error("the edit was refused");
      return t0;
    },
    { before, after },
  );
}

/** Logs every change of the save-state text with the page's `performance.now()`, in `window.__saveLog`. */
export async function recordSaveStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector(".save-state");
    if (!target) throw new Error("no save state in the header");
    window.__saveLog = [];
    const log = () => {
      const text = target.textContent ?? "";
      const last = window.__saveLog?.at(-1);
      if (last?.text !== text)
        window.__saveLog?.push({ text, at: performance.now() });
    };
    log();
    new MutationObserver(log).observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}

/** Overrides the storage estimate and persistence calls before the page loads; `__persistCalls` counts `persist()`. */
export async function stubStorage(
  page: Page,
  options: { fraction: number; persisted: boolean },
): Promise<void> {
  await page.addInitScript((o) => {
    window.__persistCalls = 0;
    window.__usageFraction = o.fraction;
    const stub = {
      estimate: async () => ({
        usage: (window.__usageFraction ?? 0) * 1_000_000_000,
        quota: 1_000_000_000,
      }),
      persisted: async () => o.persisted,
      persist: async () => {
        window.__persistCalls = (window.__persistCalls ?? 0) + 1;
        return true;
      },
    };
    for (const [key, value] of Object.entries(stub))
      Object.defineProperty(navigator.storage, key, {
        value,
        configurable: true,
      });
  }, options);
}

export interface StoredDatabase {
  version: number;
  stores: Record<string, { keyPath: unknown; records: unknown[] }>;
}

/** Reads every record of the `nf-builder` database with the raw IndexedDB API, then closes it. */
export function readStoredDatabase(page: Page): Promise<StoredDatabase> {
  return page.evaluate(
    () =>
      new Promise<StoredDatabase>((resolve, reject) => {
        const open = indexedDB.open("nf-builder");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, "readonly");
          const stores: StoredDatabase["stores"] = {};
          let pending = names.length;
          for (const name of names) {
            const store = tx.objectStore(name);
            const all = store.getAll();
            all.onsuccess = () => {
              stores[name] = { keyPath: store.keyPath, records: all.result };
              if (--pending === 0) {
                const version = db.version;
                db.close();
                resolve({ version, stores });
              }
            };
            all.onerror = () => reject(all.error);
          }
        };
      }),
  );
}
