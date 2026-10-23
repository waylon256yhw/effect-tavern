// The client's state as atoms, fed by the wire's events. The log tree lives in `log`, a replica of the server's
// (src/log.ts: the same code, fed by the snapshot and by `change` events; head is where the reader is, and the server
// keeps it). `draft` is the node being written: its prose grows by `delta`; a second draft (check failed) starts it over
// and keeps the first as `prev`, greyed in place until the node lands. A failed turn keeps its draft as a ghost under `error`.
import type { Rules } from "@effect-tavern/runtime/src/card.ts"
import type { Format, Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Shape } from "@effect-tavern/runtime/src/product.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Event, Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import type { Call } from "./inspect.ts"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export type Id = number
export interface Draft {
  parent: Id | null
  input: { text: string; note?: string }
  text: string
  prev?: string // the discarded first draft, shown greyed under the rewrite
}
export type Wire = Event | { kind: "error"; message: string }

export const registry = AtomRegistry.make()
export const log = Atom.make<L.Log<Node>>(L.of<Node>())
export const draft = Atom.make<Draft | null>(null)
/** What the client draws the card by (GET /card): read once at open, before anything subscribes, hence keepAlive. */
export interface CardView {
  id: string
  title: string
  heading?: string // what titles a turn (Card.heading); absent, turns have no titles and there is no scene list
  input: "act" | "note" // the default channel: participant mode (act) or author mode (note), fixed for the session
  greetings: number // how many openings the card has: a new thread starts with one (greet) or with the player's line (none)
  rules: Rules
  products: readonly { id: string; shape: Shape }[] // record products by declared shape: how the inspector draws them
  snippets: readonly Snippet[]
  format: readonly Format[]
}
export const card = Atom.make<CardView | null>(null).pipe(Atom.keepAlive)
export const pin = Atom.make<string | null>(null).pipe(Atom.keepAlive) // an untold entry the next act must tell (Input.pin), armed from a clue
export const compose = Atom.make("") // the composer's text; an Options row writes here and never sends
export const aside = Atom.make(false) // this one send goes to the narrator (participant mode's deviation); clears after the send
export const stage = Atom.make<Phase | null>(null)
export const editing = Atom.make<Id | null>(null) // the node whose prose is a textarea in place (Edit), until sent or cancelled
export const error = Atom.make<string | null>(null)
/** The Inspect page: the node under inspection, or null while reading; the calls by node (GET /calls), read on open. */
export const inspecting = Atom.make<Id | null>(null)
export const calls = Atom.make<ReadonlyMap<Id, readonly Call[]>>(new Map())

/** The reading line: root → head. */
export const path = Atom.make((get) => L.path(get(log)))

/** The last node on the reading line and the one before it (its parent): what the header's dot, the Status table and
 *  the desktop's inline Record read. */
export const latest = Atom.make((get) => {
  const line = get(path)
  const node = line.at(-1)
  return node ? { node, prev: line.at(-2) } : null
})

/** Whether the reading line holds a player's turn: what Start over leaves behind and Delete story takes. */
export const started = Atom.make((get) => get(path).some((n) => n.turn.input.text || n.turn.input.note))

export const prose = (n: Node): string =>
  n.turn.reply
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("")

// Playout: Cherry Studio's adaptive jitter buffer (src/renderer/hooks/useSmoothStream.ts), as one module-level queue.
// Deltas arrive in bursts (token groups, SSE coalescing); they are queued as graphemes and released at the stream's
// sustained inbound rate — fast model fast, slow model slow — pulled toward a small cushion sized to the stalls this
// stream has shown (a decaying peak of gaps that dwarf its own cadence, clamped to FLOOR..CAP seconds), so a gap
// does not underrun into a stutter. Nothing is dropped: a backlog past the ceiling plays faster. One deviation: when
// the prose has ended (stage check) the rest plays out at the rate instead of being dumped in one frame.
const segmenter = new Intl.Segmenter()
const FLOOR = 0.08
const CAP = 0.8
const ARM_MIN = 250 // ms; a gap is a stall past max(this, ARM_FACTOR × the recent median gap)
const ARM_FACTOR = 6
const RELEASE = 6 // s; the armed cushion decays back toward FLOOR
const GAPS = 32
const RELAX = 0.3 // s; time constant of the pull toward the cushion
const BACKLOG = 400 // graphemes; hard latency ceiling against the live model
const MAX_DT = 100 // ms; a tab coming back from the background must not dump the queue
const SUSTAINED_MIN = 1000 // ms; floor under the rate's denominator (a first burst must not divide by ~0)
const play = {
  queue: [] as string[],
  total: 0, // graphemes since the first chunk
  first: -1, // when the first chunk came
  last: 0, // last arrival
  seen: false, // the startup gap arms the cushion but stays out of the cadence samples
  gaps: [] as number[],
  stall: 0, // s; decaying peak of stall lengths
  credit: 0, // sub-grapheme playout budget carried between frames
  at: 0, // last frame
  frame: undefined as number | undefined,
  ended: false,
}
const resetPlay = () => {
  if (play.frame !== undefined) cancelAnimationFrame(play.frame)
  Object.assign(play, {
    queue: [],
    total: 0,
    first: -1,
    last: 0,
    seen: false,
    gaps: [],
    stall: 0,
    credit: 0,
    at: 0,
    frame: undefined,
    ended: false,
  })
}
/** Whether any prose has arrived for the current draft, shown or still queued: what a stop before it withdraws. */
export const arrived = (): boolean => play.total > 0
const enqueue = (chunk: string) => {
  const chars = Array.from(segmenter.segment(chunk), (x) => x.segment)
  if (chars.length === 0) return
  const now = performance.now()
  play.queue.push(...chars)
  if (play.first < 0) play.first = now
  play.total += chars.length
  const prev = play.last
  play.last = now
  if (prev > 0) {
    const gap = now - prev
    if (play.seen) {
      play.gaps.push(gap)
      if (play.gaps.length > GAPS) play.gaps.shift()
    }
    const sorted = [...play.gaps].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1] ?? 0
    if (gap > Math.max(ARM_MIN, ARM_FACTOR * median)) play.stall = Math.max(play.stall, Math.min(gap / 1000, CAP))
  }
  play.seen = true
  play.frame ??= requestAnimationFrame(tick)
}
const tick = () => {
  play.frame = undefined
  const q = play.queue
  if (q.length === 0) {
    if (!play.ended) {
      if (play.last === 0) play.last = performance.now() // idling before the first token: that gap is the startup stall
      play.frame = requestAnimationFrame(tick)
    }
    return
  }
  const now = performance.now()
  let count: number
  if (play.at === 0) {
    count = 1 // first frame: no rate yet, and a pile-up before the loop started must not land at once
  } else {
    const dt = Math.min(now - play.at, MAX_DT)
    const rate = (play.total / Math.max(now - play.first, SUSTAINED_MIN)) * 1000
    play.stall *= Math.exp(-dt / 1000 / RELEASE)
    const target = rate * Math.min(CAP, Math.max(FLOOR, play.stall))
    const adjusted = play.ended ? rate : rate + (q.length - target) / RELAX
    if (adjusted > 0) {
      play.credit += (adjusted * dt) / 1000
      count = Math.floor(play.credit)
      play.credit -= count
    } else {
      count = 1 // drained below the cushion during a stall: keep dribbling rather than freeze
      play.credit = 0
    }
    if (q.length - count > BACKLOG) count = q.length - BACKLOG
  }
  play.at = now
  count = Math.min(count, q.length)
  if (count > 0) {
    const out = q.splice(0, count).join("")
    registry.update(draft, (d) => (d ? { ...d, text: d.text + out } : d))
  }
  play.frame = requestAnimationFrame(tick)
}

export const apply = (e: Wire): void => {
  switch (e.kind) {
    case "stage":
      registry.set(stage, e.phase)
      // Each draft starts over: a narrate after check is the rewrite, the first one greys under it.
      if (e.phase === "narrate") {
        resetPlay()
        registry.update(draft, (d) => (d ? { ...d, text: "", prev: d.text || d.prev } : d))
      }
      if (e.phase === "check" || e.phase === "record") play.ended = true // the prose is complete: the queue plays out
      return
    case "delta":
      if (e.part.type === "text-delta") enqueue(e.part.text)
      return
    case "change":
      registry.update(log, (l) => L.apply(l, e))
      resetPlay()
      registry.set(draft, null)
      registry.set(stage, null)
      return
    case "error":
      resetPlay()
      registry.set(error, e.message)
      registry.set(stage, null)
      withdraw()
      return
  }
}

/** The turn did not become a node: its line goes back into the box (unless the reader has typed since). */
export const withdraw = (): void => {
  const d = registry.get(draft)
  if (!d || registry.get(compose)) return
  registry.set(compose, d.input.text || d.input.note || "")
  registry.set(aside, !!d.input.note)
}
