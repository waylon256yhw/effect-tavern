// The Record projection: changed fields by shape (enum → steps, two-bounded int → meter, the rest → value), checks,
// clues with pinnability from `readable`, notes; an unchanged root yields nothing.
import assert from "node:assert/strict"
import { record, status } from "../src/record.ts"

const rules = {
  fields: [
    { path: "hp", label: "体力", group: "Body", type: "int", min: 0, max: 100, initial: 40 },
    { path: "foe", type: "int", min: 0, initial: 30 },
    { path: "mood", type: "enum", group: "Body", options: ["low", "mid", "high"], initial: "low" },
  ],
  actions: [],
} as any
const node = (state: object, extra: object = {}) =>
  ({ turn: { products: {} }, state, checks: [], delivered: [], readable: [], ...extra }) as any

assert.deepEqual(record(rules, node({ hp: 40, foe: 30, mood: "low" }), undefined), [])
const els = record(
  rules,
  node(
    { hp: 30, foe: 20, mood: "high" },
    {
      checks: [{ action: "strike", chance: 0.6, roll: 0.7, hit: false }],
      delivered: [{ id: "li", layer: 1, text: "a clue" }],
      readable: [{ id: "li", hook: "more" }],
      turn: { products: { notes: ["a fact"] } },
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
  { kind: "notes", items: ["a fact"] },
])
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
console.log("ok")
