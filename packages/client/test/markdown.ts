// The Markdown subset the reader draws: blocks cut as the paragraphs were, CJK punctuation beside a mark, the
// block in flight mended, indented lines kept as prose, HTML and images as text, and the previews' plain text.
import assert from "node:assert/strict"
import { blocks, mend, parse, plain } from "../src/markdown.ts"

const types = (block: string, open = false) => parse(open ? mend(block) : block).map((n) => n.type)
const inlines = (block: string, open = false) => {
  const [p] = parse(open ? mend(block) : block)
  assert.equal(p?.type, "paragraph")
  return (p as { children: { type: string; value?: string }[] }).children.map(
    (c) => c.type + (c.value ? `:${c.value}` : ""),
  )
}

// blocks: the reader's paragraphs (blank lines), a fence keeps its blank lines, a run of blank lines is one cut
assert.deepEqual(blocks("一\n\n二\n\n\n三\n"), ["一", "二", "三"])
assert.deepEqual(blocks("一\n二"), ["一\n二"]) // one newline is one block, shown as a line break (white-space: pre-wrap)
assert.deepEqual(blocks("前\n\n```\na\n\nb\n```\n\n后"), ["前", "```\na\n\nb\n```", "后"])
assert.deepEqual(blocks("~~~~\n```\n\nx\n~~~\n~~~~\n\n后"), ["~~~~\n```\n\nx\n~~~\n~~~~", "后"]) // closes only at its own run
assert.deepEqual(blocks("```\n未闭合\n\n仍在栅栏内"), ["```\n未闭合\n\n仍在栅栏内"])
assert.deepEqual(blocks("```foo```\n\n后"), ["```foo```", "后"]) // inline code, not a fence (no backtick in an info string)
assert.deepEqual(blocks("~~~ a~b\nx\n~~~\n\n后"), ["~~~ a~b\nx\n~~~", "后"]) // a tilde fence's info string may hold anything
assert.deepEqual(blocks("一\r\n\r\n二"), ["一", "二"])
assert.deepEqual(blocks(""), [])
assert.deepEqual(blocks("   \n\n  "), [])

// the two voices beside CJK punctuation: CommonMark alone makes none of these strong (the closing ** is not
// right-flanking after a full-width quote or ？ when a CJK character follows)
assert.deepEqual(inlines("**“您是……新来的牧师先生，对吧？”**她问"), ["strong", "text:她问"])
assert.deepEqual(inlines("**他说“别动。”**然后转身"), ["strong", "text:然后转身"])
assert.deepEqual(inlines("*嗓音比水更软。*她望向你"), ["emphasis", "text:她望向你"])
assert.deepEqual(inlines("她笑了**一下**，小小地"), ["text:她笑了", "strong", "text:，小小地"])
assert.deepEqual(inlines("***粗斜***体"), ["emphasis", "text:体"]) // emphasis holding strong, as CommonMark nests them
assert.deepEqual(inlines("~~划掉~~的"), ["delete", "text:的"])
assert.deepEqual(inlines("20~25度之间"), ["text:20~25度之间"]) // one tilde is never strikethrough

// the block in flight: an unclosed mark is closed for display, the text itself untouched; a closed block mends to
// the same string, so the memo over it holds when the block stops being the last one
assert.equal(mend("**她坐在木椅**靠背"), "**她坐在木椅**靠背")
assert.equal(mend("她说：“别"), "她说：“别")
assert.deepEqual(inlines("**她坐在木椅", true), ["strong"])
assert.deepEqual(inlines("*你还未来得及辨清", true), ["emphasis"])
assert.deepEqual(inlines("**她坐在木椅"), ["text:**她坐在木椅"]) // landed as the model left it
assert.deepEqual(inlines("她说：“别", true), ["text:她说：“别"]) // a quote is not a mark
assert.deepEqual(types("```js\nlet a = 1", true), ["code"]) // a fence open at the end is a code block already

// indented lines are prose (SillyTavern shows an indented opening as a code block); full-width indents stay
assert.deepEqual(inlines("    缩进的开场白"), ["text:缩进的开场白"])
assert.deepEqual(inlines("\t缩进的开场白"), ["text:缩进的开场白"])
assert.deepEqual(inlines("　　全角缩进"), ["text:　　全角缩进"])
assert.deepEqual(types("```\n  code\n```"), ["code"])

// the rest of the subset
assert.deepEqual(types("# 标题"), ["heading"])
assert.deepEqual(types("> 引用"), ["blockquote"])
assert.deepEqual(types("- a\n- b"), ["list"])
assert.deepEqual(types("---"), ["thematicBreak"])
assert.deepEqual(types("| a | b |\n|---|:-:|\n| 1 | 2 |"), ["table"])
const table = parse("| a | b |\n|---|:-:|\n| 1 | 2 |")[0] as { align: (string | null)[]; children: unknown[] }
assert.deepEqual([table.align, table.children.length], [[null, "center"], 2])

// raw HTML is text (an html node, drawn as its source), an image is its alt
assert.deepEqual(inlines("<b>粗</b>"), ["html:<b>", "text:粗", "html:</b>"])
assert.deepEqual(types("<div>\n块\n</div>"), ["html"])
assert.deepEqual(inlines("![一张图](http://x/i.png)"), ["image"])

// plain: the marks off, for a one-line preview; blocks, items and cells joined by a space
assert.equal(plain("**“您是……对吧？”**\n\n*嗓音比水更软*"), "“您是……对吧？” 嗓音比水更软")
assert.equal(
  plain("# 标题\n\n- a\n- b\n\n---\n\n`c` ~~d~~ [链接](https://x.y) ![图](http://i)"),
  "标题 a b c d 链接 图",
)
assert.equal(plain("| a | b |\n|---|---|\n| 1 | 2 |"), "a b 1 2")
assert.equal(plain(""), "")
console.log("markdown ok")
