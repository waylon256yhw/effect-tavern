// §8 / §18: Fragment = text + position + condition. The head zone = player layer → card frame → fiction.
// Frame ids are slots; how a player's slot meets the card's same slot is the player's per-fragment setting.
import { Schema } from "effect"
import { Cond, holds, type State } from "./cond.ts"

export const Fragment = Schema.Struct({
  id: Schema.String, // in the frame, the id is the slot
  text: Schema.optionalKey(Schema.String), // absent = a slot the player may fill
  label: Schema.optionalKey(Schema.String), // a fiction module's shown name (the id when absent): the card page lists modules by it, never by their text
  role: Schema.optionalKey(Schema.Literals(["system", "user", "assistant"])),
  enabled: Schema.optionalKey(Schema.Boolean),
  when: Schema.optionalKey(Cond),
  mode: Schema.optionalKey(Schema.Literals(["override", "yield", "both"])), // a player row's: vs the lower ranks' same slot (layer.ts)
  // GLOSSARY §63: no depth, only head or tail. head (absent) = the frame slot; tail = the end of the narrate request,
  // after this turn's directives and before the hat's tail (request.ts); no other stage reads a tail fragment
  at: Schema.optionalKey(Schema.Literals(["head", "tail"])),
})
export type Fragment = typeof Fragment.Type
/** The frame's slots (GLOSSARY 槽位): the ids a player's layer meets a card's frame on. `persona`, `pov` and `verbosity`
 *  the harness itself fills or compiles; the rest are the names cards and players write. The list is open at the
 *  mechanism (layer.ts merges by id, whatever the id), closed here for lint: a frame fragment under another id is most
 *  often a person or a world put where every stage reads it (lint `unknown-frame-slot`, issue #83). */
export const SLOTS: readonly string[] = ["persona", "pov", "voice", "style", "setting", "language", "verbosity"]
export const decodeFragments = Schema.decodeUnknownSync(Schema.Array(Fragment))

/** What the model wrote, as parts: the prose, and reasoning carrying whatever the provider needs to take it back. A
 *  narrate block (`<<aside>> <id>`, src/journal.ts `split`) is a product on the turn, not a part: `prose(t)` and every
 *  stage reading prose never see it, and it never goes back to the model. */
export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; providerOptions?: Record<string, Record<string, unknown>> }
export interface Msg {
  role: "system" | "user" | "assistant"
  text: string
  /** A past assistant turn as parts; whether they go back to the model (reasoning included) is the connection's call. */
  parts?: readonly Part[]
}

/** An insertion at the caret, never sent: `text` goes before the caret, `after` behind it, a selection lands between
 *  them (the shape of SillyTavern's 输入助手: a template and where the cursor goes next). */
export interface Insert {
  text: string
  after?: string
}
/** A quick input with a meaning in play: a perception scope (心声), the note channel, a direction to the narrator. The
 *  ecosystem's quick replies as player-layer data; the harness ships defaults (layer.ts `harness`). */
export const Snippet = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
  after: Schema.optionalKey(Schema.String),
  hint: Schema.optionalKey(Schema.String), // one line under the name in the menu: what it does
  note: Schema.optionalKey(Schema.Boolean), // on pick the send goes to the narrator (the note channel)
})
export type Snippet = typeof Snippet.Type
/** A format key: a typing convenience with no meaning in play (brackets a phone keyboard lacks). Labelled by its glyph. */
export const Format = Schema.Struct({
  label: Schema.String,
  text: Schema.String,
  after: Schema.optionalKey(Schema.String),
})
export type Format = typeof Format.Type
// The writing switches: a bounded front over slots the player layer and a card already fill as free text. Each value
// compiles to one sentence the harness owns (fixed once, every player and dev script gets it); a free-text fragment on
// the same slot, from the player or the card, overrides the compiled one by the usual slot rules. Three faces, like Cond
// and Product: compiles to head text, draws as toggles, decodes from a sentence of the player's. `pov`, `echo` and
// `agency` are one slot (`pov`): a card that writes the player's place in the story itself (盐道: no player in the
// fiction) takes the whole group with it. `verbosity` is its own slot. Only switches with live evidence are here.
export const Writing = Schema.Struct({
  pov: Schema.optionalKey(Schema.Literals(["second", "third", "none"])), // the player in the prose: 你, by name, absent
  echo: Schema.optionalKey(Schema.Boolean), // restate the player's line before the reaction (转述), or start from the reaction
  agency: Schema.optionalKey(Schema.Literals(["strict", "free"])), // only what the player gave, or the narrator may continue them (co-writing)
  verbosity: Schema.optionalKey(Schema.Literals(["concise", "medium", "detailed"])),
  // not head text: the polish stage after check (polish.ts), off only when false; no lexicon, nothing to polish
  polish: Schema.optionalKey(Schema.Boolean),
})
export type Writing = typeof Writing.Type

// A hat: the protocol shell a connection wears so its model opens in continuation mode, a library row of the player's
// (`/hats`) that a Connection names by id. Every message is player data; the harness has none of its own. narrate (writes
// prose) wears narrate.head + narrate.tail; check, polish, record (read prose) wear review.head; lookup, decide, direct
// (read ledger lines and menus) wear nothing. A message is a head message's shape, role and text, so it wires like one.
const Said = Schema.Struct({ role: Schema.Literals(["system", "user", "assistant"]), text: Schema.String })
const Said_ = Schema.optionalKey(Schema.Array(Said))
export const Hat = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  narrate: Schema.optionalKey(Schema.Struct({ head: Said_, tail: Said_ })),
  review: Schema.optionalKey(Schema.Struct({ head: Said_ })),
})
export type Hat = typeof Hat.Type

/** Head messages: `enabled`/options and `when` evaluated, in zone then document order. Order is the author's; a
 * `when` flip costs one cache miss on a rare event, not a reordering of the document. */
export const head = (
  layers: readonly Fragment[],
  { state = {} as State, options = {} as Record<string, boolean> } = {},
): Msg[] =>
  layers
    .filter((f) => (options[f.id] ?? f.enabled ?? true) && (!f.when || holds(f.when, state)))
    .flatMap((f) => (f.text ? [{ role: f.role ?? "system", text: f.text }] : []))
