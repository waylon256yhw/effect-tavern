// src/polish.ts: the sentence splitter, the wildcard, the dialogue skip, the floor, and the splice.
import assert from "node:assert/strict"
import { FLOOR, marked, scan, sentences, splice } from "../src/polish.ts"

const spans = (t: string) => sentences(t).map(([a, b]) => t.slice(a, b))
// Sentence bounds: CJK and ASCII terminators (a run counts once), the closing quote after a terminator, a line break.
// A terminator inside dialogue does not end the sentence; leading blanks are not part of one; 3.5 stays whole.
assert.deepEqual(spans("他走了。她没说话！真的吗？？"), ["他走了。", "她没说话！", "真的吗？？"])
assert.deepEqual(spans("他说：「好。我走了。」她点头。"), ["他说：「好。我走了。」", "她点头。"])
assert.deepEqual(spans("他把「江湖」二字写下。"), ["他把「江湖」二字写下。"])
assert.deepEqual(spans("雨停了\n\n  风起了。"), ["雨停了", "风起了。"])
assert.deepEqual(spans("It is 3.5 miles. Go on"), ["It is 3.5 miles.", "Go on"])

const pad = "。".padStart(FLOOR, "雨") // filler: one long sentence of no slop
const lex = [{ pattern: "指节*白", hint: "stock image" }, { pattern: "不是*而是" }]
// The wildcard: `*` is a short run, so 指节发白 and 指节攥得发白 hit and a run past the ceiling does not.
const t1 = scan(`${pad}他的指节攥得发白。指节${"长".repeat(20)}白。这不是怕，而是恨。`, lex)
assert.deepEqual(
  t1.map((t) => [t.id, t.hits, t.hints]),
  [
    ["hit-1", ["指节攥得发白"], ["stock image"]],
    ["hit-2", ["不是怕，而是"], []],
  ],
)
const text = `${pad}他的指节攥得发白。`
const [t] = scan(text, lex)
assert.equal(text.slice(t!.start, t!.end), "他的指节攥得发白。") // exact coordinates: the whole sentence
// Dialogue is skipped: a hit inside 「」 or “” is how people talk; the narration around it still counts.
assert.deepEqual(scan(`${pad}他说：「我指节都发白了。」`, lex), [])
assert.deepEqual(scan(`${pad}他说：“不是我，而是他。”`, lex), [])
assert.equal(scan(`${pad}「走。」他指节发白。`, lex).length, 1)
// 『』 on its own (心声, 传音) and ‘’ are dialogue too (#63); nested 『』 inside 「」 already was, by depth
assert.deepEqual(scan(`${pad}他想：『我指节都发白了。』`, lex), [])
assert.deepEqual(scan(`${pad}她低声道：‘不是我，而是他。’`, lex), [])
assert.deepEqual(scan(`${pad}他说：「她说过『不是我，而是他』。」`, lex), [])
assert.equal(scan(`${pad}『走。』他指节发白。`, lex).length, 1)
assert.deepEqual(spans("他想：『好。我走了。』她点头。"), ["他想：『好。我走了。』", "她点头。"])
// an apostrophe is not a closing quote: it neither ends a sentence nor hides what follows
assert.equal(scan(`${pad}He said don’t. 他指节发白。`, lex).length, 1)
// The floor: short prose is never worth a call; an empty lexicon finds nothing.
assert.deepEqual(scan("他的指节发白。", lex), [])
assert.deepEqual(scan(text, []), [])
// The marks the call reads, and the splice: an echoed sentence is a pass-through, a changed one replaces its span only.
assert.equal(marked(text, [t!]), `${pad}<target id="hit-1" hits="指节攥得发白">他的指节攥得发白。</target>`)
assert.equal(splice(text, [t!], { "hit-1": "他的指节攥得发白。" }), text)
assert.equal(splice(text, [t!], { "hit-1": "他握紧了拳。" }), `${pad}他握紧了拳。`)
assert.equal(splice(text, [t!], { "hit-1": "" }), text) // a blank answer keeps the sentence: a rewrite may not delete
assert.equal(splice(text, [t!], { "hit-1": "  \n" }), text)
console.log("polish ok")
