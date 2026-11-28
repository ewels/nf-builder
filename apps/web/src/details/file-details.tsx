import type { OutlineItem } from "@nf-builder/engine";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { canvasStore, useWorkspace } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { editorLanguageOf, LANGUAGE_NAMES } from "../files/file-kinds";

export type OutlineState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly items: readonly OutlineItem[] }
  | { readonly status: "unavailable"; readonly message: string };

/** The word for an outline item's kind (FI-31). */
const KIND_WORDS: Record<OutlineItem["kind"], string> = {
  featureFlag: "feature flag",
  include: "include",
  import: "import",
  params: "params",
  legacyParam: "param",
  record: "record",
  enum: "enum",
  process: "process",
  agent: "agent",
  workflow: "workflow",
  output: "output",
  function: "function",
  unparsed: "unparsed",
  statement: "statement",
};

/**
 * The details of a file tab (FI-31, FI-32): its path and language, and for a script the declarations it holds, each a
 * button that shows the declaration in the code.
 */
export function FileDetailsView({
  path,
  language,
  outline,
  onReveal,
}: {
  readonly path: string;
  readonly language: string;
  readonly outline: OutlineState | null;
  readonly onReveal?: (item: OutlineItem) => void;
}): JSX.Element {
  return (
    <div
      className="details-pane"
      data-details-state={outline?.status ?? "file"}
    >
      <h3 className="details-name">{path}</h3>
      <p className="details-kind">{language}</p>
      {outline === null ? null : (
        <section className="details-section">
          <h3>Declarations</h3>
          {outline.status === "loading" ? (
            <p className="details-none">Loading…</p>
          ) : outline.status === "unavailable" ? (
            <p className="details-none">{outline.message}</p>
          ) : outline.items.length === 0 ? (
            <p className="details-none">None</p>
          ) : (
            <ul className="details-list">
              {outline.items.map((item) => (
                <li key={`${item.range.start}:${item.kind}:${item.name}`}>
                  <button
                    type="button"
                    className="details-outline-row"
                    onClick={() => onReveal?.(item)}
                  >
                    <span className="details-type">
                      {KIND_WORDS[item.kind]}
                    </span>{" "}
                    <span className="details-port-name">{item.name}</span>{" "}
                    <span className="details-note">line {item.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The active file tab's details: the outline of a `.nf` file is read from the worker at each change to it. */
export function FileDetails({ path }: { readonly path: string }): JSX.Element {
  const lastChange = useWorkspace((s) => s.lastChange);
  const session = useWorkspace((s) => s.session);
  const revision = lastChange?.paths.includes(path) ? lastChange.revision : 0;
  const isScript = path.toLowerCase().endsWith(".nf");
  const [outline, setOutline] = useState<OutlineState | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` and `session` read the outline again
  useEffect(() => {
    if (!isScript) {
      setOutline(null);
      return;
    }
    let current = true;
    setOutline((old) => old ?? { status: "loading" });
    void getEngine()
      .outline(path)
      .then(
        (result) => {
          if (!current) return;
          setOutline(
            "ok" in result
              ? { status: "unavailable", message: result.message }
              : { status: "ready", items: result.items },
          );
        },
        (error: unknown) => {
          if (current)
            setOutline({
              status: "unavailable",
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      current = false;
    };
  }, [path, isScript, revision, session]);
  return (
    <FileDetailsView
      path={path}
      language={LANGUAGE_NAMES[editorLanguageOf(path)]}
      outline={outline}
      onReveal={(item) => canvasStore.getState().revealCode(path, item.range)}
    />
  );
}
