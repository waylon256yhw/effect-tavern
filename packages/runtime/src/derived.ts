// Derived (GLOSSARY 派生): the facts code folds along a path, never stored. State and events, each turn's pre / post,
// the gate state (counters and floors), the readable list, the fold boundary and its summary, the Known / Current
// lines, the ledger, the node projection. One factory per session; `at(path)` reads them, lazily, per fact. The memo
// tables live as long as the factory, keyed by Turn object: a turn is immutable, an amended one is a new object.
// session.ts is the caller: turn, project, setField and demand.
import { holds, type Cond, type State as Paths } from "./cond.ts"
import type { Beat, Check, Rpg, State, LoreEntry } from "./card.ts"
import { folded, ledger, makeSummaries, type Policy } from "./history.ts"
import { deliveredIn, deliveredOn, notesOf, textOf as proseOf, type Turn as TurnOf } from "./journal.ts"
import { key, type Disclosure, type Lore } from "./lore.ts"
import { entryRef, fold, itemText, recallEntries, render, type Product } from "./product.ts"
import { tokens } from "./tokens.ts"

type Turn = TurnOf<Beat>
/** A node as the client sees it: the turn plus what the path derives for it. No fragment bodies. `readable` is what the
 *  path could still be told (hooks, not bodies): the client's untold list, where a pin is picked from. */
export interface Node {
  id: number
  parent: number | null
  turn: Turn
  state: State
  events: readonly string[]
  checks: readonly Check[] // this turn's judged beats, in order; what the Record's check track draws
  delivered: readonly (Disclosure & { text: string })[]
  readable: readonly { id: string; hook: string }[]
}

/** How many leading layers `unlock` holds for at one state: a single Cond is layer 1's, a list is one per layer. */
export const floorAt = (unlock: Cond | readonly Cond[], s: State) => {
  const cs = Array.isArray(unlock) ? unlock : [unlock]
  let n = 0
  while (n < cs.length && holds(cs[n]!, s)) n++
  return n
}
// The lock reads its floor off the gate state (`gated` below), never the instant; the window reads the instant.
// session.ts builds its lore with this, so the floor half of the invariant lives here with `gated`.
export const gateOf = (id: string, offer: Cond) => ({
  unlock: (s: Paths) => (s.lore as Record<string, { floor: number }> | undefined)?.[id]?.floor ?? 0,
  offer: (s: Paths, ev: readonly string[]) => holds(offer, s, ev),
})

export const makeDerived = ({
  rpg,
  L,
  lore,
  products,
  policy,
}: {
  rpg: Rpg
  L: Lore<Paths, readonly string[]>
  lore: readonly LoreEntry[]
  products: () => readonly Product[] // the player toggles them mid-session
  policy: () => Policy // the routing can move the narrate window mid-session
}) => {
  /** What a disclosure says: a lore layer, or one item of a recall product stored on a node (`<product>@<node>#<i>`).
   *  The node is looked up on the path: a recall row is only ever offered or delivered from a node on it (readable
   *  keeps the folded prefix; a sibling's reused read comes from the same parent), so a ref off the path is a defect. */
  const textIn = (path: readonly Turn[], d: Disclosure): string => {
    const ref = entryRef(d.id)
    if (!ref) return L.text(d)
    const t = path.find((x) => x.id === ref.node)
    if (!t) throw new Error(`${d.id}: node ${ref.node} is not on the path`)
    return itemText((t.products[ref.product] as unknown[])[ref.index])
  }
  const summaries = makeSummaries<Beat>((d, range) => textIn(range, d))
  // A turn's cost in the narrator's transcript (input, prose, the lore delivered with it), memoized: a turn is immutable.
  const costs = new WeakMap<Turn, number>()
  const costIn = (path: readonly Turn[]) => (t: Turn) => {
    let c = costs.get(t)
    if (c === undefined)
      costs.set(
        t,
        (c = tokens([t.input.text, proseOf(t.reply), ...deliveredIn(t).map((d) => textIn(path, d))].join("\n"))),
      )
    return c
  }
  const foldOf = (path: readonly Turn[]) => folded(path, costIn(path), policy())
  /** The one summary every view of this path folds to (narrator, ledger), the same cached object. */
  const summaryOf = (path: readonly Turn[]) => summaries.compress(path, path.length - foldOf(path))
  /** Feed products folded over the path, as the two lines the model reads back: Known (notes) and Current (the rest). */
  const known = (path: readonly Turn[]) => {
    const feed = products().filter((p) => p.feed && p.on)
    const cur = fold(
      feed,
      path.map((t) => t.products),
    )
    const rest = feed.filter((p) => p.id !== "notes" && cur[p.id] !== undefined)
    return {
      known: `Known: ${path.flatMap(notesOf).join("; ")}`,
      current: rest.length
        ? `Current: ${rest.map((p) => `${p.id}=${render(p.shape, cur[p.id])}`).join(" | ")}`
        : undefined,
    }
  }

  // A turn's state: the opening (a greeting's effects), then beats before the prose, then readout answers after it. All
  // code folds over recorded outputs. The player's `adjust` goes last: a correction wins over everything the turn did.
  // `post` is what this turn emitted that no gate of its own could read: a greeting has no gate and a readout is answered
  // after the prose, so both open windows on the next turn.
  // Memoized per turn on the state it was settled from: a path's states are the same objects every time it is folded
  // (each is the last settle's `s`), so folding a node's path again costs a lookup per turn, not a settle. An amended
  // turn is a new object and misses; so does a turn under it, whose from-state is new.
  const settledFrom = new WeakMap<Turn, { from: State; out: ReturnType<typeof settleFresh> }>()
  const settleTurn = (s: State, t: Turn) => {
    const hit = settledFrom.get(t)
    if (hit?.from === s) return hit.out
    const out = settleFresh(s, t)
    settledFrom.set(t, { from: s, out })
    return out
  }
  const settleFresh = (s: State, t: Turn) => {
    const o = t.opening ? rpg.apply(s, t.opening) : { s, events: [] as string[] }
    const b = rpg.fold(o.s, t.beats)
    const r = rpg.settleReadouts(b.s, t.answers)
    const a = t.adjust ? rpg.apply(r.s, t.adjust) : { s: r.s, events: [] as string[] }
    return {
      s: a.s,
      events: [...o.events, ...b.events, ...r.events, ...a.events],
      checks: b.checks,
      post: [...o.events, ...r.events, ...a.events],
      pre: b.s, // after opening and beats, before readouts and adjustments: what the turn's record saw
    }
  }
  /** Every turn of the path settled, in order: each from the one before, the first from the card's initial state. */
  const settledAlong = (path: readonly Turn[]) => {
    const out: ReturnType<typeof settleFresh>[] = [] // pushed, not spread: a spread per turn made one call O(depth²)
    for (const t of path) out.push(settleTurn(out.at(-1)?.s ?? rpg.initial, t))
    return out
  }
  /** The state the lore gate reads: the card state (the path's end, or `s` when the turn has settled past it) plus,
   *  under `lore.<id>`, each entry's derived counters (since / shown, for `offer`; `extra` is this turn's deliveries,
   *  counted as shown now) and its floor: the deepest layer `unlock` has held for at ANY state along the path. The
   *  floor is monotone because knowledge is: what the fiction made available does not become unavailable again. A
   *  told layer already stayed (lore.ts keeps the deepest delivered); this keeps an untold one too. A card field named
   *  `lore` would collide, so none may be. */
  const gated = (path: readonly Turn[], extra: readonly Disclosure[] = [], s?: State): Paths => {
    const states = [rpg.initial, ...settledAlong(path).map((o) => o.s)]
    const at = s ?? states.at(-1)!
    const counters = L.counters([...path.map(deliveredIn), extra]) // the turn being made is the last, shown now
    return {
      ...at,
      lore: Object.fromEntries(
        lore.map((e) => [
          e.id,
          { ...counters[e.id], floor: Math.max(...[...states, at].map((x) => floorAt(e.unlock, x))) },
        ]),
      ),
    }
  }
  /** What the path could still be told: lore entries with an unseen layer under their current one, and recalled rows
   *  not yet delivered. The lookup's enum, the node's `readable`, and where `Input.pin` picks from. */
  const readableOn = (path: readonly Turn[]) => {
    // ponytail: each call still scans the path (counters, floors, seen, recall), so a snapshot is O(nodes·depth) in cheap
    // scans; carry those folds parent → child in one id-order pass if a story outgrows it.
    const s = gated(path)
    const seen = deliveredOn(path)
    const seenKeys = new Set(seen.map(key))
    const prefix = new Set(path.slice(0, foldOf(path)).map((t) => t.id))
    const hooks = new Map(L.index(s, seen).map((e) => [e.id, e.hook]))
    const readable = lore.length ? L.readable(s, seen).map((id) => ({ id, hook: hooks.get(id)! })) : []
    // The product's fold decides which rows exist (a keyed table is the newest row per key: a person re-rowed with what
    // a later scene added is one entry); the seen filter runs after it, so reading the newest row never brings a
    // superseded one back as unread (the third live session re-read 李鹤's old row two turns later when it did). The
    // fold filter runs after it too: a row enters the Index only once its node is folded; in the tail its prose is still
    // verbatim in the narrator's transcript, and a lookup would tell it again.
    const recall = products()
      .filter((p) => p.recall !== undefined)
      .flatMap((p) =>
        recallEntries(
          p,
          path.map((t) => ({ id: t.id, v: t.products[p.id] })),
        ),
      )
      .filter((e) => !seenKeys.has(`${e.id}#1`) && prefix.has(entryRef(e.id)!.node))
      .map((e) => ({ id: e.id, hook: e.hook }))
    return [...readable, ...recall]
  }
  // One delivery per layer per turn: a sibling's base.read already holds the pin's and the window's lower layers.
  const once = (ds: readonly Disclosure[]) => [...new Map(ds.map((d) => [key(d), d])).values()]

  /** The facts at the end of `path`, each computed when read. */
  const at = (path: readonly Turn[]) => {
    const last = () => {
      const all = settledAlong(path)
      return all.at(-1) ?? { s: rpg.initial, events: [], checks: [], post: [], pre: rpg.initial }
    }
    const text = (d: Disclosure) => textIn(path, d)
    return {
      get state(): State {
        return last().s
      },
      get events(): readonly string[] {
        return last().events
      },
      get checks(): readonly Check[] {
        return last().checks
      },
      get pre(): State {
        return last().pre
      },
      /** What the last turn emitted after its own gate: the next turn's gate reads it as well as its own events. */
      get post(): readonly string[] {
        return last().post
      },
      gated: (extra?: readonly Disclosure[], s?: State) => gated(path, extra, s),
      readable: () => readableOn(path),
      /** How many leading turns the fold covers. */
      fold: () => foldOf(path),
      summary: () => summaryOf(path),
      known: () => known(path),
      ledger: () => {
        const all = settledAlong(path)
        return ledger(path, (t) => all[path.indexOf(t)]!.events, summaryOf(path))
      },
      text,
      /** A candidate turn settled on top of the path (setField's adjusted node, demand's `pre`). */
      settle: (t: Turn) => settleTurn(last().s, t),
      /** The node projection of the path's last turn. */
      node: (): Node => {
        const t = path.at(-1)!
        const settled = last()
        return {
          id: t.id,
          parent: t.parent,
          turn: t,
          state: settled.s, // the fold to t's end
          events: settled.events,
          checks: settled.checks,
          delivered: deliveredIn(t).map((d) => ({ ...d, text: text(d) })),
          readable: readableOn(path).map(({ id, hook }) => ({ id, hook })),
        }
      },
      /** The gate of the turn being made on this path: its settled state and beat events, what it read before the gate
       *  (the lookup's and a pin's lower layers), and the pinned layer forced open. The window reads the turn's events
       *  plus what the turn before emitted after its own gate (readout events; a greeting's opening events): without
       *  that carry a readout-only card never opened a window at all (found by the yandao card: no beat events). */
      gate: ({
        state,
        events,
        before: given,
        forced,
      }: {
        state: State
        events: readonly string[]
        before: readonly Disclosure[]
        forced: readonly Disclosure[]
      }) => {
        const before = once(given)
        const g1 = gated(path, before, state)
        const ds1 = deliveredOn(path, before)
        const offered = L.offers(g1, ds1, [...events, ...last().post]).map(({ id, layer }) => ({ id, layer }))
        const unforced = offered.filter((d) => !forced.some((f) => f.id === d.id))
        // A window opens current+1; the unseen layers under it are read this turn, told like a lookup's (issue #9).
        // ponytail: a sibling's gate counts those lower layers as shown this turn (they are in base.read), the fresh
        // turn's did not, so a since/shown-gated window over unread layers can close on a reword; store the gate's own
        // deliveries on the turn if a card hits it.
        const disclosures = once([...before, ...unforced.flatMap((d) => L.read(g1, ds1, d.id) ?? [])])
        // The pinned entry is open with its forced layer and MUST be told, director or not.
        const open: Disclosure[] = [...forced, ...unforced]
        return { offered, disclosures, open }
      },
    }
  }
  return { at }
}
