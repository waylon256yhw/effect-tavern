// The ledger projection: changed fields by shape (enum → steps, two-bounded int → meter, the rest → value), checks,
// clues with pinnability from `readable`, the pin's fate, world products' values this turn; an unchanged root yields
// nothing. A product's kind off its declarations. Then the turn heading under a field path or a product key.
import assert from "node:assert/strict"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import {
  channelOf,
  fieldChanged,
  fields,
  heading,
  kindOf,
  lineOf,
  marked,
  parentOf,
  reading,
  record,
  sceneOf,
  status,
  versions,
  whens,
  type Element,
} from "../src/record.ts"

const rules = {
  fields: [
    { path: "hp", label: "体力", group: "Body", type: "int", min: 0, max: 100, initial: 40 },
    { path: "foe", type: "int", min: 0, initial: 30 },
    { path: "mood", type: "enum", group: "Body", options: ["low", "mid", "high"], initial: "low" },
  ],
  actions: [],
} as any
const node = (state: object, extra: any = {}) =>
  ({
    state,
    checks: [],
    delivered: [],
    playerCatalog: [],
    ...extra,
    turn: { input: {}, fired: [], products: {}, changes: [], ...extra.turn },
  }) as any

assert.deepEqual(record(rules, node({ hp: 40, foe: 30, mood: "low" }), undefined), [])
const els = record(
  rules,
  node(
    { hp: 30, foe: 20, mood: "high" },
    {
      checks: [{ action: "strike", chance: 0.6, roll: 0.7, hit: false }],
      delivered: [{ resourceId: "li", revision: "v1", source: "card", text: "a clue" }],
      playerCatalog: [{ id: "li", hook: "more" }],
      turn: { input: { text: "go", invoke: ["li"] }, fired: [], changes: [], products: { notes: "a fact" } },
    },
  ),
  node({ hp: 40, foe: 30, mood: "low" }, { playerCatalog: [{ id: "li", hook: "a hook" }] }),
)
assert.deepEqual(els, [
  { kind: "meter", path: "hp", label: "体力", min: 0, max: 100, was: 40, now: 30, cuts: [], scale: false },
  { kind: "value", path: "foe", label: "foe", was: 30, now: 20 }, // bounded on one side only: not a meter
  { kind: "steps", path: "mood", label: "mood", options: ["low", "mid", "high"], was: 0, now: 2 },
  { kind: "check", check: { action: "strike", chance: 0.6, roll: 0.7, hit: false } },
  { kind: "clue", id: "li", text: "a clue" },
]) // notes is context: not in the ledger
assert.deepEqual(
  record(
    rules,
    node(
      { hp: 40, foe: 30, mood: "low" },
      { turn: { input: { invoke: ["li"] }, fired: [{ id: "li", layer: 2 }], products: {} } },
    ),
    undefined,
  ),
  [], // no parent to name it: the id
)
// Kinds: read back (feed or recall) and replaced or merged by key → world; read back and appended → context; never
// read back → theater. The fold default is product.ts's: append for a list, latest otherwise.
const people = {
  id: "people",
  role: "world",
  shape: { kind: "table", columns: [{ key: "name", type: "text" }] },
  fold: { key: "name" },
  feed: true,
} as const
assert.equal(kindOf({ role: "world" }), "world")
assert.equal(kindOf({ role: "chronicle" }), "context")
assert.equal(kindOf({ role: "theater" }), "theater")
// Products: only the world ones on the node, by shown name, in the card's order; notes (context), inner (theater) and
// options leave the ledger; one not on the node (off, or not yet demanded) draws nothing
const declared = [
  { role: "chronicle", id: "notes", label: "事件摘要", shape: { kind: "text" }, fold: "append", feed: true },
  { role: "theater", id: "options", shape: { kind: "list" } },
  { role: "theater", id: "inner", label: "人物心声", shape: { kind: "text" } },
  { role: "world", id: "scene", shape: { kind: "record", keys: [{ key: "place", type: "text" }] }, feed: true },
  people,
] as const
assert.deepEqual(
  record(
    rules,
    node(
      { hp: 40, foe: 30, mood: "low" },
      {
        turn: {
          input: {},
          fired: [],
          changes: [{ kind: "replace", product: "scene", value: { place: "亭" } }],
          products: { notes: "n", options: ["o"], inner: "i", scene: { place: "亭" }, people: [] },
        },
      },
    ),
    undefined,
    declared,
  ),
  [
    {
      kind: "product",
      id: "scene",
      label: "scene",
      shape: { kind: "record", keys: [{ key: "place", type: "text" }] },
      value: { place: "亭" },
      change: "replace",
    },
  ],
)
// Status: the card's order inside a group, groups by first appearance, the ungrouped first and unnamed
assert.deepEqual(
  status(rules, { hp: 30, foe: 20, mood: "high" }).map((g) => [
    g.group,
    g.items.map((e) => ("path" in e ? e.path : e.kind)),
  ]),
  [
    [undefined, ["foe"]],
    ["Body", ["hp", "mood"]],
  ],
)
// Headings are already projected by the server, independent of timeline ancestry.
assert.equal(heading("scene.place", node({}, { heading: "竹林小径" })), "竹林小径")
assert.equal(heading("scene.place", node({})), undefined)
// A meter is a scale when it reaches below zero or has two or more stages, else a gauge; the card's `view` overrides
const meter = (f: { min: number; max: number; view?: "gauge" | "scale" }, whens: readonly (Cond | undefined)[] = []) =>
  reading({ path: "x", type: "int", initial: 0, ...f }, 0, 0, whens) as Extract<Element, { kind: "meter" }>
assert.deepEqual([meter({ min: 0, max: 100 }).cuts, meter({ min: 0, max: 100 }).scale], [[], false])
assert.equal(meter({ min: 0, max: 10 }, [{ path: "x", op: "gte", value: 6 }]).scale, false)
assert.equal(
  meter({ min: 0, max: 10 }, [
    { path: "x", op: "gte", value: 3 },
    { path: "x", op: "lt", value: 6 },
  ]).scale,
  true,
)
assert.deepEqual(meter({ min: -30, max: 100 }).cuts, [0])
assert.equal(meter({ min: -30, max: 100 }).scale, true)
assert.equal(
  meter({ min: 0, max: 100, view: "gauge" }, [
    { path: "x", op: "lt", value: 30 },
    { path: "x", op: "lt", value: 60 },
  ]).scale,
  false,
)
assert.equal(meter({ min: 0, max: 100, view: "scale" }).scale, true)

// The projection of a node for the chrome, over a fixture log: a greeting root (1), an act under it (2) with two
// siblings (3: swipe, same line; 4: edit, another line), a note turn (5) and a turn with both channels (6) under 2
const n = (id: number, parent: number | null, input: object, extra: object = {}, sibling?: string) =>
  ({
    id,
    parent,
    ...node(
      { hp: 40, foe: 30, mood: "low" },
      { turn: { id, parent, input, fired: [], changes: [], products: {}, ...(sibling && { sibling }) }, ...extra },
    ),
  }) as any
const g = n(
  1,
  null,
  { text: "" },
  { heading: "亭", turn: { id: 1, input: { text: "" }, fired: [], changes: [], products: { scene: { place: "亭" } } } },
)
const a = n(2, 1, { text: "go" }, { state: { hp: 30, foe: 30, mood: "low" } })
const s = n(3, 1, { text: "go" }, {}, "swipe")
const e = n(4, 1, { text: "stay" }, {}, "edit")
const o = n(5, 2, { text: "", note: "slower" })
const b = n(6, 2, { text: "go", note: "slower" })
const log = L.of({ nodes: [g, a, s, e, o, b], head: 6 })
// whens: the fiction's conditions in order, none without a view
assert.deepEqual(whens({ fiction: [{ id: "a", when: { path: "hp", op: "lt", value: 3 } }, { id: "b" }] }), [
  { path: "hp", op: "lt", value: 3 },
  undefined,
])
assert.deepEqual(whens(null), [])
// fields: only the changed rows, the same ones record() opens with; fieldChanged / marked are the yes/no of each
assert.deepEqual(fields(rules, a, g), [
  { kind: "meter", path: "hp", label: "体力", min: 0, max: 100, was: 40, now: 30, cuts: [], scale: false },
])
assert.deepEqual(fields(rules, s, g), [])
assert.equal(fieldChanged(rules, a, g), true)
assert.equal(fieldChanged(rules, s, g), false)
assert.equal(fieldChanged(undefined, a, g), false)
assert.equal(marked(rules, a, g), true) // a field
assert.equal(marked(undefined, a, g), false) // no rules, no dot
assert.equal(marked(rules, s, g), false)
assert.equal(
  marked(
    rules,
    node(s.state, { turn: { input: {}, fired: [], changes: [], products: { notes: "n", inner: "i" } } }),
    g,
    declared,
  ),
  false,
) // notes and 小剧场 alone: no ledger, no pill
assert.equal(
  marked(rules, node(s.state, { turn: { input: {}, fired: [], changes: [], products: { people: [] } } }), g, declared),
  false,
) // an empty table is no new row: not in the ledger, no pill
assert.equal(
  marked(
    rules,
    node(s.state, {
      turn: {
        input: {},
        fired: [],
        products: {},
        changes: [{ kind: "insert_entity", collection: "people", entityId: "e_li", data: { name: "李" } }],
      },
    }),
    g,
    declared,
  ),
  true,
)
assert.equal(marked(rules, node(s.state, { checks: [{ action: "x", chance: 1, roll: 0, hit: true }] }), g), true)
assert.equal(marked(rules, node(s.state, { delivered: [{ id: "li", layer: 1, text: "c" }] }), g), true)
assert.equal(
  marked(rules, node(s.state, { turn: { input: { invoke: ["li"] }, fired: [], changes: [], products: {} } }), g),
  false,
)
const scened = node(s.state, {
  turn: {
    input: {},
    fired: [],
    products: { options: ["o"] },
    changes: [{ kind: "replace", product: "scene", value: { place: "亭" } }],
  },
})
assert.equal(marked(rules, scened, g, declared), true) // a declared product
assert.equal(marked(rules, scened, g), false) // undeclared: not drawn, no dot
assert.equal(
  marked(
    rules,
    node(s.state, { turn: { input: {}, fired: [], changes: [], products: { options: ["o"] } } }),
    g,
    declared,
  ),
  false,
)
// the yes/no agree with record() over the same nodes
for (const x of [a, s, scened]) {
  assert.equal(
    fieldChanged(rules, x, g),
    record(rules, x, g).some((el) => "path" in el),
  )
  assert.equal(marked(rules, x, g, declared), record(rules, x, g, declared).length > 0)
}
// the input line and its channel
assert.deepEqual([g, a, o, b].map(lineOf), ["", "go", "slower", "go"])
assert.deepEqual([g, a, o, b].map(channelOf), ["greeting", "act", "note", "both"])
// parent, versions, scene
assert.equal(parentOf(log, g), undefined)
assert.equal(parentOf(log, a), g)
assert.deepEqual(versions(log, s), { list: [a, s, e], index: 1, varied: true }) // 4 has another line
assert.deepEqual(versions(log, g), { list: [g], index: 0, varied: false })
assert.equal(versions(L.of({ nodes: [g, a, s], head: 3 }), a).varied, false) // a swipe keeps the line
assert.equal(sceneOf("scene.place", log, g), "亭") // a root under a title: a scene
assert.equal(sceneOf("scene.place", log, a), undefined) // no title
assert.equal(sceneOf(undefined, log, node({}, { id: 99, parent: null })), undefined)
const same = n(
  7,
  1,
  { text: "on" },
  { heading: "亭", turn: { id: 7, input: {}, fired: [], changes: [], products: { scene: { place: "亭" } } } },
)
const moved = n(
  8,
  1,
  { text: "on" },
  { heading: "林", turn: { id: 8, input: {}, fired: [], changes: [], products: { scene: { place: "林" } } } },
)
const both = L.of({ nodes: [g, same, moved], head: 8 })
assert.equal(sceneOf("scene.place", both, same), undefined) // the parent's title again: no new scene
assert.equal(sceneOf("scene.place", both, moved), "林")
// Sparse scene patches inherit titles only from their own ancestor chain.
const partial = n(
  9,
  8,
  { text: "on" },
  { heading: "林", turn: { id: 9, input: {}, fired: [], changes: [], products: { scene: { present: ["李"] } } } },
)
const sparseLog = L.of({ nodes: [g, same, moved, partial], head: 9 })
assert.equal(heading("scene.place", partial, sparseLog), "林")
assert.equal(heading("scene.place", partial), "林")
assert.equal(sceneOf("scene.place", sparseLog, partial), undefined)
assert.equal(heading("scene.place", same, sparseLog), "亭")
// Explicit removals carry the previous row for the ledger, without a sentinel in world data.
const removed = node(s.state, {
  turn: { changes: [{ kind: "remove_entity", collection: "people", entityId: "e_li", prev: { name: "李" } }] },
})
assert.deepEqual(record(rules, removed, g, declared).at(-1), {
  kind: "product",
  id: "people",
  label: "people",
  shape: people.shape,
  value: [{ name: "李" }],
  change: "remove",
})
console.log("ok")
