// The loop (test/harness.ts) on a real connection: the same card, four turns, printed the way the inspector would show
// them. No assertions on the prose; the point is to see judgement quality, request shapes and cache behaviour.
// Skips without a key. Haiku, small outputs: a few cents per run.
import { capabilities, compile, localAnthropic, type Trace } from "@effect-tavern/provider"
import { Effect } from "effect"
import { chain, chat, eventsOf, full, journal, log, msgText, player, run, stateAt, useModel } from "./harness.ts"

const conn = localAnthropic()
if (!conn) {
  console.log("loop-live skipped (no key)")
  process.exit(0)
}
const traces: Trace[] = []
useModel({
  format: conn.format,
  model: compile(conn, { onTrace: (t) => traces.push(t) }),
  prefill: capabilities(conn).prefill,
})

const show = (s: unknown) => (typeof s === "string" ? s : JSON.stringify(s))
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replaceAll("\n", "⏎")

const program = Effect.gen(function* () {
  const turns = [
    { card: chat, parent: null as number | null, input: { text: "你好，我是个路过的旅人。" } },
    { card: full, parent: null as number | null, input: { text: "你认识一个叫李的人吗？" } },
    { card: full, parent: 1, input: { text: "我拔剑攻向B。", aside: "写得短一点。" } },
    { card: full, parent: 2, input: { text: "我停手，看着B的肩膀。" } },
    { card: full, parent: 3, input: { text: "我一剑接一剑地砍，直到他倒下为止。" } }, // the §10 case: the input asks for more
  ]
  for (const t of turns) {
    const before = log.length
    const t0 = performance.now()
    const node = yield* run(t.card, player, t.parent, t.input)
    const ms = Math.round(performance.now() - t0)
    const path = chain(node.id)
    console.log(`\n━━ turn ${node.id} ← ${t.parent ?? "root"}  "${t.input.text}"  ${ms}ms`)
    for (const e of log.slice(before)) {
      const u = e.usage
      const last = e.msgs.at(-1)!
      console.log(
        `  ${e.phase.padEnd(7)} ${String(e.msgs.length).padStart(2)} msgs  in ${String(u.input).padStart(5)} (cache r${u.cacheRead} w${u.cacheWrite})  out ${String(u.output).padStart(4)}`,
      )
      console.log(`          last ${last.role}: ${clip(msgText(last), 90)}`)
      console.log(`          → ${clip(show(e.out), 220)}`)
    }
    console.log(
      `  node: read=${show(node.read)} beats=${show(node.beats.map((b) => b.next))} end=${node.end} events=${show(eventsOf(path, node))}`,
    )
    console.log(`        brief=${show(node.brief)} fired=${show(node.fired)} violated=${show(node.violated)}`)
    console.log(`        answers=${show(node.answers)} state=${show(stateAt(path))} notes=${show(node.notes)}`)
    console.log(`  prose: ${clip(node.prose, 400)}`)
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
