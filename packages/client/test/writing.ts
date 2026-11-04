// The Writing page's and pack workbench's pure parts: the switch table against the sentences it compiles to, the
// lexicon file format, and the prose requirements and proper-noun holes over `Layer` and `Local`.
import { harness, type Layer, type Local } from "@effect-tavern/runtime/src/layer.ts"
import assert from "node:assert/strict"
import { caretOf, defaultsOf, draftOfFormat, draftOfSnippet, emptyDraft, formatOf, snippetOf } from "../src/inserts.ts"
import { mergeLexicon, parseLexicon, serializeLexicon } from "../src/lexicon.ts"
import {
  cardNameKeys,
  fillKnown,
  orderedPacks,
  packHoles,
  productEdit,
  toggleMount,
  withoutProductPatch,
  withoutProductText,
  withPackName,
  withProductPatch,
} from "../src/pack.ts"
import {
  addFragment,
  atOf,
  extraOf,
  removeFragment,
  setFragmentAt,
  setFragmentText,
  withExtra,
} from "../src/requirements.ts"
import { chosen, moot, pressing, sentence, SWITCHES, takenBy } from "../src/switches.ts"

// every value the table offers compiles to a sentence in `harness`, and only those values do
for (const s of SWITCHES)
  for (const [v] of s.values) assert.ok(sentence(s.key, v), `${s.key}=${String(v)} has a sentence`)
assert.equal(sentence("pov", "first"), "")
assert.equal(sentence("pov", "second"), harness("act").asks?.find((a) => a.id === "switch.pov.second")?.text)
assert.equal(sentence("pov", "second", { "switch.pov.second": "自定义第二人称" }), "自定义第二人称")

// takenBy: null when compiled, `From` when taken over by free text
assert.equal(
  takenBy("pov", {
    frame: [{ id: "pov", text: "x", from: "harness", compiled: true }],
    tail: [],
    switches: { taken: { pov: "harness", verbosity: null } },
  }),
  null,
)
assert.equal(
  takenBy("pov", {
    frame: [{ id: "pov", from: "card" }],
    tail: [],
    switches: { taken: { pov: "card", verbosity: null } },
  }),
  "card",
)
assert.equal(
  takenBy("echo", {
    frame: [{ id: "pov", text: "free", from: "pack-1" }],
    tail: [],
    switches: { taken: { pov: "pack-1", verbosity: null } },
  }),
  "pack-1",
)

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

// the per-card supplement: one tail fragment under `extra` in `local.fragments`; cleared, it leaves
const l0: Local = { id: "local", name: "local", card: "wuxia", fragments: [{ id: "style", text: "S" }] }
const l1 = withExtra(l0, "  多写风物  ")
assert.deepEqual(l1.fragments, [
  { id: "style", text: "S" },
  { id: "extra", at: "tail", mode: "both", text: "多写风物" },
])
assert.equal(extraOf(l1), "多写风物")
assert.equal(extraOf(undefined), "")
assert.deepEqual(withExtra(l1, "改").fragments!.at(-1), {
  id: "extra",
  at: "tail",
  mode: "both",
  text: "改",
})
assert.deepEqual(withExtra(l1, " ").fragments, [{ id: "style", text: "S" }])
const bareLocal: Local = { id: "local", name: "local", card: "yandao" }
assert.equal(withExtra(withExtra(bareLocal, "x"), "").fragments, undefined)

// fragment list helpers on a Layer: new ones go first, text edits keep the fragment's other keys, a cleared text removes it
const g0: Layer = {
  id: "harness",
  name: "内置",
  fragments: [{ id: "language", text: "L", mode: "override" }],
}
const g1 = addFragment(g0, "req-1", " 白描 ", "tail")
assert.deepEqual(g1.fragments![0], { id: "req-1", at: "tail", text: "白描" })
assert.equal(addFragment(g0, "req-2", "  ", "tail"), g0)
assert.deepEqual(setFragmentText(g1, 1, " L2 ").fragments![1], {
  id: "language",
  text: "L2",
  mode: "override",
})
assert.deepEqual(setFragmentText(g1, 0, "").fragments, g0.fragments)
assert.deepEqual(setFragmentAt(g1, 0, "head").fragments![0], { id: "req-1", text: "白描" })
assert.equal(setFragmentAt(g1, 1, "tail").fragments![1]!.at, "tail")
assert.deepEqual([atOf(g1.fragments![0]!), atOf(g1.fragments![1]!)], ["tail", "head"])
assert.deepEqual(removeFragment(g1, 0).fragments, g0.fragments)

// the quick inputs: a key or a snippet round-trips through the editor's draft
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

// packs, product patches, and proper-noun holes
assert.equal(
  fillKnown("推进到{{char}}与{{user}}在{{char_place}}重逢", { char: "谢危", user: "姜雪宁" }),
  "推进到谢危与姜雪宁在{{char_place}}重逢",
)
const samplePack: Layer = {
  id: "wuxia-pack",
  name: "古风江湖",
  fragments: [{ id: "f1", text: "多写{{char_place}}风物" }],
  entries: [{ id: "竹叶青", text: "烈酒" }],
  lexicon: [{ pattern: "眸子", hint: "眼睛" }],
  products: [{ id: "reading", label: "阅读体", text: "{{char}}与{{user}}观影", on: false }],
  snippets: [{ name: "重逢", text: "{{char1}}见{{char2}}" }],
  names: { extra_key: "默认" },
}
assert.deepEqual(packHoles(samplePack), ["char_place", "char", "char1", "char2", "extra_key"])
const pNamed = withPackName(samplePack, "char_place", " 临安 ")
assert.deepEqual(pNamed.names, { extra_key: "默认", char_place: "临安" })
assert.deepEqual(withPackName(withPackName(pNamed, "char_place", ""), "extra_key", "").names, undefined)

assert.deepEqual(cardNameKeys(["char", "user", "char2"], { user: "玩家", char: "伴星", char_place: "新艾利都" }), [
  "char",
  "char2",
  "char_place",
])

const pkHarness: Layer = { id: "harness", name: "内置" }
const pkA: Layer = { id: "a", name: "A" }
const pkB: Layer = { id: "b", name: "B" }
const pkC: Layer = { id: "c", name: "C" }
assert.deepEqual(
  orderedPacks([pkHarness, pkA, pkB, pkC], ["c", "a"]).map((p) => p.id),
  ["c", "a", "b"],
)
const mounted1 = toggleMount(bareLocal, "b")
assert.deepEqual(mounted1.mounts, ["b"])
assert.equal(toggleMount(mounted1, "b").mounts, undefined)

const ths = withProductPatch([{ id: "inner", on: true }], {
  id: "inner",
  label: "人物心声",
  text: "写{{char}}心声",
  on: true,
})
assert.deepEqual(ths, [{ id: "inner", label: "人物心声", text: "写{{char}}心声", on: true }])
assert.deepEqual(withoutProductPatch(ths, "inner"), [])
// 恢复默认 keeps the toggle; a patch left with only its id goes
assert.deepEqual(withoutProductText(ths, "inner"), [{ id: "inner", on: true }])
assert.deepEqual(withoutProductText([{ id: "inner", label: "x" }], "inner"), [])
// the dialog's save: only what changed; a label alone is a patch; a card item shows no text, so typed text goes; a new
// 小剧场 needs text and starts off
const shownInner = { id: "inner", label: "人物心声", text: "What the character thought" }
assert.deepEqual(productEdit(shownInner, "inner", " 心声 ", "What the character thought"), {
  id: "inner",
  label: "心声",
})
assert.equal(productEdit(shownInner, "inner", "人物心声", ""), undefined)
assert.deepEqual(productEdit({ id: "mood" }, "mood", "mood", "写心情"), { id: "mood", text: "写心情" })
assert.equal(productEdit(undefined, "th-1", "新", ""), undefined)
assert.deepEqual(productEdit(undefined, "th-1", "", "写"), { id: "th-1", text: "写", on: false })

console.log("writing ok")
