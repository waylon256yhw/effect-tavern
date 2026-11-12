import type { DeliverySnapshot } from "./context.ts"
// §17: one node per turn = the player's input plus every block the system produced for it. Only LLM outputs and seeds
// are stored; events, state and deliveries are derived along the path. The tree itself (parents, siblings as versions,
// head, drop) is src/log.ts; this file is what a node holds.
import type { DomainChange } from "./world.ts"
import type { Effect_ } from "./card.ts"
import type { Part } from "./fragment.ts"
import type { Disclosure } from "./lore.ts"

export interface Input {
  text: string
  note?: string // this-turn-only instruction, never rendered for past turns
  invoke?: readonly string[] // entries requested by the player this turn
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
  deliveries: readonly DeliverySnapshot[] // frozen context actually supplied this turn
  opportunities: readonly (Disclosure & { text: string })[] // frozen gate candidates for reword/check
  read: readonly Disclosure[] // lore delivered by lookup
  boundary?: true // starts a new transcript window; state and products still fold over the full path
  passageStatus?: "pending" | "failed" | "committed" | "skipped" // recover a transition whose digest or narration failed
  passage?: true // automatic transition, never dispatches another passage on settlement
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
  changes: readonly DomainChange[]
  settlementStatus: "pending" | "failed" | "committed" | "skipped"
  settlementVersion: number
  settlementAttempt?: string
  settlementError?: string
  products: Readonly<Record<string, unknown>> // per-turn chronicle/theater outputs only; world writes live in changes
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
// The narrate stage's products (product.ts `stage`): after the prose, each block opens on a line `<<aside>> <id>` and
// runs to the next such line or the end. One cutter for both faces: `splitter` takes the stream as it comes (the live
// split is presentation only), `split` runs it over the landed reply, which is the truth.
const DELIM = "<<aside>>"
/** The block id a whole line opens, or undefined when it is not a delimiter; a bare `<<aside>>` opens `aside`. */
const opens = (line: string): string | undefined => {
  const m = /^[ \t]*<<aside>>(.*)$/.exec(line.replace(/\r?\n$/, ""))
  return m ? m[1]!.trim().split(/\s+/)[0] || "aside" : undefined
}
export type Piece = { id?: string; text: string }
/** Text in, pieces out: prose (no id) or a block's text (its id). The delimiter line never comes out; a line start that
 *  could still become one (`<<as`) is held until it resolves: at its newline, once it no longer can, or at `end`. */
export const splitter = () => {
  let id: string | undefined // the block being written; undefined: still the prose
  let held = "" // the current line's start while it may be a delimiter
  let start = true // at a line start
  return (chunk: string, end = false): Piece[] => {
    const out: Piece[] = []
    let free = ""
    const flush = () => {
      if (free) out.push(id === undefined ? { text: free } : { id, text: free })
      free = ""
    }
    const settle = () => {
      const o = opens(held)
      if (o === undefined) free += held
      else {
        flush()
        id = o
      }
      held = ""
    }
    for (const c of chunk) {
      if (!start) {
        free += c
        start = c === "\n"
        continue
      }
      held += c
      const t = held.replace(/^[ \t]*/, "")
      if (c === "\n") settle()
      else if (!DELIM.startsWith(t) && !t.startsWith(DELIM)) {
        free += held // it can no longer be a delimiter: the line is prose (or block text) to its end
        held = ""
        start = false
      }
    }
    if (end && held) settle()
    flush()
    return out
  }
}
/** The landed reply cut: the text before the first delimiter is the prose, one text part in the first text part's
 *  place; each block's text, trimmed, is the product under its id (the same id twice joins). No delimiter: the parts
 *  as given. */
export const split = (parts: readonly Part[]): { reply: readonly Part[]; blocks: Readonly<Record<string, string>> } => {
  const all = textOf(parts)
  const blocks: Record<string, string> = {}
  let prose = ""
  for (const p of splitter()(all, true))
    if (p.id === undefined) prose += p.text
    else blocks[p.id] = [blocks[p.id], p.text.trim()].filter(Boolean).join("\n\n")
  if (prose === all) return { reply: parts, blocks }
  let first = true
  const reply = parts.flatMap((p): Part[] =>
    p.type !== "text" ? [p] : first ? ((first = false), [{ ...p, text: prose.trimEnd() }]) : [],
  )
  return { reply, blocks }
}

export const deliveredIn = <B>(t: Turn<B>): Disclosure[] => [...t.read, ...t.fired]
export const deliveredOn = <B>(path: readonly Turn<B>[], extra: readonly Disclosure[] = []): Disclosure[] => [
  ...path.flatMap(deliveredIn),
  ...extra,
]
