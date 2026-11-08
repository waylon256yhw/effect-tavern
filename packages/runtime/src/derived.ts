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
import { applyChanges, initialWorld, worldOn, worldValue, type WorldState } from "./world.ts"
import { tokens } from "./tokens.ts"

const title = (ref: string, fields: State, world: Record<string, unknown>): string | undefined => {
  const value =
    fields[ref.replace(/^fields\./, "")] ??
    ref
      .replace(/^world\./, "")
      .split(".")
      .reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], world)
  return value !== "" && (typeof value === "string" || typeof value === "number") ? String(value) : undefined
}

type Turn = TurnOf<Beat>
/** A node as the client sees it: the turn plus what the path derives for it. No fragment bodies. `invocable` contains
 *  the entries the player can request (hooks and tiers, never bodies). */
export interface Node {
  id: number
  parent: number | null
  turn: Turn
  state: State
  heading?: string
  events: readonly string[]
  checks: readonly Check[] // this turn's judged beats, in order; what the Record's check track draws
  delivered: readonly (Disclosure & { text: string })[]
  invocable: readonly { id: string; hook: string; invoke: "auto" | "manual" }[]
}

/** How many leading layers `unlock` holds for at one state: a single Cond is layer 1's, a list is one per layer. */
export const floorAt = (unlock: Cond | readonly Cond[], s: Paths) => {
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
  heading,
}: {
  rpg: Rpg
  heading?: string
  L: () => Lore<Paths, readonly string[]> // the card's entries and the player layer's, read per request
  lore: readonly LoreEntry[] // the card's own: the entries with a Cond floor (a pack's entry has none)
  products: () => readonly Product[] // the player toggles them mid-session
  policy: () => Policy // the routing can move the narrate window mid-session
}) => {
  /** What a disclosure says: a lore layer, or one item of a recall product stored on a node (`<product>@<node>#<i>`).
   *  The node is looked up on the path: a recall row is only ever offered or delivered from a node on it (readable
   *  keeps the folded prefix; a sibling's reused read comes from the same parent), so a ref off the path is a defect. */
  const textIn = (path: readonly Turn[], d: Disclosure): string => {
    const ref = entryRef(d.id)
    if (!ref) return L().text(d)
    const t = path.find((x) => x.id === ref.node)
    if (!t) throw new Error(`${d.id}: node ${ref.node} is not on the path`)
    const p = products().find((p) => p.id === ref.product)
    if (p?.role === "world")
      return worldRecall(p, path.slice(0, path.indexOf(t) + 1)).find((e) => e.id === d.id)?.text ?? ""
    if (p?.shape.kind === "table" && typeof p.fold === "object") {
      return (
        recallEntries(
          p,
          path.slice(0, path.indexOf(t) + 1).map((t) => ({ id: t.id, v: t.products[p.id] })),
        ).find((e) => e.id === d.id)?.text ?? ""
      )
    }
    return itemText((t.products[ref.product] as unknown[])[ref.index])
  }
  // Bridge to the existing lookup stage until Step 3 replaces node references with revisioned resources.
  // Identity and updates already come solely from committed domain changes, never a mutable name column.
  const worldRecall = (p: Product, path: readonly Turn[]) => {
    const entries = new Map<string, { id: string; hook: string; text: string }>()
    let world = initialWorld([p])
    for (const t of path) {
      const changes = t.changes.filter((c) => ("collection" in c ? c.collection : c.product) === p.id)
      world = applyChanges(world, changes)
      if (p.shape.kind !== "table") {
        if (changes.length) {
          entries.clear()
          for (const e of recallEntries(p, [{ id: t.id, v: world[p.id] }])) entries.set(e.id, e)
        }
        continue
      }
      const rows = world[p.id] as Record<string, Record<string, unknown>>
      for (const c of changes) {
        if (!("entityId" in c)) continue
        if (c.kind === "remove_entity") {
          entries.delete(c.entityId)
          continue
        }
        const row = rows[c.entityId]
        if (!row) {
          entries.delete(c.entityId)
          continue
        }
        if (p.shape.filter && !holds(p.shape.filter, row)) {
          entries.delete(c.entityId)
          continue
        }
        entries.set(c.entityId, {
          id: `${p.id}@${t.id}#${Object.keys(rows).indexOf(c.entityId)}`,
          hook: String(row[p.recall as string]),
          text: itemText({ entityId: c.entityId, ...row }),
        })
      }
    }
    return [...entries.values()]
  }

  const summaries = makeSummaries<Beat>()
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
  const known = (path: readonly Turn[], recall = false) => {
    const feed = products().filter((p) => (p.feed || (recall && p.recall)) && p.on)
    const world = worldOn(products(), path)
    const cur = {
      ...fold(
        feed.filter((p) => p.role !== "world"),
        path.map((t) => t.products),
      ),
      ...Object.fromEntries(feed.filter((p) => p.role === "world").map((p) => [p.id, worldValue(p, world[p.id])])),
    }
    const rest = feed.filter((p) => p.id !== "notes" && cur[p.id] !== undefined && render(p.shape, cur[p.id]) !== "")
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
  const settleTurn = (s: State, t: Turn, world: Paths = {}) => {
    const hit = settledFrom.get(t)
    if (hit?.from === s && !Object.keys(world).length) return hit.out
    const out = settleFresh(s, t, world)
    settledFrom.set(t, { from: s, out })
    return out
  }
  const settleFresh = (s: State, t: Turn, world: Paths = {}) => {
    const o = t.opening ? rpg.apply(s, t.opening) : { s, events: [] as string[] }
    const b = rpg.fold(o.s, t.beats, { fields: o.s, world })
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
    let world = initialWorld(products())
    for (const t of path) {
      out.push(settleTurn(out.at(-1)?.s ?? rpg.initial, t, world))
      world = applyChanges(world, t.changes)
    }
    return out
  }
  /** The state the lore gate reads: the card state (the path's end, or `s` when the turn has settled past it) plus,
   *  under `lore.<id>`, each entry's derived counters (since / shown, for `offer`; `extra` is this turn's deliveries,
   *  counted as shown now) and its floor: the deepest layer `unlock` has held for at ANY state along the path. The
   *  floor is monotone because knowledge is: what the fiction made available does not become unavailable again. A
   *  told layer already stayed (lore.ts keeps the deepest delivered); this keeps an untold one too. A card field named
   *  `lore` would collide, so none may be. */
  const gated = (path: readonly Turn[], extra: readonly Disclosure[] = [], s?: State): WorldState & Paths => {
    let world = initialWorld(products())
    const floors = new Map(lore.map((e) => [e.id, floorAt(e.unlock, { fields: rpg.initial, world })]))
    const along = settledAlong(path)
    const at = s ?? along.at(-1)?.s ?? rpg.initial
    const observe = (fields: State) => {
      for (const e of lore) floors.set(e.id, Math.max(floors.get(e.id)!, floorAt(e.unlock, { fields, world })))
    }
    for (const [i, o] of along.entries()) {
      world = applyChanges(world, path[i]!.changes)
      observe(o.s)
    }
    observe(at)
    const counters = L().counters([...path.map(deliveredIn), extra])
    return {
      fields: at,
      world,
      lore: Object.fromEntries(
        lore.map((e) => [
          e.id,
          {
            ...(counters[e.id] ?? { since: Infinity, shown: 0 }),
            floor: floors.get(e.id)!,
          },
        ]),
      ),
    }
  }

  /** What the path could still be told: lore entries with an unseen layer under their current one, and recalled rows
   *  not currently held. Both the lookup index and the player menu come from these candidates. */
  const candidatesOn = (path: readonly Turn[]) => {
    // ponytail: each call still scans the path (counters, floors, seen, recall), so a snapshot is O(nodes·depth) in cheap
    // scans; carry those folds parent → child in one id-order pass if a story outgrows it.
    const s = gated(path)
    const seen = deliveredOn(path)
    const held = deliveredOn(path.slice(foldOf(path)))
    const seenKeys = new Set(held.map(key))
    const prefix = new Set(path.slice(0, foldOf(path)).map((t) => t.id))
    const I = L()
    const hooks = new Map(I.index(s, seen).map((e) => [e.id, e.hook]))
    const readable = I.entries.flatMap((e) => {
      const invoke = e.invoke ?? "auto"
      if (invoke === "always" || !hooks.has(e.id)) return []
      if (invoke === "auto" && !I.read(s, seen, held, e.id)?.length) return []
      return [{ id: e.id, hook: hooks.get(e.id)!, invoke }]
    })
    // The product's fold decides which rows exist (a keyed table is the newest row per key: a person re-rowed with what
    // a later scene added is one entry); the seen filter runs after it, so reading the newest row never brings a
    // superseded one back as unread (the third live session re-read 李鹤's old row two turns later when it did). The
    // fold filter runs after it too: a row enters the Index only once its node is folded; in the tail its prose is still
    // verbatim in the narrator's transcript, and a lookup would tell it again.
    const recall = products()
      .filter((p) => p.recall !== undefined)
      .flatMap((p) =>
        p.role === "world"
          ? worldRecall(p, path)
          : recallEntries(
              p,
              path.map((t) => ({ id: t.id, v: t.products[p.id] })),
            ),
      )
      .filter((e) => !seenKeys.has(`${e.id}#1`) && prefix.has(entryRef(e.id)!.node))
      .map((e) => ({ id: e.id, hook: e.hook, invoke: "auto" as const }))
    return [...readable, ...recall]
  }
  // One delivery per layer per turn: a sibling's base.read already holds the invoked and window's lower layers.
  const once = (ds: readonly Disclosure[]) => [...new Map(ds.map((d) => [key(d), d])).values()]

  /** The facts at the end of `path`, each computed when read. */
  const at = (path: readonly Turn[]) => {
    let all: ReturnType<typeof settledAlong> | undefined // walked once per handle: a node() reads four facts off it
    const along = () => (all ??= settledAlong(path))
    const last = () => along().at(-1) ?? { s: rpg.initial, events: [], checks: [], post: [], pre: rpg.initial }
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
      context: (fields: State = last().s) => gated(path, [], fields),
      gated: (extra?: readonly Disclosure[], s?: State) => gated(path, extra, s),
      readable: () => candidatesOn(path).filter((e) => e.invoke === "auto"),
      invocable: () => candidatesOn(path),
      /** Search only the same auto candidates and unseen, unlocked layers that lookup can deliver. */
      search: (q: string, k: number, exclude: readonly string[] = []): string[] => {
        // ponytail: whitespace terms and substring counts, no segmentation or vectors; grow to BM25 or an
        // embedding plugin when real cards need it. Stable sorting keeps index order for ties.
        const terms = [...new Set(q.trim().toLowerCase().split(/\s+/).filter(Boolean))]
        if (!terms.length) return []
        const I = L()
        const s = gated(path)
        const seen = deliveredOn(path)
        const held = deliveredOn(path.slice(foldOf(path)))
        return candidatesOn(path)
          .filter((e) => e.invoke === "auto" && !exclude.includes(e.id))
          .map((e) => {
            const ds = entryRef(e.id) ? [{ id: e.id, layer: 1 }] : (I.read(s, seen, held, e.id) ?? [])
            const body = [e.id, e.hook, ...ds.map(text)].join("\n").toLowerCase()
            return { e, score: terms.filter((term) => body.includes(term)).length }
          })
          .filter((hit) => hit.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map(({ e }) => `${e.id}=${e.hook}`)
      },
      /** How many leading turns the fold covers. */
      fold: () => foldOf(path),
      summary: () => summaryOf(path),
      known: (recall = false) => known(path, recall),
      ledger: () => ledger(path, (t) => along()[path.indexOf(t)]!.events, summaryOf(path)),
      text,
      /** A candidate turn settled on top of the path (setField's adjusted node, demand's `pre`). */
      settle: (t: Turn) => settleTurn(last().s, t, worldOn(products(), path)),
      /** The node projection of the path's last turn. */
      node: (): Node => {
        const t = path.at(-1)!
        const settled = last()
        return {
          id: t.id,
          parent: t.parent,
          turn: t,
          state: settled.s, // the fold to t's end
          ...(heading ? { heading: title(heading, settled.s, worldOn(products(), path)) } : {}),
          events: settled.events,
          checks: settled.checks,
          delivered: deliveredIn(t).map((d) => ({ ...d, text: text(d) })),
          invocable: candidatesOn(path),
        }
      },
      /** The gate of the turn being made on this path: its settled state and beat events, what it read before the gate
       *  (lookup and player auto invocations). The window reads the turn's events
       *  plus what the turn before emitted after its own gate (readout events; a greeting's opening events): without
       *  that carry a readout-only card never opened a window at all (found by the yandao card: no beat events). */
      gate: ({
        state,
        events,
        before: given,
      }: {
        state: State
        events: readonly string[]
        before: readonly Disclosure[]
      }) => {
        const before = once(given)
        const g1 = gated(path, before, state)
        const ds1 = deliveredOn(path, before)
        const I = L()
        const offered = I.offers(g1, ds1, [...events, ...last().post]).map(({ id, layer }) => ({ id, layer }))
        // A window opens current+1; the unseen layers under it are read this turn, told like a lookup's (issue #9).
        // ponytail: a sibling's gate counts those lower layers as shown this turn (they are in base.read), the fresh
        // turn's did not, so a since/shown-gated window over unread layers can close on a reword; store the gate's own
        // deliveries on the turn if a card hits it.
        const disclosures = once([
          ...before,
          ...offered.flatMap((d) => I.read(g1, ds1, deliveredOn(path.slice(foldOf(path)), before), d.id) ?? []),
        ])
        const open: Disclosure[] = offered
        return { offered, disclosures, open }
      },
    }
  }
  return { at }
}
