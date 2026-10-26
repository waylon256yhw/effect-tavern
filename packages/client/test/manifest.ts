// The card page's rows and opening lines on the template cards' shapes: a variant folds away, a hidden field is not
// a state, an unlabelled module is not named, an opening's tag prefers the route it sets.
import { full } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { firstLine, openingTag, specs } from "../src/manifest.ts"
import type { CardView } from "../src/store.ts"

const view = (over: Partial<CardView>): CardView => ({
  id: "t",
  title: "t",
  input: "act",
  greetings: [],
  director: false,
  guard: 0,
  lore: { entries: 0, layers: 0 },
  tokens: { head: 0 },
  fiction: [],
  rules: { fields: [], actions: [] },
  products: [],
  snippets: [],
  format: [],
  ...over,
})
const ri = view({
  fiction: [
    { id: "ri", label: "理" },
    { id: "band-20", label: "理（好感 20–40）", when: { path: "好感度", op: "gte", value: 20 } },
    { id: "examples" },
  ],
  rules: {
    fields: [
      { path: "好感度", type: "int", initial: 60 },
      { path: "恋人", type: "boolean", initial: false, hidden: true },
    ],
    actions: [],
  },
})
assert.deepEqual(specs(ri), [
  { key: "Setting", items: ["理"] },
  { key: "Mode", items: ["participant"] },
  { key: "State", items: ["好感度"] },
])
assert.deepEqual(specs(view({ input: "note" })), [{ key: "Mode", items: ["author"] }]) // nothing named, nothing tracked
const yandao = view({
  rules: {
    fields: [
      { path: "局势", type: "int", initial: 2 },
      { path: "起点", type: "enum", options: ["平静", "血案"], initial: "平静" },
    ],
    actions: [],
  },
})
assert.equal(
  openingTag(yandao, {
    text: "x",
    do: [{ path: "局势", set: 7 }, { path: "起点", set: "血案" }, { event: "冲突:升级" }],
  }),
  "起点 = 血案",
)
assert.equal(openingTag(yandao, { text: "x", do: [{ path: "局势", set: 7 }] }), "局势 = 7")
assert.equal(openingTag(yandao, { text: "x" }), undefined)
assert.equal(firstLine("  黄昏。盐津镇的石板街上\r\n第二段"), "黄昏。盐津镇的石板街上")
assert.ok(specs(view({ rules: full.rules, fiction: [] })).some((r) => r.key === "State" && r.items.includes("体力")))
console.log("manifest ok")
