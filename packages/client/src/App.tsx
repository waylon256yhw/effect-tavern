// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom, a slim bar on top
// whose Status button opens the full state table. Under each section a Record pill opens a full-page sheet of that
// turn's readings (src/record.ts projects them; this file only draws); the last section carries the Options container,
// whose rows fill the composer and never send. From 64rem the same pieces sit on three cards: title and pin on the
// left, the reading in the middle, Status and this turn's Record inline on the right. Shapes follow
// docs/client-design-brief-3.md and the canvas in docs/client-canvas/. The sheets are native <dialog>s, the snippet
// menu a popover anchored to its button: the platform is the component library.
import type { Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import type * as Atom from "effect/reactivity/Atom"
import { type JSX } from "@solidjs/web"
import { type Accessor, createMemo, createSignal, For, Match, onSettled, runWithOwner, Show, Switch } from "solid-js"
import {
  Change,
  Close,
  Clue,
  Contents,
  Die,
  DieFill,
  Down,
  Insert,
  Next,
  Notes,
  Pin,
  PinFill,
  Prev,
  Record,
  Reword,
  Send,
  Snippets,
  Status,
  Stop,
  Swipe,
  Warning,
} from "./icons.tsx"
import { dust } from "./dust.ts"
import { imeController } from "./ime.ts"
import { heading, record, scenes, status, type Element } from "./record.ts"
import {
  active,
  aside,
  card,
  childrenOf,
  compose,
  draft,
  type Draft,
  error,
  latest,
  nodes,
  path,
  pin,
  prose,
  registry,
  stage,
  withdraw,
  type Id,
} from "./store.ts"
import { fetchCard, fetchNodes, send } from "./wire.ts"

/** An atom as a Solid accessor: one signal per atom for the page's life, owned by no component, like the registry it
 *  mirrors (store.ts). The registry notifies synchronously from whoever wrote; Solid applies on the next microtask. */
const signals = new WeakMap<Atom.Atom<unknown>, Accessor<unknown>>()
const read = <A,>(atom: Atom.Atom<A>): Accessor<A> => {
  let s = signals.get(atom)
  if (!s) {
    const [get, set] = runWithOwner(null, () => createSignal<A>(registry.get(atom) as Exclude<A, Function>))!
    registry.subscribe(atom, (v) => set(() => v))
    signals.set(atom, (s = get))
  }
  return s as Accessor<A>
}

const waiting: Record<string, string> = {
  lookup: "Reading",
  decide: "Rolling",
  direct: "Directing",
  narrate: "Writing",
  check: "Checking",
  record: "Recording",
}
const pct = (x: number) => `${Math.round(x * 100)}%`

/** Prose as paragraphs; `tail` lands in the last one (the draft's cursor), which exists even before the first word. */
const Paragraphs = (props: { text: string; tail?: JSX.Element }) => {
  const ps = createMemo(() => {
    const ps = props.text.split(/\n{2,}/).filter((p) => p.trim())
    return ps.length || !("tail" in props) ? ps : [""]
  })
  const last = createMemo(() => ps().length - 1)
  return (
    <For each={ps()} keyed={false}>
      {(p, i) => (
        <p>
          {p()}
          {i === last() && props.tail}
        </p>
      )}
    </For>
  )
}

/** Following the live edge the way every chat reader does (Cherry Studio's state, open-claude-ui's constants): one
 *  state that only the user's intent flips. A scroll event the program did not cause is the user's (content growing
 *  under the viewport fires none): past 40px from the bottom they are reading, back within it they follow again;
 *  growth while following sticks to the bottom unless their hand was on the page within 150ms; the way back shows
 *  past 120px. The one deviation is the anchor: a new turn lands at its own top, where the last section's min-height
 *  puts the column's end at the scroller's bottom, so following holds from there. Programmatic scrolls are instant: a
 *  smooth one fires many events no one could attribute. The scroller is the column (.scroll), never the page. */
const follow = { on: true, ours: null as number | null, touched: -Infinity }
const scroller = () => document.querySelector(".scroll")!
const gap = () => scroller().scrollHeight - scroller().clientHeight - scroller().scrollTop
const anchor = () => {
  follow.on = true
  document.querySelector("main > section:last-of-type")?.scrollIntoView({ block: "start", behavior: "instant" })
  follow.ours = scroller().scrollTop
}
const stick = () => {
  scroller().scrollTo({ top: scroller().scrollHeight, behavior: "instant" })
  follow.ours = scroller().scrollTop
}
const Latest = () => {
  const [away, setAway] = createSignal(false)
  onSettled(() => {
    const onScroll = () => {
      const g = gap()
      setAway(g > 120)
      const t = follow.ours
      follow.ours = null
      if (t === null || Math.abs(scroller().scrollTop - t) > 2) follow.on = g <= 40
    }
    const onInput = () => {
      follow.touched = performance.now()
    }
    // opening included: the first growth is the story loading, and following from the start lands at its live edge;
    // the scroller shrinking (the composer growing under it) is the same event from the other side
    const ro = new ResizeObserver(() => {
      if (follow.on && performance.now() - follow.touched >= 150) stick()
      setAway(!follow.on && gap() > 120)
    })
    ro.observe(document.querySelector("main")!)
    ro.observe(scroller())
    const inputs = ["wheel", "touchmove", "keydown", "pointerdown"] as const
    scroller().addEventListener("scroll", onScroll, { passive: true })
    for (const e of inputs) addEventListener(e, onInput, { passive: true })
    return () => {
      ro.disconnect()
      scroller().removeEventListener("scroll", onScroll)
      for (const e of inputs) removeEventListener(e, onInput)
    }
  })
  return (
    <Show when={away()}>
      <button
        type="button"
        class="icon latest"
        aria-label="Jump to latest"
        onClick={() => {
          follow.on = true
          stick()
        }}
      >
        <Down />
      </button>
    </Show>
  )
}

/** The node being written: anchored at the top of the screen when it starts, a blinking cursor where the next
 *  character lands, the die while the beat is judged. A rewrite (check failed) blows the first draft away as dust
 *  (Telegram's) and writes the second from the top; the dead draft keeps its place, so the column holds still. Once the
 *  prose is done (check, record) the cursor goes and the Record slot waits with three dots. A failed turn stays as a
 *  grey ghost with the error under it; its line is back in the box. */
const Draft = (props: { d: Draft; phase: Phase | null; error: string | null }) => {
  onSettled(anchor)
  const settling = () => props.phase === "check" || props.phase === "record"
  const writing = () => !settling() && !props.error
  return (
    <section class={{ draft: true, dead: props.error !== null }}>
      <Said input={props.d.input} />
      <div class="drafts">
        <Show when={props.d.prev}>
          {(p) => (
            <div class="prev" aria-hidden="true" ref={(el: HTMLElement) => void dust(el)}>
              <Paragraphs text={p()} />
            </div>
          )}
        </Show>
        <div class="now">
          <Paragraphs
            text={props.d.text}
            tail={
              <Show when={writing()}>
                <span class="cursor" role="status" aria-label={props.phase ? waiting[props.phase] : "Waiting"}>
                  <Show when={props.phase === "decide"}>
                    <DieFill />
                  </Show>
                </span>
              </Show>
            }
          />
        </div>
      </div>
      <Show when={settling()}>
        <footer class="actions">
          <span class="record-pill" role="status" aria-label={waiting[props.phase!]}>
            <Record aria-hidden="true" />
            <span class="dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        </footer>
      </Show>
      <Show when={props.error}>
        {(e) => (
          <p class="error" role="alert">
            <Warning aria-hidden="true" />
            {e()}
          </p>
        )}
      </Show>
    </section>
  )
}

const Said = (props: { input: { text: string; note?: string } }) => (
  <Switch>
    <Match when={props.input.text}>
      <p class="said">{props.input.text}</p>
    </Match>
    <Match when={props.input.note}>
      <p class="said note">{props.input.note}</p>
    </Match>
  </Switch>
)

// ───────── The Record sheet: one renderer per element kind ─────────
/** Arms (or disarms) an untold entry as the next act's pin. */
const PinButton = (props: { id: string }) => {
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

const Reading = (props: { el: Element }) => (
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
const Sheet = (props: {
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
const TurnRecord = (props: { node: Node; prev: Node | undefined }) => {
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

const RecordSheet = (props: { node: Node; n: number; busy: boolean; onSwipe: () => void; onReword: () => void }) => {
  const all = read(nodes)
  const view = read(card)
  let dlg!: HTMLDialogElement
  return (
    <>
      <button class="record-pill" onClick={() => dlg.showModal()}>
        <Record aria-hidden="true" />
        Record
      </button>
      <Sheet
        dialog={(el) => (dlg = el)}
        heading={heading(view()?.heading, props.node) ?? `Turn ${props.n}`}
        footer={
          <footer class="actions">
            <span class="spacer" />
            <button
              class="icon"
              aria-label="Swipe"
              disabled={props.busy}
              onClick={() => (dlg.close(), props.onSwipe())}
            >
              <Swipe />
            </button>
            <button
              class="icon"
              aria-label="Reword"
              disabled={props.busy}
              onClick={() => (dlg.close(), props.onReword())}
            >
              <Reword />
            </button>
          </footer>
        }
      >
        <TurnRecord
          node={props.node}
          prev={props.node.turn.parent === null ? undefined : all().get(props.node.turn.parent)}
        />
      </Sheet>
    </>
  )
}

// ───────── Status: every field at the last node, grouped, drawn by the same readings the Record uses ─────────
const StatusTable = () => {
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
const Scenes = () => {
  const view = read(card)
  const line = read(path)
  const runs = createMemo(() => scenes(view()?.heading, line()))
  return (
    <Show when={runs().length}>
      <nav class="scenes" aria-label="Scenes">
        <For each={runs()} keyed={(s) => s.id}>
          {(s) => (
            <button
              class="scene"
              onClick={(e) => {
                e.currentTarget.closest("dialog")?.close()
                document.getElementById(`node-${s().id}`)?.scrollIntoView({ block: "start" })
              }}
            >
              {s().title}
            </button>
          )}
        </For>
      </nav>
    </Show>
  )
}

/** The slim bar on top: the card's title, Contents (the scene list) and Status with a dot when this turn changed the state. */
const Topbar = () => {
  const view = read(card)
  const last = read(latest)
  const changed = createMemo(() => {
    const r = view()?.rules
    const l = last()
    return r !== undefined && l !== null && record(r, l.node, l.prev).some((e) => "path" in e)
  })
  return (
    <header class="topbar">
      <Show when={view()?.title}>{(t) => <h1>{t()}</h1>}</Show>
      <Show when={view()?.heading !== undefined}>
        <button class="icon" aria-label="Contents" commandfor="contents" command="show-modal">
          <Contents />
        </button>
        <Sheet id="contents" heading="Contents">
          <Scenes />
        </Sheet>
      </Show>
      <button class="icon" aria-label="Status" commandfor="status" command="show-modal">
        <Status />
        <Show when={changed()}>
          <i class="dot" />
        </Show>
      </button>
      <Sheet id="status" heading="Status">
        <StatusTable />
      </Sheet>
    </header>
  )
}

/** The raised container of this turn's options: a row fills the composer, never sends. */
const Options = (props: { items: readonly string[] }) => (
  <div class="options">
    <header>
      <Reword aria-hidden="true" />
      Options
    </header>
    <For each={props.items} keyed={false}>
      {(t, i) => (
        <button class="option" onClick={() => registry.set(compose, t())}>
          <span class="n">{i + 1}</span>
          <span>{t()}</span>
          <Insert aria-hidden="true" />
        </button>
      )}
    </For>
  </div>
)

const Section = (props: {
  node: Node
  n: number
  last: boolean
  busy: boolean
  onSwipe: () => void
  onReword: () => void
}) => {
  const all = read(nodes)
  const siblings = createMemo(() => childrenOf(all(), props.node.turn.parent))
  const at = () => siblings().findIndex((s) => s.turn.id === props.node.turn.id)
  const go = (i: number) => {
    const parent = props.node.turn.parent
    const id = siblings()[i]!.turn.id
    registry.update(active, (m) => new Map(m).set(parent, id))
  }
  const options = () => props.node.turn.products.options as readonly string[] | undefined
  return (
    <section id={`node-${props.node.turn.id}`}>
      <Said input={props.node.turn.input} />
      <Paragraphs text={prose(props.node)} />
      <footer class="actions">
        <RecordSheet
          node={props.node}
          n={props.n}
          busy={props.busy}
          onSwipe={props.onSwipe}
          onReword={props.onReword}
        />
        <Show when={siblings().length > 1}>
          <span class="siblings">
            <button class="icon" aria-label="Previous version" disabled={at() === 0} onClick={() => go(at() - 1)}>
              <Prev />
            </button>
            {at() + 1}/{siblings().length}
            <button
              class="icon"
              aria-label="Next version"
              disabled={at() === siblings().length - 1}
              onClick={() => go(at() + 1)}
            >
              <Next />
            </button>
          </span>
        </Show>
        <Show when={props.node.turn.end === "stopped"}>
          <span class="end">Stopped</span>
        </Show>
      </footer>
      <Show when={props.last && options()?.length}>
        <Options items={options()!} />
      </Show>
    </section>
  )
}

const Composer = (props: {
  busy: boolean
  stoppable: boolean // the prose can still be halted: before and during narrate, not while the turn settles
  onSend: (text: string, note: boolean) => void
  onStop: () => void
}) => {
  const text = read(compose)
  const pinned = read(pin)
  const view = read(card)
  // The card's default channel is the mode for the whole session (GET /card `input`): in participant mode the box is the
  // character's line and a note to the narrator or a thought is this turn's deviation; in author mode every input is
  // direction and neither exists.
  const acting = () => view()?.input === "act"
  const quick = () => view()?.snippets ?? []
  // The snippets menu groups by meaning: a note snippet is a word to the narrator, the rest stay in the story.
  const inStory = () => quick().filter((s) => !s.note)
  const toNarrator = () => quick().filter((s) => s.note)
  const keys = () => view()?.format ?? []
  // This one send is a note (participant mode only). It is one state, not a tag per snippet: any number of note snippets
  // may go into the box, the chip says only where the send goes; it clears after the send.
  const toNarratorOn = read(aside)
  const isNote = () => !acting() || toNarratorOn()
  // The placeholder is one line of invitation; the keys live on the buttons' tooltips, not in the writing space.
  const prompt = () => (isNote() ? "To the narrator, not in the story…" : "Your line…")
  let box: HTMLTextAreaElement | undefined
  let menu: HTMLDivElement | undefined
  const put = (value: string, caret: number) => {
    registry.set(compose, value)
    requestAnimationFrame(() => {
      box?.focus()
      box?.setSelectionRange(caret, caret)
    })
  }
  // An Insert (a format key or a snippet) goes in at the caret and never sends: `text` before the caret, `after`
  // behind it, the selection between them. A note snippet also switches this send's channel; an empty one does only that.
  const insert = (s: { text: string; after?: string; note?: boolean }) => {
    menu?.hidePopover()
    if (s.note) registry.set(aside, true)
    const v = text()
    const a = box?.selectionStart ?? v.length
    const b = box?.selectionEnd ?? a
    const inner = v.slice(a, b)
    put(v.slice(0, a) + s.text + inner + (s.after ?? "") + v.slice(b), a + s.text.length + inner.length)
  }
  const Items = (p: { of: readonly Snippet[] }) => (
    <For each={p.of} keyed={(s) => s.name}>
      {(s) => (
        <button type="button" role="menuitem" class="item" tabindex="-1" onClick={() => insert(s())}>
          <span class="name">{s().name}</span>
          <span class="hint">{s().hint}</span>
          {/* a snippet with words fills the box, like an Options row; a mark or the bare channel switch does not */}
          <Show when={s().text && !s().after}>
            <Insert aria-hidden="true" />
          </Show>
        </button>
      )}
    </For>
  )
  const submit = () => {
    const t = text().trim()
    if (!t || props.busy) return false
    props.onSend(t, isNote())
    registry.set(compose, "")
    registry.set(aside, false)
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  const keep = (e: Event) => e.preventDefault() // a tap on a control must not take focus (and the phone's keyboard) from the box
  // The menu's keyboard: arrows move focus among the items and wrap, Home/End jump; Tab leaves the menu and closes it;
  // Escape and outside clicks are the popover's.
  const roam = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")]
    const i = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
    const d = { ArrowDown: 1, ArrowUp: -1, Home: -i, End: items.length - 1 - i }[e.key]
    if (d === undefined) return
    e.preventDefault()
    items.at((i + d) % items.length)?.focus()
  }
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div
        class="box"
        // The whole box is the input: a press on its padding or the keys row lands in the text, never blurs it.
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, textarea, [popover]")) return
          e.preventDefault()
          box?.focus()
        }}
      >
        <Show when={keys().length > 0}>
          <div class="format" aria-label="Format keys">
            <For each={keys()} keyed={(k) => k.label}>
              {(k) => (
                <button type="button" class="chip" onPointerDown={keep} onClick={() => insert(k())}>
                  {k().label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <textarea
          ref={(el) => (box = el)}
          value={text()}
          placeholder={prompt()}
          enterkeyhint="enter"
          onInput={(e) => registry.set(compose, e.currentTarget.value)}
          onCompositionStart={ime.compositionStart}
          onCompositionEnd={ime.compositionEnd}
          onKeyDown={(e) => {
            // "/" on an empty box opens the snippets menu: the keyboard's way to the same menu, no command grammar.
            if (e.key === "/" && !e.isComposing && text() === "" && menu) {
              e.preventDefault()
              menu.showPopover()
            } else ime.keyDown(e)
          }}
        />
        <div class="row">
          <Show when={quick().length > 0}>
            <button
              type="button"
              class="icon"
              aria-label="Snippets"
              data-hint="Snippets /"
              aria-haspopup="menu"
              popovertarget="snippets"
            >
              <Snippets />
            </button>
            <div
              id="snippets"
              class="snippets"
              popover
              role="menu"
              ref={(el) => (menu = el)}
              onKeyDown={roam}
              onFocusOut={(e) => !menu?.contains(e.relatedTarget as HTMLElement | null) && menu?.hidePopover()}
              onToggle={(e) =>
                e.newState === "open" && e.currentTarget.querySelector<HTMLElement>("[role=menuitem]")?.focus()
              }
            >
              {/* two groups, in the story and to the narrator, parted by a line: the items are the card's language, the chrome adds no words */}
              <Items of={inStory()} />
              <hr />
              <Items of={toNarrator()} />
            </div>
          </Show>
          <Show when={acting() && toNarratorOn()}>
            <button
              type="button"
              class="chip state"
              aria-label="Back to your line"
              onPointerDown={keep}
              onClick={() => registry.set(aside, false)}
            >
              To the narrator
              <Close />
            </button>
          </Show>
          <Show when={pinned()}>
            <button type="button" class="icon" aria-label="Unpin" onClick={() => registry.set(pin, null)}>
              <PinFill />
            </button>
          </Show>
          <span class="spacer" />
          <Show
            when={props.busy && props.stoppable}
            fallback={
              <button
                type="submit"
                class="send"
                aria-label="Send"
                data-hint="Send ⌘↵"
                disabled={!text().trim() || props.busy}
                onPointerDown={keep}
              >
                <Send />
              </button>
            }
          >
            <button type="button" class="send" aria-label="Stop" onPointerDown={keep} onClick={() => props.onStop()}>
              <Stop />
            </button>
          </Show>
        </div>
      </div>
    </form>
  )
}

const Reader = () => {
  const line = read(path)
  const d = read(draft)
  const phase = read(stage)
  const err = read(error)
  const busy = () => d() !== null && err() === null // a ghost draft (failed turn) holds nothing up
  let stop: (() => void) | null = null
  onSettled(() => void Promise.all([fetchCard(), fetchNodes()]))

  const start = (parent: Id | null, input: { text: string; note?: string }, action: Parameters<typeof send>[0]) => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text: "" })
    stop = send(action)
  }
  const onSend = (text: string, note: boolean) => {
    const parent = registry.get(path).at(-1)?.turn.id ?? null
    const pinned = registry.get(pin)
    const input = { ...(note ? { text: "", note: text } : { text }), ...(pinned ? { pin: pinned } : {}) }
    registry.set(pin, null)
    start(parent, input, { kind: "act", parent, input })
  }
  const onSwipe = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "swipe", node: n.turn.id })
  const onReword = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "reword", node: n.turn.id })
  const onStop = async () => {
    if (!stop) return
    stop()
    // Before the first character the turn is withdrawn; after it, the server finishes a `stopped` node the closed
    // response never carried, so read the snapshot back until it shows up.
    const was = registry.get(nodes).size
    if ((registry.get(draft)?.text ?? "") === "") {
      withdraw()
      return registry.set(draft, null)
    }
    registry.set(stage, "record") // what the server is doing with the cut prose; the Record slot waits for it
    for (let i = 0; i < 100 && registry.get(nodes).size === was; i++) {
      await new Promise((r) => setTimeout(r, 300))
      await fetchNodes()
    }
    registry.set(draft, null)
    registry.set(stage, null)
  }

  return (
    <div class="panel">
      <div class="scroll">
        <main>
          {/* keyed by id: a snapshot read back (after a stop) refreshes each section in place instead of rebuilding them */}
          <For each={line()} keyed={(n) => n.turn.id}>
            {(n, i) => (
              <Section
                node={n()}
                n={i() + 1}
                last={!d() && i() === line().length - 1}
                busy={busy()}
                onSwipe={() => onSwipe(n())}
                onReword={() => onReword(n())}
              />
            )}
          </For>
          <Show when={d()}>{(dr) => <Draft d={dr()} phase={phase()} error={err()} />}</Show>
        </main>
      </div>
      <Composer busy={busy()} stoppable={phase() !== "check" && phase() !== "record"} onSend={onSend} onStop={onStop} />
      <Latest />
    </div>
  )
}

/** Desktop's left card: the title, the scene list, and the armed pin. */
const Side = () => {
  const view = read(card)
  const pinned = read(pin)
  return (
    <aside class="side">
      <Show when={view()?.title}>{(t) => <h1>{t()}</h1>}</Show>
      <Scenes />
      <Show when={pinned()}>
        {(p) => (
          <section class="pinned">
            <h2>Pinned</h2>
            <p>
              <Pin aria-hidden="true" />
              <span>{p()}</span>
            </p>
          </section>
        )}
      </Show>
    </aside>
  )
}

/** Desktop's right card: the Status table and this turn's Record, inline. */
const Glance = () => {
  const last = read(latest)
  return (
    <aside class="side">
      <section class="status">
        <h2>Status</h2>
        <StatusTable />
      </section>
      <Show when={last()}>
        {(l) => (
          <section>
            <h2>Record</h2>
            <TurnRecord node={l().node} prev={l().prev} />
          </section>
        )}
      </Show>
    </aside>
  )
}

export const App = () => (
  <div class="canvas">
    <Topbar />
    <Side />
    <Reader />
    <Glance />
  </div>
)
