// The player layer as one module (docs/packs-brief.md §九, GLOSSARY 玩家层): one kind of row, one author order, one pure
// `resolve`, a result that says where each item came from. Every author writes a `Layer`: the harness's overlay (the
// player's global row), each pack, and the player on one card (`Local`); a card is projected into a row here and never
// stored as one.
//
// THE AUTHOR ORDER, stated here and nowhere else: harness (the code's defaults, the overlay over them by id) → card →
// the packs in `local.mounts` order → local → the persona (its text the `persona` fragment at the end of the local row,
// its name last into `names.user`). The later wins by id, for every kind. The one exception is a fragment's
// `mode: "yield"`: when a lower rank has filled the slot it does not stand. An overlay's fragment sits below the card, so
// its `mode` is read against the card, and absent it yields; `override` beats the card's slot. A compiled switch always
// yields to the card and to free text at its own or a higher rank; free text that itself says `yield` defers to a lower
// rank's compiled switch like to any filled slot. Switches themselves merge by key down the ranks, so the local row's
// `pov` beats the overlay's and one slot compiles from the merge.
//
// The locks are all here and never throw for a player's row (a throw would kill a card at session open for what a pack
// happens to declare): what they refuse lands in `dropped`, for a client to draw. Only the card's own bad product throws.
import { ContextPolicy, checkContextPolicies } from "./lore.ts"
import { Schema } from "effect"
import type { Card } from "./card.ts"
import { Format, Fragment, Snippet, Writing } from "./fragment.ts"
import { expand, fill, nameOk, Names, unfilled } from "./names.ts"
import { Entry as LexiconEntry } from "./polish.ts"
import { decodeProducts, ProductPatch, validate, type Product } from "./product.ts"

export const Ask = Schema.Struct({ id: Schema.String, text: Schema.String })
export type Ask = typeof Ask.Type
export const PackEntry = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  ...ContextPolicy.fields,
}) // one layer; its first sentence is the hook (lore.ts `hook`)
export type PackEntry = typeof PackEntry.Type
export const Layer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  fragments: Schema.optionalKey(Schema.Array(Fragment)), // the id is a slot or its own, `at` head or tail, `mode` vs the lower ranks
  switches: Schema.optionalKey(Writing), // compiled to `pov` / `verbosity` before this row's own fragments, yielding
  asks: Schema.optionalKey(Schema.Array(Ask)), // lookup, direct, decide.*, record.*, narrate.*, polish, input.thought; switch.<key>.<value>; product.<id> is a text patch
  products: Schema.optionalKey(Schema.Array(ProductPatch)), // whole on the code's defaults and the card; on a player's row label, text and on
  entries: Schema.optionalKey(Schema.Array(PackEntry)), // indexed as `<row>/<entry>`: one layer, no Cond
  lexicon: Schema.optionalKey(Schema.Array(LexiconEntry)),
  snippets: Schema.optionalKey(Schema.Array(Snippet)),
  format: Schema.optionalKey(Schema.Array(Format)),
  names: Schema.optionalKey(Names),
})
export type Layer = typeof Layer.Type
/** This player on this card: one row a card. `persona` is the default a new story takes; a story's own pick is its row's. */
export const Local = Schema.Struct({
  ...Layer.fields,
  card: Schema.String,
  mounts: Schema.optionalKey(Schema.Array(Schema.String)), // the packs on this card, in mount order
  persona: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)), // the player's filing words (#133); the harness never reads, generates or translates them
})
export type Local = typeof Local.Type

/** A row as a player may store it: no Cond and no role on a fragment, a product patch only label, text and on. */
export const locked = <R extends Layer>(r: R): R => ({
  ...r,
  ...(r.fragments && { fragments: r.fragments.map(({ when: _w, role: _r, ...f }) => f) }),
  ...(r.products && {
    products: r.products.map(({ id, label, text, on }) => ({
      id,
      ...(label !== undefined && { label }),
      ...(text !== undefined && { text }),
      ...(on !== undefined && { on }),
    })),
  }),
})
const decodeRow = Schema.decodeUnknownSync(Layer)
const decodeLocalRow = Schema.decodeUnknownSync(Local)
/** The boundary's decoders: every stored row goes through the lock as it comes in. */
const checkEntries = (u: unknown) => {
  if (u && typeof u === "object" && "entries" in u) checkContextPolicies(u.entries)
}
export const decodeLayer = (u: unknown): Layer => {
  checkEntries(u)
  return locked(decodeRow(u))
}
export const decodeLocal = (u: unknown): Local => {
  checkEntries(u)
  return locked(decodeLocalRow(u))
}

// ───────── The harness's own row ─────────
// Every instruction the loop says to the model, with ids, in the open. Data lines (State:, Actions:, Open:, Known:,
// Questions:) are format and stay in code (request.ts); these are the prose around them. Check carries no prose: the
// schema is the question. Lookup carries one line, since an index and an array read as "fill it": the first Haiku
// session picked one entry a turn until the index was empty, the innkeeper on a line that spoke to the swordsman. Direct
// carries one line too: `tone` is a free string, and without its genre named the first 理 run wrote a sentence of story
// into it, a priest guessed out of the setting, which then opened the narrator's draft as `Tone:` (#90).
const words: readonly Ask[] = [
  {
    id: "lookup",
    text: "Find only the context needed for this turn. Use search_context with Chinese or English terms, then read_context with returned resource IDs. Follow references in the returned text when needed. Resident snapshots and Current are already supplied. Stop with a short text response once sufficient; do not narrate or invent facts.",
  },
  {
    id: "direct",
    text: `Put in "must" only the open entries this scene cannot make sense without; the rest stay in "may", and both are empty when none fits now. "tone" is one line to the narrator, not to the player: the mood, the pace, or where this scene should land, as a phrase or a short sentence. It is a direction, never a sentence of the story: it names no character and writes no one's words, actions or expression.`,
  },
  {
    id: "decide.first",
    text: `Which card action does the player's input take first? "end" if it takes none of the listed actions. Set "again" to true only if the input's own words ask for more than one beat ("until he falls", "twice", "then …").`,
  },
  {
    id: "decide.again",
    text: `The input asked to keep going. Given the outcomes so far, pick the next action, or "end" when the input's goal is met, the input said to stop under this outcome, or nothing sensible is left.`,
  },
  // The readouts' rule of evidence, once, before the Questions line. Without it the first ri run judged the confession
  // refused on the turn it was made: the prose ended on the question, the player had not answered, and the model took
  // the one option it could not rule out by the letter (#83). A card's option texts still have to cover that turn.
  {
    id: "record.tools",
    text: "Use the native tools only for facts established by this scene. Read current values before updating. Insert creates an entity with a host-generated ID; patch changes defined fields; remove deletes an entity. Omit unchanged data. Finish by calling finish_record with the required answers, even if no world data changed.",
  },
  {
    id: "record.readout",
    text: "Answer each question from what this scene settled on the page, not from where it is heading: when a character has only raised the matter and the player has yet to answer, or the scene does not bear on the question, pick the option that says nothing happened or nothing changed.",
  },
  { id: "narrate.correction", text: "Previous draft broke:" },
  // The narrate products' one instruction, before their `<id>: <question>` lines; sent only when one is on.
  {
    id: "narrate.blocks",
    text: "After the prose, write each of these as its own block: a line `<<aside>> <id>` with the id below, then the block's text. One block per id, in any order, never inside the prose.",
  },
  // A narrate product demanded on a node: the scene is already the last reply, so the call writes the one block alone.
  { id: "narrate.demand", text: "Write no prose: answer with only the block asked for below, about the last scene." },
  {
    id: "polish",
    text: "Each sentence marked <target> uses wording the reader has seen too often: the words in its hits, and what its hint below names. Rewrite each so it no longer does, keeping its meaning, person, register, length and its seams with the sentences around it. Return a sentence unchanged if it already reads naturally. Answer each target by its id with the sentence alone, no marks.",
  },
  {
    id: "input.thought",
    text: "Text between ⦅ and ⦆ in the player's input is what their character thinks: not said, not done, no one in the story perceives it.",
  },
]
// The sentence each writing switch value compiles to, by ask id `switch.<key>.<value>`; a client shows it as the value's
// title. An overlay edit of one changes what compiles.
const sentences: readonly Ask[] = [
  { id: "switch.pov.second", text: "用第二人称「你」写玩家。" },
  { id: "switch.pov.third", text: "用玩家角色的名字、以第三人称写玩家。" },
  { id: "switch.pov.none", text: "故事里没有玩家角色；输入是给叙述者的指示，不是任何人物的话，不要把它写进故事。" },
  { id: "switch.echo.true", text: "开头可先用一句转述玩家本轮的言行，再写对方的反应。" },
  { id: "switch.echo.false", text: "不要转述或扩写玩家本轮已输入的话，直接从对方或周遭的反应写起。" },
  {
    id: "switch.agency.strict",
    text: "只承接玩家已给出的言行，不要替玩家扩写未说出口的话、未声明的动作或下一步决定。",
  },
  { id: "switch.agency.free", text: "可以替玩家续写言行与决定，像合写一部小说那样推进。" },
  { id: "switch.verbosity.concise", text: "每轮篇幅简短，一两段，点到即止。" },
  { id: "switch.verbosity.medium", text: "每轮三四段，写到对方的反应落定为止。" },
  { id: "switch.verbosity.detailed", text: "每轮篇幅从容，把动作、神态与周遭风物写足。" },
]
// The default quick inputs: the ecosystem's quick-reply lists as data. Each has a meaning in play: the thought mark (a
// perception scope the `input.thought` ask explains), the note channel, or a direction to the narrator. Inserted at the
// caret, never sent; an empty note snippet only switches the channel.
const snippets: readonly Snippet[] = [
  { name: "心声", text: "⦅", after: "⦆", hint: "角色心里的话，不说出口" },
  { name: "场外", text: "", hint: "给叙事者的话，不计入正文", note: true },
  { name: "继续", text: "继续。", hint: "顺着写下去", note: true },
  { name: "推进剧情", text: "推进剧情到下一个场景。", hint: "引入新事件，或切到下一幕", note: true },
  { name: "时间流逝", text: "时间流逝，跳到下一件有事发生的时刻。", hint: "略过平淡，直达下一件事", note: true },
  { name: "详细描写", text: "把这一段写得更细。", hint: "放慢镜头，写细这一段", note: true },
]
// The default format keys: typing conveniences with no meaning in play, the ecosystem's 输入助手 as data. A key is its
// glyph; the text is a template with the caret between `text` and `after`.
const format: readonly Format[] = [
  { label: "「」", text: "「", after: "」" },
  { label: "『』", text: "『", after: "』" },
  { label: "“”", text: "“", after: "”" },
  { label: "（）", text: "（", after: "）" },
  { label: "《》", text: "《", after: "》" },
]
// The default products (src/product.ts). `notes` is the compression source and the only one on by default. The options
// question follows the card's input channel, because an option goes into the box as the player's next input: on an act
// card it is their own line (the first Haiku run wrote "玩家……" in the third person, which put that sentence in the
// player's mouth), on a note card a direction.
const products = (input: "act" | "note"): readonly Product[] =>
  decodeProducts([
    {
      id: "notes",
      role: "chronicle",
      label: "事件摘要",
      // One text, not a list: a list reads as "fill it", and on a pure-chat card (伴星, Opus) it came back as six or
      // seven items a turn, the prose paraphrased paragraph by paragraph, one item split in three on a quoted "我懂"
      // (a list's grammar admits that; a string's does not). The three ecosystem summaries read for #82 all make a
      // turn's summary one unit (docs/summary-reading.md).
      text: "Notes are the record of this scene, one or two plain sentences in the third person: what changed or was settled (what was done, decided, promised, refused or learned), or, where the scene was talk, what was raised or confided and how the other side met it. Keep only what later scenes will stand on; merge the rest or leave it out, and never summarize the prose paragraph by paragraph. Name characters by name, and refer to an unnamed player character as 玩家 (never 你 or 我). Never repeat Known, never record scenery or a gesture nothing later turns on, never judge feelings, never comment on the writing. For a pure transition where nothing happened or was settled, an empty string is allowed.",
      shape: { kind: "text" },
      fold: "append",
      feed: true,
    },
    {
      id: "options",
      role: "theater",
      label: "行动选项",
      text:
        input === "note"
          ? "Four directions the player could give the narrator for what happens next, each one line, distinct in kind."
          : "Four inputs the player might send next, each one short line as the player would type it: a direct line in quotes, a brief first-person action (我……), or both together. When the player speaks, write the exact words in quotes—never summarize speech indirectly (never 我说…… / 我问他……), and never use 你. Distinct in kind.",
      shape: { kind: "list", max: 4 },
      on: false,
    },
    {
      id: "inner",
      role: "theater",
      label: "人物心声",
      text: "What the character thought this scene but did not say, one short paragraph.",
      shape: { kind: "text" },
      stage: "narrate", // the narrator's own voice, streamed, no extra call
      on: false,
    },
  ])
/** The code's defaults as a row: every ask (the switch sentences among them), notes / options / inner, the quick inputs,
 *  the format keys. A question the code asks has no hole, so an ask always has a text to fall back on. */
export const harness = (input: "act" | "note"): Layer => ({
  id: "harness",
  name: "内置",
  asks: [...words, ...sentences],
  products: products(input),
  snippets,
  format,
})

const canon = (v: unknown) =>
  JSON.stringify(v && typeof v === "object" ? Object.entries(v).sort(([a], [b]) => a.localeCompare(b)) : v)
const same = (a: unknown, b: unknown) => canon(a) === canon(b)
const over = <T>(under: readonly T[] = [], top: readonly T[] = [], key: (x: T) => string): T[] => {
  const m = new Map(under.map((x) => [key(x), x]))
  for (const x of top) m.set(key(x), { ...m.get(key(x)), ...x })
  return [...m.values()]
}
/** The harness row a client edits (`GET /packs`): the code's defaults with the overlay over them by id. */
export const overlaid = (input: "act" | "note", o?: Layer): Layer => {
  const h = harness(input)
  return {
    ...o,
    ...h,
    asks: over(h.asks, o?.asks, (x) => x.id),
    products: over(h.products, o?.products, (x) => x.id),
    snippets: over(h.snippets, o?.snippets, (x) => x.name),
    format: over(h.format, o?.format, (x) => x.label),
  }
}
/** What `PUT /packs/harness` stores: only what differs from the code's defaults; an item left out is back to its default. */
export const overlayOf = (input: "act" | "note", row: Layer): Layer => {
  const h = harness(input)
  const asks = (row.asks ?? []).filter(
    (x) =>
      !same(
        x,
        h.asks?.find((d) => d.id === x.id),
      ),
  )
  const products = (row.products ?? []).flatMap((p) => {
    const was = h.products?.find((d) => d.id === p.id) as Record<string, unknown> | undefined
    if (!was) return [p]
    const changed = Object.entries(p).filter(([k, v]) => k !== "id" && !same(v, was[k]))
    return changed.length ? [{ id: p.id, ...Object.fromEntries(changed) }] : []
  })
  const snippets = (row.snippets ?? []).filter(
    (x) =>
      !same(
        x,
        h.snippets?.find((d) => d.name === x.name),
      ),
  )
  const format = (row.format ?? []).filter(
    (x) =>
      !same(
        x,
        h.format?.find((d) => d.label === x.label),
      ),
  )
  const { asks: _a, products: _p, snippets: _s, format: _f, ...rest } = row
  return {
    ...rest,
    id: h.id,
    name: h.name,
    ...(asks.length && { asks }),
    ...(products.length && { products }),
    ...(snippets.length && { snippets }),
    ...(format.length && { format }),
  }
}
/** Nothing but its id and name: an overlay with this shape is no overlay. */
export const empty = (r: Layer) => Object.keys(r).every((k) => k === "id" || k === "name")

// ───────── resolve ─────────
export interface Rows {
  harness?: Layer | undefined // the overlay: the player's global row
  packs?: readonly Layer[] | undefined // the library; `local.mounts` says which stand here, and in what order
  local?: Local | undefined
  persona?: { name: string; text: string } | undefined
}
export type From = string // "harness" | "card" | "local" | a pack's id
export type Item<T> = T & { from: From; compiled?: true; unasked?: true }
export interface Resolved {
  frame: Item<Fragment>[] // the head, holes filled; an entry with one unfilled is not here
  tail: Item<Fragment>[]
  asks: Record<string, Item<{ text: string }>> // every id: the highest on the chain that fills whole
  products: Item<Product>[] // `on` decided; the question filled, or `unasked` with its raw text when it does not fill
  entries: Item<PackEntry>[] // the lookup index's player-layer entries
  lexicon: Item<LexiconEntry>[] // no id, so no merge: every rank's stands, the highest first
  snippets: Item<Snippet>[]
  format: Item<Format>[]
  names: Names
  holes: string[] // the holes nothing fills yet, in order of first appearance
  switches: {
    value: Writing
    sentences: Record<string, string> // by ask id, `switch.<key>.<value>`
    taken: { pov: From | null; verbosity: From | null } // who holds the slot; the frame item says whether it is compiled
  }
  dropped: { from: From; kind: string; id?: string; why: string }[] // what the locks refused: a client draws it, nothing throws
}

/** The switches as slot fragments: `pov` (pov, echo, agency; the last two drop when there is no player in the fiction)
 *  and `verbosity`. */
const compile = (w: Writing, say: Readonly<Record<string, string>>): Fragment[] => {
  const line = (k: string, v: string | boolean) => say[`switch.${k}.${String(v)}`]
  const pov = [
    w.pov && line("pov", w.pov),
    w.pov !== "none" && w.echo !== undefined && line("echo", w.echo),
    w.pov !== "none" && w.agency && line("agency", w.agency),
  ].filter((x): x is string => typeof x === "string")
  return [
    ...(pov.length ? [{ id: "pov", text: pov.join("") }] : []),
    ...(w.verbosity ? [{ id: "verbosity", text: line("verbosity", w.verbosity)! }] : []),
  ]
}

/** The one place a layer is merged. Pure; called once per request; never throws for a player's row. */
export const resolve = (card: Card, rows: Rows): Resolved => {
  const dropped: Resolved["dropped"] = []
  const input = card.input ?? "act"
  const code = harness(input)
  // The player's rows in author order, each locked again: a row is only as good as what wrote it.
  const overlay = rows.harness && locked(rows.harness)
  const local = rows.local ?? (rows.persona ? { id: "local", name: "local", card: card.id } : undefined)
  const mine: { from: From; row: Layer }[] = [
    ...[...new Set(local?.mounts)].flatMap((id) => {
      const p = rows.packs?.find((x) => x.id === id)
      return p ? [{ from: p.id, row: locked(p) }] : []
    }),
    ...(local
      ? [
          {
            from: "local",
            row: locked({
              ...local,
              ...(rows.persona && {
                fragments: [...(local.fragments ?? []), { id: "persona", text: rows.persona.text }],
              }),
            }) as Layer,
          },
        ]
      : []),
  ]
  // The card as a row: its frame and products are merged below, its fiction, lore and rules are not the layer's.
  const cardRow: Partial<Layer> = {
    ...(card.names && { names: card.names }),
    ...(card.lexicon && { lexicon: card.lexicon }),
    ...(card.asks && { asks: card.asks.flatMap((a) => (a.text === undefined ? [] : [{ id: a.id, text: a.text }])) }),
  }
  const up: { from: From; row: Partial<Layer> }[] = [
    ...(overlay ? [{ from: "harness", row: overlay }] : []),
    { from: "card", row: cardRow },
    ...mine,
  ]
  const down = [...up].reverse() // the highest rank first: a menu, the polish hints, the ask chain

  // ───────── names ─────────
  const pairs: [string, string][] = [["user", "玩家"]]
  const name = (from: From, k: string, v: string) => {
    if (nameOk(v)) pairs.push([k, v])
    else dropped.push({ from, kind: "name", id: k, why: "a name is one line with no {{" })
  }
  for (const { from, row } of up) for (const [k, v] of Object.entries(row.names ?? {})) name(from, k, v)
  if (rows.persona) name("local", "user", rows.persona.name)
  const names: Names = Object.fromEntries(pairs)

  // ───────── asks: down the chain to the first that fills whole; the code's own has no hole ─────────
  const asks = new Map<string, Item<{ text: string }>>()
  const worded: string[] = [] // every ask that could go out, what `holes` scans; the ones under a filled one never do
  for (const { from, row } of [...down, { from: "harness", row: code }])
    for (const a of row.asks ?? []) {
      if (a.id.startsWith("product.") || asks.has(a.id)) continue
      worded.push(a.text)
      const text = expand(a.text, names)
      if (text !== undefined) asks.set(a.id, { text, from })
    }
  const sentenceOf: Record<string, string> = Object.fromEntries(
    [...asks].flatMap(([id, a]) => (id.startsWith("switch.") ? [[id, a.text]] : [])),
  )

  // ───────── the frame: the player zone in first-written order, then what is left of the card's ─────────
  // A card's slot with no text is left for the player to fill (fragment.ts): it holds nothing.
  const theirs = new Set(card.frame.flatMap((f) => (f.text && f.enabled !== false ? [f.id] : [])))
  const slots = new Map<string, Item<Fragment>>()
  let value: Writing = {}
  const switched = (from: From, row: Partial<Layer>) => {
    if (!row.switches) return
    value = { ...value, ...row.switches }
    for (const c of compile(value, sentenceOf)) {
      const held = slots.get(c.id)
      if (theirs.has(c.id) || (held && (!held.compiled || held.text === c.text))) continue // the same text keeps its author
      slots.set(c.id, { ...c, from, compiled: true })
    }
  }
  // A tail fragment is a per-turn directive, not a slot (GLOSSARY 尾区): its id meets the other rows' tail ids, never
  // the card's head slots, so a tail row named `pov` neither yields to the card's pov nor knocks it out.
  const keyOf = (f: Fragment) => (f.at === "tail" ? `tail:${f.id}` : f.id)
  const cards = (f: Fragment) => f.at !== "tail" && theirs.has(f.id)
  if (overlay) switched("harness", overlay)
  for (const f of overlay?.fragments ?? []) {
    if (f.enabled === false || ((f.mode ?? "yield") === "yield" && cards(f))) continue
    slots.set(keyOf(f), { ...f, from: "harness" })
  }
  for (const { from, row } of mine) {
    switched(from, row)
    for (const f of row.fragments ?? []) {
      if (f.enabled === false) continue // switched off, it is not there: it blanks no slot under it
      const held = slots.get(keyOf(f))
      if (f.mode === "yield" && (cards(f) || (held && held.from !== from))) continue
      slots.set(keyOf(f), { ...f, from })
    }
  }
  const zone: Item<Fragment>[] = [
    ...slots.values(),
    ...card.frame
      .filter((f) => !slots.has(f.id) || (slots.get(f.id)!.mode ?? "override") !== "override")
      .map((f) => ({ ...f, from: "card" })),
  ]
  const filled = fill(zone, names)
  // who holds a head slot: a tail directive is not a slot; an empty or disabled entry, or one with an unfilled hole, holds nothing
  const holder = (id: string) =>
    filled.find((f) => f.id === id && f.at !== "tail" && f.text && f.enabled !== false)?.from ?? null

  // ───────── products: whole in the code's defaults and on the card, on a player's row by rank ─────────
  const stock = new Map<string, Partial<Product> & { id: string; from: From }>(
    (code.products ?? []).map((p) => [p.id, { ...p, from: "harness" }]),
  )
  /** A toggle on an id this card does not declare says nothing about this card (an overlay's `people` on a card without it). */
  const toggleOnly = (p: { id: string }) => Object.keys(p).every((k) => k === "id" || k === "on")
  /** A player row's patch: label, text and on over an id that exists; a new id is a 小剧场, dropped without text. The
   *  author of the question that stands is `from`: a toggle or a label changes nothing the card wrote (`shown` strips
   *  a card's text by it). */
  const patched = (from: From, p: ProductPatch) => {
    const { id, ...patch } = p as { id: string; label?: string; text?: string; on?: boolean }
    const was = stock.get(id)
    if (was) stock.set(id, { ...was, ...patch, from: patch.text === undefined ? was.from : from })
    else if (toggleOnly(p)) return
    else if (patch.text === undefined) dropped.push({ from, kind: "product", id, why: "a new product needs text" })
    else
      stock.set(id, {
        id,
        ...patch,
        text: patch.text,
        shape: { kind: "text" },
        role: "theater",
        stage: "narrate",
        from,
      })
  }
  // An id the card declares exists at the overlay's rank too: the patch stays a patch, and the card's own fields go over it.
  for (const p of overlay?.products ?? []) {
    if (!stock.has(p.id) && card.products?.some((c) => c.id === p.id)) stock.set(p.id, { id: p.id, from: "harness" })
    patched("harness", p)
  }
  /** An ask `product.<id>` is a text patch at its row's rank; on a product this card does not have it is nothing. */
  const reworded = (from: From, row: Partial<Layer>) => {
    for (const a of row.asks ?? []) {
      const was = a.id.startsWith("product.") && stock.get(a.id.slice("product.".length))
      if (was) stock.set(was.id, { ...was, text: a.text, from })
    }
  }
  if (overlay) reworded("harness", overlay)
  for (const p of card.products ?? []) stock.set(p.id, { ...stock.get(p.id), ...p, from: "card" })
  reworded("card", cardRow)
  for (const p of stock.values()) validate(p) // the card's own error stands: it fails when the session opens
  for (const { from, row } of mine) {
    for (const p of row.products ?? []) patched(from, p)
    reworded(from, row)
  }
  const raw = [...stock.values()].map((p) => validate(p) as Item<Product>)
  const asked = raw.map((p) => {
    const text = expand(p.text, names)
    return text === undefined ? { ...p, unasked: true as const } : { ...p, text }
  })

  // ───────── entries, the quick inputs, the format keys, the lexicon ─────────
  // `/` joins row and entry: an entry id holding one would alias another row's entry, so it is refused (the server refuses
  // a pack id with one)
  const written = up.flatMap(({ from, row }) =>
    (row.entries ?? []).flatMap((e) => {
      if (!e.id.includes("/")) return [{ ...e, id: `${from}/${e.id}`, from }]
      dropped.push({ from, kind: "entry", id: e.id, why: "an entry id has no /" })
      return []
    }),
  )
  const entries = fill([...new Map(written.map((e) => [e.id, e])).values()], names)
  /** Keyed, the highest rank first and its copy standing: what a menu shows. */
  const menu = <T>(pick: (r: Partial<Layer>) => readonly T[] | undefined, key: (x: T) => string) => {
    const m = new Map<string, Item<T>>()
    for (const { from, row } of [...down, { from: "harness", row: code }])
      for (const x of pick(row) ?? []) if (!m.has(key(x))) m.set(key(x), { ...x, from })
    return [...m.values()]
  }
  const allSnippets = menu(
    (r) => r.snippets,
    (s) => s.name,
  )
  const quick = allSnippets.flatMap((s) => {
    const text = expand(s.text, names)
    const after = s.after === undefined ? undefined : expand(s.after, names)
    if (text === undefined || (s.after !== undefined && after === undefined)) return []
    // in author mode every send is already a note and nobody in the story thinks: the channel switch and the thought
    // mark have nothing to do there
    if (input === "note" && (text === "" || /⦅/.test(text))) return []
    return [{ ...s, text, ...(after !== undefined && { after }) }]
  })

  // every text that goes out, or that a client fills and sends: what a player may be asked to name
  const out = [
    ...zone.flatMap((x) => (x.enabled === false ? [] : (x.text ?? []))),
    ...card.fiction.flatMap((x) => x.text ?? []),
    ...card.greetings.map((g) => g.text),
    ...card.lore.flatMap((e) => e.layers),
    ...written.map((e) => e.text),
    ...card.guard,
    ...(card.rules.readouts ?? []).flatMap((q) => [q.text, ...q.options.map((o) => o.text)]),
    ...raw.map((p) => p.text),
    ...worded,
    ...allSnippets.flatMap((s) => [s.text, s.after ?? ""]),
  ]
  return {
    frame: filled.filter((f) => f.at !== "tail"),
    tail: filled.filter((f) => f.at === "tail"),
    asks: Object.fromEntries(asks),
    products: asked,
    entries,
    lexicon: down.flatMap(({ from, row }) => (row.lexicon ?? []).map((e) => ({ ...e, from }))),
    snippets: quick,
    format: menu(
      (r) => r.format,
      (f) => f.label,
    ),
    names,
    holes: unfilled(out.join("\n"), names),
    switches: {
      value,
      sentences: sentenceOf,
      taken: { pov: holder("pov"), verbosity: holder("verbosity") },
    },
    dropped,
  }
}

/** A resolved layer as it leaves the server: a card's item goes without its text, a card's lexicon entry goes whole (the
 *  pattern is the text, and a ban is a prompt, to a player too). */
export const shown = (r: Resolved) => {
  const bare = <T extends { from: From; text?: string }>(x: T) => {
    if (x.from !== "card") return x
    const { text: _, ...rest } = x
    return rest
  }
  return {
    ...r,
    frame: r.frame.map(bare),
    tail: r.tail.map(bare),
    products: r.products.map(bare),
    asks: Object.fromEntries(Object.entries(r.asks).map(([id, a]) => [id, bare(a)])),
    switches: {
      ...r.switches,
      sentences: Object.fromEntries(Object.entries(r.switches.sentences).filter(([id]) => r.asks[id]?.from !== "card")),
    },
  }
}
