// Card lint (issue #27): what a card author's type checker says about a card. Pure: a card in, facts and fixes out; no
// I/O, no console. The throws in `makeCard` / `resolve` stay decode-time invariants; lint reports what decodes but is
// wired wrong (topology: events, fields, bands, layers) or written where code should do the work (prose: numbers and
// output formats in the text). Rules are the list at the bottom; there is no plugin system and no config.
import type { Card, Effect_, Field } from "./card.ts"
import { type Cond, holds, reads } from "./cond.ts"
import { hook } from "./lore.ts"
import { type Entry, scan } from "./polish.ts"

export interface Diagnostic {
  rule: string
  level: "error" | "warn"
  path: string // the place in the card: `lore.li.layers[0]`, `rules.fields.bond`, `fiction.pei-cool.text`
  message: string
  hint?: string
}
type Effect = typeof Effect_.Type
type Rule = (card: Card) => Diagnostic[]

// ───────── the card's own graph ─────────
const leaves = (c: Cond): Cond[] =>
  "all" in c ? c.all.flatMap(leaves) : "any" in c ? c.any.flatMap(leaves) : "not" in c ? leaves(c.not) : [c]
const eventsOf = (c: Cond) => leaves(c).flatMap((l) => ("event" in l ? [l.event] : []))
const unlocks = (e: Card["lore"][number]) => (Array.isArray(e.unlock) ? e.unlock : [e.unlock]) as readonly Cond[]
const unlockPath = (e: Card["lore"][number], i: number) =>
  Array.isArray(e.unlock) ? `lore.${e.id}.unlock[${i}]` : `lore.${e.id}.unlock`

/** Every Cond over state in the card, with its place. Product table filters read rows, not state, and are left out. */
const conds = (card: Card): [string, Cond][] => [
  ...card.frame.flatMap((f): [string, Cond][] => (f.when ? [[`frame.${f.id}.when`, f.when]] : [])),
  ...card.fiction.flatMap((f): [string, Cond][] => (f.when ? [[`fiction.${f.id}.when`, f.when]] : [])),
  ...card.rules.actions.flatMap((a): [string, Cond][] => (a.when ? [[`rules.actions.${a.id}.when`, a.when]] : [])),
  ...(card.rules.readouts ?? []).flatMap((q): [string, Cond][] =>
    q.when ? [[`rules.readouts.${q.id}.when`, q.when]] : [],
  ),
  ...(card.rules.over ? [["rules.over", card.rules.over] as [string, Cond]] : []),
  ...card.lore.flatMap((e): [string, Cond][] => [
    ...unlocks(e).map((c, i): [string, Cond] => [unlockPath(e, i), c]),
    [`lore.${e.id}.offer`, e.offer],
  ]),
  ...(card.products ?? []).flatMap((p): [string, Cond][] => (p.when ? [[`products.${p.id}.when`, p.when]] : [])),
]
/** Every effect in the card, with its place: actions, readout options, greeting openings. */
const effects = (card: Card): [string, Effect][] => {
  const at = (base: string, es: readonly Effect[] | undefined) =>
    (es ?? []).map((e, i): [string, Effect] => [`${base}[${i}]`, e])
  return [
    ...card.rules.actions.flatMap((a) => [
      ...at(`rules.actions.${a.id}.hit`, a.hit),
      ...at(`rules.actions.${a.id}.miss`, a.miss),
      ...at(`rules.actions.${a.id}.do`, a.do),
    ]),
    ...(card.rules.readouts ?? []).flatMap((q) =>
      q.options.flatMap((o) => at(`rules.readouts.${q.id}.options.${o.id}.do`, o.do)),
    ),
    ...card.greetings.flatMap((g, i) => at(`greetings[${i}].do`, g.do)),
  ]
}
const written = (card: Card, by: "rules.actions." | "rules.readouts.") =>
  new Set(effects(card).flatMap(([p, e]) => (p.startsWith(by) && "path" in e ? [e.path] : [])))
/** An emitted event with `{path}` interpolation names a family: `hp:{hp}` emits `hp:3`, which `{ event: "hp:3" }` reads. */
const emits = (template: string, name: string) =>
  new RegExp(
    `^${template
      .split(/\{[^}]+\}/)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(name)

// ───────── values a field can take, piecewise ─────────
// Every Cond leaf is a threshold, so the truth of any Cond over one numeric field is constant between thresholds: the
// thresholds themselves (closed points) and one sample per open gap between them decide it everywhere in min..max.
interface Piece {
  lo: number
  hi: number
  closed: boolean // a point [lo, lo] when true, the open interval (lo, hi) otherwise
  at: number // the sample the Conds are evaluated at
}
const counter = /^lore\.[^.]+\.(since|shown)$/ // lore counters: readable like a field, never declared
const fieldOf = (fields: ReadonlyMap<string, Field>, path: string): Pick<Field, "type" | "min" | "max" | "options"> =>
  fields.get(path) ?? (counter.test(path) ? { type: "int", min: 0 } : { type: "number" })
const pieces = (f: Pick<Field, "type" | "min" | "max">, cuts: readonly number[]): Piece[] => {
  const int = f.type === "int"
  const lo = f.min ?? -Infinity
  const hi = f.max ?? Infinity
  const pts = [...new Set([lo, hi, ...cuts].flatMap((x) => (int ? [Math.floor(x), Math.ceil(x)] : [x])))]
    .filter((x) => Number.isFinite(x) && x >= lo && x <= hi)
    .sort((a, b) => a - b)
  if (!pts.length) return [{ lo, hi, closed: false, at: 0 }]
  const out: Piece[] = []
  const gap = (a: number, b: number) => {
    const at = !Number.isFinite(a) ? b - 1 : !Number.isFinite(b) ? a + 1 : int ? a + 1 : (a + b) / 2
    if (!int || at < b) out.push({ lo: a, hi: b, closed: false, at })
  }
  if (lo === -Infinity) gap(lo, pts[0]!)
  pts.forEach((x, i) => {
    if (i) gap(pts[i - 1]!, x)
    out.push({ lo: x, hi: x, closed: true, at: x })
  })
  if (hi === Infinity) gap(pts.at(-1)!, hi)
  return out
}
const show = (x: number) => (x === Infinity ? "∞" : x === -Infinity ? "-∞" : String(x))
/** A run of pieces as an interval: `9..12` for an int field, `[0.5, 1)` for a number. */
const span = (int: boolean, run: readonly Piece[]) => {
  const a = run[0]!
  const b = run.at(-1)!
  if (int) {
    const lo = a.closed || !Number.isFinite(a.lo) ? a.lo : a.lo + 1
    const hi = b.closed || !Number.isFinite(b.hi) ? b.hi : b.hi - 1
    return lo === hi ? show(lo) : `${show(lo)}..${show(hi)}`
  }
  return `${a.closed ? "[" : "("}${show(a.lo)}, ${show(b.hi)}${b.closed ? "]" : ")"}`
}
const setIn = (s: Record<string, unknown>, path: string, v: unknown) => {
  const ks = path.split(".")
  let o = s
  for (const k of ks.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>
  o[ks.at(-1)!] = v
  return s
}
const safely = (c: Cond, s: Record<string, unknown>, events: readonly string[] = []) => {
  try {
    return holds(c, s, events)
  } catch {
    return false // a type mismatch (lt on a boolean) holds nowhere
  }
}
/** Whether some state inside the fields' bounds, and some set of this turn's events, satisfies `c`. Exhaustive over the
 *  pieces of each field it reads. ponytail: a cartesian product, fine for the handful of fields one Cond reads. */
const satisfiable = (c: Cond, fields: ReadonlyMap<string, Field>): boolean => {
  const ls = leaves(c)
  const values = (path: string): unknown[] => {
    const f = fieldOf(fields, path)
    if (f.type === "boolean") return [true, false]
    if (f.type === "enum") return [...(f.options ?? [])]
    const own = ls.filter((l): l is Extract<Cond, { path: string }> => "path" in l && l.path === path)
    const cuts = own.flatMap((l) => ("value" in l ? [l.value] : typeof l.is === "number" ? [l.is] : []))
    return [
      ...pieces(f, cuts).map((p) => p.at),
      ...own.flatMap((l) => ("is" in l && typeof l.is !== "number" ? [l.is] : [])),
    ]
  }
  const paths = [...new Set(reads(c))]
  const evs = [...new Set(eventsOf(c))]
  const states = paths.reduce<Record<string, unknown>[]>(
    (acc, p) => acc.flatMap((s) => values(p).map((v) => setIn(structuredClone(s), p, v))),
    [{}],
  )
  const subsets = evs.reduce<string[][]>((acc, e) => acc.flatMap((x) => [x, [...x, e]]), [[]])
  return states.some((s) => subsets.some((es) => safely(c, s, es)))
}
const NEVER = (c: Cond) => "any" in c && c.any.length === 0 // `{ any: [] }`: the card's way of saying "not in play"

// ───────── prose: the lexicon matcher (polish.ts) over the card's own text ─────────
const texts = (card: Card): [string, string][] => [
  ...card.frame.flatMap((f): [string, string][] => (f.text ? [[`frame.${f.id}.text`, f.text]] : [])),
  ...card.fiction.flatMap((f): [string, string][] => (f.text ? [[`fiction.${f.id}.text`, f.text]] : [])),
  ...card.lore.flatMap((e) => e.layers.map((t, i): [string, string] => [`lore.${e.id}.layers[${i}]`, t])),
  ...card.greetings.map((g, i): [string, string] => [`greetings[${i}].text`, g.text]),
]
const prose = (card: Card, rule: string, lexicon: readonly Entry[], message: string, hint: string): Diagnostic[] =>
  texts(card).flatMap(([path, t]) =>
    scan(t, lexicon, 0).map((x) => ({
      rule,
      level: "error" as const,
      path,
      message: `${message}: 「${t.slice(x.start, x.end)}」 (${x.hits.join("、")})`,
      hint: x.hints[0] ?? hint,
    })),
  )
const DIGITS = "0123456789".split("")
const COMPARE = ["大于", "小于", "高于", "低于", "超过", "不足", "达到", "不到", ">=", "<=", "≥", "≤", ">", "<"]
const STATUS = "state is a field the client draws, a record or table product, or the card's `heading`"
const MENU = "options are the `options` product, asked in record after the prose"
const TAIL = "what comes after the prose each turn is a product (record stage), never an ask in the text"
const INLINE: Entry[] = [
  { pattern: "状态栏", hint: STATUS },
  { pattern: "状态面板", hint: STATUS },
  { pattern: "status bar", hint: STATUS },
  { pattern: "选项*菜单", hint: MENU },
  { pattern: "列出*选项", hint: MENU },
  { pattern: "给出*选项", hint: MENU },
  { pattern: "提供*选项", hint: MENU },
  { pattern: "回复*末尾", hint: TAIL },
  { pattern: "回复*结尾", hint: TAIL },
  { pattern: "每轮*末尾", hint: TAIL },
  { pattern: "end of each reply", hint: TAIL },
  { pattern: "end of every reply", hint: TAIL },
  { pattern: "end of each response", hint: TAIL },
]

// ───────── the rules ─────────
const HOOK = 40 // ponytail: characters; a hook is the player's own words for the thing, one short sentence

const rules: Rule[] = [
  // A path no field declares throws only when evaluation reaches it (holds, apply), and decode never sees it.
  (card) => {
    const known = new Set([
      ...card.rules.fields.map((f) => f.path),
      ...card.lore.flatMap((e) => [`lore.${e.id}.since`, `lore.${e.id}.shown`]),
    ])
    const used: [string, string][] = [
      ...conds(card).flatMap(([p, c]) => reads(c).map((r): [string, string] => [p, r])),
      ...effects(card).flatMap(([p, e]): [string, string][] => [
        ...("path" in e ? [[p, e.path] as [string, string]] : []),
        ...("add" in e && typeof e.add === "object" ? [[p, e.add.path] as [string, string]] : []),
      ]),
      ...card.rules.actions.flatMap((a): [string, string][] =>
        a.roll && typeof a.roll === "object" && "path" in a.roll ? [[`rules.actions.${a.id}.roll`, a.roll.path]] : [],
      ),
    ]
    // heading may also name `<product>.<key>`, a key of one of the card's record products
    const heading = card.heading?.split(".")[0]
    if (card.heading && !(card.products ?? []).some((p) => p.id === heading)) used.push(["heading", card.heading])
    return used
      .filter(([, r]) => !known.has(r))
      .map(([path, r]) => ({
        rule: "unknown-path",
        level: "error" as const,
        path,
        message: `${r} is not a declared field (nor lore.<id>.since / .shown)`,
        hint: "declare it in rules.fields, or fix the spelling",
      }))
  },
  // A lore offer, a fiction band or an unlock that reads an event nothing emits never holds (b52f7db deleted such an
  // action by hand). The reverse is a warn: the event still reaches the narrator and the ledger, nothing else reads it.
  (card) => {
    const emitted = effects(card).flatMap(([p, e]): [string, string][] => ("event" in e ? [[p, e.event]] : []))
    const listened = conds(card).flatMap(([p, c]) => eventsOf(c).map((name): [string, string] => [p, name]))
    return [
      ...listened
        .filter(([, name]) => !emitted.some(([, t]) => emits(t, name)))
        .map(([path, name]) => ({
          rule: "orphan-event",
          level: "error" as const,
          path,
          message: `reads event "${name}", which no action, readout option or greeting emits`,
          hint: "emit it from an effect, or read an event that is emitted",
        })),
      ...emitted
        .filter(([, t]) => !listened.some(([, name]) => emits(t, name)))
        .map(([path, t]) => ({
          rule: "orphan-event",
          level: "warn" as const,
          path,
          message: `emits event "${t}", which no condition reads`,
          hint: "read it in a lore offer or a fiction `when`, or drop it if the ledger line is not needed",
        })),
    ]
  },
  // A field nothing writes in play never moves; a hidden field nothing reads is an ending switch wired to nothing.
  (card) => {
    const moved = new Set([...written(card, "rules.actions."), ...written(card, "rules.readouts.")])
    const read = new Set([
      ...conds(card).flatMap(([, c]) => reads(c)),
      ...(card.heading ? [card.heading] : []),
      ...card.rules.actions.flatMap((a) =>
        a.roll && typeof a.roll === "object" && "path" in a.roll ? [a.roll.path] : [],
      ),
      ...effects(card).flatMap(([, e]) => ("add" in e && typeof e.add === "object" ? [e.add.path] : [])),
    ])
    return card.rules.fields.flatMap((f) => [
      ...(moved.has(f.path)
        ? []
        : [
            {
              rule: "dead-field",
              level: "warn" as const,
              path: `rules.fields.${f.path}`,
              message: `no action or readout writes ${f.path}: it never moves in play`,
              hint: "write it from an action or a readout option, or drop the field",
            },
          ]),
      ...(f.hidden && !read.has(f.path)
        ? [
            {
              rule: "dead-field",
              level: "warn" as const,
              path: `rules.fields.${f.path}`,
              message: `${f.path} is hidden and nothing reads it (no when, unlock, offer or heading)`,
              hint: "read it in a condition, or drop the field",
            },
          ]
        : []),
    ])
  },
  // Who writes a field decides what the prose may do to it. The narrator sees bands, never numbers, so a field only
  // actions write is a mechanical quantity the prose cannot move ("the innkeeper hands you three coins" leaves gold
  // where it was); a field the fiction may move needs a readout. A warn, not enforced: the author decides. A card with
  // no readouts at all has chosen mechanical everywhere (the self-test RPG), so nothing is said there.
  (card) => {
    const byActions = written(card, "rules.actions.")
    const byReadouts = written(card, "rules.readouts.")
    return byReadouts.size
      ? [...byActions]
          .filter((p) => !byReadouts.has(p))
          .map((p) => ({
            rule: "prose-cannot-move",
            level: "warn" as const,
            path: `rules.fields.${p}`,
            message: `${p}: written by actions only; the prose cannot move it.`,
            hint: "Add a readout, or keep it mechanical.",
          }))
      : []
  },
  // Fiction variants on one numeric field are read as alternatives: exactly one should hold everywhere in min..max.
  (card) => {
    const fields = new Map(card.rules.fields.map((f) => [f.path, f]))
    return card.rules.fields
      .filter((f) => f.type === "int" || f.type === "number")
      .flatMap((f) => {
        const bands = card.fiction.filter(
          (x) => x.when && !eventsOf(x.when).length && reads(x.when).length && reads(x.when).every((p) => p === f.path),
        )
        if (bands.length < 2) return [] // one conditional fragment is an addition, not a set of alternatives
        const cuts = bands.flatMap((x) =>
          leaves(x.when!).flatMap((l) =>
            "value" in l ? [l.value] : "is" in l && typeof l.is === "number" ? [l.is] : [],
          ),
        )
        const ps = pieces(fieldOf(fields, f.path), cuts).map((p) => ({
          p,
          on: bands.filter((x) => safely(x.when!, setIn({}, f.path, p.at))).map((x) => x.id),
        }))
        const out: Diagnostic[] = []
        for (let i = 0; i < ps.length;) {
          const kind = ps[i]!.on.length === 0 ? "gap" : ps[i]!.on.length > 1 ? "overlap" : undefined
          let j = i + 1
          while (
            j < ps.length &&
            (ps[j]!.on.length === 0 ? "gap" : ps[j]!.on.length > 1 ? "overlap" : undefined) === kind
          )
            j++
          if (kind) {
            const run = ps.slice(i, j)
            const where = span(
              f.type === "int",
              run.map((x) => x.p),
            )
            const ids = [...new Set(run.flatMap((x) => x.on))]
            out.push({
              rule: "band-gap",
              level: "warn",
              path: `rules.fields.${f.path}`,
              message:
                kind === "gap"
                  ? `no fiction variant on ${f.path} holds at ${where} (variants: ${bands.map((x) => x.id).join(", ")})`
                  : `fiction variants ${ids.join(", ")} all hold at ${where}`,
              hint: "make the variants' `when` meet edge to edge (lt 8 / gte 8)",
            })
          }
          i = j
        }
        return out
      })
  },
  // A layer no state reaches: an unlock no state inside the bounds satisfies (with the layers before it, since the floor
  // is the leading layers that hold at one state), or layers past every unlock behind an offer that never holds.
  (card) => {
    const fields = new Map(card.rules.fields.map((f) => [f.path, f]))
    return card.lore.flatMap((e): Diagnostic[] => {
      const cs = unlocks(e)
      if (cs[0] && NEVER(cs[0])) return [] // deliberately out of play
      let floor = 0
      while (floor < cs.length && satisfiable({ all: cs.slice(0, floor + 1) }, fields)) floor++
      const out: Diagnostic[] = []
      if (floor < cs.length)
        out.push({
          rule: "unreachable-layer",
          level: "warn",
          path: unlockPath(e, floor),
          message:
            floor === 0
              ? `no state within the fields' bounds satisfies layer 1's unlock: ${e.id} is never in play`
              : `no state within the fields' bounds satisfies layer ${floor + 1}'s unlock together with the layers before it`,
          hint: floor === 0 ? "write `{ any: [] }` if that is meant" : "move the threshold inside the field's min..max",
        })
      if (floor > 0 && e.layers.length > floor && !satisfiable(e.offer, fields))
        out.push({
          rule: "unreachable-layer",
          level: "warn",
          path: `lore.${e.id}.layers[${floor}]`,
          message: `layers ${floor + 1}..${e.layers.length} lie past every reachable unlock and the offer never holds`,
          hint: "add an unlock per layer, or an offer that can open",
        })
      return out
    })
  },
  // The lookup index shows each entry by its hook, the first sentence of layers[0] (lore.ts `hook`).
  (card) =>
    card.lore.flatMap((e) => {
      const h = e.layers[0] === undefined ? "" : hook(e.layers[0])
      const n = h.length
      return n > HOOK
        ? [
            {
              rule: "hook-length",
              level: "warn" as const,
              path: `lore.${e.id}.layers[0]`,
              message: `the hook is ${n} characters (ceiling ${HOOK}): 「${h}」`,
              hint: "end the first sentence sooner: the index shows only it",
            },
          ]
        : []
    }),
  // The narrator never sees a number: a field next to a digit or a comparison in the text is a band written as prose.
  (card) =>
    prose(
      card,
      "field-in-prose",
      card.rules.fields.flatMap((f) => [
        ...[...DIGITS, ...COMPARE].map((w) => ({ pattern: `${f.path}*${w}` })),
        ...DIGITS.map((d) => ({ pattern: `${d}*${f.path}` })),
      ]),
      "a field next to a number or a comparison",
      "the narrator never sees numbers: put the text in a fiction variant with `when`, or in a readout",
    ),
  // Output formats asked in the text are products and `heading`.
  (card) => prose(card, "inline-product", INLINE, "asks for an output format in the text", TAIL),
]

export const lint = (card: Card): Diagnostic[] => rules.flatMap((r) => r(card))
