// The card page's derivations from the card's projection (store.ts CardView): the chip row, and an opening's line in
// the list. Pure: no Solid, no DOM.
import type { Greeting } from "@effect-tavern/runtime/src/card.ts"
import { effect, labels } from "./phrase.ts"
import type { CardView } from "./store.ts"
import { t } from "./i18n.ts"
import { plain } from "./markdown.ts"

/** A chip on the page's one row: a word, and the list it stands for in the hint. The tag step appends the card's
 *  facets and its own tags to the same row. */
export interface Chip {
  label: string // a word of the chrome in the locale in force, or the card's own
  hint?: string
}
/** Mode: the default channel. State: the fields the status table shows, named in the hint. The fiction's module
 *  labels are the author's, not a spec of play (design/new-story-and-tags.md §2): not drawn. */
export const chips = (c: CardView): Chip[] => {
  const out: Chip[] = [{ label: c.input === "note" ? t("card.modeAuthor") : t("card.modeParticipant") }]
  const fields = c.rules.fields.filter((f) => !f.hidden).map((f) => f.label ?? f.path)
  if (fields.length) out.push({ label: t("card.specState"), hint: fields.join(" · ") })
  return out
}
/** An opening's first line, for the list, under its marks. */
export const firstLine = (text: string): string => plain(text.trim().split(/\r?\n/)[0] ?? "")
/** What an opening sets at the start, as one phrase: its first enum set (a route's name tells most), else its first set. */
export const openingTag = (c: CardView, g: Greeting): string | undefined => {
  const sets = (g.do ?? []).filter((e) => "set" in e)
  const e = sets.find((x) => typeof (x as { set: unknown }).set === "string") ?? sets[0]
  return e && effect(e, labels(c.rules))
}
