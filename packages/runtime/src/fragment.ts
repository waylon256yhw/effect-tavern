// §8 / §18: Fragment = text + position + condition. The head zone = player layer → card frame → fiction.
// Frame ids are slots; how a player's slot meets the card's same slot is the player's per-fragment setting.
import { Schema, Struct } from "effect"
import { Cond, holds, type State } from "./cond.ts"
import { Names } from "./names.ts"
import { Entry } from "./polish.ts"

export const Fragment = Schema.Struct({
  id: Schema.String, // in the frame, the id is the slot
  text: Schema.optionalKey(Schema.String), // absent = a slot the player may fill
  label: Schema.optionalKey(Schema.String), // a fiction module's shown name (the id when absent): the card page lists modules by it, never by their text
  role: Schema.optionalKey(Schema.Literals(["system", "user", "assistant"])),
  enabled: Schema.optionalKey(Schema.Boolean),
  when: Schema.optionalKey(Cond),
  mode: Schema.optionalKey(Schema.Literals(["override", "yield", "both"])), // player fragments only: vs the card's same slot
  // GLOSSARY §63: no depth, only head or tail. head (absent) = the frame slot; tail = the end of the narrate request,
  // after this turn's directives and before the hat's tail (request.ts); no other stage reads a tail fragment
  at: Schema.optionalKey(Schema.Literals(["head", "tail"])),
})
export type Fragment = typeof Fragment.Type
export type Mode = NonNullable<Fragment["mode"]>
/** The frame's slots (GLOSSARY 槽位): the ids a player's layer meets a card's frame on. `persona`, `pov` and `verbosity`
 *  the harness itself fills or compiles; the rest are the names cards and players write. The list is open at the
 *  mechanism (`frame` merges by id, whatever the id), closed here for lint: a frame fragment under another id is most
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
 *  ecosystem's quick replies as player-layer data; the harness ships defaults (session `snippets`). */
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
  lexicon: Schema.optionalKey(Schema.Array(Entry)), // the player's slop patterns, before the card's own
})
export type Writing = typeof Writing.Type
const POV = {
  second: "用第二人称「你」写玩家。",
  third: "用玩家角色的名字、以第三人称写玩家。",
  none: "故事里没有玩家角色；输入是给叙述者的指示，不是任何人物的话，不要把它写进故事。",
}
const ECHO = {
  true: "开头可先用一句转述玩家本轮的言行，再写对方的反应。",
  false: "不要转述或扩写玩家本轮已输入的话，直接从对方或周遭的反应写起。",
}
const AGENCY = {
  strict: "只承接玩家已给出的言行，不要替玩家扩写未说出口的话、未声明的动作或下一步决定。",
  free: "可以替玩家续写言行与决定，像合写一部小说那样推进。",
}
const VERBOSITY = {
  concise: "每轮篇幅简短，一两段，点到即止。",
  medium: "每轮三四段，写到对方的反应落定为止。",
  detailed: "每轮篇幅从容，把动作、神态与周遭风物写足。",
}
/** The sentence each switch value compiles to, by key: what a client shows as the value's title (the Writing page). */
export const SENTENCES: Record<keyof Omit<Writing, "polish" | "lexicon">, Readonly<Record<string, string>>> = {
  pov: POV,
  echo: ECHO,
  agency: AGENCY,
  verbosity: VERBOSITY,
}
/** The switches as slot fragments: `pov` (pov, echo, agency; the last two drop when there is no player in the fiction) and `verbosity`. */
export const writing = (w: Writing = {}): Fragment[] => {
  const pov = [
    w.pov && POV[w.pov],
    w.pov !== "none" && w.echo !== undefined && ECHO[`${w.echo}`],
    w.pov !== "none" && w.agency && AGENCY[w.agency],
  ].filter((x): x is string => typeof x === "string")
  return [
    ...(pov.length ? [{ id: "pov", text: pov.join("") }] : []),
    ...(w.verbosity ? [{ id: "verbosity", text: VERBOSITY[w.verbosity] }] : []),
  ]
}

// The player layer as data: what the library stores and `PUT /player` decodes at the trust boundary.
const ModeSchema = Schema.Literals(["override", "yield", "both"])
// A 小剧场 the player declares, on their own layer or in a pack (docs/packs-brief.md §七): a restricted patch over the
// products by id, or a new one the narrator writes as plain text. `product.ts` `resolve` compiles it and holds the lock.
export const Theater = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String), // none = the patched product's question; a new id without one is dropped
  on: Schema.optionalKey(Schema.Boolean), // the default once mounted; `Player.products[id]` still has the last word
})
export type Theater = typeof Theater.Type
export const Player = Schema.Struct({
  writing: Schema.optionalKey(Writing), // compiled into the global layer first: a global fragment on the same slot overrides it
  global: Schema.Array(Fragment),
  forCard: Schema.Record(Schema.String, Schema.Array(Fragment)),
  persona: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)), // card id → the persona (a library id) the player is on that card; none = the card's own
  packs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))), // card id → the packs (library ids) mounted on that card, in mount order
  names: Schema.optionalKey(Schema.Record(Schema.String, Names)), // card id → the player's 代称 on that card, over the packs' and the card's
  tags: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))), // card id → the player's filing words on that card (#133); the harness never reads, generates or translates them
  defaults: Schema.optionalKey(
    Schema.Struct({ global: Schema.optionalKey(ModeSchema), forCard: Schema.optionalKey(ModeSchema) }),
  ), // harness-level setting, also the player's
  asks: Schema.optionalKey(Schema.Array(Fragment)), // the harness's own wording, overridden by id (see session `asks`)
  products: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)), // record products on/off by id: the player's toggle wins over card and defaults
  theaters: Schema.optionalKey(Schema.Array(Theater)), // the player's own 小剧场, on every card, after the mounted packs'
  snippets: Schema.optionalKey(Schema.Array(Snippet)), // the player's quick inputs, before the harness defaults
  format: Schema.optionalKey(Schema.Array(Format)), // the player's format keys, before the harness defaults
})
export type Player = typeof Player.Type
export const decodePlayer = Schema.decodeUnknownSync(Player)

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
// A pack (GLOSSARY enhancer): a named set of player-layer things, a library row of the player's (`/packs`) that
// `Player.packs` mounts per card. The opposite of a hat: merged by id, each item on its own, no role and no order, so it
// never touches the request's shape. It never touches the card's Cond or state either: no `when` on a fragment, an entry
// is one layer with no unlock or window. Decoding drops `when` and `role`, so a pack cannot carry them.
export const PackEntry = Schema.Struct({ id: Schema.String, text: Schema.String }) // one layer; its first sentence is the hook (lore.ts `hook`)
export type PackEntry = typeof PackEntry.Type
export const Pack = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  fragments: Schema.optionalKey(Schema.Array(Fragment.mapFields(Struct.omit(["when", "role"])))), // the id is the slot, `at` head or tail
  entries: Schema.optionalKey(Schema.Array(PackEntry)),
  lexicon: Schema.optionalKey(Schema.Array(Entry)),
  theaters: Schema.optionalKey(Schema.Array(Theater)),
  snippets: Schema.optionalKey(Schema.Array(Snippet)),
  names: Schema.optionalKey(Names), // defaults for holes (GLOSSARY 代称): over the card's, under the player's
})
export type Pack = typeof Pack.Type
/** The packs mounted on a card, in mount order; an id the library no longer has is skipped. */
export const mounted = (player: Player, card: string, library: readonly Pack[]): Pack[] =>
  [...new Set(player.packs?.[card])].flatMap((id) => library.find((p) => p.id === id) ?? [])
export interface FrameSource {
  id: string
  frame: readonly Fragment[]
}

/** Player zone then card frame, slot conflicts resolved by the player's `mode` (defaults: global yields, per-card
 *  overrides; a mounted pack is this card's decision, so it defaults like per-card). */
export const frame = (player: Player, card: FrameSource, packs: readonly Pack[] = []): Fragment[] => {
  // Within the player's own layer, later replaces earlier on the same slot: global, the packs in mount order, per-card.
  // A pack's item switched off is not there: it blanks neither the global slot under it nor the card's.
  const mine = new Map<string, { f: Fragment; mode: Mode }>()
  for (const f of [...writing(player.writing), ...player.global])
    mine.set(f.id, { f, mode: f.mode ?? player.defaults?.global ?? "yield" })
  for (const f of packs.flatMap((p) => p.fragments ?? []))
    if (f.enabled !== false) mine.set(f.id, { f, mode: f.mode ?? player.defaults?.forCard ?? "override" })
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
