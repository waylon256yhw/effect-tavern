// The Reading (src/reading.ts) on a faked wire: a story left keeps its boxes and pin in a record and gets them back,
// while its log is read again every time (open, nodes, attach); the same story again asks nothing; a ninth record
// drops the oldest; a deactivate with nothing in the slots is harmless; no story at all is the first card's page.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { createReading } from "../src/reading.ts"
import { boxes, card, cards, type CardView, log, pin, registry, setBoxes, stories } from "../src/store.ts"

const opened: number[] = []
let nodes = 0
const seen: string[] = []
let attached = 0
let abandoned = 0
const reading = createReading({
  openStory: async (id) => (opened.push(id), { current: id, stories: [] }),
  fetchNodes: async () => {
    nodes++
    seen.push(boxes().text) // what the composer holds while the story is read
    registry.set(log, L.of({ nodes: [], head: null }))
  },
  fetchCard: async () => registry.set(card, { id: "c", greetings: [] } as unknown as CardView),
  fetchCards: async () => registry.set(cards, [{ id: "first" }] as any),
  fetchCardOf: async (id) => registry.set(card, { id, greetings: [] } as unknown as CardView),
  attach: () => void attached++,
  abandon: () => void abandoned++,
})
const line = (text: string) => ({ text, note: "", aside: false })

reading.deactivate() // nothing in the slots: harmless
await reading.activate(1)
assert.equal(registry.get(stories)?.current, 1)
setBoxes({ text: "半句", note: "旁注", aside: true })
registry.set(pin, "clue")
await reading.activate(2)
assert.deepEqual([boxes(), registry.get(pin)], [line(""), null]) // B starts empty: A's line does not leak
await reading.activate(1)
assert.deepEqual([boxes(), registry.get(pin)], [{ text: "半句", note: "旁注", aside: true }, "clue"])
assert.deepEqual([nodes, attached, opened.filter((id) => id === 1).length], [3, 3, 2])
assert.equal(registry.get(stories)?.current, 1)

// the same story again: no request, nothing touched
await reading.activate(1)
assert.deepEqual([nodes, attached, opened.length], [3, 3, 3])

// eight records at most: 1..8 left with a line each, then 9 leaves too and 1's is the one dropped
for (let id = 2; id <= 9; id++) {
  await reading.activate(id)
  setBoxes(line(`l${id}`))
}
await reading.activate(1) // 9 recorded: nine records, 1 the oldest
assert.deepEqual(boxes(), line(""))
await reading.activate(9)
assert.deepEqual(boxes(), line("l9"))

// a fast switch: on 21 with 20's line recorded, activate 20, then 22 before 20's reads are back, then 20: each waits
// for the one before, 20's line is never recorded over with the emptied boxes, and 22's read never sees it
await reading.activate(20)
setBoxes(line("mine"))
await reading.activate(21)
let [n, a] = [nodes, attached]
await Promise.all([reading.activate(20), reading.activate(22), reading.activate(20)])
assert.deepEqual([boxes(), seen.slice(-3), nodes - n, attached - a], [line("mine"), ["mine", "", "mine"], 3, 3])

// a deleted story: no record, and its id named again (a pre-autoincrement library) is read afresh
setBoxes(line("dead"))
;[n, a] = [nodes, abandoned]
reading.drop([20])
await reading.activate(20)
assert.deepEqual([boxes(), nodes - n, abandoned - a], [line(""), 1, 1]) // a record of 20 would have put "dead" back

// no story at all: the first card's page over an empty log, no story route asked, nothing attached
const before = [opened.length, attached]
await reading.activate(null)
assert.deepEqual(
  [registry.get(card)?.id, registry.get(log).nodes.size, opened.length, attached],
  ["first", 0, ...before],
)
assert.ok(abandoned > 0)
console.log("reading ok")
