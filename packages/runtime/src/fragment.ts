// §8 / §18: Fragment = text + position + condition. The head zone = player layer → card frame → fiction.
// Frame ids are slots; how a player's slot meets the card's same slot is the player's per-fragment setting.
import { Schema } from "effect"
import { Cond, holds, type State } from "./cond.ts"

export const Fragment = Schema.Struct({
  id: Schema.String, // in the frame, the id is the slot
  text: Schema.optionalKey(Schema.String), // absent = a slot the player may fill
  role: Schema.optionalKey(Schema.Literals(["system", "user", "assistant"])),
  enabled: Schema.optionalKey(Schema.Boolean),
  when: Schema.optionalKey(Cond),
  mode: Schema.optionalKey(Schema.Literals(["override", "yield", "both"])), // player fragments only: vs the card's same slot
})
export type Fragment = typeof Fragment.Type
export type Mode = NonNullable<Fragment["mode"]>
export const decodeFragments = Schema.decodeUnknownSync(Schema.Array(Fragment))

/** What the model wrote, as parts: the prose, and reasoning carrying whatever the provider needs to take it back. */
export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; providerOptions?: Record<string, Record<string, unknown>> }
export interface Msg {
  role: "system" | "user" | "assistant"
  text: string
  /** A past assistant turn as parts; whether they go back to the model (reasoning included) is the connection's call. */
  parts?: readonly Part[]
}

/** A quick input: a named text the client fills into the box (never sends), on the aside channel when `aside`. The
 *  ecosystem's quick replies and input helpers, as player-layer data; the harness ships defaults (session `snippets`). */
export interface Snippet {
  name: string
  text: string
  aside?: boolean
}
export interface Player {
  global: readonly Fragment[]
  forCard: Record<string, readonly Fragment[]>
  defaults?: { global?: Mode; forCard?: Mode } // harness-level setting, also the player's
  asks?: readonly Fragment[] // the harness's own wording, overridden by id (see session `asks`)
  products?: Readonly<Record<string, boolean>> // record products on/off by id: the player's toggle wins over card and defaults
  snippets?: readonly Snippet[] // the player's quick inputs, before the harness defaults
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

/** Head messages: `enabled`/options and `when` evaluated, in zone then document order. Order is the author's; a
 * `when` flip costs one cache miss on a rare event, not a reordering of the document. */
export const head = (
  layers: readonly Fragment[],
  { state = {} as State, options = {} as Record<string, boolean> } = {},
): Msg[] =>
  layers
    .filter((f) => (options[f.id] ?? f.enabled ?? true) && (!f.when || holds(f.when, state)))
    .flatMap((f) => (f.text ? [{ role: f.role ?? "system", text: f.text }] : []))
