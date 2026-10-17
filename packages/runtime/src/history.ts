// §17.2–17.3: history is a per-stage view over the path, never stored. Only the narrator sees the transcript;
// the director sees a ledger of facts. Compression is a derived view too: a prefix range is replaced by the CODE
// fold of its notes plus the lore text delivered in it, cached by range (ids are unique, so a range names a prefix).
import type { Disclosure } from "./lore.ts"
import type { Msg } from "./fragment.ts"
import { deliveredIn, prose, type Turn } from "./journal.ts"

export interface Summary {
  from: number
  to: number
  text: string
}
export const makeSummaries = <B>(loreText: (d: Disclosure) => string) => {
  const table = new Map<string, Summary>()
  return {
    compress: (path: readonly Turn<B>[], keepLast: number): Summary | undefined => {
      const range = path.slice(0, Math.max(0, path.length - keepLast))
      if (range.length < 2) return undefined
      const k = `${range[0].id}-${range[range.length - 1].id}`
      const hit = table.get(k)
      if (hit) return hit
      const facts = range.flatMap((t) => [...t.notes, ...deliveredIn(t).map(loreText)])
      const s: Summary = { from: range[0].id, to: range[range.length - 1].id, text: `Summary: ${facts.join(" ")}` }
      table.set(k, s)
      return s
    },
    summaryFor: (path: readonly Turn<B>[]): Summary | undefined => {
      if (path.length === 0) return undefined
      let best: Summary | undefined
      for (const s of table.values()) {
        if (s.from !== path[0].id) continue
        if (path.some((t) => t.id === s.to) && (!best || s.to > best.to)) best = s // longest cached prefix wins
      }
      return best
    },
    get size() {
      return table.size
    },
  }
}
export type Summaries<B> = ReturnType<typeof makeSummaries<B>>

/** §18.4: how many leading turns to fold. The boundary moves in blocks, so the summary is byte-stable between moves. */
export const folded = (len: number, keep: number, block: number) =>
  Math.max(0, Math.floor((len - keep) / block) * block)

/** Narrator: past input + prose + the lore delivered at that turn (so `read` can dedupe against it); never brief/notes/aside.
 *  `sum` is the summary the POLICY chose for this path (what `compress` returned); the side table is a cache and a cache
 *  never decides what a view contains, so the view is a function of (path, policy) and identical across branches. */
export const narratorHistory = <B>(
  path: readonly Turn<B>[],
  loreText: (d: Disclosure) => string,
  sum?: Summary,
): Msg[] => {
  const start = sum ? path.findIndex((t) => t.id === sum.to) + 1 : 0
  return [
    ...(sum ? [{ role: "system", text: sum.text } as Msg] : []),
    ...path.slice(start).flatMap((t): Msg[] => [
      ...(t.input.text ? [{ role: "user", text: t.input.text } as Msg] : []), // a greeting node has no input
      ...deliveredIn(t).map((d): Msg => ({ role: "system", text: loreText(d) })),
      { role: "assistant", text: prose(t), parts: t.reply },
    ]),
  ]
}

/** Director / decide: facts only — input, events, fired, notes. No prose anywhere. */
export const ledger = <B>(path: readonly Turn<B>[], eventsOf: (t: Turn<B>) => readonly string[]): Msg[] =>
  path.length
    ? [
        {
          role: "system",
          text: `Ledger:\n${path.map((t) => `${t.input.text} → ${eventsOf(t).join(",") || "-"}; fired ${t.fired.map((d) => d.id).join(",") || "-"}; ${t.notes.join("; ")}`).join("\n")}`,
        },
      ]
    : []
