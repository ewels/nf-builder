import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { workflowTabId } from "../shell/tab-strip";
import { useWorkspace } from "../workspace/workspace-store";

// React Flow is in this chunk only (QA-01, ADR 0003).
const WorkflowCanvas = lazy(() => import("./workflow-canvas"));

export function CanvasHost(): JSX.Element {
  const summary = useWorkspace((s) => s.summary);
  const opening = useWorkspace((s) => s.opening);
  const error = useWorkspace((s) => s.error);
  const activeTab = useWorkspace((s) => s.activeTab);
  const content = useWorkspace((s) => s.content);
  const portLabels = useWorkspace((s) => s.portLabels);
  const setPortLabels = useWorkspace((s) => s.setPortLabels);
  if (summary === null && !opening && error === null)
    return (
      <div className="canvas-area">
        <p className="muted">No project open</p>
      </div>
    );
  let body: JSX.Element;
  if (summary === null)
    body = (
      <p className="muted">{error === null ? "Opening project…" : error}</p>
    );
  else if (content.status === "ready")
    body = (
      <Suspense fallback={<p className="muted">Loading canvas…</p>}>
        <WorkflowCanvas
          key={activeTab ?? ""}
          projection={content.projection}
          portLabels={portLabels}
          onPortLabelsChange={setPortLabels}
        />
      </Suspense>
    );
  else if (content.status === "unavailable")
    body = <p className="muted">{content.message}</p>;
  else if (content.status === "loading")
    body = <p className="muted">Loading workflow…</p>;
  else body = <p className="muted">No workflow to show</p>;
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
