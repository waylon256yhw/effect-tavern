// The card page's derivations from the card's projection (store.ts CardView): the specification rows, each a list of
// names the page bounds, and an opening's line in the picker. Pure: no Solid, no DOM.
import type { Greeting } from "@effect-tavern/runtime/src/card.ts"
import { effect, labels } from "./phrase.ts"
import type { CardView } from "./store.ts"
import { type Key, t } from "./i18n.ts"
import { plain } from "./markdown.ts"

/** Names shown inline before "and N more": enough for flavour, one line on a phone. The rest open in a popover. */
export const SHOWN = 3
export interface Spec {
  key: Key // the row's name, a word of the chrome
  items: readonly string[] // the card's own words, or for Mode the channel's name (already in the locale in force)
}
/** Setting: the fiction's base modules by label (a variant, with `when`, folds into its module; an unlabelled module
 *  is not named). Mode: the default channel. State: the fields the status table shows. */
export const specs = (c: CardView): Spec[] => {
  const rows: Spec[] = []
  const modules = c.fiction.filter((f) => !f.when && f.label).map((f) => f.label!)
  if (modules.length) rows.push({ key: "card.specSetting", items: modules })
  rows.push({ key: "card.specMode", items: [c.input === "note" ? t("card.modeAuthor") : t("card.modeParticipant")] })
  const fields = c.rules.fields.filter((f) => !f.hidden).map((f) => f.label ?? f.path)
  if (fields.length) rows.push({ key: "card.specState", items: fields })
  return rows
}
/** An opening's first line, for the picker, under its marks. */
export const firstLine = (text: string): string => plain(text.trim().split(/\r?\n/)[0] ?? "")
/** What an opening sets at the start, as one phrase: its first enum set (a route's name tells most), else its first set. */
export const openingTag = (c: CardView, g: Greeting): string | undefined => {
  const sets = (g.do ?? []).filter((e) => "set" in e)
  const e = sets.find((x) => typeof (x as { set: unknown }).set === "string") ?? sets[0]
  return e && effect(e, labels(c.rules))
}
