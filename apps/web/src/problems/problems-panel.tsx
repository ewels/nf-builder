import {
  type Diagnostic,
  type ProblemSections,
  type ProblemsView,
  problemKey,
} from "@nf-builder/engine";
import {
  type JSX,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { plural } from "../import/import-summary";
import { focusTarget } from "../project/focus-target";
import { useReadOnly } from "../read-only/read-only-store";
import { PROBLEMS_PANEL_ID, statusLinkId } from "../shell/status-bar";
import { focusAfterFix, nextRowFocus, type RowFocus } from "./problem-keys";
import { ProblemRow } from "./problem-row";
import { useProblems } from "./problems-store";
import { QuotedText } from "./quoted-text";
import "./problems.css";

const VIEWS: readonly {
  readonly view: ProblemsView;
  readonly label: string;
}[] = [
  { view: "problems", label: "Problems" },
  { view: "suggestions", label: "Suggestions" },
];
const EMPTY: Record<ProblemsView, string> = {
  problems: "No problems",
  suggestions: "No suggestions",
};

export const problemsTabId = (view: ProblemsView): string =>
  `problems-tab-${view}`;
const TABPANEL_ID = "problems-tabpanel";

interface PanelProps {
  readonly sections: ProblemSections;
  readonly view: ProblemsView;
  /** The key of the problem whose fix is being applied. */
  readonly applying: string | null;
  readonly notice: string | null;
  /** The key of a problem to focus when the panel shows (the details pane's link, F-309). */
  readonly focus?: string | null;
  /** Called once `focus` has been acted on, so the same request can come again. */
  onFocused?(): void;
  onView(view: ProblemsView): void;
  onClose(): void;
  onGo(d: Diagnostic): void;
  onFix(d: Diagnostic): void;
  /** Below 1024 px (F-703, UX-04): rows have no quick-fix button. */
  readonly readOnly?: boolean;
}

/** The problems panel's layout (F-309, UX-03): two tabs, rows grouped by file, a quick-fix button on fixable rows. */
export function ProblemsPanelView({
  sections,
  view,
  applying,
  notice,
  focus = null,
  onFocused,
  onView,
  onClose,
  onGo,
  onFix,
  readOnly = false,
}: PanelProps): JSX.Element {
  const groups = sections[view];
  const rows = groups.flatMap((g) => g.diagnostics);
  const keys = rows.map(problemKey);
  const [active, setActive] = useState<RowFocus | null>(null);
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // a fix that was applied, and the rows before it: focus follows when its row has gone
  const fixed = useRef<{ key: string; before: readonly string[] } | null>(null);
  const previous = useRef<readonly string[]>(keys);

  // the roving stop: the active row if it is still listed, else the first row
  const stop: RowFocus | null =
    active !== null && keys.includes(active.key)
      ? active
      : keys[0] === undefined
        ? null
        : { key: keys[0], part: "go" };

  const focusPart = (at: RowFocus) => {
    const index = keys.indexOf(at.key);
    list.current
      ?.querySelector<HTMLElement>(
        `[data-problem-index="${index}"][data-part="${at.part}"]`,
      )
      ?.focus();
  };

  useEffect(() => {
    const before = previous.current;
    previous.current = keys;
    const pending = fixed.current;
    if (pending === null || before.join("\0") === keys.join("\0")) return;
    fixed.current = null;
    const inside = root.current?.contains(document.activeElement) ?? false;
    if (!inside && document.activeElement !== document.body) return;
    const next = focusAfterFix(pending.before, keys, pending.key);
    if (next === null) document.getElementById(TABPANEL_ID)?.focus();
    else {
      setActive(next);
      focusPart(next);
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: acts once per focus request, on the rows then listed
  useEffect(() => {
    if (focus === null) return;
    if (keys.includes(focus)) {
      setActive({ key: focus, part: "go" });
      focusPart({ key: focus, part: "go" });
    }
    onFocused?.();
  }, [focus]);

  const onListKey = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.problemIndex);
    const key = keys[index];
    const part = target.dataset.part === "fix" ? "fix" : "go";
    const next = nextRowFocus(
      rows.map((d, i) => ({
        key: keys[i] ?? "",
        fixable: d.fix !== undefined && !readOnly,
      })),
      key === undefined ? null : { key, part },
      event.key,
    );
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    focusPart(next);
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.findIndex((v) => v.view === view);
    const last = VIEWS.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = VIEWS[targets[event.key] ?? -1];
    if (!target) return;
    event.preventDefault();
    onView(target.view);
    document.getElementById(problemsTabId(target.view))?.focus();
  };

  const firstRegistry = groups.findIndex((g) => g.module !== null);
  const registryRows = groups
    .filter((g) => g.module !== null)
    .reduce((n, g) => n + g.diagnostics.length, 0);
  const noun = view === "problems" ? "problem" : "suggestion";
  let index = -1;
  return (
    <section
      ref={root}
      id={PROBLEMS_PANEL_ID}
      className="problems-panel"
      aria-label="Problems and suggestions"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="problems-header">
        <div
          role="tablist"
          aria-label="Problem kinds"
          className="problems-tabs"
          onKeyDown={onTabKey}
        >
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              role="tab"
              id={problemsTabId(v.view)}
              className="problems-tab"
              aria-selected={view === v.view}
              aria-controls={TABPANEL_ID}
              tabIndex={view === v.view ? 0 : -1}
              onClick={() => onView(v.view)}
            >
              {`${v.label} `}
              <span className="problems-tab-count">
                {v.view === "problems"
                  ? sections.counts.problems
                  : sections.counts.suggestions}
              </span>
            </button>
          ))}
        </div>
        <p className="problems-notice" role="status">
          {notice === null ? null : <QuotedText text={notice} />}
        </p>
        <button
          type="button"
          className="problems-close"
          aria-label="Close problems panel"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div
        ref={list}
        role="tabpanel"
        id={TABPANEL_ID}
        className="problems-list"
        aria-labelledby={problemsTabId(view)}
        // an empty list has no focusable content, so the panel itself is the stop
        tabIndex={rows.length === 0 ? 0 : undefined}
        onKeyDown={onListKey}
      >
        {groups.length === 0 ? (
          <p className="problems-empty">{EMPTY[view]}</p>
        ) : (
          groups.map((group, position) => (
            <section key={group.path} className="problems-group">
              {position === firstRegistry ? (
                <h3 className="problems-subheading">
                  {`Registry modules (${plural(registryRows, noun, `${noun}s`)})`}
                </h3>
              ) : null}
              <h3 className="problems-file">
                {`${group.path} `}
                <span className="problems-file-count">
                  {group.diagnostics.length}
                </span>
                {group.module === null ? null : (
                  <>
                    {" "}
                    <span
                      className="problems-tag"
                      title={`Registry module ${group.module}`}
                    >
                      registry
                    </span>
                  </>
                )}
              </h3>
              <ul className="problems-rows">
                {group.diagnostics.map((d) => {
                  index++;
                  const key = problemKey(d);
                  const here = stop?.key === key;
                  return (
                    <ProblemRow
                      key={key}
                      diagnostic={d}
                      index={index}
                      tabIndexGo={here && stop?.part === "go" ? 0 : -1}
                      tabIndexFix={here && stop?.part === "fix" ? 0 : -1}
                      applying={applying === key}
                      readOnly={readOnly}
                      onGo={() => {
                        fixed.current = null;
                        onGo(d);
                      }}
                      onFix={() => {
                        fixed.current = { key, before: keys };
                        onFix(d);
                      }}
                      onFocusPart={(part) => setActive({ key, part })}
                    />
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

/** The panel at the bottom of the centre column: nothing while closed (session state of the problems store). */
export function ProblemsPanel(): JSX.Element | null {
  const open = useProblems((s) => s.open);
  const sections = useProblems((s) => s.sections);
  const view = useProblems((s) => s.view);
  const applying = useProblems((s) => s.applying);
  const notice = useProblems((s) => s.notice);
  const focus = useProblems((s) => s.focus);
  const show = useProblems((s) => s.show);
  const close = useProblems((s) => s.close);
  // the control that opened the panel (the status-bar button or the details link), recorded before focus moves into it
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  const goTo = useProblems((s) => s.goTo);
  const applyFix = useProblems((s) => s.applyFix);
  const readOnly = useReadOnly();
  if (!open) return null;
  return (
    <ProblemsPanelView
      sections={sections}
      view={view}
      applying={applying}
      notice={notice}
      focus={focus}
      onFocused={() => show(view, null)}
      onView={(v) => show(v)}
      onClose={() => {
        close();
        // back to the control that opened the panel, else the status-bar button of this tab
        focusTarget(
          opener.current,
          document.getElementById(statusLinkId(view)),
        )?.focus();
      }}
      onGo={(d) => void goTo(d)}
      onFix={(d) => void applyFix(d)}
      readOnly={readOnly}
    />
  );
}
