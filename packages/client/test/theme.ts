// theme.ts `flipped`: the pick a flip leaves. Against the system it is stored; back to the system's own side it is
// nothing, so the page follows the system again.
import assert from "node:assert/strict"
import { flipped } from "../src/theme.ts"

assert.equal(flipped("light", "light"), "dark", "system light, flip once: dark, pinned")
assert.equal(flipped("dark", "light"), undefined, "system light, flip back: follows the system again")
assert.equal(flipped("dark", "dark"), "light", "system dark, flip once: light, pinned")
assert.equal(flipped("light", "dark"), undefined, "system dark, flip back: follows the system again")
console.log("theme: 4 flips as expected")
