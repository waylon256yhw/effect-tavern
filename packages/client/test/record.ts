// The Record projection: changed fields by shape (enum → steps, two-bounded int → meter, the rest → value), checks,
// clues with pinnability from `readable`, the pin's fate, notes; an unchanged root yields nothing. Then the turn
// heading under a field path or a product key, and the reading line folded into scene runs.
import assert from "node:assert/strict"
import { heading, record, scenes, status } from "../src/record.ts"

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
  node({ hp: 40, foe: 30, mood: "low" }),
)
assert.deepEqual(els, [
  { kind: "meter", path: "hp", label: "体力", min: 0, max: 100, was: 40, now: 30 },
  { kind: "value", path: "foe", label: "foe", was: 30, now: 20 }, // bounded on one side only: not a meter
  { kind: "steps", path: "mood", label: "mood", options: ["low", "mid", "high"], was: 0, now: 2 },
  { kind: "check", check: { action: "strike", chance: 0.6, roll: 0.7, hit: false } },
  { kind: "clue", id: "li", text: "a clue", pinnable: true },
  { kind: "pin", id: "li", told: false }, // pinned, never fired: the row is where it can be pinned again
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
  [{ kind: "pin", id: "li", told: true }],
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
// Scenes: runs of one title along the line; an untitled node joins the run before it; the id is the run's first node
assert.deepEqual(
  scenes("scene.place", [
    at(1, {}, { scene: { place: "竹林" } }),
    at(2, {}, { scene: { place: "竹林" } }),
    at(3, {}),
    at(4, {}, { scene: { place: "渡口" } }),
    at(5, {}, { scene: { place: "竹林" } }),
  ]),
  [
    { title: "竹林", id: 1 },
    { title: "渡口", id: 4 },
    { title: "竹林", id: 5 },
  ],
)
console.log("ok")
