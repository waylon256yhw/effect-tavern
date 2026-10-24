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

// Stories list newest first per card; deleting one cascades to its nodes.
const second = data.stories.create("wuxia")
assert.deepEqual(
  data.stories.list("wuxia").map((s) => s.id),
  [second, story],
)
assert.equal(data.stories.list("other").length, 0)
data.stories.del(story)
assert.deepEqual(
  data.stories.list("wuxia").map((s) => s.id),
  [second],
)
assert.throws(() => data.store<N>(story).read(), /no story/)

// The player row: JSON in, the same out.
assert.equal(data.player.read(), undefined)
data.player.write({ writing: { pov: "second" }, global: [], forCard: {} })
assert.deepEqual(data.player.read(), { writing: { pov: "second" }, global: [], forCard: {} })
data.close()
console.log("ok")
