// A session: one card, the player's rows (layer.ts), one connection, one log tree. Its interface is the crossing protocol the
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
// wording or brushes a guard rule is the price, and `switches.polish: false` turns the stage off.
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
// either: the client fills the box with it and the player sends it as an act. Entry invocations ride on that input.
// "Continue" is not a kind: with no output cap the model ends where
// it ends, and "go on" is an note turn. Stop has two meanings by stage: before the prose starts, the action is
// interrupted and leaves nothing; once it streams, `stop` halts the prose where it is, check is skipped (the player cut
// the draft, not the model), record runs, and the node is saved with `end: "stopped"`, so "go on" has a node to follow.
// Cache (docs/provider-reading.md §6 item 3): three breakpoints, where the request stops being byte-stable across turns:
// the end of the head (the connection's TTL: 1h for a person), the folded summary, and the last history message
// before this turn's input. The transcript is append-only, so everything before the input is a cached read next turn;
// no padding for the model's minimum prefix, which a head plus one turn crosses on its own.
// Events: `stage` when a stage begins, `delta` for each narrate part as it streams, `call` when a call returns (the
// request, the answer, the cost: what the inspector shows), `node` when a node is saved or amended. A product's road
// is its stage: a narrate block streams as `product-delta` parts, split live off the prose (journal.ts `splitter`),
// a record product arrives whole with record's `call`. The node's reply and blocks come from the landed split.
// Errors: a model failure is a `ModelError` on the stream; an action that names what does not exist (a node, an
// option, a product, a value outside a field) is a defect, the caller's bug.
import {
  object,
  streamed,
  text as whole,
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
import { head as headOf, type Hat } from "./fragment.ts"
import { narratorHistory, policyFor, type Policy } from "./history.ts"
import {
  deliveredOn,
  split,
  splitter,
  textOf as proseOf,
  type Brief,
  type Input,
  type Turn as TurnOf,
} from "./journal.ts"
import * as Log from "./log.ts"
import { resolve, shown, type Resolved, type Rows } from "./layer.ts"
import { key, makeLore, type Disclosure, type Lore } from "./lore.ts"
import { expand, fill, unfilled } from "./names.ts"
import { marked, scan, splice } from "./polish.ts"
import { request, type Ask, type Told } from "./request.ts"
import { cap, entryRef, fold, shapeSchema, type Product } from "./product.ts"

export type Turn = TurnOf<Beat>
export const phases = ["lookup", "decide", "direct", "narrate", "check", "polish", "record"] as const
export type Phase = (typeof phases)[number]
export type { Node } from "./derived.ts" // the node projection lives with the facts it carries; the client imports it here
export type Event =
  | { kind: "stage"; phase: Phase }
  | { kind: "delta"; part: Part | ProductDelta }
  | { kind: "call"; phase: Phase; msgs: readonly Message[]; out: unknown; usage: Usage; ms: number }
  | ({ kind: "change" } & Change) // the log moved: a node landed or was amended, nodes dropped, and where head is now
/** A narrate block's text as it streams, beside the provider's `text-delta`: the block `<<aside>> <id>` opened. */
export type ProductDelta = { type: "product-delta"; id: string; text: string }
export type Events = Stream.Stream<Event, ModelError>
export type Change = Log.Change<Node>
/** A stop signal: completes when the player halts the prose (a Deferred's await on the wire). Only narrate listens. */
export type Stop = Effect.Effect<void>
type Emit = (e: Event) => Effect.Effect<void>

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
 *  A defect in the body (an invalid action found mid-turn, such as an unavailable invocation) fails the stream too;
 *  swallowing it would leave the stream open forever. */
const emitting = (body: (emit: Emit) => Effect.Effect<unknown, ModelError>): Events =>
  Stream.callback<Event, ModelError>((q) =>
    Effect.exit(body((e) => Effect.asVoid(Queue.offer(q, e)))).pipe(
      Effect.andThen((x) => (x._tag === "Success" ? Queue.end(q) : Queue.failCause(q, x.cause))),
    ),
  )

/** What a card is, read off its structure (design/new-story-and-tags.md §5.1): the harness's closed vocabulary (the
 *  player's own filing words are `Local.tags`, #133). `mode` is the default channel; each flag is whether the card has that mechanism (a
 *  visible field, an action, a readout, a lore entry, more than one opening); `tokens` is what the card's own text
 *  costs each turn, estimated (tokens.ts): every frame and fiction fragment, as if all held. The keys are
 *  identifiers; a client draws them in its own words. Feeds both GET /cards rows and `cardView`. */
export const facets = (card: Card) => ({
  mode: card.input ?? "act",
  fields: card.rules.fields.some((f) => !f.hidden),
  actions: card.rules.actions.length > 0,
  readouts: !!card.rules.readouts?.length,
  lore: card.lore.length > 0,
  openings: card.greetings.length > 1,
  tokens: tokens([...card.frame, ...card.fiction].map((f) => f.text ?? "").join("\n")),
})
export type Facets = ReturnType<typeof facets>

/** What a client draws a card by (server GET /card, GET /cards/<id>): read off the Card and the player's rows alone, so
 *  the card page opens before any story of the card exists. Not the card: fragment bodies, guard lines and lore stay on
 *  the server (a ban is a prompt, to a player too). `layer` is the one merge (layer.ts), a card's items without their text:
 *  a client merges nothing. */
export const cardView = (card: Card, rows: Rows = {}) => {
  const f = facets(card) // once: the shelf row's facets and the head size are the same reading
  return {
    // its name and one line, the turn-heading reference, and its size as numbers. `input` is the card's default channel,
    // the one client-facing coordinate of participant vs author mode: on `act` the box is the player's line and a note or
    // a thought is this turn's deviation; on `note` every input is direction.
    meta: {
      id: card.id,
      title: card.title ?? card.id,
      summary: card.summary,
      heading: card.heading,
      input: f.mode,
      director: !!card.director,
      guard: card.guard.length,
      lore: { entries: card.lore.length, layers: card.lore.reduce((n, e) => n + e.layers.length, 0) }, // the card's size; what is readable now is on the node
      tokens: { head: f.tokens }, // what the card's own text costs each turn, estimated (`facets`)
      facets: f, // what the card is: the shelf's `#facet` filter, the same function GET /cards rows read
    }, // leaves as JSON, which drops undefined
    greetings: card.greetings,
    rules: card.rules,
    // the fiction's modules without their text: id, shown name, and the state condition that makes one a variant
    fiction: card.fiction.map(({ id, label, when }) => ({ id, label, when })),
    layer: shown(resolve(card, rows)),
  }
}

export const makeSession = ({
  card,
  rows,
  model: modelFor,
  store,
  hat,
  policy: P = policyFor(),
}: {
  card: Card
  rows: () => Rows // the player's rows on this card, read on every request (library.ts)
  /** The model each stage runs on (provider `bind`), asked on every call like `hat`: the library's routing, in force
   *  from the next request. lookup and check can take a light model; record answers readouts (state judgement), not
   *  pure extraction: never route it down by default. */
  model: (phase: Phase) => Model
  store?: Log.Store<Turn> // the log's persistence; none = in memory
  hat?: (id: string) => Hat | undefined // a connection's hat by id, read per request (library.ts); none = no hat
  // the fold boundary, a value or read on every fold (library.ts: the narrate model's window, so a routing edit is in
  // force from the next request); tests pass a small budget to fold short scripted prose
  policy?: Policy | (() => Policy)
}) => {
  const rpg = makeCard(card.rules)
  const cardLore = card.lore.map((e) => ({ id: e.id, layers: e.layers, invoke: e.invoke, ...gateOf(e.id, e.offer) }))
  /** The layer and the lookup index this request stands on: `resolve` once, from every session entry (`fresh`) until the
   *  next, so a snapshot's nodes read one index and a turn's stages one layer. A request landing mid-turn moves the turn
   *  onto the rows it read, which is no worse than each stage reading its own. The index is the card's lore and the
   *  player layer's entries, expanded: an entry with an unfilled hole in any layer is not in it, and a node that already
   *  told it replays "" (lore.ts `text`). */
  let now: { R: Resolved; I: Lore<Paths, readonly string[]> } | undefined
  const current = () => {
    if (now) return now
    const R = resolve(card, rows())
    const I = makeLore<Paths, readonly string[]>([
      ...cardLore.flatMap((e) => {
        const layers = e.layers.map((l) => expand(l, R.names))
        return layers.includes(undefined) ? [] : [{ ...e, layers: layers as string[] }]
      }),
      ...R.entries.map((e) => ({ id: e.id, layers: [e.text], invoke: e.invoke, unlock: () => 1 })),
    ])
    return (now = { R, I })
  }
  const layer = () => current().R
  const L = () => current().I
  const fresh = () => void (now = undefined)
  /** A text that must go out whole, or the action is refused, naming the hole. */
  const named = (what: string, text: string) => {
    const N = layer().names
    const out = expand(text, N)
    if (out === undefined)
      throw new Error(
        `${what}: unfilled ${unfilled(text, N)
          .map((k) => `{{${k}}}`)
          .join(", ")}`,
      )
    return out
  }
  const held = Log.hold<Turn>(store)
  const chain = (id: number | null) => Log.chain(held.log, id)
  const turnOf = (id: number) => Log.get(held.log, id)
  let seeds = [...held.log.nodes.values()].reduce((n, t) => t.beats.reduce((n, b) => Math.max(n, b.seed), n), 0)
  let policy: Policy | undefined // one read for a synchronous snapshot; never retained across requests
  const policyOf = () => (typeof P === "function" ? P() : P)

  const wording = (id: string) => layer().asks[id]!.text
  const products = () => layer().products
  products() // a card's bad patch fails when the session opens, not on its first turn
  /** Narrate blocks under the declared product's cap; a block of an undeclared id is kept as written (the Inspector's). */
  const capped = (bs: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(bs).map(([id, v]) => {
        const p = products().find((x) => x.id === id)
        return [id, p ? cap(p.shape, v) : v]
      }),
    )
  // ───────── Derived facts along a path (src/derived.ts) ─────────
  const derived = makeDerived({
    rpg,
    L,
    lore: card.lore,
    products,
    policy: () => policy ?? policyOf(),
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
    const { frame, tail, names: N } = layer()
    const worn = M.hat === undefined ? undefined : hat?.(M.hat)
    return request(
      {
        frame: headOf(frame, { state }),
        tail: headOf(tail, { state }),
        input,
        thought: wording("input.thought"),
      },
      a.stage === "narrate"
        ? {
            ...a,
            always: layer()
              .entries.filter((e) => e.invoke === "always")
              .map((e) => e.text),
          }
        : a,
      {
        reasoningBack: M.reasoningBack,
        ttl: M.ttl,
        ...(worn && {
          hat: {
            ...worn,
            narrate: { head: fill(worn.narrate?.head ?? [], N), tail: fill(worn.narrate?.tail ?? [], N) },
            review: { head: fill(worn.review?.head ?? [], N) },
          },
        }),
      },
    )
  }
  /** The fiction at this state, expanded: narrate's alone. */
  const fictionAt = (state: State) => headOf(fill(card.fiction, layer().names), { state })

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
  const deliver = (
    s: Paths,
    told: readonly Disclosure[],
    seen: readonly Disclosure[],
    ids: readonly string[],
  ): Disclosure[] => {
    const seenKeys = new Set(seen.map(key))
    const I = L()
    return [...new Set(ids)]
      .flatMap((id) => (entryRef(id) ? [{ id, layer: 1 }] : (I.read(s, told, seen, id) ?? [])))
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
        asks: asked.map((p) => `${p.id}: ${p.text}`),
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

  /** A narrate product demanded on a node: one prose call over narrate's view of the path up to and including the
   *  node (its prose is the last reply), asking for that one block alone. A reply without the delimiter is the block. */
  // ponytail: lands whole; stream the demand block as product deltas when a long one keeps the player waiting
  const block = (emit: Emit, p: Product, path: readonly Turn[], state: State) =>
    Effect.gen(function* () {
      const here = derived.at(path)
      const sum = here.summary()
      const msgs = ask(
        state,
        { text: "", note: wording("narrate.demand") },
        {
          stage: "narrate",
          fiction: fictionAt(state),
          history: narratorHistory(path, here.text, sum),
          summarized: sum !== undefined,
          told: [],
          outcome: [],
          current: here.known().current,
          must: [],
          may: [],
          blocks: { question: wording("narrate.blocks"), asks: [`${p.id}: ${p.text}`] },
        },
      )
      const M = modelFor("narrate")
      yield* emit({ kind: "stage", phase: "narrate" })
      const t0 = Date.now()
      const r = yield* whole(M, msgs, { name: "narrate", maxOutputTokens: M.maxOutputTokens, effort: M.effort })
      yield* emit({ kind: "call", phase: "narrate", msgs, out: r.text, usage: r.usage, ms: Date.now() - t0 })
      const { reply, blocks } = split(r.parts)
      return capped({ [p.id]: blocks[p.id] ?? proseOf(reply).trim() })
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
      if (from !== "check" && !input.text && !input.note && !input.invoke?.length)
        throw new Error(base ? `node ${base.id}: nothing to rerun` : "empty input")
      fresh()
      const path = chain(parent)
      const here = derived.at(path)
      const told = (ds: readonly Disclosure[]): Told[] => ds.map((d) => ({ id: d.id, text: here.text(d) }))
      // the guard lines expanded, one with an unfilled hole skipped: what the director and check read, and check's enum
      const guard = card.guard.flatMap((g) => expand(g, layer().names) ?? [])
      const s0 = here.state
      const g0 = here.gated()
      const seen = deliveredOn(path.slice(here.fold()))
      const all = deliveredOn(path)
      // lookup: a structured pick over the literal enum of readable ids: lore entries with an unseen layer, plus the
      // items of recall products stored on the path and not yet delivered (model-written memory walks the same road as
      // lore). Nothing to pick → no call.
      const invoked = [...new Set(input.invoke ?? [])]
      const candidates = here.invocable()
      for (const id of invoked)
        if (!candidates.some((e) => e.id === id) && !base?.input.invoke?.includes(id))
          throw new Error(`${id}: not invocable`)
      const automatic = invoked.filter((id) => candidates.some((e) => e.id === id && e.invoke === "auto"))
      const manual = invoked.flatMap((id) => {
        const e = L().entries.find((e) => e.id === id && e.invoke === "manual")
        return e ? [(L().read(g0, all, [], id) ?? []).map(L().text).filter(Boolean).join("\n\n")].filter(Boolean) : []
      })
      const selected = deliver(g0, all, seen, automatic)
      const untold = here.readable().filter((e) => !invoked.includes(e.id))
      const idx = untold.map((e) => e.id)
      // A chip-only turn supplies context, not a player line for lookup or action judgement.
      const hasInput = !!(input.text || input.note)
      const looked =
        from !== "lookup"
          ? base!.read
          : deliver(
              g0,
              all,
              seen,
              hasInput && idx.length
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
      if (hasInput && card.rules.actions.length && from === "lookup") {
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
      // (derived.ts `gate`). Director only if the card has one and something is open.
      const gateEvents = [...events, ...here.post]
      const { offered, disclosures, open } = here.gate({
        state: s1,
        events,
        before: [...looked, ...selected],
      })
      const openIds = [...new Set(open.map((d) => d.id))] // Literals(openIds) below: a duplicate must never reach it
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
                  question: wording("direct"),
                  ledger: here.ledger(),
                  rules: guard,
                  open: told(open),
                  events: gateEvents,
                }),
              )
            : { must: [], may: openIds }
      const brief = briefed
      // narrate, streamed, with truncation recovery and at most one correction rewrite
      const fed = here.known()
      const sum = here.summary()
      // the narrate products on this turn: one ask line each in narrate's tail, each block cut off the reply
      const penned = products().filter(
        (p) => p.stage === "narrate" && p.on && (!p.when || holds(p.when, s1)) && !p.unasked,
      )
      // No output cap by default: the model's own limit (128k on Haiku) is the ceiling. A cap is connection config.
      const M = modelFor("narrate")
      const opts = { name: "narrate", maxOutputTokens: M.maxOutputTokens, effort: M.effort }
      // A stopped stream ends after the current pull without the `finish` part: the text so far is the reply, usage unknown.
      let cut = false
      // The deltas go out split live: prose as `text-delta`, a block's text as `product-delta`, the delimiter line never.
      const write = (msgs: Message[], live: ReturnType<typeof splitter>) =>
        Effect.gen(function* () {
          yield* emit({ kind: "stage", phase: "narrate" })
          const t0 = Date.now()
          const { parts, reply } = yield* streamed(M, msgs, opts)
          let text = ""
          let finished = false
          const pieces = (chunk: string, end?: boolean) =>
            Effect.forEach(live(chunk, end), (p) =>
              emit({
                kind: "delta",
                part:
                  p.id === undefined
                    ? { type: "text-delta", id: "0", text: p.text }
                    : { type: "product-delta", id: p.id, text: p.text },
              }),
            )
          yield* Stream.runForEach(stop ? parts.pipe(Stream.haltWhen(stop)) : parts, (part) => {
            if (part.type === "text-delta") text += part.text
            if (part.type === "finish") finished = true
            return part.type === "text-delta"
              ? pieces(part.text)
              : part.type === "reasoning-delta"
                ? emit({ kind: "delta", part })
                : Effect.void
          })
          yield* pieces("", true) // a line still held at the end resolves now
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
            fiction: fictionAt(s1),
            history: narratorHistory(path, here.text, sum),
            summarized: sum !== undefined,
            manual,
            told: disclosures.map(here.text).filter(Boolean), // a sibling's reused read may name an entry since gone
            outcome: events,
            current: fed.current, // feed products other than notes: where the scene stands, as data
            must: told(open.filter((d) => brief.must.includes(d.id))),
            may: told(open.filter((d) => brief.may.includes(d.id))),
            tone: brief.tone,
            correction,
            blocks: { question: wording("narrate.blocks"), asks: penned.map((p) => `${p.id}: ${p.text}`) },
          })
          const live = splitter() // one draft, one cut, across a resumed write
          const r = yield* write(msgs, live)
          if (r.finishReason !== "length" || !M.prefill) return split(r.parts)
          const r2 = yield* write([...msgs, { role: "assistant", content: r.text }], live) // resume with the partial as prefix
          return split([...r.parts, ...r2.parts])
        })
      // an edit keeps the player's prose and writes no block
      let { reply, blocks: written } = from === "check" ? { reply: base!.reply, blocks: {} } : yield* narrate()
      let fired: Disclosure[] = []
      let violated: string[] = []
      if (!cut && (guard.length > 0 || open.length > 0)) {
        const check = (text: string) =>
          obj(
            emit,
            "check",
            Check(openIds, guard),
            ask(s1, input, { stage: "check", rules: guard, open: told(open), must: brief.must, prose: text }),
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
          if (!cut || proseOf(again.reply)) {
            reply = again.reply
            written = again.blocks
            c = cut ? { fired: [], violated: [] } : yield* check(proseOf(reply))
          }
        }
        fired = open.filter((d) => c.fired.includes(d.id))
        violated = [...c.violated]
      }
      // polish: code scans the final prose for the lexicon (layer.ts: the highest rank's first); hit sentences go to one call
      // keyed by target id, and only the answers that differ from their sentence are spliced into the prose. Never on a
      // cut draft or the player's own prose (an edit), same as the correction. The other parts (reasoning) stand.
      const text = proseOf(reply)
      const targets =
        cut || from === "check" || layer().switches.value.polish === false ? [] : scan(text, layer().lexicon)
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
      const asked = products().filter(
        (p) => p.stage !== "narrate" && p.on && (!p.when || holds(p.when, s1)) && !p.unasked,
      )
      const N = layer().names
      const qs = card.rules.readouts?.length ? rpg.readoutSchema(s1, N) : undefined
      const rec = yield* record(
        emit,
        asked,
        path,
        s1,
        { input, reply },
        qs ? { schema: qs, lines: rpg.questions(s1, N) } : undefined,
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
        products: { ...capped(written), ...rec.products },
      })
      yield* emit({ kind: "change", ...change(held.commit(c)) })
    })
  const sibling = (nodeId: number, from: "lookup" | "narrate" | "check", patch?: Partial<Turn>, stop?: Stop) => {
    const base = { ...turnOf(nodeId), ...patch }
    return emitting((emit) => turn(emit, base.parent, base.input, from, base, stop))
  }

  return {
    /** A greeting node: the card's opening as a root, with no player input; its `do` is the node's opening. */
    greet: (g: Greeting): Change => {
      fresh()
      return change(
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
            reply: [{ type: "text", text: named("opening", g.text) }], // the transcript holds the names as they stand now
            fired: [],
            violated: [],
            products: {},
          }),
        ),
      )
    },
    node: (id: number): Node => {
      fresh()
      return project(turnOf(id))
    },
    /** Every node projected, and head: what a client opens with. */
    snapshot: (): Log.Snapshot<Node> => {
      fresh()
      policy = policyOf()
      try {
        return { nodes: [...held.log.nodes.values()].map(project), head: held.log.head, next: held.log.next }
      } finally {
        policy = undefined
      }
    },
    /** The log as it stands: head, and every turn by id. */
    get log() {
      return held.log
    },
    /** Head moves to a version's newest leaf (its whole follow-up comes back), or to null: an empty line. */
    checkout: (id: number | null): Change => {
      fresh()
      return change(held.commit(Log.checkout(held.log, id)))
    },
    /** The card's openings, for the greet action: a new thread is a new root, so the client asks for one by index. */
    greetings: card.greetings,
    /** A node and its descendants gone for good: deleting a thread is dropping its root. */
    drop: (id: number): Change => {
      fresh()
      return change(held.commit(Log.drop(held.log, id)))
    },
    /** The card's rules as data, for a client that draws state: field bounds and options, action ids. Static per session. */
    rules: card.rules,
    /** The card's name and size (`cardView`). Static per session. */
    meta: cardView(card).meta,
    /** The layer as it stands: what a next request stands on, read fresh. */
    get layer(): Resolved {
      fresh()
      return layer()
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
      fresh()
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
      fresh()
      const t = turnOf(nodeId)
      const adjust = [...(t.adjust ?? []), ...effects]
      const amended = Log.amend(held.log, nodeId, { adjust })
      const next = amended[0]
      const affected = new Set([nodeId])
      for (const t of [...next.nodes.values()].sort((a, b) => a.id - b.id)) {
        if (t.id !== nodeId && (t.parent === null || !affected.has(t.parent))) continue
        derived.at(Log.chain(next, t.parent)).settle(t)
        affected.add(t.id)
      }
      return change(held.commit(amended))
    },
    /** A player action on a node: ask for one product (on or off) over that node's scene, and keep it on the node. Not a
     *  turn, not in the transcript; replay reads it back like any recorded output. The first instance is the "inner
     *  forum" kind of card (docs/card-reading-2.md §2). */
    demand: (nodeId: number, productId: string): Events => {
      fresh()
      const t = turnOf(nodeId)
      const p = products().find((x) => x.id === productId)
      if (!p) throw new Error(`${productId}: not a product of this card`)
      named(productId, p.text) // an unasked product keeps its raw text: the refusal names the hole
      return emitting((emit) =>
        Effect.gen(function* () {
          const up = chain(t.parent)
          const pre = derived.at(up).settle(t).pre
          const got =
            p.stage === "narrate"
              ? yield* block(emit, p, chain(nodeId), pre)
              : (yield* record(emit, [p], up, pre, t)).products
          const amended = Log.amend(held.log, nodeId, { products: { ...t.products, ...got } })
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
  invoke: Schema.optionalKey(Schema.Array(Schema.String)),
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
