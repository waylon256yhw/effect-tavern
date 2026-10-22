// The Inspect projection: one turn's calls as the six-stage trace, a request as its cache regions, and the session's
// totals. `rows` lays the calls on the fixed pipeline: a stage with no call is a dashed row (the card declares no
// actions, nothing to look up, the prose was stopped before check), a check followed by a narrate failed into the
// second draft, the last narrate of a stopped turn is where the player halted. `regions` splits a request at its
// cache breakpoints: the head (byte-stable), the folded summary, recent history, this turn's input; a request without
// breakpoints is all input. Token counts are per call (what the provider reports); a region's size is its characters.
import type { Turn } from "@effect-tavern/runtime/src/journal.ts"
import type { Event, Phase } from "@effect-tavern/runtime/src/session.ts"

export type Call = Extract<Event, { kind: "call" }>
export type Message = Call["msgs"][number]
export type Status = "ok" | "stopped" | "failed" | "skipped"
export interface Row {
  phase: Phase
  status: Status
  call?: Call // absent on a skipped row
  draft?: number // narrate and check: which draft; set only when the turn had two
}
export const PHASES: readonly Phase[] = ["lookup", "decide", "direct", "narrate", "check", "record"]

export const rows = (calls: readonly Call[], turn: Pick<Turn<unknown>, "end">): Row[] => {
  const out: Row[] = []
  let draft = 0
  const narrates = calls.filter((c) => c.phase === "narrate").length
  calls.forEach((c, i) => {
    if (c.phase === "narrate") draft++
    const status: Status =
      c.phase === "check" && calls[i + 1]?.phase === "narrate"
        ? "failed"
        : c.phase === "narrate" && draft === narrates && turn.end === "stopped"
          ? "stopped"
          : "ok"
    const drafted = narrates > 1 && (c.phase === "narrate" || c.phase === "check")
    out.push({ phase: c.phase, status, call: c, ...(drafted && { draft }) })
  })
  // the skeleton: every stage without a call, dashed, in pipeline order
  for (const phase of PHASES) {
    if (out.some((r) => r.phase === phase)) continue
    const at = out.findIndex((r) => PHASES.indexOf(r.phase) > PHASES.indexOf(phase))
    out.splice(at < 0 ? out.length : at, 0, { phase, status: "skipped" })
  }
  return out
}

export const textOf = (m: Message): string =>
  typeof m.content === "string"
    ? m.content
    : m.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("")

const isBreakpoint = (m: Message): boolean =>
  (m.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic?.cacheControl !== undefined

export interface Region {
  name: "Head" | "Summary" | "History" | "Input"
  msgs: readonly Message[]
  chars: number
}
const NAMES: Record<number, Region["name"][]> = {
  1: ["Input"],
  2: ["Head", "Input"],
  3: ["Head", "History", "Input"],
  4: ["Head", "Summary", "History", "Input"],
}
export const regions = (msgs: readonly Message[]): Region[] => {
  const chunks: Message[][] = [[]]
  for (const m of msgs) {
    chunks.at(-1)!.push(m)
    if (isBreakpoint(m)) chunks.push([])
  }
  if (chunks.at(-1)!.length === 0) chunks.pop() // a request ending on a breakpoint: no input region
  const names = NAMES[chunks.length] ?? NAMES[4]!
  return chunks.map((c, i) => ({
    name: names[Math.min(i, names.length - 1)]!,
    msgs: c,
    chars: c.reduce((n, m) => n + textOf(m).length, 0),
  }))
}

export interface Totals {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  ms: number
}
export const totals = (calls: Iterable<readonly Call[]>): Totals => {
  const t: Totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 }
  for (const list of calls)
    for (const c of list) {
      t.requests++
      t.input += c.usage.input
      t.output += c.usage.output
      t.cacheRead += c.usage.cacheRead
      t.cacheWrite += c.usage.cacheWrite
      t.ms += c.ms
    }
  return t
}
