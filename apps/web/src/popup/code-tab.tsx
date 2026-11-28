// The popup's Code tab (F-304, UX-43, UX-44): the declaration's text in Monaco, Format, Show whole file, and the first
// parse problem in a status line. The editor is a lazy chunk, so Configure-only use loads no Monaco (QA-01).
import type { ParseProblem } from "@nf-builder/engine";
import type { JSX } from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import { getEngine } from "../engine/engine-client";
import type { WholeFile } from "./declaration-editor";

const DeclarationEditor = lazy(() => import("./declaration-editor"));

export interface CodeTabProps {
  readonly path: string;
  readonly name: string;
  readonly text: string;
  /** Where the declaration sits in its file, for Show whole file. */
  readonly span: { readonly start: number; readonly end: number };
  readonly check: "valid" | "checking" | "invalid";
  readonly problems: readonly ParseProblem[];
  readonly message: string | null;
  readonly showWhole: boolean;
  readonly onToggleWhole: () => void;
  readonly onChange: (text: string) => void;
  readonly onFormat: () => void;
}

/** A chunk that fails to load leaves the tab usable: Configure keeps working. */
class LoadBoundary extends Component<
  { readonly children: JSX.Element },
  { readonly failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="muted">The code editor couldn't load.</p>
    ) : (
      this.props.children
    );
  }
}

export function CodeTab(props: CodeTabProps): JSX.Element {
  const { path, name, text, span, check, showWhole } = props;
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => {
    if (!showWhole) return;
    let current = true;
    void getEngine()
      .readFile(path)
      .then((read) => {
        if (current) setFile(read);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [showWhole, path]);
  const whole: WholeFile | null =
    showWhole && file !== null
      ? {
          text: file.slice(0, span.start) + text + file.slice(span.end),
          start: span.start,
          end: span.start + text.length,
        }
      : null;
  return (
    <div className="code-tab">
      <div className="code-tab-toolbar">
        <button
          type="button"
          onClick={props.onFormat}
          disabled={check !== "valid" || showWhole}
        >
          Format
        </button>
        <button
          type="button"
          aria-pressed={showWhole}
          onClick={props.onToggleWhole}
        >
          Show whole file
        </button>
        <span className="code-tab-state">
          {check === "checking" ? "Checking…" : ""}
        </span>
      </div>
      <div className="code-tab-body">
        <LoadBoundary>
          <Suspense fallback={<p className="muted">Loading editor…</p>}>
            <DeclarationEditor
              path={path}
              name={name}
              text={text}
              problems={props.problems}
              wholeFile={whole}
              onChange={props.onChange}
            />
          </Suspense>
        </LoadBoundary>
      </div>
      <p role="status" className="code-tab-problem">
        {check === "invalid" ? props.message : null}
      </p>
    </div>
  );
}
