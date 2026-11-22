// The pack's project templates for the new-project dialog (F-203). They come from the engine worker, so the main thread
// holds no pack (F-113).
import type { TemplateList } from "@nf-builder/engine";
import { useCallback, useEffect, useState } from "react";
import { getEngine } from "../engine/engine-client";

export type TemplatesState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly list: TemplateList }
  | { readonly status: "error"; readonly message: string };

const LOADING: TemplatesState = { status: "loading" };
const requests = new Map<string, Promise<TemplateList>>();

/** One request per version, shared by everyone; a rejected request is forgotten so the next call asks again. */
export function requestTemplates(version: string): Promise<TemplateList> {
  let request = requests.get(version);
  if (!request) {
    request = getEngine().templates(version);
    requests.set(version, request);
    request.catch(() => requests.delete(version));
  }
  return request;
}

export interface TemplatesView {
  readonly state: TemplatesState;
  /** Asks again after a failure. */
  reload(): void;
}

/**
 * Loads the template list for `version`; results for a version that is no longer current are ignored, and `reload`
 * starts a new attempt.
 */
export function useTemplates(version: string | undefined): TemplatesView {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    readonly version: string;
    readonly attempt: number;
    readonly result: TemplatesState;
  }>();
  useEffect(() => {
    if (version === undefined) return;
    let current = true;
    requestTemplates(version).then(
      (list) => {
        if (current)
          setLoaded({ version, attempt, result: { status: "ready", list } });
      },
      (error: unknown) => {
        if (current)
          setLoaded({
            version,
            attempt,
            result: {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [version, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const state =
    loaded !== undefined &&
    loaded.version === version &&
    loaded.attempt === attempt
      ? loaded.result
      : LOADING;
  return { state, reload };
}
