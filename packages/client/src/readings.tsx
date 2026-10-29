// The Record's pieces: one renderer per reading element (src/record.ts projects them; this file only draws), the
// full-page sheet they sit in on the phone, the pin button, the sibling actions a turn's row holds, and the Status
// table. The reader (App.tsx) and the inspector (inspector.tsx) draw with these.
import type { Shape, TableShape } from "@effect-tavern/runtime/src/product.ts"
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Menu, type Option } from "./controls.tsx"
import { Change, Close, Clue, Die, Edit, Notes, Pin, PinFill, Record, Reword, Swipe } from "./icons.tsx"
import { heading, record, status, type Declared, type Element } from "./record.ts"
import { card, dismiss, draft, error, latest, log, pin, registry, stage, type CardView } from "./store.ts"
import { t } from "./i18n.ts"

const pct = (x: number) => `${Math.round(x * 100)}%`
/** The conditions a meter's stages come from: the fiction variants' `when` (src/record.ts `cuts`). */
export const whens = (view: CardView | null | undefined) => view?.fiction.map((f) => f.when) ?? []

/** Arms (or disarms) an untold entry as the next act's pin. */
export const PinButton = (props: { id: string }) => {
  const pinned = read(pin)
  const on = () => pinned() === props.id
  return (
    <button
      class="icon"
      aria-label={t("readings.pin")}
      aria-pressed={on() ? "true" : "false"}
      onClick={() => registry.set(pin, on() ? null : props.id)}
    >
      <Show when={on()} fallback={<Pin />}>
        <PinFill />
      </Show>
    </button>
  )
}

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
            <For each={r().keys} keyed={(k) => k.key}>
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
          <Show when={el().pinnable}>
            <PinButton id={el().id} />
          </Show>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "pin")}>
      {(el) => (
        <div class="clue">
          <Pin aria-hidden="true" />
          <p>{el().hook}</p>
          <span class="badge" data-hit={el().told}>
            {el().told ? "Told" : "Untold"}
          </span>
          <Show when={!el().told}>
            <PinButton id={el().id} />
          </Show>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "notes")}>
      {(el) => (
        <div class="notes">
          <Notes aria-hidden="true" />
          <ul>
            <For each={el().items} keyed={false}>
              {(n) => <li>{n()}</li>}
            </For>
          </ul>
        </div>
      )}
    </Match>
    <Match when={is(props.el, "product")}>
      {(el) => (
        <div class="product">
          <span class="plabel">{el().label}</span>
          <Shaped shape={el().shape} value={el().value} />
        </div>
      )}
    </Match>
  </Switch>
)

/** The products a node can still be asked for (the `demand` action): declared, and not on the node (off by the
 *  player, or not produced this turn); one asked for leaves the list as it lands. */
export const demandable = (products: readonly Declared[], node: Node): Option<string>[] =>
  products.filter((p) => node.turn.products[p.id] === undefined).map((p) => ({ value: p.id, label: p.label ?? p.id }))

/** The full-page sheet: a native modal dialog (scrim, focus, Escape and inertness are the platform's), a titled panel
 *  with a close, the body, an optional footer (the cleanup's). Scrim click and Escape close it (closedby). Record and
 *  Status share it; an opener either names it by `id` (invoker commands) or keeps the element through `dialog`. */
export const Sheet = (props: {
  id?: string
  dialog?: (el: HTMLDialogElement) => void
  heading: JSX.Element
  children: JSX.Element
  footer?: JSX.Element
}) => (
  <dialog id={props.id} class="sheet" ref={props.dialog} closedby="any">
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
export const TurnRecord = (props: { node: Node; prev: Node | undefined }) => {
  const view = read(card)
  // equal by content: the projection is fresh each run (the log or the card view changed), and an unchanged Record
  // must not re-run its rows ([UNSTABLE_MEMO_OUTPUT] under the diagnostics when the card view is read again)
  const els = createMemo(
    () => {
      const r = view()?.rules
      return r ? record(r, props.node, props.prev, view()?.products, whens(view())) : []
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

/** The sibling actions on a node: Swipe (the turn again, dice and all), Reword (the same turn, new prose: the wand
 *  opens a box for a word to the narrator, which rides as that sibling's note; Enter sends, empty or not, and so does
 *  the wand again) and Edit (the prose editable in place, App.tsx `Editor`). Three icons with hints; the box exists
 *  only while the wand is asking, where the row's spacer was. Then 小剧场: a menu of the products this node can still
 *  be asked for (the `demand` action: one record call over this node's scene, the answer kept on the node, no turn),
 *  named by the card; nothing to ask for, the button is off. The pieces of the row under each turn's prose (App.tsx
 *  `Section`'s footer, after the Record pill and the version count): the box, then the keys as one `.acts` group,
 *  which the row shows the way the line's bubble shows its own (reader.css). */
export const Rewrite = (props: {
  rerun: boolean // the turn has an input to run the narrator from again; an opening has not, only Edit shows
  busy: boolean
  demands: readonly Option<string>[]
  onSwipe: () => void
  onReword: (note?: string) => void
  onEdit: () => void
  onDemand: (product: string) => void
}) => {
  const [asking, setAsking] = createSignal(false)
  // a demand runs a stage without a draft: while any stage runs, the actions wait (a turn's draft already holds them)
  const phase = read(stage)
  const busy = () => props.busy || phase() !== null
  // a failed demand has no draft to carry its ghost: the reason shows here until the next action
  const d = read(draft)
  const failed = read(error)
  let direction: HTMLInputElement | undefined
  const reword = () => {
    const note = direction?.value.trim()
    setAsking(false)
    props.onReword(note || undefined)
  }
  return (
    <>
      <Show when={asking()} fallback={<span class="spacer" />}>
        <input
          class="direction"
          placeholder={t("readings.rewordPlaceholder")}
          disabled={busy()}
          ref={(el) => {
            direction = el
            requestAnimationFrame(() => el.focus())
          }}
          onKeyDown={(e) => {
            if (e.isComposing) return
            if (e.key === "Enter") {
              e.preventDefault()
              reword()
            } else if (e.key === "Escape") setAsking(false)
          }}
          onBlur={() => !direction?.value.trim() && setAsking(false)}
        />
      </Show>
      <Show when={!d() && failed()}>{(f) => <span class="failed">{f().message}</span>}</Show>
      <span class="acts" role="toolbar" aria-label={t("readings.turnActions")}>
        <Show when={props.rerun}>
          <button class="icon" aria-label={t("common.swipe")} disabled={busy()} onClick={() => props.onSwipe()}>
            <Swipe />
          </button>
          <button
            class="icon"
            aria-label={t("common.reword")}
            aria-expanded={asking() ? "true" : "false"}
            disabled={busy()}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => (asking() ? reword() : setAsking(true))}
          >
            <Reword />
          </button>
        </Show>
        <button class="icon" aria-label={t("common.edit")} disabled={busy()} onClick={() => props.onEdit()}>
          <Edit />
        </button>
        <Menu
          action={t("readings.aside")}
          label={t("readings.aside")}
          value={undefined}
          options={busy() ? [] : props.demands}
          onPick={(id) => (dismiss(), props.onDemand(id))}
        />
      </span>
    </>
  )
}

/** The Record pill under a turn and the readings panel it opens: what the turn changed and produced, by the card's
 *  heading or the turn's number. Only readings: the turn's actions sit in the row beside the pill (`Rewrite`). */
export const RecordSheet = (props: { node: Node; n: number }) => {
  const all = read(log)
  const view = read(card)
  let dlg!: HTMLDialogElement
  const prev = () => (props.node.parent === null ? undefined : all().nodes.get(props.node.parent))
  // the pill's dot: this turn changed a field, judged a beat, told a clue or holds a product (notes alone light
  // nothing: every turn has them)
  const marked = () => {
    const r = view()?.rules
    return r !== undefined && record(r, props.node, prev(), view()?.products).some((e) => e.kind !== "notes")
  }
  return (
    <>
      <button class="record-pill" aria-label={t("common.record")} onClick={() => dlg.showModal()}>
        <Record aria-hidden="true" />
        <Show when={marked()}>
          <i class="dot" />
        </Show>
      </button>
      <Sheet
        dialog={(el) => (dlg = el)}
        heading={heading(view()?.heading, props.node) ?? t("common.turnN", { n: props.n })}
      >
        <TurnRecord node={props.node} prev={prev()} />
      </Sheet>
    </>
  )
}

// ───────── Status: every field at the last node, grouped, drawn by the same readings the Record uses ─────────
export const StatusTable = () => {
  const view = read(card)
  const last = read(latest)
  // equal by content, like the Record's: the card view read again must not re-run unchanged rows
  const groups = createMemo(
    () => {
      const r = view()?.rules
      const l = last()
      return r && l ? status(r, l.node.state, whens(view())) : []
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

/** The scene list: the reading line folded into runs of one title (the card's `heading`); a row scrolls to the run's
 *  first section. Nothing when the card declares no heading. */
