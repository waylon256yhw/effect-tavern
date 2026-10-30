// The session (src/session.ts) on a real connection, for one card: `node test/live.ts wuxia | banxing | ri | yandao [greeting]`.
// The optional second argument picks the greeting (default 0): `yandao 1` opens the town after the fight.
// Printed off the event stream, the way the inspector would show it: the prose as it streams, every stage's request
// size, output and usage, then the node. No assertions on the prose; the point is judgement quality, request shapes
// and cache behaviour. Skips without a key.
import { bind, localAnthropic, type Message, type Trace } from "@effect-tavern/provider"
import { Effect, Stream } from "effect"
import type { Card } from "../src/card.ts"
import { prose } from "../src/journal.ts"
import { makeSession, type Event } from "../src/session.ts"
import { loadCard, player } from "./cards/index.ts"

const which = process.argv[2] ?? "wuxia"
// Scripted lines for the linear cards (yandao, banxing, ri); wuxia branches off node 0.
const lines: Record<string, string[]> = {
  // 盐道: direction, not dialogue, each line is what a novelist tells the narrator to write next
  yandao: [
    "沈二带的驼队进镇，街上的人在看。先写镇子的样子，不要急着出事。",
    "老柯带两个差役上来查驼队，沈二不让开包。写到动手为止，写两三个旁观者的反应。",
    "切到县衙里。周秉文听到消息，写他和老柯的对话。",
    "第二天早上，镇上的传言。收尾时留一个悬念。",
  ],
  banxing: [
    "我把游戏机放回床头柜，侧过身看着她的侧脸。“排到第几了？”",
    "“你刚才说，和我在一起也很自由。”我顿了顿，“这话是认真的吗？”",
    "我伸手把被子往她那边拉了拉，没说话，只是看着手机微光里她的手指。",
    "“那就别睡了。你想打几局，我在旁边看着。”我把可乐罐拿远了一点。",
  ],
  ri: [
    "我放下手里的圣经，看着她。“理，你今天好像有话想说。不急，慢慢说。”",
    "我沉默了片刻，然后轻轻握住她绞着吊坠的手。“我听到了。我也一样。”",
    "“罗伦斯大人要是知道了，会怎么说？”我笑着问她，顺手替她理了理头纱。",
    "“今天的礼拜，我们一起主持吧。你选诗篇。”",
  ],
}
type Script = { card: Card; turns: Array<{ parent: number | null; input: { text: string; note?: string } }> }
const script = async (): Promise<Script> => {
  const card = await loadCard(which)
  switch (which) {
    case "wuxia":
      return {
        card,
        turns: [
          {
            parent: 0,
            input: { text: "我在亭外收起油纸伞，拱手道：「在下从关外远道而来，特来寻访裴青舟裴兄。」" },
          },
          {
            parent: 0,
            input: {
              text: "我把李鹤留下的短剑放在石桌上：「我是李鹤在关外的旧友，听说他半年前死在了江南，特来问个清楚。」",
            },
          },
          {
            parent: 2,
            input: {
              text: "「既然裴兄不肯吐实，那便请赐教吧！」我拔剑向裴青舟左肩虚刺一剑。",
              note: "写得简练紧凑一些。",
            },
          },
          { parent: 3, input: { text: "我收剑后退半步，盯着裴青舟左肩被剑锋挑开的衣领。" } },
          { parent: 4, input: { text: "我一剑快似一剑地向裴青舟攻去，非要逼他使出全力不可。" } }, // the §10 case
        ],
      }
    default: {
      const turns = lines[which]
      if (!turns) throw new Error(`unknown card ${which}`)
      // Linear: each turn follows the previous node; node 0 is the greeting when the card has one. The card's default
      // channel decides which box the typed text lands in: the client reads `input`, the session takes both.
      const first = card.greetings.length ? 1 : 0
      return {
        card,
        turns: turns.map((text: string, i: number) => ({
          parent: i === 0 ? (first ? 0 : null) : i - 1 + first,
          input: card.input === "note" ? { text: "", note: text } : { text },
        })),
      }
    }
  }
}

const conn = localAnthropic()
if (!conn) {
  console.log("live skipped (no key)")
  process.exit(0)
}
const traces: Trace[] = []
const { card, turns } = await script()
// effort low: narrate thinks, so the reply carries reasoning parts
const model = bind({ ...conn, effort: "low" }, { onTrace: (t) => traces.push(t), traceBody: true })
const S = makeSession({ card, player, model: () => model })
const thinkingSent = (t: Trace | undefined) => {
  const body = t?.body ? (JSON.parse(t.body) as { messages?: Array<{ content?: Array<{ type: string }> }> }) : undefined
  return body?.messages?.flatMap((m) => m.content ?? []).filter((c) => c.type === "thinking").length ?? 0
}
const msgText = (m: Message) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")
const show = (s: unknown) => (typeof s === "string" ? s : JSON.stringify(s))
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replaceAll("\n", "⏎")

const greeting = card.greetings[Number(process.argv[3] ?? (which === "ri" ? 2 : 0))]
if (greeting) {
  const g = S.greet(greeting).node!
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
    case "change": {
      if (!e.node) return
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
    console.log(`\n━━ turn ← ${t.parent ?? "root"}  "${t.input.text || `(note) ${t.input.note}`}"`)
    yield* Stream.runForEach(S.act(t.parent, t.input), (e) => Effect.sync(() => print(e)))
    console.log(`  ${Math.round(performance.now() - t0)}ms`)
  }
  console.log(
    `\n${calls} calls, ${traces.length} requests (${[...new Set(traces.map((t) => t.status))].join("/")}), ${S.log.nodes.size} nodes; tokens ${show(total)}`,
  )
})

await Effect.runPromise(program)
