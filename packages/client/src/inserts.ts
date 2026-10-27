// The quick inputs as the Writing page edits them (the 快捷输入 tab), pure: a format key and a snippet are both an
// Insert (`text` before the caret, `after` behind it); the editor holds the two halves and whether the caret lands
// between them (`after` present, a pair) or at the end (no `after`). A snippet adds its name, its hint and its
// channel (note: a word to the narrator). The player's lists go before the harness defaults (session.ts), so the
// card view's lists minus the player's own are the defaults, shown but not edited.
import type { Format, Snippet } from "@effect-tavern/runtime/src/fragment.ts"

export interface InsertDraft {
  label: string // a key's glyph, or a snippet's name
  between: boolean // the caret lands between the halves (a pair); off, `after` is dropped
  text: string
  after: string
  hint: string // snippets only
  note: boolean // snippets only
}
export const emptyDraft = (snippet: boolean): InsertDraft => ({
  label: "",
  between: !snippet,
  text: "",
  after: "",
  hint: "",
  note: snippet,
})
export const draftOfFormat = (f: Format): InsertDraft => ({
  label: f.label,
  between: f.after !== undefined,
  text: f.text,
  after: f.after ?? "",
  hint: "",
  note: false,
})
export const draftOfSnippet = (s: Snippet): InsertDraft => ({
  label: s.name,
  between: s.after !== undefined,
  text: s.text,
  after: s.after ?? "",
  hint: s.hint ?? "",
  note: !!s.note,
})
/** A key from the editor: the glyph is what is typed when the label is blank; nothing to insert is no key. */
export const formatOf = (d: InsertDraft): Format | undefined => {
  const text = d.text
  const after = d.between ? d.after : ""
  if (!text && !after) return undefined
  const label = d.label.trim() || text + after
  return d.between && after ? { label, text, after } : { label, text }
}
/** A snippet from the editor: it needs a name; a bare one (no text) is the channel switch itself (the default 场外). */
export const snippetOf = (d: InsertDraft): Snippet | undefined => {
  const name = d.label.trim()
  if (!name) return undefined
  const after = d.between ? d.after : ""
  return {
    name,
    text: d.text,
    ...(d.between && after && { after }),
    ...(d.hint.trim() && { hint: d.hint.trim() }),
    ...(d.note && { note: true }),
  }
}
/** The harness defaults as the card view shows them: the merged list minus the player's own (by `key`; the view may
 *  have filtered some away, so no slicing by count). */
export const defaultsOf = <T>(merged: readonly T[], mine: readonly T[], key: (x: T) => string): T[] => {
  const own = new Set(mine.map(key))
  return merged.filter((x) => !own.has(key(x)))
}
/** What an insert puts into the box (`text` + `after`), without a synthetic caret mark. */
export const caretOf = (i: { text: string; after?: string }): string => `${i.text}${i.after ?? ""}`
