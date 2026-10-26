// What a stage reads at a state, as plain text for a person or an agent writing a card (issue #28): the head fragment by
// fragment, the lore at that state, what record asks, and each fiction band beside the readout that moves its field.
// Pure: a card, a player layer and a state in, text out. Nothing here renders a message: the head goes through
// fragment.ts `head`, the lore through lore.ts, the wordings and products through session.ts, and the document whose
// total is printed is `request()` itself, so what prints is what the call would send.
import type { Message } from "@effect-tavern/provider"
import { makeCard, type Card, type State } from "./card.ts"
import { holds, reads, type Cond } from "./cond.ts"
import { frame, head, type Fragment, type Player } from "./fragment.ts"
import { hook, makeLore } from "./lore.ts"
import { request, type Ask } from "./request.ts"
import { resolve } from "./product.ts"
import { defaultProducts, floorAt, questionOf, wordingOf } from "./session.ts"
import { tokens } from "./tokens.ts"

export const stages = ["narrate", "record", "lookup"] as const
export type Stage = (typeof stages)[number]
export interface Options {
  state?: Record<string, string> // field path → value as typed (`--state bond=10`), set after the greeting
  greeting?: number // index into `greetings`; its `do` settles first
  stage?: Stage
}
export interface Section {
  name: string
  tokens: number
  text: string
}
export interface View {
  state: State
  sections: Section[]
  doc: Message[] // request() for the stage at this state, empty input
  total: number
  text: string
}

const textOf = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const when = (c?: Cond) => (c ? ` when ${JSON.stringify(c)}` : "")
const indent = (t: string) => t.replace(/^/gm, "    ")

export const view = (card: Card, player: Player, o: Options = {}): View => {
  const stage = o.stage ?? "narrate"
  const rpg = makeCard(card.rules)
  // The state: initial, a greeting's opening, then the overrides as `set` effects (validated like any effect).
  const g = o.greeting === undefined ? undefined : card.greetings[o.greeting]
  if (o.greeting !== undefined && !g) throw new Error(`greeting ${o.greeting}: the card has ${card.greetings.length}`)
  const opened = rpg.apply(rpg.initial, g?.do ?? [])
  const types = new Map(card.rules.fields.map((f) => [f.path, f.type]))
  const coerce = (path: string, v: string) =>
    types.get(path) === "boolean" ? v === "true" : types.get(path) === "enum" || !types.has(path) ? v : Number(v)
  const s = rpg.apply(
    opened.s,
    Object.entries(o.state ?? {}).map(([path, v]) => ({ path, set: coerce(path, v) })),
  ).s

  // ───────── head ─────────
  const layers = frame(player, card)
  const frag = (zone: string, f: Fragment) => {
    const on = head([f], { state: s })
    const name = `[${zone}] ${f.id}${f.label ? ` ${f.label}` : ""}${when(f.when)}`
    if (!f.text) return { tokens: 0, text: `${name}  (slot, empty)` }
    if (!on.length) return { tokens: 0, text: `${name}  (off)` }
    const t = tokens(on[0]!.text)
    return { tokens: t, text: `${name}  ~${t}\n${indent(on[0]!.text)}` }
  }
  const frags = [
    ...layers
      .filter((f) => stage === "narrate" || f.at !== "tail")
      .map((f) => frag(f.at === "tail" ? "tail" : "frame", f)),
    ...(stage === "narrate" ? card.fiction.map((f) => frag("fiction", f)) : []),
  ]

  // ───────── lore ─────────
  const floors = new Map(
    card.lore.map((e) => [e.id, Math.max(...[rpg.initial, opened.s, s].map((x) => floorAt(e.unlock, x)))]),
  )
  const L = makeLore<Record<string, unknown>, readonly string[]>(
    card.lore.map((e) => ({
      id: e.id,
      layers: e.layers,
      unlock: () => floors.get(e.id)!,
      offer: (x, ev) => holds(e.offer, x, ev),
    })),
  )
  const gated = {
    ...s,
    lore: Object.fromEntries(card.lore.map((e) => [e.id, { since: Infinity, shown: 0, floor: floors.get(e.id) }])),
  }
  const readable = L.readable(gated, [])
  const index = L.index(gated, [])
    .filter((e) => readable.includes(e.id))
    .map((e) => `${e.id}=${e.hook}`)
  const windows = new Map(L.offers(gated, [], opened.events).map((d) => [d.id, d.layer]))
  const lore = card.lore.map((e) => {
    const at = L.current(
      L.entries.find((x) => x.id === e.id)!,
      gated,
      [],
    )
    const w = windows.get(e.id)
    return `${e.id}  layer ${at}/${e.layers.length}${readable.includes(e.id) ? "  in the index" : ""}${w ? `  window opens layer ${w} next turn` : ""}\n    ${hook(e.layers[0]!)}`
  })

  // ───────── record ─────────
  const products = resolve(defaultProducts(card.input ?? "act"), card.products, player.products)
  const asks = products
    .filter((p) => p.on && (!p.when || holds(p.when, s)))
    .map((p) => `${p.id}: ${questionOf(player, card, p)}`)
  const qs = rpg.questions(s)
  const questions = qs.length ? qs : undefined // none active: no Questions line, as the session sends none

  // ───────── the document ─────────
  const ask: Ask =
    stage === "lookup"
      ? { stage, question: wordingOf(player, card, "lookup"), index }
      : stage === "record"
        ? { stage, known: "Known: ", asks, questions, prose: "" }
        : {
            stage,
            fiction: head(card.fiction, { state: s }),
            history: [],
            summarized: false,
            told: [],
            outcome: [],
            must: [],
            may: [],
          }
  const doc = request(
    {
      frame: head(
        layers.filter((f) => f.at !== "tail"),
        { state: s },
      ),
      tail: head(
        layers.filter((f) => f.at === "tail"),
        { state: s },
      ),
      input: { text: "" },
      thought: wordingOf(player, card, "input.thought"),
    },
    ask,
  )
  const total = tokens(doc.map(textOf).join("\n"))

  // ───────── bands ↔ readouts ─────────
  const bands = rpg.asked(s).map((q) => {
    const moved = [...new Set(q.options.flatMap((x) => x.do.flatMap((e) => ("path" in e ? [e.path] : []))))]
    const active = card.fiction.filter(
      (f) => f.when && reads(f.when).some((p) => moved.includes(p)) && head([f], { state: s }).length,
    )
    return [
      `${q.id} moves ${moved.join(", ") || "nothing"}`,
      ...(active.length
        ? active.map((f) => `  band ${f.id}${f.label ? ` ${f.label}` : ""}${when(f.when)}\n${indent(f.text ?? "")}`)
        : [`  (no band on ${moved.join(", ")} holds)`]),
      `  readout: ${q.text}`,
      ...q.options.map((x) => `    ${x.id}: ${x.text}  → ${JSON.stringify(x.do)}`),
    ].join("\n")
  })

  const sections: Section[] = [
    {
      name: `head (${stage})`,
      tokens: frags.reduce((n, f) => n + f.tokens, 0),
      text: frags.map((f) => f.text).join("\n"),
    },
    { name: "lore", tokens: tokens(index.join(", ")), text: lore.join("\n") },
    {
      name: "record",
      tokens: tokens([...asks, ...(questions ?? [])].join("\n")),
      text: [...asks, ...(questions ?? [])].join("\n"),
    },
    { name: "bands ↔ readouts", tokens: 0, text: bands.join("\n\n") },
  ]
  const text = [
    `${card.id} at ${JSON.stringify(s)}${g ? `, after greeting ${o.greeting}` : ""}`,
    ...sections.map((x) => `\n── ${x.name}${x.tokens ? `  ~${x.tokens} tokens` : ""} ──\n${x.text || "(none)"}`),
    `\n── ${stage} document: ${doc.length} messages, ~${total} tokens ──`,
  ].join("\n")
  return { state: s, sections, doc, total, text }
}
