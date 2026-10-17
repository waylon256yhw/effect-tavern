// §22: the RPG half of a card as DATA. Fields with bounds, actions whose only branch is the die, effects that are
// mutations (set / add / event), a termination condition and a beat cap. Every node is a GUI control, a structured-
// output target (the NL compile step) and directly evaluable — §16.4's admission test.
// The LLM has two entries into settlement: a probability (`chance: { judge }`, answered inside the decide call and
// recorded on the beat, so `reroll` keeps the GM's difficulty and re-rolls the die, §7.1) and a readout option (answered
// inside the record call, after the prose, recorded on the node; see `Readout`).
// Ceilings (developer modules, same `settle` signature): parameterised actions over tables, formulas beyond one path
// reference, dynamic entities, time. Fields are flat paths for now.
import { Effect, Random, Schema } from "effect"
import { Cond, holds } from "./cond.ts"

const Num = Schema.Number
export const Field = Schema.Struct({
  path: Schema.String,
  type: Schema.Literals(["int", "number", "boolean"]),
  min: Schema.optionalKey(Num),
  max: Schema.optionalKey(Num),
  initial: Schema.Union([Num, Schema.Boolean]),
})
export const Chance = Schema.Union([
  Num,
  Schema.Struct({ path: Schema.String }),
  Schema.Struct({ judge: Schema.String }),
])
export const Effect_ = Schema.Union([
  Schema.Struct({ path: Schema.String, set: Schema.Union([Num, Schema.Boolean]) }),
  Schema.Struct({ path: Schema.String, add: Schema.Union([Num, Schema.Struct({ path: Schema.String })]) }),
  Schema.Struct({ event: Schema.String }), // `{path}` interpolates the post-effect state; feeds narrator and ledger
])
export const Action = Schema.Struct({
  id: Schema.String,
  text: Schema.String, // what the model sees as the option
  when: Schema.optionalKey(Cond), // availability gate: an unavailable action is not a decodable answer
  roll: Schema.optionalKey(Chance),
  hit: Schema.optionalKey(Schema.Array(Effect_)),
  miss: Schema.optionalKey(Schema.Array(Effect_)),
  do: Schema.optionalKey(Schema.Array(Effect_)),
})
// A readout is a question asked AFTER the prose (record stage): the model picks one option, code applies its effects.
// The model never sees the number; bands of the number are `when` fragments in the head. Same closed vocabulary as
// actions, no die: a readout is a judgement about what the prose did, not a chance.
export const Readout = Schema.Struct({
  id: Schema.String,
  text: Schema.String, // the question
  when: Schema.optionalKey(Cond), // asked only when it holds (on the post-settlement state)
  options: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String, do: Schema.Array(Effect_) })),
})
export const Rules = Schema.Struct({
  fields: Schema.Array(Field),
  actions: Schema.Array(Action),
  readouts: Schema.optionalKey(Schema.Array(Readout)),
  over: Schema.optionalKey(Cond), // code-decided ending; `end` stays the model's, `cap` the harness's
  cap: Schema.optionalKey(Schema.Int),
})
export type Rules = typeof Rules.Type
export type Action = typeof Action.Type
export type State = Record<string, number | boolean>
export interface Beat {
  next: string
  chance?: number
  seed: number
} // next = action id; chance only when the roll is a judge
export type Answers = Record<string, string> // readout id → option id, as recorded on the node

export const decodeRules = Schema.decodeUnknownSync(Rules)
export const rollOf = (seed: number) => Effect.runSync(Random.next.pipe(Random.withSeed(seed)))

export const makeCard = (r: Rules) => {
  const fields = new Map(r.fields.map((f) => [f.path, f]))
  const initial: State = Object.fromEntries(r.fields.map((f) => [f.path, f.initial]))
  const fieldSchema = (f: typeof Field.Type) => {
    if (f.type === "boolean") return Schema.Boolean
    const base = f.type === "int" ? Schema.Int : Num
    const lo = f.min === undefined ? undefined : Schema.isGreaterThanOrEqualTo(f.min)
    const hi = f.max === undefined ? undefined : Schema.isLessThanOrEqualTo(f.max)
    return lo && hi ? base.check(lo, hi) : lo ? base.check(lo) : hi ? base.check(hi) : base
  }
  const stateSchema = Schema.Struct(Object.fromEntries(r.fields.map((f) => [f.path, fieldSchema(f)])))
  const validate = Schema.decodeUnknownSync(stateSchema)
  const num = (s: State, path: string) => {
    const v = s[path]
    if (typeof v !== "number") throw new Error(`${path} is not a number`)
    return v
  }
  const available = (s: State) => r.actions.filter((a) => !a.when || holds(a.when, s))
  const apply = (s: State, effects: readonly (typeof Effect_.Type)[]) => {
    let out = { ...s }
    const events: string[] = []
    for (const e of effects) {
      if ("set" in e) out[e.path] = e.set
      else if ("add" in e) {
        const f = fields.get(e.path)
        const v = num(out, e.path) + (typeof e.add === "number" ? e.add : num(out, e.add.path))
        out[e.path] = Math.min(f?.max ?? Infinity, Math.max(f?.min ?? -Infinity, v)) // bounds clamp (§4.2)
      } else events.push(e.event.replace(/\{(\w+)\}/g, (_, p) => String(out[p])))
    }
    return { s: validate(out) as State, events }
  }
  const chanceOf = (s: State, a: Action, b: Beat) => {
    if (a.roll === undefined) return undefined
    if (typeof a.roll === "number") return a.roll
    if ("path" in a.roll) return num(s, a.roll.path)
    if (b.chance === undefined) throw new Error(`${a.id}: judge chance missing on the beat`)
    return b.chance
  }
  const settle = (s: State, b: Beat) => {
    const a = available(s).find((x) => x.id === b.next)
    if (!a) throw new Error(`${b.next}: not an available action`)
    const p = chanceOf(s, a, b)
    const effects = p === undefined ? (a.do ?? []) : rollOf(b.seed) < p ? (a.hit ?? []) : (a.miss ?? [])
    return apply(s, effects)
  }
  const fold = (s: State, beats: readonly Beat[]) =>
    beats.reduce<{ s: State; events: string[] }>(
      (acc, b) => {
        const r = settle(acc.s, b)
        return { s: r.s, events: [...acc.events, ...r.events] }
      },
      { s, events: [] },
    )
  /** Decide schema for the current state: the enum is the gate; `chance` exists only when some available action is judged.
   *  `again` is read on the first beat only: whether the input's own wording asks for more beats after this one
   *  ("until he falls", "twice"). Without it the turn is one beat and the per-beat loop is never entered; with it the
   *  loop asks after each outcome (§10.2). A model asked "another?" after every beat answers the input again. */
  const decideSchema = (s: State) => {
    const acts = available(s)
    const judged = acts.some((a) => a.roll !== undefined && typeof a.roll === "object" && "judge" in a.roll)
    const next = Schema.Literals([...acts.map((a) => a.id), "end"])
    const again = Schema.optionalKey(Schema.Boolean)
    return judged
      ? Schema.Struct({
          next,
          again,
          chance: Schema.optionalKey(Num.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
        })
      : Schema.Struct({ next, again })
  }
  const menu = (s: State) =>
    available(s).map(
      (a) =>
        `${a.id}: ${a.text}${a.roll && typeof a.roll === "object" && "judge" in a.roll ? ` (estimate chance: ${a.roll.judge})` : ""}`,
    )
  // Readouts: asked on the post-settlement state; the enum per question is the gate. Nothing asked → no schema.
  const asked = (s: State) => (r.readouts ?? []).filter((q) => !q.when || holds(q.when, s))
  const readoutSchema = (s: State) => {
    const qs = asked(s)
    return qs.length
      ? Schema.Struct(Object.fromEntries(qs.map((q) => [q.id, Schema.Literals(q.options.map((o) => o.id))])))
      : undefined
  }
  const questions = (s: State) =>
    asked(s).map((q) => `${q.id}: ${q.text} [${q.options.map((o) => `${o.id}: ${o.text}`).join(" | ")}]`)
  const settleReadouts = (s: State, a: Answers) => {
    let out = { s, events: [] as string[] }
    for (const [qid, oid] of Object.entries(a)) {
      const o = (r.readouts ?? []).find((q) => q.id === qid)?.options.find((x) => x.id === oid)
      if (!o) throw new Error(`${qid}=${oid}: not a readout option`)
      const res = apply(out.s, o.do)
      out = { s: res.s, events: [...out.events, ...res.events] }
    }
    return out
  }
  return {
    rules: r,
    initial,
    validate,
    available,
    settle,
    fold,
    decideSchema,
    menu,
    asked,
    readoutSchema,
    questions,
    settleReadouts,
    over: (s: State) => (r.over ? holds(r.over, s) : false),
    cap: r.cap ?? Infinity,
  }
}
export type Card = ReturnType<typeof makeCard>
