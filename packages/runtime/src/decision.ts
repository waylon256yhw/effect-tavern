// The decision model in front of check (#171) and lookup (#168): a judgement asked as typed yes/no questions, answered
// with probabilities and no prose. For check the LLM check stays the definition: this pass only settles a turn whose
// every answer is clear, and never triggers a rewrite by itself (session.ts `check`). For lookup it selects from a
// complete catalog (context.ts `catalog`) and settles the stage alone. One builder per stage for the turn and the
// instruments (server bin/decision-replay.ts, decision-probe.ts, decision-lookup.ts), so what they measure is what the
// turn sends; one runner (`decisionPass`) for the stage event, the call, the fallback and the trace row.
import { blocked, decide, type DecisionModel, type Question, type Usage } from "@effect-tavern/provider"
import { Effect } from "effect"
import type { Unit } from "./context.ts"
import { tag } from "./request.ts"

// ponytail: a first calibration from decision-probe readings (clean 0.02–0.08, violated 0.95+); re-read against the
// probe before moving either.
export const LO = 0.25
export const HI = 0.75
// ponytail: decision-lookup.ts readings (#168): should-read 0.84–0.98, should-not 0.03–0.33, unrelated inputs nothing
// over 0.5, related ones 14–31 over it; re-read against the instrument before moving either.
export const LOOKUP = 0.5
export const TOP = 8 // read_context's per-call cap: a section's entry counts toward it

/** One answered question as the trace row shows it: its label and its probability (null: none came back). */
export interface Line {
  label: string
  p: number | null
}
type Emit = (
  e:
    | { kind: "stage"; phase: "lookup" | "check" }
    | {
        kind: "call"
        phase: "lookup" | "check"
        via: "decision"
        msgs: { role: "user"; content: string }[]
        out: { lines: Line[]; verdict: "pass" | "escalate"; error?: string; delivered?: string[] }
        usage: Usage
        ms: number
      },
) => Effect.Effect<void>
/** The decision pass of one stage: none (`undefined`, no row) when there is no decision model; otherwise the stage
 *  event, the call, and one trace row `{lines, verdict, error?, delivered?}`. `read` turns the answers into the lines and,
 *  when they settle the stage, its value; `undefined` back (a failed or blocked call, a config that threw, an answer
 *  that does not settle) hands the stage to its language model. */
export const decisionPass = <V>(o: {
  emit: Emit
  phase: "lookup" | "check"
  model: (() => DecisionModel | undefined) | undefined
  state: string
  questions: Record<string, Question>
  read: (answers: Readonly<Record<string, unknown>>) => { lines: Line[]; value?: V; delivered?: string[] }
}) =>
  Effect.gen(function* () {
    let M: DecisionModel | undefined
    let error: string | undefined
    try {
      M = o.model?.()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    if (!M && error === undefined) return undefined
    yield* o.emit({ kind: "stage", phase: o.phase })
    const t0 = Date.now()
    const r = M
      ? yield* decide(M, o.state, o.questions, { maxRetries: 0 }).pipe(
          Effect.match({
            onSuccess: (ok) => ({ ok }),
            onFailure: (e) => ({ error: blocked(e) ? `blocked:${blocked(e)}` : e.message }),
          }),
        )
      : { error: error ?? "" }
    const v = "ok" in r ? o.read(r.ok.answers) : undefined
    yield* o.emit({
      kind: "call",
      phase: o.phase,
      via: "decision",
      msgs: [{ role: "user", content: o.state }],
      out: {
        lines: v?.lines ?? [],
        verdict: v?.value !== undefined ? "pass" : "escalate",
        ...("error" in r && { error: r.error }),
        ...(v?.delivered && { delivered: v.delivered }),
      },
      usage: "ok" in r ? r.ok.usage : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ms: Date.now() - t0,
    })
    return v?.value
  })

/** Lookup's state (the scene's tail, then `<input>`: the line and the note) and one boolean question per catalog unit
 *  (`u<i>`): an entry whose face is unread, then each unread section under it. The ask is layer.ts `lookup.decision`,
 *  followed by the unit's title. `scene` is the parent turn's prose; "" leaves the tag out. */
export const lookupQuestions = (o: {
  scene: string
  input: { text?: string; note?: string }
  units: readonly Unit[]
  wording: (id: string) => string
}): { state: string; questions: Record<string, Question>; asked: { resourceId: string; title: string }[] } => {
  const asked = askedOf(o.units)
  return {
    state: [
      o.scene && tag("scene", o.scene.slice(-SCENE)),
      tag("input", [o.input.text, o.input.note && `Player note: ${o.input.note}`].filter(Boolean).join("\n")),
    ]
      .filter(Boolean)
      .join("\n\n"),
    questions: Object.fromEntries(
      asked.map((u, i) => [`u${i}`, { type: "boolean", instructions: `${o.wording("lookup.decision")}${u.title}` }]),
    ),
    asked,
  }
}
// ponytail: the scene tail as decision-lookup.ts asked it (1200 characters); it barely moved the readings, unmeasured
// beyond that.
const SCENE = 1200
const askedOf = (units: readonly Unit[]) =>
  units.flatMap((u) => [
    ...(u.resident ? [] : [{ resourceId: u.resourceId, title: u.title }]),
    ...(u.sections ?? []).map((x) => ({ ...x, of: u.resident ? undefined : u.resourceId })),
  ])
/** The answers read back per unit (`asked` order) and what to read: over `LOOKUP`, highest first, at most `TOP` ids
 *  with a section's unread entry ahead of it and counted. `ids` is undefined when an answer has no probability: the
 *  pass does not settle then. */
export const lookupSelect = (answers: Readonly<Record<string, unknown>>, units: readonly Unit[]) => {
  const asked = askedOf(units)
  const lines = asked.map((u, i) => ({ label: u.title, p: p(answers[`u${i}`]) }))
  if (lines.some((l) => l.p === null)) return { lines }
  const ids: string[] = []
  for (const i of asked.map((_, i) => i).sort((a, b) => lines[b]!.p! - lines[a]!.p!)) {
    if (lines[i]!.p! <= LOOKUP) break
    const u = asked[i]!
    const need = [...("of" in u && u.of && !ids.includes(u.of) ? [u.of] : []), u.resourceId].filter(
      (id) => !ids.includes(id),
    )
    if (ids.length + need.length <= TOP) ids.push(...need)
  }
  return { lines, ids }
}

/** The state (`<world>` + `<draft>`) and one boolean question per guard rule (`g<i>`: violated?) and per open entry id
 *  (`o<i>`, in first-appearance order: its substance conveyed?; an id opened at several layers asks about them together).
 *  `world` is request.ts `worldBlock`, "" when the card has none. The asks are layer.ts `check.decision.rule` / `.open`. */
export const checkQuestions = (o: {
  world: string
  draft: string
  rules: readonly string[]
  open: readonly { id: string; text: string }[]
  wording: (id: string) => string
}): { state: string; questions: Record<string, Question> } => {
  const ids = [...new Set(o.open.map((d) => d.id))]
  return {
    state: [o.world, tag("draft", o.draft)].filter(Boolean).join("\n\n"),
    questions: {
      ...Object.fromEntries(
        o.rules.map((rule, i) => [
          `g${i}`,
          {
            type: "boolean",
            instructions: `${o.wording("check.decision.rule")}${rule}`,
            criteria: { true: "正文中发生了规则禁止的事。", false: "正文没有发生规则禁止的事。" },
          },
        ]),
      ),
      ...Object.fromEntries(
        ids.map((id, i) => [
          `o${i}`,
          {
            type: "boolean",
            instructions: `${o.wording("check.decision.open")}${o.open
              .filter((d) => d.id === id)
              .map((d) => d.text)
              .join("\n")}`,
          },
        ]),
      ),
    },
  }
}

const p = (a: unknown): number | null => {
  const x = (a as { probability?: unknown } | undefined)?.probability
  return typeof x === "number" ? x : null
}
/** The answers read back by rule text and open id (null: no probability came back), and whether they settle check:
 *  every rule clearly kept, every open entry clearly conveyed or not, every `must` clearly conveyed. Then nothing is
 *  violated and `fired` is the conveyed ids; otherwise (`pass: false`) the LLM check decides. */
export const checkVerdict = (
  answers: Readonly<Record<string, unknown>>,
  rules: readonly string[],
  openIds: readonly string[],
  must: readonly string[],
) => {
  const read = {
    rules: Object.fromEntries(rules.map((r, i) => [r, p(answers[`g${i}`])])),
    open: Object.fromEntries(openIds.map((id, i) => [id, p(answers[`o${i}`])])),
  }
  const at = (id: string) => read.open[id] ?? null
  const pass =
    rules.every((r) => (read.rules[r] ?? 1) < LO) &&
    openIds.every((id) => {
      const x = at(id)
      return x !== null && (x < LO || x > HI)
    }) &&
    must.every((id) => (at(id) ?? 0) > HI)
  return { pass, fired: openIds.filter((id) => (at(id) ?? 0) > HI), p: read }
}
