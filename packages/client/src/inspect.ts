import type { StageStep, StageEvent, StageBudget } from "@effect-tavern/provider/src/stage.ts"
import { splitter } from "@effect-tavern/runtime/src/journal.ts"
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

/** Where the prose's calls end: the first polish or record (the whole list when neither ran). A narrate after it is a
 *  demanded block (a narrate-stage product asked for later, session.ts `demand`), not a draft of the prose. */
export const settledAt = (calls: readonly { phase: Phase }[]): number => {
  const i = calls.findIndex((c) => c.phase === "polish" || c.phase === "record")
  return i === -1 ? calls.length : i
}

export const rows = (calls: readonly Call[], turn: Pick<Turn<unknown>, "end">): Row[] => {
  let draft = 0
  const settled = settledAt(calls)
  const narrates = calls.filter((c, i) => c.phase === "narrate" && i < settled).length
  return calls.map((c, i) => {
    const drafting = c.phase === "narrate" && i < settled
    if (drafting) draft++
    const native = nativeTrace(c.out)
    const status: Status =
      native?.status === "cancelled"
        ? "stopped"
        : native && native.status !== "completed"
          ? "failed"
          : c.phase === "check" && calls[i + 1]?.phase === "narrate"
            ? "failed"
            : drafting && draft === narrates && turn.end === "stopped"
              ? "stopped"
              : "ok"
    const drafted = narrates > 1 && i < settled && (c.phase === "narrate" || c.phase === "check")
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** The query as a literal, case-insensitive pattern; `split` with it keeps the matches at the odd indexes. */
export const pattern = (q: string) => new RegExp(`(${escapeRe(q)})`, "gi")
/** Matches of the (literal) query in a text; none for an empty query. */
export const count = (text: string, q: string) => (q ? (text.match(pattern(q)) ?? []).length : 0)

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

/** A row's matches of the query in its request. */
export const requestHits = (r: Row, q: string): number => r.call.msgs.reduce((n, m) => n + count(textOf(m), q), 0)
/** A row's matches of the query: its request's messages and its answer when that is prose (marked in the well too). */
export const rowHits = (r: Row, q: string): number =>
  requestHits(r, q) + (typeof r.call.out === "string" ? count(r.call.out, q) : 0)
/** The view an opened row lands on: the request when the query hits there, otherwise the result. */
export const defaultView = (r: Row, q: string): "result" | "prompt" =>
  q && requestHits(r, q) > 0 ? "prompt" : "result"

/** Successful, exhausted and failed attempts carry steps; cancellation retains incremental events. */
export const nativeTrace = (
  out: unknown,
): { steps: readonly StageStep[]; status: string; reason?: string; budget?: StageBudget } | undefined => {
  if (!out || typeof out !== "object" || !("status" in out)) return undefined
  const value = out as {
    status: string
    reason?: string
    budget?: StageBudget
    trace?: StageStep[]
    events?: StageEvent[]
  }
  if (value.trace) return { ...value, steps: value.trace }
  if (!value.events) return undefined
  const steps = new Map<number, StageStep>()
  for (const event of value.events) {
    if (event.kind === "end") continue
    const step = steps.get(event.step) ?? { index: event.step, messages: [], calls: [] }
    if (event.kind === "request") step.messages = event.messages
    if (event.kind === "response") {
      step.response = event.messages
      step.usage = event.usage
      step.finishReason = event.finishReason
    }
    if (event.kind === "tool") step.calls.push(event.call)
    steps.set(event.step, step)
  }
  return { ...value, steps: [...steps.values()] }
}

// ───────── A row's head and its opened result, as data (inspector.tsx draws) ─────────

/** The ordinal after a stage's name, only when that stage ran more than once in the node; check's pre-check
 *  (`via: "decision"`) counts apart from the LLM check. */
export const ordinals = (rs: readonly Row[]): (number | undefined)[] => {
  const key = (r: Row) => r.call.via ?? r.phase
  return rs.map((r) => {
    const same = rs.filter((x) => key(x) === key(r))
    return same.length > 1 ? same.indexOf(r) + 1 : undefined
  })
}
/** Whether the cache slot exists: any call of the turn read or wrote the cache. */
export const cached = (calls: readonly Call[]): boolean =>
  calls.some((c) => c.usage.cacheRead > 0 || c.usage.cacheWrite > 0)
/** The prose's first sentence: cut after the first 。！？!? (with its closing quotes) or at the first newline. */
export const firstSentence = (text: string): string =>
  /^[^\n]*?(?:[。！？!?][”’"'」』）)]*|(?=\n)|$)/.exec(text.trim())![0].trim()

/** An interface word a pill carries; the drawing turns it into the locale's word. */
export type Word = "precheck" | "escalate" | "stopped" | "exhausted" | "failed" | "sentences"
export type Tone = "ok" | "bad" | "warn" | "soft"
/** A pill: the card's own text, or an interface word (`n` for its count). */
export interface Pill {
  text?: string
  word?: Word
  n?: number
  tone?: Tone
  hint?: string
}
export interface Digest {
  pills: Pill[]
  note?: string // grey, after the pills
  line?: string // the prose's first sentence, ellipsed by its column
}
/** What a head reads besides the call: the node's beats and checks, the brief's must, a product's shown name. */
export interface Facts {
  beats: readonly { next: string; chance?: number }[]
  checks: readonly { action: string; chance: number; roll: number; hit: boolean }[]
  must: readonly string[]
  label: (product: string) => string
  /** The labels of the fields the chosen readout options write (a readout's answer moves fields, not products). */
  fields: (answers: Readonly<Record<string, string>>) => string[]
}

/** The entry titles a lookup read (a resident revision is not read again, and carries no title). */
export const readTitles = (calls: readonly StageStep["calls"][number][]): string[] => [
  ...new Set(
    calls.flatMap((c) =>
      c.name === "read_context" && c.result.ok && Array.isArray(c.result.value)
        ? (c.result.value as { title?: unknown }[]).flatMap((x) => (typeof x.title === "string" ? [x.title] : []))
        : [],
    ),
  ),
]
/** The products a record wrote: the world products its changes touched and the scene products it finished with. */
const written = (value: unknown, f: Pick<Facts, "label" | "fields">): string[] => {
  const v = (value ?? {}) as {
    changes?: { product?: string; collection?: string }[]
    products?: Record<string, unknown>
    answers?: Record<string, string>
  }
  return [
    ...new Set([
      ...f.fields(v.answers ?? {}),
      ...(v.changes ?? [])
        .flatMap((c) => [c.product ?? c.collection ?? ""])
        .filter(Boolean)
        .map(f.label),
      ...Object.entries(v.products ?? {}).flatMap(([k, x]) => (x === undefined || x === "" ? [] : [f.label(k)])),
    ]),
  ]
}
/** The polish targets: each sentence as sent (the request's marks, when the trace carries it) and as it came back. */
export const polishPairs = (call: Call): { id: string; before?: string; after: string }[] => {
  const sent = new Map(
    call.msgs.flatMap((m) =>
      [...textOf(m).matchAll(/<target id="(hit-\d+)"[^>]*>(.*?)<\/target>/g)].map(([, id, s]) => [id!, s!] as const),
    ),
  )
  return Object.entries((call.out ?? {}) as Record<string, unknown>).map(([id, after]) => ({
    id,
    ...(sent.has(id) && { before: sent.get(id) }),
    after: String(after),
  }))
}
/** The pre-check's reading: one line per rule and open entry with its probability (null: none came back). */
export const precheck = (
  out: unknown,
): { lines: { label: string; p: number | null }[]; escalate: boolean; error?: string } => {
  const o = (out ?? {}) as {
    p?: { rules?: Record<string, number | null>; open?: Record<string, number | null> }
    verdict?: string
    error?: string
  }
  return {
    lines: [...Object.entries(o.p?.rules ?? {}), ...Object.entries(o.p?.open ?? {})].map(([label, p]) => ({
      label,
      p: p ?? null,
    })),
    escalate: o.verdict !== "pass",
    ...(o.error !== undefined && { error: o.error }),
  }
}

/** A narrate answer as its prose and the blocks it opened (journal.ts `splitter`), each run of one kind merged. */
export const pieces = (text: string): { id?: string; text: string }[] => {
  const out: { id?: string; text: string }[] = []
  for (const p of splitter()(text, true)) {
    const last = out.at(-1)
    if (last && last.id === p.id) last.text += p.text
    else out.push({ ...(p.id !== undefined && { id: p.id }), text: p.text })
  }
  return out.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text)
}

const abnormal = (status: string): Pill | undefined =>
  status === "cancelled"
    ? { word: "stopped", tone: "warn" }
    : status === "budget_exhausted"
      ? { word: "exhausted", tone: "warn" }
      : status === "failed"
        ? { word: "failed", tone: "bad" }
        : undefined
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** A row's head: what the stage decided, from the call's answer and the node's facts. `nth`: the row's place among
 *  the node's rows of its stage (decide reads the nth beat). A stage with nothing to say gives no pills. */
export const digest = (r: Row, nth: number, f: Facts): Digest => {
  const out = r.call.out
  const o = (out ?? {}) as Record<string, unknown>
  const native = nativeTrace(out)
  if (native) {
    const bad = abnormal(native.status)
    const value = (out as { value?: unknown }).value
    const calls = native.steps.flatMap((s) => s.calls)
    const names = r.phase === "lookup" ? readTitles(calls) : written(value, f)
    return { pills: [...(bad ? [bad] : []), ...names.map((text) => ({ text }))] }
  }
  if (r.call.via === "decision") {
    const x = precheck(out)
    return {
      pills: [
        { word: "precheck", ...(x.error !== undefined && { tone: "bad" as const, hint: x.error }) },
        ...(x.escalate ? [{ word: "escalate" as const }] : []),
      ],
    }
  }
  switch (r.phase) {
    case "decide": {
      const beat = f.beats[nth]
      if (beat?.chance === undefined) return { pills: [{ text: beat?.next ?? "end" }] }
      const c = f.checks[f.beats.slice(0, nth + 1).filter((b) => b.chance !== undefined).length - 1]
      return c
        ? {
            pills: [{ text: c.action, tone: c.hit ? "ok" : "bad" }],
            note: `${c.roll.toFixed(2)} / ${Math.round(c.chance * 100)}%`,
          }
        : { pills: [{ text: beat.next }] }
    }
    case "direct":
      return {
        pills: [
          ...ids(o.must).map((text) => ({ text })),
          ...ids(o.may).map((text) => ({ text, tone: "soft" as const })),
        ],
      }
    case "narrate": {
      // the prose's first sentence; a demanded block has no prose, so its own first sentence stands in
      const ps = pieces(typeof out === "string" ? out : "")
      return {
        pills: r.status === "stopped" ? [{ word: "stopped", tone: "warn" }] : [],
        line: firstSentence(ps.find((x) => x.id === undefined)?.text || ps[0]?.text || ""),
      }
    }
    case "check": {
      const fired = ids(o.fired)
      return {
        pills: [
          ...f.must.filter((id) => !fired.includes(id)).map((text) => ({ text, tone: "bad" as const })),
          ...ids(o.violated).map((text) => ({ text, tone: "bad" as const })),
        ],
      }
    }
    case "polish":
      return { pills: [{ word: "sentences", n: polishPairs(r.call).filter((x) => x.before !== x.after).length }] }
    default:
      return { pills: [] }
  }
}

/** One item of a tool step's line: a search and its hit count, the titles read, a record operation on a product by
 *  its shown name, or the completion call as what it wrote. A step that did nothing has no items, and no line. */
export type Op =
  | { kind: "search"; query: string; n?: number; error?: string }
  | { kind: "read"; titles: string[]; error?: string }
  | { kind: "op"; verb: string; target: string; error?: string }
  | { kind: "wrote"; names: string[]; error?: string }
export const stepOps = (step: StageStep, f: Pick<Facts, "label" | "fields">): Op[] =>
  step.calls.flatMap((c): Op[] => {
    const error = c.result.ok ? undefined : c.result.code
    const e = error === undefined ? {} : { error }
    if (c.name === "search_context") {
      const q = (c.input as { query?: unknown } | undefined)?.query
      return [
        {
          kind: "search",
          query: typeof q === "string" ? q : "",
          ...(c.result.ok && Array.isArray(c.result.value) && { n: c.result.value.length }),
          ...e,
        },
      ]
    }
    if (c.name === "read_context") return [{ kind: "read", titles: readTitles([c]), ...e }]
    if (c.name === "finish_record") {
      const names = c.result.ok ? written(c.result.value, f) : []
      return names.length || error !== undefined ? [{ kind: "wrote", names, ...e }] : []
    }
    const m = /^(read|replace|patch|insert|remove)_(.+)$/.exec(c.name)
    return [
      m ? { kind: "op", verb: m[1]!, target: f.label(m[2]!), ...e } : { kind: "op", verb: c.name, target: "", ...e },
    ]
  })
