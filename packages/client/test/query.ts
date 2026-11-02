// query.ts: the shelf's search terms (plain, `#tag`, `#facet`, `-` negation, AND across terms) over GET /cards rows
// and the player's words (Player.tags), the plain words the rows mark, and the tag edits (retag, spare) (stories.ts `pieces` over several words). Under Bun the locale is zh-CN.
import assert from "node:assert/strict"
import type { Player } from "@effect-tavern/runtime/src/fragment.ts"
import { admits, parse, plain, retag, spare } from "../src/query.ts"
import type { ShelfCard } from "../src/store.ts"
import { pieces } from "../src/stories.ts"
import en from "../src/locales/en.ts"
import zh from "../src/locales/zh-CN.ts"

const off = {
  mode: "act",
  fields: false,
  actions: false,
  readouts: false,
  lore: false,
  openings: false,
  tokens: 9,
} as const
const shelf: ShelfCard[] = [
  { id: "wuxia", title: "竹林", summary: "苦竹岭的剑客", facets: { ...off, actions: true, lore: true } },
  { id: "banxing", title: "伴星 Star", facets: off },
  { id: "yandao", title: "盐道", facets: { ...off, mode: "note", openings: true } },
  { id: "table", title: "表里" }, // a library-table row: no facets
]
const tags: Record<string, string[]> = { wuxia: ["武侠", "对峙"], banxing: ["日常"] } // the player's, per card
const ids = (q: string) => shelf.filter((c) => admits(c, parse(q), tags[c.id])).map((c) => c.id)

assert.deepEqual(ids(""), ["wuxia", "banxing", "yandao", "table"]) // empty query: every card
assert.deepEqual(ids("   - # "), ["wuxia", "banxing", "yandao", "table"]) // bare marks are no terms
assert.deepEqual(ids("star"), ["banxing"]) // plain, ASCII folded, over the title
assert.deepEqual(ids("剑客"), ["wuxia"]) // plain over the summary
assert.deepEqual(ids("对"), ["wuxia"]) // plain over a tag, by substring
assert.deepEqual(ids("#对"), []) // `#` is exact
assert.deepEqual(ids("#日常"), ["banxing"]) // a player's word
assert.deepEqual(ids("#检定"), ["wuxia"]) // a facet's word
assert.deepEqual(ids("#作者"), ["yandao"]) // the mode facet
assert.deepEqual(ids("#参与者"), ["wuxia", "banxing"])
assert.deepEqual(ids("#多开场"), ["yandao"])
assert.deepEqual(ids("-#检定"), ["banxing", "yandao", "table"]) // negated
assert.deepEqual(ids("-竹"), ["banxing", "yandao", "table"])
assert.deepEqual(ids("#参与者 -#武侠"), ["banxing"]) // AND across terms
assert.deepEqual(ids("#线索 star"), [])

// only the plain, positive words are marked; several at once
assert.deepEqual(plain(parse("Star #日常 -盐 竹")), ["star", "竹"])
assert.deepEqual(pieces("竹林 Star", ["star", "竹"]), [
  { text: "竹", hit: true },
  { text: "林 ", hit: false },
  { text: "Star", hit: true },
])
assert.deepEqual(pieces("abc", ["ab", "abc"]), [{ text: "abc", hit: true }]) // the longest at one place
// a facet's word is one `#` token in either locale: no whitespace in it
for (const d of [zh, en])
  for (const [k, w] of Object.entries(d.card))
    if (/^(facet|mode|specState)/.test(k)) assert.doesNotMatch(w, /\s/, `${k}: ${w}`)

// the tag edits: trimmed, deduped, an empty list drops the card's key, an empty map the field
const me: Player = { global: [], forCard: {}, tags: { wuxia: ["武侠"] } }
assert.deepEqual(retag(me, "wuxia", (ws) => [...ws, " 对峙 ", "武侠", ""]).tags, { wuxia: ["武侠", "对峙"] })
assert.deepEqual(retag(me, "banxing", (ws) => [...ws, "日常"]).tags, { wuxia: ["武侠"], banxing: ["日常"] })
assert.equal(retag(me, "wuxia", () => []).tags, undefined)
// what one tap attaches: the player's words elsewhere, not on this card, filtered by the field
const all = { wuxia: ["武侠", "对峙"], banxing: ["日常", "武侠"], yandao: ["Noir"] }
assert.deepEqual(spare(all, "banxing", ""), ["对峙", "Noir"])
assert.deepEqual(spare(all, "banxing", "no"), ["Noir"]) // folded substring
assert.deepEqual(spare(undefined, "banxing", ""), [])
console.log("query ok")
