// The loop (test/harness.ts) on a real connection, for one card: `node test/live.ts wuxia | banxing | ri | yandao [greeting]`.
// The optional second argument picks the greeting (default 0): `yandao 1` opens the town after the fight.
// Printed the way the inspector would show it: every stage's request size, output and usage, then the node.
// No assertions on the prose; the point is judgement quality, request shapes and cache behaviour. Skips without a key.
import { capabilities, compile, localAnthropic, type Trace } from "@effect-tavern/provider"
import { Effect } from "effect"
import type { Card } from "../src/card.ts"
import { prose } from "../src/journal.ts"
import { chat, full, player as wuxiaPlayer } from "./cards/wuxia.ts"
import { chain, eventsOf, greet, journal, log, msgText, run, stateAt, useCard, useModel } from "./harness.ts"

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

/** `card` is what `useCard` binds; a turn may run a stripped copy of it (wuxia's `chat`) to show the stages switch off. */
type Script = {
  card: Card
  turns: Array<{ card?: Card; parent: number | null; input: { text: string; aside?: string } }>
}
const script = async (): Promise<Script> => {
  switch (which) {
    case "wuxia":
      return {
        card: full,
        turns: [
          { card: chat, parent: null, input: { text: "你好，我是个路过的旅人。" } },
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
      // channel decides which box the typed text lands in: the client reads `input`, the loop takes both.
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

const { card, turns } = await script()
useCard(card)
const greeting = card.greetings[Number(process.argv[3] ?? 0)]
if (greeting) {
  const g = greet(greeting)
  console.log(`━━ node ${g.id}: greeting (${greeting.text.length} chars), state=${show(stateAt(chain(g.id)))}`)
}

const program = Effect.gen(function* () {
  for (const t of turns) {
    const before = log.length
    const t0 = performance.now()
    const node = yield* run(t.card ?? card, player, t.parent, t.input)
    const ms = Math.round(performance.now() - t0)
    const path = chain(node.id)
    console.log(
      `\n━━ turn ${node.id} ← ${t.parent ?? "root"}  "${t.input.text || `(aside) ${t.input.aside}`}"  ${ms}ms`,
    )
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
