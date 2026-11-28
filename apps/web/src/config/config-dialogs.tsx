// The dialogs the form opens (F-601): Add scope, Add option, Add selector, Add profile, Add plugin, Add parameter.
import {
  type ConfigContext,
  type ConfigSchema,
  type ConfigValue,
  parseValueText,
} from "@nf-builder/engine";
import type { JSX } from "react";
import {
  AddOptionDialog,
  AddScopeDialog,
  type PickItem,
} from "./add-scope-dialog";
import type { PendingRow } from "./config-store";
import { pendingKey } from "./config-store";
import type { DialogRequest } from "./option-row";
import { PromptDialog } from "./prompt-dialog";

const PLUGIN_ID = /^[A-Za-z0-9._-]+(@[A-Za-z0-9._+-]+)?$/;

/** What the dialogs ask of the store; each returns the refusal's message, or null when applied. */
export interface DialogActions {
  readonly schema: ConfigSchema | null;
  readonly addBlock: (
    context: ConfigContext,
    scope: readonly string[],
  ) => Promise<string | null>;
  readonly addPlugin: (id: string) => Promise<string | null>;
  readonly set: (
    context: ConfigContext,
    option: readonly string[],
    value: ConfigValue,
  ) => Promise<string | null>;
  readonly addPending: (row: PendingRow) => void;
}

export function ConfigDialogs({
  request,
  actions,
  onClose,
}: {
  readonly request: DialogRequest | null;
  readonly actions: DialogActions;
  readonly onClose: () => void;
}): JSX.Element | null {
  if (request === null) return null;
  const pend = (context: ConfigContext, item: PickItem): void => {
    actions.addPending({
      key: pendingKey(context, item.node.path),
      context,
      option: item.node.path,
      valueKind: item.node.valueKind ?? "string",
    });
    onClose();
  };
  switch (request.kind) {
    case "scope": {
      const { context } = request;
      const schema = actions.schema;
      if (schema === null) return null;
      return (
        <AddScopeDialog
          schema={schema}
          inUse={request.inUse}
          onClose={onClose}
          onPick={(item) => {
            if (item.node.kind === "option") pend(context, item);
            else {
              void actions.addBlock(context, [item.node.name]);
              onClose();
            }
          }}
        />
      );
    }
    case "option":
      return (
        <AddOptionDialog
          scope={request.scope}
          taken={request.taken}
          onClose={onClose}
          onPick={(item) => pend(request.context, item)}
        />
      );
    case "selector": {
      const { profile } = request;
      return (
        <PromptDialog
          title="Add selector"
          submit="Add"
          fields={[
            {
              name: "kind",
              label: "Kind",
              options: [
                { value: "withName", label: "withName (process name)" },
                { value: "withLabel", label: "withLabel (process label)" },
              ],
            },
            {
              name: "pattern",
              label: "Pattern",
              help: "A name or label, or a regular expression.",
            },
          ]}
          check={(v) =>
            (v.pattern ?? "").trim() === "" ? "Enter a pattern." : null
          }
          onSubmit={(v) =>
            actions.addBlock(
              {
                profile,
                selector: {
                  kind: v.kind === "withLabel" ? "withLabel" : "withName",
                  pattern: (v.pattern ?? "").trim(),
                },
              },
              [],
            )
          }
          onClose={onClose}
        />
      );
    }
    case "profile":
      return (
        <PromptDialog
          title="Add profile"
          submit="Add"
          fields={[{ name: "name", label: "Name" }]}
          check={(v) => ((v.name ?? "").trim() === "" ? "Enter a name." : null)}
          onSubmit={(v) =>
            actions.addBlock(
              { profile: (v.name ?? "").trim(), selector: null },
              [],
            )
          }
          onClose={onClose}
        />
      );
    case "plugin":
      return (
        <PromptDialog
          title="Add plugin"
          submit="Add"
          fields={[
            {
              name: "id",
              label: "Plugin",
              help: "A name, with a version if you want one: nf-schema@2.5.1",
            },
          ]}
          check={(v) =>
            PLUGIN_ID.test((v.id ?? "").trim())
              ? null
              : "Use a name, then optionally @ and a version, for example nf-schema@2.5.1."
          }
          onSubmit={(v) => actions.addPlugin((v.id ?? "").trim())}
          onClose={onClose}
        />
      );
    case "param": {
      const { context, scope } = request;
      return (
        <PromptDialog
          title={scope === "env" ? "Add environment variable" : "Add parameter"}
          submit="Add"
          fields={[
            { name: "name", label: "Name" },
            {
              name: "kind",
              label: "Kind",
              options: [
                { value: "string", label: "Text" },
                { value: "integer", label: "Whole number" },
                { value: "decimal", label: "Number" },
                { value: "boolean", label: "True or false" },
              ],
            },
            {
              name: "value",
              label: "Value",
              help: "Write true or false for a boolean.",
            },
          ]}
          check={(v) => {
            if ((v.name ?? "").trim() === "") return "Enter a name.";
            const kind = v.kind as "string" | "integer" | "decimal" | "boolean";
            const parsed = parseValueText(kind, v.value ?? "");
            return parsed.ok ? null : parsed.message;
          }}
          onSubmit={(v) => {
            const kind = v.kind as "string" | "integer" | "decimal" | "boolean";
            const parsed = parseValueText(kind, v.value ?? "");
            if (!parsed.ok) return Promise.resolve(parsed.message);
            return actions.set(
              context,
              [scope, (v.name ?? "").trim()],
              parsed.value,
            );
          }}
          onClose={onClose}
        />
      );
    }
  }
}
