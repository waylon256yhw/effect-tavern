// The client's state as atoms, fed by the wire's events. The log tree lives in `log`, a replica of the server's
// (src/log.ts: the same code, fed by the snapshot and by `change` events; head is where the reader is, and the server
// keeps it). `draft` is the node being written: its prose grows by `delta`; a second draft (check failed) starts it over
// and keeps the first as `prev`, greyed in place until the node lands. A failed turn keeps its draft as a ghost under `error`.
import type { Greeting, Rules } from "@effect-tavern/runtime/src/card.ts"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import type { Names } from "@effect-tavern/provider/src/names.ts"
import type { Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format, Hat, Player, Snippet } from "@effect-tavern/runtime/src/fragment.ts"
import type { Shape } from "@effect-tavern/runtime/src/product.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Event, Node, Phase } from "@effect-tavern/runtime/src/session.ts"
import type { Call } from "./inspect.ts"
import * as Atom from "./atom.ts"
import { registry } from "./atom.ts"
import { t } from "./i18n.ts"

export type Id = number
export interface Draft {
  parent: Id | null
  input: { text: string; note?: string }
  text: string
  prev?: string // the discarded first draft, shown greyed under the rewrite
  fresh?: boolean // the line is nowhere else (an act, a revised line): a failed turn puts it back in the composer
}
/** A failed turn as the server's `error` event says it: `code` "no-model" (no model to run it on) is the one the ghost
 *  turns into a way into Settings → 默认模型. */
export type Failure = { message: string; code?: string }
/** The turn in flight as a client that comes back to the story finds it (server GET /turn): its stage and its draft. */
export type Attach = { kind: "attach"; phase: Phase | null; draft: Draft | null }
export type Wire = Event | ({ kind: "error" } & Failure) | Attach

export { registry }
export const log = Atom.make<L.Log<Node>>(L.of<Node>())
export const draft = Atom.make<Draft | null>(null)
/** What the client draws the card by (GET /card): read once at open, before anything subscribes, hence keepAlive. */
export interface CardView {
  id: string
  title: string
  summary?: string // one line on what this card is
  heading?: string // what titles a turn (Card.heading); absent, turns have no titles
  input: "act" | "note" // the default channel: participant mode (act) or author mode (note), fixed for the session
  greetings: readonly Greeting[] // the openings: a story starts with one (greet, by index) or, with none, with the player's line
  director: boolean
  guard: number // must-nots check enforces: a count, never the words
  lore: { entries: number; layers: number } // the card's size; what is readable now is on the node
  tokens: { head: number } // what the card's own text costs each turn, estimated
  fiction: readonly { id: string; label?: string; when?: Cond }[] // the fiction's modules without their text
  rules: Rules
  /** The record products as declared (card over harness): the shown name, the shape the inspector draws by, and the
   *  default state the player's toggle (`Player.products`) overrides on the Writing page. */
  products: readonly { id: string; label?: string; shape: Shape; on: boolean }[]
  snippets: readonly Snippet[]
  format: readonly Format[]
}
export const card = Atom.make<CardView | null>(null).pipe(Atom.keepAlive)
/** The library (GET /stories, /personas, /player): every card's stories and which is open (a story is one root's tree),
 *  the player's personas, and the player layer the writing switches and the persona pick live in. Read at open. */
export interface StoryRow {
  id: Id
  card: string // the card it is of
  busy: Phase | null // a turn in flight on it, where it stands
  title: string | null // the player's name for it; none (never named), the row reads "New story"
  starred: boolean // the player's star: first on the card and in the manager
  updated: number
  turns: number // the nodes with a player line or note: a greeting is none
  last: { text: string; note?: string } | null // the last turn's input: the manager's preview; none with only the opening
}
export interface Persona {
  id: string
  name: string
  text: string
}
/** `current` is none on an empty library: the client is on the first card's page, no story yet. */
export const stories = Atom.make<{ current: Id | null; stories: readonly StoryRow[] } | null>(null).pipe(Atom.keepAlive)
export const personas = Atom.make<readonly Persona[]>([]).pipe(Atom.keepAlive)
export const player = Atom.make<Player | null>(null).pipe(Atom.keepAlive)
/** The player's settings (GET /providers, /secrets, /routing, /hats): the model providers, the key vault as hints,
 *  which (provider, model) runs each stage, the hats (提示词模板 in the UI). Read when the settings page opens. */
export type Pair = { provider: string; model: string }
export interface Routing {
  default?: Pair
  stages?: Partial<Record<Phase, Pair>>
}
export const providers = Atom.make<readonly Provider[]>([]).pipe(Atom.keepAlive)
/** Every card the install knows (GET /cards), by id and title, with its one-line summary when it has one: the
 *  sidebar's shelf (side.tsx), and what a persona's picks are named by. */
export const cards = Atom.make<readonly { id: string; title: string; summary?: string }[]>([]).pipe(Atom.keepAlive)
/** Which of the sidebar's two layers shows: the shelf (every card) or the workspace (one card's stories). Arriving at
 *  a story lands on its workspace, an empty library on the shelf (pages.ts); the back button and a card's row move it. */
export const layer = Atom.make<"shelf" | "workspace">("workspace").pipe(Atom.keepAlive)
export const secrets = Atom.make<readonly SecretView[]>([]).pipe(Atom.keepAlive)
/** The model-name table (GET /models/names), read through provider names.ts `lookup`: a model id's name, owner, family. */
export const names = Atom.make<Names>({}).pipe(Atom.keepAlive)
export const routing = Atom.make<Routing>({}).pipe(Atom.keepAlive)
export const hats = Atom.make<readonly Hat[]>([]).pipe(Atom.keepAlive)
export const pin = Atom.make<string | null>(null).pipe(Atom.keepAlive) // an untold entry the next act must tell (Input.pin), armed from a clue
export const compose = Atom.make("") // the composer's main box: the line (participant mode) or the direction (author mode); an Options row writes here and never sends
export const noted = Atom.make("") // the note box under the line: a word to the narrator that goes with this send (participant mode only)
export const aside = Atom.make(false) // the note box is open (participant mode's deviation); clears after the send
/** Participant mode: the main box is the character's line and a note may go with it. Author mode: every input is a
 *  direction, the main box is the note and there is no line. One mapping at the edges (send, revise, withdraw). */
export const acting = (): boolean => card()?.input === "act" // tracked: the composer draws by it
export const boxesOf = (i: { text: string; note?: string }): { text: string; note: string } =>
  acting() ? { text: i.text, note: i.note ?? "" } : { text: i.note ?? "", note: "" }
export const inputOf = (text: string, note: string): { text: string; note?: string } =>
  acting() ? { text, ...(note && { note }) } : { text: "", note: text }
/** What the composer's boxes hold: the line, the note, whether the note box is open. One write for the three. */
export const boxes = (): { text: string; note: string; aside: boolean } => ({
  text: registry.get(compose),
  note: registry.get(noted),
  aside: registry.get(aside),
})
export const setBoxes = (b: { text: string; note: string; aside: boolean }): void => {
  registry.set(compose, b.text)
  registry.set(noted, b.note)
  registry.set(aside, b.aside)
}
export const stage = Atom.make<Phase | null>(null)
/** The prose is done and the turn settles (check, polish, record): the queue plays out, nothing halts it any more. */
export const settling = (phase: Phase | null): boolean => phase === "check" || phase === "polish" || phase === "record"
export const editing = Atom.make<Id | null>(null) // the node whose prose is a textarea in place (Edit), until sent or cancelled
/** The player's own line back in the composer (Revise): which node and field, and the draft it displaced, restored on cancel. */
export const revising = Atom.make<{
  node: Id
  field: "text" | "note"
  previous: { text: string; note: string; aside: boolean }
} | null>(null)
export const error = Atom.make<Failure | null>(null)
/** A turn in flight: a draft that is not the ghost of a failed one, or any stage running (a demand runs one with no
 *  draft, and two streams would interleave into one `apply` queue). What holds the composer, the story and a new root. */
export const working = Atom.make((get) => (get(draft) !== null && get(error) === null) || get(stage) !== null)
/** The page over the reader: none, the card page, the Timeline, the settings, the Writing page (writing.tsx) or the
 *  Inspect page on one node. The reader stays mounted under it, so a turn in flight keeps streaming. "home" is no page
 *  over a story: the bottom of a home tab's stack (`isHome`), where a fresh start and "+" land (pages.ts, tabs.ts);
 *  "settings" is never over anything either: it is the settings tab's one page (`isSettings`), the install's, of no
 *  story. */
export type Page = "home" | "reader" | "card" | "timeline" | "settings" | "writing" | "status" | { inspect: Id }
/** A tab on the top strip (docs/shell-brief-2.md, #123): an address, not data. The story it reads (none: a card's
 *  page, home, the settings), the card it is on (its story's card when it has one), its page and the pages under it,
 *  the reader's scroll as it was left, and the tab it was opened from (its × hands back there; not remembered). Every
 *  tab reads the one Reading in the slots (reading.ts); tabs.ts is the one writer of the list. A tab with neither a
 *  story nor a card is a home tab (home at the bottom of its stack) or the settings tab. */
export interface Tab {
  id: number
  story: Id | null
  card: string | null
  page: Page
  under: Page[]
  scroll?: number
  from?: number
}
export type Tabs = { list: readonly Tab[]; active: number }
/** The settings tab: one at most, opened by every way into the settings (settings.tsx `openSettings`). */
export const isSettings = (t: Pick<Tab, "page">): boolean => t.page === "settings"
/** A home tab: no story, no card, not the settings; a card entered from it is pushed over its home (Back returns
 *  there), a story opened from it makes it that story's tab. */
export const isHome = (t: Pick<Tab, "story" | "card" | "page">): boolean =>
  t.story === null && t.card === null && !isSettings(t)
export const tabs = Atom.make<Tabs>({
  list: [{ id: 0, story: null, card: null, page: "home", under: [] }],
  active: 0,
}).pipe(Atom.keepAlive)
/** The active tab of the list as given. */
export const activeOf = (s: Tabs): Tab => s.list.find((t) => t.id === s.active)!
/** What the stage shows: the active tab's page, written through the tab (pages.ts). */
export const page = Atom.make((get) => activeOf(get(tabs)).page)
/** The card the sidebar's workspace layer is on (#117): the active tab's card, its story's card or one browsed from
 *  the shelf (its page shown, no story of it yet). One source for the workspace and the card view. */
export const focus = Atom.make((get) => activeOf(get(tabs)).card).pipe(Atom.keepAlive)
/** The calls by node (GET /calls): read when the Inspect page opens, then fed by the stream as nodes land. */
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

/** A node's name in the chrome: its place on the reading line, or its id when it is off the line. */
export const turnOf = (line: readonly Node[], id: Id): string => {
  const i = line.findIndex((n) => n.id === id)
  return i >= 0 ? t("common.turnN", { n: i + 1 }) : `#${id}`
}

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
  ended: true, // nothing more to play: the loop stops when the queue is empty
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
    ended: true,
  })
}
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
  drain()
  const q = play.queue
  if (q.length === 0) {
    if (!play.ended) {
      if (play.last === 0) play.last = performance.now() // idling before the first token: that gap is the startup stall
      play.frame ??= requestAnimationFrame(tick)
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
  play.frame ??= requestAnimationFrame(tick)
}

// An event that arrives while graphemes are still queued waits behind them, so the stage, the rewrite, the node and an
// error never overtake the prose on screen (a fast model ends narrate with a cushion still to play). Deltas flow while
// nothing waits; behind a waiting event they wait too, in order.
let held: Wire[] = []
const made: Call[] = [] // this action's calls, filed under its node when it lands (as the server files them)
export const apply = (e: Wire): void => {
  if (held.length || (play.queue.length && e.kind !== "delta")) held.push(e)
  else applyNow(e)
}
const drain = () => {
  while (held.length && (play.queue.length === 0 || held[0]!.kind === "delta")) applyNow(held.shift()!)
}
/** The open story's row in the listing as its stream says (a stage, or the turn over): the server writes `busy` too,
 *  but the client reads it again only at a stream's end or the sidebar's poll, and a tab's dot must not wait. A story
 *  left mid-turn keeps its row as it was until the next listing. */
export const running = (phase: Phase | null): void =>
  registry.update(stories, (l) =>
    l?.current == null
      ? l
      : { ...l, stories: l.stories.map((s) => (s.id === l.current && s.busy !== phase ? { ...s, busy: phase } : s)) },
  )
const applyNow = (e: Wire): void => {
  switch (e.kind) {
    case "attach":
      // the turn as it stands: its prose so far drawn at once, the live deltas playing on from there (the switch here
      // reset the playout, so the loop is told the prose is still coming). `fresh` is the server's: an act's line that
      // fails from here goes back in the box, a swipe's or an edit's is already on its node.
      registry.set(draft, e.draft)
      registry.set(stage, e.phase)
      running(e.phase)
      if (e.phase === "narrate") play.ended = false
      return
    case "stage":
      registry.set(stage, e.phase)
      running(e.phase)
      // Each draft starts over: a narrate after check is the rewrite, the first one greys under it.
      if (e.phase === "narrate") {
        resetPlay()
        play.ended = false
        registry.update(draft, (d) => (d ? { ...d, text: "", prev: d.text || d.prev } : d))
      }
      if (settling(e.phase)) play.ended = true // the prose is complete: the queue plays out
      return
    case "delta":
      if (e.part.type === "text-delta") enqueue(e.part.text)
      return
    case "call":
      made.push(e)
      return
    case "change": {
      registry.update(log, (l) => L.apply(l, e))
      const id = e.node?.id
      if (id !== undefined) registry.update(calls, (m) => new Map(m).set(id, [...(m.get(id) ?? []), ...made]))
      if (id !== undefined || !registry.get(draft)) {
        settle() // a checkout while a turn streams moves head, not the draft
        running(null)
      }
      return
    }
    case "error":
      made.length = 0
      resetPlay()
      registry.set(error, { message: e.message, ...(e.code && { code: e.code }) })
      registry.set(stage, null)
      running(null)
      withdraw()
      return
  }
}

/** The draft is over, landed or withdrawn: nothing plays, nothing waits. */
export const clear = (): void => {
  held = []
  made.length = 0
  resetPlay()
  registry.set(draft, null)
  registry.set(stage, null)
}
/** A node landed: the draft, the revision it came from and the error it displaced are over. */
export const settle = (): void => {
  clear()
  registry.set(revising, null)
  registry.set(error, null)
}
/** The ghost of a failed turn put away. */
export const dismiss = (): void => {
  registry.set(draft, null)
  registry.set(error, null)
}

/** The turn did not become a node: its line and note go back into their boxes (unless the reader has typed since). */
export const withdraw = (): void => {
  const d = registry.get(draft)
  if (!d?.fresh || registry.get(compose) || registry.get(noted)) return
  const b = boxesOf(d.input)
  setBoxes({ ...b, aside: !!b.note })
}

// Revise: the bubble puts the turn's input in the composer, line and note in their boxes (what was there is stashed,
// back on cancel); Send makes a new turn beside it (turn.ts `act`), Keep a sibling with the prose kept (`keep`).
// Revising ends when the node lands (`settle`), so a failed send puts the input back under the same revision.
export const revise = (n: Node, field: "text" | "note"): void => {
  const previous = registry.get(revising)?.previous ?? boxes()
  registry.set(revising, { node: n.id, field, previous })
  const b = boxesOf(n.turn.input)
  setBoxes({ ...b, aside: acting() && (!!b.note || field === "note") })
}
/** Revising given up: the line put back, the displaced draft restored. */
export const cancelRevise = (): void => {
  const r = registry.get(revising)
  if (!r) return
  registry.set(revising, null)
  setBoxes(r.previous)
}
