// The Writing page's pure parts: the switch table against the sentences it compiles to, and the lexicon file format.
import { writing } from "@effect-tavern/runtime/src/fragment.ts"
import assert from "node:assert/strict"
import { mergeLexicon, parseLexicon, serializeLexicon } from "../src/lexicon.ts"
import { chosen, moot, pressing, sentence, SWITCHES } from "../src/switches.ts"

// every value the table offers compiles to a sentence, and only those values do
for (const s of SWITCHES)
  for (const [v] of s.values) assert.ok(sentence(s.key, v), `${s.key}=${String(v)} has a sentence`)
assert.equal(sentence("pov", "first"), "")
assert.equal(writing({ pov: "second" })[0]!.text, sentence("pov", "second"))

// the chips: what is set, by name; nothing set reads 跟随卡片; echo and agency are moot with no player in the fiction
assert.deepEqual(chosen(undefined), ["跟随卡片"])
assert.deepEqual(chosen({ pov: "third", echo: false, verbosity: "concise" }), ["第三人称", "直接反应", "简短"])
assert.deepEqual(chosen({ pov: "none", echo: true, agency: "free" }), ["无主角"])
assert.deepEqual(chosen({ polish: false }, true), ["跟随卡片", "含本卡补充"])
assert.ok(moot("echo", { pov: "none" }) && !moot("echo", { pov: "third" }) && !moot("pov", { pov: "none" }))
// a press on the set value unsets it, on another sets it
assert.equal(pressing("pov", { pov: "second" }, "second"), undefined)
assert.equal(pressing("pov", { pov: "second" }, "third"), "third")
assert.equal(pressing("echo", {}, false), false)

// the file: an array or an object with `lexicon`; junk rows dropped, duplicates kept once, hints only when strings
const good = parseLexicon(
  `[{"pattern":"指节*白","hint":"套路"},{"pattern":"不是*而是"},{"pattern":"指节*白","hint":"again"}]`,
)
assert.deepEqual(good, { entries: [{ pattern: "指节*白", hint: "套路" }, { pattern: "不是*而是" }] })
assert.deepEqual(parseLexicon(`{"lexicon":[{"pattern":"a","hint":3},{"hint":"x"},null,"s",{"pattern":" "}]}`), {
  entries: [{ pattern: "a" }],
})
assert.ok("error" in parseLexicon("nope"))
assert.ok("error" in parseLexicon(`{"writing":{}}`))
assert.deepEqual(parseLexicon(serializeLexicon([{ pattern: "a", hint: "b" }])), {
  entries: [{ pattern: "a", hint: "b" }],
})
assert.deepEqual(mergeLexicon([{ pattern: "a", hint: "mine" }], [{ pattern: "a", hint: "theirs" }, { pattern: "b" }]), [
  { pattern: "a", hint: "mine" },
  { pattern: "b" },
])
console.log("writing ok")
