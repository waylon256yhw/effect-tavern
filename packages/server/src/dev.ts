// The developer's session: one card (CARD, default ri) on the local Anthropic connection, or on a scripted model
// (MODEL=fake) that answers every stage well enough to drive the client; served in inspector mode. The library (data.ts)
// is `tavern.db` under DATA, by default .dev/ at the repo root, so Vite re-evaluating this module after a runtime/server
// edit, or a restart, keeps the story; a second process on the same DATA gets a library of its own (data.ts `lock`).
// Each request names its story; one that names none plays the card's newest, or a new one. An empty story opens on
// the greeting GREETING names, and on none otherwise: the player picks one on the card page (a greet is a root, and one
// picked on the server would stay as an orphan root beside the player's). Which model runs each stage is the library's
// routing (the settings page); MODEL=fake puts the scripted model over it. This module is the environment's entry: it
// reads the environment and opens the store, tavern.ts builds the tavern from what it read.
import {
  bind,
  fake,
  fakeText,
  localAnthropic,
  localAnthropicKey,
  type FakeCall,
  type Model,
} from "@effect-tavern/provider"
import { cardNames, loadCard, player } from "@effect-tavern/runtime/test/cards/index.ts"
import { defaultAnswer, readStage } from "@effect-tavern/runtime/test/script.ts"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { open } from "./data.ts"
import { refresh } from "./names.ts"
import { tavern } from "./tavern.ts"

const name = process.env["CARD"] ?? "ri"
// a compiled binary (bun build --compile) has no checkout around it: its library lives where it is run
const dir =
  process.env["DATA"] ??
  (import.meta.url.includes("$bunfs")
    ? `${process.cwd()}/.dev`
    : fileURLToPath(new URL("../../../.dev/", import.meta.url)))
mkdirSync(dir, { recursive: true })
const data = open(`${dir}/tavern.db`)
void refresh(data) // the model-name table, in the background: startup never waits on models.dev

let n = 0
/** By phase: lookup reads nothing, decide ends, direct opens what the gate offered, check is clean, record answers each
 *  question with its first option and fills the asked products with canned rows. Prose streams a numbered paragraph.
 *  A line containing 重写 is the slow demo: longer prose at reading pace, a second of check and of record, and the
 *  rewrite — the first draft says 一稿, check fails it, the correction draft says 二稿. */
const answer = (o: FakeCall) => {
  const text = o.prompt.map(fakeText).join("\n")
  const doc = readStage(o)
  const demo = /重写|一稿|二稿/.test(text)
  switch (doc.phase) {
    case "lookup":
      return { ...defaultAnswer(doc), delay: demo ? 1500 : 0 } // room to stop before the first character
    case "direct":
      return { text: JSON.stringify({ must: [], may: doc.open, tone: "平静" }) }
    case "check":
      return {
        text: JSON.stringify({ fired: [], violated: text.includes("一稿") ? [doc.rules[0] ?? ""] : [] }),
        delay: demo ? 1000 : 0,
      }
    case "record": {
      // ponytail: canned rows for the harness defaults and wuxia's products; another card's product decodes to nothing
      const canned: Record<string, unknown> = {
        notes: `第${n}幕：玩家与裴青舟在苦竹岭茶亭中隔桌相对，试探彼此来意。`,
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
      return { ...defaultAnswer(doc, canned), delay: demo ? 1000 : 0 }
    }
    case "narrate":
      return {
        text: `第${++n}段。${text.includes("Previous draft broke") ? "二稿。" : demo ? "一稿。" : ""}${"雨后的苦竹林里雾气未散，竹叶上的水珠顺着亭檐一滴滴落在青石板上。"}${"裴青舟按着乌木剑鞘站在三步开外，目光静静地落在你腰间的旧短剑上。".repeat(demo ? 6 : 2)}`,
        delay: demo ? 120 : 20,
      }
    default: // decide ends, polish hands every marked sentence back unchanged (a pass-through, so the prose stands)
      return defaultAnswer(doc)
  }
}

/** The environment's model, in force for any stage the routing row does not name: the local Anthropic key, when the
 *  machine has one. */
const live = (): Model | undefined => {
  const conn = localAnthropic()
  if (!conn) return undefined
  // the proxy rides on Bun's fetch (provider connection.ts): on Node a live request goes direct and fails behind one
  if (!("Bun" in globalThis)) throw new Error("live model needs Bun: bun --bun vp run dev, or MODEL=fake")
  return bind({ ...conn, effort: "low", hat: process.env["HAT"] ?? conn.hat }) // HAT=<id> puts a library hat on it
}
const scripted = process.env["MODEL"] === "fake"
const one = scripted ? { ...fake(answer), hat: process.env["HAT"] } : live() // HAT works on the scripted model too
const model = one && (() => one)

const key = localAnthropicKey()
const greeting = process.env["GREETING"]
const card = await loadCard(name)
// the template cards, listed by GET /cards
const cards = (await Promise.all(cardNames.map(loadCard))).map((c) => ({ id: c.id, title: c.title }))
export const { handler } = tavern({
  data,
  card,
  cards,
  player,
  model,
  pinned: scripted, // MODEL=fake scripts every stage, whatever the routing says
  ...(key && { seed: { key } }), // a first start puts the local key in the vault (tavern.ts `seed`)
  ...(greeting !== undefined && { greeting: Number(greeting) }),
  inspect: true,
})
