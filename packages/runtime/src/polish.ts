// The polish scan (issue #3): code finds the sentences of a turn's prose that hit the lexicon, so one targeted call can
// rewrite those and nothing else. Pure: no model, no session. A lexicon entry is a literal or a simple wildcard (`*` =
// a short run: `不是*而是`, `指节*白`); dialogue (inside 「」, 『』, “” or ‘’, nested by depth) is never scanned, since slop
// in speech is how people talk, and a standalone 『心声』 or ‘aside’ is speech too (#63). A hit marks its whole sentence,
// with exact coordinates into the prose, so replay and the Inspector reproduce it.
import { Schema } from "effect"

export const Entry = Schema.Struct({ pattern: Schema.String, hint: Schema.optionalKey(Schema.String) })
export type Entry = typeof Entry.Type
/** A sentence to polish: `text.slice(start, end)` is the sentence, `hits` the matched runs, `hints` their entries' hints. */
export interface Target {
  id: string
  start: number
  end: number
  hits: string[]
  hints: string[]
}

export const FLOOR = 200 // prose shorter than this is not worth a call (Story Oracle's cost gate)
const RUN = 12 // ponytail: `*` spans at most this many characters; per-entry when a pattern needs longer
const STOP = /[。！？!?…]/
const OPEN = /[「『“‘]/
const CLOSE = /[」』”’]/
/** Whether `cs[i]` closes a quote: any closer but ’ before a letter, which is an apostrophe (don’t, rock ’n’ roll)
 *  and would otherwise end a “…” early and lay the rest of the speech open to the scan. */
const closing = (cs: ArrayLike<string>, i: number) =>
  CLOSE.test(cs[i] ?? "") && !(cs[i] === "’" && /\p{L}/u.test(cs[i + 1] ?? ""))
const HIDDEN = "\u0000" // a masked dialogue character: no pattern matches it, `*` does not cross it

/** Sentence spans [start, end): a terminator run (and the closing quotes after it) ends one outside dialogue; inside it,
 *  a closing quote right after a terminator does (「走吧。」 ends there); a line break always does. Leading blanks are
 *  not part of a sentence. ASCII `.` ends one only before a blank or the end, so 3.5 stays whole. */
export const sentences = (text: string): [number, number][] => {
  const out: [number, number][] = []
  let start = 0
  let depth = 0
  const push = (end: number) => {
    while (start < end && /\s/.test(text[start]!)) start++
    if (start < end) out.push([start, end])
    start = end
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === "\n") {
      push(i)
      depth = 0 // an unclosed quote ends with its paragraph
      continue
    }
    if (OPEN.test(c)) depth++
    else if (closing(text, i)) {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && i > 0 && STOP.test(text[i - 1]!)) {
        while (closing(text, i + 1)) i++
        push(i + 1)
      }
    } else if (depth === 0 && (STOP.test(c) || (c === "." && /\s|^$/.test(text[i + 1] ?? "")))) {
      while (STOP.test(text[i + 1] ?? "")) i++
      while (closing(text, i + 1)) i++
      push(i + 1)
    }
  }
  push(text.length)
  return out
}

/** The text with every dialogue character (quotes included) masked, same length, so offsets still line up. */
const mask = (text: string) => {
  let depth = 0
  const cs = Array.from(text)
  return cs
    .map((c, i) => {
      if (c === "\n") depth = 0
      if (OPEN.test(c)) return (depth++, HIDDEN)
      if (closing(cs, i) && depth > 0) return (depth--, HIDDEN)
      return depth > 0 ? HIDDEN : c
    })
    .join("")
}
const compile = (pattern: string) =>
  new RegExp(
    pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(`[^${HIDDEN}]{0,${RUN}}?`),
    "g",
  )

/** The sentences of `text` that hit `lexicon` outside dialogue, as targets `hit-1`, `hit-2`, … in document order. None
 *  when the prose is under the floor or the lexicon is empty; lint scans card text with floor 0. */
export const scan = (text: string, lexicon: readonly Entry[], floor = FLOOR): Target[] => {
  if (text.length < floor || !lexicon.length) return []
  const masked = mask(text)
  const res = lexicon.filter((e) => e.pattern.replace(/\*/g, "")).map((e) => ({ e, re: compile(e.pattern) }))
  const out: Target[] = []
  for (const [start, end] of sentences(text)) {
    const s = masked.slice(start, end)
    const hits: string[] = []
    const hints: string[] = []
    for (const { e, re } of res)
      for (const m of s.matchAll(re)) {
        hits.push(m[0])
        if (e.hint && !hints.includes(e.hint)) hints.push(e.hint)
      }
    if (hits.length) out.push({ id: `hit-${out.length + 1}`, start, end, hits, hints })
  }
  return out
}

/** The prose as polish reads it: every target sentence wrapped in `<target id hits>`. */
export const marked = (text: string, targets: readonly Target[]) => {
  let out = ""
  let at = 0
  for (const t of targets) {
    out += `${text.slice(at, t.start)}<target id="${t.id}" hits="${t.hits.join("、")}">${text.slice(t.start, t.end)}</target>`
    at = t.end
  }
  return out + text.slice(at)
}

/** The prose with each answered target replaced by its answer. An echo is a pass-through; a blank answer keeps the
 *  sentence (a rewrite may not delete: polish is not re-checked, so a clue or a guard the sentence carried would go
 *  silently; a kept sentence at worst keeps its slop). */
export const splice = (text: string, targets: readonly Target[], out: Readonly<Record<string, string>>) => {
  let s = text
  for (const t of [...targets].reverse()) {
    const v = out[t.id]
    if (v !== undefined && v.trim() && v !== text.slice(t.start, t.end)) s = s.slice(0, t.start) + v + s.slice(t.end)
  }
  return s
}
