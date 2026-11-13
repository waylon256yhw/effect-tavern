import { expand, fill, type Names } from "./names.ts"
import { Schema } from "effect"

export const ContextPolicy = Schema.Struct({
  access: Schema.optionalKey(Schema.Struct({ model: Schema.Boolean, player: Schema.Boolean })),
  activation: Schema.optionalKey(Schema.Literals(["always", "on_demand"])),
  residency: Schema.optionalKey(Schema.Literals(["permanent", "window", "turn"])),
})
export type ContextPolicy = typeof ContextPolicy.Type

/** Reject the removed policy before decoding can strip unknown fields and change its meaning. */
export const checkContextPolicies = (entries: unknown): void => {
  if (Array.isArray(entries))
    for (const e of entries)
      if (e && typeof e === "object" && "invoke" in e)
        throw new Error("entry.invoke is no longer supported; declare access, activation and residency")
}

// §14 / §19: layered, state-gated knowledge. Pure queries over (state, deliveries); no LLM calls.
//   layer 0      hidden: not in the index, not readable, never offered
//   layer 1..n   layers[i-1]; the first sentence of layers[0] is the index hook
//   current      max(code floor `unlock(s)`, deepest layer delivered on this path)
//                the floor is the caller's; the session supplies one that is monotone along the path (derived.ts `gated`)
// Existence is the code floor's call; windows (`offer`) only deepen what is already visible, one layer at a time.
// `C` is whatever the window reads: player input (lore.ts), settled events (loop.ts), later a Cond over both.
export interface Disclosure {
  id: string
  layer: number
}
export interface Entry<S, C> extends ContextPolicy {
  source?: "card" | "pack"
  id: string
  layers: readonly string[]
  sections?: readonly { id: string; text: string }[] // lookup's on-demand appendices (context.ts `sectionResources`)
  unlock?: (s: S) => number
  offer?: (s: S, ctx: C) => boolean
}
export const key = (d: Disclosure) => `${d.id}#${d.layer}`
/** An entry's line in the lookup index: the first sentence of its first layer. */
export const hook = (layer: string) => layer.split(/(?<=[.。!?！？])\s*/)[0]!

export const makeLore = <S, C>(entries: readonly Entry<S, C>[]) => {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const deepest = (told: readonly Disclosure[], id: string) =>
    Math.max(0, ...told.filter((d) => d.id === id).map((d) => d.layer))
  const current = (e: Entry<S, C>, s: S, told: readonly Disclosure[]) =>
    Math.min(e.layers.length, Math.max(e.unlock?.(s) ?? 0, deepest(told, e.id)))
  const visible = (s: S, told: readonly Disclosure[]) => entries.filter((e) => current(e, s, told) >= 1)
  /** Layers up to current the window does not hold, shallowest first. */
  const unread = (e: Entry<S, C>, s: S, told: readonly Disclosure[], held: readonly Disclosure[]): Disclosure[] => {
    const seen = new Set(held.map(key))
    return Array.from({ length: current(e, s, told) }, (_, i) => ({ id: e.id, layer: i + 1 })).filter(
      (d) => !seen.has(key(d)),
    )
  }
  return {
    entries,
    deepest,
    current,
    /** Hooks of visible entries. */
    index: (s: S, told: readonly Disclosure[]) => visible(s, told).map((e) => ({ id: e.id, hook: hook(e.layers[0]!) })),
    /** Visible entries with a layer up to current the window does not hold: the enum the lookup stage picks from. Empty →
     *  no call. By unseen layers, not depth: a window fires current+1 over an unlocked layer nobody read, and that
     *  layer stays readable under it (by depth alone it was lost for good once a deeper one fired). */
    readable: (s: S, told: readonly Disclosure[], held: readonly Disclosure[]) =>
      visible(s, told)
        .filter((e) => unread(e, s, told, held).length > 0)
        .map((e) => e.id),
    /** Layers up to current that the window does not hold yet; undefined when the entry isn't readable at all. */
    read: (s: S, told: readonly Disclosure[], held: readonly Disclosure[], id: string): Disclosure[] | undefined => {
      const e = byId.get(id)
      return e && current(e, s, told) > 0 ? unread(e, s, told, held) : undefined
    },
    /** Next layer of each visible entry whose window is open; never deeper than one step. Feeds the brief as `may`. */
    offers: (s: S, told: readonly Disclosure[], ctx: C) =>
      visible(s, told)
        .filter((e) => (e.access?.model ?? true) && e.offer?.(s, ctx) && current(e, s, told) < e.layers.length)
        .map((e) => ({ id: e.id, layer: current(e, s, told) + 1, text: e.layers[current(e, s, told)] })),
    /** Current authored layer text. History and reword read journal snapshots, never this live lookup. */
    text: (d: Disclosure) => byId.get(d.id)?.layers[d.layer - 1] ?? "",
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

/** The card's entries with its names filled in every layer and section; a hole nothing fills stays as written (names.ts). */
export const namedLore = <T extends { layers: readonly string[]; sections?: readonly { id: string; text: string }[] }>(
  entries: readonly T[],
  names: Names,
): T[] =>
  entries.map((e) => ({
    ...e,
    layers: e.layers.map((text) => expand(text, names, "card")!),
    ...(e.sections && { sections: fill(e.sections, names, "card") }),
  }))
