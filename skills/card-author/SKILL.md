---
name: card-author
description: Writing, revising or remastering a card for the effect-tavern harness. Use whenever a task touches a card (packages/runtime/test/cards, a YAML card, a card's rules, lore, fiction, products) or asks how a card expresses something. Covers the Card schema and where each kind of content goes, the two-hat order (mechanism first, prose second), and the card check / view loop.
---

# Card author

Status (2026-10-25, issue #30): the code side below is drafted from the schema (`packages/runtime/src/card.ts`,
`fragment.ts`, `cond.ts`, `product.ts`, `lore.ts`) and reviewed by the owner. The semantic side (register, what a band
must leave open, how far to keep an original author's sentences) is a matter of taste and is decided with the owner;
until then that section lists the open questions and nothing else. Do not improvise rules there.

Vocabulary: `GLOSSARY.md` at the repo root. Use its words (stage, turn, slot, band, readout, lore layer, product, fold);
do not substitute synonyms (no "world book", "keyword trigger", "memory system", "preset", "character card").

## What a card is

A card is data, one schema (`Card` in card.ts), decoded by `decodeCard`. Until #29 lands a template card is a TS object
in `packages/runtime/test/cards/<id>.ts` registered in `index.ts`; after #29 it is one YAML file with prose in `|` block
scalars. The runtime derives everything from it: a card with no actions has no decide stage, no lore means no lookup,
no `director` means no direct stage.

Two coordinates place a card, not two kinds of card:

- **Who the player is in the fiction**: the frame slot `persona`. Present → participant mode (the player is a character,
  the model plays the counterpart; 心声 exists). Absent → author mode (the player directs, the model writes everyone).
- **Default input channel** `input`: `act` (the line enters the transcript) or `note` (direction to the narrator, this turn
  only). A world card with no protagonist (盐道, `yandao.ts`) is `input: "note"` and fills the `pov` slot itself.

The harness owns neutral defaults only: the `asks` wording, the writing switches compiled into `pov` / `verbosity`, the
default products (notes, options, inner). A card never explains the harness to the model, never asks for output
formats, never carries defensive imperatives (that is `guard`, `check`, `polish`); the harness never carries one card's
line.

## The turn, and who reads what

`lookup → (decide → settle)* → gate → direct → narrate → check → polish → record`, assembled in one place
(`src/request.ts`).

| Card field                   | Read by                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `frame`                      | every stage (the head of every document)                                           |
| `fiction`, transcript        | narrate only                                                                       |
| `lore`                       | lookup (enum of readable entries), gate / direct (windows), narrate (as told text) |
| `rules.actions`              | decide (the menu), settle (code)                                                   |
| `rules.readouts`, `products` | record, after the prose                                                            |
| `guard`                      | check only; never shown to the narrator                                            |
| `lexicon`                    | polish only (sentences the patterns hit are rewritten)                             |
| `greetings`                  | node 0; `do` settles before anything                                               |

The narrator never sees a number. State reaches it only as the fiction variants whose `when` holds.

## Where each thing goes

- **How the narrator writes, who it is** → `frame` fragments. `id` is a slot (`persona`, `pov`, `style`, `setting`, …);
  the player's same-named slot overrides or yields per the player's setting (`frame()` in fragment.ts). A fragment
  without `text` is a slot left for the player to fill. `pov` is compiled from the player's writing switches unless the
  card fills it. `role` defaults to system. Order is the author's; a `when` flip costs one cache miss, never a reorder.
- **A person, a cast, a world** → `fiction` fragments. `label` is the shown module name (card page); `when` makes a
  variant (a band). Bands of one field are read as alternatives: at most one should hold at a time (lint `band-gap`).
- **Openings** → `greetings: [{ text, do? }]`. `do` holds the effects that make this opening differ from the initial
  state (an IF line's route, a later date); its events reach turn 1's gate. Greeting text is the first sample of the
  voice: the model continues what it reads.
- **State** → `rules.fields`: `{ path, type: int | number | boolean | enum, min?, max?, initial, options? (enum),
  label?, group?, hidden? }`. Flat paths. Strings exist only inside an enum: free text is never state. `hidden` hides
  a switch from the player (an ending nobody should see coming); settlement reads it like any field.
- **Mechanical moves** → `rules.actions`: `{ id, text, when?, roll?, hit?, miss?, do? }`. `text` is what the model sees
  as the option; `when` gates availability (an unavailable action is not a decodable answer); `roll` is a number, a
  field `{ path }`, or `{ judge }` (the model gives a probability inside decide, the die is code and seed). Effects are
  `set`, `add` (clamped to min/max) and `event` (`{path}` interpolates post-effect state), nothing else.
- **A judgement about what the prose did** → `rules.readouts`: `{ id, text, when?, options: [{ id, text, do }] }`,
  asked in record after the prose; the chosen option's effects apply by code. Two rules from live play (GLOSSARY
  读数): options name visible deeds (接过信物、追问细节), never psychology (a reserved register keeps psychology
  implicit, the answer falls to the conservative option, the field never moves); and a band gated on a field must not
  describe the trajectory that field's readout measures (pei-cool before b52f7db5 did, and bond was flat five turns).
- **Who may move a field**: a field only actions write is mechanical, the prose cannot move it. A field the fiction
  may move needs a readout (lint `prose-cannot-move`, today card.ts:116).
- **Knowledge revealed gradually** → `lore: [{ id, layers, unlock, offer }]`. `layers[0]`'s first sentence is the
  **hook**: the entry's one line in the lookup index, written as the player would say it, not a keyword. `unlock` is the
  floor: one Cond per layer (`{ all: [] }` is always true; a single Cond is layer 1's); once a state on the path
  satisfied it, it stays unlocked. `offer` is the window: a Cond over state and this turn's events (`{ event }`) that
  opens the next layer for this turn; `lore.<id>.since` / `.shown` are readable counters for cooldowns and once-only
  chains. An opened entry delivers its unread lower layers too (#9). `{ any: [] }` as unlock = never in play.
- **Ending** → `rules.over` (a Cond, code-decided) and `rules.cap` (beats per turn).
- **Must-not** → `guard: string[]`. Checked after the prose, one correction rewrite on a miss. Never in the prompt: a
  prohibition is itself a prompt.
- **Slop** → `lexicon: [{ pattern, hint? }]`, `*` is a wildcard inside a sentence (`指节*白`). Polish rewrites only the
  hit sentences. The player has their own list first.
- **Memory and data from the scene** → `products`: patches over the defaults by id (`notes` on, `options` and `inner`
  off; the player's toggle wins) or new ones. `{ id, text, shape, fold?, feed?, recall?, when?, on? }`. Shapes:
  `text`, `list` (max), `record` (fixed keys, one nested list/table allowed), `table` (typed columns, `max`, `filter`
  Cond over the row). `fold`: `latest` | `append` | `{ key }` (newest row per key; list defaults to append, the rest to
  latest). `feed: true` sends the fold back (`Current:` line; notes go as `Known:` to record only). `recall` (true for a
  list, a column name for a table) puts the folded items in the lookup index like lore. Readouts move state; products
  hold memory. To make a table affect a condition, add a readout; do not open a product into state.
- **Turn title** → `heading`: a field path or `<product>.<key>` (a text key of a record product), read off the node.
- **Director** → `director: true` only when some lore has an `offer`; it decides MUST / MAY among open entries.
- **Card page copy** → `title`, `summary` (never reach the model), `version`, `source`.

Cond, the only logic an author has: `{ path, is }`, `{ path, op: lt | lte | gt | gte, value }`, `{ all }`, `{ any }`,
`{ not }`, `{ event }`. A path not declared in `fields` throws when the Cond is first evaluated (`unknown state
path`), not at decode; lint (#27) reports it statically.

## Two hats, in this order

**1. Architect** (no prose longer than a line). Place the card on its two coordinates. Declare fields with bounds and
initials. Decide for each field who moves it: actions (mechanical) or a readout (the prose may). Write actions and
readouts with their effects and events. Lay out lore: ids, how many layers, `unlock` per layer, `offer` on which events
or counters. Lay out fiction: ids, labels, `when` bands with one-line placeholders. Count greetings and write their
`do`. Patch or add products. Run `bun card check <card>` (#27, #28) until there is no error and every warning is one you
meant. Until the CLI lands: `decodeCard` the object and read the throws; `makeCard` prints the write-path warning.

**2. Novelist** (the mechanism is frozen). Fill `frame`, every fiction band, every lore layer, every greeting. Run
`card check` again for `field-in-prose` and `inline-product`. Run `card view` at the states that matter: each band
boundary (`--state bond=7` and `bond=8`), each greeting (`--greeting n`), and read the document the narrator actually
gets; the band and the readout that moves its field print side by side. The semantic rules below apply in this hat.

## What the schema and lint already check (do not hand-check)

Decode and load: enum needs options; fold key must name a table column; recall on a list is `true`, on a table a
column, never on text/record; a product needs text and shape. Settle time: an effect path that is not a field; a Cond
path that is not a field; a `judge` roll with no chance on the beat.
Lint (#27): `orphan-event`, `dead-field`, `prose-cannot-move`, `band-gap`, `unreachable-layer`, `hook-length`,
`field-in-prose`, `inline-product`.

## Samples in the repo

- `wuxia.ts` 竹林: participant mode, bands on `bond` with a readout, a three-layer lore entry (floor on bond, windows
  on a beat event and a readout event), director on, a feed record product (`scene`) and a keyed recall table
  (`people`), guard, `heading: "scene.place"`.
- `yandao.ts` 盐道: author mode, `input: "note"`, the card fills `pov`, a world instead of a person, one field moved by
  a readout, a greeting whose `do` opens a lore window on turn 1.
- `banxing.ts` 伴星: pure chat, read from a V3 export; `mes_example` kept as an unlabelled fiction fragment
  (示范（角色的声音）), which held the voice in live runs.
- `ri.ts` 理: an MVU card compiled from its source files into bands on one field, with hidden ending switches
  (`恋人`, `哥哥`).

## Semantic side: open, to decide with the owner

Questions, not rules. Nothing here is settled.

- Affordance: must every readout-driven band end with what the player can do this scene to move the field? Is the
  pei-cool text after b52f7db5 the sample, or is the rule narrower?
- Register: what is banned (README copy, telegraphic "词条：事实。" lines, defensive imperatives) and what is the
  positive sample a hat-2 agent reads before writing?
- Remastering an old card: keep the author's sentences where they are the art and only cut and move (card-reading.md
  §2.3), or rewrite freely once the person says so? Where is the default?
- Hooks: written as the player's own words for the thing. Sample set?
- Greetings: how many, how long, what an opening must and must not do (the openings 竹林 gained in b52f7db5 as a
  reference).
- Language of the card copy that reaches the model vs the card page copy.
