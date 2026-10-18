// `node src/main.ts [card] [port] [greeting]`: one session on the local Anthropic connection, served in inspector mode.
// Cards are the runtime's templates (wuxia | banxing | ri | yandao); the greeting index picks the opening node.
import { capabilities, compile, localAnthropic } from "@effect-tavern/provider"
import { makeSession } from "@effect-tavern/runtime/src/session.ts"
import { loadCard, player } from "@effect-tavern/runtime/test/cards/index.ts"
import { serve } from "./serve.ts"

const name = process.argv[2] ?? "wuxia"
const port = Number(process.argv[3] ?? 7777)
const conn = localAnthropic()
if (!conn) throw new Error("no connection: put an Anthropic key where provider's localAnthropic() reads it")
const card = await loadCard(name)
const caps = capabilities(conn)
const session = makeSession({
  card,
  player,
  model: {
    format: conn.format,
    model: compile(conn),
    prefill: caps.prefill,
    reasoningBack: caps.reasoningBack,
    effort: "low",
    ttl: conn.cacheTtl,
  },
})
const greeting = card.greetings[Number(process.argv[4] ?? 0)]
if (greeting) session.greet(greeting)
serve(session, { inspect: true }).listen(port, () => console.log(`${name} on http://localhost:${port}`))
