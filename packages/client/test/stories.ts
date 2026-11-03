// stories.ts: the card's four rows (starred first, the open one kept in view), the preview a row carries, the search's
// match over title and hits, the marks it cuts, the cleanup's quick picks.
import assert from "node:assert/strict"
import {
  ago,
  empty,
  matches,
  openOn,
  personaOn,
  pieces,
  preview,
  ranked,
  shown,
  turnLabel,
  unnamed,
  type Hit,
} from "../src/stories.ts"
import type { StoryRow } from "../src/store.ts"

const row = (id: number, p: Partial<StoryRow> = {}): StoryRow => ({
  id,
  card: "wuxia",
  busy: null,
  title: null,
  starred: false,
  persona: null,
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
assert.deepEqual(
  shown(rows, 1).map((s) => s.id),
  [2, 5, 1, 3],
)
assert.deepEqual(
  shown(rows, 6).map((s) => s.id),
  [2, 5, 1, 6],
) // the open story below the cut takes the last row
assert.deepEqual(
  shown(rows, undefined).map((s) => s.id),
  [2, 5, 1, 3],
)
assert.deepEqual(
  shown(rows.slice(0, 3), 3).map((s) => s.id),
  [2, 1, 3],
) // fewer than four: all of them

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
const now = new Date(2026, 9, 31, 22, 55, 12).getTime()
assert.deepEqual(
  [ago(now, now), ago(now - 16 * 6e4, now), ago(now - 3 * 864e5, now)],
  ["2026/10/31 22:55:12", "2026/10/31 22:39:12", "2026/10/28"],
)

assert.deepEqual(rows.map(empty), [false, false, false, false, false, false])
assert.equal(empty(row(7, { turns: 0 })), true)
assert.deepEqual(rows.map(unnamed), [true, false, true, true, false, true]) // starred or named is kept
assert.deepEqual([turnLabel({ ...hits.get(3)!, turn: 0 }), turnLabel(hits.get(3)!)], ["开场白", "第 2 轮"])

// The workspace's persona row: the open story's own when it is of the card, else the card's default.
{
  const lib = { current: 2, stories: [row(1, { persona: "monk" }), row(2), row(3, { card: "other", persona: "nun" })] }
  const defaults = { wuxia: "friend", other: "monk" }
  assert.equal(personaOn(lib, defaults, "wuxia", "reader"), undefined) // story 2 is open, on the card's own
  assert.equal(personaOn({ ...lib, current: 1 }, defaults, "wuxia", "reader"), "monk")
  // the card's page: the tab keeps story 1 for Escape, but the row is the card's default
  assert.equal(openOn({ ...lib, current: 1 }, "wuxia", "card"), undefined)
  assert.equal(personaOn({ ...lib, current: 1 }, defaults, "wuxia", "card"), "friend")
  assert.equal(personaOn(lib, defaults, "other", "reader"), "monk") // the open story is another card's: the default
}
console.log("ok")
