import type { PlayerCatalogItem } from "./projection.ts"
// Derived (GLOSSARY): the facts code folds along a path, never stored. State and events, each turn's pre / post,
// the gate state (counters and floors), the readable list, the fold boundary and its summary, the Known / Current
// lines, the ledger, the node projection. One factory per session; `at(path)` reads them, lazily, per fact. The memo
// tables live as long as the factory, keyed by Turn object: a turn is immutable, an amended one is a new object.
// session.ts is the caller: turn, project, setField and demand.
import {
  catalogEntry,
  loreResource,
  sectionResources,
  contextLookup,
  freeze,
  policy as resourcePolicy,
  residentOn,
  revision,
  type Resource,
  type DeliverySnapshot,
} from "./context.ts"
import type { PackEntry } from "./layer.ts"
import { holds, type Cond, type State as Paths } from "./cond.ts"
import type { Beat, Check, Rpg, State, LoreEntry } from "./card.ts"
import { folded, ledger, makeSummaries, type Policy } from "./history.ts"
import { deliveredIn, deliveredOn, notesOf, textOf as proseOf, type Turn as TurnOf } from "./journal.ts"
import { key, type Disclosure, type Lore } from "./lore.ts"
import { fold, itemText, render, type Product } from "./product.ts"
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
/** Internal runtime projection. HTTP exposes projection.ts contracts instead of this complete journal view. */
export interface Node {
  id: number
  parent: number | null
  turn: Turn
  state: State
  heading?: string
  events: readonly string[]
  checks: readonly Check[] // this turn's judged beats, in order; what the Record's check track draws
  delivered: readonly DeliverySnapshot[]
  playerCatalog: readonly PlayerCatalogItem[]
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
  packs = () => [],
  products,
  policy,
  heading,
}: {
  rpg: Rpg
  heading?: string
  L: () => Lore<Paths, readonly string[]> // card lore only; Pack delivery must not advance a same-named story disclosure
  packs?: () => readonly PackEntry[]
  lore: readonly LoreEntry[] // the card's own: the entries with a Cond floor (a pack's entry has none)
  products: () => readonly Product[] // the player toggles them mid-session
  policy: () => Policy // the routing can move the narrate window mid-session
}) => {
  const summaries = makeSummaries<Beat>()
  // A turn's cost in the narrator's transcript (input, prose, the lore delivered with it), memoized: a turn is immutable.
  const costs = new WeakMap<Turn, number>()
  const costIn = (t: Turn) => {
    let c = costs.get(t)
    if (c === undefined)
      costs.set(t, (c = tokens([t.input.text, proseOf(t.reply), ...t.deliveries.map((d) => d.text)].join("\n"))))
    return c
  }
  const foldOf = (path: readonly Turn[]) => folded(path, costIn, policy())
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
    // a static greeting had no gate, so its opening's events wait for the next turn's; a narrated root read them in its own
    const gated = !!(t.input.text || t.input.note || t.input.invoke?.length)
    return {
      s: a.s,
      events: [...o.events, ...b.events, ...r.events, ...a.events],
      checks: b.checks,
      post: [...(gated ? [] : o.events), ...r.events, ...a.events],
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

  /** Only unlocked text becomes a resource. Memory identities come from committed entities,
   * never the turn where a field happened to change. */
  const resourcesOn = (path: readonly Turn[]): Resource[] => {
    const s = gated(path)
    const I = L()
    const seen = deliveredOn(path)
    const entries: Resource[] = I.entries.flatMap((e) => {
      const depth = I.current(e, s, seen)
      if (!depth) return []
      return [loreResource(e, depth), ...sectionResources(e, depth)]
    })
    entries.push(...packs().map((e) => loreResource({ ...e, source: "pack", layers: [e.text] }, 1)))
    const ps = products().filter((p) => p.on && p.recall !== undefined)
    const chronicle = fold(
      ps.filter((p) => p.role !== "world"),
      path.map((t) => t.products),
    )
    const memory: Resource[] = ps.flatMap((p) => {
      const value = p.role === "world" ? worldValue(p, s.world[p.id]) : chronicle[p.id]
      if (!Array.isArray(value)) return []
      return value.flatMap((item): Resource[] => {
        if (p.shape.kind === "table" && p.shape.filter && !holds(p.shape.filter, item)) return []
        const identity =
          p.role === "world" && p.shape.kind === "table"
            ? item.entityId
            : typeof p.fold === "object"
              ? item[p.fold.key]
              : revision(item)
        const text = itemText(item)
        return [
          {
            resourceId: `memory:${p.id}/${encodeURIComponent(String(identity))}`,
            revision: revision(item),
            title: p.shape.kind === "table" ? String(item[p.recall as string]) : String(item),
            text,
            source: "memory",
            ...resourcePolicy("memory"),
            product: p.id,
            disclosures: [],
          },
        ]
      })
    })
    return [...new Map([...entries, ...memory].map((r) => [r.resourceId, r])).values()]
  }
  // The summary actually selected for this request, not a guessed creation/write watermark.
  const resident = (path: readonly Turn[]) => {
    const sum = summaryOf(path)
    const resources = resourcesOn(path)
    return residentOn(path, sum ? path.findIndex((t) => t.id === sum.to) + 1 : 0).filter(
      (s) =>
        // Removed entities no longer provide current context; their frozen evidence remains on the original turn.
        s.source !== "memory" || resources.some((r) => r.resourceId === s.resourceId),
    )
  }
  const currentResources = (path: readonly Turn[]) =>
    resourcesOn(path).filter(
      (r) => r.product && products().some((p) => p.id === r.product && p.id !== "notes" && p.on && p.feed),
    )
  const playerCatalog = (path: readonly Turn[]) =>
    resourcesOn(path)
      .filter((r) => r.access.player)
      .map(catalogEntry)
  // One delivery per layer per turn: a sibling's base.read already holds the invoked and window's lower layers.
  const once = (ds: readonly Disclosure[]) => [...new Map(ds.map((d) => [key(d), d])).values()]

  /** The facts at the end of `path`, each computed when read. */
  const at = (path: readonly Turn[]) => {
    let all: ReturnType<typeof settledAlong> | undefined // walked once per handle: a node() reads four facts off it
    const along = () => (all ??= settledAlong(path))
    const last = () => along().at(-1) ?? { s: rpg.initial, events: [], checks: [], post: [], pre: rpg.initial }
    const text = (d: Disclosure) => L().text(d)
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
      resources: () => resourcesOn(path),
      resident: () => resident(path),
      currentResources: () => currentResources(path).map((r) => freeze(r)),
      playerCatalog: () => playerCatalog(path),
      readable: () => contextLookup(resourcesOn(path), [...resident(path), ...currentResources(path)]).readable(),
      /** How many leading turns the fold covers. */
      fold: () => foldOf(path),
      summary: () => summaryOf(path),
      known: (recall = false) => known(path, recall),
      ledger: () => ledger(path, (t) => along()[path.indexOf(t)]!.events, summaryOf(path)),
      text,
      /** A candidate turn settled on top of the path (setField's adjusted node, demand's `pre`). */
      settle: (t: Turn) => settleTurn(last().s, t, worldOn(products(), path)),
      /** The node projection of the path's last turn. */
      node: (withCatalog = true): Node => {
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
          delivered: t.deliveries,
          playerCatalog: withCatalog ? playerCatalog(path) : [],
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
        // Story knowledge and request residency are separate. Previously disclosed lower layers do not
        // count as a new reveal; the caller freezes the full offered context and reuses it on a reword.
        const disclosures = once([...before, ...offered.flatMap((d) => I.read(g1, ds1, ds1, d.id) ?? [])])
        const open: Disclosure[] = offered
        return { offered, disclosures, open }
      },
    }
  }
  return { at }
}
