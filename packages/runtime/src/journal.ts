// §17: one node per turn = the player's input plus every block the system produced for it. Only LLM outputs and seeds
// are stored; events, state and deliveries are derived along the path. Siblings under one parent are swipes.
import type { Disclosure } from "./lore.ts"

export interface Input {
  text: string
  aside?: string
} // aside: this-turn-only instruction, never rendered for past turns
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
  beats: readonly B[] // decide + seed, settled by code on replay
  end: "end" | "over" | "cap"
  brief: Brief
  prose: string // non-authoritative
  fired: readonly Disclosure[] // reveals confirmed by check; count as delivered
  violated: readonly string[]
  notes: readonly string[]
}

export const makeJournal = <B>() => {
  const nodes = new Map<number, Turn<B>>()
  return {
    save: (t: Omit<Turn<B>, "id">): Turn<B> => {
      const node = { ...t, id: nodes.size }
      nodes.set(node.id, node)
      return node
    },
    chain: (id: number | null): Turn<B>[] => {
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

export const deliveredIn = <B>(t: Turn<B>): Disclosure[] => [...t.read, ...t.fired]
export const deliveredOn = <B>(path: readonly Turn<B>[], extra: readonly Disclosure[] = []): Disclosure[] => [
  ...path.flatMap(deliveredIn),
  ...extra,
]
