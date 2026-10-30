// stories.ts: the sidebar's order (starred first), the preview a row carries, the search's
// match over title and hits, the marks it cuts, the cleanup's quick picks.
import assert from "node:assert/strict"
import { ago, empty, matches, pieces, preview, ranked, stays, turnLabel, unnamed, type Hit } from "../src/stories.ts"
import type { StoryRow } from "../src/store.ts"

const row = (id: number, p: Partial<StoryRow> = {}): StoryRow => ({
  id,
  card: "wuxia",
  busy: null,
  title: null,
  starred: false,
  updated: 100 - id, // newest first, as the listing comes
  turns: 1,
  last: { text: `line ${id}` },
  ...p,
})
const rows = [row(1), row(2, { starred: true }), row(3), row(4), row(5, { starred: true, title: "五" }), row(6)]
assert.deepEqual(
  ranked(rows).map((s) => s.id),
  [2, 5, 1, 3, 4, 6],
) // starred first, each group newest first
assert.equal(preview(row(1)), "line 1")
assert.equal(preview(row(1, { last: { text: "  ", note: "慢一点" } })), "（场外指导）慢一点")
assert.equal(preview(row(1, { last: { text: "" } })), null)
assert.equal(preview(row(1, { last: null, turns: 0 })), null)

const hits = new Map<number, Hit>([[3, { id: 3, turn: 2, kind: "reply", text: "…雨…", count: 1 }]])
assert.deepEqual(
  rows.map((s) => matches(s, "", hits)),
  [true, true, true, true, true, true],
)
assert.deepEqual(
  rows.map((s) => matches(s, "雨", hits)),
  [false, false, true, false, false, false],
) // the server's hit
assert.deepEqual(
  rows.map((s) => matches(s, " 五 ", new Map())),
  [false, false, false, false, true, false],
) // the title, trimmed (the hits are the query's own: none here)
assert.equal(matches(row(9, { title: "Rainy Night" }), "rainy", new Map()), true)

assert.deepEqual(pieces("the rain in Spain", "ain"), [
  { text: "the r", hit: false },
  { text: "ain", hit: true },
  { text: " in Sp", hit: false },
  { text: "ain", hit: true },
])
assert.deepEqual(pieces("Rain", "rain"), [{ text: "Rain", hit: true }])
assert.deepEqual(pieces("no hit", "x"), [{ text: "no hit", hit: false }])
assert.deepEqual(pieces("as is", "  "), [{ text: "as is", hit: false }])
assert.deepEqual(pieces("İstanbul", "stan"), [
  { text: "İ", hit: false },
  { text: "stan", hit: true },
  { text: "bul", hit: false },
]) // only ASCII folds, so the marks land where the text is
assert.deepEqual(pieces("Ärger", "ärger"), [{ text: "Ärger", hit: false }]) // as the server would not match it either
assert.equal(matches(row(9, { title: "Ärger" }), "ärger", new Map()), false)
const now = 1_000_000_000_000
assert.deepEqual(
  [
    ago(now - 16 * 6e4, "en", now),
    ago(now - 16 * 6e4, "zh", now),
    ago(now - 864e5, "en", now),
    ago(now, "en", now),
    ago(now, "zh", now),
  ],
  ["16 minutes ago", "16分钟前", "yesterday", "now", "刚刚"],
)

assert.deepEqual(rows.map(empty), [false, false, false, false, false, false])
assert.equal(empty(row(7, { turns: 0 })), true)
assert.deepEqual(rows.map(unnamed), [true, false, true, true, false, true]) // starred or named is kept
assert.deepEqual([turnLabel({ ...hits.get(3)!, turn: 0 }), turnLabel(hits.get(3)!)], ["开场白", "第 2 轮"])
console.log("ok")
// After a delete: the client stays only when the story it was on survived and is still named; the open story among
// the deleted moves even when the placeholder made in its stead carries its id again (a pre-autoincrement library)
assert.equal(stays(1, [2], 1), true)
assert.equal(stays(1, [2], 3), false)
assert.equal(stays(1, [1], 1), false)
assert.equal(stays(1, [1, 2], 3), false)
assert.equal(stays(undefined, [], 1), false)
console.log("ok")
