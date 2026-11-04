// The shelf's search (side.tsx, design/new-story-and-tags.md §5.2): the box split on whitespace, every term must hold.
// A plain word matches the folded title, summary or any of the player's words on the card (`Local.tags`, #133) by
// substring; `#x` is exact, on one of those words or on a facet's word in the locale in force (`#作者`, `#检定`, `#多开场`); a leading `-` negates either kind. Pure over the
// rows GET /cards gives; the facet words are read through `t()` when a term is tested, never held as a word table.
import type { Local } from "@effect-tavern/runtime/src/layer.ts"
import { t, type Key } from "./i18n.ts"
import type { ShelfCard } from "./store.ts"
import { fold } from "./stories.ts"

export type Term = { word: string; tag: boolean; not: boolean }
export type TagsMap = Readonly<Record<string, readonly string[]>>

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

/** A card's facet words in the locale in force (none on a row without facets). */
const facetWords = (c: ShelfCard): string[] => {
  const f = c.facets
  if (!f) return []
  return [
    t(f.mode === "note" ? "card.modeAuthor" : "card.modeParticipant"),
    ...FLAGS.filter(([k]) => f[k]).map(([, key]) => t(key)),
  ]
}

/** Whether `w` is one of the harness's facet words in the locale in force. */
export const isFacet = (w: string): boolean => {
  const f = fold(w)
  return (
    f === fold(t("card.modeAuthor")) ||
    f === fold(t("card.modeParticipant")) ||
    FLAGS.some(([, key]) => f === fold(t(key)))
  )
}

/** A card's `#` words: the player's words on it, then its facets in the locale in force (none on a row without facets). */
const labels = (c: ShelfCard, words: readonly string[]): string[] => [...words, ...facetWords(c)]

/** Whether a card holds every term and every picked chip; `words` are the player's on it (`Player.tags[c.id]`). */
export const admits = (
  c: ShelfCard,
  terms: readonly Term[],
  words: readonly string[] = [],
  picked: readonly string[] = [],
): boolean => {
  if (!terms.length && !picked.length) return true
  const tags = labels(c, words).map(fold)
  if (!picked.every((w) => tags.includes(fold(w)))) return false
  if (!terms.length) return true
  const text = [c.title, c.summary ?? "", ...words].map(fold)
  return terms.every((x) => (x.tag ? tags.includes(x.word) : text.some((s) => s.includes(x.word))) !== x.not)
}

/** Whether the shelf's facet panel belongs open over `q`: nothing in it but `#` terms, or a `#…` being typed last. A
 *  plain word frees the list the panel would cover. */
export const facetsWanted = (q: string): boolean => parse(q).every((x) => x.tag) || /(?:^|\s)#\S*$/.test(q)

const tally = (lists: Iterable<readonly string[]>): [string, number][] => {
  const n = new Map<string, [string, number]>()
  for (const ws of lists)
    for (const [f, w] of new Map(ws.map((w) => [fold(w), w]))) {
      const was = n.get(f)
      n.set(f, [was?.[0] ?? w, (was?.[1] ?? 0) + 1])
    }
  return [...n.values()].sort((a, b) => b[1] - a[1])
}

/** Every `#` word on `rows` split into system facets (in the locale in force) and the player's words (`words(id)`),
 *  each with how many of the rows carry it, most first (ties in the order met), spelled as first met: the shelf's
 *  facet panel. Over the rows the query already admits, a word's count is what `admits` would leave with it added. */
export const facetCounts = (
  rows: readonly ShelfCard[],
  words: (id: string) => readonly string[],
): { facets: [string, number][]; tags: [string, number][] } => ({
  facets: tally(rows.map(facetWords)),
  tags: tally(rows.map((c) => words(c.id).filter((w) => !isFacet(w)))),
})

/** Maximum filing words on one card: bounds the workspace tag strip to ~2–3 rows. */
export const MAX_TAGS = 8

/** The player's filing words on a card's `Local` row rewritten by `f`: trimmed, deduped, capped at `MAX_TAGS`; an
 *  empty list drops the `tags` field. */
export const withTags = (l: Local, f: (words: readonly string[]) => readonly string[]): Local => {
  const words = [...new Set(f(l.tags ?? []).map((w) => w.trim()))].filter(Boolean).slice(0, MAX_TAGS)
  const { tags: _, ...rest } = l
  return words.length ? { ...rest, tags: words } : rest
}

/** Extracts the `{ [card]: tags }` map from `locals`. */
export const tagsOfLocals = (
  locals: Readonly<Record<string, Local>> | undefined,
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {}
  for (const [c, l] of Object.entries(locals ?? {})) if (l.tags?.length) out[c] = l.tags
  return out
}

/** The player's words on `card` in `tags` rewritten by `f`: trimmed, deduped, capped at `MAX_TAGS`, an empty list
 *  deletes the key, an empty map returns undefined. */
export const retag = (
  tags: TagsMap | undefined,
  card: string,
  f: (words: readonly string[]) => readonly string[],
): Record<string, string[]> | undefined => {
  const { [card]: was = [], ...rest } = tags ?? {}
  const words = [...new Set(f(was).map((w) => w.trim()))].filter(Boolean).slice(0, MAX_TAGS)
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, [...v]]))
  if (words.length) next[card] = words
  return Object.keys(next).length ? next : undefined
}
/** The player's words on other cards and not on `card`, holding `q` by folded substring: what one tap attaches. */
export const spare = (tags: TagsMap | undefined, card: string, q: string): string[] => {
  const mine = new Set(tags?.[card] ?? [])
  if (mine.size >= MAX_TAGS) return []
  const f = fold(q.trim())
  return [...new Set(Object.values(tags ?? {}).flat())].filter((w) => !mine.has(w) && fold(w).includes(f))
}
/** Every card's `from` becomes `to` (trimmed; no duplicate where `to` is already on; an empty `to` changes nothing). */
export const renameTag = (
  tags: TagsMap | undefined,
  from: string,
  to: string,
): Record<string, string[]> | undefined => {
  const w = to.trim()
  if (!w || w === from || !tags)
    return tags ? Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, [...v]])) : undefined
  return Object.keys(tags).reduce<Record<string, string[]> | undefined>(
    (q, c) => retag(q, c, (ws) => ws.map((x) => (x === from ? w : x))),
    Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, [...v]])),
  )
}
/** `word` off every card; an emptied list and an emptied map go as `retag` drops them. */
export const dropTag = (tags: TagsMap | undefined, word: string): Record<string, string[]> | undefined =>
  !tags
    ? undefined
    : Object.keys(tags).reduce<Record<string, string[]> | undefined>(
        (q, c) => retag(q, c, (ws) => ws.filter((x) => x !== word)),
        Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, [...v]])),
      )
/** Every word with the number of cards carrying it, most cards first, then by word: the tag manager's one order. */
export const tagCounts = (tags: TagsMap | undefined): [string, number][] => {
  const n = new Map<string, number>()
  for (const ws of Object.values(tags ?? {})) for (const w of ws) n.set(w, (n.get(w) ?? 0) + 1)
  return [...n].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
}
