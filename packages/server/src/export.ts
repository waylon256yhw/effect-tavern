// A story leaves the library two ways (#75): as a backup, the log tree whole as JSON (every node, every branch, head
// and next), what an import would read back; and as a reading copy, the head's line as Markdown: the opening, each
// player line (and the note that went with it) and the prose, nothing the model was asked and nothing it was
// judged by. Both are pure over what the library holds, so they are built here and tested without a server.
import { splitAside, textOf, type Input } from "@effect-tavern/runtime/src/journal.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import type { Turn } from "@effect-tavern/runtime/src/session.ts"
import type { StoryRow } from "./data.ts"

export interface Exported {
  card: { id: string; title: string }
  story: StoryRow
  snapshot: L.Snapshot<Turn>
}
/** The backup: a format name and version first, so a reader knows what it holds before the tree. */
export const backup = (x: Exported, at = new Date()) => ({
  format: "effect-tavern/story",
  version: 1,
  exported: at.toISOString(),
  card: x.card,
  story: { id: x.story.id, title: x.story.title, starred: x.story.starred, updated: x.story.updated },
  snapshot: x.snapshot,
})

/** What a turn asked for, as a quote: the line, and under it the note to the narrator, marked. */
const asked = (i: Input): string[] => {
  const out: string[] = []
  if (i.text.trim())
    out.push(
      ...i.text
        .trim()
        .split("\n")
        .map((l) => `> ${l}`),
    )
  if (i.note?.trim()) {
    if (out.length) out.push(">")
    out.push(
      ...i.note
        .trim()
        .split("\n")
        .map((l, k) => `> ${k === 0 ? "（场外指导）" : ""}${l}`),
    )
  }
  return out
}
/** The reply as it reads: the prose whole, and an aside after it in italics, named when it was. */
const told = (t: Turn): string[] => {
  const parts = splitAside(t.reply)
  const prose = textOf(parts).trim()
  const aside = parts.find((p) => p.type === "aside")
  const out = prose ? [prose] : []
  if (aside?.text.trim())
    out.push(`*${"label" in aside && aside.label ? `（${aside.label}）` : ""}${aside.text.trim()}*`)
  return out
}
/** The reading copy. Blocks are separated by a blank line; a turn is its quote then its prose; a greeting (no input)
 *  is its prose alone. The head line names the story, the card, the turns and the time of export. */
export const markdown = (x: Exported, at = new Date()): string => {
  const line = L.path(L.of(x.snapshot))
  const head = `# ${x.story.title ?? "New story"}\n\n${x.card.title} · ${x.story.turns} 轮 · 导出于 ${at.toISOString().slice(0, 10)}\n\n---`
  const blocks = line.flatMap((t) => {
    const quote = asked(t.input)
    return [...(quote.length ? [quote.join("\n")] : []), ...told(t)]
  })
  return `${[head, ...blocks].join("\n\n")}\n`
}

const graphemes = new Intl.Segmenter()
/** A download's file name from the story's title (or its id): the characters a file system refuses taken out, cut
 *  to a sensible length by grapheme (a cut inside a surrogate pair would be no UTF-8 at all, and half an emoji is
 *  no better); `filename*` carries it UTF-8 encoded, `filename` an ASCII fallback. */
export const disposition = (story: StoryRow, ext: "md" | "json"): string => {
  const clean = (story.title ?? `story-${story.id}`).replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").trim()
  const base = Array.from(graphemes.segment(clean), (g) => g.segment)
    .slice(0, 60)
    .join("")
    .trimEnd()
  const name = `${base || `story-${story.id}`}.${ext}`
  const ascii = name.replace(/[^\x20-\x7e]/gu, "_") // one mark per code point, not per UTF-16 unit
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
