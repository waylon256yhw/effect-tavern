// fold.ts: the sidebar's width under the hand (the band, the resistance past it, the fold, the unfold), where a
// release lands with the hand's speed, the keys, and what the device remembers of it.
import assert from "node:assert/strict"
import { drag, release, remembered, SIDE, step } from "../src/fold.ts"

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
  assert.ok(g.shown > SIDE.max && g.shown < SIDE.max + 24, `give: ${g.shown}`)
  assert.equal(g.keep, SIDE.max)
}
// the resistance is a curve, not a wall: it starts where the band ends, keeps growing with the pull and never
// reaches its limit
const shownAt = (x: number) => {
  const r = drag(x, false)
  return r.kind === "width" ? r.shown : NaN
}
assert.ok(Math.abs(shownAt(SIDE.max + 0.01) - SIDE.max) < 0.01, "no step at the ceiling")
assert.ok(Math.abs(shownAt(SIDE.min - 0.01) - SIDE.min) < 0.01, "no step at the floor")
assert.ok(shownAt(600) > shownAt(400) && shownAt(5000) < SIDE.max + 24, "the give grows and stays under its limit")
assert.ok(shownAt(SIDE.close) < shownAt(150) && shownAt(SIDE.close) > SIDE.min - 28, "the detent the same way")

// a release: still or slow it rests; a flick toward the edge folds from anywhere in the band; a flick away never does
assert.deepEqual(release(248, 0, false), { kind: "rest" })
assert.deepEqual(release(248, -0.3, false), { kind: "rest" })
assert.deepEqual(release(248, -1.2, false), { kind: "fold" })
assert.deepEqual(release(120, -0.2, false), { kind: "fold" })
assert.deepEqual(release(120, 2, false), { kind: "rest" })
// folded (the same pull that folded it): a flick back out docks at the default, anything else stays folded
assert.deepEqual(release(40, 1, true), { kind: "dock", width: SIDE.default })
assert.deepEqual(release(40, 0.2, true), { kind: "rest" })
assert.deepEqual(release(40, -1, true), { kind: "rest" })

// the keys: a step each way inside the band, Home and End its ends, any other key nothing
assert.equal(step(248, "ArrowLeft"), 232)
assert.equal(step(248, "ArrowRight"), 264)
assert.equal(step(204, "ArrowLeft"), SIDE.min)
assert.equal(step(316, "ArrowRight"), SIDE.max)
assert.equal(step(248, "Home"), SIDE.min)
assert.equal(step(248, "End"), SIDE.max)
assert.equal(step(248, "a"), undefined)
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
console.log("fold ok")
