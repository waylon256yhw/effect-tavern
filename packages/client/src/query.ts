// The shelf's search (side.tsx, design/new-story-and-tags.md §5.2): the box split on whitespace, every term must hold.
// A plain word matches the folded title, summary or any of the player's words on the card (`Player.tags`, #133) by
// substring; `#x` is exact, on one of those words or on a facet's word in the locale in force (`#作者`, `#检定`, `#多开场`); a leading `-` negates either kind. Pure over the
// rows GET /cards gives; the facet words are read through `t()` when a term is tested, never held as a word table.
import type { Player } from "@effect-tavern/runtime/src/fragment.ts"
import { t, type Key } from "./i18n.ts"
import type { ShelfCard } from "./store.ts"
import { fold } from "./stories.ts"

export type Term = { word: string; tag: boolean; not: boolean }

/** The presence facets and the key of the word each is drawn by: the shelf's `#` words, the card page's chips. */
export const FLAGS = [
  ["fields", "card.specState"],
  ["actions", "card.facetActions"],
  ["readouts", "card.facetReadouts"],
  ["lore", "card.facetLore"],
  ["openings", "card.facetOpenings"],
] as const satisfies readonly (readonly [string, Key])[]

/** The query's terms, folded; a bare `-` or `#` is no term. */
export const parse = (q: string): Term[] =>
  q.split(/\s+/).flatMap((raw) => {
    const not = raw.startsWith("-")
    const rest = not ? raw.slice(1) : raw
    const tag = rest.startsWith("#")
    const word = fold(tag ? rest.slice(1) : rest)
    return word ? [{ word, tag, not }] : []
  })

/** The plain words the shelf marks in a row's title and summary. */
export const plain = (terms: readonly Term[]): string[] => terms.filter((x) => !x.tag && !x.not).map((x) => x.word)

/** A card's `#` words: the player's words on it, then its facets in the locale in force (none on a row without facets). */
const labels = (c: ShelfCard, words: readonly string[]): string[] => {
  const f = c.facets
  if (!f) return [...words]
  return [
    ...words,
    t(f.mode === "note" ? "card.modeAuthor" : "card.modeParticipant"),
    ...FLAGS.filter(([k]) => f[k]).map(([, key]) => t(key)),
  ]
}

/** Whether a card holds every term; `words` are the player's on it (`Player.tags[c.id]`). */
export const admits = (c: ShelfCard, terms: readonly Term[], words: readonly string[] = []): boolean => {
  if (!terms.length) return true
  const tags = labels(c, words).map(fold)
  const text = [c.title, c.summary ?? "", ...words].map(fold)
  return terms.every((x) => (x.tag ? tags.includes(x.word) : text.some((s) => s.includes(x.word))) !== x.not)
}

/** Maximum filing words on one card: bounds the workspace tag strip to ~2–3 rows. */
export const MAX_TAGS = 8

/** The player's words on `card` rewritten by `f`: trimmed, deduped, capped at `MAX_TAGS`, an empty list deletes the
 *  key, an empty map the field (written whole by `PUT /player`, wire.ts `putPlayer`). */
export const retag = (p: Player, card: string, f: (words: readonly string[]) => readonly string[]): Player => {
  const { [card]: was = [], ...rest } = p.tags ?? {}
  const words = [...new Set(f(was).map((w) => w.trim()))].filter(Boolean).slice(0, MAX_TAGS)
  const next = words.length ? { ...rest, [card]: words } : rest
  return { ...p, tags: Object.keys(next).length ? next : undefined }
}
/** The player's words on other cards and not on `card`, holding `q` by folded substring: what one tap attaches. */
export const spare = (tags: Player["tags"], card: string, q: string): string[] => {
  const mine = new Set(tags?.[card] ?? [])
  if (mine.size >= MAX_TAGS) return []
  const f = fold(q.trim())
  return [...new Set(Object.values(tags ?? {}).flat())].filter((w) => !mine.has(w) && fold(w).includes(f))
}
/** Every card's `from` becomes `to` (trimmed; no duplicate where `to` is already on; an empty `to` changes nothing). */
export const renameTag = (p: Player, from: string, to: string): Player => {
  const w = to.trim()
  if (!w || w === from) return p
  return Object.keys(p.tags ?? {}).reduce((q, c) => retag(q, c, (ws) => ws.map((x) => (x === from ? w : x))), p)
}
/** `word` off every card; an emptied list and an emptied map go as `retag` drops them. */
export const dropTag = (p: Player, word: string): Player =>
  Object.keys(p.tags ?? {}).reduce((q, c) => retag(q, c, (ws) => ws.filter((x) => x !== word)), p)
/** Every word with the number of cards carrying it, most cards first, then by word: the tag manager's one order. */
export const tagCounts = (tags: Player["tags"]): [string, number][] => {
  const n = new Map<string, number>()
  for (const ws of Object.values(tags ?? {})) for (const w of ws) n.set(w, (n.get(w) ?? 0) + 1)
  return [...n].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
}
