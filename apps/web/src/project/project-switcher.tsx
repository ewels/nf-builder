// The header's project switcher (F-202, UX-01): a disclosure button and its panel.
import {
  type JSX,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChevronIcon } from "../shell/icons";
import type { ProjectMeta } from "../workspace/types";

interface ProjectSwitcherProps {
  readonly projects: readonly ProjectMeta[];
  readonly current: ProjectMeta | null;
  readonly onOpen: (id: string) => void;
  readonly onNew: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly disabled?: boolean;
  /** Lets the owner of a dialog put focus back on the switcher button. */
  readonly buttonRef?: RefObject<HTMLButtonElement | null>;
  readonly initiallyOpen?: boolean;
}

function panelItems(panel: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(panel?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ??
      []),
  ];
}

export function ProjectSwitcher(p: ProjectSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(p.initiallyOpen ?? false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const ownButton = useRef<HTMLButtonElement>(null);
  const button = p.buttonRef ?? ownButton;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    const list = panelItems(panel.current);
    (
      list.find((b) => b.getAttribute("aria-current") === "true") ?? list[0]
    )?.focus();
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  /** Closes the panel with focus back on the button first: a dialog records the focused element to return to. */
  const act = (fn: () => void) => () => {
    setOpen(false);
    button.current?.focus();
    fn();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    const list = panelItems(panel.current);
    if (list.length === 0) return;
    event.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };

  const hasProject = p.current !== null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards keys from the buttons inside
    <div className="project-switcher" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={button}
        className="header-button project-switcher-button"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={p.disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="project-switcher-name">
          {p.current?.name ?? "No project"}
        </span>
        <ChevronIcon direction="down" />
      </button>
      <div className="project-panel" id={panelId} ref={panel} hidden={!open}>
        {p.projects.length > 0 ? (
          <div className="project-list">
            {p.projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className="project-item"
                aria-current={project.id === p.current?.id ? "true" : undefined}
                onClick={act(() => p.onOpen(project.id))}
              >
                {project.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="project-actions">
          <button type="button" className="project-item" onClick={act(p.onNew)}>
            New project…
          </button>
          <button
            type="button"
            className="project-item"
            disabled={!hasProject}
            onClick={act(p.onRename)}
          >
            Rename project…
          </button>
          <button
            type="button"
            className="project-item"
            disabled={!hasProject}
            onClick={act(p.onDelete)}
          >
            Delete project…
          </button>
        </div>
      </div>
    </div>
  );
}
