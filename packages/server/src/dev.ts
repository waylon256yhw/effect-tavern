// The developer's session: one card (CARD, default wuxia) on the local Anthropic connection, or on a scripted model
// (MODEL=fake) that answers every stage well enough to drive the client; served in inspector mode. The library (data.ts)
// is `tavern.db` under DATA, by default .dev/ at the repo root, so Vite re-evaluating this module after a runtime/server
// edit, or a restart, keeps the story; the session plays the card's newest story, or opens one. An empty story opens on
// the greeting GREETING names, and on none otherwise: the player picks one on the card page (a greet is a root, and one
// picked on the server would stay as an orphan root beside the player's).
import { capabilities, compile, fake, fakeText, localAnthropic, type FakeCall } from "@effect-tavern/provider"
import { makeSession, type SessionModel, type Turn } from "@effect-tavern/runtime/src/session.ts"
import { loadCard, player } from "@effect-tavern/runtime/test/cards/index.ts"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { open } from "./data.ts"
import { handle } from "./serve.ts"

const name = process.env["CARD"] ?? "wuxia"
const dir = process.env["DATA"] ?? fileURLToPath(new URL("../../../.dev/", import.meta.url))
mkdirSync(dir, { recursive: true })
const data = open(`${dir}/tavern.db`)
const story = data.stories.list(name)[0]?.id ?? data.stories.create(name)
const store = data.store<Turn>(story)

let n = 0
/** By phase: lookup reads nothing, decide ends, direct opens what the gate offered, check is clean, record answers each
 *  question with its first option and fills the asked products with canned rows. Prose streams a numbered paragraph.
 *  A line containing 重写 is the slow demo: longer prose at reading pace, a second of check and of record, and the
 *  rewrite — the first draft says 一稿, check fails it, the correction draft says 二稿. */
const answer = (o: FakeCall) => {
  const text = o.prompt.map(fakeText).join("\n")
  const phase = o.responseFormat?.type === "json" ? (o.responseFormat.name ?? "narrate") : "narrate"
  const open =
    text
      .match(/^Open: (.*)$/m)?.[1]
      .split("|")
      .map((x) => x.split("=")[0]!.trim())
      .filter(Boolean) ?? []
  const demo = /重写|一稿|二稿/.test(text)
  switch (phase) {
    case "lookup":
      return { text: JSON.stringify({ read: [] }), delay: demo ? 1500 : 0 } // room to stop before the first character
    case "decide":
      return { text: JSON.stringify({ next: "end" }) }
    case "direct":
      return { text: JSON.stringify({ must: [], may: open, tone: "平静" }) }
    case "check":
      return {
        text: JSON.stringify({
          fired: [],
          violated: text.includes("一稿") ? [text.match(/^Rule: (.*)$/m)?.[1] ?? ""] : [],
        }),
        delay: demo ? 1000 : 0,
      }
    case "record": {
      const answers = Object.fromEntries(
        [...text.matchAll(/^(?:Questions: )?(\w+): [^[\n]*\[([^\]]*)\]$/gm)].map(([, id, opts]) => [
          id,
          opts!.split(" | ")[0]!.split(":")[0]!.trim(),
        ]),
      )
      // ponytail: canned rows for the harness defaults and wuxia's products; another card's product decodes to nothing
      const canned: Record<string, unknown> = {
        notes: [`第${n}幕：你与裴青舟在苦竹岭茶亭中隔桌相对，试探彼此来意。`],
        options: [
          "我解下腰间那柄旧短剑放在石桌上：「我是替李鹤来送还故物的。」",
          "「既然裴兄不愿提他，那我便向阁下讨教几招。」我按住剑柄往前踏出一步。",
          "我看着亭外未干的泥土，轻声问：「这竹亭外的孤坟，埋的真是李鹤吗？」",
          "我拱了拱手：「今日冒昧打扰，改日再来拜会。」",
        ],
        scene: { place: `苦竹岭茶亭 ${n}`, present: [{ name: "裴青舟", mood: "calm" }] },
        people: [],
        inner: `裴青舟垂眼看着石桌上的雨水，心里暗自思量你究竟是从何处得知李鹤的名字。`,
      }
      const asked = [...text.matchAll(/^(\w+): (?!.*\[)/gm)]
        .map(([, id]) => id!)
        .filter((id) => !["Known", "Current", "Questions"].includes(id))
      const products = Object.fromEntries(asked.map((id) => [id, canned[id]]))
      return {
        text: JSON.stringify(Object.keys(answers).length ? { ...products, answers } : products),
        delay: demo ? 1000 : 0,
      }
    }
    default:
      return {
        text: `第${++n}段。${text.includes("Previous draft broke") ? "二稿。" : demo ? "一稿。" : ""}${"雨后的苦竹林里雾气未散，竹叶上的水珠顺着亭檐一滴滴落在青石板上。"}${"裴青舟按着乌木剑鞘站在三步开外，目光静静地落在你腰间的旧短剑上。".repeat(demo ? 6 : 2)}`,
        delay: demo ? 120 : 20,
      }
  }
}

const live = (): SessionModel => {
  // the proxy rides on Bun's fetch (provider connection.ts): on Node a live request goes direct and fails behind one
  if (!("Bun" in globalThis)) throw new Error("live model needs Bun: bun --bun vp run dev, or MODEL=fake")
  const conn = localAnthropic()
  if (!conn)
    throw new Error("no connection: put an Anthropic key where provider's localAnthropic() reads it, or MODEL=fake")
  const caps = capabilities(conn)
  return {
    format: conn.format,
    model: compile(conn),
    prefill: caps.prefill,
    reasoningBack: caps.reasoningBack,
    effort: "low",
    ttl: conn.cacheTtl,
  }
}
const model: SessionModel = process.env["MODEL"] === "fake" ? { ...fake(answer), prefill: false } : live()
const card = await loadCard(name)
const session = makeSession({ card, player, model, store })
if (session.log.nodes.size === 0 && process.env["GREETING"] !== undefined) {
  const greeting = card.greetings[Number(process.env["GREETING"])]
  if (greeting) session.greet(greeting)
}
export const handler = handle(session, { inspect: true })
