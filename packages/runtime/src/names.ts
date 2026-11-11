// Names (GLOSSARY): a dictionary of proper nouns behind `{{key}}` holes, one plain pass of replacement, not a template
// language. `user` and `char` are conventional keys, no special case here. A value is one line with no `{{`, so a value
// holding a template does not exist by definition, and the single pass rules out recursion besides. The session expands
// per entry before a request is assembled (docs/packs-brief.md §八); history and the player's input are never expanded.
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
/** Every hole filled, or undefined when one has no value: that entry does not go out. */
export const expand = (text: string, names: Names): string | undefined =>
  unfilled(text, names).length ? undefined : text.replace(HOLE, (_, k: string) => names[k]!)
/** Items with their text expanded, an item with an unfilled hole dropped; one with no text passes as it is. */
export const fill = <T extends { readonly text?: string }>(items: readonly T[], names: Names): T[] =>
  items.flatMap((x) => {
    if (!x.text) return [x]
    const text = expand(x.text, names)
    return text === undefined ? [] : [{ ...x, text }]
  })

/** Optional whole lines (guards, for example) disappear when a name cannot be filled. */
export const lines = (texts: readonly string[], names: Names): string[] =>
  texts.flatMap((text) => expand(text, names) ?? [])
