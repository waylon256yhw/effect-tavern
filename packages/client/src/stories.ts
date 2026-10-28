// The stories as the left card and the manager (side.tsx) arrange them: starred first, the open one kept in view on
// the card's four rows; the manager's search over the title here and over the turns on the server (its hits by
// story id), the quick picks of the cleanup (#75), the preview a row carries. Pure over the rows the wire holds.
import type { StoryRow } from "./store.ts"

/** A search hit as the server answers it (server data.ts `Hit`): the earliest turn on the head's line whose player
 *  line, note or prose holds the query (turn 0 is the greeting), a snippet of that field, and how many nodes hit. */
export interface Hit {
  id: number
  turn: number
  kind: "input" | "note" | "reply"
  text: string
  count: number
}

/** Starred first; within each, the listing's own order (newest first). */
export const ranked = (rows: readonly StoryRow[]): StoryRow[] =>
  [...rows].sort((a, b) => Number(b.starred) - Number(a.starred))
/** The left card's rows: the first `n` of the ranked list, and the open story among them whatever its rank (it takes
 *  the last place), so the row on the tint is never below the cut. */
export const shown = (rows: readonly StoryRow[], current: number | undefined, n = 4): StoryRow[] => {
  const all = ranked(rows)
  const top = all.slice(0, n)
  if (all.length > n && current !== undefined && !top.some((s) => s.id === current)) {
    const open = all.find((s) => s.id === current)
    if (open) top[n - 1] = open
  }
  return top
}

/** What a row previews: the last turn's line, or its note marked as one, or nothing (an opening alone). */
export const preview = (row: StoryRow): string | null => {
  if (!row.last) return null
  const text = row.last.text.trim()
  if (text) return text
  const note = row.last.note?.trim()
  return note ? `（场外指导）${note}` : null
}
/** Whether a row stays under the search: no search, its title holds the query, or the server's hits name it. */
export const matches = (row: StoryRow, q: string, hits: ReadonlyMap<number, Hit>): boolean => {
  const t = q.trim().toLowerCase()
  return !t || (row.title ?? "").toLowerCase().includes(t) || hits.has(row.id)
}
/** `text` cut at every `q` (case folded), each cut marked as a hit, for a `<mark>`; no query, the text whole. */
export const pieces = (text: string, q: string): { text: string; hit: boolean }[] => {
  const t = q.trim().toLowerCase()
  if (!t) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  let at = 0
  for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, at)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false })
    out.push({ text: text.slice(i, i + t.length), hit: true })
    at = i + t.length
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}
/** The cleanup's quick picks: a story with only its opening, and one never named nor starred (the discarded start). */
export const empty = (row: StoryRow): boolean => row.turns === 0
export const unnamed = (row: StoryRow): boolean => row.title === null && !row.starred
/** A hit's place: the greeting, or the turn by number. */
export const turnLabel = (hit: Hit): string => (hit.turn === 0 ? "开场白" : `第 ${hit.turn} 轮`)
export const kindLabel: Record<Hit["kind"], string> = { input: "玩家台词", note: "场外指导", reply: "正文" }
