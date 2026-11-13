// The decision model in front of check (src/decision.ts, session.ts `check`): the verdict rule alone, then turns on the
// self-check card with one guard line and `li` open, the decision model scripted (provider `fakeDecision`).
import { fake, fakeDecision, type DecisionModel } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import assert from "node:assert/strict"
import { checkQuestions, checkVerdict } from "../src/decision.ts"
import { makeSession, outcome, type Event } from "../src/session.ts"
import { defaultAnswer, readStage } from "../support/script.ts"
import { full, plain as player } from "./cards/index.ts"

const rule = full.guard[0]!
function b(probability: number) {
  return { type: "boolean" as const, probability }
}

// ───────── The verdict: settled only when every answer is clear ─────────
{
  const v = (answers: Record<string, unknown>, must: string[] = []) => checkVerdict(answers, ["R"], ["a", "b"], must)
  const clear = { g0: b(0.05), o0: b(0.9), o1: b(0.1) }
  assert.deepEqual(v(clear), { pass: true, fired: ["a"], p: { rules: { R: 0.05 }, open: { a: 0.9, b: 0.1 } } })
  assert.equal(v(clear, ["a"]).pass, true)
  assert.equal(v(clear, ["b"]).pass, false) // a must not clearly conveyed
  assert.equal(v({ ...clear, g0: b(0.25) }).pass, false) // a guard at LO is not clear
  assert.equal(v({ ...clear, o1: b(0.5) }).pass, false) // one middle answer
  assert.equal(v({ ...clear, o1: { type: "refusal" } }).pass, false) // no probability
  assert.deepEqual(v({ ...clear, o1: { type: "refusal" } }).p.open, { a: 0.9, b: null })
  assert.equal(checkVerdict({}, [], [], []).pass, true) // nothing asked, nothing to settle (check is not run then)
  // the builder: <world> above <draft>, one question per rule and per open id (two layers of one id ask together)
  const q = checkQuestions({
    world: "<world>\nW\n</world>",
    draft: "D",
    rules: ["R"],
    open: [
      { id: "a", text: "A1" },
      { id: "a", text: "A2" },
    ],
    wording: (id) => `${id}:`,
  })
  assert.equal(q.state, "<world>\nW\n</world>\n\n<draft>\nD\n</draft>")
  assert.deepEqual(Object.keys(q.questions), ["g0", "o0"])
  assert.deepEqual(
    [q.questions["g0"]!.instructions, q.questions["o0"]!.instructions],
    ["check.decision.rule:R", "check.decision.open:A1\nA2"],
  )
}

// ───────── In the turn ─────────
let llmCheck = { fired: [] as string[], violated: [] as string[] }
const model = fake((o) => {
  const doc = readStage(o)
  return doc.phase === "check"
    ? { text: JSON.stringify(llmCheck) }
    : defaultAnswer(doc, { notes: "N", options: [], scene: { place: "P", present: [] }, people: [] })
})
const sent: { state: string; questions: string[] }[] = []
const scripted = (answers: Record<string, number>): DecisionModel =>
  fakeDecision((call) => {
    sent.push({
      state: call.state.map((p) => ("text" in p ? p.text : "")).join(""),
      questions: Object.values(call.questions).map((q) => q.instructions as string),
    })
    return Object.fromEntries(Object.entries(answers).map(([k, p]) => [k, b(p)]))
  })
/** One turn where the guard line holds and `li` is open (a greeting at bond 8 opens its window, as test/loop.ts t9). */
const turn = (decision?: () => DecisionModel | undefined) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const S = makeSession({ card: full, rows: () => player, model: () => model, decision })
      const g = S.greet({ text: "G", do: [{ path: "bond", set: 8 }, { event: "warmth:close" }] }).node!
      const events: Event[] = []
      const t = yield* outcome(
        S.act(g.turn.id, { text: "wait" }).pipe(Stream.tap((e) => Effect.sync(() => void events.push(e)))),
      )
      const calls = events.flatMap((e) => (e.kind === "call" ? [e] : []))
      return { t, calls, phases: calls.map((c) => (c.via ? `${c.phase}:${c.via}` : c.phase)) }
    }),
  )

// clear pass: no LLM check, `fired` from the decision
{
  const r = await turn(() => scripted({ g0: 0.03, o0: 0.92 }))
  assert.deepEqual(r.phases, ["lookup", "decide", "direct", "narrate", "check:decision", "record"])
  assert.deepEqual([r.t.fired, r.t.violated], [[{ id: "li", layer: 3 }], []])
  const c = r.calls.find((c) => c.via)!
  assert.deepEqual(c.out, { p: { rules: { [rule]: 0.03 }, open: { li: 0.92 } }, verdict: "pass" })
  assert.deepEqual(c.msgs, [{ role: "user", content: sent.at(-1)!.state }])
  assert.ok(sent.at(-1)!.state.startsWith("<world>") && sent.at(-1)!.state.endsWith("hello world\n</draft>"))
  assert.ok(sent.at(-1)!.questions[0]!.endsWith(`规则：${rule}`))
  assert.ok(
    sent.at(-1)!.questions[1]!.startsWith("只看 <draft>") &&
      sent.at(-1)!.questions[1]!.includes(full.lore[0]!.layers[2]!),
  )
}
// one answer in the middle: the LLM check runs and its verdict stands whole
{
  llmCheck = { fired: [], violated: [] }
  const r = await turn(() => scripted({ g0: 0.03, o0: 0.5 }))
  assert.deepEqual(r.phases, ["lookup", "decide", "direct", "narrate", "check:decision", "check", "record"])
  assert.equal((r.calls.find((c) => c.via)!.out as { verdict: string }).verdict, "escalate")
  assert.deepEqual([r.t.fired, r.t.violated], [[], []])
}
// a failed decision call (and a model that could not be made): the LLM check runs, the failure is on the call
{
  llmCheck = { fired: ["li"], violated: [] }
  const boom = fakeDecision(() => {
    throw new Error("upstream down")
  })
  for (const [decision, why] of [
    [() => boom, /upstream down/],
    [
      () => {
        throw new Error("decision model: no key")
      },
      /no key/,
    ],
  ] as const) {
    const r = await turn(decision)
    assert.deepEqual(r.phases.slice(-3), ["check:decision", "check", "record"])
    const out = r.calls.find((c) => c.via)!.out as { verdict: string; error: string; p?: unknown }
    assert.equal(out.verdict, "escalate")
    assert.match(out.error, why)
    assert.equal(out.p, undefined)
    assert.deepEqual(r.t.fired, [{ id: "li", layer: 3 }])
  }
}
// no decision model: the turn as before
for (const decision of [undefined, () => undefined]) {
  const r = await turn(decision)
  assert.deepEqual(r.phases, ["lookup", "decide", "direct", "narrate", "check", "record"])
}
console.log("decision: ok")
