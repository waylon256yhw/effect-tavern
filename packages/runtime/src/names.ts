// Names (GLOSSARY): a dictionary of proper nouns behind `{{key}}` holes, one plain pass of replacement, not a template
// language. `user` and `char` are conventional keys, no special case here: no key has a fallback value, `user` included.
// A value is one line with no `{{`, so a value holding a template does not exist by definition, and the single pass rules
// out recursion besides. The session expands per entry before a request is assembled (docs/packs-brief.md §八); history
// and the player's input are never expanded.
//
// THE RULE for a hole nothing fills (#170), stated here and nowhere else (`expand`): the card's own text keeps it as the
// literal `{{key}}` and goes out, so nothing of the card's is dropped or refused for it (the player sees the literal and
// may name it); a player's text (the overlay, a pack, the local row, a hat) with one does not go out. Every caller says
// whose text it expands.
import { Schema } from "effect"

/** A value's lock: one line, no `{{`. The schema holds it at a boundary, layer.ts again over whatever a row holds. */
export const nameOk = (v: string) => !/[\r\n]|\{\{/.test(v)
export const Names = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.makeFilter((v) => nameOk(v) || "a name is one line with no {{")),
)
export type Names = typeof Names.Type

export const HOLE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g
/** The holes in a text: deduplicated, in order of appearance. */
export const holes = (text: string): string[] => [...new Set(Array.from(text.matchAll(HOLE), (m) => m[1]!))]
/** The holes the table has no value for (own keys only: `{{constructor}}` is a hole like any other). */
export const unfilled = (text: string, names: Names): string[] => holes(text).filter((k) => !Object.hasOwn(names, k))
/** Who wrote a text: `"card"` for the card's own; anything else (a row's `From`, `"hat"`) is a player's. */
export type Author = string
/** The text with every known name filled. A hole nothing fills stays as written in the card's text; in a player's the
 *  whole text is undefined: that entry does not go out. */
export const expand = (text: string, names: Names, from: Author): string | undefined =>
  from !== "card" && unfilled(text, names).length
    ? undefined
    : text.replace(HOLE, (hole, k: string) => (Object.hasOwn(names, k) ? names[k]! : hole))
/** Items expanded by their own `from`, or the one given (an item with neither is a player's); one that does not fill is
 *  dropped, one with no text passes as it is. */
export const fill = <T extends { readonly text?: string; readonly from?: Author }>(
  items: readonly T[],
  names: Names,
  from?: Author,
): T[] =>
  items.flatMap((x) => {
    if (!x.text) return [x]
    const text = expand(x.text, names, from ?? x.from ?? "")
    return text === undefined ? [] : [{ ...x, text }]
  })

/** Whole lines (guards, for example) expanded; a player's line that does not fill disappears. */
export const lines = (texts: readonly string[], names: Names, from: Author): string[] =>
  texts.flatMap((text) => expand(text, names, from) ?? [])
