// The Record's pieces: one renderer per reading element (src/record.ts projects them; this file only draws), the
// full-page sheet they sit in on the phone, the pin button, the sibling actions, and the Status table. The reader
// (App.tsx) and the inspector (inspector.tsx) draw with these.
import type { Node } from "@effect-tavern/runtime/src/session.ts"
import { type JSX } from "@solidjs/web"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Change, Close, Clue, Die, Edit, Notes, Pin, PinFill, Record, Reword, Swipe } from "./icons.tsx"
import { heading, record, status, type Element } from "./record.ts"
import { card, latest, nodes, pin, registry } from "./store.ts"

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Arms (or disarms) an untold entry as the next act's pin. */
export const PinButton = (props: { id: string }) => {
  const pinned = read(pin)
  const on = () => pinned() === props.id
  return (
    <button
      class="icon"
      aria-label="Pin"
      aria-pressed={on() ? "true" : "false"}
      onClick={() => registry.set(pin, on() ? null : props.id)}
    >
      <Show when={on()} fallback={<Pin />}>
        <PinFill />
      </Show>
    </button>
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
      {(el) => (
        <div
          class="meter"
          role="meter"
          aria-valuemin={el().min}
          aria-valuemax={el().max}
          aria-valuenow={el().now}
          aria-label={el().label}
        >
          <div class="row">
            <span class="label">{el().label}</span>
            <span class="num">
              {el().now} / {el().max}
            </span>
          </div>
          <div class="track">
            <div class="fill" style={{ width: pct((el().now - el().min) / (el().max - el().min)) }} />
          </div>
        </div>
      )}
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
          <p>{el().id}</p>
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
  </Switch>
)

/** The full-page sheet: a native modal dialog (scrim, focus, Escape and inertness are the platform's), a titled panel
 *  with a close, the body, an optional footer. Scrim click and Escape close it (closedby). Record and Status share it;
 *  an opener either names it by `id` (invoker commands) or keeps the element through `dialog`. */
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
      <button class="icon" aria-label="Close" onClick={(e) => e.currentTarget.closest("dialog")!.close()}>
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
  const els = createMemo(() => {
    const r = view()?.rules
    return r ? record(r, props.node, props.prev) : []
  })
  return (
    <div class="record">
      {/* by index: the memo yields fresh, equal elements whenever the log changes; rows update in place */}
      <For each={els()} keyed={false}>
        {(el) => <Reading el={el()} />}
      </For>
    </div>
  )
}

/** The sibling actions on a node: Swipe, Reword with a word for the narrator ("plainer"), which rides as that
 *  sibling's note, and Edit, which turns the prose into a textarea in place (App.tsx `Editor`). The Record sheet's
 *  footer on the phone, the right card's on the desktop. */
export const Rewrite = (props: {
  busy: boolean
  onSwipe: () => void
  onReword: (note?: string) => void
  onEdit: () => void
}) => {
  let direction!: HTMLInputElement
  const reword = () => {
    const note = direction.value.trim()
    direction.value = ""
    props.onReword(note || undefined)
  }
  return (
    <footer class="actions">
      <input
        class="direction"
        placeholder="A word for the rewrite…"
        disabled={props.busy}
        ref={(el) => (direction = el)}
        onKeyDown={(e) => e.key === "Enter" && !e.isComposing && (e.preventDefault(), reword())}
      />
      <button class="icon" aria-label="Swipe" disabled={props.busy} onClick={() => props.onSwipe()}>
        <Swipe />
      </button>
      <button class="icon" aria-label="Reword" disabled={props.busy} onClick={reword}>
        <Reword />
      </button>
      <button class="icon" aria-label="Edit" disabled={props.busy} onClick={() => props.onEdit()}>
        <Edit />
      </button>
    </footer>
  )
}

export const RecordSheet = (props: {
  node: Node
  n: number
  busy: boolean
  onSwipe: () => void
  onReword: (note?: string) => void
  onEdit: () => void
}) => {
  const all = read(nodes)
  const view = read(card)
  let dlg!: HTMLDialogElement
  const prev = () => (props.node.turn.parent === null ? undefined : all().get(props.node.turn.parent))
  // the pill's dot: this turn changed a field, judged a beat or told a clue (notes alone light nothing: every turn has them)
  const marked = () => {
    const r = view()?.rules
    return r !== undefined && record(r, props.node, prev()).some((e) => e.kind !== "notes")
  }
  return (
    <>
      <button class="record-pill" onClick={() => dlg.showModal()}>
        <Record aria-hidden="true" />
        Record
        <Show when={marked()}>
          <i class="dot" />
        </Show>
      </button>
      <Sheet
        dialog={(el) => (dlg = el)}
        heading={heading(view()?.heading, props.node) ?? `Turn ${props.n}`}
        footer={
          <Rewrite
            busy={props.busy}
            onSwipe={() => (dlg.close(), props.onSwipe())}
            onReword={(note) => (dlg.close(), props.onReword(note))}
            onEdit={() => (dlg.close(), props.onEdit())}
          />
        }
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
  const groups = createMemo(() => {
    const r = view()?.rules
    const l = last()
    return r && l ? status(r, l.node.state) : []
  })
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
