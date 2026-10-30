// The stories as the left card and the manager (side.tsx) arrange them: starred first, the open one kept in view on
// the card's four rows; the manager's search over the title here and over the turns on the server (its hits by
// story id), the quick picks of the cleanup (#75), the preview a row carries. Pure over the rows the wire holds.
import type { StoryRow } from "./store.ts"
import { locale as current, t } from "./i18n.ts"

/** A search hit as the server answers it (server data.ts `Hit`): the earliest turn on the head's line whose player
 *  line, note or prose holds the query (turn 0 is the greeting), a snippet of that field, and how many nodes hit. */
export interface Hit {
  id: number
  turn: number
  kind: "input" | "note" | "reply"
  text: string
  count: number
}

/** ASCII case folded, as the server's search folds (SQLite's lower()): the title here and the turns there match
 *  the same way, and a fold never moves an index (JS's toLowerCase can lengthen a string: İ becomes two units). */
export const fold = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase())
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
]
const formats = new Map<string, Intl.RelativeTimeFormat>()
/** "2 hours ago", "yesterday", "now" in the locale given (the card's rows are English, the manager Chinese). */
export const ago = (at: number, locale: string = current(), now = Date.now()): string => {
  let rel = formats.get(locale)
  if (!rel) formats.set(locale, (rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })))
  const d = at - now
  const u = units.find(([, ms]) => Math.abs(d) >= ms)
  return u ? rel.format(Math.round(d / u[1]), u[0]) : locale.startsWith("zh") ? "刚刚" : "now"
}
/** Starred first; within each, the listing's own order (newest first). */
export const ranked = (rows: readonly StoryRow[]): StoryRow[] =>
  [...rows].sort((a, b) => Number(b.starred) - Number(a.starred))
/** The sidebar's rows (#117): starred first, then the most recently touched first, whatever order the listing came in. */
export const arranged = (rows: readonly StoryRow[]): StoryRow[] =>
  [...rows].sort((a, b) => Number(b.starred) - Number(a.starred) || b.updated - a.updated)
/** The story most recently touched among `rows`: what a card picked on the shelf opens on. */
export const latestOf = (rows: readonly StoryRow[]): StoryRow | undefined =>
  rows.reduce<StoryRow | undefined>((best, s) => (!best || s.updated > best.updated ? s : best), undefined)
/** Whether a card has a turn in flight on any of its stories (the dot on its shelf row, and beside the back button
 *  for every other card). */
export const busyOn = (rows: readonly StoryRow[], card: string): boolean =>
  rows.some((s) => s.card === card && s.busy !== null)
export const busyElsewhere = (rows: readonly StoryRow[], card: string): boolean =>
  rows.some((s) => s.card !== card && s.busy !== null)
/** The left card's rows: the first `n` of the ranked list, and the open story among them whatever its rank (it takes
 *  the last place), so the row on the tint is never below the cut. */
export const shown = (rows: readonly StoryRow[], current: number | null | undefined, n = 4): StoryRow[] => {
  const all = ranked(rows)
  const top = all.slice(0, n)
  if (all.length > n && current != null && !top.some((s) => s.id === current)) {
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
  return note ? t("stories.notePreview", { note: note }) : null
}
/** Whether a row stays under the search: no search, its title holds the query, or the server's hits name it. */
export const matches = (row: StoryRow, q: string, hits: ReadonlyMap<number, Hit>): boolean => {
  const t = fold(q.trim())
  return !t || fold(row.title ?? "").includes(t) || hits.has(row.id)
}
/** `text` cut at every `q` (ASCII folded), each cut marked as a hit, for a `<mark>`; no query, the text whole. */
export const pieces = (text: string, q: string): { text: string; hit: boolean }[] => {
  const t = fold(q.trim())
  if (!t) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  const lower = fold(text)
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
export const turnLabel = (hit: Hit): string =>
  hit.turn === 0 ? t("stories.opening") : t("common.turnN", { n: hit.turn })
export const kindLabel = (kind: Hit["kind"]): string =>
  kind === "input" ? t("stories.kindInput") : kind === "note" ? t("stories.kindNote") : t("stories.kindReply")

/** After a delete answered `next` as the story to be on: whether the client stays where it is (its reader, draft and
 *  place kept). Only when the story it was on was not among those deleted and is still the one named; the id alone
 *  does not tell, since a library made before story ids were autoincrement hands a deleted id to the next story made. */
export const stays = (open: number | null | undefined, deleted: readonly number[], next: number | null): boolean =>
  open != null && !deleted.includes(open) && next === open
