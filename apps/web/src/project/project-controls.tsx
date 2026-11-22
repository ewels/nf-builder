// The connected project switcher and whichever dialog is open (F-202).
import { type JSX, useState } from "react";
import { DEFAULT_PROJECT_NAME } from "../workspace/project-name";
import { DeleteProjectDialog, ProjectNameDialog } from "./project-dialogs";
import { useProjects } from "./project-store";
import { ProjectSwitcher } from "./project-switcher";

export function ProjectControls(): JSX.Element {
  const status = useProjects((s) => s.status);
  const create = useProjects((s) => s.create);
  const open = useProjects((s) => s.open);
  const rename = useProjects((s) => s.rename);
  const remove = useProjects((s) => s.remove);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(
    null,
  );
  const close = () => setDialog(null);
  const { current } = status;
  return (
    <>
      <ProjectSwitcher
        projects={status.projects}
        current={current}
        disabled={status.storage !== "ready"}
        onOpen={(id) => void open(id).catch(() => undefined)} // the status carries `openError`
        onNew={() => setDialog("create")}
        onRename={() => setDialog("rename")}
        onDelete={() => setDialog("delete")}
      />
      {dialog === "create" ? (
        <ProjectNameDialog
          mode="create"
          initialName={DEFAULT_PROJECT_NAME}
          onSubmit={create}
          onClose={close}
        />
      ) : null}
      {dialog === "rename" && current ? (
        <ProjectNameDialog
          mode="rename"
          initialName={current.name}
          onSubmit={(name) => rename(current.id, name)}
          onClose={close}
        />
      ) : null}
      {dialog === "delete" && current ? (
        <DeleteProjectDialog
          project={current}
          onConfirm={() => remove(current.id)}
          onClose={close}
        />
      ) : null}
    </>
  );
}
