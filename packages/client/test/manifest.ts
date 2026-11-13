// The card page's chips and opening lines on the template cards' shapes: a fiction label is not a chip, a hidden
// field is not a state, an opening's tag prefers the route it sets.
import { full } from "@effect-tavern/runtime/test/cards/index.ts"
import assert from "node:assert/strict"
import { admitsOpening, chips, firstLine, openingTag, openingTags } from "../src/manifest.ts"
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
  facets: { mode: "act", fields: false, actions: false, readouts: false, lore: false, openings: false, tokens: 0 },
  fiction: [],
  rules: { fields: [], actions: [] },
  local: { id: "local", name: "local", card: "t" },
  mounts: [],
  persona: null,
  layer: {
    frame: [],
    tail: [],
    asks: {},
    products: [],
    entries: [],
    lexicon: [],
    snippets: [],
    format: [],
    names: {},
    holes: [],
    switches: { value: {}, sentences: {}, taken: { pov: null, verbosity: null } },
    dropped: [],
  },
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
assert.deepEqual(chips(ri), [{ label: "参与者" }, { label: "状态", items: ["好感度"] }]) // no module label, no hidden field
assert.deepEqual(chips(view({ input: "note", facets: { ...view({}).facets, mode: "note" } })), [{ label: "作者" }]) // nothing tracked
// each mechanism the card has, in the shelf's words (no card tags: the player's words are Local.tags, #133)
assert.deepEqual(
  chips(view({ facets: { ...view({}).facets, actions: true, openings: true } })).map((c) => c.label),
  ["参与者", "检定", "多开场"],
)
// what each chip lists when tapped: fields by label, actions and readouts by id, the lore's size, the openings' count
const all = chips(
  view({
    greetings: [{ text: "a" }, { text: "b" }, { text: "c" }],
    lore: { entries: 4, layers: 7 },
    facets: { ...view({}).facets, fields: true, actions: true, readouts: true, lore: true, openings: true },
    rules: {
      fields: [
        { path: "hp", label: "体力", type: "int", initial: 3 },
        { path: "gold", type: "int", initial: 0 },
      ],
      actions: [{ id: "闪避", text: "dodge", roll: 50 }],
      readouts: [{ id: "心情", text: "mood?", options: [] }],
    },
  }),
)
assert.equal(all[0]?.items, undefined) // the mode chip lists nothing: a plain pill
assert.deepEqual(
  all.slice(1).map((c) => [c.label, c.items]),
  [
    ["状态", ["体力", "gold"]],
    ["检定", ["dodge"]], // the text, not the id: what the player reads
    ["读数", ["mood?"]],
    ["线索", ["4 条 · 7 层"]],
    ["多开场", ["3 个开场白"]],
  ],
)
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
assert.deepEqual(
  openingTags(yandao, {
    text: "x",
    do: [{ path: "局势", set: 7 }, { path: "起点", set: "血案" }, { event: "冲突:升级" }],
  }),
  ["起点 = 血案", "局势 = 7"],
)
assert.equal(openingTag(yandao, { text: "x", do: [{ path: "局势", set: 7 }] }), "局势 = 7")
assert.equal(openingTag(yandao, { text: "x" }), undefined)
const bloody = { text: "黄昏。盐津镇的石板街上", do: [{ path: "起点", set: "血案" }] }
assert.equal(admitsOpening(yandao, bloody, ""), true)
assert.equal(admitsOpening(yandao, bloody, "盐津 血案"), true) // matches across prose and state tag
assert.equal(admitsOpening(yandao, bloody, "盐津 -血案"), false) // `-` negates
assert.equal(admitsOpening(yandao, bloody, "平静"), false)
assert.equal(firstLine("  黄昏。盐津镇的石板街上\r\n第二段"), "黄昏。盐津镇的石板街上")
assert.equal(firstLine("**午后的阳光**从彩绘玻璃窗渗入\n\n*第二段*"), "午后的阳光从彩绘玻璃窗渗入")
assert.ok(chips(view({ rules: full.rules })).some((c) => c.label === "状态" && c.items?.includes("体力")))
console.log("manifest ok")
