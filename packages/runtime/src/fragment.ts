// §8 / §18: Fragment = text + position + condition. The head zone = player layer → card frame → character.
// Frame ids are slots; how a player's slot meets the card's same slot is the player's per-fragment setting.
import { Schema } from "effect"
import { Cond, holds, type State } from "./cond.ts"

export const Fragment = Schema.Struct({
  id: Schema.String, // in the frame, the id is the slot
  text: Schema.optionalKey(Schema.String), // absent = pure anchor
  role: Schema.optionalKey(Schema.Literals(["system", "user", "assistant"])),
  at: Schema.optionalKey(
    Schema.Union([Schema.Struct({ before: Schema.String }), Schema.Struct({ after: Schema.String })]),
  ),
  enabled: Schema.optionalKey(Schema.Boolean),
  order: Schema.optionalKey(Schema.Number),
  when: Schema.optionalKey(Cond),
  mode: Schema.optionalKey(Schema.Literals(["override", "yield", "both"])), // player fragments only: vs the card's same slot
})
export type Fragment = typeof Fragment.Type
export type Mode = NonNullable<Fragment["mode"]>
export const decodeFragments = Schema.decodeUnknownSync(Schema.Array(Fragment))

export interface Msg {
  role: "system" | "user" | "assistant"
  text: string
}

export interface Player {
  global: readonly Fragment[]
  forCard: Record<string, readonly Fragment[]>
  defaults?: { global?: Mode; forCard?: Mode } // harness-level setting, also the player's
}
export interface FrameSource {
  id: string
  frame: readonly Fragment[]
}

/** Player zone then card frame, slot conflicts resolved by the player's `mode` (defaults: global yields, per-card overrides). */
export const frame = (player: Player, card: FrameSource): Fragment[] => {
  // Within the player's own layer, per-card replaces global on the same slot; the player wrote both.
  const mine = new Map<string, { f: Fragment; mode: Mode }>()
  for (const f of player.global) mine.set(f.id, { f, mode: f.mode ?? player.defaults?.global ?? "yield" })
  for (const f of player.forCard[card.id] ?? [])
    mine.set(f.id, { f, mode: f.mode ?? player.defaults?.forCard ?? "override" })
  const theirs = new Map(card.frame.map((f) => [f.id, f]))
  const playerZone = [...mine.values()].filter(({ f, mode }) => !theirs.has(f.id) || mode !== "yield").map((x) => x.f)
  const cardZone = card.frame.filter((f) => !mine.has(f.id) || mine.get(f.id)!.mode !== "override")
  return [...playerZone, ...cardZone]
}

/** Head messages: anchors resolved, `when` evaluated, every stable fragment before every state-dependent one. */
export const head = (
  layers: readonly Fragment[],
  { state = {} as State, options = {} as Record<string, boolean> } = {},
): Msg[] => {
  const anchors = new Set(layers.filter((f) => !f.at).map((f) => f.id))
  for (const f of layers) {
    const a = f.at && ("before" in f.at ? f.at.before : f.at.after)
    if (a && !anchors.has(a)) throw new Error(`${f.id}: unknown anchor ${a}`)
  }
  const active = layers.filter((f) => (options[f.id] ?? f.enabled ?? true) && (!f.when || holds(f.when, state)))
  const msg = (f: Fragment): Msg[] => (f.text ? [{ role: f.role ?? "system", text: f.text }] : [])
  const hang = (pick: (at: NonNullable<Fragment["at"]>) => boolean) =>
    active.filter((f) => f.at && pick(f.at)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const expand = (f: Fragment) => [
    ...hang((at) => "before" in at && at.before === f.id).flatMap(msg),
    ...msg(f),
    ...hang((at) => "after" in at && at.after === f.id).flatMap(msg),
  ]
  const inline = active.filter((f) => !f.at)
  const volatile = (f: Fragment) =>
    !!f.when || hang((at) => ("before" in at ? at.before : at.after) === f.id).some((h) => h.when)
  return [...inline.filter((f) => !volatile(f)), ...inline.filter(volatile)].flatMap(expand)
}
