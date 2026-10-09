// One turn end to end, wiring §9/§10 (beats), §13 (brief, guardrail), §14 (layered lore), §17 (record, views), §18 (head).
// Order: lookup → decide/settle loop → gate → direct → narrate → check → record. The gate runs AFTER settlement because
// a window can depend on what this turn produced (the sword cut exposes the tattoo).
// There is no tool anywhere: lookup is a structured pick over the literal enum of readable ids, actions are the decide
// stage. The model never drives a loop, so there is no tool definition to gate or to cache (§15.4 items 1–2 dissolve).
// Truncation: a narrate that finishes with "length" is re-asked once with the partial as a trailing assistant message;
// the turn records the concatenation once. The fake accepts the prefix because it was written to; providers unverified.
//
// Imports the same modules lore.ts / views.ts / assemble.ts test: src/lore, src/journal, src/history, src/fragment.
// Only settlement (card content) and the scripted model live here.
// Compression (§17.3/§18.4): before each narrate, fold the leading turns in blocks; the summary is a cached code fold,
// nodes are untouched, and lore dedupe keeps working because deliveries live on the nodes, not in the view.
// Skipped: swipe kinds other than reword, continue, streaming, persistence.
import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import assert from "node:assert/strict"
import {
  decodeFragments as frags,
  frame,
  head as headOf,
  type Fragment,
  type Msg,
  type Player,
} from "../src/fragment.ts"
import { folded, ledger, makeSummaries, narratorHistory } from "../src/history.ts"
import { deliveredOn, makeJournal, type Brief, type Input, type Turn as TurnOf } from "../src/journal.ts"
import { makeLore, type Disclosure } from "../src/lore.ts"
import { decodeRules, makeCard, type Beat, type State } from "../src/card.ts"
import { holds, type Cond } from "../src/cond.ts"

// ───────── Card: all data (§22). Settlement rules, lore gates and windows are Cond / effects, not code. ─────────
const rpg = makeCard(
  decodeRules({
    fields: [
      { path: "hp", type: "int", min: 0, max: 100, initial: 40 },
      { path: "foe", type: "int", min: 0, initial: 30 },
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
  }),
)
const initial = rpg.initial
// Lore gates as data: `unlock` is a Cond over state (visible = layer 1), `offer` a Cond over state + this turn's events.
const gate = (unlock: Cond, offer: Cond) => ({
  unlock: (s: State) => (holds(unlock, s) ? 1 : 0),
  offer: (s: State, ev: readonly string[]) => holds(offer, s, ev),
})
const L = makeLore<State, readonly string[]>([
  {
    id: "li",
    layers: ["Li: A's lost friend; crane tattoo on the left shoulder.", "B is Li."],
    ...gate({ all: [] }, { event: "strike:hit" }),
  },
  { id: "heir", layers: ["Li was heir to the throne."], ...gate({ any: [] }, { all: [] }) }, // hidden: never in play
])
interface Card {
  id: string
  frame: readonly Fragment[]
  character: readonly Fragment[]
  actions: boolean
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
const Check = (open: readonly string[], rules: readonly string[]) =>
  Schema.Struct({ fired: Schema.Array(Schema.Literals(open)), violated: Schema.Array(Schema.Literals(rules)) })
const Notes = Schema.Struct({ notes: Schema.Array(Schema.String) })

const { fold } = rpg

// ───────── Journal (src/journal) and derived facts ─────────
type Turn = TurnOf<Beat>
const journal = makeJournal<Beat>()
const { chain } = journal
const stateAt = (path: readonly Turn[]) => path.reduce((s, t) => fold(s, t.beats).s, initial)
const eventsOf = (path: readonly Turn[], t: Turn) => fold(stateAt(path.slice(0, path.indexOf(t))), t.beats).events

// ───────── Views (src/fragment + src/history), as provider messages ─────────
type PMsg = Prompt.MessageEncoded
const toP = (m: Msg): PMsg => ({ role: m.role, content: m.text }) as PMsg
const sys = (content: string): PMsg => ({ role: "system", content })
const usr = (content: string): PMsg => ({ role: "user", content })
const head = (p: Player, c: Card, stage: "narrate" | "direct") =>
  headOf(stage === "narrate" ? [...frame(p, c), ...c.character] : frame(p, c)).map(toP)
const summaries = makeSummaries<Beat>(L.text)
const policy = { keep: 2, block: 2 } // ponytail: turn counts; token budget when a real tokenizer is in the loop
const history = (path: readonly Turn[], stage: "narrate" | "direct") => {
  if (stage === "direct") return ledger(path, (t) => eventsOf(path, t)).map(toP)
  const sum = summaries.compress(path, path.length - folded(path.length, policy.keep, policy.block))
  return narratorHistory(path, L.text, sum).map(toP)
}
const msgText = (m: Prompt.Prompt["content"][number]) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("")
const str = (p: Prompt.Prompt) => p.content.map(msgText).join("\n")

// ───────── The loop ─────────
let seeds = 0
const calls: string[] = []
const prompts: Record<string, Prompt.Prompt[]> = {}
const ask = <A>(phase: string, run: Effect.Effect<A, any, LanguageModel.LanguageModel>, p: Prompt.Prompt) =>
  Effect.suspend(() => {
    calls.push(phase)
    ;(prompts[phase] ??= []).push(p)
    return run
  })
const obj = <S extends Schema.Encoder<Record<string, any>, unknown> & { readonly DecodingServices: never }>(
  phase: string,
  schema: S,
  msgs: PMsg[],
) => {
  const p = Prompt.make(msgs)
  return ask(
    phase,
    LanguageModel.generateObject({ objectName: phase, schema, prompt: p }).pipe(Effect.map((r) => r.value)),
    p,
  )
}

const run = (
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
        const { s, events } = fold(s0, beats)
        if (rpg.over(s)) {
          end = "over"
          break
        }
        if (beats.length >= rpg.cap) {
          end = "cap"
          break
        }
        const d = yield* obj("decide", rpg.decideSchema(s), [
          ...head(player, card, "direct"),
          ...history(path, "direct"),
          sys(`State: ${JSON.stringify(s)}\nActions: ${rpg.menu(s).join(" | ")}\nSo far: ${events.join(",") || "-"}`),
          usr(input.text),
        ])
        if (d.next === "end") {
          end = "end"
          break
        }
        beats.push({ next: d.next, chance: (d as { chance?: number }).chance, seed: ++seeds })
      }
    }
    const { s: s1, events } = fold(s0, beats)
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
              ...head(player, card, "direct"),
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
        const msgs = [
          ...head(player, card, "narrate"),
          ...history(path, "narrate"),
          ...tail,
          ...(correction ? [sys(correction)] : []),
          usr(input.text),
        ]
        const p = Prompt.make(msgs)
        const r = yield* ask("narrate", LanguageModel.generateText({ prompt: p }), p)
        if (r.finishReason !== "length") return r.text
        const p2 = Prompt.make([...msgs, { role: "assistant", content: r.text }]) // resume with the partial as prefix
        const r2 = yield* ask("narrate", LanguageModel.generateText({ prompt: p2 }), p2)
        return r.text + r2.text
      })
    let prose = yield* narrate()
    let fired: Disclosure[] = []
    let violated: string[] = []
    const checked = card.rules.length > 0 || open.length > 0
    if (checked) {
      const check = (text: string) =>
        obj("check", Check(openIds, card.rules), [
          ...card.rules.map((r) => sys(`Rule: ${r}`)),
          sys(`Open: ${openIds.join(",")}\nMust: ${brief.must.join(",")}`),
          usr(text),
        ])
      let c = yield* check(prose)
      const missed = brief.must.filter((id) => !c.fired.includes(id))
      if (c.violated.length || missed.length) {
        prose = yield* narrate(
          `Previous draft broke: ${[...c.violated.map((r) => `rule "${r}"`), ...missed.map((m) => `missed MUST ${m}`)].join("; ")}`,
        )
        c = yield* check(prose)
      }
      fired = open.filter((d) => c.fired.includes(d.id))
      violated = [...c.violated]
    }
    const { notes } = yield* obj("record", Notes, [
      sys(`Known: ${path.flatMap((t) => t.notes).join("; ")}`),
      usr(`${input.text}\n${prose}`),
    ])
    return journal.save({ parent, input, read: disclosures, beats, end, brief, prose, fired, violated, notes })
  })
const reword = (card: Card, player: Player, t: Turn) => run(card, player, t.parent, t.input, "narrate", t)

// ───────── Scripted model ─────────
const narrations: Array<"plain" | "fire" | "kill" | "cut"> = []
let n = 0
const FakeModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: (o) =>
      Effect.sync(() => {
        const text = str(o.prompt)
        const phase = o.responseFormat.type === "json" ? o.responseFormat.objectName : "narrate"
        const last = o.prompt.content.at(-1)!
        const want = msgText(last)
        const open =
          text
            .match(/Open: ([\w,=]*)/)?.[1]
            .split(/[,|]/)
            .map((x) => x.split("=")[0].trim())
            .filter(Boolean) ?? []
        let out: string
        let reason: "stop" | "length" = "stop"
        switch (phase) {
          case "lookup":
            out = JSON.stringify({
              read: text
                .match(/Index: (.*)/)![1]
                .split(", ")
                .filter((id) => want.includes(`about ${id}`)),
            })
            break
          case "decide": {
            const k = (text.match(/So far: (.*)/)![1].match(/strike/g) ?? []).length
            out = JSON.stringify({ next: /strike/.test(want) && k < 2 ? "strike" : "end" })
            break
          }
          case "direct":
            out = JSON.stringify({ must: [], may: open, tone: `TONE#${n}` })
            break
          case "check": {
            out = JSON.stringify({
              fired: /tattoo/.test(want) ? open : [],
              violated: /KILL/.test(want) ? ["B does not die"] : [],
            })
            break
          }
          case "record":
            out = JSON.stringify({ notes: [`NOTE#${n}`] })
            break
          default: {
            if (last.role === "assistant") {
              out = " …and the rest."
              break
            } // resumed after a cut
            const how = narrations.shift() ?? "plain"
            const mayReveal = /MAY reveal|MUST reveal/.test(text)
            out = `PROSE#${++n}${how === "fire" && mayReveal ? " the sleeve tears, a crane tattoo" : ""}${how === "kill" ? " KILL" : ""}`
            if (how === "cut") {
              out += " partial"
              reason = "length"
            }
          }
        }
        return [
          { type: "text" as const, text: out },
          { type: "finish" as const, reason, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } },
        ]
      }),
    streamText: () => Stream.empty,
  }),
)

// ───────── Checks ─────────
const player: Player = { global: frags([{ id: "language", text: "Write in Chinese." }]), forCard: {} }
const chat: Card = {
  id: "wuxia",
  frame: frags([{ id: "setting", text: "Frame: wuxia" }]),
  character: frags([{ id: "a", text: "A: swordsman" }]),
  actions: false,
  lore: false,
  director: false,
  rules: [],
}
const full: Card = { ...chat, actions: true, lore: true, director: true, rules: ["B does not die"] }
const since = (i: number) => calls.slice(i)
const lastNarr = () => prompts.narrate.at(-1)!

const program = Effect.gen(function* () {
  const c0 = yield* run(chat, player, null, { text: "hello" })
  assert.deepEqual(calls, ["narrate", "record"])
  assert.deepEqual([c0.read, c0.beats, c0.brief, c0.fired], [[], [], { must: [], may: [] }, []])

  let i = calls.length
  const t1 = yield* run(full, player, null, { text: "ask about li" })
  assert.deepEqual(since(i), ["lookup", "decide", "narrate", "check", "record"])
  assert.deepEqual(t1.read, [{ id: "li", layer: 1 }])
  assert.ok(str(lastNarr()).includes(L.entries[0].layers[0]) && !str(lastNarr()).includes("B is Li"))

  // Turn 2: lookup picks nothing new (li#1 already on the path), strikes settle, window opens, director, reveal fired.
  i = calls.length
  narrations.push("fire")
  const t2 = yield* run(full, player, t1.id, { text: "strike B", aside: "ASIDE#2" })
  assert.deepEqual(since(i), ["decide", "decide", "decide", "direct", "narrate", "check", "record"]) // li#1 already on the path: nothing to look up
  assert.deepEqual(t2.read, [])
  assert.equal(t2.beats.length, 2)
  const ev2 = eventsOf(chain(t2.id), t2)
  assert.ok(ev2.includes("strike:hit"))
  assert.deepEqual([t2.brief.may, t2.fired], [["li"], [{ id: "li", layer: 2 }]])
  assert.ok(
    /MAY reveal: B is Li/.test(str(lastNarr())) &&
      str(lastNarr()).includes("ASIDE#2") &&
      str(lastNarr()).includes(`Tone: TONE#`),
  )
  // The window reads post-settlement events: the same input with all-miss seeds opens nothing.
  assert.deepEqual(L.offers(initial, deliveredOn(chain(t1.id)), ["strike:miss", "strike:miss"]), [])
  // The k-th decide saw the first k events.
  const decides = prompts.decide.slice(-3).map(str)
  assert.ok(
    /So far: -/.test(decides[0]) &&
      /So far: strike:\w+$/m.test(decides[1]) &&
      /So far: strike:\w+,strike:\w+$/m.test(decides[2]),
  )
  // Director never saw prose; narrator never saw the ledger.
  assert.ok(!/PROSE#/.test(str(prompts.direct.at(-1)!)) && !/Ledger/.test(str(lastNarr())))

  // Turn 3: history carries both lore layers; the previous aside and tone are gone; head is byte-identical.
  i = calls.length
  const t3 = yield* run(full, player, t2.id, { text: "speak" })
  const v3 = str(lastNarr())
  assert.ok(v3.includes("B is Li") && v3.includes(L.entries[0].layers[0]) && v3.includes(t2.prose))
  assert.ok(!v3.includes("ASIDE#2") && !v3.includes(t2.brief.tone!))
  assert.deepEqual(prompts.narrate.at(-1)!.content.slice(0, 3), prompts.narrate.at(-2)!.content.slice(0, 3))
  assert.deepEqual(prompts.narrate.at(-1)!.content.slice(0, 3).map(msgText), [
    "Write in Chinese.",
    "Frame: wuxia",
    "A: swordsman",
  ]) // player zone → frame → character
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"])
  assert.deepEqual(t3.brief, { must: [], may: [] }) // li at its last layer: no more windows

  // Truncation: one node, prose concatenated, two narrate calls, second prompt ends with the partial as assistant.
  i = calls.length
  narrations.push("cut")
  const t4 = yield* run(chat, player, c0.id, { text: "more" })
  assert.deepEqual(since(i), ["narrate", "narrate", "record"])
  assert.ok(t4.prose.endsWith("partial …and the rest."))
  const resumed = prompts.narrate.at(-1)!.content.at(-1)!
  assert.equal(resumed.role, "assistant")
  assert.equal(journal.size, 5)

  // Guardrail: a draft that kills B is re-asked once with the broken rule in the tail; the correction never enters history.
  i = calls.length
  narrations.push("kill", "plain")
  const t5 = yield* run(full, player, t3.id, { text: "finish him" })
  assert.deepEqual(since(i), ["decide", "narrate", "check", "narrate", "check", "record"])
  assert.ok(str(prompts.narrate.at(-1)!).includes('Previous draft broke: rule "B does not die"'))
  assert.deepEqual(t5.violated, [])
  const t6 = yield* run(full, player, t5.id, { text: "rest" })
  assert.ok(!str(lastNarr()).includes("Previous draft broke"))

  // Compression in the loop: at 4 turns on the path, the first block (t1, t2) is folded.
  const v6 = str(lastNarr())
  assert.ok(
    v6.includes("Summary:") &&
      !v6.includes(t1.prose) &&
      !v6.includes(t2.prose) &&
      v6.includes(t3.prose) &&
      v6.includes(t5.prose),
  )
  assert.ok(v6.includes("B is Li") && v6.includes(L.entries[0].layers[0])) // lore delivered inside the folded range survives in the fold
  const s6 = summaries.summaryFor(chain(t6.id))!
  assert.deepEqual([s6.from, s6.to], [t1.id, t2.id])
  // Boundary moves in blocks: one more turn keeps the same summary object; lore dedupe still sees the folded deliveries.
  i = calls.length
  const t7 = yield* run(full, player, t6.id, { text: "wait" })
  assert.deepEqual(since(i), ["decide", "narrate", "check", "record"]) // li fully delivered on the folded nodes → nothing to look up
  assert.equal(summaries.summaryFor(chain(t7.id)), s6)
  assert.equal(summaries.size, 1)
  const t8 = yield* run(full, player, t7.id, { text: "wait more" })
  const s8 = summaries.summaryFor(chain(t8.id))!
  assert.deepEqual([s8.from, s8.to, summaries.size], [t1.id, t5.id, 2])
  assert.ok(!str(lastNarr()).includes(t3.prose) && str(lastNarr()).includes(t6.prose))
  // The view is a function of (path, policy), not of what other branches have cached: re-rendering the shorter path
  // at t6 still folds only the first block, even though a longer summary now sits in the table.
  const again = history(chain(t6.id), "narrate")
    .map((m) => m.content as string)
    .join("\n")
  assert.ok(again.includes(t3.prose) && again.includes(s6.text) && !again.includes(s8.text))

  // reword: narrate, check, record only; read/beats/brief kept; sibling under the same parent. Replay calls nothing.
  i = calls.length
  const w = yield* reword(full, player, t2)
  assert.deepEqual(since(i), ["narrate", "check", "record"])
  assert.deepEqual([w.parent, w.read, w.beats, w.brief], [t2.parent, t2.read, t2.beats, t2.brief])
  i = calls.length
  for (const t of journal.values()) stateAt(chain(t.id))
  assert.equal(calls.length, i)

  console.log(str(lastNarr()))
})

Effect.runSync(program.pipe(Effect.provide(FakeModel)))
console.log("ok")
