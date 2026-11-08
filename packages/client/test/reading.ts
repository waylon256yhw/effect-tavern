import { composition, updateComposition } from "../src/store.ts"
import { emptyDraft } from "../src/composition.ts"
import { token } from "./fixtures.ts"
// The Reading (src/reading.ts) on a faked wire: a story left keeps its boxes and invoke in a record and gets them back,
// while its log is read again every time (open, nodes, attach); the same story again asks nothing; a ninth record
// drops the oldest; a deactivate with nothing in the slots is harmless; no story names none: slots and log empty, `current` null.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { createReading } from "../src/reading.ts"
import { card, type CardView, log, registry, stories } from "../src/store.ts"

const opened: number[] = []
let nodes = 0
const seen: string[] = []
let attached = 0
let abandoned = 0
const reading = createReading({
  openStory: async (id) => (opened.push(id), { current: id, stories: [] }),
  fetchNodes: async () => {
    nodes++
    seen.push(registry.get(composition).text) // what the composer holds while the story is read
    registry.set(log, L.of({ nodes: [], head: null }))
  },
  fetchCard: async () => registry.set(card, { id: "c", greetings: [] } as unknown as CardView),
  attach: () => void attached++,
  abandon: () => void abandoned++,
})
const line = (text: string) => ({ ...emptyDraft(), text })

reading.deactivate() // nothing in the slots: harmless
await reading.activate(1)
assert.equal(registry.get(stories)?.current, 1)
updateComposition({ text: "半句", note: "旁注", noteOpen: true })
updateComposition({ invocations: ["clue"].map(token) })
await reading.activate(2)
assert.deepEqual(
  [registry.get(composition), registry.get(composition).invocations.map((i) => i.resourceId)],
  [line(""), []],
) // B starts empty: A's line does not leak
await reading.activate(1)
assert.deepEqual(
  [registry.get(composition), registry.get(composition).invocations.map((i) => i.resourceId)],
  [{ text: "半句", note: "旁注", noteOpen: true, invocations: [token("clue")] }, ["clue"]],
)
assert.deepEqual([nodes, attached, opened.filter((id) => id === 1).length], [3, 3, 2])
assert.equal(registry.get(stories)?.current, 1)

// the same story again: no request, nothing touched
await reading.activate(1)
assert.deepEqual([nodes, attached, opened.length], [3, 3, 3])

// eight records at most: 1..8 left with a line each, then 9 leaves too and 1's is the one dropped
for (let id = 2; id <= 9; id++) {
  await reading.activate(id)
  updateComposition(line(`l${id}`))
}
await reading.activate(1) // 9 recorded: nine records, 1 the oldest
assert.deepEqual(registry.get(composition), line(""))
await reading.activate(9)
assert.deepEqual(registry.get(composition), line("l9"))

// a fast switch: on 21 with 20's line recorded, activate 20, then 22 before 20's reads are back, then 20: each waits
// for the one before, 20's line is never recorded over with the emptied boxes, and 22's read never sees it
await reading.activate(20)
updateComposition(line("mine"))
await reading.activate(21)
let [n, a] = [nodes, attached]
await Promise.all([reading.activate(20), reading.activate(22), reading.activate(20)])
assert.deepEqual(
  [registry.get(composition), seen.slice(-3), nodes - n, attached - a],
  [line("mine"), ["mine", "", "mine"], 3, 3],
)

// a deleted story: no record, and its id named again (a pre-autoincrement library) is read afresh
updateComposition(line("dead"))
;[n, a] = [nodes, abandoned]
reading.drop([20])
await reading.activate(20)
assert.deepEqual([registry.get(composition), nodes - n, abandoned - a], [line(""), 1, 1]) // a record of 20 would have put "dead" back

// no story (a card tab, an empty library): a line typed is recorded, the slots and the log are empty, the listing
// names no story, no story route asked, nothing attached; the card is the caller's
updateComposition(line("left"))
const before = [opened.length, attached]
await reading.activate(null)
assert.deepEqual(
  [registry.get(composition), registry.get(log).nodes.size, registry.get(stories)?.current, opened.length, attached],
  [line(""), 0, null, ...before],
)
assert.ok(abandoned > 0)
await reading.activate(20)
assert.deepEqual(registry.get(composition), line("left"))

// Ownership starts before loading succeeds: retries and leaving a failed load keep edits made while loading.
for (const failure of ["open", "nodes", "card"] as const) {
  let fail = true
  let opens = 0
  let attaches = 0
  const r = createReading({
    openStory: async (id) => {
      opens++
      if (fail && failure === "open") throw new Error("offline")
      return { current: id, stories: [] }
    },
    fetchNodes: async () => {
      if (fail && failure === "nodes") throw new Error("offline")
    },
    fetchCard: async () => {
      if (fail && failure === "card") throw new Error("offline")
    },
    attach: () => void attaches++,
    abandon: () => {},
  })
  await assert.rejects(r.activate(100), /offline/)
  updateComposition(line("typed after failure"))
  updateComposition({ invocations: ["kept"].map(token) })
  fail = false
  await r.activate(100)
  assert.deepEqual(
    [opens, attaches, registry.get(composition).text, registry.get(composition).invocations.map((i) => i.resourceId)],
    [2, 1, "typed after failure", ["kept"]],
  )
  await r.activate(100)
  assert.equal(opens, 2)
  fail = true
  await assert.rejects(r.activate(101), /offline/)
  updateComposition(line("belongs to 101"))
  fail = false
  await r.activate(102)
  await r.activate(101)
  assert.equal(registry.get(composition).text, "belongs to 101")
  r.deactivate()
}
// A failed read cannot release the queue while the other read is still in flight.
let release!: () => void
let entered!: () => void
const started = new Promise<void>((resolve) => {
  entered = resolve
})
let first = true
const order: string[] = []
const partial = createReading({
  openStory: async (id) => {
    order.push(`open ${id}`)
    return { current: id, stories: [] }
  },
  fetchNodes: async () => {
    if (first) throw new Error("offline")
  },
  fetchCard: async () => {
    if (first) {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      order.push("old card finished")
    }
  },
  attach: () => {},
  abandon: () => {},
})
const failed = assert.rejects(partial.activate(201), /offline/)
await started
const next = partial.activate(202)
await Promise.resolve()
assert.deepEqual(order, ["open 201"])
first = false
release()
await Promise.all([failed, next])
assert.deepEqual(order, ["open 201", "old card finished", "open 202"])
console.log("reading ok")
