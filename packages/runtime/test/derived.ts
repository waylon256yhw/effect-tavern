// Tests for src/derived.ts: the facts code folds along a path, over hand-written Turns on the self-check card. No model,
// no session: the gate's counters and floors, the readable list, and the fold boundary asserted directly.
import assert from "node:assert/strict"
import { makeCard, type Beat, type Card } from "../src/card.ts"
import type { State as Paths } from "../src/cond.ts"
import { gateOf, makeDerived } from "../src/derived.ts"
import type { Turn as TurnOf } from "../src/journal.ts"
import { makeLore } from "../src/lore.ts"
import { resolve } from "../src/layer.ts"
import { full } from "./cards/index.ts"

type Turn = TurnOf<Beat>
// Scripted prose is a few tokens a turn, so a budget of 0 folds as early as `keep` and `block` allow: two turns kept,
// the boundary a block of two behind them.
const derivedOf = (card: Card, policy = { budget: 0, keep: 2, block: 2 }) =>
  makeDerived({
    rpg: makeCard(card.rules),
    L: () => makeLore<Paths, readonly string[]>(card.lore.map((e) => ({ ...e, ...gateOf(e.id, e.offer) }))),
    lore: card.lore,
    products: () => resolve(card, {}).products,
    policy: () => policy,
  })
let next = 0
/** A turn appended to `path`, returning the longer path. */
const add = (path: readonly Turn[], t: Partial<Turn> = {}): Turn[] => [
  ...path,
  {
    changes: [],
    settlementStatus: "committed",
    settlementVersion: 0,
    deliveries: [],
    opportunities: [],
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
const none = { events: [], before: [] }

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

// Unlock is shared by model resources and player catalog, while permissions are independent.
{
  const D = derivedOf({ ...full, lore: full.lore.map((e) => ({ ...e, access: { model: true, player: true } })) })
  const a = add(add([], { answers: { warmth: "warm" } }), { answers: { warmth: "warm" } })
  const b = add(a, { answers: { warmth: "cold" } })
  assert.equal(D.at(b).state.bond, 3)
  assert.equal(D.at(b).gated().lore.li!.floor, 2)
  assert.ok(
    D.at(b)
      .resources()
      .find((r) => r.resourceId === "card:li")!
      .text.includes(full.lore[0]!.layers[1]!),
  )
}

// A tail patch cannot stand in for the entity's complete snapshot. Identity survives rename.
{
  const D = derivedOf(full)
  const a = add([], {
    changes: [{ kind: "insert_entity", collection: "people", entityId: "e_li", data: { name: "Li", note: "Origin" } }],
  })
  const old = D.at(a)
    .resources()
    .find((r) => r.resourceId === "memory:people/e_li")!
  assert.ok(
    D.at(a)
      .lookup()
      .readable()
      .some((r) => r.resourceId === old.resourceId),
  )
  const b = add(a, { deliveries: [old] })
  assert.ok(
    !D.at(b)
      .lookup()
      .readable()
      .some((r) => r.resourceId === old.resourceId),
  )
  const c = add(b, {
    changes: [
      {
        kind: "patch_entity",
        collection: "people",
        entityId: "e_li",
        patch: { name: "Renamed" },
        prev: { name: "Li", note: "Origin" },
      },
    ],
  })
  const next = D.at(c)
    .lookup()
    .readable()
    .find((r) => r.resourceId === old.resourceId)!
  assert.notEqual(next.revision, old.revision)
  assert.match(next.text, /Origin/)
  assert.match(next.text, /Renamed/)
  const d = add(c, { deliveries: [next] })
  assert.ok(
    !D.at(d)
      .lookup()
      .readable()
      .some((r) => r.resourceId === old.resourceId),
  )
  const unloaded = add(add(add(d)))
  assert.ok(
    D.at(unloaded)
      .lookup()
      .readable()
      .some((r) => r.resourceId === old.resourceId),
  )
  assert.equal(
    D.at(b)
      .resources()
      .find((r) => r.resourceId === old.resourceId)!.revision,
    old.revision,
  )
  const deleted = add(d, {
    changes: [
      { kind: "remove_entity", collection: "people", entityId: "e_li", prev: { name: "Renamed", note: "Origin" } },
    ],
  })
  assert.ok(
    !D.at(deleted)
      .resources()
      .some((r) => r.resourceId === old.resourceId),
  )
  const recreated = add(deleted, {
    changes: [
      { kind: "insert_entity", collection: "people", entityId: "e_other", data: { name: "Li", note: "Other" } },
    ],
  })
  assert.ok(
    D.at(recreated)
      .resources()
      .some((r) => r.resourceId === "memory:people/e_other"),
  )
}

// Full Current injection makes that revision resident without claiming prose contains it.
{
  const card = { ...full, products: full.products!.map((p) => (p.id === "people" ? { ...p, feed: true } : p)) }
  const D = derivedOf(card)
  const a = add([], {
    changes: [{ kind: "insert_entity", collection: "people", entityId: "e_li", data: { name: "Li", note: "Origin" } }],
  })
  assert.ok(D.at(a).known().current!.includes("Origin"))
  assert.ok(
    !D.at(a)
      .lookup()
      .readable()
      .some((r) => r.resourceId.startsWith("memory:")),
  )
}

// World participates in settlement dependencies, including an amended ancestor with unchanged scalar state.
{
  const card: Card = {
    ...full,
    lore: [],
    rules: { fields: [], actions: [{ id: "pass", text: "Pass", when: { path: "world.scene.open", is: true } }] },
    products: [
      {
        id: "scene",
        role: "world",
        text: "Scene",
        shape: { kind: "record", keys: [{ key: "open", type: "boolean" }] },
        initial: { open: true },
      },
    ],
  }
  const rpg = makeCard(card.rules)
  let folds = 0
  const D = makeDerived({
    rpg: {
      ...rpg,
      fold: (...args) => {
        folds++
        return rpg.fold(...args)
      },
    },
    L: () => makeLore([]),
    lore: [],
    products: () => resolve(card, {}).products,
    policy: () => ({ budget: 0, keep: 2, block: 2 }),
  })
  const parent = add([], { changes: [{ kind: "patch_record", product: "scene", patch: { open: true }, prev: {} }] })
  const path = add(parent, { beats: [{ next: "pass", seed: 0 }] })
  assert.deepEqual(D.at(path).state, {})
  const firstFolds = folds
  D.at(path).node()
  D.at(path).context()
  assert.equal(folds, firstFolds, "reads of the same world path must reuse settlements")
  const amended = {
    ...parent[0]!,
    changes: [{ kind: "patch_record" as const, product: "scene", patch: { open: false }, prev: {} }],
  }
  assert.throws(() => D.at([amended, path[1]!]).state, /not an available action/)
  assert.deepEqual(D.at(path).context().world, { scene: { open: true } }) // original branch still correct
  const adjusted = {
    ...path[1]!,
    changes: [{ kind: "patch_record" as const, product: "scene", patch: { open: false }, prev: {} }],
  }
  assert.deepEqual(D.at([parent[0]!, adjusted]).context().world, { scene: { open: false } })
  assert.deepEqual(D.at(path).context().world, { scene: { open: true } })
}

console.log("derived ok")
