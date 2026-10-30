// The Inspect projection (docs/inspector-prototype.html is the page's shape): one turn's calls as the pipeline that
// ran, a request as its cache regions, a turn's totals. `rows` names each call's place: a check followed by a narrate
// failed into the second draft, the last narrate of a stopped turn is where the player halted. Stages without a call
// take no row (the card declares no actions, nothing to look up, the prose was stopped before check). `groups` folds a two-draft turn's narrate + check pairs into trays, so the first draft reads
// as one discarded thing. `regions` splits a request at its cache breakpoints: the head (byte-stable), the folded
// summary, recent history, this turn's input; a request without breakpoints is all input. Token counts are per call
// (what the provider reports); a region's size is its characters.
import type { Turn } from "@effect-tavern/runtime/src/journal.ts"
import type { Event, Phase } from "@effect-tavern/runtime/src/session.ts"

export type Call = Extract<Event, { kind: "call" }>
export type Message = Call["msgs"][number]
export type Status = "ok" | "stopped" | "failed"
export interface Row {
  phase: Phase
  status: Status
  call: Call
  draft?: number // narrate and check: which draft; set only when the turn had two
}

export const rows = (calls: readonly Call[], turn: Pick<Turn<unknown>, "end">): Row[] => {
  let draft = 0
  const narrates = calls.filter((c) => c.phase === "narrate").length
  return calls.map((c, i) => {
    if (c.phase === "narrate") draft++
    const status: Status =
      c.phase === "check" && calls[i + 1]?.phase === "narrate"
        ? "failed"
        : c.phase === "narrate" && draft === narrates && turn.end === "stopped"
          ? "stopped"
          : "ok"
    const drafted = narrates > 1 && (c.phase === "narrate" || c.phase === "check")
    return { phase: c.phase, status, call: c, ...(drafted && { draft }) }
  })
}

/** A tray: one draft's narrate and check, when the turn had more than one draft. */
export interface Tray {
  draft: number
  rows: Row[]
  failed: boolean // check failed (or the prose was stopped): the draft was discarded
}
export type Group = Row | Tray
export const isTray = (g: Group): g is Tray => "rows" in g
export const groups = (rs: readonly Row[]): Group[] => {
  const out: Group[] = []
  for (const r of rs) {
    if (r.draft === undefined) {
      out.push(r)
      continue
    }
    const last = out.at(-1)
    if (last && isTray(last) && last.draft === r.draft) {
      last.rows.push(r)
      last.failed ||= r.status !== "ok"
    } else out.push({ draft: r.draft, rows: [r], failed: r.status !== "ok" })
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
  breakpoint: boolean // the region ends on a cache breakpoint: everything up to here is the cached prefix
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
    breakpoint: isBreakpoint(c.at(-1)!),
  }))
}

export interface Totals {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  ms: number
}
/** One turn's totals. */
export const totals = (calls: readonly Call[]): Totals => {
  const t: Totals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 }
  for (const c of calls) {
    t.calls++
    t.input += c.usage.input
    t.output += c.usage.output
    t.cacheRead += c.usage.cacheRead
    t.cacheWrite += c.usage.cacheWrite
    t.ms += c.ms
  }
  return t
}
