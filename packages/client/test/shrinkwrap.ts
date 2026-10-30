// shrinkwrap.ts `tight`: the tightest width that keeps the line count the column gave, over a monospace model (every
// character 10px, a break allowed anywhere, as CJK breaks).
import assert from "node:assert/strict"
import { type Stats, tight } from "../src/shrinkwrap.ts"

const mono =
  (chars: number) =>
  (width: number): Stats => {
    const per = Math.max(1, Math.floor(width / 10))
    return { lineCount: Math.ceil(chars / per), maxLineWidth: Math.min(chars, per) * 10 }
  }
let probes = 0
const counted = (chars: number) => {
  const m = mono(chars)
  return (w: number) => (probes++, m(w))
}

// 24 characters in a 225px column: 22 on the first row and 2 on the second. Still two rows, now 12 and 12: the
// widest row is 120px, plus the pixel of slack
assert.equal(tight(mono(24), 225), 121)
// one line is its own width, with the slack
assert.equal(tight(mono(5), 300), 51)
// the column already the tightest: never wider than it
assert.equal(tight(mono(30), 100), 100)
// a fractional column is floored before anything is measured
assert.equal(tight(mono(30), 100.7), 100)
// nothing to fit in
assert.equal(tight(mono(3), 0), 0)
// a bisection, not a scan: a 700px column takes about ten probes
probes = 0
assert.equal(tight(counted(90), 700), 451) // 90 characters: 70 + 20 at the column's width, 45 + 45 wrapped tight
assert.ok(probes < 16, `probes: ${probes}`)
probes = 0
tight(counted(400), 700)
assert.ok(probes < 16, `probes: ${probes}`)
console.log("shrinkwrap ok")
