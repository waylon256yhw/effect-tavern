// fold.ts: the sidebar's width under the hand (the band, the detent, the fold, the spring, the unfold) and what the
// device remembers of it.
import assert from "node:assert/strict"
import { drag, layerOf, remembered, SIDE } from "../src/fold.ts"

// docked: the band follows the hand, rounded on release
assert.deepEqual(drag(250, false), { kind: "width", shown: 250, keep: 250 })
assert.deepEqual(drag(200.4, false), { kind: "width", shown: 200.4, keep: 200 })
// under the floor the track compresses with friction and the release remembers the floor
const d = drag(150, false)
assert.equal(d.kind, "width")
if (d.kind === "width") {
  assert.ok(d.shown < SIDE.min && d.shown > 150, `detent compresses: ${d.shown}`)
  assert.equal(d.keep, SIDE.min)
}
// a pull past the close threshold folds it
assert.deepEqual(drag(SIDE.close - 1, false), { kind: "close" })
assert.notEqual(drag(SIDE.close, false).kind, "close")
// past the ceiling it gives a little, never more than its spring, and remembers the ceiling
const g = drag(400, false)
assert.equal(g.kind, "width")
if (g.kind === "width") {
  assert.ok(g.shown > SIDE.max && g.shown <= SIDE.max + 14, `spring: ${g.shown}`)
  assert.equal(g.keep, SIDE.max)
}
// folded: nothing until the unfold threshold, then docked at the default or wider, never past the ceiling
assert.deepEqual(drag(100, true), { kind: "none" })
assert.deepEqual(drag(SIDE.open, true), { kind: "open", width: SIDE.default })
assert.deepEqual(drag(300, true), { kind: "open", width: 300 })
assert.deepEqual(drag(900, true), { kind: "open", width: SIDE.max })

// the device's memory: inside the band it holds, anything else is the default
assert.equal(remembered("280"), 280)
assert.equal(remembered(280.6), 281)
assert.equal(remembered("199"), SIDE.default)
assert.equal(remembered("abc"), SIDE.default)
assert.equal(remembered(null), SIDE.default)

// the layer on arrival
assert.equal(layerOf(7), "workspace")
assert.equal(layerOf(null), "shelf")
assert.equal(layerOf(undefined), "shelf")
console.log("fold ok")
