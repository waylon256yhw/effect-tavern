// What a stage reads at a state, as plain text for a person or an agent writing a card (issue #28): the head fragment by
// fragment, the lore at that state, what record asks, and each fiction band beside the readout that moves its field.
// Pure: a card, the player's rows and a state in, text out. Nothing here renders a message: the head goes through
// fragment.ts `head`, the lore through lore.ts, the wordings and products through layer.ts, and the document whose
// total is printed is `request()` itself, so what prints is what the call would send.
import type { Message } from "@effect-tavern/provider"
import { drawn, makeCard, type Card, type State } from "./card.ts"
import { holds, lookup, reads, type Cond } from "./cond.ts"
import { head, type Fragment } from "./fragment.ts"
import { resolve, type Rows } from "./layer.ts"
import { hook, makeLore, namedLore } from "./lore.ts"
import { lines, fill } from "./names.ts"
import { request, type Ask } from "./request.ts"
import { cond, effect, labels } from "./phrase.ts"
import { contextLookup, deliveryText, freeze, latest, resourcesAt, fedResources } from "./context.ts"
import { floorAt, currentAt } from "./derived.ts"

import { initialWorld } from "./world.ts"
import { withCatalogs, askedAt, productAsks } from "./product.ts"
import { tokens } from "./tokens.ts"

export const stages = ["narrate", "direct", "record", "lookup"] as const
export type Stage = (typeof stages)[number]
export interface Options {
  state?: Record<string, string> // field path → value as typed (`--state bond=10`), set after the greeting
  greeting?: number // index into `greetings`; its `do` settles first
  events?: readonly string[]
  pin?: string
  stage?: Stage
  lore?: boolean // list every lore entry; by default the fully unlocked ones with no window are one count line
}
export interface Section {
  name: string
  tokens: number
  text: string
}
export interface View {
  state: State
  bands: string[] // the conditional fiction fragments whose `when` holds at this state
  windows: string[] // `<lore id>→<layer>`: the entries whose offer holds at this state (the greeting's events counted)
  asked: string[] // the readouts record would ask at this state
  sections: Section[]
  doc: Message[] // request() for the stage at this state, empty input
  total: number
  text: string
}

const textOf = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("")
const indent = (t: string) => t.replace(/^/gm, "    ")

export const view = (card: Card, rows: Rows, o: Options = {}): View => {
  const stage = o.stage ?? "narrate"
  const rpg = makeCard(card.rules)
  // The state: initial, a greeting's opening, then the overrides as `set` effects (validated like any effect).
  const g = o.greeting === undefined ? undefined : card.greetings[o.greeting]
  if (o.greeting !== undefined && !g) throw new Error(`greeting ${o.greeting}: the card has ${card.greetings.length}`)
  const opened = rpg.apply(rpg.initial, g?.do ?? [])
  const types = new Map(card.rules.fields.map((f) => [f.path, f.type]))
  const coerce = (path: string, v: string) =>
    types.get(path) === "boolean"
      ? v === "true"
        ? true
        : v === "false"
          ? false
          : v
      : types.get(path) === "enum" || !types.has(path)
        ? v
        : Number(v)
  const s = rpg.apply(
    opened.s,
    Object.entries(o.state ?? {}).map(([path, v]) => ({ path, set: coerce(path, v) })),
  ).s

  // ───────── head ─────────
  const R = resolve(card, rows)
  const world = initialWorld(R.products)
  const context = { fields: s, world }
  const events = [...opened.events, ...(o.events ?? [])]
  const fiction = fill(card.fiction, R.names)
  const layers = [...R.frame, ...R.tail]
  const frag = (zone: string, f: Fragment) => {
    const on = head([f], { state: context })
    const name = `[${zone}] ${f.id}${f.label ? ` ${f.label}` : ""}${f.when ? ` when ${cond(f.when, labels(card.rules))}` : ""}${"from" in f ? ` (from ${String(f.from)})` : ""}`
    if (!f.text) return { tokens: 0, text: `${name}  (slot, empty)` }
    if (!on.length) return { tokens: 0, text: `${name}  (off)` }
    const t = tokens(on[0]!.text)
    return { tokens: t, text: `${name}  ~${t}\n${indent(on[0]!.text)}` }
  }
  const frags = [
    ...layers
      .filter((f) => stage === "narrate" || f.at !== "tail")
      .map((f) => frag(f.at === "tail" ? "tail" : "frame", f)),
    ...(stage === "narrate" ? fiction.map((f) => frag("fiction", f)) : []),
  ]

  // ───────── lore ─────────
  const floors = new Map(
    card.lore.map((e) => [
      e.id,
      Math.max(...[rpg.initial, opened.s, s].map((x) => floorAt(e.unlock, { fields: x, world }))),
    ]),
  )
  // the index as the session builds it (session.ts `current`): the card's entries expanded, one with an unfilled hole left
  // out. Pack resources stay separate from story disclosure, as in derived.ts.
  const own = namedLore(card.lore, R.names)
  const L = makeLore<Record<string, unknown>, readonly string[]>(
    own.map((e) => ({
      ...e,
      unlock: () => floors.get(e.id)!,
      offer: (x: Record<string, unknown>, ev: readonly string[]) => holds(e.offer, x, ev),
    })),
  )
  const gated = {
    ...context,
    lore: Object.fromEntries(card.lore.map((e) => [e.id, { since: Infinity, shown: 0, floor: floors.get(e.id)! }])),
  }
  const resources = resourcesAt({ lore: L, state: gated, seen: [], packs: R.entries, products: R.products })
  // Bare ids refer to card lore; pack ids use the runtime's pack:<row>/<entry> identity.
  const pin = o.pin?.includes(":") ? o.pin : o.pin ? `card:${o.pin}` : undefined
  const pinned = resources.find((r) => r.resourceId === pin)
  if (pin && !pinned?.access.player) throw new Error(`pin ${o.pin}: entry is not available to the player`)
  const frozen = latest([
    ...resources.filter((r) => r.activation === "always" && r.access.model).map((r) => freeze(r)),
    ...(pinned ? [freeze(pinned)] : []),
  ])
  const injected = frozen.map(deliveryText)
  const held = [...frozen, ...fedResources(resources, R.products).map((r) => freeze(r))]
  const lookupContext = contextLookup(resources, held)
  const readable = new Set(lookupContext.readable().map((r) => r.resourceId))

  const windows = new Map(L.offers(gated, [], events).map((d) => [d.id, d.layer]))
  const listed = own.map((e) => {
    const at = L.current(
      L.entries.find((x) => x.id === e.id)!,
      gated,
      [],
    )
    const w = windows.get(e.id)
    return {
      // an always-on entry spends request tokens every turn: it is never part of the quiet remainder
      settled: at === e.layers.length && !w && e.activation !== "always",
      text: `${e.id}  layer ${at}/${e.layers.length}${e.sections?.length ? `  ${e.sections.length} sections` : ""}${readable.has(`card:${e.id}`) ? "  in the index" : ""}${w ? `  window opens layer ${w} next turn` : ""}\n    ${hook(e.layers[0]!)}${(e.sections ?? []).map((x) => `\n    #${x.id} ${hook(x.text)}`).join("")}`,
    }
  })
  const settled = o.lore ? 0 : listed.filter((r) => r.settled).length
  const lore = [
    ...listed.filter((r) => o.lore || !r.settled).map((r) => r.text),
    ...(settled ? [`(${settled} more fully unlocked, no window; --lore lists them)`] : []),
    ...R.entries.map(
      (e) => `${e.id}  (${e.from})${readable.has(`pack:${e.id}`) ? "  in the index" : ""}\n    ${hook(e.text)}`,
    ),
  ]

  const offered = L.offers(gated, [], events)
  const explain = (path: string, c: Cond, ev: readonly string[] = []): string[] => [
    `${path}: ${holds(c, gated, ev)} — ${cond(c, labels(card.rules))}${"path" in c ? ` (current ${c.path}=${String(lookup(gated, c.path))})` : ""}`,
    ...("all" in c ? c.all : "any" in c ? c.any : "not" in c ? [c.not] : []).flatMap((child, i) =>
      explain(`${path}.${i}`, child, ev),
    ),
  ]
  // Explain declared predicates consistently; unconditional entries have no gate to diagnose.
  const whens = (zone: string, entries: readonly { id: string; when?: Cond }[]) =>
    entries.flatMap((e) => (e.when ? explain(`${zone}.${e.id}.when`, e.when) : []))
  const gates = [
    ...whens("frame", R.frame),
    ...whens("tail", R.tail),
    ...whens("fiction", fiction),
    ...whens("actions", card.rules.actions),
    ...whens("readouts", card.rules.readouts ?? []),
    ...whens("products", R.products),
    ...(card.rules.over ? explain("rules.over", card.rules.over) : []),
  ]
  // the same rule for lore: `{ all: [] }` / `{ any: [] }` is a constant, not a gate
  const constant = (c: Cond) => ("all" in c && !c.all.length) || ("any" in c && !c.any.length)
  const loreGates = card.lore.flatMap((e) => [
    ...(Array.isArray(e.unlock) ? e.unlock : [e.unlock]).flatMap((c, i) =>
      constant(c) ? [] : explain(`lore.${e.id}.unlock.${i}`, c),
    ),
    ...(constant(e.offer) ? [] : explain(`lore.${e.id}.offer`, e.offer, events)),
  ])

  // ───────── record ─────────
  // a 小剧场 is narrate's, not this record document's; a catalog with no survivor drops what reads it (session `record`)
  const asked = withCatalogs(askedAt(R.products, "record", gated), card.catalogs ?? [], gated)
  const asks = productAsks(asked, gated)
  const qs = rpg.questions(s, R.names, context)
  const questions = qs.length ? qs : undefined // none active: no Questions line, as the session sends none
  // the narrate products on: one `<id>: <question>` line each after the prose directive (session.ts `penned`)
  const penned = askedAt(R.products, "narrate", gated).map((p) => `${p.id}: ${p.text}`)

  // ───────── the document ─────────
  const ask: Ask =
    stage === "direct"
      ? {
          stage,
          question: R.asks["direct"]!.text,
          ledger: [],
          rules: lines(card.guard, R.names),
          open: offered.map((d) => ({ id: d.id, text: d.text! })),
          events,
        }
      : stage === "lookup"
        ? {
            stage,
            question: R.asks["lookup"]!.text,
            context: frozen.map(lookupContext.told),
            current: currentAt(R.products, world), // session.ts: sections listed for lookup only
            ledger: [],
          }
        : stage === "record"
          ? {
              stage,
              known: "Known: ",
              current: currentAt(R.products, world, {}, true),
              invoked: pinned ? [deliveryText(freeze(pinned))] : [],
              asks,
              tools: R.asks["record.tools"]!.text,
              readout: R.asks["record.readout"]!.text,
              questions,
              prose: "",
            }
          : {
              stage,
              fiction: head(fiction, { state: context }),
              history: [],
              summarized: false,
              told: injected,
              current: currentAt(R.products, world),
              outcome: events,
              must: [],
              may: offered.map((d) => ({ id: d.id, text: d.text! })),
              blocks: { question: R.asks["narrate.blocks"]!.text, asks: penned },
            }
  const doc = request(
    {
      frame: head(R.frame, { state: context }),
      tail: head(R.tail, { state: context }),
      input: { text: "" },
      thought: R.asks["input.thought"]!.text,
    },
    ask,
  )
  const total = tokens(doc.map(textOf).join("\n"))

  // ───────── bands ↔ readouts ─────────
  const bands = rpg.asked(s, R.names, context).map((q) => {
    const moved = [...new Set(q.options.flatMap((x) => x.do.flatMap((e) => ("path" in e ? [e.path] : []))))]
    const active = card.fiction.filter(
      (f) => f.when && reads(f.when).some((p) => moved.includes(p)) && head([f], { state: context }).length,
    )
    return [
      `${q.id} moves ${moved.join(", ") || "nothing"}`,
      ...(active.length
        ? active.map(
            (f) =>
              `  band ${f.id}${f.label ? ` ${f.label}` : ""}${f.when ? ` when ${cond(f.when, labels(card.rules))}` : ""}\n${indent(f.text ?? "")}`,
          )
        : [`  (no band on ${moved.join(", ")} holds)`]),
      `  readout: ${q.text}`,
      ...q.options.map((x) => `    ${x.id}: ${x.text}  → ${x.do.map((e) => effect(e, labels(card.rules))).join(", ")}`),
    ].join("\n")
  })

  // a stage reads lore when its ask carries some: lookup's context, narrate's told / may, direct's Open line
  const readsLore = "context" in ask || "told" in ask || "open" in ask
  const sections: Section[] = [
    {
      name: `head (${stage})`,
      tokens: frags.reduce((n, f) => n + f.tokens, 0),
      text: frags.map((f) => f.text).join("\n"),
    },
    ...(readsLore ? [{ name: "lore", tokens: 0, text: lore.join("\n") }] : []),
    {
      name: "record",
      tokens: tokens([...asks, ...(questions ?? [])].join("\n")),
      text: [...asks, ...(questions ?? [])].join("\n"),
    },
    { name: "bands ↔ readouts", tokens: 0, text: bands.join("\n\n") },
    { name: "gates", tokens: 0, text: [...gates, ...(readsLore ? loreGates : [])].join("\n") },
    { name: "narrate blocks", tokens: tokens(penned.join("\n")), text: penned.join("\n") },
  ]
  const text = [
    `${card.id} at ${JSON.stringify(s)}${g ? `, after greeting ${o.greeting}` : ""}`,
    ...sections.map((x) => `\n── ${x.name}${x.tokens ? `  ~${x.tokens} tokens` : ""} ──\n${x.text || "(none)"}`),
    `\n── ${stage} document: ${doc.length} messages, ~${total} tokens ──`,
    ...doc.map(
      (m, i) =>
        `[${i}] ${m.role}${m.providerOptions?.anthropic?.cacheControl ? " [cache breakpoint]" : ""}\n${textOf(m)}`,
    ),
  ].join("\n")
  return {
    state: s,
    bands: card.fiction.filter((f) => f.when && head([f], { state: context }).length).map((f) => f.id),
    windows: [...windows].map(([id, layer]) => `${id}→${layer}`),
    asked: rpg.asked(s, R.names, context).map((q) => q.id),
    sections,
    doc,
    total,
    text,
  }
}

/** One line per shown field with what the client draws it as (card.ts `drawn`): the meter kind with its stage
 *  thresholds, a step track's options, or a value row; the author sees the picture without the client. */
export const fields = (card: Card): string[] =>
  card.rules.fields
    .filter((f) => !f.hidden)
    .map((f) => {
      const d = drawn(
        f,
        card.fiction.map((x) => x.when),
      )
      const how =
        d.as === "steps"
          ? `steps ${f.options!.join(" | ")}`
          : d.as === "value"
            ? "value"
            : `${d.as} ${f.min}..${f.max}${d.cuts.length ? `  cuts ${d.cuts.join(" ")}` : ""}`
      return `field ${f.path}  ${how}`
    })
/** One line per greeting (`card check`): the state its `do` leaves, and what that state puts in play before a word of
 *  prose is written: the fiction bands that hold, the lore windows open for turn 1, the readouts record asks after it.
 *  An observation, not a rule (#83): an opening that fires an event on turn 1 may be meant; the author reads it here
 *  rather than in a live run (ri's single opening set 好感度 60, and the confession opened and was judged on turn 1). */
export const openings = (card: Card, rows: Rows): string[] =>
  card.greetings.map((_, i) => {
    const v = view(card, rows, { greeting: i })
    const state = Object.entries(v.state).map(([k, x]) => `${k}=${x}`)
    const list = (xs: string[]) => (xs.length ? xs.join(", ") : "-")
    return `greeting ${i}  ${state.length ? state.join(" ") : "(no fields)"}  bands: ${list(v.bands)}  windows: ${list(v.windows)}  readouts: ${list(v.asked)}`
  })
