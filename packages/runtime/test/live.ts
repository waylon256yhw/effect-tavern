// The loop (test/harness.ts) on a real connection, for one card: `node test/live.ts wuxia | banxing | ri`.
// Printed the way the inspector would show it: every stage's request size, output and usage, then the node.
// No assertions on the prose; the point is judgement quality, request shapes and cache behaviour. Skips without a key.
import { capabilities, compile, localAnthropic, type Trace } from "@effect-tavern/provider"
import { Effect } from "effect"
import { prose } from "../src/journal.ts"
import {
  chain,
  chat,
  eventsOf,
  full,
  greet,
  journal,
  log,
  msgText,
  player as wuxiaPlayer,
  run,
  stateAt,
  useCard,
  useModel,
  wuxia,
  type Card,
  type CardData,
} from "./harness.ts"

const which = process.argv[2] ?? "wuxia"
// The player layer: language, and the point-of-view slot every player sets once. Without the second, Haiku wrote the
// player's answer to the confession for them (docs/provider-reading.md §10).
const player = {
  global: [
    ...wuxiaPlayer.global,
    { id: "pov", text: "用第二人称写玩家。玩家只做输入里做的事、只说输入里说的话；不替玩家说话，不替玩家做决定。" },
  ],
  forCard: {},
}

type Script = {
  data: CardData
  greeting?: string
  turns: Array<{ card: Card; parent: number | null; input: { text: string; aside?: string } }>
}
const script = async (): Promise<Script> => {
  switch (which) {
    case "wuxia":
      return {
        data: wuxia,
        turns: [
          { card: chat, parent: null, input: { text: "你好，我是个路过的旅人。" } },
          { card: full, parent: null, input: { text: "你认识一个叫李的人吗？" } },
          { card: full, parent: 1, input: { text: "我拔剑攻向B。", aside: "写得短一点。" } },
          { card: full, parent: 2, input: { text: "我停手，看着B的肩膀。" } },
          { card: full, parent: 3, input: { text: "我一剑接一剑地砍，直到他倒下为止。" } }, // the §10 case
        ],
      }
    case "banxing":
    case "ri": {
      const m = which === "banxing" ? await import("./cards/banxing.ts") : await import("./cards/ri.ts")
      const { data, card, greeting } = m.load()
      // Linear: each turn follows the previous node; node 0 is the greeting.
      return { data, greeting, turns: m.turns.map((text, i) => ({ card, parent: i, input: { text } })) }
    }
    default:
      throw new Error(`unknown card ${which}`)
  }
}

const conn = localAnthropic()
if (!conn) {
  console.log("live skipped (no key)")
  process.exit(0)
}
const traces: Trace[] = []
const caps = capabilities(conn)
useModel({
  format: conn.format,
  model: compile(conn, { onTrace: (t) => traces.push(t), traceBody: true }),
  prefill: caps.prefill,
  reasoningBack: caps.reasoningBack,
  effort: "low", // narrate thinks, so the reply carries reasoning parts
})
const thinkingSent = (t: Trace | undefined) => {
  const body = t?.body ? (JSON.parse(t.body) as { messages?: Array<{ content?: Array<{ type: string }> }> }) : undefined
  return body?.messages?.flatMap((m) => m.content ?? []).filter((c) => c.type === "thinking").length ?? 0
}

const show = (s: unknown) => (typeof s === "string" ? s : JSON.stringify(s))
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replaceAll("\n", "⏎")

const { data, greeting, turns } = await script()
useCard(data)
if (greeting) {
  const g = greet(greeting)
  console.log(`━━ node ${g.id}: greeting (${greeting.length} chars), state=${show(stateAt(chain(g.id)))}`)
}

const program = Effect.gen(function* () {
  for (const t of turns) {
    const before = log.length
    const t0 = performance.now()
    const node = yield* run(t.card, player, t.parent, t.input)
    const ms = Math.round(performance.now() - t0)
    const path = chain(node.id)
    console.log(`\n━━ turn ${node.id} ← ${t.parent ?? "root"}  "${t.input.text}"  ${ms}ms`)
    for (const [k, e] of log.slice(before).entries()) {
      const u = e.usage
      if (e.phase === "narrate")
        console.log(
          `  narrate carried ${thinkingSent(traces[before + k])} thinking block(s) back; reply has ${node.reply.filter((p) => p.type === "reasoning").length} reasoning part(s)`,
        )
      console.log(
        `  ${e.phase.padEnd(7)} ${String(e.msgs.length).padStart(2)} msgs  in ${String(u.input).padStart(5)} (cache r${u.cacheRead} w${u.cacheWrite})  out ${String(u.output).padStart(4)}`,
      )
      const last = e.msgs.at(-1)!
      console.log(`          last ${last.role}: ${clip(msgText(last), 90)}`)
      console.log(`          → ${clip(show(e.out), 220)}`)
    }
    console.log(
      `  node: read=${show(node.read)} beats=${show(node.beats.map((b) => b.next))} end=${node.end} events=${show(eventsOf(path, node))}`,
    )
    console.log(`        brief=${show(node.brief)} fired=${show(node.fired)} violated=${show(node.violated)}`)
    console.log(`        answers=${show(node.answers)} state=${show(stateAt(path))} notes=${show(node.notes)}`)
    console.log(`  prose: ${clip(prose(node), 600)}`)
  }
  const total = log.reduce(
    (a, e) => ({
      input: a.input + e.usage.input,
      output: a.output + e.usage.output,
      cacheRead: a.cacheRead + e.usage.cacheRead,
      cacheWrite: a.cacheWrite + e.usage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )
  console.log(
    `\n${log.length} calls, ${traces.length} requests (${[...new Set(traces.map((t) => t.status))].join("/")}), ${journal.size} nodes; tokens ${show(total)}`,
  )
})

await Effect.runPromise(program)
