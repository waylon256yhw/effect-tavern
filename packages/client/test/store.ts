import { emptyDraft } from "../src/composition.ts"
import { timelineNode as node } from "./fixtures.ts"
// The reducer on a scripted event sequence: path follows head, a draft grows by frames and starts over on the rewrite,
// a change event lands it and moves head.
import * as L from "@effect-tavern/runtime/src/log.ts"
import { captureArtifact, expectNoDiagnostics } from "@solidjs/diagnostics"
import assert from "node:assert/strict"
import { apply, draft, log, path, registry, stage, working, composition, error } from "../src/store.ts"

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
registry.set(log, L.of({ nodes: [node(0, null, "root"), node(1, 0, "a"), node(2, 0, "b")], head: 2 }))
assert.deepEqual(
  registry.get(path).map((n) => n.id),
  [0, 2],
) // the line runs to head
apply({ kind: "change", head: 1 }) // a checkout's reply
assert.deepEqual(
  registry.get(path).map((n) => n.id),
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
// a narrate block grows under its id, never in the prose
apply({ kind: "delta", part: { type: "product-delta", id: "inner", text: "想" } })
apply({ kind: "delta", part: { type: "product-delta", id: "inner", text: "说" } })
assert.deepEqual([registry.get(draft)!.text, registry.get(draft)!.products], ["hello", { inner: "想说" }])
apply({ kind: "stage", phase: "check" })
apply({ kind: "stage", phase: "narrate" }) // the rewrite
assert.deepEqual([registry.get(draft)!.text, registry.get(draft)!.products], ["", undefined])
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "again" } })
apply({ kind: "change", node: node(3, 1, "again"), head: 3 })
assert.notEqual(registry.get(draft), null) // the node waits behind the queued graphemes
n = 0
while (registry.get(draft) !== null && n++ < 120) tick()
assert.equal(registry.get(draft), null)
assert.equal(registry.get(log).nodes.size, 4)
assert.deepEqual(
  registry.get(path).map((n) => n.id),
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
apply({ kind: "change", node: node(4, 3, "second"), head: 4 })
n = 0
while (registry.get(draft) && registry.get(draft)!.prev !== "slow words" && n++ < 200) tick()
assert.deepEqual([registry.get(draft)!.prev, registry.get(stage)], ["slow words", "narrate"])
while (registry.get(draft) !== null && n++ < 400) tick()
assert.deepEqual([registry.get(draft), registry.get(log).head], [null, 4])
console.log("ok")

const { artifact } = await captureArtifact(
  () => {
    registry.set(draft, { parent: null, input: { text: "saved input" }, text: "saved prose", fresh: true })
    registry.set(composition, emptyDraft())
    const pending = node(99, null, "saved prose")
    pending.settlementStatus = "pending"
    apply({ kind: "change", node: pending, head: 99 })
    while (frames.length) tick()
    assert.equal(registry.get(draft), null)
    assert.equal(registry.get(working), true)
    assert.equal(registry.get(stage), "record")
    apply({ kind: "change", node: { ...pending, settlementStatus: "failed" }, head: 99 })
    apply({ kind: "error", message: "record failed" })
    assert.equal(registry.get(working), false)
    assert.equal(registry.get(composition).text, "") // persisted prose never returns its input to the composer
    assert.equal(registry.get(log).nodes.get(99)!.settlementStatus, "failed")
    assert.deepEqual(registry.get(error), { message: "record failed", phase: "record" })
  },
  { scenario: "saved-prose-settlement-failure" },
)
expectNoDiagnostics(artifact)

// An ancestor correction replaces descendant presentation projections for every attached client.
const updated = { ...node(100, 99, "child"), heading: "new heading" }
apply({ kind: "change", node: node(100, 99, "child"), head: 100 })
apply({ kind: "change", node: node(99, null, "parent"), updated: [updated], head: 100 })
assert.equal(registry.get(log).nodes.get(100)?.heading, "new heading")

// Record finishes while the prose is still playing out (a backgrounded tab): the commit waits behind the node, not dropped.
registry.set(draft, { parent: 100, input: { text: "late" }, text: "", fresh: true })
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "a long tail of prose" } })
const late = { ...node(101, 100, "a long tail of prose"), settlementStatus: "pending" as const }
apply({ kind: "change", node: late, head: 101 })
apply({ kind: "stage", phase: "record" })
apply({ kind: "change", node: { ...late, settlementStatus: "committed" }, head: 101 })
n = 0
while (frames.length && n++ < 400) tick()
assert.equal(registry.get(log).nodes.get(101)!.settlementStatus, "committed")
assert.equal(registry.get(working), false)
console.log("ok")
