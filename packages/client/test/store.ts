// The reducer on a scripted event sequence: path follows the active sibling, a draft grows by frames and starts over on
// the rewrite, a node event lands it and moves the active pointer.
import assert from "node:assert/strict"
import { active, apply, draft, load, nodes, path, registry } from "../src/store.ts"

let frames: (() => void)[] = []
;(globalThis as any).requestAnimationFrame = (f: () => void) => frames.push(f)
;(globalThis as any).cancelAnimationFrame = () => void (frames = [])
const tick = () => {
  const fs = frames
  frames = []
  fs.forEach((f) => f())
}
const node = (id: number, parent: number | null, text: string) =>
  ({ turn: { id, parent, input: { text: `in${id}` }, reply: [{ type: "text", text }], end: "end" } }) as any

load([node(0, null, "root"), node(1, 0, "a"), node(2, 0, "b")])
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 2],
) // newest sibling by default
registry.update(active, (m) => new Map(m).set(0, 1))
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 1],
)

registry.set(draft, { parent: 1, input: { text: "x" }, text: "" })
apply({ kind: "stage", phase: "narrate" })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "he" } })
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "llo" } })
assert.equal(registry.get(draft)!.text, "") // nothing until the frame
tick()
assert.equal(registry.get(draft)!.text, "hello")
apply({ kind: "stage", phase: "check" })
apply({ kind: "stage", phase: "narrate" }) // the rewrite
assert.equal(registry.get(draft)!.text, "")
apply({ kind: "delta", part: { type: "text-delta", id: "0", text: "again" } })
apply({ kind: "node", node: node(3, 1, "again") })
assert.equal(registry.get(draft), null)
assert.equal(registry.get(nodes).size, 4)
assert.deepEqual(
  registry.get(path).map((n) => n.turn.id),
  [0, 1, 3],
)
tick() // a frame left over from before the node must not resurrect a draft
assert.equal(registry.get(draft), null)
console.log("ok")
