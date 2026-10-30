// The exports (src/export.ts) over a small tree: the reading copy is the head's line as Markdown (the greeting's prose,
// each turn's quote and prose, an aside in italics, a branch off the line left out), the backup names its format and
// carries the snapshot whole, and the download's name is the title made safe for a file system.
import type { Turn } from "@effect-tavern/runtime/src/session.ts"
import assert from "node:assert/strict"
import { backup, disposition, markdown, type Exported } from "../src/export.ts"

const turn = (id: number, parent: number | null, input: Turn["input"], reply: Turn["reply"]): Turn => ({
  id,
  parent,
  input,
  read: [],
  beats: [],
  answers: {},
  end: "end",
  brief: { must: [], may: [] },
  reply,
  fired: [],
  violated: [],
  products: {},
})
const story = {
  id: 7,
  card: "wuxia",
  title: "竹林夜话",
  starred: true,
  updated: 1700000000000,
  turns: 2,
  last: { text: "x" },
}
const x: Exported = {
  card: { id: "wuxia", title: "竹林" },
  story,
  snapshot: {
    nodes: [
      turn(0, null, { text: "" }, [{ type: "text", text: "暮春的雨刚歇。\n\n竹叶间还在滴水。" }]),
      turn(1, 0, { text: "我放下短剑。", note: "慢一点" }, [
        { type: "text", text: "他看着剑。\n<<aside>>旁白\n远处有人。" },
      ]),
      turn(2, 0, { text: "another branch" }, [{ type: "text", text: "never on the line" }]),
      turn(3, 1, { text: "", note: "让他开口" }, [{ type: "text", text: "「这把剑……」" }]),
    ],
    head: 3,
    next: 4,
  },
}
const at = new Date("2026-10-28T12:00:00Z")
assert.equal(
  markdown(x, at),
  [
    "# 竹林夜话",
    "",
    "竹林 · 2 轮 · 导出于 2026-10-28",
    "",
    "---",
    "",
    "暮春的雨刚歇。\n\n竹叶间还在滴水。",
    "",
    "> 我放下短剑。\n>\n> （场外指导）慢一点",
    "",
    "他看着剑。",
    "",
    "*（旁白）远处有人。*",
    "",
    "> （场外指导）让他开口",
    "",
    "「这把剑……」",
    "",
  ].join("\n"),
)
assert.equal(markdown({ ...x, story: { ...story, title: null } }, at).split("\n")[0], "# New story")
const b = backup(x, at)
assert.deepEqual(
  [b.format, b.version, b.exported, b.card, b.story, b.snapshot === x.snapshot],
  [
    "effect-tavern/story",
    1,
    "2026-10-28T12:00:00.000Z",
    x.card,
    { id: 7, title: "竹林夜话", starred: true, updated: 1700000000000 },
    true,
  ],
)
assert.equal(
  disposition(story, "md"),
  `attachment; filename="____.md"; filename*=UTF-8''${encodeURIComponent("竹林夜话.md")}`,
)
assert.equal(
  disposition({ ...story, title: 'a/b:c*"d?' }, "json"),
  `attachment; filename="a b c d.json"; filename*=UTF-8''${encodeURIComponent("a b c d.json")}`,
)
assert.equal(
  disposition({ ...story, title: null }, "json"),
  `attachment; filename="story-7.json"; filename*=UTF-8''story-7.json`,
)
assert.equal(
  disposition({ ...story, title: "   " }, "md"),
  `attachment; filename="story-7.md"; filename*=UTF-8''story-7.md`,
)
// the cut is by grapheme: an emoji at the edge stays whole or goes whole, never half, and is one mark in the fallback
const edge = `${"a".repeat(59)}😀 tail`
assert.equal(
  disposition({ ...story, title: edge }, "md"),
  `attachment; filename="${"a".repeat(59)}_.md"; filename*=UTF-8''${encodeURIComponent(`${"a".repeat(59)}😀.md`)}`,
)
assert.equal(markdown({ ...x, story: { ...story, turns: 7 } }, at).split("\n")[2], "竹林 · 7 轮 · 导出于 2026-10-28") // the row's count, not a second one
console.log("ok")
