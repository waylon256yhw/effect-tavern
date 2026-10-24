// §22: the card as DATA. `Card` is the whole thing: frame and fiction fragments, greetings, rules, lore, guard lines.
// Everything the loop needs is derived from it (a card with no actions has no decide stage; no lore, no lookup).
// The RPG half, `Rules`: fields with bounds, actions whose only branch is the die, effects that are
// mutations (set / add / event), a termination condition and a beat cap. Every node is a GUI control, a structured-
// output target (the NL compile step) and directly evaluable — §16.4's admission test.
// The LLM has two entries into settlement: a probability (`chance: { judge }`, answered inside the decide call and
// recorded on the beat, so `reroll` keeps the GM's difficulty and re-rolls the die, §7.1) and a readout option (answered
// inside the record call, after the prose, recorded on the node; see `Readout`).
// Ceilings (developer modules, same `settle` signature): parameterised actions over tables, formulas beyond one path
// reference, dynamic entities, time. Fields are flat paths for now.
import { Effect, Random, Schema } from "effect"
import { Cond, holds } from "./cond.ts"
import { Fragment } from "./fragment.ts"
import { ProductPatch } from "./product.ts"

const Num = Schema.Number
const Scalar = Schema.Union([Num, Schema.Boolean, Schema.String])
// `enum`: a discrete state (a route, a mode) that nothing derives from a number; `options` is its closed set and the
// gate on every `set`. Strings exist only inside an enum: free text is never state (docs/card-reading-2.md §7).
// Display declarations (docs/client-design-brief-3.md §2): what a client needs to draw a field that settlement never
// reads. `label` is the shown name (the path when absent); `group` names the Status section it sits in (the harness's
// defaults are Body / People / World / Belongings, the client knows their icons; any other name is a plain section).
export const Field = Schema.Struct({
  path: Schema.String,
  label: Schema.optionalKey(Schema.String),
  group: Schema.optionalKey(Schema.String),
  type: Schema.Literals(["int", "number", "boolean", "enum"]),
  min: Schema.optionalKey(Num),
  max: Schema.optionalKey(Num),
  options: Schema.optionalKey(Schema.Array(Schema.String)),
  initial: Scalar,
  hidden: Schema.optionalKey(Schema.Boolean), // never shown (the status table and the card page skip it): an ending switch the player should not see coming. Settlement reads it like any field
})
export const Chance = Schema.Union([
  Num,
  Schema.Struct({ path: Schema.String }),
  Schema.Struct({ judge: Schema.String }),
])
export const Effect_ = Schema.Union([
  Schema.Struct({ path: Schema.String, set: Scalar }),
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
export type Field = typeof Field.Type
export type State = Record<string, number | boolean | string>
export interface Beat {
  next: string
  chance?: number
  seed: number
} // next = action id; chance only when the roll is a judge
export type Answers = Record<string, string> // readout id → option id, as recorded on the node
/** A judged beat as it settled: the chance it was rolled against, the roll (0..1, from the seed), and which side it fell on. */
export interface Check {
  action: string
  chance: number
  roll: number
  hit: boolean
}

export const decodeRules = Schema.decodeUnknownSync(Rules)
export const rollOf = (seed: number) => Effect.runSync(Random.next.pipe(Random.withSeed(seed)))

export const makeCard = (r: Rules) => {
  const fields = new Map(r.fields.map((f) => [f.path, f]))
  const initial: State = Object.fromEntries(r.fields.map((f) => [f.path, f.initial]))
  const fieldSchema = (f: typeof Field.Type) => {
    if (f.type === "boolean") return Schema.Boolean
    if (f.type === "enum") {
      if (!f.options?.length) throw new Error(`${f.path}: enum needs options`)
      return Schema.Literals([...f.options])
    }
    const base = f.type === "int" ? Schema.Int : Num
    const lo = f.min === undefined ? undefined : Schema.isGreaterThanOrEqualTo(f.min)
    const hi = f.max === undefined ? undefined : Schema.isLessThanOrEqualTo(f.max)
    return lo && hi ? base.check(lo, hi) : lo ? base.check(lo) : hi ? base.check(hi) : base
  }
  const stateSchema = Schema.Struct(Object.fromEntries(r.fields.map((f) => [f.path, fieldSchema(f)])))
  // Who writes a field decides what the prose may do to it. The narrator sees bands, never numbers, so a field only
  // actions write is a mechanical quantity the prose cannot move ("the innkeeper hands you three coins" leaves gold
  // where it was); a field the fiction may move needs a readout. Said once at load, not enforced: the author decides.
  // A card with no readouts at all has chosen mechanical everywhere (the self-test RPG), so nothing is said there.
  const writes = (es: readonly (typeof Effect_.Type)[] | undefined) =>
    (es ?? []).flatMap((e) => ("path" in e ? [e.path] : []))
  const byActions = new Set(r.actions.flatMap((a) => [...writes(a.hit), ...writes(a.miss), ...writes(a.do)]))
  const byReadouts = new Set((r.readouts ?? []).flatMap((q) => q.options.flatMap((o) => writes(o.do))))
  for (const path of byActions)
    if (byReadouts.size && !byReadouts.has(path))
      console.warn(`${path}: written by actions only; the prose cannot move it. Add a readout, or keep it mechanical.`)
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
      if ("path" in e && !fields.has(e.path)) throw new Error(`${e.path}: not a field`) // state is a closed vocabulary
      if ("set" in e) out[e.path] = e.set
      else if ("add" in e) {
        const f = fields.get(e.path)
        const v = num(out, e.path) + (typeof e.add === "number" ? e.add : num(out, e.add.path))
        out[e.path] = Math.min(f?.max ?? Infinity, Math.max(f?.min ?? -Infinity, v)) // bounds clamp (§4.2)
      } else events.push(e.event.replace(/\{([^}]+)\}/g, (_, p) => String(out[p])))
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
    if (p === undefined) return { ...apply(s, a.do ?? []), check: undefined }
    const roll = rollOf(b.seed)
    const hit = roll < p
    return { ...apply(s, hit ? (a.hit ?? []) : (a.miss ?? [])), check: { action: a.id, chance: p, roll, hit } }
  }
  const fold = (s: State, beats: readonly Beat[]) =>
    beats.reduce<{ s: State; events: string[]; checks: Check[] }>(
      (acc, b) => {
        const r = settle(acc.s, b)
        return { s: r.s, events: [...acc.events, ...r.events], checks: r.check ? [...acc.checks, r.check] : acc.checks }
      },
      { s, events: [], checks: [] },
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
    apply, // effects outside a beat or readout: a greeting's opening
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
export type Rpg = ReturnType<typeof makeCard>

// ───────── The whole card ─────────
// Lore gates as data. `unlock` is the lock: one Cond per layer (a single Cond is layer 1's), the floor being the leading
// layers whose Cond holds; a layer any state on the path unlocked stays unlocked, so the lock is a predicate over what
// has happened, never a filter on the instant (a filter is what `offer` is for). `offer` is the moment: a Cond over
// state + this turn's events, opening the next layer to the narrator for this turn only.
export const LoreEntry = Schema.Struct({
  id: Schema.String,
  layers: Schema.Array(Schema.String),
  unlock: Schema.Union([Cond, Schema.Array(Cond)]),
  offer: Cond,
})
// Two coordinates place a card among the ways people write (1:1 RP, a world with no fixed protagonist, directed prose):
// who the player is in the fiction is the frame slot `persona` (card default, player override like any slot), and
// which channel the input takes by default: `act` (in-fiction, enters the transcript) or `note` (direction to the
// narrator, this turn only). `input` is read by the client, not the loop; the loop takes both channels on every turn.
// A greeting is node 0 with no player input. `do` is its opening: the effects that make this opening differ from the
// card's initial state (an IF line's route, a later date, a tenser town). Fiction variants read the result through
// `when`; its events reach the first turn's gate. Two ecosystem cards needed exactly this and had no place for it.
export const Greeting = Schema.Struct({ text: Schema.String, do: Schema.optionalKey(Schema.Array(Effect_)) })
export type Greeting = typeof Greeting.Type
export const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.String), // shown in the client's header; the id when absent. Never reaches the model
  summary: Schema.optionalKey(Schema.String), // one line on what this card is, for the card page and a gallery. Never reaches the model
  heading: Schema.optionalKey(Schema.String), // what titles a turn: a field path or `<product>.<key>` (a text key of a record product), read off the node; no declaration, no turn titles
  version: Schema.optionalKey(Schema.String), // the author's; a changed card under a running log is the client's call to notice
  source: Schema.optionalKey(Schema.String), // where it came from: a URL, a file, "hand"
  frame: Schema.Array(Fragment), // slots: persona, voice, style, setting …
  fiction: Schema.Array(Fragment), // a character, a cast or a world; variants carry `when`
  greetings: Schema.Array(Greeting),
  rules: Rules,
  lore: Schema.Array(LoreEntry),
  guard: Schema.Array(Schema.String), // checked after the prose, never shown to the narrator
  director: Schema.optionalKey(Schema.Boolean),
  input: Schema.optionalKey(Schema.Literals(["act", "note"])),
  asks: Schema.optionalKey(Schema.Array(Fragment)), // the harness's own wording, overridden by id
  products: Schema.optionalKey(Schema.Array(ProductPatch)), // record products: patches over the harness defaults by id, or new ones
})
export type Card = typeof Card.Type
export type LoreEntry = typeof LoreEntry.Type
export const decodeCard = Schema.decodeUnknownSync(Card)
