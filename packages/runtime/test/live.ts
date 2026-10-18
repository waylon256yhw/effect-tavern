// The session (src/session.ts) on a real connection, for one card: `node test/live.ts wuxia | banxing | ri | yandao [greeting]`.
// The optional second argument picks the greeting (default 0): `yandao 1` opens the town after the fight.
// Printed off the event stream, the way the inspector would show it: the prose as it streams, every stage's request
// size, output and usage, then the node. No assertions on the prose; the point is judgement quality, request shapes
// and cache behaviour. Skips without a key.
import { capabilities, compile, localAnthropic, type Message, type Trace } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import type { Card } from "../src/card.ts"
import { prose } from "../src/journal.ts"
import { makeSession, type Event } from "../src/session.ts"
import { full, player as wuxiaPlayer } from "./cards/wuxia.ts"

const which = process.argv[2] ?? "wuxia"
// The player layer: language, and the point-of-view slot every player sets once. Without the second, Haiku wrote the
// player's answer to the confession for them (docs/provider-reading.md §10). A card with no player in the fiction
// (yandao) fills the same slot itself; the player's global `pov` yields to it (fragment.ts defaults).
const player = {
  global: [
    ...wuxiaPlayer.global,
    { id: "pov", text: "用第二人称写玩家。玩家只做输入里做的事、只说输入里说的话；不替玩家说话，不替玩家做决定。" },
  ],
  forCard: {},
}

type Script = { card: Card; turns: Array<{ parent: number | null; input: { text: string; aside?: string } }> }
const script = async (): Promise<Script> => {
  switch (which) {
    case "wuxia":
      return {
        card: full,
        turns: [
          { parent: null, input: { text: "你好，我是个路过的旅人。" } },
          { parent: null, input: { text: "你认识一个叫李的人吗？" } },
          { parent: 1, input: { text: "我拔剑攻向B。", aside: "写得短一点。" } },
          { parent: 2, input: { text: "我停手，看着B的肩膀。" } },
          { parent: 3, input: { text: "我一剑接一剑地砍，直到他倒下为止。" } }, // the §10 case
        ],
      }
    case "banxing":
    case "ri":
    case "yandao": {
      const m = await import(`./cards/${which}.ts`)
      const card = m.load()
      // Linear: each turn follows the previous node; node 0 is the greeting when the card has one. The card's default
      // channel decides which box the typed text lands in: the client reads `input`, the session takes both.
      const first = card.greetings.length ? 1 : 0
      return {
        card,
        turns: m.turns.map((text: string, i: number) => ({
          parent: i === 0 ? (first ? 0 : null) : i - 1 + first,
          input: card.input === "aside" ? { text: "", aside: text } : { text },
        })),
      }
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
const { card, turns } = await script()
const S = makeSession({
  card,
  player,
  model: {
    format: conn.format,
    model: compile(conn, { onTrace: (t) => traces.push(t), traceBody: true }),
    prefill: caps.prefill,
    reasoningBack: caps.reasoningBack,
    effort: "low", // narrate thinks, so the reply carries reasoning parts
    ttl: conn.cacheTtl,
  },
})
const thinkingSent = (t: Trace | undefined) => {
  const body = t?.body ? (JSON.parse(t.body) as { messages?: Array<{ content?: Array<{ type: string }> }> }) : undefined
  return body?.messages?.flatMap((m) => m.content ?? []).filter((c) => c.type === "thinking").length ?? 0
}
const msgText = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")
const show = (s: unknown) => (typeof s === "string" ? s : JSON.stringify(s))
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replaceAll("\n", "⏎")

const greeting = card.greetings[Number(process.argv[3] ?? 0)]
if (greeting) {
  const g = S.greet(greeting)
  console.log(`━━ node ${g.turn.id}: greeting (${greeting.text.length} chars), state=${show(g.state)}`)
}

let calls = 0
let streamed = 0 // characters of prose written to the terminal as they arrived, for the delta line
const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const print = (e: Event) => {
  switch (e.kind) {
    case "stage":
      if (e.phase === "narrate") process.stdout.write("  narrate ┃ ")
      return
    case "delta":
      if (e.part.type === "text-delta") {
        process.stdout.write(e.part.text.replaceAll("\n", "⏎"))
        streamed += e.part.text.length
      }
      return
    case "call": {
      const u = e.usage
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += u[k]
      if (e.phase === "narrate") {
        console.log(`\n  (${streamed} chars streamed; carried ${thinkingSent(traces[calls])} thinking block(s) back)`)
        streamed = 0
      }
      calls++
      console.log(
        `  ${e.phase.padEnd(7)} ${String(e.msgs.length).padStart(2)} msgs  in ${String(u.input).padStart(5)} (cache r${u.cacheRead} w${u.cacheWrite})  out ${String(u.output).padStart(4)}`,
      )
      const last = e.msgs.at(-1)!
      console.log(`          last ${last.role}: ${clip(msgText(last), 90)}`)
      console.log(`          → ${clip(show(e.out), 220)}`)
      return
    }
    case "node": {
      const { turn: t, state, events } = e.node
      console.log(
        `  node: read=${show(t.read)} beats=${show(t.beats.map((b) => b.next))} end=${t.end} events=${show(events)}`,
      )
      console.log(`        brief=${show(t.brief)} fired=${show(t.fired)} violated=${show(t.violated)}`)
      console.log(`        answers=${show(t.answers)} state=${show(state)} products=${show(t.products)}`)
      console.log(`        reply has ${t.reply.filter((p) => p.type === "reasoning").length} reasoning part(s)`)
      console.log(`  prose: ${clip(prose(t), 600)}`)
    }
  }
}

const program = Effect.gen(function* () {
  for (const t of turns) {
    const t0 = performance.now()
    console.log(`\n━━ turn ← ${t.parent ?? "root"}  "${t.input.text || `(aside) ${t.input.aside}`}"`)
    yield* Stream.runForEach(S.act(t.parent, t.input), (e) => Effect.sync(() => print(e)))
    console.log(`  ${Math.round(performance.now() - t0)}ms`)
  }
  console.log(
    `\n${calls} calls, ${traces.length} requests (${[...new Set(traces.map((t) => t.status))].join("/")}), ${S.size} nodes; tokens ${show(total)}`,
  )
})

await Effect.runPromise(program)
