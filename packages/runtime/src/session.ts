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
// record uses an attempt-local transaction; lookup uses native read-only tools and revisioned context snapshots.
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
// Names (names.ts): no action waits for a name. A hole the card's own text leaves open goes out as the literal `{{key}}`
// (an opening, a guard line, the fiction); only a player's entry with one stays out, and `demand` on such a product refuses.
import { timelineNode, turnDetail, type ActiveContextView, type TimelineNode } from "./projection.ts"
import {
  contextLookup,
  deliveryText,
  freeze,
  latest,
  loreResource,
  uniqueDeliveries,
  type DeliverySnapshot,
} from "./context.ts"
import {
  blocked,
  decide,
  object,
  runStageTools,
  ModelError,
  streamed,
  text as whole,
  type Message,
  type Model,
  type Part,
  type Usage,
  type StageEvent,
  type StageOptions,
  type DecisionModel,
} from "@effect-tavern/provider"
import { Deferred, Effect, Queue, Schema, Stream } from "effect"
import { tokens } from "./tokens.ts"
import { Effect_, makeCard, shownGreeting, type Beat, type Card, type Greeting, type State } from "./card.ts"
import { holds, expandState, type State as Paths } from "./cond.ts"
import { gateOf, makeDerived, type Node } from "./derived.ts"
import { head as headOf, type Hat } from "./fragment.ts"
import { narratorHistory, policyFor, type Policy } from "./history.ts"
import { split, splitter, textOf as proseOf, type Brief, type Input, type Turn as TurnOf } from "./journal.ts"
import * as Log from "./log.ts"
import { resolve, shown, worldOf, type Resolved, type Rows } from "./layer.ts"
import { makeLore, namedLore, type Disclosure, type Lore } from "./lore.ts"
import { lines, expand, fill, unfilled } from "./names.ts"
import { marked, scan, splice } from "./polish.ts"
import { request, worldBlock, type Ask, type Told } from "./request.ts"
import { checkQuestions, checkVerdict } from "./decision.ts"
import { cap, withCatalogs, askedAt, productAsks, type Product } from "./product.ts"
import { recordTransaction, worldValue, type RecordResult } from "./world.ts"

export type Turn = TurnOf<Beat>
export const phases = ["lookup", "decide", "direct", "narrate", "check", "polish", "record"] as const
export type Phase = (typeof phases)[number]
export const Pair = Schema.Struct({ provider: Schema.String, model: Schema.String })
export const Routing = Schema.Struct({
  default: Schema.optionalKey(Pair),
  stages: Schema.optionalKey(
    Schema.Struct(Object.fromEntries([...phases, "author"].map((p) => [p, Schema.optionalKey(Pair)]))),
  ),
})
export type Routing = { default?: typeof Pair.Type; stages?: Partial<Record<Phase | "author", typeof Pair.Type>> }
export type Pair = typeof Pair.Type

export type { Node } from "./derived.ts" // internal complete projection; clients use projection.ts
export type Event =
  | { kind: "stage"; phase: Phase }
  | { kind: "delta"; part: Part | ProductDelta }
  // `via: "decision"`: check's fast pass on the decision model (decision.ts), not a language model call
  | { kind: "call"; phase: Phase; msgs: readonly Message[]; out: unknown; usage: Usage; ms: number; via?: "decision" }
  | ({ kind: "change" } & Change) // the log moved: a node landed or was amended, nodes dropped, and where head is now
/** A narrate block's text as it streams, beside the provider's `text-delta`: the block `<<aside>> <id>` opened. */
export type ProductDelta = { type: "product-delta"; id: string; text: string }
export type Events = Stream.Stream<Event, ModelError>
export type Change = Log.Change<Node> & { invalidated?: readonly number[] }
/** A stop signal: completes when the player halts the prose (a Deferred's await on the wire). Only narrate listens. */
export type Stop = Effect.Effect<void>
type Emit = (e: Event) => Effect.Effect<void>

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
    greetings: card.greetings.map(shownGreeting),
    rules: card.rules,
    // the fiction's modules without their text: id, shown name, and the state condition that makes one a variant
    fiction: card.fiction.map(({ id, label, when }) => ({ id, label, when })),
    catalogs: card.catalogs, // attachments by id as declared: a gallery draws them, a reader resolves a node's id
    layer: shown(resolve(card, rows)),
  }
}

export const makeSession = ({
  card,
  rows,
  model: modelFor,
  decision: decisionFor,
  store,
  hat,
  policy: P = policyFor(),
  seed = 0,
}: {
  seed?: number // initial deterministic beat seed for offline scenarios
  card: Card
  rows: () => Rows // the player's rows on this card, read on every request (library.ts)
  /** The model each stage runs on (provider `bind`), asked on every call like `hat`: the library's routing, in force
   *  from the next request. lookup and check can take a light model; record answers readouts (state judgement), not
   *  pure extraction: never route it down by default. */
  model: (phase: Phase) => Model
  /** The decision model, read per check like `model` (library.ts: the saved config when enabled); none = check runs on
   *  its language model alone. A throw here (a config missing its key) is a failed fast pass, not a failed turn. */
  decision?: () => DecisionModel | undefined
  store?: Log.Store<Turn> // the log's persistence; none = in memory
  hat?: (id: string) => Hat | undefined // a connection's hat by id, read per request (library.ts); none = no hat
  // the fold boundary, a value or read on every fold (library.ts: the narrate model's window, so a routing edit is in
  // force from the next request); tests pass a small budget to fold short scripted prose
  policy?: Policy | (() => Policy)
}) => {
  const rpg = makeCard(card.rules)
  const cardLore = card.lore.map((e) => ({ ...e, source: "card" as const, ...gateOf(e.id, e.offer) }))
  /** Resolve one request's rows and card lore. Pack resources bypass the story disclosure
   *  engine, so a same-named Pack can never unlock card lore. Historical text lives on turns. */
  let now: { R: Resolved; I: Lore<Paths, readonly string[]> } | undefined
  const current = () => {
    if (now) return now
    const R = resolve(card, rows())
    const I = makeLore<Paths, readonly string[]>(namedLore(cardLore, R.names))
    return (now = { R, I })
  }
  const layer = () => current().R
  const L = () => current().I
  const fresh = () => void (now = undefined)
  /** The card's own text with the names in force: a hole nothing fills stays as written (names.ts). */
  const named = (text: string) => expand(text, layer().names, "card")!
  const held = Log.hold<Turn>(store)
  for (const t of held.log.nodes.values())
    if (!t.settlementStatus || !t.changes || !t.deliveries || !t.opportunities)
      throw new Error(
        "unsupported story format (requires transactions and delivery snapshots); export or migrate it before opening",
      )
  const chain = (id: number | null) => Log.chain(held.log, id)
  const turnOf = (id: number) => Log.get(held.log, id)
  let seeds = [...held.log.nodes.values()].reduce((n, t) => t.beats.reduce((n, b) => Math.max(n, b.seed), n), seed)
  let policy: Policy | undefined // one read for a synchronous snapshot; never retained across requests
  const policyOf = () => (typeof P === "function" ? P() : P)

  const wording = (id: string) => layer().asks[id]!.text
  const products = () => layer().products
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
    packs: () => layer().entries,
    heading: card.heading,
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
  const ask = (state: Paths, input: Input, a: Ask) => {
    const M = modelFor(a.stage)
    const { frame, tail, names: N } = layer()
    const worn = M.hat === undefined ? undefined : hat?.(M.hat)
    return request(
      {
        frame: headOf(frame, { state }),
        world: headOf(worldOf(card, frame), { state }),
        role: wording("stage.role"),
        narrator: wording("narrate.role"),
        directions: wording("narrate.turn"),
        tail: headOf(tail, { state }),
        input,
        thought: wording("input.thought"),
      },
      a,
      {
        reasoningBack: M.reasoningBack,
        ttl: M.ttl,
        ...(worn && {
          hat: {
            ...worn,
            narrate: { head: fill(worn.narrate?.head ?? [], N, "hat"), tail: fill(worn.narrate?.tail ?? [], N, "hat") },
            review: { head: fill(worn.review?.head ?? [], N, "hat") },
          },
        }),
      },
    )
  }
  /** The fiction at this state, expanded: narrate's alone. */
  const fictionAt = (state: Paths) => headOf(fill(card.fiction, layer().names, "card"), { state })

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
      const M = modelFor(phase)
      // effort is the bound model entry's own: the harness names none (an unset one sends nothing)
      const r = yield* object(M, schema, msgs, {
        name: phase,
        effort: M.effort,
        maxOutputTokens,
      })
      yield* emit({ kind: "call", phase, msgs, out: r.value, usage: r.usage, ms: Date.now() - t0 })
      return r.value
    })

  /** Both native stages report the full SDK tool trace, including cancellation. */
  const native = (emit: Emit, phase: "lookup" | "record", msgs: Message[], options: StageOptions) =>
    Effect.gen(function* () {
      yield* emit({ kind: "stage", phase })
      const started = Date.now()
      const events: StageEvent[] = []
      let reported = false
      const report = (out: object, usage: Usage) =>
        Effect.gen(function* () {
          reported = true
          yield* emit({
            kind: "call",
            phase,
            msgs,
            out: { ...out, budget: options.budget },
            usage,
            ms: Date.now() - started,
          })
        })
      return yield* runStageTools(modelFor(phase), msgs, { ...options, onEvent: (e) => events.push(e) }).pipe(
        Effect.tap((r) => report(r, r.usage)),
        Effect.tapError((e) => report({ status: "failed", message: e.message, trace: e.trace }, e.usage)),
        Effect.mapError((e) => new ModelError({ message: e.message, cause: e })),
        Effect.ensuring(
          Effect.suspend(() =>
            reported
              ? Effect.void
              : report(
                  { status: "cancelled", events },
                  events.findLast((e) => e.kind === "end")?.usage ?? {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                ),
          ),
        ),
      )
    })

  const record = (
    emit: Emit,
    asked: readonly Product[],
    path: readonly Turn[],
    state: State,
    scene: Pick<Turn, "input" | "reply" | "deliveries">,
    qs?: { schema: Schema.Top; lines: string[] }, // readouts on the post-settlement state, when the card declares any
    interval = false,
  ) =>
    Effect.gen(function* () {
      const context = derived.at(path).context(state)
      const picks = withCatalogs(asked, card.catalogs ?? [], context) // a catalog with no survivor drops what reads it
      if (!picks.length && !qs) return { changes: [], products: {}, answers: {} } satisfies RecordResult
      const fed = derived.at(path).known(true)
      const tx = recordTransaction(
        picks.map((p) => ({ ...p, text: expandState(p.text, context) })),
        context.world,
        qs?.schema,
        (answers) => {
          rpg.settleReadouts(state, answers)
        },
      )
      const msgs = ask(context, scene.input, {
        stage: "record",
        known: fed.known,
        current: fed.current,
        invoked: latest(scene.deliveries)
          .filter((d) => scene.input.invoke?.includes(d.resourceId))
          .map(deliveryText),
        asks: productAsks(picks, context),
        tools: wording("record.tools"),
        readout: wording("record.readout"),
        questions: qs?.lines,
        prose: interval ? "" : proseOf(scene.reply),
        ...(interval && { history: narratorHistory(path, derived.at(path).summary()) }),
      })
      const result = yield* native(emit, "record", msgs, {
        tools: tx.tools,
        completion: { tool: "finish_record" },
        // no per-step cap: reasoning counts as output, and the total already bounds a runaway
        budget: { maxSteps: 8, maxTotalOutputTokens: 16384, timeoutMs: 120000 },
        call: { name: "record" },
      })
      if (result.status !== "completed")
        return yield* Effect.fail(
          new ModelError({ message: `record budget exhausted: ${result.reason}`, cause: result }),
        )
      return result.value as RecordResult
    })

  /** A narrate product demanded on a node: one prose call over narrate's view of the path up to and including the
   *  node (its prose is the last reply), asking for that one block alone. A reply without the delimiter is the block. */
  // ponytail: lands whole; stream the demand block as product deltas when a long one keeps the player waiting
  const block = (emit: Emit, p: Product, path: readonly Turn[], state: State) =>
    Effect.gen(function* () {
      const here = derived.at(path)
      const sum = here.summary()
      const msgs = ask(
        here.context(state),
        { text: "", note: wording("narrate.demand") },
        {
          stage: "narrate",
          fiction: fictionAt(here.context(state)),
          history: narratorHistory(path, sum),
          summarized: sum !== undefined,
          told: here.resident(),
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

  // An ungenerated passage contributes its digest and boundary to derived context, never to the transcript or log.
  const passageView = (path: readonly Turn[], seed: Partial<Turn>): readonly Turn[] => [
    ...path,
    {
      id: -1,
      parent: path.at(-1)?.id ?? null,
      input: { text: "" },
      read: [],
      deliveries: [],
      opportunities: [],
      beats: [],
      answers: {},
      end: "end",
      brief: { must: [], may: [] },
      reply: [],
      fired: [],
      violated: [],
      settlementStatus: "committed",
      settlementVersion: 0,
      boundary: seed.boundary,
      products: seed.products ?? {},
      changes: seed.changes ?? [],
    },
  ]

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
    start?: readonly (typeof Effect_.Type)[], // a new root's opening (a dynamic greet); a sibling carries its base's
    transition?: Partial<Pick<Turn, "boundary" | "passage" | "end" | "products" | "changes">>,
  ): Effect.Effect<void, ModelError> =>
    Effect.gen(function* () {
      // no line and no note: nothing to run the narrator from (an act of nothing, or a sibling of an opening; an edit
      // of the prose alone starts at check and needs none)
      if (from !== "check" && !input.text && !input.note && !input.invoke?.length)
        throw new Error(base ? `node ${base.id}: nothing to rerun` : "empty input")
      fresh()
      const path = chain(parent)
      if (parent !== null && turnOf(parent).end === "over") throw new Error("terminal node cannot accept children")
      if (path.some((t) => t.settlementStatus === "pending" || t.settlementStatus === "failed"))
        throw new Error("parent settlement must be completed or explicitly skipped")
      if (
        path.some(
          (t) => (t.passageStatus === "pending" || t.passageStatus === "failed") && !(transition && t.id === parent),
        )
      )
        throw new Error("parent passage must be completed before continuing")
      const viewPath = transition ? passageView(path, transition) : path
      const here = derived.at(viewPath)
      // the guard lines expanded, an unnamed hole as written: what the director and check read, and check's enum
      const guard = lines(card.guard, layer().names, "card")
      // a root's opening settles first, as the fold does (derived.ts `settleFresh`); its events reach this turn's gate
      const opening = start ?? base?.opening
      const o = opening ? rpg.apply(here.state, opening) : { s: here.state, events: [] as string[] }
      const s0 = o.s
      const resources = here.resources()
      const resident = here.resident()
      const current = here.currentResources()
      const reused = from !== "lookup"
      const invoked = [...new Set(input.invoke ?? [])]
      const selected = resources.filter((r) => invoked.includes(r.resourceId) && r.access.player)
      for (const id of invoked)
        if (!selected.some((r) => r.resourceId === id) && !(reused && base!.input.invoke?.includes(id)))
          throw new Error(`${id}: not invocable`)
      const automatic = resources.filter((r) => r.access.model && r.activation === "always")
      let deliveries: DeliverySnapshot[] = reused
        ? [...base!.deliveries]
        : [...automatic, ...selected].map((r) =>
            freeze(
              r,
              resident.find((s) => s.resourceId === r.resourceId),
            ),
          )
      let looked: Disclosure[] = reused ? [...base!.read] : [...automatic, ...selected].flatMap((r) => r.disclosures)
      // An edit keeps its original context, but newly selected player tools still need a frozen delivery.
      if (reused) {
        const added = selected.filter((r) => !base!.input.invoke?.includes(r.resourceId))
        deliveries.push(
          ...added
            .filter((r) => !deliveries.some((s) => s.resourceId === r.resourceId && s.revision === r.revision))
            .map((r) =>
              freeze(
                r,
                [...resident, ...deliveries].findLast((s) => s.resourceId === r.resourceId),
              ),
            ),
        )
        looked.push(...added.flatMap((r) => r.disclosures))
      }
      const hasInput = !!(input.text || input.note)
      if (!reused && hasInput) {
        const injected = latest([...resident, ...current, ...deliveries])
        const lookup = contextLookup(resources, injected)
        if (lookup.readable().length) {
          // No catalog enumeration: request size is independent of the number of unseen resources.
          yield* native(
            emit,
            "lookup",
            ask(here.context(s0), input, {
              stage: "lookup",
              ledger: here.ledger(),
              question: wording("lookup"),
              // lookup's own reading: an entry's unread sections listed under it; narrate's `told` stays bare
              context: latest([...resident, ...deliveries]).map(lookup.told),
              current: here.known().current,
            }),
            {
              tools: lookup.tools,
              completion: { text: true },
              budget: { maxSteps: 5, maxTotalOutputTokens: 8192, timeoutMs: 60000 },
              call: { name: "lookup" },
            },
          )
          deliveries.push(...lookup.delivered)
          looked.push(...lookup.disclosures)
        }
      }
      // decide → settle, looping; the k-th decide sees the first k events
      let beats: Beat[] = from !== "lookup" ? [...base!.beats] : []
      let end: Turn["end"] = from !== "lookup" ? base!.end : "end"
      if (hasInput && card.rules.actions.length && from === "lookup") {
        for (;;) {
          const { s, events } = rpg.fold(s0, beats, here.context(s0))
          if (rpg.over(s, here.context(s))) {
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
            rpg.decideSchema(s, here.context(s)),
            ask(here.context(s), input, {
              stage: "decide",
              ledger: here.ledger(),
              question: q,
              state: JSON.stringify(s),
              menu: rpg.menu(s, here.context(s)),
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
      const { s: s1, events } = rpg.fold(s0, beats, here.context(s0))
      // gate: after settlement, on this turn's beat events plus what the turn before emitted after its own gate
      // (derived.ts `gate`). Director only if the card has one and something is open.
      const gateEvents = [...o.events, ...events, ...derived.at(path).post]
      const gate = here.gate({
        state: s1,
        events: [...o.events, ...events],
        before: looked,
      })
      const disclosures = reused ? base!.read : gate.disclosures
      const open = reused ? base!.opportunities : gate.open.map((d) => ({ ...d, text: here.text(d) }))
      const told = (ds: readonly (Disclosure & { text: string })[]): Told[] => ds.map(({ id, text }) => ({ id, text }))
      const openIds = [...new Set(open.map((d) => d.id))] // Literals(openIds) below: a duplicate must never reach it
      const briefed: Brief =
        from !== "lookup"
          ? base!.brief
          : card.director && open.length
            ? yield* obj(
                emit,
                "direct",
                BriefOf(openIds),
                ask(here.context(s1), input, {
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
      if (!reused) {
        // Freeze gate deliveries before the model runs. Reword/check reuse these exact bytes,
        // even if a card or pack changes after this turn.
        const revealed = [...disclosures, ...open.filter((d) => brief.must.includes(d.id) || brief.may.includes(d.id))]
        for (const id of new Set(revealed.map((d) => d.id))) {
          const e = L().entries.find((e) => e.id === id)!
          const depth = Math.max(...revealed.filter((d) => d.id === id).map((d) => d.layer))
          const r = loreResource(e, depth)
          if (deliveries.some((s) => s.resourceId === r.resourceId && s.revision === r.revision)) continue
          deliveries.push(
            freeze(
              r,
              [...resident, ...deliveries].findLast((s) => s.resourceId === r.resourceId),
            ),
          )
        }
        deliveries = uniqueDeliveries(deliveries)
      }
      // narrate, streamed, with truncation recovery and at most one correction rewrite
      const fed = here.known()
      const sum = here.summary()
      // the narrate products on this turn: one ask line each in narrate's tail, each block cut off the reply
      const penned = askedAt(products(), "narrate", here.context(s1))

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
          const msgs = ask(here.context(s1), input, {
            stage: "narrate",
            fiction: fictionAt(here.context(s1)),
            history: transition?.boundary ? [] : narratorHistory(path, sum),
            summarized: sum !== undefined,
            told: latest([...resident, ...deliveries]),
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
        // The decision model first, when there is one (decision.ts): it settles check only when every answer is clear.
        // Anything else (a middle answer, no probability, a failed or blocked call) runs the LLM check, whose verdict
        // stands whole; the prose is written by now, so the fast pass never fails the turn. Its call is on the trace.
        const fast = (text: string) =>
          Effect.gen(function* () {
            let M: DecisionModel | undefined
            let error: string | undefined
            try {
              M = decisionFor?.()
            } catch (e) {
              error = e instanceof Error ? e.message : String(e)
            }
            if (!M && error === undefined) return undefined
            yield* emit({ kind: "stage", phase: "check" })
            const t0 = Date.now()
            const { state, questions } = checkQuestions({
              world: worldBlock(headOf(worldOf(card, layer().frame), { state: here.context(s1) })),
              draft: text,
              rules: guard,
              open,
              wording,
            })
            const r = M
              ? yield* decide(M, state, questions, { maxRetries: 0 }).pipe(
                  Effect.match({
                    onSuccess: (ok) => ({ ok }),
                    onFailure: (e) => ({ error: blocked(e) ? `blocked:${blocked(e)}` : e.message }),
                  }),
                )
              : { error: error ?? "" }
            const v = "ok" in r ? checkVerdict(r.ok.answers, guard, openIds, brief.must) : undefined
            yield* emit({
              kind: "call",
              phase: "check",
              via: "decision",
              msgs: [{ role: "user", content: state }],
              out: {
                ...(v && { p: v.p }),
                verdict: v?.pass ? "pass" : "escalate",
                ...("error" in r && { error: r.error }),
              },
              usage: "ok" in r ? r.ok.usage : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              ms: Date.now() - t0,
            })
            return v?.pass ? { fired: v.fired, violated: [] as string[] } : undefined
          })
        const llm = (text: string) =>
          obj(
            emit,
            "check",
            Check(openIds, guard),
            ask(here.context(s1), input, {
              stage: "check",
              question: wording("check"),
              rules: guard,
              open: told(open),
              must: brief.must,
              prose: text,
            }),
          ).pipe(
            Effect.map((c) => {
              const r = c as { fired?: readonly string[]; violated?: readonly string[] }
              return { fired: r.fired ?? [], violated: r.violated ?? [] }
            }),
          )
        const check = (text: string) => fast(text).pipe(Effect.flatMap((c) => (c ? Effect.succeed(c) : llm(text))))
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
        fired = open.filter((d) => c.fired.includes(d.id)).map(({ id, layer }) => ({ id, layer }))
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
          ask(here.context(s1), input, {
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
      const c = held.commit(
        Log.add(held.log, {
          parent,
          input,
          read: disclosures,
          deliveries,
          opportunities: open,
          beats,
          answers: {},
          end: cut ? "stopped" : end,
          brief,
          reply,
          fired,
          violated,
          ...(opening && { opening }),
          ...(base && { sibling: SIBLING[from] }),
          changes: [],
          settlementStatus: "pending",
          settlementVersion: 0,
          ...(base?.passage && { passage: true as const }),
          ...(base?.boundary && { boundary: true as const }),
          ...transition,
          products: { ...capped(written), ...transition?.products },
        }),
      )
      // Once the passage exists, its own settlement owns recovery. The parent is no longer blocked.
      if (transition && parent !== null) {
        const completed = held.commit(
          Log.amend(held.log, parent, { passageStatus: "committed", settlementError: undefined }),
        )
        yield* emit({ kind: "change", ...change(completed) })
      }
      yield* emit({ kind: "change", ...change(c) })
      yield* settleRecord(emit, c.node!.id)
    })
  const attempts = new Map<number, Deferred.Deferred<void>>()
  const settleRecord = (emit: Emit, nodeId: number): Effect.Effect<void, ModelError> =>
    Effect.gen(function* () {
      fresh()
      const original = turnOf(nodeId)
      if (
        original.settlementStatus === "committed" &&
        (original.passageStatus === "pending" || original.passageStatus === "failed")
      ) {
        yield* pass(emit, nodeId)
        return
      }
      if (original.settlementStatus === "committed" || original.settlementStatus === "skipped")
        throw new Error("settlement is already closed; create a revision branch")
      if (attempts.has(nodeId)) throw new Error("settlement is already running")
      const path = chain(original.parent)
      const pre = derived.at(path).settle(original).pre
      const viewPath = original.passage ? passageView(path, original) : path
      const context = derived.at(viewPath).context(pre)
      const asked = askedAt(products(), "record", context)
      const N = layer().names
      const qs = rpg.readoutSchema(pre, N, context)
      const attempt = crypto.randomUUID()
      const version = original.settlementVersion + 1
      const parentObjects = [...path]
      const live = () => {
        const t = held.log.nodes.get(nodeId)
        return (
          t?.settlementAttempt === attempt &&
          t.settlementVersion === version &&
          t.settlementStatus === "pending" &&
          parentObjects.every((p) => held.log.nodes.get(p.id) === p)
        )
      }
      const started = held.commit(
        Log.amend(held.log, nodeId, {
          settlementStatus: "pending",
          settlementVersion: version,
          settlementAttempt: attempt,
          settlementError: undefined,
        }),
      )
      const cancel = yield* Deferred.make<void>()
      attempts.set(nodeId, cancel)
      yield* Effect.gen(function* () {
        yield* emit({ kind: "change", ...change(started) })
        const rec = yield* record(
          emit,
          asked,
          viewPath,
          pre,
          original,
          qs ? { schema: qs, lines: rpg.questions(pre, N, context) } : undefined,
        ).pipe(Effect.raceFirst(Deferred.await(cancel).pipe(Effect.andThen(Effect.interrupt))))
        if (!live()) throw new Error("stale settlement attempt")
        const c = held.commit(
          Log.amend(held.log, nodeId, {
            products: { ...original.products, ...rec.products },
            changes: [...original.changes, ...rec.changes],
            answers: rec.answers,
            settlementStatus: "committed",
            settlementAttempt: undefined,
            settlementError: undefined,
          }),
        )
        yield* emit({ kind: "change", ...change(c) })
        const settled = derived.at(chain(nodeId))
        if (rpg.over(settled.state, settled.context()) && turnOf(nodeId).end !== "over") {
          const over = held.commit(Log.amend(held.log, nodeId, { end: "over" }))
          yield* emit({ kind: "change", ...change(over) })
        }
        if ((original.parent !== null || !!original.input.text) && !original.passage && turnOf(nodeId).end !== "over")
          yield* pass(emit, nodeId)
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            attempts.delete(nodeId)
            if (held.log.nodes.get(nodeId)?.settlementAttempt === attempt) {
              const c = held.commit(
                Log.amend(held.log, nodeId, {
                  settlementStatus: "failed",
                  settlementAttempt: undefined,
                  settlementError: "record did not complete",
                }),
              )
              yield* emit({ kind: "change", ...change(c) })
            } else {
              const t = held.log.nodes.get(nodeId)
              if (t?.settlementStatus === "skipped" && t.settlementVersion === version + 1)
                yield* emit({ kind: "change", node: project(t), head: held.log.head }) // files the cancelled call after the skip
            }
          }),
        ),
      )
    })
  const sibling = (nodeId: number, from: "lookup" | "narrate" | "check", patch?: Partial<Turn>, stop?: Stop) => {
    const original = turnOf(nodeId)
    const base = { ...original, ...patch, input: original.input }
    return emitting((emit) => turn(emit, base.parent, patch?.input ?? base.input, from, base, stop))
  }

  /** A greeting node: the card's opening as a root, with no player input; its `do` is the node's opening. */
  const greet = (
    g: Greeting,
    parent: number | null = null,
    transition?: Partial<Pick<Turn, "boundary" | "passage" | "end" | "products" | "changes">>,
  ): Change => {
    fresh()
    return change(
      held.commit(
        Log.add(held.log, {
          parent,
          input: { text: "" },
          read: [],
          deliveries: [],
          opportunities: [],
          ...(g.do ? { opening: g.do } : {}),
          beats: [],
          answers: {},
          end: "end",
          brief: { must: [], may: [] },
          reply: [{ type: "text", text: named(g.text ?? "") }], // the transcript holds the names as they stand now
          fired: [],
          violated: [],
          products: {},
          changes: [],
          settlementStatus: "committed",
          settlementVersion: 0,
          ...transition,
        }),
      ),
    )
  }

  const transitions = new Map<number, Deferred.Deferred<void>>()
  const pass = (emit: Emit, nodeId: number): Effect.Effect<void, ModelError> =>
    Effect.gen(function* () {
      if (transitions.has(nodeId)) throw new Error("passage is already running")
      const cancel = yield* Deferred.make<void>()
      transitions.set(nodeId, cancel)
      return yield* Effect.gen(function* () {
        const path = chain(nodeId)
        const here = derived.at(path)
        const p = card.passages?.find((p) => holds(p.when, here.context()))
        if (!p) return
        const pending = held.commit(
          Log.amend(held.log, nodeId, { passageStatus: "pending", settlementError: undefined }),
        )
        yield* emit({ kind: "change", ...change(pending) })
        const child = [...held.log.nodes.values()].find((t) => t.parent === nodeId && t.passage)
        if (child) {
          if (child.settlementStatus === "pending" || child.settlementStatus === "failed")
            yield* settleRecord(emit, child.id)
        } else {
          const snapshot = chain(nodeId)
          const asked = products().filter((q) => p.digest?.includes(q.id) && (q.stage ?? "record") === "record")
          const digest = yield* record(
            emit,
            asked,
            path,
            here.state,
            { input: { text: "" }, reply: [], deliveries: [] },
            undefined,
            true,
          )
          if (snapshot.some((t) => held.log.nodes.get(t.id) !== t)) throw new Error("stale passage attempt")
          const transition = {
            passage: true as const,
            ...(p.digest !== undefined && { boundary: true as const }),
            ...(p.end && { end: "over" as const }),
            products: digest.products,
            changes: digest.changes,
          }
          if (p.note?.trim())
            yield* turn(
              emit,
              nodeId,
              { text: "", note: named(p.note) },
              "lookup",
              undefined,
              undefined,
              p.do,
              transition,
            )
          else yield* emit({ kind: "change", ...greet(p, nodeId, transition) })
        }
        const done = held.commit(
          Log.amend(held.log, nodeId, { passageStatus: "committed", settlementError: undefined }),
        )
        yield* emit({ kind: "change", ...change(done) })
        const landed = [...held.log.nodes.values()].find((t) => t.parent === nodeId && t.passage)!
        yield* emit({ kind: "change", node: project(landed), head: held.log.head })
      }).pipe(
        Effect.raceFirst(Deferred.await(cancel).pipe(Effect.andThen(Effect.interrupt))),
        Effect.ensuring(
          Effect.gen(function* () {
            transitions.delete(nodeId)
            if (held.log.nodes.get(nodeId)?.passageStatus === "pending") {
              const failed = held.commit(
                Log.amend(held.log, nodeId, { passageStatus: "failed", settlementError: "passage did not complete" }),
              )
              yield* emit({ kind: "change", ...change(failed) })
            }
          }),
        ),
      )
    })

  return {
    greet,
    /** The greet action: greeting `greeting` (0 by default; none on a card without greetings, when a note is given), with
     *  the player's `opening` (effects on `start` fields only) after its `do` and the player's `note` after its own.
     *  A greeting with text and no note is the static root above; otherwise node 0 is narrated from the note on the
     *  opened state, its text never prepended. */
    begin: (
      a: { greeting?: number; opening?: readonly (typeof Effect_.Type)[]; note?: string },
      stop?: Stop,
    ): Events => {
      const i = a.greeting ?? 0
      const g = card.greetings[i] ?? (!card.greetings.length && a.note ? {} : undefined)
      if (!g) throw new Error(`no greeting ${i}`)
      for (const e of a.opening ?? []) {
        const f = "path" in e ? card.rules.fields.find((f) => f.path === e.path) : undefined
        if (!f?.start || f.hidden)
          throw new Error(`${"path" in e ? e.path : JSON.stringify(e)}: not a field the player sets at the start`)
      }
      const opening = [...(g.do ?? []), ...(a.opening ?? [])]
      fresh()
      // text and note count when they say something (lint `empty-greeting` reads them the same way)
      const note = [g.note?.trim() && named(g.note), a.note?.trim() && a.note].filter(Boolean).join("\n\n")
      if (g.text?.trim() && !note)
        return Stream.succeed<Event>({ kind: "change", ...greet({ ...g, ...(opening.length && { do: opening }) }) })
      return emitting((emit) =>
        turn(emit, null, { text: "", note }, "lookup", undefined, stop, opening.length ? opening : undefined),
      )
    },
    cancelRecord: (nodeId: number): boolean => {
      const cancel = transitions.get(nodeId) ?? attempts.get(nodeId)
      if (cancel) Deferred.doneUnsafe(cancel, Effect.void)
      return cancel !== undefined
    },
    retryRecord: (nodeId: number): Events => emitting((emit) => settleRecord(emit, nodeId)),
    skipRecord: (nodeId: number): Change => {
      const t = turnOf(nodeId)
      if (t.passageStatus === "pending" || t.passageStatus === "failed") {
        const c = change(
          held.commit(Log.amend(held.log, nodeId, { passageStatus: "skipped", settlementError: undefined })),
        )
        const cancel = transitions.get(nodeId)
        if (cancel) Deferred.doneUnsafe(cancel, Effect.void)
        return c
      }
      if (t.settlementStatus !== "pending" && t.settlementStatus !== "failed")
        throw new Error("settlement is already closed")
      const c = change(
        held.commit(
          Log.amend(held.log, nodeId, {
            settlementStatus: "skipped",
            settlementVersion: t.settlementVersion + 1,
            settlementAttempt: undefined,
            settlementError: undefined,
          }),
        ),
      )
      const cancel = attempts.get(nodeId)
      if (cancel) Deferred.doneUnsafe(cancel, Effect.void)
      return c
    },
    context: (nodeId: number | null) => {
      fresh()
      return derived.at(chain(nodeId)).context()
    },
    activeContext: (nodeId: number | null): ActiveContextView => {
      fresh()
      const here = derived.at(chain(nodeId))
      const state = here.context()
      return {
        worldState: state,
        playerCatalog: here.playerCatalog(),
        products: Object.fromEntries(
          products()
            .filter((p) => p.role === "world")
            .map((p) => [p.id, worldValue(p, state.world[p.id])]),
        ),
      }
    },
    projectTimeline: (n: Node): TimelineNode =>
      timelineNode(n, derived.at(chain(n.parent)).state, card.rules, products()),
    timelineNode: (id: number): TimelineNode => {
      fresh()
      const t = turnOf(id)
      return timelineNode(derived.at(chain(id)).node(false), derived.at(chain(t.parent)).state, card.rules, products())
    },
    timeline: (): Log.Snapshot<TimelineNode> => {
      fresh()
      return {
        nodes: [...held.log.nodes.values()].map((t) =>
          timelineNode(derived.at(chain(t.id)).node(false), derived.at(chain(t.parent)).state, card.rules, products()),
        ),
        head: held.log.head,
        next: held.log.next,
      }
    },
    detail: (id: number) => {
      fresh()
      const t = turnOf(id)
      return turnDetail(derived.at(chain(id)).node(false), derived.at(chain(t.parent)).state, card.rules)
    },
    node: (id: number): Node => {
      fresh()
      return project(turnOf(id))
    },
    /** Complete in-process snapshot for runtime consumers; HTTP uses timeline(). */
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
      if (!patch.input && !t.input.text && !t.input.note && !t.input.invoke?.length)
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
      const amended = Log.amend(held.log, nodeId, { adjust, settlementVersion: t.settlementVersion + 1 })
      const next = amended[0]
      const affected = new Set([nodeId])
      for (const t of [...next.nodes.values()].sort((a, b) => a.id - b.id)) {
        if (t.id !== nodeId && (t.parent === null || !affected.has(t.parent))) continue
        derived.at(Log.chain(next, t.parent)).settle(t)
        affected.add(t.id)
      }
      return { ...change(held.commit(amended)), invalidated: [...affected].filter((id) => id !== nodeId) }
    },
    /** A player action on a node: ask for one product (on or off) over that node's scene, and keep it on the node. Not a
     *  turn, not in the transcript; replay reads it back like any recorded output. The first instance is the "inner
     *  forum" kind of card (docs/card-reading-2.md §2). */
    demand: (nodeId: number, productId: string): Events => {
      fresh()
      const t = turnOf(nodeId)
      if (t.settlementStatus === "pending" || t.settlementStatus === "failed")
        throw new Error("finish or skip settlement before requesting theater")
      const p = products().find((x) => x.id === productId)
      if (!p) throw new Error(`${productId}: not a product of this card`)
      if (p.role !== "theater") throw new Error("demand is only available for theater products")
      // a player's product that does not fill is unasked, its raw text kept (names.ts): the refusal names the hole
      if (p.unasked)
        throw new Error(
          `${productId}: unfilled ${unfilled(p.text, layer().names)
            .map((k) => `{{${k}}}`)
            .join(", ")}`,
        )
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
  // a new root from the card's opening, with the player's start effects and note (Session.begin)
  Schema.Struct({
    kind: Schema.Literal("greet"),
    greeting: Schema.optionalKey(Id),
    opening: Schema.optionalKey(Schema.Array(Effect_)),
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("checkout"), node: Schema.NullOr(Id) }), // head to a version's newest leaf, or an empty line
  Schema.Struct({ kind: Schema.Literal("retryRecord"), node: Id }),
  Schema.Struct({ kind: Schema.Literal("skipRecord"), node: Id }),
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
      case "greet":
        return s.begin(a, stop)
      case "checkout":
        return Stream.succeed<Event>({ kind: "change", ...s.checkout(a.node) })
      case "retryRecord":
        return s.retryRecord(a.node)
      case "skipRecord":
        return Stream.succeed<Event>({ kind: "change", ...s.skipRecord(a.node) })
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
