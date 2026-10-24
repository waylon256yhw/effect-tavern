// §14 / §19: layered, state-gated knowledge. Pure queries over (state, deliveries); no LLM calls.
//   layer 0      hidden: not in the index, not readable, never offered
//   layer 1..n   layers[i-1]; the first sentence of layers[0] is the index hook
//   current      max(code floor `unlock(s)`, deepest layer delivered on this path)
//                the floor is the caller's; the session supplies one that is monotone along the path (session.ts `gated`)
// Existence is the code floor's call; windows (`offer`) only deepen what is already visible, one layer at a time.
// `C` is whatever the window reads: player input (lore.ts), settled events (loop.ts), later a Cond over both.
export interface Disclosure {
  id: string
  layer: number
}
export interface Entry<S, C> {
  id: string
  layers: readonly string[]
  unlock?: (s: S) => number
  offer?: (s: S, ctx: C) => boolean
}
export const key = (d: Disclosure) => `${d.id}#${d.layer}`

export const makeLore = <S, C>(entries: readonly Entry<S, C>[]) => {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const deepest = (ds: readonly Disclosure[], id: string) =>
    Math.max(0, ...ds.filter((d) => d.id === id).map((d) => d.layer))
  const current = (e: Entry<S, C>, s: S, ds: readonly Disclosure[]) =>
    Math.min(e.layers.length, Math.max(e.unlock?.(s) ?? 0, deepest(ds, e.id)))
  const visible = (s: S, ds: readonly Disclosure[]) => entries.filter((e) => current(e, s, ds) >= 1)
  /** Layers up to current this path hasn't seen, shallowest first. */
  const unread = (e: Entry<S, C>, s: S, ds: readonly Disclosure[]): Disclosure[] => {
    const seen = new Set(ds.map(key))
    return Array.from({ length: current(e, s, ds) }, (_, i) => ({ id: e.id, layer: i + 1 })).filter(
      (d) => !seen.has(key(d)),
    )
  }
  return {
    entries,
    deepest,
    current,
    /** Hooks of visible entries. */
    index: (s: S, ds: readonly Disclosure[]) =>
      visible(s, ds).map((e) => ({ id: e.id, hook: e.layers[0].split(/(?<=[.。!?！？])\s*/)[0] })),
    /** Visible entries with a layer up to current this path hasn't seen: the enum the lookup stage picks from. Empty →
     *  no call. By unseen layers, not depth: a window fires current+1 over an unlocked layer nobody read, and that
     *  layer stays readable under it (by depth alone it was lost for good once a deeper one fired). */
    readable: (s: S, ds: readonly Disclosure[]) =>
      visible(s, ds)
        .filter((e) => unread(e, s, ds).length > 0)
        .map((e) => e.id),
    /** Layers up to current that this path hasn't seen yet; undefined when the entry isn't readable at all. */
    read: (s: S, ds: readonly Disclosure[], id: string): Disclosure[] | undefined => {
      const e = byId.get(id)
      return e && current(e, s, ds) > 0 ? unread(e, s, ds) : undefined
    },
    /** Next layer of each visible entry whose window is open; never deeper than one step. Feeds the brief as `may`. */
    offers: (s: S, ds: readonly Disclosure[], ctx: C) =>
      visible(s, ds)
        .filter((e) => e.offer?.(s, ctx) && current(e, s, ds) < e.layers.length)
        .map((e) => ({ id: e.id, layer: current(e, s, ds) + 1, text: e.layers[current(e, s, ds)] })),
    text: (d: Disclosure) => byId.get(d.id)!.layers[d.layer - 1],
    /** Derived per-entry state for `offer` to read as `lore.<id>.since` / `.shown`: turns since the entry last reached the
     *  narrator on this path (0 = this turn, Infinity = never) and how many turns it did. `perTurn` is the path's
     *  deliveries turn by turn, the current turn last. The ecosystem's sticky / cooldown / once-only event chains are
     *  conditions over these two numbers (docs/card-reading-2.md §8 item 4). */
    counters: (perTurn: readonly (readonly Disclosure[])[]) =>
      Object.fromEntries(
        entries.map((e) => {
          const turns = perTurn.flatMap((ds, i) => (ds.some((d) => d.id === e.id) ? [i] : []))
          return [e.id, { since: turns.length ? perTurn.length - 1 - turns.at(-1)! : Infinity, shown: turns.length }]
        }),
      ),
  }
}
export type Lore<S, C> = ReturnType<typeof makeLore<S, C>>
