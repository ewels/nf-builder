// The cards of a config view (F-601, FI-01, FI-02, FI-06): scopes, selectors, profiles and plugins, with their rows
// and, when the form is editable, the buttons that add to them.
import type {
  ConfigContext,
  ConfigRow,
  ConfigViewItem,
  PluginRow,
  ProfileCard,
  ScopeCard,
  SelectorCard,
} from "@nf-builder/engine";
import type { JSX, ReactNode } from "react";
import type { PendingRow } from "./config-store";
import {
  type ConfigHandlers,
  OptionRowView,
  PendingRowView,
  UnsetRowView,
} from "./option-row";
import { scopeItemsInUse } from "./scope-use";
import { selectorUse } from "./selector-text";

/** Selector cards start collapsed in a process card with more of them than this (F-601). */
export const COLLAPSE_SELECTORS_OVER = 20;

const isCollapsed = (
  handlers: ConfigHandlers,
  key: string,
  byDefault: boolean,
): boolean => handlers.toggled.includes(key) !== byDefault;

const canEdit = (handlers: ConfigHandlers): boolean =>
  handlers.edit?.editable === true;

function Card({
  cardKey,
  title,
  flag,
  collapsed,
  summary,
  handlers,
  level = "card",
  children,
}: {
  readonly cardKey: string;
  readonly title: string;
  readonly flag?: string;
  readonly collapsed: boolean;
  readonly summary?: string;
  readonly handlers: ConfigHandlers;
  readonly level?: "card" | "selector" | "profile";
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      className={`config-card is-${level}`}
      data-card={cardKey}
      data-selected={handlers.selected === cardKey}
      onFocusCapture={() => handlers.onSelect(cardKey)}
    >
      <h3 className="config-card-title">
        <button
          type="button"
          className="config-card-toggle"
          aria-expanded={!collapsed}
          onClick={() => {
            handlers.onSelect(cardKey);
            handlers.onToggle(cardKey);
          }}
        >
          {title}
        </button>
        {flag === undefined ? null : (
          <span className="config-flag">
            <span aria-hidden="true">▲</span> {flag}
          </span>
        )}
        {summary === undefined ? null : (
          <span className="config-card-summary">{summary}</span>
        )}
      </h3>
      {collapsed ? null : <div className="config-card-body">{children}</div>}
    </section>
  );
}

/** A button that asks for a dialog; absent while the form can't be edited. */
function AddButton({
  label,
  handlers,
  onClick,
}: {
  readonly label: string;
  readonly handlers: ConfigHandlers;
  readonly onClick: () => void;
}): JSX.Element | null {
  if (handlers.edit === undefined) return null;
  return (
    <button
      type="button"
      className="config-add"
      disabled={!canEdit(handlers)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Include and code rows, which carry no option. */
function OtherRow({
  row,
  handlers,
}: {
  readonly row: Exclude<ConfigRow, { kind: "option" }>;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  if (row.kind === "code")
    return (
      <li className="config-row is-code" data-row-kind="code">
        <code className="config-code">{row.text}</code>
        {row.problems.map((p) => (
          <span key={p} className="config-row-note">
            {p}
          </span>
        ))}
        {handlers.edit === undefined ? null : (
          <button
            type="button"
            className="config-action"
            onClick={() => handlers.edit?.onEditInCode(row.range)}
          >
            Edit in code
          </button>
        )}
      </li>
    );
  return (
    <li className="config-row is-include" data-row-kind="include">
      {row.target.kind === "file" ? (
        <button
          type="button"
          className="config-link"
          onClick={() => {
            if (row.target.kind === "file") handlers.onOpen(row.target.path);
          }}
        >
          Open {row.target.path}
        </button>
      ) : row.target.kind === "missing" ? (
        <span className="config-row-note">{row.target.message}</span>
      ) : (
        <span className="config-row-note">
          External source, not checked: <code>{row.source}</code>
        </span>
      )}
    </li>
  );
}

const sameSelector = (
  a: ConfigContext["selector"],
  b: ConfigContext["selector"],
): boolean =>
  a === b ||
  (a !== null && b !== null && a.kind === b.kind && a.pattern === b.pattern);

function Rows({
  rows,
  pinned,
  names,
  context,
  pending,
  handlers,
}: {
  readonly rows: readonly ConfigRow[];
  readonly pinned: readonly string[];
  /** The option path above the rows' labels. */
  readonly names: readonly string[];
  readonly context: ConfigContext;
  readonly pending: readonly PendingRow[];
  readonly handlers: ConfigHandlers;
}): JSX.Element | null {
  const set = new Set(
    rows.flatMap((r) => (r.kind === "option" ? [r.label] : [])),
  );
  const unset = pinned.filter((p) => !set.has(p));
  const mine = pending.filter(
    (p) =>
      p.context.profile === context.profile &&
      sameSelector(p.context.selector, context.selector) &&
      names.every((n, i) => p.option[i] === n) &&
      p.option.length > names.length &&
      (names.length > 0 || p.option.length === 1) &&
      !set.has(p.option.slice(names.length).join(".")),
  );
  if (rows.length === 0 && unset.length === 0 && mine.length === 0) return null;
  return (
    <ul className="config-rows">
      {unset.map((p) => (
        <UnsetRowView
          key={`unset:${p}`}
          label={p}
          names={[...names, p]}
          context={context}
          handlers={handlers}
        />
      ))}
      {rows.map((row) =>
        row.kind === "option" ? (
          <OptionRowView
            key={row.key}
            row={row}
            context={context}
            pinned={pinned.includes(row.label)}
            handlers={handlers}
          />
        ) : (
          <OtherRow key={row.key} row={row} handlers={handlers} />
        ),
      )}
      {mine.map((p) => (
        <PendingRowView key={p.key} row={p} handlers={handlers} />
      ))}
    </ul>
  );
}

function SelectorCardView({
  card,
  pinned,
  byDefault,
  profile,
  handlers,
}: {
  readonly card: SelectorCard;
  readonly pinned: readonly string[];
  readonly byDefault: boolean;
  readonly profile: string | null;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const context: ConfigContext = { profile, selector: card.selector };
  const processNode = handlers.edit?.schema?.scopes.find(
    (n) => n.name === "process",
  );
  const taken = new Set(
    card.rows.flatMap((r) =>
      r.kind === "option" ? [r.option.slice(1).join(".")] : [],
    ),
  );
  return (
    <Card
      cardKey={card.key}
      title={card.written}
      collapsed={isCollapsed(handlers, card.key, byDefault)}
      summary={card.match === null ? undefined : selectorUse(card.match)}
      handlers={handlers}
      level="selector"
    >
      <Rows
        rows={card.rows}
        pinned={
          card.selector === null
            ? []
            : pinned.filter((p) => p !== "resourceLimits")
        }
        names={["process"]}
        context={context}
        pending={handlers.edit?.pending ?? []}
        handlers={handlers}
      />
      {card.selector === null || processNode === undefined ? null : (
        <AddButton
          label="Add option…"
          handlers={handlers}
          onClick={() =>
            handlers.edit?.ask({
              kind: "option",
              context,
              scope: processNode,
              taken,
            })
          }
        />
      )}
    </Card>
  );
}

function PluginsList({
  plugins,
  handlers,
}: {
  readonly plugins: readonly PluginRow[];
  readonly handlers: ConfigHandlers;
}): JSX.Element | null {
  if (plugins.length === 0) return null;
  return (
    <ul className="config-rows">
      {plugins.map((p) => (
        <li key={p.key} className="config-row" data-plugin={p.id}>
          <span className="config-row-label">{p.name}</span>
          <div className="config-row-field">
            <span className="config-row-value">{p.version ?? "Latest"}</span>
            {handlers.edit === undefined ? null : (
              <button
                type="button"
                className="config-action"
                aria-label={`Remove plugin ${p.id}`}
                disabled={!canEdit(handlers)}
                onClick={() => void handlers.edit?.onRemovePlugin(p.id)}
              >
                Remove
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProfileCardView({
  card,
  handlers,
}: {
  readonly card: ProfileCard;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const context: ConfigContext = { profile: card.name, selector: null };
  return (
    <Card
      cardKey={card.key}
      title={card.name}
      collapsed={isCollapsed(handlers, card.key, false)}
      handlers={handlers}
      level="profile"
    >
      <ConfigItems items={card.items} profile={card.name} handlers={handlers} />
      <AddButton
        label="Add scope…"
        handlers={handlers}
        onClick={() =>
          handlers.edit?.ask({
            kind: "scope",
            context,
            inUse: scopeItemsInUse(card.items),
          })
        }
      />
    </Card>
  );
}

export function ScopeCardView({
  card,
  profile,
  handlers,
}: {
  readonly card: ScopeCard;
  readonly profile: string | null;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const context: ConfigContext = { profile, selector: null };
  const manySelectors = card.selectors.length > COLLAPSE_SELECTORS_OVER;
  const schemaNode = handlers.edit?.schema?.scopes.find(
    (n) => n.name === card.scope,
  );
  const taken = new Set(
    card.rows.flatMap((r) => (r.kind === "option" ? [r.label] : [])),
  );
  const free = card.scope === "params" || card.scope === "env";
  return (
    <Card
      cardKey={card.key}
      title={card.scope === "" ? "Unscoped options" : card.scope}
      flag={card.known ? undefined : "Unknown scope"}
      collapsed={isCollapsed(handlers, card.key, false)}
      handlers={handlers}
    >
      <Rows
        rows={card.rows}
        pinned={card.pinned}
        names={card.scope === "" ? [] : [card.scope]}
        context={context}
        pending={handlers.edit?.pending ?? []}
        handlers={handlers}
      />
      <PluginsList plugins={card.plugins} handlers={handlers} />
      {card.selectors.map((s) => (
        <SelectorCardView
          key={s.key}
          card={s}
          pinned={card.pinned}
          byDefault={manySelectors}
          profile={profile}
          handlers={handlers}
        />
      ))}
      {card.profiles.map((p) => (
        <ProfileCardView key={p.key} card={p} handlers={handlers} />
      ))}
      {free ? (
        <AddButton
          label="Add parameter…"
          handlers={handlers}
          onClick={() =>
            handlers.edit?.ask({ kind: "param", context, scope: card.scope })
          }
        />
      ) : null}
      {schemaNode !== undefined && schemaNode.kind === "scope" && !free ? (
        <AddButton
          label="Add option…"
          handlers={handlers}
          onClick={() =>
            handlers.edit?.ask({
              kind: "option",
              context,
              scope: schemaNode,
              taken,
            })
          }
        />
      ) : null}
      {card.scope === "process" ? (
        <AddButton
          label="Add selector…"
          handlers={handlers}
          onClick={() => handlers.edit?.ask({ kind: "selector", profile })}
        />
      ) : null}
      {card.scope === "profiles" ? (
        <AddButton
          label="Add profile…"
          handlers={handlers}
          onClick={() => handlers.edit?.ask({ kind: "profile" })}
        />
      ) : null}
      {card.scope === "plugins" ? (
        <AddButton
          label="Add plugin…"
          handlers={handlers}
          onClick={() => handlers.edit?.ask({ kind: "plugin" })}
        />
      ) : null}
    </Card>
  );
}

/** The items of a view or a profile, in source order; the unscoped card appears when it has a pending row. */
export function ConfigItems({
  items,
  profile = null,
  handlers,
}: {
  readonly items: readonly ConfigViewItem[];
  readonly profile?: string | null;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const pendingUnscoped =
    (handlers.edit?.pending ?? []).some(
      (p) =>
        p.context.profile === profile &&
        p.context.selector === null &&
        p.option.length === 1,
    ) && !items.some((i) => i.kind === "scope" && i.card.scope === "");
  return (
    <>
      {items.map((item) =>
        item.kind === "scope" ? (
          <ScopeCardView
            key={item.card.key}
            card={item.card}
            profile={profile}
            handlers={handlers}
          />
        ) : (
          <ul key={item.key} className="config-rows">
            <OtherRow row={item} handlers={handlers} />
          </ul>
        ),
      )}
      {pendingUnscoped ? (
        <ScopeCardView
          card={{
            key: `scope:pending:${profile ?? ""}:`,
            scope: "",
            known: true,
            form: "unscoped",
            pinned: [],
            rows: [],
            selectors: [],
            profiles: [],
            plugins: [],
            range: {
              start: 0,
              end: 0,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 1,
            },
          }}
          profile={profile}
          handlers={handlers}
        />
      ) : null}
    </>
  );
}
