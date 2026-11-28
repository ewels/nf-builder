// The popup's Monaco editor on one declaration (F-304, UX-43, UX-44, AR-32). A lazy chunk: Configure-only use loads no
// Monaco (QA-01). It owns a model of its own with the declaration's text, never the file's model (ADR 0048), so an edit
// can't reach past the declaration. The text is the store's: typing reports it, and a Format changes it from outside.
import type { ParseProblem } from "@nf-builder/engine";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { NEXTFLOW_THEME, registerLanguage } from "../code/languages";
import { problemsToMarkers } from "../code/markers";
import { monaco } from "../code/monaco";
import { popupStore } from "./popup-store";

const MARKER_OWNER = "nf-builder-popup";

export interface WholeFile {
  /** The file's text with the declaration's span replaced by the draft. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface DeclarationEditorProps {
  readonly path: string;
  readonly name: string;
  readonly text: string;
  readonly problems: readonly ParseProblem[];
  /** Not null: the editor shows the whole file read-only with the declaration selected. */
  readonly wholeFile: WholeFile | null;
  readonly onChange: (text: string) => void;
}

/** Replaces the model's text as one undoable edit of the editor, so Ctrl+Z undoes a Format. */
function replaceText(model: monaco.editor.ITextModel, text: string): void {
  model.pushStackElement();
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text }],
    () => null,
  );
  model.pushStackElement();
}

interface Mounted {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly declaration: monaco.editor.ITextModel;
  readonly file: monaco.editor.ITextModel;
  views: monaco.editor.ICodeEditorViewState | null;
  highlight: monaco.editor.IEditorDecorationsCollection;
}

export default function DeclarationEditor(
  props: DeclarationEditorProps,
): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mounted, setMounted] = useState<Mounted | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const { path, name } = props;

  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];
    (async () => {
      await registerLanguage("nextflow");
      if (cancelled || host.current === null) return;
      const declaration = monaco.editor.createModel(
        latest.current.text,
        "nextflow",
        monaco.Uri.from({
          scheme: "nf-builder-popup",
          path: `/${path}`,
          fragment: name,
        }),
      );
      const file = monaco.editor.createModel(
        "",
        "nextflow",
        monaco.Uri.from({ scheme: "nf-builder-popup-file", path: `/${path}` }),
      );
      cleanup.push(
        () => declaration.dispose(),
        () => file.dispose(),
      );
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      host.current.dataset.language = "nextflow";
      const editor = monaco.editor.create(host.current, {
        model: declaration,
        theme: NEXTFLOW_THEME,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        minimap: { enabled: false },
        renderLineHighlightOnlyWhenFocus: true,
        ariaLabel: `Code of ${name}`,
        cursorBlinking: reduced ? "solid" : "blink",
        smoothScrolling: !reduced,
        scrollBeyondLastLine: false,
        readOnlyMessage: {
          value: "Edit the rest of the file in the Code view.",
        },
      });
      cleanup.push(() => editor.dispose());
      const publishSelection = () => {
        const r = editor.getSelection();
        if (r !== null && host.current !== null)
          host.current.dataset.selection = `${r.startLineNumber}:${r.startColumn}-${r.endLineNumber}:${r.endColumn}`;
      };
      publishSelection();
      const onSelection = editor.onDidChangeCursorSelection(publishSelection);
      const onContent = declaration.onDidChangeContent(() =>
        latest.current.onChange(declaration.getValue()),
      );
      cleanup.push(
        () => onSelection.dispose(),
        () => onContent.dispose(),
        // an undo or redo of the project first syncs the editor into the popup draft; it never applies anything (F-209)
        canvasStore
          .getState()
          .registerFlush(() => popupStore.getState().flushCode()),
      );
      setMounted({
        editor,
        declaration,
        file,
        views: null,
        highlight: editor.createDecorationsCollection(),
      });
      cleanup.push(() => setMounted(null));
    })().catch((error: unknown) =>
      setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
      for (const undo of cleanup.reverse()) undo();
    };
  }, [path, name]);

  // the text follows the draft (a Format, or the form rendered into it)
  useEffect(() => {
    if (mounted === null) return;
    if (mounted.declaration.getValue() !== props.text)
      replaceText(mounted.declaration, props.text);
  }, [mounted, props.text]);

  // the parse problems of the draft, as markers on the declaration's own lines
  useEffect(() => {
    if (mounted === null) return;
    monaco.editor.setModelMarkers(
      mounted.declaration,
      MARKER_OWNER,
      problemsToMarkers(
        props.problems,
        mounted.declaration.getLinesContent(),
      ).map((m) => ({ ...m, severity: monaco.MarkerSeverity.Error })),
    );
  }, [mounted, props.problems]);

  // Show whole file: a second, read-only model; back again restores the declaration's cursor and undo stack
  const whole = props.wholeFile;
  const shown = whole !== null;
  useEffect(() => {
    if (mounted === null) return;
    const { editor, declaration, file, highlight } = mounted;
    if (whole === null) {
      highlight.clear();
      if (editor.getModel() === file) {
        editor.setModel(declaration);
        if (mounted.views !== null) editor.restoreViewState(mounted.views);
      }
      editor.updateOptions({ readOnly: false });
      return;
    }
    if (editor.getModel() === declaration)
      mounted.views = editor.saveViewState();
    if (file.getValue() !== whole.text) file.setValue(whole.text);
    editor.setModel(file);
    editor.updateOptions({ readOnly: true });
    const range = monaco.Range.fromPositions(
      file.getPositionAt(whole.start),
      file.getPositionAt(whole.end),
    );
    highlight.set([
      {
        range,
        options: { isWholeLine: true, className: "popup-declaration-lines" },
      },
    ]);
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }, [mounted, whole]);

  return (
    <>
      {problem === null ? null : (
        <p className="muted">{`The code editor couldn't load. ${problem}`}</p>
      )}
      <div
        className="code-editor-host"
        data-whole-file={shown ? "true" : "false"}
        ref={host}
      />
    </>
  );
}
