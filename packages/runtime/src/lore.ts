// §14 / §19: layered, state-gated knowledge. Pure queries over (state, deliveries); no LLM calls.
//   layer 0      hidden: not in the index, not readable, never offered
//   layer 1..n   layers[i-1]; the first sentence of layers[0] is the index hook
//   current      max(code floor `unlock(s)`, deepest layer delivered on this path)
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
  return {
    entries,
    deepest,
    current,
    /** Hooks of visible entries. */
    index: (s: S, ds: readonly Disclosure[]) =>
      visible(s, ds).map((e) => ({ id: e.id, hook: e.layers[0].split(/(?<=\.)\s/)[0] })),
    /** Visible entries with a layer this path hasn't seen: the enum the lookup stage picks from. Empty → no call. */
    readable: (s: S, ds: readonly Disclosure[]) =>
      visible(s, ds)
        .filter((e) => current(e, s, ds) > deepest(ds, e.id))
        .map((e) => e.id),
    /** Layers up to current that this path hasn't seen yet; undefined when the entry isn't readable at all. */
    read: (s: S, ds: readonly Disclosure[], id: string): Disclosure[] | undefined => {
      const e = byId.get(id)
      const upTo = e ? current(e, s, ds) : 0
      if (upTo === 0) return undefined
      const seen = new Set(ds.map(key))
      return Array.from({ length: upTo }, (_, i) => ({ id, layer: i + 1 })).filter((d) => !seen.has(key(d)))
    },
    /** Next layer of each visible entry whose window is open; never deeper than one step. Feeds the brief as `may`. */
    offers: (s: S, ds: readonly Disclosure[], ctx: C) =>
      visible(s, ds)
        .filter((e) => e.offer?.(s, ctx) && current(e, s, ds) < e.layers.length)
        .map((e) => ({ id: e.id, layer: current(e, s, ds) + 1, text: e.layers[current(e, s, ds)] })),
    text: (d: Disclosure) => byId.get(d.id)!.layers[d.layer - 1],
  }
}
export type Lore<S, C> = ReturnType<typeof makeLore<S, C>>
