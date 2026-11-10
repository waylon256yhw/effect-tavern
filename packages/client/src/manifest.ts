// The card page's derivations from the card's projection (store.ts CardView): the chip row, and an opening's line in
// the list. Pure: no Solid, no DOM.
import type { ShownGreeting as Greeting } from "@effect-tavern/runtime/src/card.ts"
import { effect, labels } from "@effect-tavern/runtime/src/phrase.ts"
import type { CardView } from "./store.ts"
import { t } from "./i18n.ts"
import { plain } from "./markdown.ts"
import { FLAGS, parse } from "./query.ts"
import { fold } from "./stories.ts"

/** A chip on the page's row (design/new-story-and-tags.md §5.1): the harness's word for what the card is, with the
 *  list it stands for (a tap opens it, card.tsx). */
export interface Chip {
  label: string // a word of the chrome in the locale in force
  items?: readonly string[]
}
/** Mode, then each mechanism the card has (query.ts FLAGS, the shelf's `#` words), each with what it stands for: the
 *  visible fields' labels, the actions' and readouts' text (card.ts: the option as the model sees it, the question), the lore's size, the
 *  openings' count. The fiction's module labels are the author's, not a spec of play (§2): not drawn. */
export const chips = (c: CardView): Chip[] => {
  const items = {
    fields: c.rules.fields.filter((f) => !f.hidden).map((f) => f.label ?? f.path),
    actions: c.rules.actions.map((a) => a.text),
    readouts: (c.rules.readouts ?? []).map((q) => q.text),
    lore: [t("card.loreSize", { entries: c.lore.entries, layers: c.lore.layers })],
    openings: [t("card.openingsCount", { n: c.greetings.length })],
  }
  const has = (k: keyof typeof items) => (k === "fields" ? items.fields.length > 0 : c.facets[k])
  return [
    { label: t(c.facets.mode === "note" ? "card.modeAuthor" : "card.modeParticipant") },
    ...FLAGS.filter(([k]) => has(k)).map(([k, key]) => ({ label: t(key), items: items[k] })),
  ]
}
/** An opening's first line, for the list, under its marks. */
export const firstLine = (text: string): string => plain(text.trim().split(/\r?\n/)[0] ?? "")
/** All visible state changes an opening makes at the start, enum sets first (a route's name tells most). */
export const openingTags = (c: CardView, g: Greeting): string[] => {
  const hidden = new Set(c.rules.fields.filter((f) => f.hidden).map((f) => f.path))
  const changes = (g.do ?? []).filter(
    (e): e is Exclude<typeof e, { event: string }> => "path" in e && !hidden.has(e.path),
  )
  const enums = changes.filter((e) => "set" in e && typeof e.set === "string")
  const rest = changes.filter((e) => !("set" in e && typeof e.set === "string"))
  const by = labels(c.rules)
  return [...enums, ...rest].map((e) => effect(e, by))
}
/** What an opening sets at the start, as one phrase: its first enum set (a route's name tells most), else its first set. */
export const openingTag = (c: CardView, g: Greeting): string | undefined => {
  const sets = (g.do ?? []).filter((e) => "set" in e)
  const e = sets.find((x) => typeof (x as { set: unknown }).set === "string") ?? sets[0]
  return e && effect(e, labels(c.rules))
}
/** Whether an opening holds every term of `q`, by substring over its folded text and its state tags (`-` negates). */
export const admitsOpening = (c: CardView, g: Greeting, q: string): boolean => {
  const terms = parse(q)
  if (!terms.length) return true
  const hay = [g.text, ...openingTags(c, g)].map(fold)
  return terms.every((x) => hay.some((s) => s.includes(x.word)) !== x.not)
}
