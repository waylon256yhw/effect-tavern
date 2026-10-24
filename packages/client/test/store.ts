// The reducer on a scripted event sequence: path follows head, a draft grows by frames and starts over on the rewrite,
// a change event lands it and moves head.
import * as L from "@effect-tavern/runtime/src/log.ts"
import assert from "node:assert/strict"
import { apply, calls, draft, log, path, registry, stage } from "../src/store.ts"

let frames: (() => void)[] = []
;(globalThis as any).requestAnimationFrame = (f: () => void) => frames.push(f)
;(globalThis as any).cancelAnimationFrame = () => void (frames = [])
let clock = 0
Object.defineProperty(performance, "now", { value: () => clock }) // the playout loop paces by wall time; the test owns the clock
const tick = () => {
  clock += 16
  const fs = frames
  frames = []
  fs.forEach((f) => f())
}
const node = (id: number, parent: number | null, text: string) =>
  ({ id, parent, turn: { id, parent, input: { text: `in${id}` }, reply: [{ type: "text", text }], end: "end" } }) as any

registry.set(log, L.of({ nodes: [node(0, null, "root"), node(1, 0, "a"), node(2, 0, "b")], head: 2 }))
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 2],
) // the line runs to head
apply({ kind: "change", head: 1 }) // a checkout's reply
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 1],
)

registry.set(draft, { parent: 1, input: { text: "x" }, text: "" })
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "change", head: 2 }) // a checkout while the turn streams: head moves, the draft stays
assert.deepEqual([registry.get(log).head, registry.get(draft)?.parent], [2, 1])
apply({ kind: "change", head: 1 })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "he" } })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "llo" } })
assert.equal(registry.get(draft)!.text, "") // nothing until the frame
tick()
assert.equal(registry.get(draft)!.text, "h") // the first frame reveals one grapheme, however much piled up
let n = 0
while (registry.get(draft)!.text !== "hello" && n++ < 120) tick()
assert.equal(registry.get(draft)!.text, "hello") // the rest plays out at the stream's rate, well within two seconds
apply({ kind: "stage", phase: "check" })
apply({ kind: "stage", phase: "narrate" }) // the rewrite
assert.equal(registry.get(draft)!.text, "")
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "again" } })
apply({ kind: "change", node: node(3, 1, "again"), head: 3 })
assert.notEqual(registry.get(draft), null) // the node waits behind the queued graphemes
n = 0
while (registry.get(draft) !== null && n++ < 120) tick()
assert.equal(registry.get(draft), null)
assert.equal(registry.get(log).nodes.size, 4)
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 1, 3],
)
tick() // a frame left over from before the node must not resurrect a draft
assert.equal(registry.get(draft), null)

// A stage that arrives while graphemes are still queued waits behind them (the cursor and the Record slot never
// overtake the prose); the rewrite waits too, so the whole first draft greys; the calls file under the node.
registry.set(draft, { parent: 3, input: { text: "y" }, text: "" })
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "slow words" } })
apply({ kind: "stage", phase: "check" })
tick()
assert.equal(registry.get(stage), "narrate")
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "second" } })
apply({ kind: "call", phase: "narrate", msgs: [], out: "second", usage: {}, ms: 1 } as any)
apply({ kind: "change", node: node(4, 3, "second"), head: 4 })
n = 0
while (registry.get(draft) && registry.get(draft)!.prev !== "slow words" && n++ < 200) tick()
assert.deepEqual([registry.get(draft)!.prev, registry.get(stage)], ["slow words", "narrate"])
while (registry.get(draft) !== null && n++ < 400) tick()
assert.deepEqual([registry.get(draft), registry.get(calls).get(4)?.length, registry.get(log).head], [null, 1, 4])
console.log("ok")
