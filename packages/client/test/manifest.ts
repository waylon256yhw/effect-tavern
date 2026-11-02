// The card page's chips and opening lines on the template cards' shapes: a fiction label is not a chip, a hidden
// field is not a state, an opening's tag prefers the route it sets.
import { full } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { chips, firstLine, openingTag } from "../src/manifest.ts"
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
assert.deepEqual(chips(ri), [{ label: "参与者" }, { label: "状态", hint: "好感度" }]) // no module label, no hidden field
assert.deepEqual(chips(view({ input: "note" })), [{ label: "作者" }]) // nothing tracked
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
assert.equal(firstLine("**午后的阳光**从彩绘玻璃窗渗入\n\n*第二段*"), "午后的阳光从彩绘玻璃窗渗入")
assert.ok(chips(view({ rules: full.rules })).some((c) => c.label === "状态" && c.hint?.includes("体力")))
console.log("manifest ok")
