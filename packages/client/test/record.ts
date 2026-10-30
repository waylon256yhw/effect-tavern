// The Record projection: changed fields by shape (enum → steps, two-bounded int → meter, the rest → value), checks,
// clues with pinnability from `readable`, the pin's fate, notes; an unchanged root yields nothing. Then the turn
// heading under a field path or a product key.
import assert from "node:assert/strict"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import {
  channelOf,
  fieldChanged,
  fields,
  heading,
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
const node = (state: object, extra: object = {}) =>
  ({ turn: { input: {}, fired: [], products: {} }, state, checks: [], delivered: [], readable: [], ...extra }) as any

assert.deepEqual(record(rules, node({ hp: 40, foe: 30, mood: "low" }), undefined), [])
const els = record(
  rules,
  node(
    { hp: 30, foe: 20, mood: "high" },
    {
      checks: [{ action: "strike", chance: 0.6, roll: 0.7, hit: false }],
      delivered: [{ id: "li", layer: 1, text: "a clue" }],
      readable: [{ id: "li", hook: "more" }],
      turn: { input: { text: "go", pin: "li" }, fired: [], products: { notes: ["a fact"] } },
    },
  ),
  node({ hp: 40, foe: 30, mood: "low" }, { readable: [{ id: "li", hook: "a hook" }] }),
)
assert.deepEqual(els, [
  { kind: "meter", path: "hp", label: "体力", min: 0, max: 100, was: 40, now: 30, cuts: [], scale: false },
  { kind: "value", path: "foe", label: "foe", was: 30, now: 20 }, // bounded on one side only: not a meter
  { kind: "steps", path: "mood", label: "mood", options: ["low", "mid", "high"], was: 0, now: 2 },
  { kind: "check", check: { action: "strike", chance: 0.6, roll: 0.7, hit: false } },
  { kind: "clue", id: "li", text: "a clue", pinnable: true },
  { kind: "pin", id: "li", hook: "a hook", told: false }, // pinned, never fired: the row is where it can be pinned again; named by the parent's hook
  { kind: "notes", items: ["a fact"] },
])
assert.deepEqual(
  record(
    rules,
    node(
      { hp: 40, foe: 30, mood: "low" },
      { turn: { input: { pin: "li" }, fired: [{ id: "li", layer: 2 }], products: {} } },
    ),
    undefined,
  ),
  [{ kind: "pin", id: "li", hook: "li", told: true }], // no parent to name it: the id
)
// Products: every declared one on the node but notes (its own kind) and options (the Options container), by shown
// name, in the card's order; one not on the node (off, or not yet demanded) draws nothing
const declared = [
  { id: "notes", label: "事件摘要", shape: { kind: "list" } },
  { id: "options", shape: { kind: "list" } },
  { id: "inner", label: "人物心声", shape: { kind: "text" } },
  { id: "scene", shape: { kind: "record", keys: [{ key: "place", type: "text" }] } },
] as const
assert.deepEqual(
  record(
    rules,
    node(
      { hp: 40, foe: 30, mood: "low" },
      { turn: { input: {}, fired: [], products: { notes: ["n"], options: ["o"], scene: { place: "亭" } } } },
    ),
    undefined,
    declared,
  ),
  [
    { kind: "notes", items: ["n"] },
    {
      kind: "product",
      id: "scene",
      label: "scene",
      shape: { kind: "record", keys: [{ key: "place", type: "text" }] },
      value: { place: "亭" },
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
// Heading: a field path first, else `<product>.<key>`; empty or missing → none
const at = (id: number, state: object, products: object = {}) => ({
  ...node(state, { turn: { id, input: {}, fired: [], products } }),
})
assert.equal(heading("mood", at(1, { mood: "high" })), "high")
assert.equal(heading("scene.place", at(1, {}, { scene: { place: "竹林小径" } })), "竹林小径")
assert.equal(heading("scene.place", at(1, {}, { scene: { place: "" } })), undefined)
assert.equal(heading("scene.place", at(1, {})), undefined)
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
      { turn: { id, parent, input, fired: [], products: {}, ...(sibling && { sibling }) }, ...extra },
    ),
  }) as any
const g = n(
  1,
  null,
  { text: "" },
  { turn: { id: 1, input: { text: "" }, fired: [], products: { scene: { place: "亭" } } } },
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
assert.equal(marked(rules, node(s.state, { turn: { input: {}, fired: [], products: { notes: ["n"] } } }), g), false) // notes alone
assert.equal(marked(rules, node(s.state, { checks: [{ action: "x", chance: 1, roll: 0, hit: true }] }), g), true)
assert.equal(marked(rules, node(s.state, { delivered: [{ id: "li", layer: 1, text: "c" }] }), g), true)
assert.equal(marked(rules, node(s.state, { turn: { input: { pin: "li" }, fired: [], products: {} } }), g), true)
const scened = node(s.state, { turn: { input: {}, fired: [], products: { options: ["o"], scene: { place: "亭" } } } })
assert.equal(marked(rules, scened, g, declared), true) // a declared product
assert.equal(marked(rules, scened, g), false) // undeclared: not drawn, no dot
assert.equal(
  marked(rules, node(s.state, { turn: { input: {}, fired: [], products: { options: ["o"] } } }), g, declared),
  false,
)
// the yes/no agree with record() over the same nodes
for (const x of [a, s, scened]) {
  assert.equal(
    fieldChanged(rules, x, g),
    record(rules, x, g).some((el) => "path" in el),
  )
  assert.equal(
    marked(rules, x, g, declared),
    record(rules, x, g, declared).some((el) => el.kind !== "notes"),
  )
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
assert.equal(sceneOf(undefined, log, g), undefined)
const same = n(7, 1, { text: "on" }, { turn: { id: 7, input: {}, fired: [], products: { scene: { place: "亭" } } } })
const moved = n(8, 1, { text: "on" }, { turn: { id: 8, input: {}, fired: [], products: { scene: { place: "林" } } } })
const both = L.of({ nodes: [g, same, moved], head: 8 })
assert.equal(sceneOf("scene.place", both, same), undefined) // the parent's title again: no new scene
assert.equal(sceneOf("scene.place", both, moved), "林")
console.log("ok")
