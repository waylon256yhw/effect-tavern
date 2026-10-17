// One turn end to end, wiring §9/§10 (beats), §13 (brief, guardrail), §14 (layered lore), §17 (record, views), §18 (head).
// Order: lookup → decide/settle loop → gate → direct → narrate → check → record. The gate runs AFTER settlement because
// a window can depend on what this turn produced (the sword cut exposes the tattoo).
// There is no tool anywhere: lookup is a structured pick over the literal enum of readable ids, actions are the decide
// stage. The model never drives a loop, so there is no tool definition to gate or to cache (§15.4 items 1–2 dissolve).
// Truncation: a narrate that finishes with "length" is re-asked once with the partial as a trailing assistant message
// when the connection declares `prefill`; the turn records the concatenation once. Current Claude rejects the prefix
// (docs/provider-reading.md §7), so on such connections the partial stands and recovery is still undecided.
//
// This is the loop itself plus one card, shared by loop.ts (scripted model, assertions) and loop-live.ts (a real
// connection, printed). The model is packages/provider's `Model`, set once with `useModel`; every stage goes through
// the same `object` / `text` calls. Cache breakpoints sit where the design says: the end of the head and the folded
// summary, both stable across turns.
// Compression (§17.3/§18.4): before each narrate, fold the leading turns in blocks; the summary is a cached code fold,
// nodes are untouched, and lore dedupe keeps working because deliveries live on the nodes, not in the view.
// Skipped: swipe kinds other than reword, continue, streaming, persistence, reasoning parts on the node.
import { breakpoint, object, text, type Effort, type Message, type Model, type Usage } from "@effect-tavern/provider"
import { Effect, Schema } from "effect"
import {
  decodeFragments as frags,
  frame,
  head as headOf,
  type Fragment,
  type Msg,
  type Player,
} from "../src/fragment.ts"
import { folded, ledger, makeSummaries, narratorHistory } from "../src/history.ts"
import { deliveredOn, makeJournal, textOf, type Brief, type Input, type Turn as TurnOf } from "../src/journal.ts"
import { makeLore, type Disclosure } from "../src/lore.ts"
import { decodeRules, makeCard, Rules, type Answers, type Beat, type State } from "../src/card.ts"
import { holds, type Cond } from "../src/cond.ts"

// ───────── Card data (§22): settlement rules, lore gates and windows are Cond / effects, not code. ─────────
export interface CardData {
  rules: typeof Rules.Encoded
  lore: ReadonlyArray<{ id: string; layers: readonly string[]; unlock: Cond; offer: Cond }>
}
/** The self-check card: a wuxia duel with layered lore, a readout and one rule. */
export const wuxia: CardData = {
  rules: {
    fields: [
      { path: "hp", type: "int", min: 0, max: 100, initial: 40 },
      { path: "foe", type: "int", min: 0, initial: 30 },
      { path: "bond", type: "int", min: -30, max: 100, initial: 0 }, // a readout: never settled before the prose
    ],
    readouts: [
      {
        id: "warmth",
        text: "how A treated the player this turn",
        options: [
          { id: "cold", text: "cold", do: [{ path: "bond", add: -5 }] },
          { id: "flat", text: "indifferent", do: [] },
          { id: "warm", text: "warm", do: [{ path: "bond", add: 4 }] },
          { id: "close", text: "intimate", do: [{ path: "bond", add: 8 }, { event: "warmth:close" }] },
        ],
      },
    ],
    actions: [
      {
        id: "strike",
        text: "attack B",
        roll: 0.6,
        hit: [{ path: "foe", add: -10 }, { event: "strike:hit" }],
        miss: [{ path: "hp", add: -10 }, { event: "strike:miss" }],
      },
      { id: "talk", text: "talk", do: [{ event: "talk" }] },
    ],
    over: {
      any: [
        { path: "hp", is: 0 },
        { path: "foe", is: 0 },
      ],
    },
    cap: 4,
  },
  // Lore gates as data: `unlock` is a Cond over state (visible = layer 1), `offer` a Cond over state + this turn's events.
  lore: [
    {
      id: "li",
      layers: ["Li: A's lost friend; crane tattoo on the left shoulder.", "B is Li."],
      unlock: { all: [] },
      offer: { event: "strike:hit" },
    },
    { id: "heir", layers: ["Li was heir to the throne."], unlock: { any: [] }, offer: { all: [] } }, // hidden: never in play
  ],
}
const gate = (unlock: Cond, offer: Cond) => ({
  unlock: (s: State) => (holds(unlock, s) ? 1 : 0),
  offer: (s: State, ev: readonly string[]) => holds(offer, s, ev),
})
// The card in play, set once per process with `useCard`. `L`, `initial` and `summaries` are live bindings.
let rpg = makeCard(decodeRules({ fields: [], actions: [] }))
export let initial: State = rpg.initial
export let L = makeLore<State, readonly string[]>([])
export let summaries = makeSummaries<Beat>(L.text)
export const useCard = (d: CardData) => {
  rpg = makeCard(decodeRules(d.rules))
  initial = rpg.initial
  L = makeLore<State, readonly string[]>(
    d.lore.map((e) => ({ id: e.id, layers: e.layers, ...gate(e.unlock, e.offer) })),
  )
  summaries = makeSummaries<Beat>(L.text)
}
export interface Card {
  id: string
  frame: readonly Fragment[]
  character: readonly Fragment[]
  actions: boolean
  readouts: boolean
  lore: boolean
  director: boolean
  rules: readonly string[]
}

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
/** A greeting node: the card's opening as node 0, with no player input. */
export const greet = (text: string) =>
  journal.save({
    parent: null,
    input: { text: "" },
    read: [],
    beats: [],
    answers: {},
    end: "end",
    brief: { must: [], may: [] },
    reply: [{ type: "text", text }],
    fired: [],
    violated: [],
    notes: [],
  })
// A turn's state: beats settle before the prose, readout answers after it. Both are code folds over recorded outputs.
const settleTurn = (s: State, t: Turn) => {
  const b = rpg.fold(s, t.beats)
  const r = rpg.settleReadouts(b.s, t.answers)
  return { s: r.s, events: [...b.events, ...r.events] }
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
/** Head, with a cache breakpoint on its last message: player zone → frame → character is byte-stable across turns. */
const head = (p: Player, c: Card, stage: "narrate" | "direct", state: State) => {
  const h = headOf(stage === "narrate" ? [...frame(p, c), ...c.character] : frame(p, c), { state }).map(toP)
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
    const idx = card.lore ? L.readable(s0, seen) : []
    const readIds =
      from === "narrate"
        ? base!.read.map((d) => d.id)
        : idx.length
          ? (yield* obj("lookup", Lookup(idx), [sys(`Index: ${idx.join(", ")}`), usr(input.text)])).read
          : []
    const disclosures =
      from === "narrate" ? base!.read : [...new Set(readIds)].flatMap((id) => L.read(s0, seen, id) ?? [])
    // decide → settle, looping; the k-th decide sees the first k events
    let beats: Beat[] = from === "narrate" ? [...base!.beats] : []
    let end: Turn["end"] = from === "narrate" ? base!.end : "end"
    if (card.actions && from !== "narrate") {
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
        const question = beats.length
          ? `The input asked to keep going. Acted on so far: ${beats.map((b, i) => `${b.next} → ${events[i] ?? "-"}`).join(", ")}. Given these outcomes, pick the next action, or "end" when the input's goal is met, the input said to stop under this outcome, or nothing sensible is left.`
          : `Which card action does the player's input take first? "end" if it takes none of the listed actions. Set "again" to true only if the input's own words ask for more than one beat ("until he falls", "twice", "then …").`
        const d = yield* obj("decide", rpg.decideSchema(s), [
          ...head(player, card, "direct", s),
          ...history(path, "direct"),
          sys(
            `${question}\nState: ${JSON.stringify(s)}\nActions: ${rpg.menu(s).join(" | ")}\nSo far: ${events.join(",") || "-"}`,
          ),
          usr(input.text),
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
    // gate: after settlement, on this turn's events; director only if the card has one and something is open
    const open: Disclosure[] = L.offers(s1, deliveredOn(path, disclosures), events).map(({ id, layer }) => ({
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
              ...card.rules.map((r) => sys(`Rule: ${r}`)),
              ...history(path, "direct"),
              sys(`Open: ${open.map((d) => `${d.id}=${L.text(d)}`).join(" | ")}\nEvents: ${events.join(",")}`),
              ...(input.aside ? [sys(`Player aside: ${input.aside}`)] : []),
              usr(input.text),
            ])
          : { must: [], may: openIds }
    // narrate, with truncation recovery and at most one correction rewrite
    const tail = [
      ...disclosures.map((d) => sys(L.text(d))),
      ...(events.length ? [sys(`Outcome: ${events.join(", ")}`)] : []),
      ...open.filter((d) => brief.must.includes(d.id)).map((d) => sys(`MUST reveal: ${L.text(d)}`)),
      ...open.filter((d) => brief.may.includes(d.id)).map((d) => sys(`MAY reveal: ${L.text(d)}`)),
      ...(brief.tone ? [sys(`Tone: ${brief.tone}`)] : []),
      ...(input.aside ? [sys(`Player aside: ${input.aside}`)] : []),
    ]
    const narrate = (correction?: string) =>
      Effect.gen(function* () {
        // This turn's directives follow the player's input: Anthropic accepts a mid-conversation system message only
        // directly after a user message (verified live), and it is the one placement all three formats take.
        const msgs = [
          ...head(player, card, "narrate", s1),
          ...history(path, "narrate"),
          usr(input.text),
          ...tail,
          ...(correction ? [sys(correction)] : []),
        ]
        const opts = { name: "narrate", maxOutputTokens: M.maxOutputTokens ?? 700, effort: M.effort }
        const r = yield* ask("narrate", text(M, msgs, opts), msgs)
        if (r.finishReason !== "length" || !M.prefill) return r.parts
        const p2: PMsg[] = [...msgs, { role: "assistant", content: r.text }] // resume with the partial as prefix
        const r2 = yield* ask("narrate", text(M, p2, opts), p2)
        return [...r.parts, ...r2.parts]
      })
    let reply = yield* narrate()
    let fired: Disclosure[] = []
    let violated: string[] = []
    const checked = card.rules.length > 0 || open.length > 0
    if (checked) {
      const check = (text: string) =>
        obj("check", Check(openIds, card.rules), [
          ...card.rules.map((r) => sys(`Rule: ${r}`)),
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
          `Previous draft broke: ${[...c.violated.map((r) => `rule "${r}"`), ...missed.map((m) => `missed MUST ${m}`)].join("; ")}`,
        )
        c = yield* check(textOf(reply))
      }
      fired = open.filter((d) => c.fired.includes(d.id))
      violated = [...c.violated]
    }
    // record: notes, plus the readout questions when the card declares any. The model sees the prose and the
    // questions, never the numbers; the chosen options settle by code, so replay never asks again.
    const qs = card.readouts ? rpg.readoutSchema(s1) : undefined
    const recMsgs = [
      sys(
        `Known: ${path.flatMap((t) => t.notes).join("; ")}\nNotes are the record: write only the new facts this scene established (what happened, what was said that matters, what changed), each a short factual sentence. Never repeat Known, never comment on the writing.`,
      ),
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

export const player: Player = { global: frags([{ id: "language", text: "Write in Chinese." }]), forCard: {} }
export const chat: Card = {
  id: "wuxia",
  frame: frags([{ id: "setting", text: "Frame: wuxia" }]),
  // Bands of the readout are `when` fragments: the narrator reads the band's text, never the number.
  character: frags([
    { id: "a", text: "A: swordsman" },
    { id: "a-cool", text: "A keeps the player at arm's length.", when: { path: "bond", op: "lt", value: 8 } },
    { id: "a-warm", text: "A trusts the player.", when: { path: "bond", op: "gte", value: 8 } },
  ]),
  actions: false,
  readouts: false,
  lore: false,
  director: false,
  rules: [],
}
export const full: Card = {
  ...chat,
  actions: true,
  readouts: true,
  lore: true,
  director: true,
  rules: ["B does not die"],
}
