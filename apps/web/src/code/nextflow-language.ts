// The Nextflow language entry point (F-208); the languages themselves live in languages.ts since F-605.
import { registerLanguage } from "./languages";

export { NEXTFLOW_THEME } from "./languages";

export function registerNextflow(): Promise<void> {
  return registerLanguage("nextflow");
}
