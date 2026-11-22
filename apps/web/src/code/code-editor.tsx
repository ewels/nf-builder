import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/engine-client";
import { modelFor } from "./models";
import { monaco } from "./monaco";

// Task 3 shows the file; editing comes with the debounced ReplaceFileText sync.
export default function CodeEditor({
  path,
}: {
  readonly path: string;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let cancelled = false;
    getEngine()
      .readFile(path)
      .then((text) => {
        if (cancelled || host.current === null) return;
        if (text === null) {
          setProblem(`${path} is not in the project.`);
          return;
        }
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        editor = monaco.editor.create(host.current, {
          model: modelFor(monaco, path, text).model,
          readOnly: true,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          minimap: { enabled: false },
          ariaLabel: `Code of ${path}`,
          cursorBlinking: reduced ? "solid" : "blink",
          smoothScrolling: !reduced,
        });
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      cancelled = true;
      editor?.dispose();
    };
  }, [path]);
  return (
    <>
      {problem === null ? null : <p className="muted">{problem}</p>}
      <div className="code-editor-host" ref={host} />
    </>
  );
}
