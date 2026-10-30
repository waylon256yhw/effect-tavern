// A session: one card, one player layer, one connection, one log tree. Its interface is the crossing protocol the
// client speaks: player actions in (each returns the stream of events it causes, ending with the node), node
// projections out. The in-process callers (test/loop.ts, test/live.ts) and the wire adapter cross the same seam.
//
// One turn, wiring §9/§10 (beats), §13 (brief, guardrail), §14 (layered lore), §17 (record, views), §18 (head).
// Order: lookup → decide/settle loop → gate → direct → narrate → check → polish → record. The gate runs AFTER settlement
// because a window can depend on what this turn produced (the sword cut exposes the tattoo). Polish (src/polish.ts) is
// a call only when code found lexicon hits in the final prose; it rewrites those sentences alone, and its output is not
// checked again (#63): a deliberate saving of one call, taken because the rewrite is confined to the hit sentences
// outside dialogue, the question asks for the same sentence said plainly, and a blank answer keeps the sentence
// (polish.ts `splice`). The verdict on the node is check's, on the prose before polish; a rewrite that drops a clue's
// wording or brushes a guard rule is the price, and `writing.polish: false` turns the stage off.
// There is no tool anywhere: lookup is a structured pick over the literal enum of readable ids, actions are the decide
// stage. The model never drives a loop, so there is no tool definition to gate or to cache (§15.4 items 1–2 dissolve).
// Truncation: a narrate that finishes with "length" is re-asked once with the partial as a trailing assistant message
// when the connection declares `prefill`; the turn records the concatenation once. Current Claude rejects the prefix
// (docs/provider-reading.md §7), so on such connections the partial stands and recovery is still undecided.
// Compression (§17.3/§18.4): before each narrate, fold the leading turns in blocks; the summary is a cached code fold,
// nodes are untouched, and lore dedupe keeps working because deliveries live on the nodes, not in the view.
// Player actions on a node, each with its landing in the log tree (docs/card-reading-2.md §8 item 8): `swipe` and
// `reword` (a sibling, from lookup / from narrate), `edit` (a sibling carrying the player's prose, check and record
// rerun), `setField` (effects on the node, folded last), `demand` (a product on the node). An option is not an action
// either: the client fills the box with it and the player sends it as an act. A pin is not an action on a node: it rides on an act's input (`Input.pin`), the entry is forced open as a
// MUST for that turn, check verifies it, and what the path could still be told is the node's `readable` list. "Continue" is not a kind: with no output cap the model ends where
// it ends, and "go on" is an note turn. Stop has two meanings by stage: before the prose starts, the action is
// interrupted and leaves nothing; once it streams, `stop` halts the prose where it is, check is skipped (the player cut
// the draft, not the model), record runs, and the node is saved with `end: "stopped"`, so "go on" has a node to follow.
// Cache (docs/provider-reading.md §6 item 3): three breakpoints, where the request stops being byte-stable across turns:
// the end of the head (the connection's TTL: 1h for a person), the folded summary, and the last history message
// before this turn's input. The transcript is append-only, so everything before the input is a cached read next turn;
// no padding for the model's minimum prefix, which a head plus one turn crosses on its own.
// Events: `stage` when a stage begins, `delta` for each narrate part as it streams, `call` when a call returns (the
// request, the answer, the cost: what the inspector shows), `node` when a node is saved or amended. Prose and products
// are different roads: the prose streams by part, a product arrives whole with record's `call`.
// Errors: a model failure is a `ModelError` on the stream; an action that names what does not exist (a node, an
// option, a product, a value outside a field) is a defect, the caller's bug.
import {
  object,
  streamed,
  type Message,
  type Model,
  type ModelError,
  type Part,
  type Usage,
} from "@effect-tavern/provider"
import { Effect, Queue, Schema, Stream } from "effect"
import { tokens } from "./tokens.ts"
import { Effect_, makeCard, type Answers, type Beat, type Card, type Greeting, type State } from "./card.ts"
import { holds, type State as Paths } from "./cond.ts"
import { gateOf, makeDerived, type Node } from "./derived.ts"
import {
  decodeFragments as frags,
  frame,
  head as headOf,
  type Format,
  type Hat,
  type Player,
  type Snippet,
} from "./fragment.ts"
import { narratorHistory, policyFor, type Policy } from "./history.ts"
import { deliveredOn, splitAside, textOf as proseOf, type Brief, type Input, type Turn as TurnOf } from "./journal.ts"
import * as Log from "./log.ts"
import { key, makeLore, type Disclosure } from "./lore.ts"
import { marked, scan, splice } from "./polish.ts"
import { request, type Ask, type Told } from "./request.ts"
import { cap, decodeProducts, entryRef, fold, resolve, shapeSchema, type Product } from "./product.ts"

export type Turn = TurnOf<Beat>
export const phases = ["lookup", "decide", "direct", "narrate", "check", "polish", "record"] as const
export type Phase = (typeof phases)[number]
export type { Node } from "./derived.ts" // the node projection lives with the facts it carries; the client imports it here
export type Event =
  | { kind: "stage"; phase: Phase }
  | { kind: "delta"; part: Part }
  | { kind: "call"; phase: Phase; msgs: readonly Message[]; out: unknown; usage: Usage; ms: number }
  | ({ kind: "change" } & Change) // the log moved: a node landed or was amended, nodes dropped, and where head is now
export type Events = Stream.Stream<Event, ModelError>
export type Change = Log.Change<Node>
/** A stop signal: completes when the player halts the prose (a Deferred's await on the wire). Only narrate listens. */
export type Stop = Effect.Effect<void>
type Emit = (e: Event) => Effect.Effect<void>

// ───────── The session's own words ─────────
// Every instruction the loop says to the model, as fragments with ids, in the open. Data lines (State:, Actions:,
// Open:, Known:, Questions:) are format and stay in code; these are the prose around them. Resolved per id: the
// player's `asks`, then the card's, then these defaults. Direct and check carry no prose: the schema is the question.
// Lookup carries one line, since an index and an array read as "fill it": the first Haiku session picked one entry a
// turn until the index was empty, the innkeeper on a line that spoke to the swordsman.
export const asks = frags([
  {
    id: "lookup",
    text: "Which index entries does the player's line ask about or need right now? Most lines need none: pick nothing rather than something near.",
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
    id: "record.readout",
    text: "Answer each question from what this scene settled on the page, not from where it is heading: when a character has only raised the matter and the player has yet to answer, or the scene does not bear on the question, pick the option that says nothing happened or nothing changed.",
  },
  { id: "narrate.correction", text: "Previous draft broke:" },
  {
    id: "polish",
    text: "Each sentence marked <target> uses wording the reader has seen too often: the words in its hits, and what its hint below names. Rewrite each so it no longer does, keeping its meaning, person, register, length and its seams with the sentences around it. Return a sentence unchanged if it already reads naturally. Answer each target by its id with the sentence alone, no marks.",
  },
  {
    id: "input.thought",
    text: "Text between ⦅ and ⦆ in the player's input is what their character thinks: not said, not done, no one in the story perceives it.",
  },
])
// The default quick inputs: the ecosystem's quick-reply lists as data (Player `snippets` goes first). Each has a
// meaning in play: the thought mark (a perception scope the `input.thought` ask explains), the note channel, or a
// direction to the narrator. Inserted at the caret, never sent; an empty note snippet only switches the channel.
export const snippets: readonly Snippet[] = [
  { name: "心声", text: "⦅", after: "⦆", hint: "角色心里的话，不说出口" },
  { name: "场外", text: "", hint: "给叙事者的话，不计入正文", note: true },
  { name: "继续", text: "继续。", hint: "顺着写下去", note: true },
  { name: "推进剧情", text: "推进剧情到下一个场景。", hint: "引入新事件，或切到下一幕", note: true },
  { name: "时间流逝", text: "时间流逝，跳到下一件有事发生的时刻。", hint: "略过平淡，直达下一件事", note: true },
  { name: "详细描写", text: "把这一段写得更细。", hint: "放慢镜头，写细这一段", note: true },
]
// The default format keys: typing conveniences with no meaning in play, the ecosystem's 输入助手 as data (Player `format`
// goes first). A key is its glyph; the text is a template with the caret between `text` and `after`.
export const format: readonly Format[] = [
  { label: "「」", text: "「", after: "」" },
  { label: "『』", text: "『", after: "』" },
  { label: "“”", text: "“", after: "”" },
  { label: "（）", text: "（", after: "）" },
  { label: "《》", text: "《", after: "》" },
]
// The default products (src/product.ts): what record asks for on every card unless the card patches or the player
// toggles. `notes` is the compression source and the only one on by default. A product's question is its `text`,
// overridden like any ask by the fragment id `product.<id>`. The options question follows the card's input channel,
// because an option goes into the box as the player's next input: on an act card it is their own line (the first Haiku
// run wrote "玩家……" in the third person, which put that sentence in the player's mouth), on a note card a direction.
export const defaultProducts = (input: "act" | "note"): readonly Product[] =>
  decodeProducts([
    {
      id: "notes",
      label: "事件摘要",
      text: "Notes are the record: write only the new facts this scene established (what happened, what was said that matters, what changed), each a short factual sentence in the third person. Name characters by their names in the frame, and refer to an unnamed player character as 玩家 (never 你 or 我). Never repeat Known, never comment on the writing.",
      shape: { kind: "list" },
      feed: true,
    },
    {
      id: "options",
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
      label: "人物心声",
      text: "What the character thought this scene but did not say, one short paragraph.",
      shape: { kind: "text" },
      on: false,
    },
  ])

const Lookup = (ids: readonly string[]) => Schema.Struct({ read: Schema.Array(Schema.Literals(ids)) })
const BriefOf = (open: readonly string[]) =>
  Schema.Struct({
    must: Schema.Array(Schema.Literals(open)),
    may: Schema.Array(Schema.Literals(open)),
    tone: Schema.String,
  })
// An empty enum has no JSON-schema type (Anthropic rejects it, verified live), so a question with no options is not asked.
const Check = (open: readonly string[], rules: readonly string[]) => {
  const fired = { fired: Schema.Array(Schema.Literals(open)) }
  const violated = { violated: Schema.Array(Schema.Literals(rules)) }
  return open.length && rules.length
    ? Schema.Struct({ ...fired, ...violated })
    : open.length
      ? Schema.Struct(fired)
      : Schema.Struct(violated)
}

/** An ask's wording: the player's, then the card's, then the session's own. */
export const wordingOf = (player: Player, card: Card, id: string) =>
  [...(player.asks ?? []), ...(card.asks ?? []), ...asks].find((f) => f.id === id)!.text!
/** A product's question: `product.<id>` from the player or the card, else the product's own text. */
export const questionOf = (player: Player, card: Card, pr: Product) =>
  [...(player.asks ?? []), ...(card.asks ?? [])].find((f) => f.id === `product.${pr.id}`)?.text ?? pr.text

/** Runs an action's stream and gives back the node it ended with. */
export const outcome = <E>(events: Stream.Stream<Event, E>): Effect.Effect<Turn, E> =>
  Stream.runLast(events).pipe(
    Effect.map((last) => {
      if (last._tag === "None" || last.value.kind !== "change" || !last.value.node)
        throw new Error("action ended without a node")
      return last.value.node.turn
    }),
  )
/** The events an action causes, as a stream: the body runs forked, emitting as it goes; the stream ends when it does.
 *  A defect in the body (an invalid action found mid-turn, such as a pin with nothing to tell) fails the stream too;
 *  swallowing it would leave the stream open forever. */
const emitting = (body: (emit: Emit) => Effect.Effect<unknown, ModelError>): Events =>
  Stream.callback<Event, ModelError>((q) =>
    Effect.exit(body((e) => Effect.asVoid(Queue.offer(q, e)))).pipe(
      Effect.andThen((x) => (x._tag === "Success" ? Queue.end(q) : Queue.failCause(q, x.cause))),
    ),
  )

export const makeSession = ({
  card,
  player: given,
  model: modelFor,
  store,
  players,
  persona,
  hat,
  policy: P = policyFor(),
}: {
  card: Card
  player: Player // the harness default; a stored player wins over it
  /** The model each stage runs on (provider `bind`), asked on every call like `hat`: the library's routing, in force
   *  from the next request. lookup and check can take a light model; record answers readouts (state judgement), not
   *  pure extraction: never route it down by default. */
  model: (phase: Phase) => Model
  store?: Log.Store<Turn> // the log's persistence; none = in memory
  players?: { read: () => Player | undefined; write: (p: Player) => void } // the player layer's persistence
  persona?: (player: Player) => string | undefined // the player's persona on this card, read per request (library.ts)
  hat?: (id: string) => Hat | undefined // a connection's hat by id, read per request (library.ts); none = no hat
  // the fold boundary, a value or read on every fold (library.ts: the narrate model's window, so a routing edit is in
  // force from the next request); tests pass a small budget to fold short scripted prose
  policy?: Policy | (() => Policy)
}) => {
  let player = players?.read() ?? given
  /** The player layer as the frame reads it: the persona in force, when there is one, joins the per-card layer last. */
  const layered = (): Player => {
    const text = persona?.(player)
    return text === undefined
      ? player
      : {
          ...player,
          forCard: {
            ...player.forCard,
            [card.id]: [...(player.forCard[card.id] ?? []), { id: "persona", text }],
          },
        }
  }
  const rpg = makeCard(card.rules)
  const L = makeLore<Paths, readonly string[]>(
    card.lore.map((e) => ({ id: e.id, layers: e.layers, ...gateOf(e.id, e.offer) })),
  )
  const held = Log.hold<Turn>(store)
  const chain = (id: number | null) => Log.chain(held.log, id)
  const turnOf = (id: number) => Log.get(held.log, id)
  let seeds = 0

  const wording = (id: string) => wordingOf(player, card, id)
  const resolveProducts = () => resolve(defaultProducts(card.input ?? "act"), card.products, player.products)
  let products = resolveProducts()
  /** The products as the card and the harness declare them, before the player's toggles: `on` is the default a toggle
   *  overrides (the client shows the default while the player has not toggled one, and the card view is read once). */
  const declared = resolve(defaultProducts(card.input ?? "act"), card.products)
  const question = (pr: Product) => questionOf(player, card, pr)
  // ───────── Derived facts along a path (src/derived.ts) ─────────
  const derived = makeDerived({
    rpg,
    L,
    lore: card.lore,
    products: () => products,
    policy: () => (typeof P === "function" ? P() : P),
  })
  const project = (t: Turn): Node => derived.at(chain(t.id)).node()
  /** A committed change, projected for the wire: the node as the client sees it, the dropped ids, head. */
  const change = (c: Log.Change<Turn>): Change => ({
    head: c.head,
    ...(c.dropped && { dropped: c.dropped }),
    ...(c.node && { node: project(c.node) }),
  })

  // ───────── The document each stage reads (src/request.ts) ─────────
  /** A stage's document: the frame at this state, the input and what a thought in it is, then the stage's own ask. */
  const ask = (state: State, input: Input, a: Ask) => {
    const M = modelFor(a.stage)
    const layers = frame(layered(), card)
    const worn = M.hat === undefined ? undefined : hat?.(M.hat)
    return request(
      {
        frame: headOf(
          layers.filter((f) => f.at !== "tail"),
          { state },
        ),
        tail: headOf(
          layers.filter((f) => f.at === "tail"),
          { state },
        ),
        input,
        thought: wording("input.thought"),
      },
      a,
      { reasoningBack: M.reasoningBack, ttl: M.ttl, ...(worn && { hat: worn }) },
    )
  }

  // ───────── Calls, each announced before and reported after ─────────
  const obj = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
    emit: Emit,
    phase: Phase,
    schema: S,
    msgs: Message[],
    maxOutputTokens = 1024,
  ) =>
    Effect.gen(function* () {
      yield* emit({ kind: "stage", phase })
      const t0 = Date.now()
      const r = yield* object(modelFor(phase), schema, msgs, {
        name: phase,
        effort: "off",
        temperature: 0,
        maxOutputTokens,
      })
      yield* emit({ kind: "call", phase, msgs, out: r.value, usage: r.usage, ms: Date.now() - t0 })
      return r.value
    })

  /** Ids the player or the lookup named, as the disclosures they deliver: every unseen layer up to a lore entry's current
   *  one, or the one layer of a recalled product row. Already-seen ones deliver nothing. */
  const deliver = (s: Paths, seen: readonly Disclosure[], ids: readonly string[]): Disclosure[] => {
    const seenKeys = new Set(seen.map(key))
    return [...new Set(ids)]
      .flatMap((id) => (entryRef(id) ? [{ id, layer: 1 }] : (L.read(s, seen, id) ?? [])))
      .filter((d) => !seenKeys.has(key(d)))
  }

  const record = (
    emit: Emit,
    asked: readonly Product[],
    path: readonly Turn[],
    state: State,
    scene: Pick<Turn, "input" | "reply">,
    qs?: { schema: Schema.Top; lines: string[] }, // readouts on the post-settlement state, when the card declares any
  ) =>
    Effect.gen(function* () {
      if (!asked.length && !qs) return { products: {}, answers: undefined } // nothing to ask
      const fed = derived.at(path).known()
      const msgs = ask(state, scene.input, {
        stage: "record",
        known: fed.known,
        current: fed.current,
        asks: asked.map((p) => `${p.id}: ${question(p)}`),
        readout: wording("record.readout"),
        questions: qs?.lines,
        prose: proseOf(scene.reply),
      })
      // Built per call from data, so its static type is unknown: the shapes already decode what the model returns.
      const schema = Schema.Struct({
        ...Object.fromEntries(asked.map((p) => [p.id, shapeSchema(p.shape)])),
        ...(qs ? { answers: qs.schema } : {}),
      }) as unknown as Schema.Codec<Record<string, unknown>>
      const out = yield* obj(emit, "record", schema, msgs, 4096)
      // A list accumulates along the path, so an item the path already holds is noise: on a turn with no new fact Haiku
      // echoed Known back verbatim as notes (live), and the fold carried it twice. Dropped by code, like a cap.
      const have = fold(
        asked.filter((p) => p.shape.kind === "list"),
        path.map((t) => t.products),
      )
      const fresh = (p: Product, v: unknown) =>
        p.shape.kind === "list"
          ? (v as string[]).filter((x) => !((have[p.id] as string[] | undefined) ?? []).includes(x))
          : v
      return {
        products: Object.fromEntries(asked.map((p) => [p.id, cap(p.shape, fresh(p, out[p.id]))])),
        answers: out.answers as Record<string, string> | undefined,
      }
    })

  // ───────── The turn ─────────
  /** `from` is where a sibling starts: lookup (a swipe), narrate (a reword: lookup, beats and brief kept from `base`),
   *  check (an edit: the player's prose stands in for the narrator's, check and record run over it). */
  const SIBLING = { lookup: "swipe", narrate: "reword", check: "edit" } as const
  const turn = (
    emit: Emit,
    parent: number | null,
    input: Input,
    from: "lookup" | "narrate" | "check",
    base?: Turn,
    stop?: Stop,
  ) =>
    Effect.gen(function* () {
      // no line and no note: nothing to run the narrator from (an act of nothing, or a sibling of an opening; an edit
      // of the prose alone starts at check and needs none)
      if (from !== "check" && !input.text && !input.note)
        throw new Error(base ? `node ${base.id}: nothing to rerun` : "empty input")
      const path = chain(parent)
      const here = derived.at(path)
      const told = (ds: readonly Disclosure[]): Told[] => ds.map((d) => ({ id: d.id, text: here.text(d) }))
      const s0 = here.state
      const g0 = here.gated()
      const seen = deliveredOn(path)
      // lookup: a structured pick over the literal enum of readable ids: lore entries with an unseen layer, plus the
      // items of recall products stored on the path and not yet delivered (model-written memory walks the same road as
      // lore). Nothing to pick → no call.
      // The pin: the entry's deepest unseen layer, forced open below, so the lookup is not offered it as well; the
      // unseen layers under it are read this turn, as an opened entry's always are (issue #9).
      const pinned = input.pin === undefined ? [] : deliver(g0, seen, [input.pin])
      if (input.pin !== undefined && !pinned.length) throw new Error(`${input.pin}: nothing to pin`)
      const forced = pinned.slice(-1)
      const untold = here.readable().filter((e) => e.id !== input.pin)
      const idx = untold.map((e) => e.id)
      const looked =
        from !== "lookup"
          ? base!.read
          : deliver(
              g0,
              seen,
              idx.length
                ? (yield* obj(
                    emit,
                    "lookup",
                    Lookup(idx),
                    ask(s0, input, {
                      stage: "lookup",
                      question: wording("lookup"),
                      index: untold.map((e) => `${e.id}=${e.hook}`),
                    }),
                  )).read
                : [],
            )
      // decide → settle, looping; the k-th decide sees the first k events
      let beats: Beat[] = from !== "lookup" ? [...base!.beats] : []
      let end: Turn["end"] = from !== "lookup" ? base!.end : "end"
      if (card.rules.actions.length && from === "lookup") {
        for (;;) {
          const { s, events } = rpg.fold(s0, beats)
          if (rpg.over(s)) {
            end = "over"
            break
          }
          if (beats.length >= rpg.cap) {
            end = "cap"
            break
          }
          // Two different questions. The first reads the input: which action, and does its wording ask for more
          // (`again`). Only an input that asked for more enters the per-beat loop, where each later question sees the
          // outcomes so far (§10.2) and continues by default. Verified on Haiku: one question for both roles answers
          // the input again every time, whichever way it is worded.
          const q = wording(beats.length ? "decide.again" : "decide.first")
          const d = yield* obj(
            emit,
            "decide",
            rpg.decideSchema(s),
            ask(s, input, {
              stage: "decide",
              ledger: here.ledger(),
              question: q,
              state: JSON.stringify(s),
              menu: rpg.menu(s),
              soFar: events,
            }),
          )
          if (d.next === "end") {
            end = "end"
            break
          }
          const first = beats.length === 0
          beats.push({ next: d.next, chance: (d as { chance?: number }).chance, seed: ++seeds })
          if (first && !d.again) {
            end = "end"
            break
          }
        }
      }
      const { s: s1, events } = rpg.fold(s0, beats)
      // gate: after settlement, on this turn's beat events plus what the turn before emitted after its own gate
      // (derived.ts `gate`). Director only if the card has one and something is open. The pinned entry is open with its
      // forced layer and MUST be told, director or not: check verifies it, a miss is the one correction rewrite, and an
      // entry still unfired after that stays untold.
      const gateEvents = [...events, ...here.post]
      const { offered, disclosures, open } = here.gate({
        state: s1,
        events,
        before: [...looked, ...pinned.slice(0, -1)],
        forced,
      })
      const openIds = [...new Set(open.map((d) => d.id))] // Literals(openIds) below: a duplicate must never reach it
      const mustIds = forced.map((d) => d.id)
      const briefed: Brief =
        from !== "lookup"
          ? base!.brief
          : card.director && offered.length
            ? yield* obj(
                emit,
                "direct",
                BriefOf(openIds),
                ask(s1, input, {
                  stage: "direct",
                  ledger: here.ledger(),
                  rules: card.guard,
                  open: told(open),
                  events: gateEvents,
                }),
              )
            : { must: [], may: openIds }
      const brief: Brief = {
        ...briefed,
        must: [...new Set([...mustIds, ...briefed.must])],
        may: briefed.may.filter((id) => !mustIds.includes(id)),
      }
      // narrate, streamed, with truncation recovery and at most one correction rewrite
      const fed = here.known()
      const sum = here.summary()
      // No output cap by default: the model's own limit (128k on Haiku) is the ceiling. A cap is connection config.
      const M = modelFor("narrate")
      const opts = { name: "narrate", maxOutputTokens: M.maxOutputTokens, effort: M.effort }
      // A stopped stream ends after the current pull without the `finish` part: the text so far is the reply, usage unknown.
      let cut = false
      const write = (msgs: Message[]) =>
        Effect.gen(function* () {
          yield* emit({ kind: "stage", phase: "narrate" })
          const t0 = Date.now()
          const { parts, reply } = yield* streamed(M, msgs, opts)
          let text = ""
          let finished = false
          yield* Stream.runForEach(stop ? parts.pipe(Stream.haltWhen(stop)) : parts, (part) => {
            if (part.type === "text-delta") text += part.text
            if (part.type === "finish") finished = true
            return part.type === "text-delta" || part.type === "reasoning-delta"
              ? emit({ kind: "delta", part })
              : Effect.void
          })
          cut = !finished
          const r = cut
            ? {
                text,
                parts: [{ type: "text" as const, text }],
                usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                finishReason: "stop" as const,
              }
            : yield* reply
          yield* emit({ kind: "call", phase: "narrate", msgs, out: r.text, usage: r.usage, ms: Date.now() - t0 })
          return r
        })
      const narrate = (correction?: string) =>
        Effect.gen(function* () {
          const msgs = ask(s1, input, {
            stage: "narrate",
            fiction: headOf(card.fiction, { state: s1 }),
            history: narratorHistory(path, here.text, sum),
            summarized: sum !== undefined,
            told: disclosures.map(here.text),
            outcome: events,
            current: fed.current, // feed products other than notes: where the scene stands, as data
            must: told(open.filter((d) => brief.must.includes(d.id))),
            may: told(open.filter((d) => brief.may.includes(d.id))),
            tone: brief.tone,
            correction,
          })
          const r = yield* write(msgs)
          // ponytail: the deltas stream raw, the `<<aside>>` line and the aside included; only the node's reply is split.
          // Hold text deltas back at a line start that could become the delimiter if the live draft must not show it.
          if (r.finishReason !== "length" || !M.prefill) return splitAside(r.parts)
          const r2 = yield* write([...msgs, { role: "assistant", content: r.text }]) // resume with the partial as prefix
          return splitAside([...r.parts, ...r2.parts])
        })
      let reply: Turn["reply"] = from === "check" ? base!.reply : yield* narrate()
      let fired: Disclosure[] = []
      let violated: string[] = []
      if (!cut && (card.guard.length > 0 || open.length > 0)) {
        const check = (text: string) =>
          obj(
            emit,
            "check",
            Check(openIds, card.guard),
            ask(s1, input, { stage: "check", rules: card.guard, open: told(open), must: brief.must, prose: text }),
          ).pipe(
            Effect.map((c) => {
              const r = c as { fired?: readonly string[]; violated?: readonly string[] }
              return { fired: r.fired ?? [], violated: r.violated ?? [] }
            }),
          )
        let c = yield* check(proseOf(reply))
        const missed = brief.must.filter((id) => !c.fired.includes(id))
        // the player's own prose (an edit) is never rewritten: its verdict is recorded and stands
        if (from !== "check" && (c.violated.length || missed.length)) {
          const again = yield* narrate(
            `${wording("narrate.correction")} ${[...c.violated.map((r) => `rule "${r}"`), ...missed.map((m) => `missed MUST ${m}`)].join("; ")}`,
          )
          // A stop that fired while check ran halts the rewrite before its first character: the first draft stands,
          // stopped, with its verdict (the halted rewrite once became an empty stopped node).
          // A rewrite the player cut is not judged either (the first draft's verdict stands only when it stands).
          if (!cut || proseOf(again)) {
            reply = again
            c = cut ? { fired: [], violated: [] } : yield* check(proseOf(reply))
          }
        }
        fired = open.filter((d) => c.fired.includes(d.id))
        violated = [...c.violated]
      }
      // polish: code scans the final prose for the lexicon (the player's, then the card's); hit sentences go to one call
      // keyed by target id, and only the answers that differ from their sentence are spliced into the prose. Never on a
      // cut draft or the player's own prose (an edit), same as the correction. The other parts (reasoning) stand.
      const text = proseOf(reply)
      const targets =
        cut || from === "check" || player.writing?.polish === false
          ? []
          : scan(text, [...(player.writing?.lexicon ?? []), ...(card.lexicon ?? [])])
      if (targets.length) {
        const out = yield* obj(
          emit,
          "polish",
          Schema.Struct(Object.fromEntries(targets.map((t) => [t.id, Schema.String]))),
          ask(s1, input, {
            stage: "polish",
            question: wording("polish"),
            hints: targets.flatMap((t) => (t.hints.length ? [`${t.id}: ${t.hints.join("; ")}`] : [])),
            prose: marked(text, targets),
          }),
          4096,
        )
        const polished = splice(text, targets, out)
        let first = true // the prose is the text parts joined: it goes back as the first, the others drop
        if (polished !== text)
          reply = reply.flatMap((p): Turn["reply"][number][] =>
            p.type !== "text" ? [p] : first ? ((first = false), [{ ...p, text: polished }]) : [],
          )
      }
      // record: every product that is on and whose `when` holds, plus the readout questions when the card declares any.
      // One call, one schema: product id → its shape, `answers` → the readout enums. The model sees the prose, Known
      // (notes so far), Current (other feed products) and the questions, never the numbers; the chosen options settle by
      // code, so replay never asks again. Caps are applied here, by code.
      const asked = products.filter((p) => p.on && (!p.when || holds(p.when, s1)))
      const qs = card.rules.readouts?.length ? rpg.readoutSchema(s1) : undefined
      const rec = yield* record(
        emit,
        asked,
        path,
        s1,
        { input, reply },
        qs ? { schema: qs, lines: rpg.questions(s1) } : undefined,
      )
      const answers = (rec.answers ?? {}) as Answers
      rpg.settleReadouts(s1, answers) // validate now, not on the first replay
      const c = Log.add(held.log, {
        parent,
        input,
        read: disclosures,
        beats,
        answers,
        end: cut ? "stopped" : end,
        brief,
        reply,
        fired,
        violated,
        ...(base?.opening && { opening: base.opening }), // an edited opening keeps its effects
        ...(base && { sibling: SIBLING[from] }),
        products: rec.products,
      })
      yield* emit({ kind: "change", ...change(held.commit(c)) })
    })
  const sibling = (nodeId: number, from: "lookup" | "narrate" | "check", patch?: Partial<Turn>, stop?: Stop) => {
    const base = { ...turnOf(nodeId), ...patch }
    return emitting((emit) => turn(emit, base.parent, base.input, from, base, stop))
  }

  return {
    /** A greeting node: the card's opening as a root, with no player input; its `do` is the node's opening. */
    greet: (g: Greeting): Change =>
      change(
        held.commit(
          Log.add(held.log, {
            parent: null,
            input: { text: "" },
            read: [],
            ...(g.do ? { opening: g.do } : {}),
            beats: [],
            answers: {},
            end: "end",
            brief: { must: [], may: [] },
            reply: [{ type: "text", text: g.text }],
            fired: [],
            violated: [],
            products: {},
          }),
        ),
      ),
    node: (id: number): Node => project(turnOf(id)),
    /** Every node projected, and head: what a client opens with. */
    snapshot: (): Log.Snapshot<Node> => ({
      nodes: [...held.log.nodes.values()].map(project),
      head: held.log.head,
      next: held.log.next,
    }),
    /** The log as it stands: head, and every turn by id. */
    get log() {
      return held.log
    },
    /** Head moves to a version's newest leaf (its whole follow-up comes back), or to null: an empty line. */
    checkout: (id: number | null): Change => change(held.commit(Log.checkout(held.log, id))),
    /** The card's openings, for the greet action: a new thread is a new root, so the client asks for one by index. */
    greetings: card.greetings,
    /** A node and its descendants gone for good: deleting a thread is dropping its root. */
    drop: (id: number): Change => change(held.commit(Log.drop(held.log, id))),
    /** The card's rules as data, for a client that draws state: field bounds and options, action ids. Static per session. */
    rules: card.rules,
    /** The record products by id, shown name, shape and default state: how a client draws a node's products by their
     *  declared shape, and the Writing page's toggles (the player's toggle wins over `on`, on the player layer). */
    products: declared.map((p) => ({ id: p.id, label: p.label, shape: p.shape, on: p.on })),
    /** What the client shows about the card: its name and one line, the turn-heading reference, and its size as numbers.
     *  Not the card: fragment bodies, guard lines and lore stay on the server (a ban is a prompt, to a player too). */
    // `input` is the card's default channel, the one client-facing coordinate of participant vs author mode: on `act`
    // the box is the player's line and a note or a thought is this turn's deviation; on `note` every input is direction.
    meta: {
      id: card.id,
      title: card.title ?? card.id,
      summary: card.summary,
      heading: card.heading,
      input: card.input ?? "act",
      director: !!card.director,
      guard: card.guard.length,
      lore: { entries: card.lore.length, layers: card.lore.reduce((n, e) => n + e.layers.length, 0) }, // the card's size; what is readable now is on the node
      // what the card's own text costs each turn, estimated (tokens.ts): every frame and fiction fragment, as if all held
      tokens: { head: tokens([...card.frame, ...card.fiction].map((f) => f.text ?? "").join("\n")) },
    }, // leaves as JSON, which drops undefined
    /** The fiction's modules without their text: id, shown name, and the state condition that makes one a variant. */
    fiction: card.fiction.map(({ id, label, when }) => ({ id, label, when })),
    // In author mode every send is already a note and nobody in the story thinks: the channel switch and the thought
    // mark have nothing to do there.
    get snippets() {
      return [...(player.snippets ?? []), ...snippets].filter(
        (s) => card.input !== "note" || (s.text !== "" && !/⦅/.test(s.text)),
      )
    },
    get format() {
      return [...(player.format ?? []), ...format]
    },
    /** The player layer in force: the stored one, else the harness default given at start. */
    get player() {
      return player
    },
    /** The player layer replaced whole (the client edits it as one document): the frame, the asks, the product toggles
     *  and the quick inputs follow from the next request on; nothing recorded changes. Written to the store if there is one. */
    setPlayer: (p: Player) => {
      player = p
      products = resolveProducts()
      players?.write(p)
    },
    /** The player's turn: a child of `parent` (null for a root), every stage the card declares. */
    act: (parent: number | null, input: Input, stop?: Stop): Events =>
      emitting((emit) => turn(emit, parent, input, "lookup", undefined, stop)),
    // Siblings: the same input under the same parent, started at a later stage. Nothing of the original is reused
    // except what the stage order already fixed before the start point.
    swipe: (nodeId: number, stop?: Stop): Events => sibling(nodeId, "lookup", undefined, stop),
    /** A rewrite may carry a word to the narrator ("plainer"): it joins the input's note, this sibling's only. */
    reword: (nodeId: number, note?: string, stop?: Stop): Events => {
      const i = turnOf(nodeId).input
      const joined = [i.note, note].filter(Boolean).join("\n")
      return sibling(nodeId, "narrate", joined ? { input: { ...i, note: joined } } : undefined, stop)
    },
    /** The player rewrites the prose, or their own line under it, or both: a sibling carrying the new text, with check
     *  and record run over it, so what enters the record is only what the edit fired and answered (README §5 direction
     *  3). Revising the line while keeping the prose is for a change of wording, not of what happened: the beats stay. */
    edit: (nodeId: number, patch: { text?: string; input?: Input }): Events => {
      if (patch.text === undefined && !patch.input) return Stream.die(new Error(`node ${nodeId}: nothing to edit`))
      const { id: _, ...t } = turnOf(nodeId)
      // an opening (no line, no note): there is nothing for check or record to read the prose against, so the sibling
      // root is the greeting with the player's prose in its place, its effects kept, and no call is made
      if (!patch.input && !t.input.text && !t.input.note)
        return emitting((emit) =>
          emit({
            kind: "change",
            ...change(
              held.commit(Log.add(held.log, { ...t, reply: [{ type: "text", text: patch.text! }], sibling: "edit" })),
            ),
          }),
        )
      return sibling(nodeId, "check", {
        ...(patch.text !== undefined && { reply: [{ type: "text", text: patch.text }] }),
        ...(patch.input && { input: patch.input }),
      })
    },
    /** The player sets fields on a node (a status bar's +/-): effects appended to the node's `adjust`, validated against
     *  the card's bounds and enums now, replayed in the fold after everything the turn itself did. Every descendant sees
     *  it. A value outside the field throws and leaves the node as it was. */
    setField: (nodeId: number, effects: readonly (typeof Effect_.Type)[]): Change => {
      const t = turnOf(nodeId)
      const adjust = [...(t.adjust ?? []), ...effects]
      derived.at(chain(t.parent)).settle({ ...t, adjust })
      return change(held.commit(Log.amend(held.log, nodeId, { adjust })))
    },
    /** A player action on a node: ask for one product (on or off) over that node's scene, and keep it on the node. Not a
     *  turn, not in the transcript; replay reads it back like any recorded output. The first instance is the "inner
     *  forum" kind of card (docs/card-reading-2.md §2). */
    demand: (nodeId: number, productId: string): Events => {
      const t = turnOf(nodeId)
      const p = products.find((x) => x.id === productId)
      if (!p) throw new Error(`${productId}: not a product of this card`)
      return emitting((emit) =>
        Effect.gen(function* () {
          const up = chain(t.parent)
          const rec = yield* record(emit, [p], up, derived.at(up).settle(t).pre, t)
          const amended = Log.amend(held.log, nodeId, { products: { ...t.products, ...rec.products } })
          yield* emit({ kind: "change", ...change(held.commit(amended)) })
        }),
      )
    },
  }
}
export type Session = ReturnType<typeof makeSession>

// ───────── The action vocabulary as data: what a client sends, decoded at the trust boundary ─────────
const Id = Schema.Int
const InputSchema = Schema.Struct({
  text: Schema.String,
  note: Schema.optionalKey(Schema.String),
  pin: Schema.optionalKey(Schema.String),
})
export const Action = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("act"),
    parent: Schema.optionalKey(Schema.NullOr(Id)), // absent: under head; null: a root
    input: InputSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("greet"), greeting: Schema.optionalKey(Id) }), // a new root from the card's opening
  Schema.Struct({ kind: Schema.Literal("checkout"), node: Schema.NullOr(Id) }), // head to a version's newest leaf, or an empty line
  Schema.Struct({ kind: Schema.Literal("swipe"), node: Id }),
  Schema.Struct({ kind: Schema.Literal("reword"), node: Id, note: Schema.optionalKey(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal("edit"),
    node: Id,
    text: Schema.optionalKey(Schema.String), // the prose rewritten
    input: Schema.optionalKey(InputSchema), // the player's line revised, the prose kept
  }),
  Schema.Struct({ kind: Schema.Literal("setField"), node: Id, effects: Schema.Array(Effect_) }),
  Schema.Struct({ kind: Schema.Literal("demand"), node: Id, product: Schema.String }),
])
export type Action = typeof Action.Type
export const decodeAction = Schema.decodeUnknownSync(Action)
/** One action, one stream, whatever its kind: the synchronous ones become a single `node` event. */
export const perform = (s: Session, a: Action, stop?: Stop): Events =>
  Stream.suspend(() => {
    switch (a.kind) {
      case "act":
        return s.act(a.parent === undefined ? s.log.head : a.parent, a.input, stop)
      case "greet": {
        const g = s.greetings[a.greeting ?? 0]
        if (!g) throw new Error(`no greeting ${a.greeting ?? 0}`)
        return Stream.succeed<Event>({ kind: "change", ...s.greet(g) })
      }
      case "checkout":
        return Stream.succeed<Event>({ kind: "change", ...s.checkout(a.node) })
      case "swipe":
        return s.swipe(a.node, stop)
      case "reword":
        return s.reword(a.node, a.note, stop)
      case "edit":
        return s.edit(a.node, a)
      case "setField":
        return Stream.succeed<Event>({ kind: "change", ...s.setField(a.node, a.effects) })
      case "demand":
        return s.demand(a.node, a.product)
    }
  })
