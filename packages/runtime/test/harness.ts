// One turn end to end, wiring §9/§10 (beats), §13 (brief, guardrail), §14 (layered lore), §17 (record, views), §18 (head).
// Order: lookup → decide/settle loop → gate → direct → narrate → check → record. The gate runs AFTER settlement because
// a window can depend on what this turn produced (the sword cut exposes the tattoo).
// There is no tool anywhere: lookup is a structured pick over the literal enum of readable ids, actions are the decide
// stage. The model never drives a loop, so there is no tool definition to gate or to cache (§15.4 items 1–2 dissolve).
// Truncation: a narrate that finishes with "length" is re-asked once with the partial as a trailing assistant message
// when the connection declares `prefill`; the turn records the concatenation once. Current Claude rejects the prefix
// (docs/provider-reading.md §7), so on such connections the partial stands and recovery is still undecided.
//
// This is the loop itself, shared by loop.ts (scripted model, assertions) and live.ts (a real connection, printed);
// cards live in test/cards/. A card is one `Card` (src/card.ts); which stages run is derived from what it declares. The model is packages/provider's `Model`, set once with `useModel`; every stage goes through
// the same `object` / `text` calls. Cache breakpoints sit where the design says: the end of the head and the folded
// summary, both stable across turns.
// Compression (§17.3/§18.4): before each narrate, fold the leading turns in blocks; the summary is a cached code fold,
// nodes are untouched, and lore dedupe keeps working because deliveries live on the nodes, not in the view.
// Skipped: swipe kinds other than reword, continue, streaming, persistence, reasoning parts on the node.
import { breakpoint, object, text, type Effort, type Message, type Model, type Usage } from "@effect-tavern/provider"
import { Effect, Schema } from "effect"
import { decodeFragments as frags, frame, head as headOf, type Msg, type Player } from "../src/fragment.ts"
import { folded, ledger, makeSummaries, narratorHistory } from "../src/history.ts"
import { deliveredOn, makeJournal, textOf, type Brief, type Input, type Turn as TurnOf } from "../src/journal.ts"
import { makeLore, type Disclosure } from "../src/lore.ts"
import { makeCard, type Answers, type Beat, type Card, type Greeting, type State } from "../src/card.ts"
import { holds, type Cond } from "../src/cond.ts"

// ───────── The card in play, set once per process with `useCard`. `L`, `initial` and `summaries` are live bindings. ─────────
const gate = (unlock: Cond, offer: Cond) => ({
  unlock: (s: State) => (holds(unlock, s) ? 1 : 0),
  offer: (s: State, ev: readonly string[]) => holds(offer, s, ev),
})
let rpg = makeCard({ fields: [], actions: [] })
export let initial: State = rpg.initial
export let L = makeLore<State, readonly string[]>([])
export let summaries = makeSummaries<Beat>(L.text)
export const useCard = (c: Card) => {
  rpg = makeCard(c.rules)
  initial = rpg.initial
  L = makeLore<State, readonly string[]>(
    c.lore.map((e) => ({ id: e.id, layers: e.layers, ...gate(e.unlock, e.offer) })),
  )
  summaries = makeSummaries<Beat>(L.text)
}

// ───────── The harness's own words ─────────
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
    id: "record.notes",
    text: "Notes are the record: write only the new facts this scene established (what happened, what was said that matters, what changed), each a short factual sentence. Never repeat Known, never comment on the writing.",
  },
])
const wording = (p: Player, c: Card, id: string) =>
  [...(p.asks ?? []), ...(c.asks ?? []), ...asks].find((f) => f.id === id)!.text!

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
const Notes = Schema.Struct({ notes: Schema.Array(Schema.String) })

// ───────── Journal (src/journal) and derived facts ─────────
export type Turn = TurnOf<Beat>
export const journal = makeJournal<Beat>()
export const { chain } = journal
/** A greeting node: the card's opening as node 0, with no player input; its `do` is the node's opening. */
export const greet = (g: Greeting) =>
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
    notes: [],
  })
// A turn's state: the opening (a greeting's effects), then beats before the prose, then readout answers after it. All
// code folds over recorded outputs. `post` is what this turn emitted that no gate of its own could read: a greeting has
// no gate and a readout is answered after the prose, so both open windows on the next turn.
const settleTurn = (s: State, t: Turn) => {
  const o = t.opening ? rpg.apply(s, t.opening) : { s, events: [] as string[] }
  const b = rpg.fold(o.s, t.beats)
  const r = rpg.settleReadouts(b.s, t.answers)
  return { s: r.s, events: [...o.events, ...b.events, ...r.events], post: [...o.events, ...r.events] }
}
export const stateAt = (path: readonly Turn[]) => path.reduce((s, t) => settleTurn(s, t).s, initial)
export const eventsOf = (path: readonly Turn[], t: Turn) =>
  settleTurn(stateAt(path.slice(0, path.indexOf(t))), t).events

// ───────── Views (src/fragment + src/history), as provider messages ─────────
export type PMsg = Message
/** Past assistant turns go back as parts (reasoning with its signature) when the connection takes them; else as text. */
const toP = (m: Msg): PMsg =>
  (m.parts && M.reasoningBack ? { role: m.role, content: m.parts } : { role: m.role, content: m.text }) as PMsg
const sys = (content: string): PMsg => ({ role: "system", content })
const usr = (content: string): PMsg => ({ role: "user", content })
/** This turn's user message. In-fiction text when there is any; otherwise the aside itself (directed prose: the
 *  player writes to the narrator, not as anyone in the story). Past aside-only turns leave no user message in the
 *  transcript, so direction never becomes history. */
const said = (i: Input) => usr(i.text || i.aside || "")
/** The aside as a system line, only when it accompanies in-fiction text; alone, it is already the user message. */
const asideOf = (i: Input) => (i.text && i.aside ? [sys(`Player aside: ${i.aside}`)] : [])
/** Head, with a cache breakpoint on its last message: player zone → frame → fiction is byte-stable across turns. */
const head = (p: Player, c: Card, stage: "narrate" | "direct", state: State) => {
  const h = headOf(stage === "narrate" ? [...frame(p, c), ...c.fiction] : frame(p, c), { state }).map(toP)
  return h.length ? [...h.slice(0, -1), breakpoint(h.at(-1)!)] : h
}
const policy = { keep: 2, block: 2 } // ponytail: turn counts; token budget when a real tokenizer is in the loop
export const history = (path: readonly Turn[], stage: "narrate" | "direct") => {
  if (stage === "direct") return ledger(path, (t) => eventsOf(path, t)).map(toP)
  const sum = summaries.compress(path, path.length - folded(path.length, policy.keep, policy.block))
  const h = narratorHistory(path, L.text, sum).map(toP)
  return sum ? [breakpoint(h[0]!), ...h.slice(1)] : h // the fold is byte-stable until the boundary moves
}
export const msgText = (m: PMsg) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")
export const str = (p: readonly PMsg[]) => p.map(msgText).join("\n")

// ───────── The loop ─────────
// The connection: one Model for every stage here; a real harness binds stages to connections.
export type LoopModel = Model & { prefill: boolean; reasoningBack?: boolean; effort?: Effort; maxOutputTokens?: number }
let M: LoopModel
export const useModel = (m: LoopModel) => {
  M = m
}
let seeds = 0
export const calls: string[] = []
export const prompts: Record<string, PMsg[][]> = {}
/** Every call as the inspector would show it: stage, request, what came back, what it cost. */
export const log: Array<{ phase: string; msgs: PMsg[]; out: unknown; usage: Usage }> = []
const ask = <A extends { usage: Usage }, E>(phase: string, run: Effect.Effect<A, E>, p: PMsg[]) =>
  Effect.suspend(() => {
    calls.push(phase)
    ;(prompts[phase] ??= []).push(p)
    return run
  }).pipe(
    Effect.map((r) => {
      log.push({ phase, msgs: p, out: "value" in r ? r.value : (r as { text?: string }).text, usage: r.usage })
      return r
    }),
  )
const obj = <S extends Schema.Top & Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  phase: string,
  schema: S,
  msgs: PMsg[],
) =>
  ask(phase, object(M, schema, msgs, { name: phase, effort: "off", temperature: 0, maxOutputTokens: 1024 }), msgs).pipe(
    Effect.map((r) => r.value),
  )

export const run = (
  card: Card,
  player: Player,
  parent: number | null,
  input: Input,
  from: "lookup" | "narrate" = "lookup",
  base?: Turn,
) =>
  Effect.gen(function* () {
    const path = chain(parent)
    const s0 = stateAt(path)
    const seen = deliveredOn(path)
    // lookup: a structured pick over the literal enum of readable ids; nothing to pick → no call
    const idx = card.lore.length ? L.readable(s0, seen) : []
    const readIds =
      from === "narrate"
        ? base!.read.map((d) => d.id)
        : idx.length
          ? (yield* obj("lookup", Lookup(idx), [sys(`Index: ${idx.join(", ")}`), said(input)])).read
          : []
    const disclosures =
      from === "narrate" ? base!.read : [...new Set(readIds)].flatMap((id) => L.read(s0, seen, id) ?? [])
    // decide → settle, looping; the k-th decide sees the first k events
    let beats: Beat[] = from === "narrate" ? [...base!.beats] : []
    let end: Turn["end"] = from === "narrate" ? base!.end : "end"
    if (card.rules.actions.length && from !== "narrate") {
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
        const question = wording(player, card, beats.length ? "decide.again" : "decide.first")
        const d = yield* obj("decide", rpg.decideSchema(s), [
          ...head(player, card, "direct", s),
          ...history(path, "direct"),
          sys(
            `${question}\nState: ${JSON.stringify(s)}\nActions: ${rpg.menu(s).join(" | ")}\nSo far: ${events.join(",") || "-"}`,
          ),
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
    const open: Disclosure[] = L.offers(s1, deliveredOn(path, disclosures), gateEvents).map(({ id, layer }) => ({
      id,
      layer,
    }))
    const openIds = open.map((d) => d.id)
    const brief: Brief =
      from === "narrate"
        ? base!.brief
        : card.director && open.length
          ? yield* obj("direct", BriefOf(openIds), [
              ...head(player, card, "direct", s1),
              ...card.guard.map((r) => sys(`Rule: ${r}`)),
              ...history(path, "direct"),
              sys(`Open: ${open.map((d) => `${d.id}=${L.text(d)}`).join(" | ")}\nEvents: ${gateEvents.join(",")}`),
              ...asideOf(input),
              said(input),
            ])
          : { must: [], may: openIds }
    // narrate, with truncation recovery and at most one correction rewrite
    const tail = [
      ...disclosures.map((d) => sys(L.text(d))),
      ...(events.length ? [sys(`Outcome: ${events.join(", ")}`)] : []),
      ...open.filter((d) => brief.must.includes(d.id)).map((d) => sys(`MUST reveal: ${L.text(d)}`)),
      ...open.filter((d) => brief.may.includes(d.id)).map((d) => sys(`MAY reveal: ${L.text(d)}`)),
      ...(brief.tone ? [sys(`Tone: ${brief.tone}`)] : []),
      ...asideOf(input),
    ]
    const narrate = (correction?: string) =>
      Effect.gen(function* () {
        // This turn's directives follow the player's input: Anthropic accepts a mid-conversation system message only
        // directly after a user message (verified live), and it is the one placement all three formats take.
        const msgs = [
          ...head(player, card, "narrate", s1),
          ...history(path, "narrate"),
          said(input),
          ...tail,
          ...(correction ? [sys(correction)] : []),
        ]
        // No output cap by default: the model's own limit (128k on Haiku) is the ceiling. A cap is connection config.
        const opts = { name: "narrate", maxOutputTokens: M.maxOutputTokens, effort: M.effort }
        const r = yield* ask("narrate", text(M, msgs, opts), msgs)
        if (r.finishReason !== "length" || !M.prefill) return r.parts
        const p2: PMsg[] = [...msgs, { role: "assistant", content: r.text }] // resume with the partial as prefix
        const r2 = yield* ask("narrate", text(M, p2, opts), p2)
        return [...r.parts, ...r2.parts]
      })
    let reply = yield* narrate()
    let fired: Disclosure[] = []
    let violated: string[] = []
    const checked = card.guard.length > 0 || open.length > 0
    if (checked) {
      const check = (text: string) =>
        obj("check", Check(openIds, card.guard), [
          ...card.guard.map((r) => sys(`Rule: ${r}`)),
          sys(`Open: ${openIds.join(",")}\nMust: ${brief.must.join(",")}`),
          usr(text),
        ]).pipe(
          Effect.map((c) => {
            const r = c as { fired?: readonly string[]; violated?: readonly string[] }
            return { fired: r.fired ?? [], violated: r.violated ?? [] }
          }),
        )
      let c = yield* check(textOf(reply))
      const missed = brief.must.filter((id) => !c.fired.includes(id))
      if (c.violated.length || missed.length) {
        reply = yield* narrate(
          `${wording(player, card, "narrate.correction")} ${[...c.violated.map((r) => `rule "${r}"`), ...missed.map((m) => `missed MUST ${m}`)].join("; ")}`,
        )
        c = yield* check(textOf(reply))
      }
      fired = open.filter((d) => c.fired.includes(d.id))
      violated = [...c.violated]
    }
    // record: notes, plus the readout questions when the card declares any. The model sees the prose and the
    // questions, never the numbers; the chosen options settle by code, so replay never asks again.
    const qs = card.rules.readouts?.length ? rpg.readoutSchema(s1) : undefined
    const recMsgs = [
      sys(`Known: ${path.flatMap((t) => t.notes).join("; ")}\n${wording(player, card, "record.notes")}`),
      ...(qs ? [sys(`Questions: ${rpg.questions(s1).join("\n")}`)] : []),
      usr(`${input.text}\n${textOf(reply)}`),
    ]
    let answers: Answers = {}
    let notes: readonly string[]
    if (qs) {
      const rec = yield* obj("record", Schema.Struct({ notes: Schema.Array(Schema.String), answers: qs }), recMsgs)
      notes = rec.notes
      answers = rec.answers as Answers
    } else notes = (yield* obj("record", Notes, recMsgs)).notes
    rpg.settleReadouts(s1, answers) // validate now, not on the first replay
    return journal.save({
      parent,
      input,
      read: disclosures,
      beats,
      answers,
      end,
      brief,
      reply,
      fired,
      violated,
      notes,
    })
  })
export const reword = (card: Card, player: Player, t: Turn) => run(card, player, t.parent, t.input, "narrate", t)
