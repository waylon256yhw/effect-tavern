// The developer's session: one card (CARD, default wuxia) on the local Anthropic connection, or on a scripted model
// (MODEL=fake) that answers every stage well enough to drive the client; served in inspector mode. The journal lives in
// .dev/<card>.json at the repo root, so Vite re-evaluating this module after a runtime/server edit, or a restart, keeps
// the story; the greeting (GREETING, default 0) opens only an empty journal.
import { capabilities, compile, fake, fakeText, localAnthropic, type FakeCall } from "@effect-tavern/provider"
import type { Beat } from "@effect-tavern/runtime/src/card.ts"
import type { Store } from "@effect-tavern/runtime/src/journal.ts"
import { makeSession, type SessionModel, type Turn } from "@effect-tavern/runtime/src/session.ts"
import { loadCard, player } from "@effect-tavern/runtime/test/cards/index.ts"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { handle } from "./serve.ts"

const name = process.env["CARD"] ?? "wuxia"
const dir = fileURLToPath(new URL("../../../.dev/", import.meta.url))
const file = `${dir}${name}.json`
mkdirSync(dir, { recursive: true })
const store: Store<Beat> = {
  // ponytail: the whole list, synchronously, on every save; a dev journal is a few hundred nodes at most
  read: () => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Turn[]) : []),
  write: (nodes) => writeFileSync(file, JSON.stringify(nodes)),
}

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
      .match(/Open: ([\w,=]*)/)?.[1]
      .split(/[,|]/)
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
        notes: [`第${n}段立下的事实`],
        options: ["上前一步", "按剑不动", "开口搭话", "转身离开"],
        scene: { place: `竹林深处 ${n}`, present: [{ name: "李", mood: "calm" }] },
        people: [],
        inner: `第${n}段的心思`,
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
        text: `第${++n}段。${text.includes("Previous draft broke") ? "二稿。" : demo ? "一稿。" : ""}${"竹叶在风里翻了一遍又一遍，"}${"你听见远处有人踏着落叶走来。".repeat(demo ? 8 : 3)}`,
        delay: demo ? 120 : 20,
      }
  }
}

const live = (): SessionModel => {
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
if (session.size === 0) {
  const greeting = card.greetings[Number(process.env["GREETING"] ?? 0)]
  if (greeting) session.greet(greeting)
}
export const handler = handle(session, { inspect: true })
