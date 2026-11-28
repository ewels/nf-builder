import type { JSX, KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { canvasStore, useWorkspace } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import {
  MARKDOWN_PREVIEW_MARKER,
  projectLinkOf,
  renderMarkdown,
} from "./render-markdown";

type PreviewState = "loading" | "ready" | "unavailable";

/**
 * The sanitised preview of a Markdown file (F-605, FI-30, QA-31). It holds its own file's text while mounted, as an
 * editor model does (AR-30, ADR 0048), and imports nothing from `code/`, so Preview never loads Monaco.
 */
export default function MarkdownPreview({
  path,
  onStatus,
}: {
  readonly path: string;
  readonly onStatus: (text: string) => void;
}): JSX.Element {
  const container = useRef<HTMLElement>(null);
  const [state, setState] = useState<PreviewState>("loading");
  const [message, setMessage] = useState("");
  // the newest read wins: a result of an older read, or of another project, is dropped
  const reads = useRef(0);
  const session = useRef(canvasStore.getState().session);
  const lastChange = useWorkspace((s) => s.lastChange);
  const revision = lastChange?.paths.includes(path) ? lastChange.revision : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` re-reads the file after an edit to it
  useEffect(() => {
    const read = ++reads.current;
    const mine = session.current;
    void (async () => {
      try {
        const text = await getEngine().readFile(path);
        if (
          read !== reads.current ||
          mine !== canvasStore.getState().session ||
          container.current === null
        )
          return;
        if (text === null) {
          container.current.replaceChildren();
          setMessage(`${path} is not in the project.`);
          setState("unavailable");
          return;
        }
        container.current.replaceChildren(renderMarkdown(text, { path }));
        setState("ready");
      } catch (error) {
        if (
          read !== reads.current ||
          mine !== canvasStore.getState().session ||
          container.current === null
        )
          return;
        container.current.replaceChildren();
        setMessage(
          `The preview couldn't be shown: ${error instanceof Error ? error.message : String(error)}`,
        );
        setState("unavailable");
      }
    })();
  }, [path, revision]);

  useEffect(() => () => void reads.current++, []);

  const open = (target: string) => {
    void canvasStore
      .getState()
      .openPath(target)
      .then((outcome) =>
        onStatus(
          outcome === "missing" ? `${target} is not in this project.` : "",
        ),
      );
  };
  const follow = (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    const target = projectLinkOf(event.target);
    if (target === null) return;
    event.preventDefault();
    open(target);
  };

  return (
    <>
      {state === "unavailable" ? (
        <p className="muted" role="alert">
          {message}
        </p>
      ) : null}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: one delegated handler for the project links inside the rendering */}
      <article
        ref={container}
        className="markdown-preview"
        aria-label={`Preview of ${path}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the preview scrolls by keyboard (QA-10)
        tabIndex={0}
        data-preview-state={state}
        data-marker={MARKDOWN_PREVIEW_MARKER}
        hidden={state === "unavailable"}
        onClick={follow}
        onKeyDown={(event) => {
          if (event.key === "Enter") follow(event);
        }}
      />
    </>
  );
}
