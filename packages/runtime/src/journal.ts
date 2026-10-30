// §17: one node per turn = the player's input plus every block the system produced for it. Only LLM outputs and seeds
// are stored; events, state and deliveries are derived along the path. The tree itself (parents, siblings as versions,
// head, drop) is src/log.ts; this file is what a node holds.
import type { Effect_ } from "./card.ts"
import type { Part } from "./fragment.ts"
import type { Disclosure } from "./lore.ts"

export interface Input {
  text: string
  note?: string // this-turn-only instruction, never rendered for past turns
  pin?: string // an untold entry (lore id or `<product>@<node>#<i>`) this turn MUST tell; check verifies, a miss stays untold
}
export interface Brief {
  must: readonly string[]
  may: readonly string[]
  tone?: string
}
export interface Turn<B> {
  id: number
  parent: number | null
  input: Input
  read: readonly Disclosure[] // lore delivered by lookup
  opening?: readonly (typeof Effect_.Type)[] // a greeting's effects, applied before anything else on the path
  beats: readonly B[] // decide + seed, settled by code on replay
  answers: Readonly<Record<string, string>> // readout id → option id, chosen at record; settled by code on replay
  end: "end" | "over" | "cap" | "stopped" // stopped: the player halted the prose mid-stream; the partial stands, check skipped
  brief: Brief
  reply: readonly Part[] // the model's output as parts; the prose is `textOf(reply)` and non-authoritative
  fired: readonly Disclosure[] // reveals confirmed by check; count as delivered
  adjust?: readonly (typeof Effect_.Type)[] // the player's field edits on this node, applied last in the fold; replayed like any effect
  violated: readonly string[]
  sibling?: "swipe" | "reword" | "edit" // which action made this sibling; absent on a player's own turn
  products: Readonly<Record<string, unknown>> // record's answers by product id, shaped by the card (src/product.ts); `notes` is one
}
/** The notes product, the compression source: this turn's sentence, as the one-item list every fold joins. A library
 *  written before #82 holds a list per turn; it reads the same. */
export const notesOf = <B>(t: Turn<B>): readonly string[] => {
  const n = t.products.notes as string | readonly string[] | undefined
  return typeof n === "string" ? (n ? [n] : []) : (n ?? [])
}

export const textOf = (parts: readonly Part[]): string =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("")
export const prose = <B>(t: Turn<B>): string => textOf(t.reply)
/** The first `<<aside>>` line splits the prose (see Part): the text before it is the one text part, in the first text
 *  part's place; everything after it is one aside part, last. No such line: the parts as given. */
export const splitAside = (parts: readonly Part[]): readonly Part[] => {
  const all = textOf(parts)
  const m = /^[ \t]*<<aside>>(.*)$/m.exec(all)
  if (!m) return parts
  const label = m[1]!.trim()
  let first = true
  return [
    ...parts.flatMap((p): Part[] =>
      p.type !== "text" ? [p] : first ? ((first = false), [{ ...p, text: all.slice(0, m.index).trimEnd() }]) : [],
    ),
    { type: "aside", id: "aside", ...(label ? { label } : {}), text: all.slice(m.index + m[0].length).trim() }, // one per reply
  ]
}

export const deliveredIn = <B>(t: Turn<B>): Disclosure[] => [...t.read, ...t.fired]
export const deliveredOn = <B>(path: readonly Turn<B>[], extra: readonly Disclosure[] = []): Disclosure[] => [
  ...path.flatMap(deliveredIn),
  ...extra,
]
