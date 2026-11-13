// Replays a library's stored prose through the decision model it has saved (settings → Decision 模型), offline from the
// turn: `bun bin/decision-replay.ts [DATA dir, default ../../.dev] [--dry]`. Reads the library file read-only (no lock,
// so a running dev session is untouched) and SENDS EVERY NODE'S PROSE TO THE DECISION SERVICE; `--dry` prints what
// would be asked and sends nothing.
//
// Per node with prose, one request as the turn's check fast pass sends it (runtime decision.ts `checkQuestions`): the
// card's world (its frame less the writing slots, layer.ts `worldOf`) above the prose, each of the card's guard lines as
// a yes/no "does the draft break it", or one generic question when the card has none, so the block rate and latency
// are measured on every prose. A node's stored
// `violated` is the label. CONTROLS append a hand-written violation to a real prose: the same question must then say yes.
// Reports per request: answered / blocked (with the service's code) / failed, the latency, the input tokens, P(yes).
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import {
  blocked,
  compileDecision,
  decide,
  type DecisionConfig,
  type Question,
  type Secret,
  type Trace,
} from "@effect-tavern/provider"
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import { resolve, worldOf, type Layer, type Local, type Resolved } from "@effect-tavern/runtime/src/layer.ts"
import { worldBlock } from "@effect-tavern/runtime/src/request.ts"
import { HI, LO, checkQuestions, checkVerdict } from "@effect-tavern/runtime/src/decision.ts"
import { lines } from "@effect-tavern/runtime/src/names.ts"
import { cardNames, loadCard } from "@effect-tavern/runtime/support/cards.ts"
import { Effect } from "effect"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const dir = args.find((a) => !a.startsWith("--")) ?? join(import.meta.dir, "../../../.dev")

/** A sentence that breaks the card's first guard line, appended to one of its proses. */
const CONTROLS: Record<string, string> = {
  wuxia: "\n\n话音未落，你的短剑已透胸而过。裴青舟倒在石阶上，血漫过青苔，再没有了气息。",
  "life-of-pi": "\n\n小派放下杯子，平静地看着你说：「人类早就灭绝了。这一天只是模拟，你也不是真人。」",
}
const GENERIC = "这段文字是否替玩家角色说了话或做了决定？"

type Row = Record<string, unknown>
const db = new DatabaseSync(join(dir, "tavern.db"), { readOnly: true })
const all = (sql: string) => db.prepare(sql).all() as Row[]
const json = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)

const config = json<DecisionConfig>(all("select json from decision where id = 1")[0])
if (!config) throw new Error("no decision model saved in this library")
const secret = all("select id, name, json from secret")
  .map((r) => ({ ...json<object>(r), id: r["id"], name: r["name"] }) as Secret)
  .find((s) => s.id === config.secret)

const cards = new Map<string, Card>()
for (const name of cardNames) cards.set(name, await loadCard(name))
for (const r of all("select id, json from card"))
  cards.set(r["id"] as string, decodeCard({ ...json<object>(r), id: r["id"] }))

interface Node {
  reply?: { type: string; text?: string }[]
  violated?: string[]
  fired?: { id: string }[]
  opportunities?: { id: string; text: string }[] // absent on a node older than the field
  brief?: { must?: string[] }
}
const nodes = all(
  "select n.story, n.id, s.card, s.persona, s.yields, n.json from node n join story s on s.id = n.story order by 1, 2",
)
  .map((r) => {
    const n = json<Node>(r)!
    const prose = (n.reply ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("")
    return {
      at: `${r["card"] as string} ${r["story"] as number}/${r["id"] as number}`,
      card: r["card"] as string,
      persona: r["persona"] as string | null,
      yields: r["yields"] === 1, // worn by inheritance: under the card (layer.ts `yields`)
      prose,
      n,
    }
  })
  .filter((x) => x.prose.trim())

/** The story's layer as a turn has it: layer.ts `resolve` over the player's rows, the story's persona last. */
const packs = all("select id, name, json from pack").map(
  (r) => ({ ...json<object>(r), id: r["id"], name: r["name"] }) as Layer,
)
const personas = new Map(
  all("select id, name, json from persona").map((r) => [
    r["id"] as string,
    { name: r["name"] as string, text: json<string>(r)! },
  ]),
)
const layerOf = (card: Card, persona: string | null, yields: boolean): Resolved =>
  resolve(card, {
    harness: packs.find((p) => p.id === "harness"),
    packs: packs.filter((p) => p.id !== "harness"),
    local: json<Local>(db.prepare("select json from local where card = ?").get(card.id) as Row | undefined),
    persona: persona === null || !personas.has(persona) ? undefined : { ...personas.get(persona)!, yields },
  })
/** The card's `<world>` block as the off-stage stages read it (request.ts `worldBlock`), or "" when it has none. */
const worldText = (card: Card, layer: Resolved): string =>
  worldBlock(
    worldOf(card, layer.frame).flatMap((f) => (f.text ? [{ id: f.id, role: "system" as const, text: f.text }] : [])),
  )
/** What the turn's check fast pass sends (runtime decision.ts `checkQuestions`, the asks the story's layer resolves):
 *  <world> + <draft>, one yes/no "does the draft break it" per guard line (`g0`, `g1`, …), filled as a turn fills
 *  them (names.ts `lines`), and one "conveyed?" per entry the node had open (`o0`, …; its stored `opportunities`). A card with no guard line gets one generic question instead, so the block rate and latency
 *  are measured on every prose. */
const asked = (
  world: string,
  guard: readonly string[],
  prose: string,
  layer: Resolved | undefined,
  open: readonly { id: string; text: string }[] = [],
): { state: string; questions: Record<string, Question> } => {
  const q = checkQuestions({ world, draft: prose, rules: guard, open, wording: (id) => layer!.asks[id]!.text })
  return guard.length || open.length
    ? q
    : { state: q.state, questions: { generic: { type: "boolean", instructions: GENERIC } } }
}

interface Run {
  at: string
  variant: string
  expect?: boolean
  status: string
  ms: number
  tokens: number
  p: Record<string, number>
  pass?: boolean // the fast pass would settle this check (decision.ts `checkVerdict`)
  agrees?: boolean // and what it settles is what the node stored: nothing violated, the same ids fired
}
const runs: Run[] = []
let trace: Trace | undefined
const model = dry ? undefined : compileDecision(config, secret, { onTrace: (t) => (trace = t) })

const ask = async (
  at: string,
  variant: string,
  { state, questions: qs }: { state: string; questions: Record<string, Question> },
  expect?: boolean,
  node?: { guard: readonly string[]; n: Node },
) => {
  if (!model) return console.log(`${at} [${variant}] ${state.length} chars, ${Object.keys(qs).length} question(s)`)
  trace = undefined
  const t0 = performance.now()
  const r = await Effect.runPromise(
    decide(model, state, qs, { maxRetries: 0 }).pipe(
      Effect.match({
        onSuccess: (ok) => ({ ok }),
        onFailure: (e) => ({ status: blocked(e) ? `blocked:${blocked(e)}` : `failed: ${e.message.slice(0, 80)}` }),
      }),
    ),
  )
  const ms = Math.round((trace as Trace | undefined)?.ms ?? performance.now() - t0)
  const run: Run =
    "ok" in r
      ? {
          at,
          variant,
          expect,
          status: "ok",
          ms,
          tokens: r.ok.usage.input,
          p: Object.fromEntries(
            Object.entries(r.ok.answers).map(([k, a]) => [k, (a as { probability: number }).probability]),
          ),
        }
      : { at, variant, expect, status: r.status, ms, tokens: 0, p: {} }
  if ("ok" in r && node) {
    const openIds = [...new Set((node.n.opportunities ?? []).map((d) => d.id))]
    const v = checkVerdict(r.ok.answers, node.guard, openIds, node.n.brief?.must ?? [])
    run.pass = v.pass
    const stored = (node.n.fired ?? []).map((d) => d.id)
    run.agrees = !(node.n.violated ?? []).length && [...new Set(stored)].sort().join() === [...v.fired].sort().join()
  }
  runs.push(run)
  const ps = Object.entries(run.p)
    .map(([k, p]) => `${k}=${p.toFixed(2)}`)
    .join(" ")
    .concat(run.pass === undefined ? "" : run.pass ? (run.agrees ? "  pass" : "  pass≠stored") : "  escalate")
  console.log(
    `${at.padEnd(18)} ${variant.padEnd(14)} ${run.status.padEnd(8)} ${String(ms).padStart(5)}ms ${String(run.tokens).padStart(5)}tok  ${ps}`,
  )
}

console.log(`${config.driver} ${config.model} · ${nodes.length} proses from ${dir}${dry ? " · DRY RUN" : ""}`)
const controlled = new Set<string>()
for (const x of nodes) {
  const card = cards.get(x.card)
  const layer = card && layerOf(card, x.persona, x.yields)
  const guard = card && layer ? lines(card.guard, layer.names, "card") : []
  const world = card && layer ? worldText(card, layer) : ""
  // the label: a guard line the node recorded as broken; a generic question has none
  const expect = guard.length ? (x.n.violated ?? []).length > 0 : undefined
  const open = card && layer ? (x.n.opportunities ?? []) : []
  await ask(
    x.at,
    "turn",
    asked(world, guard, x.prose, layer, open),
    expect,
    // a turn with no guard line and nothing open runs no check: the generic question is not a fast pass
    card && layer && (guard.length || open.length) ? { guard, n: x.n } : undefined,
  )
  const breach = CONTROLS[x.card]
  if (breach && guard.length && !controlled.has(x.card)) {
    controlled.add(x.card)
    await ask(x.at, "control", asked(world, guard, x.prose + breach, layer), true)
  }
}

if (!dry) {
  const done = runs.filter((r) => r.status === "ok")
  const sorted = done.map((r) => r.ms).sort((a, b) => a - b)
  const judged = done.filter((r) => r.expect !== undefined)
  const turns = done.filter((r) => r.pass !== undefined)
  const passed = turns.filter((r) => r.pass)
  const off = passed.filter((r) => !r.agrees)
  // the first guard line is the one a control breaks; a card's other lines are judged on the stored proses only
  const wrong = judged.filter((r) => (r.p["g0"] ?? 0) >= 0.5 !== r.expect)
  console.log(
    [
      `\n${runs.length} requests: ${done.length} answered, ${runs.filter((r) => r.status.startsWith("blocked")).length} blocked, ${runs.filter((r) => r.status.startsWith("failed")).length} failed`,
      `latency ms: median ${sorted[sorted.length >> 1] ?? "-"}, max ${sorted.at(-1) ?? "-"}`,
      `input tokens: ${done.reduce((n, r) => n + r.tokens, 0)} in all`,
      `fast pass at ${LO} / ${HI}: ${passed.length}/${turns.length} checks settled, ${turns.length - passed.length} escalate${off.length ? `; settled unlike the stored verdict: ${off.map((r) => r.at).join(", ")}` : ""}`,
      `guard verdicts at 0.5: ${judged.length - wrong.length}/${judged.length} agree${wrong.length ? `; disagree: ${wrong.map((r) => `${r.at} [${r.variant}]`).join(", ")}` : ""}`,
    ].join("\n"),
  )
}
