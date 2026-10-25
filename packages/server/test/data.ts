// The library (src/data.ts) in memory: a story's store is log.ts's Store, written change by change and read back as
// the same log, with head and next kept so a dropped id never returns; deleting a story takes its nodes with it; the
// player row round-trips its JSON.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { open } from "../src/data.ts"

interface N extends L.Noded {
  text: string
}
const data = open(":memory:")

// Store: the authority commits, a fresh holder over the same rows equals it, and the next id is the stored one.
const story = data.stories.create("wuxia")
const store = data.store<N>(story)
const h = L.hold<N>(store)
h.commit(L.add(h.log, { parent: null, text: "r" }))
h.commit(L.add(h.log, { parent: 0, text: "c" }))
h.commit(L.amend(h.log, 1, { text: "c'" }))
h.commit(L.drop(h.log, 1))
const back = L.hold<N>(data.store<N>(story))
assert.deepEqual(L.snapshot(back.log), { nodes: [{ id: 0, parent: null, text: "r" }], head: 0, next: 2 })
assert.equal(back.commit(L.add(back.log, { parent: 0, text: "d" })).node!.id, 2)
assert.throws(() => data.store<N>(99).read(), /no story 99/)

// Calls: filed under a node in order, read back by node; gone with the node, and with the story.
const trace = data.calls(story)
trace.add(0, [{ phase: "narrate" }, { phase: "record" }])
trace.add(2, [{ phase: "lookup" }])
trace.add(0, [{ phase: "record" }]) // an amend appends
assert.deepEqual(trace.list(), {
  0: [{ phase: "narrate" }, { phase: "record" }, { phase: "record" }],
  2: [{ phase: "lookup" }],
})
back.commit(L.drop(back.log, 2))
assert.deepEqual(Object.keys(trace.list()), ["0"])

// Stories list newest first per card, each with its size and head node; deleting one cascades to its nodes.
const second = data.stories.create("wuxia")
assert.deepEqual(
  data.stories.list("wuxia").map((s) => [s.id, s.turns, s.head]),
  [
    [second, 0, null],
    [story, 1, { id: 0, parent: null, text: "r" }], // node 2 dropped above: head fell back to the root
  ],
)
assert.equal(data.stories.list("other").length, 0)
data.stories.del(story)
assert.deepEqual(
  data.stories.list("wuxia").map((s) => s.id),
  [second],
)
assert.throws(() => data.store<N>(story).read(), /no story/)
assert.deepEqual(trace.list(), {})

// Personas by name; the player row: JSON in, the same out (which persona is on which card is the player's).
data.personas.put({ id: "friend", name: "旧友", text: "你是替故人送还遗物的旧友。" })
data.personas.put({ id: "monk", name: "行脚僧", text: "你是路过的行脚僧。" })
assert.deepEqual(
  data.personas.list().map((p) => [p.id, p.text]),
  [
    ["friend", "你是替故人送还遗物的旧友。"],
    ["monk", "你是路过的行脚僧。"],
  ],
) // byte order: 旧 (U+65E7) before 行 (U+884C)
data.personas.del("monk")
assert.deepEqual(
  data.personas.list().map((p) => p.id),
  ["friend"],
)
assert.equal(data.player.read(), undefined)
data.player.write({ writing: { pov: "second" }, global: [], forCard: {}, persona: { wuxia: "friend" } })
assert.deepEqual(data.player.read(), {
  writing: { pov: "second" },
  global: [],
  forCard: {},
  persona: { wuxia: "friend" },
})
data.close()
console.log("ok")
