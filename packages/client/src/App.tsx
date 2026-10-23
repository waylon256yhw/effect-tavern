// One screen: the reading line as sections, the draft growing at its end, a composer at the bottom, a slim bar on top
// whose Status button opens the full state table. Under each section a Record pill opens a full-page sheet of that
// turn's readings (src/record.ts projects them; this file only draws); the last section carries the Options container,
// whose rows fill the composer and never send. From 64rem the same pieces sit on three cards: title and pin on the
// left, the reading in the middle, Status and this turn's Record inline on the right. Shapes follow
// docs/client-design-brief-3.md and the canvas in docs/client-canvas/. The sheets are native <dialog>s, the snippet
// menu a popover anchored to its button: the platform is the component library. This file is the reader: the flow,
// the bar, the side cards; readings.tsx draws the Record's pieces, composer.tsx the box, inspector.tsx the Inspect
// page, bridge.ts the atom → accessor read they all use.
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import { type JSX } from "@solidjs/web"
import { createMemo, createSignal, For, Match, onSettled, Show, Switch } from "solid-js"
import { read } from "./bridge.ts"
import { Composer } from "./composer.tsx"
import { dust } from "./dust.ts"
import { imeController } from "./ime.ts"
import {
  Check,
  Close,
  Contents,
  DieFill,
  Down,
  Edit,
  Insert,
  Next,
  Pin,
  Prev,
  Record,
  Reword,
  Status,
  Swipe,
  Warning,
} from "./icons.tsx"
import { Inspect } from "./inspector.tsx"
import { Timeline } from "./timeline.tsx"
import { RecordSheet, Rewrite, Sheet, StatusTable, TurnRecord } from "./readings.tsx"
import { record, scenes } from "./record.ts"
import {
  apply,
  arrived,
  aside,
  card,
  clear,
  compose,
  dismiss,
  type Draft,
  draft,
  editing,
  error,
  type Id,
  page,
  latest,
  log,
  path,
  pin,
  prose,
  registry,
  revising,
  settle,
  stage,
  withdraw,
} from "./store.ts"
import { fetchCard, fetchNodes, send } from "./wire.ts"

const waiting: Record<string, string> = {
  lookup: "Reading",
  decide: "Rolling",
  direct: "Directing",
  narrate: "Writing",
  check: "Checking",
  record: "Recording",
}

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

/** The prose in place as a textarea (Edit): ⌘↵ sends it as an `edit` sibling (check and record run over the player's
 *  text, nothing is narrated), Escape cancels, and so does sending it unchanged or empty. Bare Enter is a paragraph.
 *  Two keys under it do the same for a touch screen, which has neither. */
const Editor = (props: { text: string; onDone: (text?: string) => void }) => {
  let box!: HTMLTextAreaElement
  const submit = () => {
    const t = box.value.trim()
    props.onDone(t && t !== props.text ? t : undefined)
    return true
  }
  // oxlint-disable-next-line solid/reactivity -- submit runs inside the keydown handler, where its reads are current
  const ime = imeController(submit)
  onSettled(() => {
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
  })
  return (
    <>
      <textarea
        class="editor"
        aria-label="Edit the prose"
        ref={(el) => (box = el)}
        value={props.text}
        onCompositionStart={ime.compositionStart}
        onCompositionEnd={ime.compositionEnd}
        onKeyDown={(e) => (e.key === "Escape" ? props.onDone() : ime.keyDown(e))}
      />
      <div class="editkeys">
        <button type="button" class="icon" aria-label="Cancel" data-hint="Cancel Esc" onClick={() => props.onDone()}>
          <Close />
        </button>
        <button type="button" class="icon" aria-label="Save" data-hint="Save ⌘↵" onClick={submit}>
          <Check />
        </button>
      </div>
    </>
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
            <button type="button" class="icon" aria-label="Dismiss" onClick={dismiss}>
              <Close />
            </button>
          </p>
        )}
      </Show>
    </section>
  )
}

/** The player's line, and the word to the narrator when one rides with it (a note-only turn is that word alone). */
const Said = (props: { input: { text: string; note?: string }; onEdit?: (field: "text" | "note") => void }) => {
  // on a landed node the bubble is the way to revise the line: it goes back into the composer (Cherry Studio's edit)
  const Bubble = (p: { field: "text" | "note"; text: string }) => (
    <Show when={props.onEdit} fallback={<p class={{ said: true, note: p.field === "note" }}>{p.text}</p>}>
      <button
        type="button"
        class={{ said: true, note: p.field === "note" }}
        aria-label={p.field === "note" ? "Revise your note" : "Revise your line"}
        onClick={() => {
          props.onEdit!(p.field)
          document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()
        }}
      >
        <span>{p.text}</span>
        <Edit aria-hidden="true" />
      </button>
    </Show>
  )
  return (
    <>
      <Show when={props.input.text}>
        <Bubble field="text" text={props.input.text} />
      </Show>
      <Show when={props.input.note}>
        <Bubble field="note" text={props.input.note!} />
      </Show>
    </>
  )
}

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
  onReword: (note?: string) => void
  onEdit: (text?: string) => void // without text: open the editor; with it: send the edit; `undefined` from the editor: cancel
  onRevise: (field: "text" | "note") => void // the player's line back into the composer
}) => {
  const all = read(log)
  const edited = read(editing)
  const siblings = createMemo(() => L.children(all(), props.node.parent))
  // versions that differ in the player's line are told apart by it; otherwise by the prose
  const varied = createMemo(() => new Set(siblings().map((v) => `${v.turn.input.text}\n${v.turn.input.note}`)).size > 1)
  let list: HTMLDivElement | undefined
  const at = () => siblings().findIndex((s) => s.id === props.node.id)
  // the version's whole follow-up comes back: the server moves head to its newest leaf
  const go = (i: number) => send({ kind: "checkout", node: siblings()[i]!.id })
  const options = () => props.node.turn.products.options as readonly string[] | undefined
  return (
    <section id={`node-${props.node.turn.id}`}>
      <Said input={props.node.turn.input} onEdit={(f) => props.onRevise(f)} />
      <Show when={edited() === props.node.turn.id} fallback={<Paragraphs text={prose(props.node)} />}>
        <Editor text={prose(props.node)} onDone={(t) => props.onEdit(t)} />
      </Show>
      <footer class="actions">
        <RecordSheet
          node={props.node}
          n={props.n}
          busy={props.busy}
          onSwipe={props.onSwipe}
          onReword={props.onReword}
          onEdit={() => props.onEdit()}
        />
        <Show when={siblings().length > 1}>
          <span class="siblings">
            <button class="icon" aria-label="Previous version" disabled={at() === 0} onClick={() => go(at() - 1)}>
              <Prev />
            </button>
            {/* the counter opens the list: which action made each version, its opening, how many nodes follow it */}
            <button class="count" aria-haspopup="menu" popovertarget={`versions-${props.node.turn.id}`}>
              {at() + 1}/{siblings().length}
            </button>
            <div
              id={`versions-${props.node.turn.id}`}
              class="versions"
              popover
              role="menu"
              ref={(el) => (list = el)}
              onFocusOut={(e) => !list?.contains(e.relatedTarget as HTMLElement | null) && list?.hidePopover()}
            >
              <For each={siblings()} keyed={(s) => s.turn.id}>
                {(s, i) => (
                  <button
                    role="menuitem"
                    class="version"
                    aria-current={s().turn.id === props.node.turn.id ? "true" : undefined}
                    onClick={() => (list?.hidePopover(), go(i()))}
                  >
                    <Switch fallback={<span class="kind" />}>
                      <Match when={s().turn.sibling === "swipe"}>
                        <Swipe class="kind" aria-label="Swipe" />
                      </Match>
                      <Match when={s().turn.sibling === "reword"}>
                        <Reword class="kind" aria-label="Reword" />
                      </Match>
                      <Match when={s().turn.sibling === "edit"}>
                        <Edit class="kind" aria-label="Edit" />
                      </Match>
                    </Switch>
                    <span class="first">
                      {varied() ? `${s().turn.input.text || s().turn.input.note} · ${prose(s())}` : prose(s())}
                    </span>
                    <Show when={L.below(all(), s().id)}>{(n) => <span class="below">{n()}</span>}</Show>
                  </button>
                )}
              </For>
            </div>
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

const Reader = () => {
  const line = read(path)
  const d = read(draft)
  const phase = read(stage)
  const err = read(error)
  const busy = () => d() !== null && err() === null // a ghost draft (failed turn) holds nothing up
  // the draft hangs under its parent: a sibling of a past turn cuts the line there while it is written
  const shown = createMemo(() => {
    const dr = d()
    return dr ? line().slice(0, line().findIndex((n) => n.id === dr.parent) + 1) : line() // a root's draft: nothing above
  })
  let stop: (() => void) | null = null
  onSettled(() => void Promise.all([fetchCard(), fetchNodes()]))

  const start = (
    parent: Id | null,
    input: { text: string; note?: string },
    action: Parameters<typeof send>[0],
    text = "", // an edit's draft is the player's text, shown while check and record run over it
  ) => {
    registry.set(error, null)
    registry.set(draft, { parent, input, text, fresh: action.kind === "act" || registry.get(revising) !== null })
    stop = send(action)
  }
  const onSend = (text: string, note: boolean) => {
    if (registry.get(revising)) {
      // the line revised and sent again: a new turn beside the old one, under the same parent
      const { n, input } = revised(text)
      return start(n.parent, input, { kind: "act", parent: n.parent, input })
    }
    const pinned = registry.get(pin)
    const input = { ...(note ? { text: "", note: text } : { text }), ...(pinned ? { pin: pinned } : {}) }
    registry.set(pin, null)
    start(registry.get(log).head, input, { kind: "act", input }) // under head: the server knows where that is
  }
  // Revise: the bubble puts the line in the composer (the draft there is stashed, back on cancel); Send makes a new
  // turn, Keep makes a sibling with the prose kept and the record redone over the revised line.
  const onRevise = (n: Node, field: "text" | "note") => {
    const r = registry.get(revising)
    const previous = r?.previous ?? { text: registry.get(compose), aside: registry.get(aside) }
    registry.set(revising, { node: n.id, field, previous })
    registry.set(compose, n.turn.input[field] ?? "")
    registry.set(aside, field === "note")
  }
  /** The revised line as the node's input, and the node. Revising ends when the node lands (store.ts), so a failed
   *  send puts the line back under the same revision. */
  const revised = (text: string) => {
    const r = registry.get(revising)!
    const n = L.get(registry.get(log), r.node)
    return { n, input: { ...n.turn.input, [r.field]: text } }
  }
  const onKeep = (text: string) => {
    const { n, input } = revised(text)
    start(n.parent, input, { kind: "edit", node: n.id, input }, prose(n))
  }
  const onCancel = () => {
    const r = registry.get(revising)!
    registry.set(revising, null)
    registry.set(compose, r.previous.text)
    registry.set(aside, r.previous.aside)
  }
  const onSwipe = (n: Node) => start(n.turn.parent, n.turn.input, { kind: "swipe", node: n.turn.id })
  const onReword = (n: Node, note?: string) =>
    start(
      n.turn.parent,
      { ...n.turn.input, note: [n.turn.input.note, note].filter(Boolean).join("\n") || undefined }, // joined as the session joins it
      { kind: "reword", node: n.turn.id, ...(note !== undefined && { note }) },
    )
  // Edit: the first call opens the editor on the node, the editor's call closes it, with the text to send or none.
  const onEdit = (n: Node, text?: string) => {
    const open = registry.get(editing) !== n.turn.id
    registry.set(editing, open ? n.turn.id : null)
    if (!open && text !== undefined) start(n.turn.parent, n.turn.input, { kind: "edit", node: n.turn.id, text }, text)
  }
  const onStop = async () => {
    if (!stop) return
    stop()
    // Before the first character the turn is withdrawn; after it, the server finishes a `stopped` node the closed
    // response never carried, so read the snapshot back until it shows up.
    const was = registry.get(log).nodes.size
    if (!arrived()) {
      withdraw()
      return clear() // the revision, if any, stays: its line is back in the box under it
    }
    registry.set(stage, "record") // what the server is doing with the cut prose; the Record slot waits for it
    for (let i = 0; i < 100 && registry.get(log).nodes.size === was; i++) {
      await new Promise((r) => setTimeout(r, 300))
      await fetchNodes()
    }
    // record failed on the server (the closed response never carried its error): the ghost says so, the line comes back
    if (registry.get(log).nodes.size === was)
      return apply({ kind: "error", message: "The stopped turn was not recorded" })
    settle()
  }

  return (
    <>
      <div class="panel">
        <div class="scroll">
          <main>
            {/* keyed by id: a snapshot read back (after a stop) refreshes each section in place instead of rebuilding them */}
            <For each={shown()} keyed={(n) => n.turn.id}>
              {(n, i) => (
                <Section
                  node={n()}
                  n={i() + 1}
                  last={!busy() && i() === shown().length - 1}
                  busy={busy()}
                  onSwipe={() => onSwipe(n())}
                  onReword={(note) => onReword(n(), note)}
                  onEdit={(text) => onEdit(n(), text)}
                  onRevise={(field) => onRevise(n(), field)}
                />
              )}
            </For>
            <Show when={d()}>{(dr) => <Draft d={dr()} phase={phase()} error={err()} />}</Show>
          </main>
        </div>
        <Composer
          busy={busy()}
          stoppable={phase() !== "check" && phase() !== "record"}
          onSend={onSend}
          onKeep={onKeep}
          onCancel={onCancel}
          onStop={onStop}
        />
        <Latest />
      </div>
      <Glance busy={busy()} onSwipe={onSwipe} onReword={onReword} onEdit={onEdit} />
    </>
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

/** Desktop's right card: the Status table and the latest turn's Record with its sibling actions, inline. Rendered by
 *  the Reader (the actions are its), as a sibling of the panel in the canvas grid; the latest section's pill hides. */
const Glance = (props: {
  busy: boolean
  onSwipe: (n: Node) => void
  onReword: (n: Node, note?: string) => void
  onEdit: (n: Node) => void
}) => {
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
            <Rewrite
              for={l().node.id}
              rerun={!!(l().node.turn.input.text || l().node.turn.input.note)}
              busy={props.busy}
              onSwipe={() => props.onSwipe(l().node)}
              onReword={(note) => props.onReword(l().node, note)}
              onEdit={() => props.onEdit(l().node)}
            />
          </section>
        )}
      </Show>
    </aside>
  )
}

export const App = () => {
  const pg = read(page)
  return (
    <>
      <div class="canvas">
        <Topbar />
        <Side />
        <Reader />
      </div>
      <Show when={pg() === "timeline"}>
        <Timeline />
      </Show>
      <Show when={typeof pg() === "object"}>
        <Inspect id={(pg() as { inspect: Id }).inspect} />
      </Show>
    </>
  )
}
