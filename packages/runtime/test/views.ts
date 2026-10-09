// Tests for src/journal.ts + src/history.ts: history is a per-stage VIEW over the turn path, never stored (§17).
// Only the narrator sees the transcript. Structured stages see facts; most see only this turn.
// Compression is a derived view: a prefix range is replaced by the CODE fold of its notes plus the lore delivered in
// it, cached by range. Turn nodes are never mutated. record runs every turn: notes are the compression source.
import { Effect, Layer, Stream } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import assert from "node:assert/strict"
import type { Msg } from "../src/fragment.ts"
import { ledger, makeSummaries, narratorHistory } from "../src/history.ts"
import { deliveredOn, makeJournal, type Brief, type Input, type Turn as TurnOf } from "../src/journal.ts"
import { makeLore, type Disclosure } from "../src/lore.ts"

// ───────── Card: three authored layers (§16.4 + frame), strings only here ─────────
interface Card {
  frame: readonly string[]
  character: readonly string[]
  director: boolean
  rules: readonly string[]
}
const L = makeLore<unknown, unknown>([
  { id: "li", layers: ["Li: A's friend, lost ten years ago; crane tattoo.", "B is Li."] },
])
const lore = { li: L.entries[0].layers }

interface Beat {
  decide: "strike" | "talk"
  seed: number
}
type Turn = TurnOf<Beat>
const journal = makeJournal<Beat>()
const { chain } = journal
const eventsOf = (t: Turn) => t.beats.map((b) => `${b.decide}:${b.seed % 2 ? "hit" : "miss"}`)
const summaries = makeSummaries<Beat>(L.text)

// ───────── Views ─────────
type Stage = "direct" | "narrate" | "check" | "record"
interface Current {
  input: Input
  beats: readonly Beat[]
  read: readonly Disclosure[]
  brief: Brief
  prose?: string
}
const render = (card: Card, path: readonly Turn[], stage: Stage, cur: Current): Msg[] => {
  const sys = (text: string): Msg => ({ role: "system", text })
  const user = (text: string): Msg => ({ role: "user", text })
  const head = card.frame.map(sys) // stable across turns: the cache prefix
  switch (stage) {
    case "narrate": {
      const tail = [
        ...cur.read.map((d) => sys(L.text(d))),
        ...(cur.beats.length ? [sys(`Outcome: ${eventsOf({ beats: cur.beats } as Turn).join(", ")}`)] : []),
        ...(cur.brief.must.length ? [sys(`MUST: ${cur.brief.must.join(", ")}`)] : []),
        ...(cur.brief.may.length ? [sys(`MAY: ${cur.brief.may.join(", ")}`)] : []),
        ...(cur.brief.tone ? [sys(`Tone: ${cur.brief.tone}`)] : []),
        ...(cur.input.aside ? [sys(`Player aside: ${cur.input.aside}`)] : []),
        user(cur.input.text),
      ]
      return [
        ...head,
        ...card.character.map(sys),
        ...narratorHistory(path, L.text, summaries.summaryFor(path)),
        ...tail,
      ] // this test's policy: longest cached prefix
    }
    case "direct":
      return [
        ...head,
        ...card.rules.map((r) => sys(`Rule: ${r}`)),
        ...ledger(path, eventsOf),
        ...(cur.input.aside ? [sys(`Player aside: ${cur.input.aside}`)] : []),
        user(cur.input.text),
      ]
    case "check":
      return [...card.rules.map((r) => sys(`Rule: ${r}`)), sys(`Brief: ${JSON.stringify(cur.brief)}`), user(cur.prose!)]
    case "record":
      return [sys(`Known: ${path.flatMap((t) => t.notes).join("; ")}`), user(`${cur.input.text}\n${cur.prose!}`)]
  }
}

// ───────── Turn loop with a scripted model; only the view shapes matter here ─────────
const calls: Array<{ phase: Stage; msgs: Msg[] }> = []
const ask = (phase: Stage, msgs: Msg[]) =>
  LanguageModel.generateText({
    prompt: Prompt.make(msgs.map((m) => ({ role: m.role, content: m.text }) as Prompt.MessageEncoded)),
  }).pipe(Effect.map((r) => (calls.push({ phase, msgs }), r.text)))

let n = 0
const run = (
  card: Card,
  parent: number | null,
  input: Input,
  read: readonly Disclosure[] = [],
  fired: readonly Disclosure[] = [],
) =>
  Effect.gen(function* () {
    const k = n++
    const path = chain(parent)
    const beats: Beat[] = /strike/.test(input.text) ? [{ decide: "strike", seed: k }] : []
    const cur: Current = { input, beats, read, brief: { must: [], may: [], tone: undefined } }
    if (card.director)
      cur.brief = {
        must: [],
        may: fired.map((d) => d.id),
        tone: yield* ask("direct", render(card, path, "direct", cur)),
      }
    const prose = yield* ask("narrate", render(card, path, "narrate", cur))
    cur.prose = prose
    const violated =
      card.rules.length || card.director
        ? (yield* ask("check", render(card, path, "check", cur))).split(",").filter(Boolean)
        : []
    const notes = [yield* ask("record", render(card, path, "record", cur))]
    return journal.save({ parent, input, read, beats, end: "end", brief: cur.brief, prose, fired, violated, notes })
  })

// Scripted answers in call order; each block carries a distinctive marker (TONE#k, PROSE#k, NOTE#k) so views can be
// checked by substring. check answers "" (no violation).
const pending: string[] = []
const script = (card: Card) =>
  pending.push(
    ...(card.director ? ["TONE#"] : []),
    "PROSE#",
    ...(card.rules.length || card.director ? [""] : []),
    "NOTE#",
  )
const FakeModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () =>
      Effect.sync(() => {
        const tag = pending.shift()!
        return [
          { type: "text" as const, text: tag ? `${tag}${n - 1}` : "" },
          {
            type: "finish" as const,
            reason: "stop" as const,
            usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
          },
        ]
      }),
    streamText: () => Stream.empty,
  }),
)

// ───────── Checks ─────────
const text = (msgs: Msg[]) => msgs.map((m) => m.text).join("\n")
const has = (msgs: Msg[], s: string) => text(msgs).includes(s)
const last = (phase: Stage) => calls.filter((c) => c.phase === phase).at(-1)!.msgs

const chat: Card = {
  frame: ["Frame: wuxia, late Ming, no firearms", "Style: terse"],
  character: ["A: wandering swordsman"],
  director: false,
  rules: [],
}
const directed: Card = { ...chat, director: true, rules: ["B does not die"] }

const program = Effect.gen(function* () {
  // Pure chat: exactly narrate + record per turn.
  script(chat)
  const c0 = yield* run(chat, null, { text: "hello" })
  assert.deepEqual(
    calls.map((c) => c.phase),
    ["narrate", "record"],
  )
  assert.deepEqual([c0.prose, c0.notes], ["PROSE#0", ["NOTE#0"]])

  // Directed card over five turns; turn 1 delivers lore layer 1, turn 2 reveals layer 2, turn 3 carries an aside.
  calls.length = 0
  const inputs: Array<[Input, Disclosure[], Disclosure[]]> = [
    [{ text: "enter the inn" }, [], []],
    [{ text: "ask about Li" }, [{ id: "li", layer: 1 }], []],
    [{ text: "strike B" }, [], [{ id: "li", layer: 2 }]],
    [{ text: "step back", aside: "ASIDE#3 make it darker" }, [], []],
    [{ text: "speak" }, [], []],
  ]
  let parent: number | null = null
  const turns: Turn[] = []
  for (const [input, read, fired] of inputs) {
    script(directed)
    const t: Turn = yield* run(directed, parent, input, read, fired)
    turns.push(t)
    parent = t.id
  }
  const k = turns[4].id // the marker suffix of the last turn

  // Narrator: past input + prose + delivered lore; never past brief/tone, notes, aside. Current tone and aside in tail.
  let v = last("narrate")
  for (const t of turns.slice(0, 4)) assert.ok(has(v, t.input.text) && has(v, t.prose))
  assert.ok(has(v, lore.li[0]) && has(v, lore.li[1]))
  for (const t of turns.slice(0, 4)) assert.ok(!has(v, t.brief.tone!) && !has(v, t.notes[0]))
  assert.ok(!has(v, "ASIDE#3"))
  assert.ok(has(v, `Tone: TONE#${k}`))
  const v3 = calls.filter((c) => c.phase === "narrate")[3].msgs
  assert.ok(has(v3, "Player aside: ASIDE#3 make it darker") && v3.at(-1)!.text === "step back")

  // Director: facts, fired, notes, aside; no prose anywhere.
  v = last("direct")
  assert.ok(!/PROSE#/.test(text(v)))
  assert.ok(has(v, "strike:") && has(v, "fired li") && has(v, "NOTE#"))
  assert.ok(has(last("direct"), "Rule: B does not die"))
  assert.ok(has(calls.filter((c) => c.phase === "direct")[3].msgs, "ASIDE#3"))

  // Check: only this turn's prose and brief.
  v = last("check")
  assert.ok(has(v, `PROSE#${k}`) && !has(v, `PROSE#${k - 1}`) && !has(v, "enter the inn"))

  // Record: known notes + this turn's prose, no past prose.
  v = last("record")
  assert.ok(has(v, `NOTE#${k - 1}`) && has(v, `PROSE#${k}`) && !has(v, `PROSE#${k - 1}`))

  // Head is identical across consecutive narrator renders (frame + character = cache prefix).
  const n3 = calls.filter((c) => c.phase === "narrate")[3].msgs
  const n4 = calls.filter((c) => c.phase === "narrate")[4].msgs
  assert.deepEqual(n3.slice(0, 3), n4.slice(0, 3))
  assert.equal(n4[0].text, directed.frame[0])

  // Compression: derived view; nodes untouched; lore delivered in the range survives; shared across branches.
  const before = JSON.stringify([...journal.values()])
  const path = chain(turns[4].id)
  const sum = summaries.compress(path, 2)! // folds turns 0..2
  assert.equal(JSON.stringify([...journal.values()]), before)
  assert.deepEqual([sum.from, sum.to], [turns[0].id, turns[2].id])
  const cur: Current = { input: { text: "next" }, beats: [], read: [], brief: { must: [], may: [] } }
  v = render(directed, path, "narrate", cur)
  assert.ok(has(v, sum.text) && has(v, "NOTE#1") && has(v, lore.li[0]) && has(v, lore.li[1]))
  for (const t of turns.slice(0, 3)) assert.ok(!has(v, t.prose))
  assert.ok(has(v, turns[3].prose) && has(v, turns[4].prose))
  assert.deepEqual(
    deliveredOn(path).map((d) => `${d.id}#${d.layer}`),
    ["li#1", "li#2"],
  ) // dedupe still sees the compressed layers
  assert.equal(summaries.compress(path, 2), sum) // cached
  // A sibling branch forked after the range reuses the same summary object.
  script(directed)
  const fork = yield* run(directed, turns[3].id, { text: "flee" })
  assert.equal(summaries.summaryFor(chain(fork.id)), sum)
  assert.equal(summaries.size, 1)
  // Lore layers once delivered are not re-sent: the same path-level dedupe lore.ts uses.
  assert.ok(deliveredOn(chain(fork.id)).some((d) => d.id === "li" && d.layer === 2))
  // A fork from inside the range does not share it: the key is a path prefix, not a floor count.
  script(directed)
  const inner = yield* run(directed, turns[1].id, { text: "leave" })
  assert.equal(summaries.summaryFor(chain(inner.id)), undefined)

  console.log(text(v))
})

Effect.runSync(program.pipe(Effect.provide(FakeModel)))
console.log("ok")
