// The prose as Markdown, one block at a time. The narrator (and a card's opening) writes the GFM subset the
// AI-RP ecosystem writes: `**` and `*` for the two voices (which is which is the card's convention, not ours),
// headings, lists, quotes, tables, fences, `---` for a scene cut. A turn is split into blocks at blank lines, as
// the reader has always been, so a finished block parses once and only the block being written re-parses per frame
// (streamdown's split; a fence keeps its blank lines). Three deviations from CommonMark, each a defect in a story:
// indented code is off (a line indented by spaces or a tab is a paragraph; SillyTavern renders such an opening as a
// code block), raw HTML is text (prose is the narrator's channel and is read back to the model; a status bar in HTML
// belongs to products, never here), and an image is its alt text (a model's URL is a tracker). The block in flight
// is mended first (remend, streamdown's): an unclosed `**` is closed on the display tree, never in the text.
import type { Nodes, PhrasingContent, Root, RootContent } from "mdast"
import remarkCjkFriendly from "remark-cjk-friendly" // CommonMark's flanking rules fail beside CJK punctuation (**“对吧？”**她): fixed
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remend from "remend"
import { unified } from "unified"

export type { PhrasingContent, RootContent }

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCjkFriendly).freeze()
// micromark's own switch for a construct: no indented code (the fenced kind stays)
const extensions = processor.data("micromarkExtensions") as unknown[]
extensions.push({ disable: { null: ["codeIndented"] } })

const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A turn's text as blocks: cut at blank lines (as the reader's paragraphs always were), except inside a fence,
 *  which keeps its blank lines and closes at a run of its own character at least as long. */
export const blocks = (text: string): string[] => {
  const out: string[] = []
  let cur: string[] = []
  let fence: string | undefined
  for (const line of text.split("\n")) {
    const m = FENCE.exec(line)
    if (fence) {
      cur.push(line)
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = undefined
      continue
    }
    if (!line.trim()) {
      if (cur.length) out.push(cur.join("\n"))
      cur = []
      continue
    }
    if (m) fence = m[1]!
    cur.push(line)
  }
  if (cur.length) out.push(cur.join("\n"))
  return out
}

/** One block parsed: its mdast children. `open` is the block still being written: its unclosed marks are closed
 *  for display (the text itself is never changed). */
export const parse = (block: string, open = false): RootContent[] => {
  const text = open ? remend(block, { links: false, images: false, inlineKatex: false, katex: false }) : block
  return (processor.runSync(processor.parse(text)) as Root).children
}

/** The text under the marks: what a one-line preview or a menu row shows. */
export const plain = (text: string): string =>
  blocks(text)
    .map((b) => parse(b).map(flat).join(""))
    .filter(Boolean)
    .join(" ")
const flat = (n: Nodes): string => {
  switch (n.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
      return n.value
    case "image":
    case "imageReference":
      return n.alt ?? ""
    case "break":
      return "\n"
    case "thematicBreak":
    case "definition":
      return ""
    case "list":
    case "table":
    case "tableRow":
      return n.children.map(flat).join(" ")
    default:
      return "children" in n ? n.children.map(flat).join("") : ""
  }
}
