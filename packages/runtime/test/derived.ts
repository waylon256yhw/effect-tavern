// Tests for src/derived.ts: the facts code folds along a path, over hand-written Turns on the self-check card. No model,
// no session: the gate's counters and floors, the readable list, and the fold boundary asserted directly.
import assert from "node:assert/strict"
import { makeCard, type Beat, type Card } from "../src/card.ts"
import type { State as Paths } from "../src/cond.ts"
import { gateOf, makeDerived } from "../src/derived.ts"
import type { Turn as TurnOf } from "../src/journal.ts"
import { makeLore } from "../src/lore.ts"
import { resolve } from "../src/product.ts"
import { defaultProducts } from "../src/session.ts"
import { full } from "./cards/index.ts"

type Turn = TurnOf<Beat>
// Scripted prose is a few tokens a turn, so a budget of 0 folds as early as `keep` and `block` allow: two turns kept,
// the boundary a block of two behind them.
const derivedOf = (card: Card, policy = { budget: 0, keep: 2, block: 2 }) =>
  makeDerived({
    rpg: makeCard(card.rules),
    L: makeLore<Paths, readonly string[]>(
      card.lore.map((e) => ({ id: e.id, layers: e.layers, ...gateOf(e.id, e.offer) })),
    ),
    lore: card.lore,
    products: () => resolve(defaultProducts("act"), card.products),
    policy: () => policy,
  })
let next = 0
/** A turn appended to `path`, returning the longer path. */
const add = (path: readonly Turn[], t: Partial<Turn> = {}): Turn[] => [
  ...path,
  {
    id: next++,
    parent: path.at(-1)?.id ?? null,
    input: { text: "wait" },
    read: [],
    beats: [],
    answers: {},
    end: "end",
    brief: { must: [], may: [] },
    reply: [{ type: "text", text: `PROSE#${next}` }],
    fired: [],
    violated: [],
    products: {},
    ...t,
  },
]
const none = { events: [], before: [], forced: [] }

// ───────── Derived lore counters in the window (§8 item 4) ─────────
// A recurring entry: offered when it has not reached the narrator for two turns and has been shown fewer than twice.
// Never shown counts as Infinity, so it opens on the first turn; shown there, it waits one turn, then opens again.
{
  const echo = {
    id: "echo",
    layers: ["E1", "E2", "E3"],
    unlock: { all: [] },
    offer: {
      all: [
        { path: "lore.echo.since", op: "gte", value: 2 },
        { path: "lore.echo.shown", op: "lt", value: 2 },
      ],
    },
  } as const
  const D = derivedOf({ ...full, lore: [...full.lore, echo] })
  const gate = (path: readonly Turn[]) => D.at(path).gate({ state: D.at(path).state, ...none })
  const counters = (path: readonly Turn[]) => (D.at(path).gated().lore as Record<string, unknown>).echo
  // the first turn: never shown, so the window opens one layer past the floor, and the layer under it is read
  assert.deepEqual(counters([]), { since: Infinity, shown: 0, floor: 1 })
  const g0 = gate([])
  assert.deepEqual(
    [g0.offered, g0.disclosures, g0.open],
    [[{ id: "echo", layer: 2 }], [{ id: "echo", layer: 1 }], [{ id: "echo", layer: 2 }]],
  )
  const a = add([], { read: g0.disclosures, fired: [{ id: "echo", layer: 2 }] })
  assert.deepEqual([counters(a), gate(a).offered], [{ since: 1, shown: 1, floor: 1 }, []]) // since = 1
  const b = add(a)
  assert.deepEqual([counters(b), gate(b).offered], [{ since: 2, shown: 1, floor: 1 }, [{ id: "echo", layer: 3 }]])
  // shown twice: the window never opens again
  const c = add(add(add(b, { fired: [{ id: "echo", layer: 3 }] })))
  assert.deepEqual([counters(c), gate(c).offered], [{ since: 3, shown: 2, floor: 1 }, []])
}

// ───────── The lock is a predicate over the path: a layer once unlocked stays readable after the state drops ─────────
// li's second layer unlocks at bond ≥ 8. Two warm readouts reach it; a cold one after takes bond back to 3, and the
// layer is still readable (so pinnable), then read. Layer 3 never: only a window opens it.
{
  const D = derivedOf(full)
  const untold = (path: readonly Turn[]) =>
    D.at(path)
      .readable()
      .map((r) => r.id)
  const v0 = add([], { read: [{ id: "li", layer: 1 }] })
  assert.deepEqual(untold(v0), [])
  const v1 = add(add(v0, { answers: { warmth: "warm" } }), { answers: { warmth: "warm" } })
  assert.deepEqual([D.at(v1).state.bond, untold(v1)], [8, ["li"]])
  const v2 = add(v1, { answers: { warmth: "cold" } })
  assert.deepEqual([D.at(v2).state.bond, untold(v2)], [3, ["li"]]) // the instant no longer holds; the lock stays open
  assert.equal((D.at(v2).gated().lore as Record<string, { floor: number }>).li!.floor, 2)
  const v3 = add(v2, { read: [{ id: "li", layer: 2 }] })
  assert.deepEqual(untold(v3), [])
  assert.deepEqual(D.at(v3).node().readable, []) // the projection carries the same list
}

// ───────── A recall row enters readable only once its node is folded ─────────
// Budget 0, keep 2, block 2: a path of n turns folds floor((n − 2) / 2) · 2 of them. In the tail a row's prose is still
// verbatim in the narrator's transcript, and a lookup would tell it again.
{
  const D = derivedOf(full)
  const untold = (path: readonly Turn[]) =>
    D.at(path)
      .readable()
      .map((r) => r.id)
  const li = (note: string) => ({ products: { people: [{ name: "Li", note }] } })
  const r1 = add(add([], { read: [{ id: "li", layer: 1 }] }), li("N1")) // li told first; the row's node at index 1
  const id1 = `people@${r1[1]!.id}#0`
  assert.deepEqual([D.at(r1).fold(), untold(r1)], [0, []])
  const f1 = add(r1)
  assert.deepEqual([D.at(f1).fold(), untold(f1)], [0, []])
  const f1b = add(f1)
  assert.deepEqual([D.at(f1b).fold(), untold(f1b)], [2, [id1]]) // folded past index 1: the row is readable
  // Two rows with one key are one entry, the newest row, and the fold runs first: with the old row folded and the new
  // one in the tail, the key is absent, not the old row back.
  const r2 = add(f1b, li("N2")) // index 4
  const id2 = `people@${r2[4]!.id}#0`
  assert.deepEqual(untold(r2), [])
  assert.deepEqual(untold(add(r2)), [])
  assert.deepEqual(untold(add(add(r2))), [])
  const f2 = add(add(add(r2)))
  assert.deepEqual([D.at(f2).fold(), untold(f2)], [6, [id2]])
  // Reading the newest row tells the key: the superseded row does not come back as unread.
  const r3 = add(f2, { read: [{ id: id2, layer: 1 }] })
  assert.deepEqual(untold(r3), [])
  // A recall ref reads its text off the path; a ref to a node not on it is a defect.
  assert.equal(D.at(r3).text({ id: id2, layer: 1 }), "name=Li, note=N2")
  assert.throws(() => D.at(r1).text({ id: id2, layer: 1 }), /is not on the path/)
}

console.log("ok")
