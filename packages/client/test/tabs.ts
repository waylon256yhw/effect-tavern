// The tabs (src/tabs.ts) over one Reading on a faked wire: a tab keeps its page stack and scroll, a switch to another
// story activates it once and a switch to the same story (a mirror) not at all; "+" is a card tab on the workspace's
// card; × hands over to the right neighbour first and never takes the last tab; eight at most; a deleted story's tab
// stays as its card's page; the device's list comes back without the stories the listing does not name; unread marks
// a story whose turn landed elsewhere, until a tab of it is activated.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { browse, onDelete, open, openStory, pick, showCard } from "../src/pages.ts"
import { createReading, reading } from "../src/reading.ts"
import {
  activeOf,
  card,
  type CardView,
  focus,
  log,
  page,
  registry,
  stories,
  type StoryRow,
  tabs,
} from "../src/store.ts"
import { add, CAP, remove, restore, scroll, select, unread } from "../src/tabs.ts"

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
    fetchCards: async () => {},
    fetchCardOf: async (id) => registry.set(card, { id } as CardView),
    attach: () => {},
    abandon: () => {},
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
registry.set(stories, { current: null, stories: rows })

// A in the first tab, a page over it, scrolled
await openStory(1)
const A = tab().id
open("timeline")
top = 120
// "+": a card tab on the workspace's card, nothing activated
await add()
assert.deepEqual([tab().story, tab().card, registry.get(page), opened], [null, "a", "card", [1]])
// B browsed in the new tab: the active tab is on it
await browse("b")
const B = tab().id
assert.deepEqual([tab().story, registry.get(focus), registry.get(card)?.id, opened], [2, "b", "b", [1, 2]])
top = 40
// back to A's tab: its stack and scroll, A activated once
pick(A)
await select(A) // the switch pick started, done
assert.deepEqual([registry.get(page), registry.get(focus), registry.get(card)?.id], ["timeline", "a", "a"])
assert.deepEqual([opened, restored], [[1, 2, 1], [120]])
// the active tab clicked on a page over its story: the reader
pick(A)
assert.equal(registry.get(page), "reader")
pick(A) // in the reader: nothing
assert.equal(registry.get(page), "reader")
// another card's page browsed from A's tab (no story then): the tab clicked takes A back, as Escape does
await showCard("b")
assert.deepEqual([tab().story, registry.get(page)], [null, "card"])
pick(A)
assert.deepEqual([tab().story, tab().card, registry.get(page)], [1, "a", "reader"])

// a mirror: another tab on A, then between the two: no activation
await add()
await openStory(1)
const M = tab().id
await select(A)
await select(M)
assert.deepEqual([tab().story, opened], [1, [1, 2, 1]])
// back to B and to the mirror: one activation each way
await select(B)
await select(M)
assert.deepEqual(opened, [1, 2, 1, 2, 1])

// ×: the active one hands over to its right neighbour first, the left at the end; one not active goes alone
assert.deepEqual(ids(), [A, B, M])
await select(B)
await remove(B)
assert.deepEqual([ids(), tab().id], [[A, M], M])
await remove(M)
assert.deepEqual([ids(), tab().id], [[A], A])
await add()
const N = tab().id
await remove(A)
assert.deepEqual([ids(), tab().id], [[N], N])
await remove(N) // the last tab stays
assert.deepEqual(ids(), [N])

// eight at most: a "+" on a full strip drops the oldest tab but the active one
await select(N)
for (let i = 1; i < CAP; i++) await add()
await select(N)
await add()
assert.equal(ids().length, CAP)
assert.ok(ids().includes(N) && tab().story === null) // N was the oldest, but active when "+" was pressed
// put a tab on story 2 and leave it
await browse("b")
const D = tab().id
await select(N)
// story 2, open in the slots under a card tab, deleted: its tab stays as its card page, the active tab lands on 1
await onDelete({ current: 1, stories: [row(1, "a"), row(3, "a")] }, [2])
const d = registry.get(tabs).list.find((t) => t.id === D)!
assert.deepEqual([d.story, d.card, d.page, tab().story], [null, "b", "card", 1])

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
  back.list.map((t) => [t.story, t.card, t.page]),
  [
    [1, "a", "reader"],
    [null, "b", "card"],
  ],
)
assert.equal(back.active, back.list[1]!.id)
assert.equal(restore("not json", lib, []), null)
assert.equal(restore(JSON.stringify({ tabs: [{ story: 9 }] }), lib, []), null)

// unread: story 3 runs and lands while the active tab is on 1; then a tab of 3 activated clears it
rows = [row(1, "a"), { ...row(3, "a"), busy: "narrate" }]
registry.set(stories, { current: 1, stories: rows })
assert.equal(registry.get(unread).size, 0)
rows = [{ ...row(1, "a"), busy: "narrate" }, row(3, "a")]
registry.set(stories, { current: 1, stories: rows })
assert.deepEqual([...registry.get(unread)], [3])
rows = [row(1, "a"), row(3, "a")]
registry.set(stories, { current: 1, stories: rows })
assert.deepEqual([...registry.get(unread)], [3]) // 1 landed under the active tab: read
await openStory(3)
assert.equal(registry.get(unread).size, 0)
console.log("tabs ok")
