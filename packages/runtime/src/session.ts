// A session: one card, one player layer, one connection, one log tree. Its interface is the crossing protocol the
// client speaks: player actions in (each returns the stream of events it causes, ending with the node), node
// projections out. The in-process callers (test/loop.ts, test/live.ts) and the wire adapter cross the same seam.
//
// One turn, wiring §9/§10 (beats), §13 (brief, guardrail), §14 (layered lore), §17 (record, views), §18 (head).
// Order: lookup → decide/settle loop → gate → direct → narrate → check → record. The gate runs AFTER settlement because
// a window can depend on what this turn produced (the sword cut exposes the tattoo).
// There is no tool anywhere: lookup is a structured pick over the literal enum of readable ids, actions are the decide
// stage. The model never drives a loop, so there is no tool definition to gate or to cache (§15.4 items 1–2 dissolve).
// Truncation: a narrate that finishes with "length" is re-asked once with the partial as a trailing assistant message
// when the connection declares `prefill`; the turn records the concatenation once. Current Claude rejects the prefix
// (docs/provider-reading.md §7), so on such connections the partial stands and recovery is still undecided.
// Compression (§17.3/§18.4): before each narrate, fold the leading turns in blocks; the summary is a cached code fold,
// nodes are untouched, and lore dedupe keeps working because deliveries live on the nodes, not in the view.
// Player actions on a node, each with its landing in the log tree (docs/card-reading-2.md §8 item 8): `swipe` and
// `reword` (a sibling, from lookup / from narrate), `edit` (a sibling carrying the player's prose, check and record
// rerun), `setField` (effects on the node, folded last), `demand` (a product on the node), `pick` (an option as the
// next act). A pin is not an action on a node: it rides on an act's input (`Input.pin`), the entry is forced open as a
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
  breakpoint,
  object,
  streamed,
  type CacheTtl,
  type Effort,
  type Message,
  type Model,
  type ModelError,
  type Part,
  type Usage,
} from "@effect-tavern/provider"
import { Effect, Queue, Schema, Stream } from "effect"
import { Effect_, makeCard, type Answers, type Beat, type Card, type Check, type Greeting, type State } from "./card.ts"
import { holds, type Cond, type State as Paths } from "./cond.ts"
import { decodeFragments as frags, frame, head as headOf, type Msg, type Player, type Snippet } from "./fragment.ts"
import { folded, ledger, makeSummaries, narratorHistory } from "./history.ts"
import {
  deliveredIn,
  deliveredOn,
  makeJournal,
  notesOf,
  textOf as proseOf,
  type Brief,
  type Input,
  type Turn as TurnOf,
} from "./journal.ts"
import { key, makeLore, type Disclosure } from "./lore.ts"
import {
  cap,
  decodeProducts,
  entryRef,
  fold,
  itemText,
  recallEntries,
  render,
  resolve,
  shapeSchema,
  type Product,
} from "./product.ts"

export type Turn = TurnOf<Beat>
export type Phase = "lookup" | "decide" | "direct" | "narrate" | "check" | "record"
/** A node as the client sees it: the turn plus what the path derives for it. No fragment bodies. `readable` is what the
 *  path could still be told (hooks, not bodies): the client's untold list, where a pin is picked from. */
export interface Node {
  turn: Turn
  state: State
  events: readonly string[]
  checks: readonly Check[] // this turn's judged beats, in order; what the Record's check track draws
  delivered: readonly (Disclosure & { text: string })[]
  readable: readonly { id: string; hook: string }[]
}
export type Event =
  | { kind: "stage"; phase: Phase }
  | { kind: "delta"; part: Part }
  | { kind: "call"; phase: Phase; msgs: readonly Message[]; out: unknown; usage: Usage }
  | { kind: "node"; node: Node }
export type Events = Stream.Stream<Event, ModelError>
/** A stop signal: completes when the player halts the prose (a Deferred's await on the wire). Only narrate listens. */
export type Stop = Effect.Effect<void>
type Emit = (e: Event) => Effect.Effect<void>

/** The connection as the session sees it: one Model for every stage; a real harness binds stages to connections. */
export type SessionModel = Model & {
  prefill: boolean
  reasoningBack?: boolean
  effort?: Effort
  maxOutputTokens?: number
  ttl?: CacheTtl // the head's cache lifetime; the connection's setting
}

// ───────── The session's own words ─────────
// Every instruction the loop says to the model, as fragments with ids, in the open. Data lines (State:, Actions:,
// Open:, Known:, Questions:) are format and stay in code; these are the prose around them. Resolved per id: the
// player's `asks`, then the card's, then these defaults. Lookup, direct and check carry no prose: the schema is the
// question.
export const asks = frags([
  {
    id: "decide.first",
    text: `Which card action does the player's input take first? "end" if it takes none of the listed actions. Set "again" to true only if the input's own words ask for more than one beat ("until he falls", "twice", "then …").`,
  },
  {
    id: "decide.again",
    text: `The input asked to keep going. Given the outcomes so far, pick the next action, or "end" when the input's goal is met, the input said to stop under this outcome, or nothing sensible is left.`,
  },
  { id: "narrate.correction", text: "Previous draft broke:" },
  {
    id: "input.thought",
    text: "Text between ⦅ and ⦆ in the player's input is what their character thinks: not said, not done, no one in the story perceives it.",
  },
])
// The default quick inputs: what the ecosystem's quick-reply lists and input helpers hold, as data (Player `snippets`
// goes first). A snippet fills the box and never sends; `⦅⦆` is the thought mark the ask above explains.
export const snippets: readonly Snippet[] = [
  { name: "心声", text: "⦅⦆" },
  { name: "继续", text: "继续。", note: true },
  { name: "推进剧情", text: "推进剧情到下一个场景。", note: true },
  { name: "时间流逝", text: "时间流逝，跳到下一件有事发生的时刻。", note: true },
  { name: "详细描写", text: "把这一段写得更细。", note: true },
]
// The default products (src/product.ts): what record asks for on every card unless the card patches or the player
// toggles. `notes` is the compression source and the only one on by default. A product's question is its `text`,
// overridden like any ask by the fragment id `product.<id>`.
export const defaults: readonly Product[] = decodeProducts([
  {
    id: "notes",
    text: "Notes are the record: write only the new facts this scene established (what happened, what was said that matters, what changed), each a short factual sentence. Never repeat Known, never comment on the writing.",
    shape: { kind: "list" },
    feed: true,
  },
  {
    id: "options",
    text: "Four things the player could do next, each one line in the third person, distinct in kind.",
    shape: { kind: "list", max: 4 },
    on: false,
  },
  {
    id: "inner",
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
const policy = { keep: 2, block: 2 } // ponytail: turn counts; token budget when a real tokenizer is in the loop

const sys = (content: string): Message => ({ role: "system", content })
const usr = (content: string): Message => ({ role: "user", content })
/** This turn's user message. In-fiction text when there is any; otherwise the note itself (directed prose: the
 *  player writes to the narrator, not as anyone in the story). Past note-only turns leave no user message in the
 *  transcript, so direction never becomes history. */
const said = (i: Input) => usr(i.text || i.note || "")
/** The note as a system line, only when it accompanies in-fiction text; alone, it is already the user message. */
const noteOf = (i: Input) => (i.text && i.note ? [sys(`Player note: ${i.note}`)] : [])

/** Runs an action's stream and gives back the node it ended with. */
export const outcome = <E>(events: Stream.Stream<Event, E>): Effect.Effect<Turn, E> =>
  Stream.runLast(events).pipe(
    Effect.map((last) => {
      if (last._tag === "None" || last.value.kind !== "node") throw new Error("action ended without a node")
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

export const makeSession = ({ card, player, model: M }: { card: Card; player: Player; model: SessionModel }) => {
  const rpg = makeCard(card.rules)
  const gate = (unlock: Cond, offer: Cond) => ({
    unlock: (s: Paths) => (holds(unlock, s) ? 1 : 0),
    offer: (s: Paths, ev: readonly string[]) => holds(offer, s, ev),
  })
  const L = makeLore<Paths, readonly string[]>(
    card.lore.map((e) => ({ id: e.id, layers: e.layers, ...gate(e.unlock, e.offer) })),
  )
  const journal = makeJournal<Beat>()
  const { chain } = journal
  /** What a disclosure says: a lore layer, or one item of a recall product stored on a node (`<product>@<node>#<i>`). */
  const textOf = (d: Disclosure): string => {
    const ref = entryRef(d.id)
    if (!ref) return L.text(d)
    return itemText((journal.get(ref.node).products[ref.product] as unknown[])[ref.index])
  }
  const summaries = makeSummaries<Beat>(textOf)
  let seeds = 0

  const wording = (id: string) =>
    [...(player.asks ?? []), ...(card.asks ?? []), ...asks].find((f) => f.id === id)!.text!
  const products = resolve(defaults, card.products, player.products)
  /** A thought in the input is a perception scope inside the fiction (nobody there perceives it), not a channel: it stays
   *  in history, and every stage that reads the input hears what it is, so decide takes no action from it and narrate
   *  lets no one react to it. */
  const thoughtOf = (i: Input) => (/⦅/.test(i.text) ? [sys(wording("input.thought"))] : [])
  const question = (pr: Product) =>
    [...(player.asks ?? []), ...(card.asks ?? [])].find((f) => f.id === `product.${pr.id}`)?.text ?? pr.text
  /** Feed products folded over the path, as the two lines the model reads back: Known (notes) and Current (the rest). */
  const known = (path: readonly Turn[]) => {
    const feed = products.filter((p) => p.feed && p.on)
    const cur = fold(
      feed,
      path.map((t) => t.products),
    )
    const rest = feed.filter((p) => p.id !== "notes" && cur[p.id] !== undefined)
    return {
      known: `Known: ${path.flatMap(notesOf).join("; ")}`,
      current: rest.length
        ? `Current: ${rest.map((p) => `${p.id}=${render(p.shape, cur[p.id])}`).join(" | ")}`
        : undefined,
    }
  }

  // ───────── Derived facts along a path ─────────
  // A turn's state: the opening (a greeting's effects), then beats before the prose, then readout answers after it. All
  // code folds over recorded outputs. The player's `adjust` goes last: a correction wins over everything the turn did.
  // `post` is what this turn emitted that no gate of its own could read: a greeting has no gate and a readout is answered
  // after the prose, so both open windows on the next turn.
  const settleTurn = (s: State, t: Turn) => {
    const o = t.opening ? rpg.apply(s, t.opening) : { s, events: [] as string[] }
    const b = rpg.fold(o.s, t.beats)
    const r = rpg.settleReadouts(b.s, t.answers)
    const a = t.adjust ? rpg.apply(r.s, t.adjust) : { s: r.s, events: [] as string[] }
    return {
      s: a.s,
      events: [...o.events, ...b.events, ...r.events, ...a.events],
      checks: b.checks,
      post: [...o.events, ...r.events, ...a.events],
    }
  }
  const stateAt = (path: readonly Turn[]) => path.reduce((s, t) => settleTurn(s, t).s, rpg.initial)
  const settledOf = (path: readonly Turn[], t: Turn) => settleTurn(stateAt(path.slice(0, path.indexOf(t))), t)
  /** What the path could still be told: lore entries with an unseen layer under their current one, and recalled rows
   *  not yet delivered. The lookup's enum, the node's `readable`, and where `Input.pin` picks from. */
  const readableOn = (path: readonly Turn[]) => {
    const s = stateAt(path)
    const seen = deliveredOn(path)
    const seenKeys = new Set(seen.map(key))
    const hooks = new Map(L.index(s, seen).map((e) => [e.id, e.hook]))
    const lore = card.lore.length ? L.readable(s, seen).map((id) => ({ id, hook: hooks.get(id)!, lore: true })) : []
    const recall = products
      .filter((p) => p.recall !== undefined)
      .flatMap((p) => path.flatMap((t) => recallEntries(p, t.products[p.id], t.id)))
      .filter((e) => !seenKeys.has(`${e.id}#1`))
      .map((e) => ({ id: e.id, hook: e.hook, lore: false }))
    return [...lore, ...recall]
  }
  const project = (t: Turn): Node => {
    const path = chain(t.id)
    const settled = settledOf(path, t)
    return {
      turn: t,
      state: stateAt(path),
      events: settled.events,
      checks: settled.checks,
      delivered: deliveredIn(t).map((d) => ({ ...d, text: textOf(d) })),
      readable: readableOn(path).map(({ id, hook }) => ({ id, hook })),
    }
  }
  const nodeEvent = (t: Turn): Event => ({ kind: "node", node: project(t) })

  // ───────── Views (src/fragment + src/history), as provider messages ─────────
  /** Past assistant turns go back as parts (reasoning with its signature) when the connection takes them; else as text. */
  const toP = (m: Msg): Message =>
    (m.parts && M.reasoningBack ? { role: m.role, content: m.parts } : { role: m.role, content: m.text }) as Message
  /** Head, with a cache breakpoint on its last message: player zone → frame → fiction is byte-stable across turns. */
  const head = (stage: "narrate" | "direct", state: State) => {
    const h = headOf(stage === "narrate" ? [...frame(player, card), ...card.fiction] : frame(player, card), {
      state,
    }).map(toP)
    return h.length ? [...h.slice(0, -1), breakpoint(h.at(-1)!, M.ttl)] : h
  }
  const history = (path: readonly Turn[], stage: "narrate" | "direct") => {
    if (stage === "direct") return ledger(path, (t) => settledOf(path, t).events).map(toP)
    const sum = summaries.compress(path, path.length - folded(path.length, policy.keep, policy.block))
    const h = narratorHistory(path, textOf, sum).map(toP)
    if (!h.length) return h
    // The fold is byte-stable until the boundary moves; the last message is the end of what next turn resends verbatim.
    const marked = sum ? [breakpoint(h[0]!), ...h.slice(1)] : h
    return [...marked.slice(0, -1), breakpoint(marked.at(-1)!)]
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
      const r = yield* object(M, schema, msgs, { name: phase, effort: "off", temperature: 0, maxOutputTokens })
      yield* emit({ kind: "call", phase, msgs, out: r.value, usage: r.usage })
      return r.value
    })

  /** Ids the player or the lookup named, as the disclosures they deliver: every unseen layer up to a lore entry's current
   *  one, or the one layer of a recalled product row. Already-seen ones deliver nothing. */
  const deliver = (s: State, seen: readonly Disclosure[], ids: readonly string[]): Disclosure[] => {
    const seenKeys = new Set(seen.map(key))
    return [...new Set(ids)]
      .flatMap((id) => (entryRef(id) ? [{ id, layer: 1 }] : (L.read(s, seen, id) ?? [])))
      .filter((d) => !seenKeys.has(key(d)))
  }

  const record = (
    emit: Emit,
    asked: readonly Product[],
    path: readonly Turn[],
    scene: string,
    qs?: { schema: Schema.Top; lines: string[] }, // readouts on the post-settlement state, when the card declares any
  ) =>
    Effect.gen(function* () {
      const fed = known(path)
      const msgs = [
        sys(
          [fed.known, ...(fed.current ? [fed.current] : []), ...asked.map((p) => `${p.id}: ${question(p)}`)].join("\n"),
        ),
        ...(qs ? [sys(`Questions: ${qs.lines.join("\n")}`)] : []),
        usr(scene),
      ]
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
  const turn = (
    emit: Emit,
    parent: number | null,
    input: Input,
    from: "lookup" | "narrate" | "check",
    base?: Turn,
    stop?: Stop,
  ) =>
    Effect.gen(function* () {
      const path = chain(parent)
      const s0 = stateAt(path)
      const seen = deliveredOn(path)
      // lookup: a structured pick over the literal enum of readable ids: lore entries with an unseen layer, plus the
      // items of recall products stored on the path and not yet delivered (model-written memory walks the same road as
      // lore). Nothing to pick → no call.
      // The pin: the entry's next unseen layer, forced open below, so the lookup is not offered it as well.
      const forced = input.pin === undefined ? [] : deliver(s0, seen, [input.pin]).slice(0, 1)
      if (input.pin !== undefined && !forced.length) throw new Error(`${input.pin}: nothing to pin`)
      const untold = readableOn(path).filter((e) => e.id !== input.pin)
      const idx = untold.map((e) => e.id)
      const disclosures =
        from !== "lookup"
          ? base!.read
          : deliver(
              s0,
              seen,
              idx.length
                ? (yield* obj(emit, "lookup", Lookup(idx), [
                    sys(`Index: ${untold.map((e) => (e.lore ? e.id : `${e.id}=${e.hook}`)).join(", ")}`),
                    said(input),
                  ])).read
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
          const d = yield* obj(emit, "decide", rpg.decideSchema(s), [
            ...head("direct", s),
            ...history(path, "direct"),
            sys(
              `${q}\nState: ${JSON.stringify(s)}\nActions: ${rpg.menu(s).join(" | ")}\nSo far: ${events.join(",") || "-"}`,
            ),
            ...thoughtOf(input),
            said(input),
          ])
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
      // gate: after settlement, on this turn's beat events plus what the turn before emitted after its own gate (readout
      // events; a greeting's opening events). Without the carry a readout-only card never opened a window at all (found
      // by the yandao card: no beat events). Director only if the card has one and something is open.
      const prev = path.at(-1)
      const carried = prev ? settleTurn(stateAt(path.slice(0, -1)), prev).post : []
      const gateEvents = [...events, ...carried]
      // The window's state carries each entry's derived counters under `lore.<id>` (since / shown), this turn's reads
      // counting as shown now; a card field named `lore` would collide, so none may be.
      const gateState = { ...s1, lore: L.counters([...path.map(deliveredIn), disclosures]) }
      const offered = L.offers(gateState, deliveredOn(path, disclosures), gateEvents).map(({ id, layer }) => ({
        id,
        layer,
      }))
      // The pinned entry is open with its forced layer and MUST be told, director or not: check verifies it, a miss is
      // the one correction rewrite, and an entry still unfired after that stays untold.
      const open: Disclosure[] = [...forced, ...offered.filter((d) => !forced.some((f) => f.id === d.id))]
      const openIds = open.map((d) => d.id)
      const mustIds = forced.map((d) => d.id)
      const briefed: Brief =
        from !== "lookup"
          ? base!.brief
          : card.director && offered.length
            ? yield* obj(emit, "direct", BriefOf(openIds), [
                ...head("direct", s1),
                ...card.guard.map((r) => sys(`Rule: ${r}`)),
                ...history(path, "direct"),
                sys(`Open: ${open.map((d) => `${d.id}=${textOf(d)}`).join(" | ")}\nEvents: ${gateEvents.join(",")}`),
                ...noteOf(input),
                said(input),
              ])
            : { must: [], may: openIds }
      const brief: Brief = {
        ...briefed,
        must: [...new Set([...mustIds, ...briefed.must])],
        may: briefed.may.filter((id) => !mustIds.includes(id)),
      }
      // narrate, streamed, with truncation recovery and at most one correction rewrite
      const fed = known(path)
      const tail = [
        ...disclosures.map((d) => sys(textOf(d))),
        ...(events.length ? [sys(`Outcome: ${events.join(", ")}`)] : []),
        ...(fed.current ? [sys(fed.current)] : []), // feed products other than notes: where the scene stands, as data
        ...open.filter((d) => brief.must.includes(d.id)).map((d) => sys(`MUST reveal: ${textOf(d)}`)),
        ...open.filter((d) => brief.may.includes(d.id)).map((d) => sys(`MAY reveal: ${textOf(d)}`)),
        ...(brief.tone ? [sys(`Tone: ${brief.tone}`)] : []),
        ...noteOf(input),
        ...thoughtOf(input),
      ]
      // No output cap by default: the model's own limit (128k on Haiku) is the ceiling. A cap is connection config.
      const opts = { name: "narrate", maxOutputTokens: M.maxOutputTokens, effort: M.effort }
      // A stopped stream ends after the current pull without the `finish` part: the text so far is the reply, usage unknown.
      let cut = false
      const write = (msgs: Message[]) =>
        Effect.gen(function* () {
          yield* emit({ kind: "stage", phase: "narrate" })
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
          yield* emit({ kind: "call", phase: "narrate", msgs, out: r.text, usage: r.usage })
          return r
        })
      const narrate = (correction?: string) =>
        Effect.gen(function* () {
          // This turn's directives follow the player's input: Anthropic accepts a mid-conversation system message only
          // directly after a user message (verified live), and it is the one placement all three formats take.
          const msgs = [
            ...head("narrate", s1),
            ...history(path, "narrate"),
            said(input),
            ...tail,
            ...(correction ? [sys(correction)] : []),
          ]
          const r = yield* write(msgs)
          if (r.finishReason !== "length" || !M.prefill) return r.parts
          const r2 = yield* write([...msgs, { role: "assistant", content: r.text }]) // resume with the partial as prefix
          return [...r.parts, ...r2.parts]
        })
      let reply = from === "check" ? base!.reply : yield* narrate()
      let fired: Disclosure[] = []
      let violated: string[] = []
      if (!cut && (card.guard.length > 0 || open.length > 0)) {
        const check = (text: string) =>
          obj(emit, "check", Check(openIds, card.guard), [
            ...card.guard.map((r) => sys(`Rule: ${r}`)),
            sys(`Open: ${openIds.join(",")}\nMust: ${brief.must.join(",")}`),
            usr(text),
          ]).pipe(
            Effect.map((c) => {
              const r = c as { fired?: readonly string[]; violated?: readonly string[] }
              return { fired: r.fired ?? [], violated: r.violated ?? [] }
            }),
          )
        let c = yield* check(proseOf(reply))
        const missed = brief.must.filter((id) => !c.fired.includes(id))
        if (c.violated.length || missed.length) {
          reply = yield* narrate(
            `${wording("narrate.correction")} ${[...c.violated.map((r) => `rule "${r}"`), ...missed.map((m) => `missed MUST ${m}`)].join("; ")}`,
          )
          c = yield* check(proseOf(reply))
        }
        fired = open.filter((d) => c.fired.includes(d.id))
        violated = [...c.violated]
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
        `${input.text}\n${proseOf(reply)}`,
        qs ? { schema: qs, lines: rpg.questions(s1) } : undefined,
      )
      const answers = (rec.answers ?? {}) as Answers
      rpg.settleReadouts(s1, answers) // validate now, not on the first replay
      const node = journal.save({
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
        products: rec.products,
      })
      yield* emit(nodeEvent(node))
    })
  const sibling = (nodeId: number, from: "lookup" | "narrate" | "check", patch?: Partial<Turn>, stop?: Stop) => {
    const t = journal.get(nodeId)
    return emitting((emit) => turn(emit, t.parent, t.input, from, { ...t, ...patch }, stop))
  }

  return {
    /** A greeting node: the card's opening as a root, with no player input; its `do` is the node's opening. */
    greet: (g: Greeting): Node =>
      project(
        journal.save({
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
    node: (id: number): Node => project(journal.get(id)),
    /** The card's rules as data, for a client that draws state: field bounds and options, action ids. Static per session. */
    rules: card.rules,
    /** What the client's chrome shows about the card: the title. Not the card: fragment bodies stay on the server. */
    meta: { id: card.id, title: card.title ?? card.id },
    nodes: (): Turn[] => [...journal.values()],
    snippets: [...(player.snippets ?? []), ...snippets] as readonly Snippet[],
    get size() {
      return journal.size
    },
    /** The player's turn: a child of `parent` (null for a root), every stage the card declares. */
    act: (parent: number | null, input: Input, stop?: Stop): Events =>
      emitting((emit) => turn(emit, parent, input, "lookup", undefined, stop)),
    // Siblings: the same input under the same parent, started at a later stage. Nothing of the original is reused
    // except what the stage order already fixed before the start point.
    swipe: (nodeId: number, stop?: Stop): Events => sibling(nodeId, "lookup", undefined, stop),
    reword: (nodeId: number, stop?: Stop): Events => sibling(nodeId, "narrate", undefined, stop),
    /** The player rewrites the prose: a sibling carrying their text as the reply; check and record run over it, so what
     *  enters the record is only what the edit fired and answered (README §5 direction 3). */
    edit: (nodeId: number, text: string): Events => sibling(nodeId, "check", { reply: [{ type: "text", text }] }),
    /** The player sets fields on a node (a status bar's +/-): effects appended to the node's `adjust`, validated against
     *  the card's bounds and enums now, replayed in the fold after everything the turn itself did. Every descendant sees
     *  it. A value outside the field throws and leaves the node as it was. */
    setField: (nodeId: number, effects: readonly (typeof Effect_.Type)[]): Node => {
      const t = journal.get(nodeId)
      const adjust = [...(t.adjust ?? []), ...effects]
      settleTurn(stateAt(chain(t.parent)), { ...t, adjust })
      return project(journal.amend(nodeId, { adjust }))
    },
    /** The player picks one of a node's `options`: it is their next act, a child turn like any typed input. */
    pick: (nodeId: number, i: number, stop?: Stop): Events => {
      const text = (journal.get(nodeId).products.options as readonly string[] | undefined)?.[i]
      if (text === undefined) throw new Error(`no option ${i} on node ${nodeId}`)
      return emitting((emit) => turn(emit, nodeId, { text }, "lookup", undefined, stop))
    },
    /** A player action on a node: ask for one product (on or off) over that node's scene, and keep it on the node. Not a
     *  turn, not in the transcript; replay reads it back like any recorded output. The first instance is the "inner
     *  forum" kind of card (docs/card-reading-2.md §2). */
    demand: (nodeId: number, productId: string): Events => {
      const t = journal.get(nodeId)
      const p = products.find((x) => x.id === productId)
      if (!p) throw new Error(`${productId}: not a product of this card`)
      return emitting((emit) =>
        Effect.gen(function* () {
          const rec = yield* record(emit, [p], chain(t.parent), `${t.input.text}\n${proseOf(t.reply)}`)
          yield* emit(nodeEvent(journal.amend(nodeId, { products: { ...t.products, ...rec.products } })))
        }),
      )
    },
  }
}
export type Session = ReturnType<typeof makeSession>

// ───────── The action vocabulary as data: what a client sends, decoded at the trust boundary ─────────
const Id = Schema.Int
export const Action = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("act"),
    parent: Schema.NullOr(Id),
    input: Schema.Struct({
      text: Schema.String,
      note: Schema.optionalKey(Schema.String),
      pin: Schema.optionalKey(Schema.String),
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("swipe"), node: Id }),
  Schema.Struct({ kind: Schema.Literal("reword"), node: Id }),
  Schema.Struct({ kind: Schema.Literal("edit"), node: Id, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setField"), node: Id, effects: Schema.Array(Effect_) }),
  Schema.Struct({ kind: Schema.Literal("pick"), node: Id, option: Id }),
  Schema.Struct({ kind: Schema.Literal("demand"), node: Id, product: Schema.String }),
])
export type Action = typeof Action.Type
export const decodeAction = Schema.decodeUnknownSync(Action)
/** One action, one stream, whatever its kind: the synchronous ones become a single `node` event. */
export const perform = (s: Session, a: Action, stop?: Stop): Events =>
  Stream.suspend(() => {
    switch (a.kind) {
      case "act":
        return s.act(a.parent, a.input, stop)
      case "swipe":
        return s.swipe(a.node, stop)
      case "reword":
        return s.reword(a.node, stop)
      case "edit":
        return s.edit(a.node, a.text)
      case "setField":
        return Stream.succeed<Event>({ kind: "node", node: s.setField(a.node, a.effects) })
      case "pick":
        return s.pick(a.node, a.option, stop)
      case "demand":
        return s.demand(a.node, a.product)
    }
  })
