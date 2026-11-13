// The stories as the left card and the manager (side.tsx) arrange them: starred first, the open one kept in view on
// the card's four rows; the manager's search over the title here and over the turns on the server (its hits by
// story id), the quick picks of the cleanup (#75), the preview a row carries. Pure over the rows the wire holds.
import type { Page, StoryRow } from "./store.ts"
import { t } from "./i18n.ts"

/** A search hit as the server answers it (server data.ts `Hit`): the earliest turn on the head's line whose player
 *  line, note or prose holds the query (turn 0 is the greeting), a snippet of that field, and how many nodes hit. */
export type { Hit } from "@effect-tavern/runtime/src/library.ts"
import type { Hit } from "@effect-tavern/runtime/src/library.ts"

/** ASCII case folded, as the server's search folds (SQLite's lower()): the title here and the turns there match
 *  the same way, and a fold never moves an index (JS's toLowerCase can lengthen a string: İ becomes two units). */
export const fold = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase())
const pad = (n: number): string => String(n).padStart(2, "0")
/** Standard `YYYY/MM/DD` date, with `HH:mm:ss` when touched within the last 24 hours. */
export const ago = (at: number, now = Date.now()): string => {
  const d = new Date(at)
  const day = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  return Math.abs(now - at) < 864e5 ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : day
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
/** The open story when it is of `card` and the stage is not the card's page (the workspace's persona row then reads
 *  and writes it), else none: the row is the card's default (`Local.persona`). On the card's page the tab keeps
 *  its story only for Escape (pages.ts `showCard`): what is picked there is for the story Begin makes. */
export const openOn = (
  lib: { current: number | null; stories: readonly StoryRow[] } | null,
  card: string | null,
  page: Page,
): StoryRow | undefined =>
  page === "card" ? undefined : lib?.stories.find((s) => s.id === lib.current && s.card === card)
/** The persona id the workspace's row shows: the open story's own, else the one the card is on as the server resolved
 *  it (its view's `persona`: the card's pick or the install's default); none = the card's own. */
export const personaOn = (
  lib: { current: number | null; stories: readonly StoryRow[] } | null,
  view: { id: string; persona: string | null } | null | undefined,
  card: string | null,
  page: Page,
): string | undefined => {
  const s = openOn(lib, card, page)
  if (s) return s.persona ?? undefined
  return (view?.id === card && view.persona) || undefined
}
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
  return note
    ? t("stories.notePreview", { note })
    : row.last.invoke?.length
      ? t("stories.invocationPreview", { n: row.last.invoke.length })
      : null
}
/** Whether a row stays under the search: no search, its title holds the query, or the server's hits name it. */
export const matches = (row: StoryRow, q: string, hits: ReadonlyMap<number, Hit>): boolean => {
  const t = fold(q.trim())
  return !t || fold(row.title ?? "").includes(t) || hits.has(row.id)
}
/** `text` cut at every `q` (ASCII folded), or at every one of several words (the shelf's plain terms, query.ts), each
 *  cut marked as a hit, for a `<mark>`; no query, the text whole. Of hits at one place the longest word wins. */
export const pieces = (text: string, q: string | readonly string[]): { text: string; hit: boolean }[] => {
  const words = (typeof q === "string" ? [q] : q).map((w) => fold(w.trim())).filter(Boolean)
  if (!words.length) return [{ text, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  const lower = fold(text)
  let at = 0
  for (;;) {
    let i = -1
    let n = 0
    for (const w of words) {
      const j = lower.indexOf(w, at)
      if (j >= 0 && (i < 0 || j < i || (j === i && w.length > n))) [i, n] = [j, w.length]
    }
    if (i < 0) break
    if (i > at) out.push({ text: text.slice(at, i), hit: false })
    out.push({ text: text.slice(i, i + n), hit: true })
    at = i + n
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
