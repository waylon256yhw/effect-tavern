// The Writing page's pure parts: the switch table against the sentences it compiles to, the lexicon file format, and
// the prose requirements over the player layer.
import { frame, type Player, writing } from "@effect-tavern/runtime/src/fragment.ts"
import assert from "node:assert/strict"
import { caretOf, defaultsOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf } from "../src/inserts.ts"
import { mergeLexicon, parseLexicon, serializeLexicon } from "../src/lexicon.ts"
import {
  cardNameKeys,
  fillKnown,
  orderedPacks,
  packCount,
  packHoles,
  toggleMount,
  withCardName,
  withoutTheater,
  withPackName,
  withTheater,
} from "../src/pack.ts"
import { addGlobal, atOf, extraOf, removeGlobal, setGlobalAt, setGlobalText, withExtra } from "../src/requirements.ts"
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
assert.deepEqual(chosen({ polish: false }, true), ["跟随卡片", "本卡补充"])
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
// the per-card supplement: one tail fragment under `extra`, beside whatever else the card's list holds; cleared, it
// leaves, and an emptied card leaves the map
const p0: Player = { global: [], forCard: { wuxia: [{ id: "style", text: "S" }] } }
const p1 = withExtra(p0, "wuxia", "  多写风物  ")
assert.deepEqual(p1.forCard, {
  wuxia: [
    { id: "style", text: "S" },
    { id: "extra", at: "tail", mode: "both", text: "多写风物" },
  ],
})
assert.equal(extraOf(p1, "wuxia"), "多写风物")
assert.equal(extraOf(p1, "yandao"), "")
assert.deepEqual(withExtra(p1, "wuxia", "改").forCard.wuxia!.at(-1), {
  id: "extra",
  at: "tail",
  mode: "both",
  text: "改",
})
assert.deepEqual(withExtra(p1, "wuxia", " ").forCard, { wuxia: [{ id: "style", text: "S" }] })
assert.deepEqual(withExtra(withExtra(p0, "yandao", "x"), "yandao", "").forCard, p0.forCard)
// in the head it lands after the global layer and before the card's frame, at the tail it leaves the head
const head = frame(withExtra(p0, "wuxia", "x"), { id: "wuxia", frame: [{ id: "pov", text: "P" }] }).map((f) => f.id)
assert.deepEqual(head, ["style", "extra", "pov"])
// the global requirements: new ones go first, text edits keep the fragment's other keys, a cleared text removes it,
// the position is a key that leaves for the head
const g0: Player = {
  global: [{ id: "language", text: "L", mode: "override", when: { path: "x", is: true } }],
  forCard: {},
}
const g1 = addGlobal(g0, "req-1", " 白描 ", "tail")
assert.deepEqual(g1.global[0], { id: "req-1", at: "tail", text: "白描" })
assert.equal(addGlobal(g0, "req-2", "  ", "tail"), g0)
assert.deepEqual(setGlobalText(g1, 1, " L2 ").global[1], {
  id: "language",
  text: "L2",
  mode: "override",
  when: { path: "x", is: true },
})
assert.deepEqual(setGlobalText(g1, 0, "").global, g0.global)
assert.deepEqual(setGlobalAt(g1, 0, "head").global[0], { id: "req-1", text: "白描" })
assert.deepEqual(setGlobalAt(g1, 1, "tail").global[1]!.at, "tail")
assert.deepEqual([atOf(g1.global[0]!), atOf(g1.global[1]!)], ["tail", "head"])
assert.deepEqual(removeGlobal(g1, 0).global, g0.global)
// the quick inputs: a key or a snippet round-trips through the editor's draft; the caret between the halves keeps
// `after`, at the end drops it; a blank label falls back to the glyph; a snippet needs a name and keeps only set keys
assert.deepEqual(formatOf(draftOfFormat({ label: "「」", text: "「", after: "」" })), {
  label: "「」",
  text: "「",
  after: "」",
})
assert.deepEqual(formatOf({ ...emptyDraft(false), text: "……" }), { label: "……", text: "……" })
assert.deepEqual(formatOf({ ...emptyDraft(false), text: "「", after: "」", between: false }), {
  label: "「",
  text: "「",
})
assert.equal(formatOf(emptyDraft(false)), undefined)
assert.deepEqual(snippetOf(draftOfSnippet({ name: "心声", text: "⦅", after: "⦆", hint: "h" })), {
  name: "心声",
  text: "⦅",
  after: "⦆",
  hint: "h",
})
assert.deepEqual(snippetOf({ ...emptyDraft(true), label: " 场外 " }), { name: "场外", text: "", note: true })
assert.deepEqual(snippetOf({ ...emptyDraft(true), label: "x", text: "a", after: "b", between: false, note: false }), {
  name: "x",
  text: "a",
})
assert.equal(snippetOf(emptyDraft(true)), undefined)
assert.deepEqual(
  defaultsOf(["m1", "d1", "d2"], ["m1", "m2"], (x) => x),
  ["d1", "d2"],
)
assert.equal(caretOf({ text: "「", after: "」" }), "「」")
assert.equal(caretOf({ text: "继续。" }), "继续。")

// packs, theaters, and proper-noun holes
assert.equal(
  fillKnown("推进到{{char}}与{{user}}在{{char_place}}重逢", { char: "谢危", user: "姜雪宁" }),
  "推进到谢危与姜雪宁在{{char_place}}重逢",
)
const samplePack = {
  id: "wuxia-pack",
  name: "古风江湖",
  fragments: [{ id: "f1", text: "多写{{char_place}}风物" }],
  entries: [{ id: "竹叶青", text: "烈酒" }],
  lexicon: [{ pattern: "眸子", hint: "眼睛" }],
  theaters: [{ id: "reading", label: "阅读体", text: "{{char}}与{{user}}观影", on: false }],
  snippets: [{ name: "重逢", text: "{{char1}}见{{char2}}" }],
  names: { extra_key: "默认" },
}
assert.equal(packCount(samplePack), 5)
assert.deepEqual(packHoles(samplePack), ["char_place", "char", "char1", "char2", "extra_key"])
const pNamed = withPackName(samplePack, "char_place", " 临安 ")
assert.deepEqual(pNamed.names, { extra_key: "默认", char_place: "临安" })
assert.deepEqual(withPackName(withPackName(pNamed, "char_place", ""), "extra_key", "").names, undefined)

assert.deepEqual(cardNameKeys(["char", "user", "char2"], { user: "玩家", char: "伴星", char_place: "新艾利都" }), [
  "char",
  "char2",
  "char_place",
])
const plNamed = withCardName({ global: [], forCard: {} }, "wuxia", "char", " 燕惊寒 ")
assert.deepEqual(plNamed.names, { wuxia: { char: "燕惊寒" } })
assert.equal(withCardName(plNamed, "wuxia", "char", "").names, undefined)

const pkA = { id: "a", name: "A" }
const pkB = { id: "b", name: "B" }
const pkC = { id: "c", name: "C" }
assert.deepEqual(
  orderedPacks([pkA, pkB, pkC], ["c", "a"]).map((p) => p.id),
  ["c", "a", "b"],
)
const mounted1 = toggleMount({ global: [], forCard: {} }, "wuxia", "b")
assert.deepEqual(mounted1.packs, { wuxia: ["b"] })
assert.equal(toggleMount(mounted1, "wuxia", "b").packs, undefined)

const ths = withTheater([{ id: "inner", on: true }], {
  id: "inner",
  label: "人物心声",
  text: "写{{char}}心声",
  on: true,
})
assert.deepEqual(ths, [{ id: "inner", label: "人物心声", text: "写{{char}}心声", on: true }])
assert.deepEqual(withoutTheater(ths, "inner"), [])

console.log("writing ok")
