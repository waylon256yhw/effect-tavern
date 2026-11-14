// Lookup as a selection, read through the saved decision model (#168 step 1), offline from the turn:
// `bun bin/decision-lookup.ts [DATA dir, default ../../.dev] [--dry] [--card <yaml>] [--batch <n>]`. Reads the library
// file read-only and SENDS EACH TURN'S INPUT AND THE SCENE BEFORE IT TO THE DECISION SERVICE; `--dry` prints the pools
// and sends nothing.
//
// Per stored turn with an input: the pool a lookup had (session `readable` at the parent, as catalog lines), asked as the
// turn asks a complete catalog (runtime decision.ts `lookupQuestions`: the `lookup.decision` ask, then each unit's
// title), over the scene's tail and the input; `--no-scene` leaves the scene out.
// The label is what the stored lookup delivered from that pool. CASES are hand-written inputs asked at a card's
// newest stored turn, each naming the entries it should need: the library alone holds only turns that read nothing.
// `--card <yaml>` asks a card file's CASES over its pool at the story's start (a large card no story has played);
// `--batch <n>` sends at most n questions per request (default: the whole pool in one, to find the service's limit).
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { blocked, compileDecision, decide, type DecisionConfig, type Secret } from "@effect-tavern/provider"
import { decodeCard, type Card } from "@effect-tavern/runtime/src/card.ts"
import type { Unit } from "@effect-tavern/runtime/src/context.ts"
import { LOOKUP, lookupQuestions } from "@effect-tavern/runtime/src/decision.ts"
import { resolve, type Layer, type Local, type Rows } from "@effect-tavern/runtime/src/layer.ts"
import { makeSession } from "@effect-tavern/runtime/src/session.ts"
import { cardNames, loadCard, plain, readCard } from "@effect-tavern/runtime/support/cards.ts"
import { Effect } from "effect"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const cardFile = flag("--card")
const batch = Number(flag("--batch") ?? Infinity)
const dir =
  args.find((a, i) => !a.startsWith("--") && !["--card", "--batch"].includes(args[i - 1] ?? "")) ??
  join(import.meta.dir, "../../../.dev")

const scened = !args.includes("--no-scene")

/** Hand-written inputs per card, asked at its newest stored turn; `need`: the entries (by id suffix) it should read. */
const CASES: Record<string, { text: string; note?: string; need: string[] }[]> = {
  ri: [
    { text: "理，你最近是不是有什么心事？总看你一个人出神。", need: ["kokuhaku"] },
    { text: "你胸前那枚吊坠，能让我看看吗？", need: ["kokuhaku"] },
    { text: "当然可以了，理理", note: "这糟糕的台词，remind me of 安德烈鲁布廖夫。。。", need: [] },
    { text: "今天天气真好，我们去院子里走走吧。", need: [] },
  ],
  wuxia: [
    { text: "我是来找李鹤的。", need: ["li"] },
    { text: "先给我来碗面，赶了一天的路。", need: [] },
  ],
  nikke: [
    { text: "阿妮斯，你又在偷喝汽水？", need: ["阿妮斯_Anis"] },
    { text: "指挥官走进伊甸园，桃乐丝正等在那里。", need: ["伊甸园", "桃乐丝_Dorothy"] },
    { text: "去找皇冠和灰姑娘谈谈。", need: ["皇冠_Crown", "灰姑娘_Cinderella"] },
    { text: "那位自称国王的妮姬现在在哪？", need: ["皇冠_Crown"] }, // by meaning: the title carries only the name
    { text: "今天先休息吧，我有点累了。", need: [] },
    { text: "继续。", note: "这段写得有点像村上春树。", need: [] },
  ],
}

type Row = Record<string, unknown>
const db = new DatabaseSync(join(dir, "tavern.db"), { readOnly: true })
const all = (sql: string, ...xs: (string | number)[]) => db.prepare(sql).all(...xs) as Row[]
const json = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)

const config = json<DecisionConfig>(all("select json from decision where id = 1")[0])
if (!config) throw new Error("no decision model saved in this library")
const secret = all("select id, name, json from secret")
  .map((r) => ({ ...json<object>(r), id: r["id"], name: r["name"] }) as Secret)
  .find((s) => s.id === config.secret)
const model = dry ? undefined : compileDecision(config, secret)

const cards = new Map<string, Card>()
for (const name of cardNames) cards.set(name, await loadCard(name))
for (const r of all("select id, json from card"))
  cards.set(r["id"] as string, decodeCard({ ...json<object>(r), id: r["id"] }))
const packs = all("select id, name, json from pack").map(
  (r) => ({ ...json<object>(r), id: r["id"], name: r["name"] }) as Layer,
)

interface Node {
  id: number
  parent: number | null
  input?: { text?: string; note?: string }
  reply?: { type: string; text?: string }[]
  deliveries?: { resourceId: string }[]
}
const prose = (n: Node | undefined) => (n?.reply ?? []).map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("")
const idle = () => {
  throw new Error("the replay runs no stage")
}

interface Run {
  at: string
  status: string
  ms: number
  ps: { id: string; p: number; label: boolean }[]
}
const runs: Run[] = []
const ask = async (
  at: string,
  units: readonly Unit[],
  scene: string,
  input: { text?: string; note?: string },
  label: (id: string) => boolean,
  rows: Rows,
  card: Card,
) => {
  const R = resolve(card, rows)
  const q = lookupQuestions({ scene: scened ? scene : "", input, units, wording: (id) => R.asks[id]!.text })
  const pool = q.asked
  const state = q.state
  const questions = Object.entries(q.questions)
  const line = [input.text, input.note && `(${input.note})`].filter(Boolean).join(" ").slice(0, 40)
  if (!model) {
    console.log(`${at.padEnd(16)} ${pool.length} units, ${state.length} chars  ${line}`)
    for (const r of pool.filter((r) => pool.length <= 12 || label(r.resourceId)))
      console.log(`    ${label(r.resourceId) ? "+" : " "} ${r.resourceId}  ${r.title.slice(0, 60)}`)
    return
  }
  const chunks = Number.isFinite(batch)
    ? Array.from({ length: Math.ceil(questions.length / batch) }, (_, i) => questions.slice(i * batch, (i + 1) * batch))
    : [questions]
  const t0 = performance.now()
  // the batches of one turn go out together, as the turn would send them
  const parts = await Promise.all(
    chunks.map((qs) =>
      Effect.runPromise(
        decide(model, state, Object.fromEntries(qs), { maxRetries: 0 }).pipe(
          Effect.match({
            onSuccess: (ok) => ({ ok }),
            onFailure: (e) => ({ status: blocked(e) ? `blocked:${blocked(e)}` : `failed: ${e.message.slice(0, 120)}` }),
          }),
        ),
      ),
    ),
  )
  const ms = Math.round(performance.now() - t0)
  const bad = parts.flatMap((x) => ("ok" in x ? [] : [x.status]))[0]
  const answers: Record<string, unknown> = Object.assign({}, ...parts.map((x) => ("ok" in x ? x.ok.answers : {})))
  const tokens = parts.reduce((n, x) => n + ("ok" in x ? x.ok.usage.input : 0), 0)
  const ps = bad
    ? []
    : pool.map((x, i) => ({
        id: x.resourceId,
        p: (answers[`u${i}`] as { probability?: number } | undefined)?.probability ?? NaN,
        label: label(x.resourceId),
      }))
  runs.push({ at, status: bad ?? "ok", ms, ps })
  console.log(
    `${at.padEnd(16)} ${(bad ?? "ok").padEnd(8)} ${String(ms).padStart(5)}ms ${String(tokens).padStart(6)}tok ${chunks.length}req  ${line}`,
  )
  // a large pool prints what should be read and whatever else ranks beside it
  const shown = ps.length <= 12 ? ps : [...ps].sort((a, b) => b.p - a.p).filter((x, i) => x.label || i < 5)
  for (const x of shown) console.log(`    ${x.label ? "+" : " "} ${x.p.toFixed(2)}  ${x.id}`)
  if (ps.length > 12)
    console.log(
      `    over ${LOOKUP} / 0.8 / 0.9: ${[LOOKUP, 0.8, 0.9].map((t) => ps.filter((x) => x.p > t).length).join(" / ")}`,
    )
}

console.log(`${config.driver} ${config.model} · ${cardFile ?? dir}${dry ? " · DRY RUN" : ""}`)
if (cardFile) {
  const card = readCard(cardFile)
  const pool = makeSession({ card, rows: () => plain, model: idle }).readable(null)
  for (const c of CASES[card.id] ?? [])
    await ask(`${card.id} case`, pool, "", c, (id) => c.need.some((x) => id.endsWith(`:${x}`)), plain, card)
}
const cased = new Set<string>()
for (const s of cardFile ? [] : all("select id, card, head, next from story order by id")) {
  const card = cards.get(s["card"] as string)
  if (!card) continue
  const nodes = all("select json from node where story = ? order by id", s["id"] as number).map((r) => json<Node>(r)!)
  if (!nodes.length) continue
  const rows: Rows = {
    harness: packs.find((p) => p.id === "harness"),
    packs: packs.filter((p) => p.id !== "harness"),
    local: json<Local>(db.prepare("select json from local where card = ?").get(card.id) as Row | undefined),
  }
  const session = makeSession({
    card,
    rows: () => rows,
    model: idle,
    store: {
      read: () => ({ nodes: nodes as never, head: s["head"] as number | null, next: s["next"] as number }),
      write: () => {},
    },
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    if (!(n.input?.text || n.input?.note)) continue
    const pool = session.readable(n.parent)
    if (!pool.length) continue
    const read = new Set((n.deliveries ?? []).map((d) => d.resourceId))
    await ask(
      `${card.id} ${s["id"] as number}/${n.id}`,
      pool,
      prose(byId.get(n.parent ?? -1)),
      n.input,
      (id) => read.has(id),
      rows,
      card,
    )
  }
  const last = nodes.at(-1)!
  if (CASES[card.id] && !cased.has(card.id)) {
    const pool = session.readable(last.id)
    if (!pool.length) continue
    cased.add(card.id)
    for (const c of CASES[card.id]!)
      await ask(
        `${card.id} ${s["id"] as number} case`,
        pool,
        prose(last),
        c,
        (id) => c.need.some((x) => id.endsWith(`:${x}`)),
        rows,
        card,
      )
  }
}

if (!dry) {
  const done = runs.filter((r) => r.status === "ok")
  const ms = done.map((r) => r.ms).sort((a, b) => a - b)
  const ps = done.flatMap((r) => r.ps)
  const yes = ps.filter((x) => x.label).map((x) => x.p)
  const no = ps.filter((x) => !x.label).map((x) => x.p)
  console.log(
    [
      `\n${runs.length} turns asked: ${done.length} answered, ${runs.length - done.length} blocked or failed`,
      `latency ms: median ${ms[ms.length >> 1] ?? "-"}, max ${ms.at(-1) ?? "-"}`,
      `entries that should be read: ${yes.length}, lowest P ${yes.length ? Math.min(...yes).toFixed(2) : "-"}`,
      `entries that should not: ${no.length}, highest P ${no.length ? Math.max(...no).toFixed(2) : "-"}`,
    ].join("\n"),
  )
}
