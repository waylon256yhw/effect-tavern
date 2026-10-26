// §17.2–17.3: history is a per-stage view over the path, never stored. Only the narrator sees the transcript;
// the director sees a ledger of facts. Compression is a derived view too: a prefix range is replaced by the CODE
// fold of its notes plus the lore text delivered in it, cached by range (ids are unique, so a range names a prefix)
// and served only while the turns it covers are the ones it was folded from (an amend refolds it).
// A fold is a function of the turns INSIDE its range and nothing else: a later turn (one that will some day retract
// an earlier note) cannot reach back into a fold that does not contain it. That is what keeps the summary's cache
// breakpoint byte-stable between boundary moves; a retraction lands in the summary when the boundary passes its turn,
// and until then in the tail's Known line, which is rewritten every turn anyway. The boundary (`folded`) is a token
// budget stepped in blocks; a path only grows, so along it the boundary never moves back and moves a block at a time.
// One boundary drives three views: the narrator's summary + transcript, the ledger's summary + tail lines, and which
// recall rows the lookup may read (only rows whose node is folded: a tail row is still verbatim in the transcript).
import type { Disclosure } from "./lore.ts"
import type { Msg } from "./fragment.ts"
import { deliveredIn, notesOf, prose, type Turn } from "./journal.ts"

export interface Summary {
  from: number
  to: number
  text: string
}
export const makeSummaries = <B>(loreText: (d: Disclosure) => string) => {
  // Keyed by range, kept with the turns it was folded from. Ids name a range but not its content: `Log.amend` (setField,
  // demand) replaces a node in place under the same id, as a new object. An entry is served only while every turn it
  // covers is still that same object; an amended one refolds the range and replaces the entry. Checking identity rather
  // than keying on notes covers everything a fold reads off a node (notes, and recall items stored on it) for a pointer
  // compare per turn, and an unchanged log still hits.
  const table = new Map<string, { sum: Summary; over: readonly Turn<B>[] }>()
  const current = (over: readonly Turn<B>[], path: readonly Turn<B>[]) =>
    over.length <= path.length && over.every((t, i) => t === path[i])
  return {
    compress: (path: readonly Turn<B>[], keepLast: number): Summary | undefined => {
      const range = path.slice(0, Math.max(0, path.length - keepLast))
      if (range.length < 2) return undefined
      const k = `${range[0].id}-${range[range.length - 1].id}`
      const hit = table.get(k)
      if (hit && current(hit.over, range)) return hit.sum
      const facts = range.flatMap((t) => [...notesOf(t), ...deliveredIn(t).map(loreText)])
      const s: Summary = { from: range[0].id, to: range[range.length - 1].id, text: `Summary: ${facts.join(" ")}` }
      table.set(k, { sum: s, over: range })
      return s
    },
    summaryFor: (path: readonly Turn<B>[]): Summary | undefined => {
      let best: Summary | undefined
      for (const { sum, over } of table.values()) if (current(over, path) && (!best || sum.to > best.to)) best = sum // longest cached prefix wins
      return best
    },
    get size() {
      return table.size
    },
  }
}
export type Summaries<B> = ReturnType<typeof makeSummaries<B>>

export interface Policy {
  budget: number // estimated tokens (tokens.ts) the unfolded tail may hold
  keep: number // turns the tail always keeps
  block: number // the boundary moves this many turns at a time
}
/** The tail budget a narrate model's window leaves: half the window, less a reserve for the head (frame, fiction,
 *  summary) and the reply; 32k → 8000, 128k → 56000, 200k → 92000. The window unknown → 8000 (about eight Chinese turns
 *  verbatim). A window too small for the reserve folds all but `keep`. `keep` and `block` do not scale. Rerouting narrate
 *  to another window moves the boundary once, either way; along one window it only grows. */
export const share = 0.5
export const reserve = 8000
export const policyFor = (contextTokens?: number): Policy => ({
  budget: contextTokens ? Math.max(0, Math.floor(contextTokens * share) - reserve) : 8000,
  keep: 2,
  block: 2,
})
/** §18.4: how many leading turns to fold: the fewest, in whole blocks, that leave the tail's `cost` within the budget,
 *  never fewer than `keep` turns in the tail. A longer path only adds cost to every tail, so the count is monotone
 *  non-decreasing along a path and moves in blocks: the summary is byte-stable between moves. Walks back from the end
 *  and stops at the budget, so a call costs the tail, not the path. */
export const folded = <B>(path: readonly Turn<B>[], cost: (t: Turn<B>) => number, p: Policy) => {
  const cap = Math.max(0, Math.floor((path.length - p.keep) / p.block) * p.block)
  let j = path.length // the smallest j whose tail path[j..] fits
  for (let sum = 0; j > 0 && (sum += cost(path[j - 1]!)) <= p.budget; j--);
  return Math.min(cap, Math.ceil(j / p.block) * p.block)
}
/** The turns after the summary: the whole path when there is none. */
const tailOf = <B>(path: readonly Turn<B>[], sum?: Summary) =>
  sum ? path.slice(path.findIndex((t) => t.id === sum.to) + 1) : path

/** Narrator: past input + prose + the lore delivered at that turn (so `read` can dedupe against it); never brief/notes/note.
 *  `sum` is the summary the POLICY chose for this path (what `compress` returned); the side table is a cache and a cache
 *  never decides what a view contains, so the view is a function of (path, policy) and identical across branches. */
export const narratorHistory = <B>(
  path: readonly Turn<B>[],
  loreText: (d: Disclosure) => string,
  sum?: Summary,
): Msg[] => {
  return [
    ...(sum ? [{ role: "system", text: sum.text } as Msg] : []),
    ...tailOf(path, sum).flatMap((t): Msg[] => [
      ...(t.input.text ? [{ role: "user", text: t.input.text } as Msg] : []), // a greeting node has no input
      ...deliveredIn(t).map((d): Msg => ({ role: "system", text: loreText(d) })),
      { role: "assistant", text: prose(t), parts: t.reply.filter((p) => p.type !== "aside") }, // the aside never goes back
    ]),
  ]
}

/** Director / decide: facts only — input, events, fired, notes. No prose anywhere. The folded prefix is the narrator's
 *  own summary (its events are already in the state the stage reads), then one line per tail turn. */
export const ledger = <B>(
  path: readonly Turn<B>[],
  eventsOf: (t: Turn<B>) => readonly string[],
  sum?: Summary,
): Msg[] => {
  const tail = tailOf(path, sum)
  return [
    ...(sum ? [{ role: "system", text: sum.text } as Msg] : []),
    ...(tail.length
      ? [
          {
            role: "system",
            text: `Ledger:\n${tail.map((t) => `${t.input.text} → ${eventsOf(t).join(",") || "-"}; fired ${t.fired.map((d) => d.id).join(",") || "-"}; ${notesOf(t).join("; ")}`).join("\n")}`,
          } as Msg,
        ]
      : []),
  ]
}
