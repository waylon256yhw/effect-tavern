import assert from "node:assert/strict"
import type { Cond } from "@effect-tavern/runtime/src/cond.ts"
import type { TurnDetail } from "@effect-tavern/runtime/src/projection.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { timelineNode, token } from "./fixtures.ts"
import {
  apart,
  channelOf,
  demandable,
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

const detail: TurnDetail = {
  id: 1,
  checks: [{ action: "strike", chance: 0.6, roll: 0.7, hit: false }],
  deliveries: [
    { resourceId: "card:li", revision: "v1", title: "Li", text: "a clue", source: "card", residency: "window" },
  ],
  fieldChanges: [
    { path: "hp", was: 40, now: 30 },
    { path: "foe", was: 30, now: 20 },
    { path: "mood", was: "low", now: "high" },
  ],
  changes: [],
  productChanges: [],
  events: [],
  beats: [],
  brief: { must: [], may: [], tone: "" },
  products: {},
}
assert.deepEqual(record(rules, detail), [
  { kind: "meter", path: "hp", label: "体力", min: 0, max: 100, was: 40, now: 30, cuts: [], scale: false },
  { kind: "value", path: "foe", label: "foe", was: 30, now: 20 },
  { kind: "steps", path: "mood", label: "mood", options: ["low", "mid", "high"], was: 0, now: 2 },
  { kind: "check", check: { action: "strike", chance: 0.6, roll: 0.7, hit: false } },
  { kind: "clue", id: "card:li", text: "a clue" },
])
assert.equal(fields(rules, detail).length, 3)
const shape = { kind: "table", columns: [{ key: "name", type: "text" }] } as const
for (const change of ["insert", "patch", "remove", "replace"] as const) {
  const value = [{ name: "李", stance: "ready" }]
  const rows = record(rules, { ...detail, productChanges: [{ id: "people", change, value }] }, [
    { id: "people", role: "world", shape },
  ])
  assert.deepEqual(rows.at(-1), { kind: "product", id: "people", label: "people", shape, change, value })
}
assert.equal(kindOf({ role: "world" }), "world")
assert.equal(kindOf({ role: "chronicle" }), "context")
assert.equal(kindOf({ role: "theater" }), "theater")
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
assert.deepEqual(whens({ fiction: [{ id: "a", when: { path: "hp", op: "lt", value: 3 } }, { id: "b" }] }), [
  { path: "hp", op: "lt", value: 3 },
  undefined,
])
assert.deepEqual(whens(null), [])
const g = { ...timelineNode(1, null, "", ""), heading: "亭" }
const a = { ...timelineNode(2, 1, "", "go"), changeSummary: { fields: 1, checks: 0, deliveries: 0, products: 0 } }
const s = { ...timelineNode(3, 1, "", "go"), sibling: "swipe" as const }
const e = { ...timelineNode(4, 1, "", "stay"), sibling: "edit" as const }
const o = { ...timelineNode(5, 2, "", ""), input: { text: "", note: "slower" } }
const b = { ...timelineNode(6, 2, "", "go"), input: { text: "go", note: "slower" } }
const log = L.of({ nodes: [g, a, s, e, o, b], head: 6 })
assert.equal(fieldChanged(a), true)
assert.equal(fieldChanged(s), false)
assert.equal(marked(a), true)
assert.equal(marked(s), false)
for (const key of ["checks", "deliveries", "products"] as const)
  assert.equal(marked({ ...s, changeSummary: { ...s.changeSummary, [key]: 1 } }), true)
assert.deepEqual([g, a, o, b].map(lineOf), ["", "go", "slower", "go"])
assert.deepEqual([g, a, o, b].map(channelOf), ["greeting", "act", "note", "both"])
assert.equal(parentOf(log, g), undefined)
assert.equal(parentOf(log, a), g)
assert.deepEqual(versions(log, s), { list: [a, s, e], index: 1, varied: true })
assert.equal(versions(L.of({ nodes: [g, a, s], head: 3 }), a).varied, false)
const chips = { ...s, id: 7, input: { text: "go", invoke: ["pack:guide"] }, invocations: [token("pack:guide")] }
assert.equal(versions(L.of({ nodes: [g, a, chips], head: 7 }), a).varied, true)
assert.equal(sceneOf(undefined, log, g), "亭")
assert.equal(sceneOf(undefined, log, a), undefined)
assert.equal(heading(undefined, g), "亭")
const same = { ...a, heading: "亭" }
assert.equal(sceneOf(undefined, L.of({ nodes: [g, same], head: 2 }), same), undefined)
console.log("record ok")

assert.equal(channelOf({ ...chips, input: { text: "", invoke: ["pack:guide"] } }), "invoke")
assert.equal(lineOf({ ...chips, input: { text: "", invoke: ["pack:guide"] } }), "Title pack:guide")

const declaredTheaters = [
  { id: "options", label: "行动选项", role: "theater" as const, shape: { kind: "list" as const }, on: true },
  { id: "inner", label: "人物心声", role: "theater" as const, shape: { kind: "text" as const }, on: false },
  {
    id: "diary",
    label: "日记",
    role: "theater" as const,
    shape: { kind: "text" as const },
    on: true,
    trigger: "demand" as const,
  },
]
assert.deepEqual(demandable(declaredTheaters, { theater: {} }), [{ value: "diary", label: "日记" }])
assert.deepEqual(demandable(declaredTheaters, { theater: { diary: "written" } }), [])
// versions are told apart from the sentence where they differ, not from the opening they share
assert.deepEqual(apart(["她笑了。“好啊。”她点头。", "她笑了。“好啊。”她摇头。", "她笑了。“不行。”"]), [
  "…“好啊。”她点头。",
  "…“好啊。”她摇头。",
  "…“不行。”",
])
assert.deepEqual(apart(["她笑了。", "他走了。"]), ["她笑了。", "他走了。"])
assert.deepEqual(apart(["only"]), ["only"])
