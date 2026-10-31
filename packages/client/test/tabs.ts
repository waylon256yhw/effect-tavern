// The tabs (src/tabs.ts) over one Reading on a faked wire: a tab keeps its page stack and scroll, a switch to another
// story activates it once and a switch to the same story (a mirror) not at all; "+" is always a home tab with nothing
// in the slots and no story named, so a turn left running and a line half typed stay the story's; the active tab
// clicked again does nothing; another card browsed from a story tab keeps the story for Escape, and a card entered from
// a home tab pushes the card page over home (Back returns to home and the shelf); × hands over to its right neighbour
// first, and on the last tab leaves a home tab; eight at most; a deleted story's tab stays as its card's page over
// home, the others stay put; the device's list comes back without the stories the listing does not name; a turn's
// stages mark its row busy, and its end seen from elsewhere marks it unread until a tab of it is activated; a fresh
// start lands on a home tab beside the remembered ones.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { backOf, browse, close, onDelete, open, openStory, pick, showCard } from "../src/pages.ts"
import { createReading, reading } from "../src/reading.ts"
import {
  activeOf,
  apply,
  boxes,
  card,
  type CardView,
  focus,
  isHome,
  layer,
  log,
  page,
  registry,
  setBoxes,
  settle,
  stories,
  type StoryRow,
  tabs,
  working,
} from "../src/store.ts"
import { add, CAP, home, remove, restore, scroll, select, unread } from "../src/tabs.ts"

const row = (id: number, cardId: string, updated = id): StoryRow =>
  ({ id, card: cardId, busy: null, title: null, starred: false, updated, turns: 1, last: null }) as StoryRow
let rows = [row(1, "a"), row(2, "b"), row(3, "a")]
const cardOf = (id: number | null | undefined) => rows.find((s) => s.id === id)?.card
const opened: number[] = [] // the stories the Reading read afresh: one per real switch
Object.assign(
  reading,
  createReading({
    openStory: async (id) => (opened.push(id), { current: id, stories: rows }),
    fetchNodes: async () => registry.set(log, L.of({ nodes: [{ id: 0, parent: null }] as any, head: 0 })),
    fetchCard: async () => registry.set(card, { id: cardOf(registry.get(stories)?.current) } as CardView),
    attach: () => {},
    abandon: settle, // as turn.ts's: the draft, the stage and the error dropped
  }),
)
// what tabs.ts and pages.ts read on their own: the open story's card, a card by id
;(globalThis as any).fetch = async (url: string) => {
  const path = String(url)
  const body = path === "/api/card" ? { id: cardOf(registry.get(stories)?.current) } : { id: path.split("/").at(-1) }
  return new Response(JSON.stringify(body))
}
let top = 0
const restored: number[] = []
scroll.get = () => top
scroll.set = (n) => void restored.push(n)
const tab = () => activeOf(registry.get(tabs))
const ids = () => registry.get(tabs).list.map((t) => t.id)
const busy = (id: number) => registry.get(stories)?.stories.find((s) => s.id === id)?.busy ?? null
registry.set(stories, { current: null, stories: rows })

// A in the first tab, a page over it, scrolled, a line half typed and a turn running: its row is busy
await openStory(1)
const A = tab().id
open("timeline")
top = 120
setBoxes({ text: "半句", note: "", aside: false })
apply({ kind: "stage", phase: "lookup" })
assert.deepEqual([registry.get(working), busy(1)], [true, "lookup"])
// "+": always a home tab, never a mirror of A: the slots empty, no story named, the sidebar on the shelf, A's row still
// busy
await add()
assert.deepEqual(
  [tab().story, tab().card, registry.get(page), registry.get(layer), opened],
  [null, null, "home", "shelf", [1]],
)
assert.deepEqual(
  [boxes().text, registry.get(working), registry.get(log).nodes.size, registry.get(stories)?.current, busy(1)],
  ["", false, 0, null, "lookup"],
)
// a home tab is the bottom of its stack: Escape and its own click leave it on home
close()
pick(tab().id)
assert.equal(registry.get(page), "home")
// A's turn ends, read by a listing refresh while this tab is active: A is unread
rows = rows.map((s) => ({ ...s, busy: null }))
registry.set(stories, { current: null, stories: rows })
assert.deepEqual([...registry.get(unread)], [1])
// B browsed in the new tab: the active tab is on it
await browse("b")
const B = tab().id
assert.deepEqual([tab().story, registry.get(focus), registry.get(card)?.id, opened], [2, "b", "b", [1, 2]])
top = 40
// back to A's tab: its stack, scroll and line, A activated once, its mark gone
pick(A)
await select(A) // the switch pick started, done
assert.deepEqual([registry.get(page), registry.get(focus), registry.get(card)?.id], ["timeline", "a", "a"])
assert.deepEqual([opened, restored, boxes().text, registry.get(unread).size], [[1, 2, 1], [120], "半句", 0])
// the active tab clicked again does nothing; each page's own Back returns to the reader
pick(A)
assert.equal(registry.get(page), "timeline")
close()
assert.equal(registry.get(page), "reader")
// another card's page browsed from A's tab: the tab keeps A, and Escape takes it back with its card
await showCard("b")
assert.deepEqual([tab().story, tab().card, registry.get(page)], [1, "b", "card"])
close()
await new Promise((r) => setTimeout(r, 0)) // the story's card, read again
assert.deepEqual([tab().story, tab().card, registry.get(page), registry.get(card)?.id], [1, "a", "reader", "a"])

// a mirror: another tab on A (made through a card tab, so A is read once more), then between the two: no activation
await add()
await openStory(1)
const M = tab().id
const n = opened.length
await select(A)
await select(M)
assert.deepEqual([tab().story, opened.length], [1, n])
// back to B and to the mirror: one activation each way
await select(B)
await select(M)
assert.deepEqual(opened.slice(n), [2, 1])

// ×: the active one hands over to its right neighbour first, the left at the end; on the last tab it resets to a home
// tab (a home tab already on home is untouched)
assert.deepEqual(ids(), [A, B, M])
await select(B)
await remove(B)
assert.deepEqual([ids(), tab().id], [[A, M], M])
await remove(M)
assert.deepEqual([ids(), tab().id], [[A], A])
await remove(A) // the last tab, on story 1: replaced by a fresh home tab
const N = tab().id
assert.deepEqual(
  [ids(), N !== A, isHome(tab()), registry.get(page), registry.get(layer)],
  [[N], true, true, "home", "shelf"],
)
await remove(N) // already a home tab on home: nothing
assert.deepEqual(ids(), [N])

// eight at most: a "+" on a full strip drops the oldest tab but the active one
await select(N)
for (let i = 1; i < CAP; i++) await add()
await select(N)
await add()
assert.equal(ids().length, CAP)
assert.ok(ids().includes(N) && tab().story === null) // N was the oldest, but active when "+" was pressed
// a tab on story 2 left for a tab on 3
await browse("b")
const D = tab().id
await add()
await openStory(3)
const E = tab().id
// a delete while on a card tab: nothing moves
await add()
const F = tab().id
await onDelete({ current: 1, stories: rows.filter((s) => s.id !== 2) }, [2])
const d = registry.get(tabs).list.find((t) => t.id === D)!
assert.deepEqual([d.story, d.card, d.page, d.under], [null, "b", "card", ["home"]]) // story 2's tab: its card's page over home
assert.deepEqual([tab().id, tab().story, registry.get(stories)?.current], [F, null, null])
// the active tab's story deleted: that tab is a card tab on its card over home, the slots empty, the other tabs intact
await select(E)
const before = registry.get(tabs).list.filter((t) => t.id !== E)
await onDelete({ current: 1, stories: rows.filter((s) => s.id !== 2 && s.id !== 3) }, [3])
assert.deepEqual(
  [
    tab().id,
    tab().story,
    tab().card,
    registry.get(page),
    backOf(tab()),
    registry.get(stories)?.current,
    registry.get(log).nodes.size,
  ],
  [E, null, "a", "card", "home", null, 0],
)
assert.deepEqual(
  registry.get(tabs).list.filter((t) => t.id !== E),
  before,
)

// the device's list: a story the listing does not name and a card the shelf lacks drop; the active one by index
const lib = { stories: [row(1, "a"), row(3, "a")] }
const back = restore(
  JSON.stringify({
    tabs: [
      { story: 1, card: "a" },
      { story: 9, card: "a" },
      { story: null, card: "b" },
      { story: null, card: "z" },
    ],
    active: 2,
  }),
  lib,
  [{ id: "a" }, { id: "b" }],
)!
assert.deepEqual(
  back.list.map((t) => [t.story, t.card, t.page, t.under]),
  [
    [1, "a", "reader", []],
    [null, "b", "card", ["home"]],
  ],
)
assert.equal(back.active, back.list[1]!.id)
assert.equal(restore("not json", lib, []), null)
assert.equal(restore(JSON.stringify({ tabs: [{ story: 9 }] }), lib, []), null)

// a turn that ends under the active tab is not unread
await openStory(1)
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "error", message: "x" })
assert.deepEqual([busy(1), registry.get(unread).size], [null, 0])

// home: a home tab (no story, no card) comes back from the device as one; a fresh start keeps the remembered list
// and lands on a home tab, the one it has or a new one at the end (on a full strip the oldest goes), the slots empty
const homed = restore(
  JSON.stringify({
    tabs: [
      { story: 1, card: "a" },
      { story: null, card: null },
    ],
    active: 0,
  }),
  lib,
  [],
)!
assert.deepEqual(
  homed.list.map((t) => [t.story, t.card, t.page]),
  [
    [1, "a", "reader"],
    [null, null, "home"],
  ],
)
await home(homed)
assert.deepEqual(
  [ids(), tab().id, registry.get(page), registry.get(layer), registry.get(stories)?.current],
  [homed.list.map((t) => t.id), homed.list[1]!.id, "home", "shelf", null],
)
const full = restore(JSON.stringify({ tabs: Array.from({ length: CAP }, () => ({ story: 1, card: "a" })) }), lib, [])!
await home(full)
assert.deepEqual([ids().length, ids().includes(full.list[0]!.id), registry.get(page)], [CAP, false, "home"])
// a card entered from a home tab pushes its card page over home: Back returns to home and puts the sidebar back on the
// shelf; settings opened from home or a card page returns there on close without adding a tab
const H = tab().id
open("settings")
assert.deepEqual([tab().id, registry.get(page)], [H, "settings"])
close()
assert.deepEqual([tab().id, isHome(tab()), registry.get(page)], [H, true, "home"])
await showCard("b")
assert.deepEqual(
  [tab().id, tab().card, registry.get(page), tab().under, backOf(tab())],
  [H, "b", "card", ["home"], "home"],
)
open("settings")
close()
assert.deepEqual([tab().id, tab().card, registry.get(page), backOf(tab())], [H, "b", "card", "home"])
close()
assert.deepEqual([tab().id, isHome(tab()), registry.get(page), registry.get(layer)], [H, true, "home", "shelf"])
// switching to a story tab puts the sidebar on its card's workspace (the newest of the restored ones: "+" on the full
// strip dropped the oldest)
await select(full.list.at(-1)!.id)
assert.equal(registry.get(layer), "workspace")
console.log("tabs ok")
