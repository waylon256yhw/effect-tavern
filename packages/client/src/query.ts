// The shelf's search (side.tsx, design/new-story-and-tags.md §5.2): the box split on whitespace, every term must hold.
// A plain word matches the folded title, summary or any user tag by substring; `#x` is exact, on a user tag or on a
// facet's word in the locale in force (`#作者`, `#检定`, `#多开场`); a leading `-` negates either kind. Pure over the
// rows GET /cards gives; the facet words are read through `t()` when a term is tested, never held as a word table.
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

/** A card's `#` words: its user tags, then its facets in the locale in force (none on a row without facets). */
const labels = (c: ShelfCard): string[] => {
  const f = c.facets
  if (!f) return [...(c.tags ?? [])]
  return [
    ...(c.tags ?? []),
    t(f.mode === "note" ? "card.modeAuthor" : "card.modeParticipant"),
    ...FLAGS.filter(([k]) => f[k]).map(([, key]) => t(key)),
  ]
}

/** Whether a card holds every term. */
export const admits = (c: ShelfCard, terms: readonly Term[]): boolean => {
  if (!terms.length) return true
  const tags = labels(c).map(fold)
  const text = [c.title, c.summary ?? "", ...(c.tags ?? [])].map(fold)
  return terms.every((x) => (x.tag ? tags.includes(x.word) : text.some((s) => s.includes(x.word))) !== x.not)
}
