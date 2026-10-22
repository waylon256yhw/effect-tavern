// §17: one node per turn = the player's input plus every block the system produced for it. Only LLM outputs and seeds
// are stored; events, state and deliveries are derived along the path. Siblings under one parent are swipes.
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
  products: Readonly<Record<string, unknown>> // record's answers by product id, shaped by the card (src/product.ts); `notes` is one
}
/** The notes product: the list of facts this turn established, the compression source. */
export const notesOf = <B>(t: Turn<B>): readonly string[] => (t.products.notes as readonly string[] | undefined) ?? []

/** Where a journal's nodes outlive the process: read once at start, every save and amend writes the whole list back. */
export interface Store<B> {
  read: () => readonly Turn<B>[]
  write: (nodes: readonly Turn<B>[]) => void
}
export const makeJournal = <B>(store?: Store<B>) => {
  const nodes = new Map<number, Turn<B>>((store?.read() ?? []).map((t) => [t.id, t]))
  const keep = (t: Turn<B>): Turn<B> => {
    nodes.set(t.id, t)
    store?.write([...nodes.values()])
    return t
  }
  return {
    save: (t: Omit<Turn<B>, "id">): Turn<B> => {
      if (t.parent !== null && !nodes.has(t.parent)) throw new Error(`no node ${t.parent}`) // a cycle otherwise
      return keep({ ...t, id: nodes.size })
    },
    get: (id: number): Turn<B> => {
      const t = nodes.get(id)
      if (!t) throw new Error(`no node ${id}`)
      return t
    },
    /** A player action on a node (demand, pin, set): the node is replaced, its id and place in the tree kept. */
    amend: (id: number, patch: Partial<Omit<Turn<B>, "id" | "parent">>): Turn<B> =>
      keep({ ...nodes.get(id)!, ...patch }),
    chain: (id: number | null): Turn<B>[] => {
      if (id !== null && !nodes.has(id)) throw new Error(`no node ${id}`) // a missing parent is the caller's bug, not a root
      const out: Turn<B>[] = []
      for (let t = id === null ? undefined : nodes.get(id); t; t = t.parent === null ? undefined : nodes.get(t.parent))
        out.unshift(t)
      return out
    },
    values: () => nodes.values(),
    get size() {
      return nodes.size
    },
  }
}
export type Journal<B> = ReturnType<typeof makeJournal<B>>

export const textOf = (parts: readonly Part[]): string =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("")
export const prose = <B>(t: Turn<B>): string => textOf(t.reply)

export const deliveredIn = <B>(t: Turn<B>): Disclosure[] => [...t.read, ...t.fired]
export const deliveredOn = <B>(path: readonly Turn<B>[], extra: readonly Disclosure[] = []): Disclosure[] => [
  ...path.flatMap(deliveredIn),
  ...extra,
]
