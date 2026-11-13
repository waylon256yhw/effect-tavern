// The decision model in front of check (#171): the same judgement asked as typed yes/no questions, answered with
// probabilities and no prose. The LLM check stays the definition: this pass only settles a turn whose every answer is
// clear, and never triggers a rewrite by itself (session.ts `check`). One builder for the turn and the instruments
// (server bin/decision-replay.ts, decision-probe.ts), so what they measure is what the turn sends.
import type { Question } from "@effect-tavern/provider"
import { tag } from "./request.ts"

// ponytail: a first calibration from decision-probe readings (clean 0.02–0.08, violated 0.95+); re-read against the
// probe before moving either.
export const LO = 0.25
export const HI = 0.75

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
