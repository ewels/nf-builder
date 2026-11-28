// The cards of a config view (F-601, FI-01, FI-02, FI-06): scopes, selectors, profiles and plugins, with their rows.
import type {
  ConfigRow,
  ConfigViewItem,
  PluginRow,
  ProfileCard,
  ScopeCard,
  SelectorCard,
} from "@nf-builder/engine";
import type { JSX, ReactNode } from "react";
import { type ConfigHandlers, OptionRowView, UnsetRowView } from "./option-row";
import { selectorUse } from "./selector-text";

/** Selector cards start collapsed in a process card with more of them than this (F-601). */
export const COLLAPSE_SELECTORS_OVER = 20;

const isCollapsed = (
  handlers: ConfigHandlers,
  key: string,
  byDefault: boolean,
): boolean => handlers.toggled.includes(key) !== byDefault;

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

function Rows({
  rows,
  pinned,
  names,
  handlers,
}: {
  readonly rows: readonly ConfigRow[];
  readonly pinned: readonly string[];
  /** The option path above the rows' labels. */
  readonly names: readonly string[];
  readonly handlers: ConfigHandlers;
}): JSX.Element | null {
  const set = new Set(
    rows.flatMap((r) => (r.kind === "option" ? [r.label] : [])),
  );
  const unset = pinned.filter((p) => !set.has(p));
  if (rows.length === 0 && unset.length === 0) return null;
  return (
    <ul className="config-rows">
      {unset.map((p) => (
        <UnsetRowView
          key={`unset:${p}`}
          label={p}
          names={[...names, p]}
          handlers={handlers}
        />
      ))}
      {rows.map((row) =>
        row.kind === "option" ? (
          <OptionRowView key={row.key} row={row} handlers={handlers} />
        ) : (
          <OtherRow key={row.key} row={row} handlers={handlers} />
        ),
      )}
    </ul>
  );
}

function SelectorCardView({
  card,
  pinned,
  byDefault,
  handlers,
}: {
  readonly card: SelectorCard;
  readonly pinned: readonly string[];
  readonly byDefault: boolean;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
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
        handlers={handlers}
      />
    </Card>
  );
}

function PluginsList({
  plugins,
}: {
  readonly plugins: readonly PluginRow[];
}): JSX.Element | null {
  if (plugins.length === 0) return null;
  return (
    <ul className="config-rows">
      {plugins.map((p) => (
        <li key={p.key} className="config-row" data-plugin={p.id}>
          <span className="config-row-label">{p.name}</span>
          <span className="config-row-value">{p.version ?? "Latest"}</span>
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
  return (
    <Card
      cardKey={card.key}
      title={card.name}
      collapsed={isCollapsed(handlers, card.key, false)}
      handlers={handlers}
      level="profile"
    >
      <ConfigItems items={card.items} handlers={handlers} />
    </Card>
  );
}

export function ScopeCardView({
  card,
  handlers,
}: {
  readonly card: ScopeCard;
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  const manySelectors = card.selectors.length > COLLAPSE_SELECTORS_OVER;
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
        handlers={handlers}
      />
      <PluginsList plugins={card.plugins} />
      {card.selectors.map((s) => (
        <SelectorCardView
          key={s.key}
          card={s}
          pinned={card.pinned}
          byDefault={manySelectors}
          handlers={handlers}
        />
      ))}
      {card.profiles.map((p) => (
        <ProfileCardView key={p.key} card={p} handlers={handlers} />
      ))}
    </Card>
  );
}

/** The items of a view or a profile, in source order. */
export function ConfigItems({
  items,
  handlers,
}: {
  readonly items: readonly ConfigViewItem[];
  readonly handlers: ConfigHandlers;
}): JSX.Element {
  return (
    <>
      {items.map((item) =>
        item.kind === "scope" ? (
          <ScopeCardView
            key={item.card.key}
            card={item.card}
            handlers={handlers}
          />
        ) : (
          <ul key={item.key} className="config-rows">
            <OtherRow row={item} handlers={handlers} />
          </ul>
        ),
      )}
    </>
  );
}
