// Card lint (issue #27): what a card author's type checker says about a card. Pure: a card in, facts and fixes out; no
// I/O, no console. The throws in `makeCard` / `resolve` stay decode-time invariants; lint reports what decodes but is
// wired wrong (topology: events, fields, bands, layers) or written where code should do the work (prose: numbers and
// output formats in the text). Rules are the list at the bottom; there is no plugin system and no config.
import { unlocks, unlockPath, whenPaths } from "./paths.ts"
import type { Card, Effect_, Field } from "./card.ts"
import { type Cond, holds, reads, STATE_HOLE } from "./cond.ts"
import { SLOTS } from "./fragment.ts"
import { hook } from "./lore.ts"
import { harness } from "./layer.ts"
import { colsAt } from "./product.ts"
import { HOLE, unfilled } from "./names.ts"
import { type Entry, scan } from "./polish.ts"

export const identifier = /^[\p{L}\p{N}_:.\-{}]+$/u

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
/** Every Cond over state in the card, with its place. Product table filters read rows, not state, and are left out. */
const conds = (card: Card): [string, Cond][] => [
  ...(card.passages ?? []).map((p, i): [string, Cond] => [`passages[${i}].when`, p.when]),
  ...whenPaths("frame", card.frame),
  ...whenPaths("fiction", card.fiction),
  ...whenPaths("rules.actions", card.rules.actions),
  ...whenPaths("rules.readouts", card.rules.readouts ?? []),
  ...(card.rules.over ? [["rules.over", card.rules.over] as [string, Cond]] : []),
  ...card.lore.flatMap((e): [string, Cond][] => [
    ...unlocks(e).map((c, i): [string, Cond] => [unlockPath(e, i), c]),
    [`lore.${e.id}.offer`, e.offer],
  ]),
  ...whenPaths("products", card.products ?? []),
  ...(card.catalogs ?? []).flatMap((c) =>
    c.items.flatMap((i): [string, Cond][] => (i.when ? [[`catalogs.${c.id}.items.${i.id}.when`, i.when]] : [])),
  ),
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
    ...(card.passages ?? []).flatMap((g, i) => at(`passages[${i}].do`, g.do)),
  ]
}
const written = (card: Card, by: "rules.actions." | "rules.readouts." | "greetings[" | "passages[") =>
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
  fields.get(path.replace(/^fields\./, "")) ?? (counter.test(path) ? { type: "int", min: 0 } : { type: "number" })
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
/** An entry's text: its layers, then its sections. */
const loreTexts = (card: Card): [string, string][] =>
  card.lore.flatMap((e) => [
    ...e.layers.map((t, i): [string, string] => [`lore.${e.id}.layers[${i}]`, t]),
    ...(e.sections ?? []).map((x): [string, string] => [`lore.${e.id}.sections.${x.id}`, x.text]),
  ])
const openings = (card: Card) => [
  ...card.greetings.map((g, i) => ({ ...g, path: `greetings[${i}]` })),
  ...(card.passages ?? []).map((g, i) => ({ ...g, path: `passages[${i}]` })),
]
const texts = (card: Card): [string, string][] => [
  ...card.frame.flatMap((f): [string, string][] => (f.text ? [[`frame.${f.id}.text`, f.text]] : [])),
  ...card.fiction.flatMap((f): [string, string][] => (f.text ? [[`fiction.${f.id}.text`, f.text]] : [])),
  ...loreTexts(card),
  ...openings(card).flatMap((g): [string, string][] => [
    ...(g.text ? [[`${g.path}.text`, g.text] as [string, string]] : []),
    ...(g.note ? [[`${g.path}.note`, g.note] as [string, string]] : []),
  ]),
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

/** The card's text a hole can sit in: the prose, its asks, its products' questions, its guard lines, its readouts. */
const named = (card: Card): [string, string][] => [
  ...texts(card),
  ...(card.asks ?? []).flatMap((f): [string, string][] => (f.text ? [[`asks.${f.id}.text`, f.text]] : [])),
  ...(card.products ?? []).flatMap((p): [string, string][] => (p.text ? [[`products.${p.id}.text`, p.text]] : [])),
  ...card.guard.map((g, i): [string, string] => [`guard[${i}]`, g]),
  ...(card.rules.readouts ?? []).flatMap((q): [string, string][] => [
    [`rules.readouts.${q.id}.text`, q.text],
    ...q.options.map((o): [string, string] => [`rules.readouts.${q.id}.options.${o.id}.text`, o.text]),
  ]),
]

// ───────── the rules ─────────
const HOOK = 40 // ponytail: characters; a hook is the player's own words for the thing, one short sentence

const rules: Rule[] = [
  (card) => {
    const out: Diagnostic[] = []
    const visit = (v: unknown, path: string, key = "") => {
      if (typeof v === "string" && ["id", "path", "event", "options", "key"].includes(key) && !identifier.test(v))
        out.push({
          rule: "bad-identifier",
          level: "warn",
          path,
          message: "identifier must be a token without whitespace",
        })
      if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, key))
      else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => visit(x, path ? `${path}.${k}` : k, k))
    }
    visit(card, "")
    return out
  },
  (card) => {
    const texts: [string, string | undefined][] = [
      ...card.frame.map((f): [string, string | undefined] => [`frame.${f.id}.text`, f.text]),
      ...card.fiction.map((f): [string, string] => [`fiction.${f.id}.text`, f.text ?? ""]),
      ...(card.asks ?? []).map((f): [string, string | undefined] => [`asks.${f.id}.text`, f.text]),
      ...openings(card).flatMap((g): [string, string | undefined][] => [
        [`${g.path}.text`, g.text],
        [`${g.path}.note`, g.note],
      ]),
      ...card.guard.map((t, i): [string, string] => [`guard[${i}]`, t]),
      ...loreTexts(card),
      ...card.rules.actions.flatMap((a): [string, string][] => [
        [`rules.actions.${a.id}.text`, a.text],
        ...(a.roll && typeof a.roll === "object" && "judge" in a.roll
          ? [[`rules.actions.${a.id}.roll.judge`, a.roll.judge] as [string, string]]
          : []),
      ]),
      ...(card.rules.readouts ?? []).flatMap((q): [string, string][] => [
        [`rules.readouts.${q.id}.text`, q.text],
        ...q.options.map((o): [string, string] => [`rules.readouts.${q.id}.options.${o.id}.text`, o.text]),
      ]),
      ...(card.products ?? []).map((p): [string, string | undefined] => [`products.${p.id}.text`, p.text]),
    ]
    return texts
      .filter(([, t]) => t !== undefined && !t.trim())
      .map(([path]) => ({
        rule: "empty-text",
        level: "error",
        path,
        message: "author text is empty",
        hint: "The author writes this slot; the workshop never fills it.",
      }))
  },
  // a greeting is shown text, a note the narrator opens from, or both: with neither there is no node 0
  (card) =>
    openings(card).flatMap((g): Diagnostic[] =>
      !g.text?.trim() && !g.note?.trim() // session.ts `begin` reads them the same way
        ? [
            {
              rule: "empty-greeting",
              level: "error",
              path: g.path,
              message: "greeting has neither text nor note",
              hint: "Write the opening prose as `text`, or direct the narrator's opening with `note`.",
            },
          ]
        : [],
    ),
  (card) => {
    const products = [
      ...new Map(
        [...(harness(card.input ?? "act").products ?? []), ...(card.products ?? [])].map((p) => [p.id, p]),
      ).values(),
    ]
    return (card.passages ?? []).flatMap((p, i) =>
      (p.digest ?? []).flatMap((id, j): Diagnostic[] =>
        products.some((q) => q.id === id && (q.stage ?? "record") === "record")
          ? []
          : [
              {
                rule: "unknown-product",
                level: "error",
                path: `passages[${i}].digest[${j}]`,
                message: `${id}: digest requires a visible record product`,
              },
            ],
      ),
    )
  },
  // `lore` is the gate's derived counters, not a card field.
  (card) =>
    card.rules.fields
      .filter((f) => /^(fields|world|lore)(\.|$)/.test(f.path))
      .map((f) => ({
        rule: "reserved-path",
        level: "error" as const,
        path: `rules.fields.${f.path}`,
        message: `${f.path} is a reserved state namespace`,
      })),
  // The frame is the head of every stage's document, the structured ones included, and its ids are the slots the
  // player's layer meets it on (fragment.ts SLOTS). A frame fragment under any other id is most often a person or a
  // world put where every stage reads it: ri's npc sat in the frame, and the director wrote the old priest's reaction
  // in place of the heroine's (#83). A warn, since the mechanism merges any id and a card may open a slot on purpose.
  (card) =>
    card.frame
      .filter((f) => !SLOTS.includes(f.id))
      .map((f) => ({
        rule: "unknown-frame-slot",
        level: "warn" as const,
        path: `frame.${f.id}`,
        message: `${f.id} is not a frame slot (${SLOTS.join(", ")}); every stage reads it as part of the frame`,
        hint: "a person, a cast or a world goes in fiction; keep it in the frame only as a slot the player may fill",
      })),
  // A hole with no default: the entry stays out of the request, and an opening refuses, until a pack or the player names
  // it. A warn, since leaving one to the player may be the card's design. `user` always has a value.
  (card) =>
    named(card).flatMap(([path, t]) =>
      unfilled(t, { user: "", ...card.names }).map((k) => ({
        rule: "unfilled-name",
        level: "warn" as const,
        path,
        message: `{{${k}}} has no default in the card's names`,
        hint: "give it in `names`; a pack or the player can still override it",
      })),
    ),
  // The ecosystem's scripted macros are not holes: nothing expands them, so the model would read them as written.
  (card) =>
    named(card).flatMap(([path, t]) =>
      Array.from(
        t
          .replace(HOLE, "")
          .replace(STATE_HOLE, "")
          .matchAll(/\{\{.*?\}\}/gs),
        ([m]) => ({
          rule: "unsupported-macro",
          level: "error" as const,
          path,
          message: `${m} is not a name: only a plain {{key}} is filled`,
          hint: "write the text out; state and randomness are fields, actions and products",
        }),
      ),
    ),
  // A path no field declares throws only when evaluation reaches it (holds, apply), and decode never sees it.
  (card) => {
    const known = new Set([
      ...card.rules.fields.flatMap((f) => [f.path, `fields.${f.path}`]),
      ...card.lore.flatMap((e) => [`lore.${e.id}.since`, `lore.${e.id}.shown`, `lore.${e.id}.floor`]),
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
    const heading = card.heading?.replace(/^world\./, "").split(".")[0]
    if (card.heading && !(card.products ?? []).some((p) => p.id === heading)) used.push(["heading", card.heading])
    return used
      .filter(([path, r]) => {
        if (known.has(r)) return false
        const read = conds(card).some(([p]) => p === path)
        return !(
          read &&
          r.startsWith("world.") &&
          (card.products ?? []).some((p) => p.role === "world" && p.id === r.split(".")[1])
        )
      })
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
  // A field nothing writes in play never moves, unless a story's opening sets it (`start` or a greeting's `do`): that is
  // an opening switch. A hidden field or an opening switch nothing reads is a switch wired to nothing.
  (card) => {
    const moved = new Set([
      ...written(card, "rules.actions."),
      ...written(card, "rules.readouts."),
      ...written(card, "passages["),
    ])
    const opening = new Set([
      ...card.rules.fields.flatMap((f) => (f.start ? [f.path] : [])),
      ...written(card, "greetings["),
    ])
    const read = new Set([
      ...conds(card).flatMap(([, c]) => reads(c)),
      ...(card.heading ? [card.heading] : []),
      ...card.rules.actions.flatMap((a) =>
        a.roll && typeof a.roll === "object" && "path" in a.roll ? [a.roll.path] : [],
      ),
      ...effects(card).flatMap(([, e]) => ("add" in e && typeof e.add === "object" ? [e.add.path] : [])),
    ])
    return card.rules.fields.flatMap((f) => [
      ...(moved.has(f.path) || opening.has(f.path)
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
        : !f.hidden && !moved.has(f.path) && opening.has(f.path) && !read.has(f.path)
          ? [
              {
                rule: "dead-field",
                level: "warn" as const,
                path: `rules.fields.${f.path}`,
                message: `${f.path} is an opening switch and nothing reads it (no when, unlock, offer or heading)`,
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
  // Lookup shows each entry, and each of its sections, by its hook: the first sentence (lore.ts `hook`).
  (card) =>
    card.lore.flatMap((e) =>
      [
        [`lore.${e.id}.layers[0]`, e.layers[0] ?? ""] as const,
        ...(e.sections ?? []).map((x) => [`lore.${e.id}.sections.${x.id}`, x.text] as const),
      ].flatMap(([path, text]) => {
        const h = hook(text)
        return h.length > HOOK
          ? [
              {
                rule: "hook-length",
                level: "warn" as const,
                path,
                message: `the hook is ${h.length} characters (ceiling ${HOOK}): 「${h}」`,
                hint: "end the first sentence sooner: the index shows only it",
              },
            ]
          : []
      }),
    ),
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
  // An enum column's catalog is resolved by id at record time; a name no catalog has fails the settlement.
  (card) =>
    (card.products ?? []).flatMap((p) =>
      (p.shape ? colsAt(p.shape, `products.${p.id}.shape`) : [])
        .filter(([, c]) => c.catalog !== undefined && !card.catalogs?.some((x) => x.id === c.catalog))
        .map(([path, c]) => ({
          rule: "unknown-catalog",
          level: "error" as const,
          path: `${path}.catalog`,
          message: `${c.catalog} is not a catalog of this card`,
          hint: "declare it in catalogs, or fix the spelling",
        })),
    ),
  // A catalog and an item are named by id (a node stores only the item's): two under one id are one.
  (card) => {
    const dupes = (ids: readonly string[]) => [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]
    const cs = card.catalogs ?? []
    return [
      ...dupes(cs.map((c) => c.id)).map((id) => `catalogs.${id}`),
      ...cs.flatMap((c) => dupes(c.items.map((i) => i.id)).map((id) => `catalogs.${c.id}.items.${id}`)),
    ].map((path) => ({
      rule: "duplicate-catalog-item",
      level: "error" as const,
      path,
      message: `${path.split(".").at(-1)} is declared twice`,
      hint: "give each catalog, and each item in one, its own id",
    }))
  },
  // A section is read as `card:<entry>#<section>`: `#` is the joint, so neither id may hold one; ids are unique within
  // their entry, and an entry holds at most 8 (lookup lists them all; more is another entity).
  (card) =>
    card.lore.flatMap((e) => {
      const ids = (e.sections ?? []).map((x) => x.id)
      const bad = (path: string, message: string, hint: string): Diagnostic => ({
        rule: "bad-section",
        level: "error",
        path,
        message,
        hint,
      })
      return [
        ...(e.id.includes("#") ? [bad(`lore.${e.id}`, "an entry id holds no #", "rename the entry")] : []),
        ...ids
          .filter((id, i) => !id || id.includes("#") || ids.indexOf(id) !== i)
          .map((id) =>
            bad(
              `lore.${e.id}.sections.${id}`,
              !id ? "a section id is empty" : id.includes("#") ? "a section id holds no #" : `${id} is declared twice`,
              "give each section of an entry its own id without #",
            ),
          ),
        ...(ids.length > 8
          ? [
              bad(
                `lore.${e.id}.sections`,
                `${ids.length} sections (ceiling 8)`,
                "split the entry: this many is another entity",
              ),
            ]
          : []),
      ]
    }),
  // Output formats asked in the text are products and `heading`.
  (card) => prose(card, "inline-product", INLINE, "asks for an output format in the text", TAIL),
]

export const lint = (card: Card): Diagnostic[] => rules.flatMap((r) => r(card))
