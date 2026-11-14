import { AsyncView } from "./async-view.tsx"
// The Record's pieces: one renderer per reading element (src/record.ts projects them; this file only draws), the
// full-page sheet they sit in on the phone, the sibling actions a turn's row holds, the Status
// table, and the 读数 page they make up. The reader (App.tsx) and the inspector (inspector.tsx) draw with these.
import { type Shape, type TableShape } from "@effect-tavern/runtime/src/product.ts"
import type { TimelineNode as Node } from "@effect-tavern/runtime/src/projection.ts"
import { type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/solid/menu"
import { Back, Change, Close, Clue, Die, Edit, Record, Reword, Swipe, Warning } from "./icons.tsx"
import { close } from "./pages.ts"
import { openSettings } from "./settings.tsx"
import { demandable, fresh, heading, kindOf, marked, record, status, theater, whens, type Element } from "./record.ts"
import {
  card,
  type CardView,
  demanded,
  dismiss,
  editing,
  error,
  type Id,
  latest,
  log,
  path,
  registry,
  stageNames,
  working,
} from "./store.ts"
import { turn } from "./turn.ts"
import { fetchContext, fetchDetail } from "./wire.ts"
import { t } from "./i18n.ts"

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Which sibling action made a version (GLOSSARY sibling: swipe / reword / edit), as its icon; a plain act draws the
 *  fallback (nothing unless given). The reader's version list and the Timeline draw with it. */
export const SiblingKind = (props: { of: Node["sibling"]; class?: string; fallback?: JSX.Element }) => (
  <Switch fallback={props.fallback}>
    <Match when={props.of === "swipe"}>
      <Swipe class={props.class} aria-label={t("common.swipe")} />
    </Match>
    <Match when={props.of === "reword"}>
      <Reword class={props.class} aria-label={t("common.reword")} />
    </Match>
    <Match when={props.of === "edit"}>
      <Edit class={props.class} aria-label={t("common.edit")} />
    </Match>
  </Switch>
)

/** A structured answer as key → value rows; nested values as JSON. */
export const KeyValues = (props: { of: Record<string, unknown> }) => (
  <dl class="kv">
    <For each={Object.entries(props.of)} keyed={([k]) => k}>
      {(e) => (
        <>
          <dt>{e()[0]}</dt>
          <dd>{typeof e()[1] === "string" ? (e()[1] as string) : JSON.stringify(e()[1], null, 2)}</dd>
        </>
      )}
    </For>
  </dl>
)
/** A product's value by its declared shape (src/product.ts): a list as items, a table as rows, a record as key →
 *  value with its nested shapes, text as a line. The Record and the Inspector draw with it. */
export const Shaped = (props: { shape: Shape; value: unknown }) => {
  const table = () => (props.shape.kind === "table" ? (props.shape as TableShape) : undefined)
  const rec = () => (props.shape.kind === "record" ? (props.shape as Extract<Shape, { kind: "record" }>) : undefined)
  const cell = (v: unknown) =>
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v as string | number | boolean)
  return (
    <Switch fallback={<p class="val">{cell(props.value)}</p>}>
      <Match when={props.shape.kind === "list"}>
        <Show
          when={((props.value as unknown[] | undefined) ?? []).length}
          fallback={<p class="dim">{t("readings.none")}</p>}
        >
          <ul class="items">
            <For each={props.value as unknown[]} keyed={false}>
              {(v) => <li>{cell(v())}</li>}
            </For>
          </ul>
        </Show>
      </Match>
      <Match when={table()}>
        {(tbl) => (
          <Show
            when={((props.value as unknown[] | undefined) ?? []).length}
            fallback={<p class="dim">{t("readings.none")}</p>}
          >
            <table class="rows">
              <thead>
                <tr>
                  <For each={tbl().columns} keyed={(c) => c.key}>
                    {(c) => <th>{c().key}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={(props.value as Record<string, unknown>[] | undefined) ?? []} keyed={false}>
                  {(r) => (
                    <tr>
                      <For each={tbl().columns} keyed={(c) => c.key}>
                        {(c) => <td>{cell(r()[c().key])}</td>}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </Match>
      <Match when={rec()}>
        {(r) => (
          <dl class="kv">
            <For
              each={r().keys.filter((k) => (props.value as Record<string, unknown> | undefined)?.[k.key] !== undefined)}
              keyed={(k) => k.key}
            >
              {(k) => (
                <>
                  <dt>{k().key}</dt>
                  <dd>
                    <Show
                      when={"shape" in k() ? (k() as { shape: Shape }).shape : undefined}
                      fallback={cell((props.value as Record<string, unknown> | undefined)?.[k().key])}
                    >
                      {(sh) => (
                        <Shaped shape={sh()} value={(props.value as Record<string, unknown> | undefined)?.[k().key]} />
                      )}
                    </Show>
                  </dd>
                </>
              )}
            </For>
          </dl>
        )}
      </Match>
    </Switch>
  )
}

const changeLabel = (kind: "insert" | "patch" | "remove" | "replace") => {
  switch (kind) {
    case "insert":
      return t("readings.insert")
    case "patch":
      return t("readings.patch")
    case "remove":
      return t("readings.remove")
    case "replace":
      return t("readings.replace")
  }
}

export const Settlement = (props: { node: Node }) => {
  const busy = read(working)
  const failed = read(error)
  const asked = read(demanded)
  const line = read(path)
  const settling = () => props.node.settlementStatus === "pending" && busy()
  const unresolved = () =>
    (props.node.settlementStatus === "pending" || props.node.settlementStatus === "failed") && !settling()
  const reason = () => (asked() === null && line().at(-1)?.id === props.node.id ? failed() : null)
  return (
    <Show when={unresolved()}>
      <aside class="settlement" role="alert">
        <Warning aria-hidden="true" />
        <div class="body">
          <p>{t("readings.settlementPending")}</p>
          <Show when={reason()}>
            {(e) => (
              <p class="detail">
                <Show when={e().phase}>{(p) => <span class="phase">{t(stageNames[p()])}</span>}</Show>
                <span>
                  {e().message}
                  <Show when={e().code === "no-model"}>
                    {" "}
                    <button type="button" class="go" onClick={() => openSettings("routing")}>
                      {t("app.goDefaultModel")}
                    </button>
                  </Show>
                </span>
              </p>
            )}
          </Show>
        </div>
        <div class="btns">
          <button
            type="button"
            class="btn sm primary"
            disabled={busy()}
            onClick={() => turn.retryRecord(props.node.id)}
          >
            {t("readings.retryRecord")}
          </button>
          <button
            type="button"
            class="btn sm"
            disabled={busy() && props.node.settlementStatus !== "pending"}
            onClick={() => turn.skipRecord(props.node.id)}
          >
            {t("readings.skipRecord")}
          </button>
        </div>
      </aside>
    </Show>
  )
}

type El<K extends Element["kind"]> = Extract<Element, { kind: K }>
const is = <K extends Element["kind"]>(el: Element, kind: K): El<K> | undefined =>
  el.kind === kind ? (el as El<K>) : undefined

export const Reading = (props: { el: Element }) => (
  <Switch>
    <Match when={is(props.el, "steps")}>
      {(el) => (
        <div class="steps" role="img" aria-label={`${el().label}: ${el().options[el().now]}`}>
          <div class="row">
            <span class="label">{el().label}</span>
          </div>
          <div class="track">
            <For each={el().options} keyed={false}>
              {(_, i) => <i data-reached={i <= el().now} data-new={i > el().was && i <= el().now} />}
            </For>
          </div>
          <div class="names">
            <For each={el().options}>
              {(o, i) => (
                <Show when={i() === el().now} fallback={<span>{o}</span>}>
                  <b>{o}</b>
                </Show>
              )}
            </For>
          </div>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "meter")}>
      {(el) => {
        // Two meters by what the number means (src/record.ts). A gauge is a stock: ink fills min → now, this turn's
        // gain rides past it in ok, a loss leaves the lost stretch in soft danger, each cut is a tick. A scale is a
        // point on an axis: the stages are equal cells like a step track, the stage held is tinted, a dot sits at
        // now within its cell, and this turn's was → now is a stroke in ok / danger. Status and Record draw the same
        // picture; the Record adds the change.
        const lo = () => Math.min(el().was, el().now)
        const hi = () => Math.max(el().was, el().now)
        const gain = () => el().now > el().was
        const loss = () => el().now < el().was
        const at = (x: number) => ((x - el().min) / (el().max - el().min)) * 100
        const edges = () => [el().min, ...el().cuts, el().max]
        const cells = () =>
          edges()
            .slice(0, -1)
            .map((a, i): [number, number] => [a, edges()[i + 1]!])
        // the cell holding x: lower edge in, upper edge out, but the last cell takes max
        const cellOf = (x: number) =>
          Math.max(
            0,
            cells().findIndex(([a, b], i) => x >= a && (x < b || i === cells().length - 1)),
          )
        const within = (x: number, [a, b]: [number, number]) => ((x - a) / (b - a)) * 100
        // the numbers under the track: a gauge's at their place on the axis, a scale's at the cell boundaries
        const marks = () =>
          el().cuts.map((c, i) => ({ c, left: el().scale ? ((i + 1) / cells().length) * 100 : at(c) }))
        return (
          <div
            class={{ meter: true, scale: el().scale, gauge: !el().scale }}
            role="meter"
            aria-valuemin={el().min}
            aria-valuemax={el().max}
            aria-valuenow={el().now}
            aria-label={el().label}
          >
            <div class="row">
              <span class="label">{el().label}</span>
              <span class="num">
                <Show when={el().was !== el().now}>
                  {el().was} <Change aria-hidden="true" />
                </Show>
                {el().now}
                <Show when={!el().scale}> / {el().max}</Show>
              </span>
            </div>
            <Show
              when={el().scale}
              fallback={
                <div class="track">
                  <i class="fill" style={{ width: `${at(gain() ? el().was : el().now)}%` }} />
                  <Show when={el().was !== el().now}>
                    <i
                      class="delta"
                      data-gain={gain()}
                      data-loss={loss()}
                      style={{ left: `${at(lo())}%`, width: `${at(hi()) - at(lo())}%` }}
                    />
                  </Show>
                  <For each={el().cuts}>{(c) => <i class="tick" style={{ left: `${at(c)}%` }} />}</For>
                </div>
              }
            >
              <div class="track">
                <For each={cells()} keyed={([a, b]) => `${a}:${b}`}>
                  {(cell, i) => (
                    <span class="cell" data-here={i() === cellOf(el().now)}>
                      <Show when={el().was !== el().now && hi() > cell()[0] && lo() < cell()[1]}>
                        <i
                          class="stroke"
                          data-gain={gain()}
                          data-loss={loss()}
                          style={{
                            left: `${within(Math.max(lo(), cell()[0]), cell())}%`,
                            width: `${within(Math.min(hi(), cell()[1]), cell()) - within(Math.max(lo(), cell()[0]), cell())}%`,
                          }}
                        />
                      </Show>
                      <Show when={i() === cellOf(el().now)}>
                        <i
                          class="dot"
                          data-gain={gain()}
                          data-loss={loss()}
                          style={{ left: `${within(el().now, cell())}%` }}
                        />
                      </Show>
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <Show when={el().cuts.length}>
              <div class="marks">
                <For each={marks()} keyed={(m) => m.c}>
                  {(m) => <span style={{ left: `${m().left}%` }}>{m().c}</span>}
                </For>
              </div>
            </Show>
          </div>
        )
      }}
    </Match>
    <Match when={is(props.el, "value")}>
      {(el) => (
        <div class="row value">
          <span class="label">{el().label}</span>
          <span class="num">
            <Show when={el().was !== el().now}>
              {String(el().was)} <Change aria-hidden="true" />
            </Show>
            {String(el().now)}
          </span>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "check")}>
      {(el) => (
        <div
          class="check"
          role="img"
          aria-label={`${el().check.action}: ${el().check.hit ? "hit" : "miss"}, ${pct(el().check.chance)}`}
        >
          <div class="row">
            <Die aria-hidden="true" />
            <span class="label">{el().check.action}</span>
            <span class="badge" data-hit={el().check.hit}>
              {el().check.hit ? "Hit" : "Miss"}
            </span>
            <span class="num">{pct(el().check.chance)}</span>
          </div>
          <div class="track">
            <i class="zone" style={{ width: pct(el().check.chance) }} />
            <i class="dot" style={{ left: pct(el().check.roll) }} />
          </div>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "clue")}>
      {(el) => (
        <div class="clue">
          <Clue aria-hidden="true" />
          <p>{el().text}</p>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "product")}>
      {(el) => (
        <div class="product">
          <span class="plabel">
            {el().label} · {changeLabel(el().change)}
          </span>
          <Shaped shape={el().shape} value={el().value} />
        </div>
      )}
    </Match>
  </Switch>
)

export { demandable }

/** The full-page sheet: a native modal dialog (scrim, focus, Escape and inertness are the platform's), a titled panel
 *  with a close, the body, an optional footer. Scrim click and Escape close it (closedby). Record and Status share it;
 *  an opener either names it by `id` (invoker commands) or keeps the element through `dialog`. */
export const Sheet = (props: {
  id?: string
  dialog?: (el: HTMLDialogElement) => void
  heading: JSX.Element
  children: JSX.Element
  footer?: JSX.Element
  onClose?: () => void
}) => (
  <dialog id={props.id} class="sheet" ref={props.dialog} closedby="any" onClose={() => props.onClose?.()}>
    <header>
      <h2>{props.heading}</h2>
      <button class="icon" aria-label={t("common.close")} onClick={(e) => e.currentTarget.closest("dialog")!.close()}>
        <Close />
      </button>
    </header>
    {props.children}
    {props.footer}
  </dialog>
)

/** A turn's readings: what it changed and produced (src/record.ts). */
const RecordBody = (props: { node: Node }) => {
  const detail = createMemo(() => fetchDetail(props.node.id))
  const view = read(card)
  // equal by content: the projection is fresh each run (the log or the card view changed), and an unchanged Record
  // must not re-run its rows ([UNSTABLE_MEMO_OUTPUT] under the diagnostics when the card view is read again)
  const els = createMemo(
    () => {
      const r = view()?.rules
      return r ? record(r, detail(), view()?.layer?.products, whens(view())) : []
    },
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  )
  return (
    <div class="record">
      {/* by index: the memo yields fresh, equal elements whenever the log changes; rows update in place */}
      <For each={els()} keyed={false}>
        {(el) => <Reading el={el()} />}
      </For>
    </div>
  )
}

export const TurnRecord = (props: { node: Node }) => (
  <AsyncView>
    <RecordBody node={props.node} />
  </AsyncView>
)

/** The sibling actions on a node: Swipe (the turn again, dice and all), Reword (the same turn from narrate, keeping
 *  this turn's lookup, rolls and director brief) and Edit (the prose editable in place, App.tsx `Editor`). Three icons
 *  at the end of the row under each turn's prose (App.tsx `Section`'s footer, after the Record pill and the version
 *  count), shown the way the line's bubble shows its own (reader.css). 小剧场 is not one of them (`Demand`). */
export const Rewrite = (props: {
  rerun: boolean // the turn has an input to run the narrator from again; an opening has not, only Edit shows
  node: Id
}) => {
  const busy = read(working)
  return (
    <>
      <span class="spacer" />
      <span class="acts" role="toolbar" aria-label={t("readings.turnActions")}>
        <Show when={props.rerun}>
          <button
            type="button"
            class="icon"
            aria-label={t("common.swipe")}
            disabled={busy()}
            onClick={() => turn.swipe(props.node)}
          >
            <Swipe />
          </button>
          <button
            type="button"
            class="icon"
            aria-label={t("common.reword")}
            disabled={busy()}
            onClick={() => turn.reword(props.node)}
          >
            <Reword />
          </button>
        </Show>
        <button
          type="button"
          class="icon"
          aria-label={t("common.edit")}
          disabled={busy()}
          // the editor opens on the prose in place (App.tsx `Editor`); a second press closes it
          onClick={() => registry.set(editing, registry.get(editing) === props.node ? null : props.node)}
        >
          <Edit />
        </button>
      </span>
    </>
  )
}

/** 小剧场 in a turn's row, beside the Record pill: a menu of the theater products the node can still be asked for (the
 *  `demand` action: one record call over the node's scene, the answer kept on the node, no turn), named by the card;
 *  nothing to ask for, no button. Not a sibling action (the demand runs no narrate). A failed demand has no draft to
 *  carry its ghost: the reason shows after the menu in the row of the node that asked (store.ts `demanded`, set by the
 *  menu and by a theater block's dice alike), until the next action clears it. */
export const Demand = (props: { node: Node }) => {
  const view = read(card)
  const busy = read(working)
  const failed = read(error)
  const asked = read(demanded)
  const unresolved = () => props.node.settlementStatus === "pending" || props.node.settlementStatus === "failed"
  const demands = () => demandable(view()?.layer?.products ?? [], props.node)
  return (
    <>
      <Show when={demands().length}>
        <Menu
          presentation="auto"
          onAction={(id) => {
            dismiss()
            turn.demand(props.node.id, id)
          }}
        >
          <MenuTrigger class="btn" disabled={busy() || unresolved()}>
            {t("readings.aside")}
          </MenuTrigger>
          <MenuContent class="popup-list" side="top" align="start" sideOffset={4}>
            <For each={demands()} keyed={(o) => o.value}>
              {(o) => (
                <MenuItem value={o().value} class="item">
                  <span class="name">
                    <span class="text">{o().label}</span>
                  </span>
                </MenuItem>
              )}
            </For>
          </MenuContent>
        </Menu>
      </Show>
      <Show when={asked() === props.node.id && failed()}>
        {(f) => (
          <span class="failed">
            <Show when={f().phase}>{(p) => <span class="phase">{t(stageNames[p()])}</span>}</Show>
            {f().message}
          </span>
        )}
      </Show>
    </>
  )
}

/** A turn's 小剧场 between its prose and its row: each theater product the node has an answer for (on by default, or
 *  demanded), drawn by its shape, with one key that asks for it again (the same id demanded: history.ts replaces it in
 *  place). The key shows the way the row's own keys do (reader.css `.acts`). The draft draws its narrate blocks here
 *  too while they stream (store.ts `Draft.products`): no node yet, so no key. */
/** A streaming block's edges, as the landed one will have them (journal.ts `split` trims): no height jump when it lands. */
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v)
export const Theater = (props: { products: Readonly<Record<string, unknown>>; node?: Node }) => {
  const view = read(card)
  const busy = read(working)
  const unresolved = () => props.node?.settlementStatus === "pending" || props.node?.settlementStatus === "failed"
  const answered = () => theater(view()?.layer?.products ?? []).filter((p) => props.products[p.id] !== undefined)
  return (
    <For each={answered()} keyed={(p) => p.id}>
      {(p) => (
        <div class="product theater">
          <div class="head">
            <span class="plabel">{p().label ?? p().id}</span>
            <Show when={props.node}>
              {(n) => (
                <span class="acts">
                  <button
                    class="icon"
                    aria-label={t("readings.again")}
                    disabled={busy() || unresolved()}
                    onClick={() => (dismiss(), turn.demand(n().id, p().id))}
                  >
                    <Die />
                  </button>
                </span>
              )}
            </Show>
          </div>
          <Shaped shape={p().shape} value={trimmed(props.products[p().id])} />
        </div>
      )}
    </For>
  )
}

/** The Record pill under a turn and the sheet it opens: the turn's ledger (record.ts `record`), by the card's heading or
 *  the turn's number. While settlement is actively running on this node, the pill pulses with three dots and offers a
 *  quiet skip; an empty settled ledger has nothing to open (`marked`). The turn's own actions sit in the row beside it
 *  (`Demand`, `Rewrite`). */
export const RecordSheet = (props: { node: Node; n: number }) => {
  const all = read(log)
  const view = read(card)
  const busy = read(working)
  const [shown, setShown] = createSignal(false)
  let dlg!: HTMLDialogElement
  const settling = () => props.node.settlementStatus === "pending" && busy()
  return (
    <Switch>
      <Match when={settling()}>
        <span class="record-pill" role="status" aria-label={t("app.phaseRecord")}>
          <Record aria-hidden="true" />
          <span class="dots">
            <span />
            <span />
            <span />
          </span>
        </span>
        <button type="button" class="btn ghost sm" onClick={() => turn.skipRecord(props.node.id)}>
          {t("readings.skipRecord")}
        </button>
      </Match>
      <Match when={marked(props.node)}>
        <button class="record-pill" aria-label={t("common.record")} onClick={() => (setShown(true), dlg.showModal())}>
          <Record aria-hidden="true" />
        </button>
        <Sheet
          dialog={(el) => (dlg = el)}
          onClose={() => setShown(false)}
          heading={heading(view()?.heading, props.node, all()) ?? t("common.turnN", { n: props.n })}
        >
          <Show when={shown()}>
            <TurnRecord node={props.node} />
          </Show>
        </Sheet>
      </Match>
    </Switch>
  )
}

// ───────── Status: every field at the last node, grouped, drawn by the same readings the Record uses ─────────
export const StatusTable = () => {
  const view = read(card)
  const last = read(latest)
  const current = createMemo(() => {
    view()
    return fetchContext(last()?.node.id ?? null)
  })
  // equal by content, like the Record's: the card view read again must not re-run unchanged rows
  const groups = createMemo(
    () => {
      const r = view()?.rules
      const l = last()
      return r && l ? status(r, current().worldState.fields, whens(view())) : []
    },
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  )
  return (
    <div class="record">
      <For each={groups()} keyed={(g) => g.group ?? ""}>
        {(g) => (
          <div class="group">
            <Show when={g().group}>
              <h3>{g().group}</h3>
            </Show>
            <For each={g().items} keyed={(el) => ("path" in el ? el.path : el.kind)}>
              {(el) => <Reading el={el()} />}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}

/** The active world's server projection, fetched only while the readings page is open. */
const World = () => {
  const view = read(card)
  const line = read(path)
  const current = createMemo(() => {
    // Reading the path tracks both checkout and a settlement amendment at the same ID.
    const last = line().at(-1)
    view()
    return fetchContext(last?.id ?? null)
  })
  const now = createMemo(() => {
    const ws = (view()?.layer?.products ?? []).filter((p) => kindOf(p) === "world")
    const v = current().products
    return ws.filter((p) => fresh(v[p.id])).map((p) => ({ p, value: v[p.id] }))
  })
  return (
    <For each={now()} keyed={(x) => x.p.id}>
      {(x) => (
        <section class="world">
          <h2>{x().p.label ?? x().p.id}</h2>
          <div class="product">
            <Shaped shape={x().p.shape} value={x().value} />
          </div>
        </section>
      )}
    </For>
  )
}

/** Does the card have a 读数 page at all: a shown field, a world product. Without one the
 *  page's key is not drawn (shell.tsx `Keys`). */
export const hasReadings = (view: CardView | null | undefined) =>
  !!view && (view.rules.fields.some((f) => !f.hidden) || view.layer.products.some((p) => kindOf(p) === "world"))

/** 读数, a page over the reader: the world now, as one column: Status, and the world products' folded values.
 *  A turn's change is its Record pill's (`RecordSheet`), not this page's. */
export const StatusPage = () => (
  <div class="status-page">
    <header>
      <button type="button" class="icon" aria-label={t("common.backToStory")} onClick={close}>
        <Back />
      </button>
      <h1>{t("side.readings")}</h1>
    </header>
    <div class="status-body">
      <div class="still">
        <section class="status">
          <h2>{t("common.status")}</h2>
          <AsyncView>
            <StatusTable />
          </AsyncView>
        </section>
        <AsyncView>
          <World />
        </AsyncView>
      </div>
    </div>
  </div>
)
