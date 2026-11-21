import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Records CSP violations (from the page) and console or page errors for one page. */
export async function watchForCspViolations(page: Page): Promise<{
  consoleErrors: string[];
  violations(): Promise<string[]>;
}> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return {
    consoleErrors,
    violations: () => page.evaluate(() => window.__cspViolations ?? []),
  };
}
