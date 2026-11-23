import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { CanvasPlaceholder } from "../project/project-status";
import { useProjects } from "../project/project-store";
import { workflowTabId } from "../shell/tab-strip";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { useWorkspace } from "./canvas-store";

// React Flow is in this chunk only (QA-01, ADR 0003).
const WorkflowCanvas = lazy(() => import("./workflow-canvas"));

export function CanvasHost(): JSX.Element {
  const summary = useWorkspace((s) => s.summary);
  const projects = useProjects((s) => s.status);
  const activeTab = useWorkspace((s) => s.activeTab);
  const content = useWorkspace((s) => s.content);
  const portLabels = useWorkspace((s) => s.portLabels);
  const setPortLabels = useWorkspace((s) => s.setPortLabels);
  const selected = useWorkspace((s) => s.selected);
  const select = useWorkspace((s) => s.select);
  if (summary === null)
    return (
      <div className="canvas-area">
        <CanvasPlaceholder status={projects} />
      </div>
    );
  let body: JSX.Element;
  if (content.status === "ready")
    body = (
      <CanvasErrorBoundary>
        <Suspense fallback={<p className="muted">Loading canvas…</p>}>
          <WorkflowCanvas
            key={activeTab ?? ""}
            projection={content.projection}
            portLabels={portLabels}
            onPortLabelsChange={setPortLabels}
            selected={selected}
            onSelect={(id) => void select(id)}
          />
        </Suspense>
      </CanvasErrorBoundary>
    );
  else if (content.status === "unavailable")
    body = <p className="muted">{content.message}</p>;
  else if (content.status === "loading")
    body = <p className="muted">Loading workflow…</p>;
  else body = <p className="muted">No workflow open</p>;
  return (
    <div
      className="canvas-area"
      id="canvas-panel"
      {...(activeTab === null
        ? {}
        : {
            role: "tabpanel",
            "aria-labelledby": workflowTabId(activeTab),
          })}
    >
      {body}
    </div>
  );
}
