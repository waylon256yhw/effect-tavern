// The estimate against the counts Anthropic's count_tokens gave for the same texts (Haiku 5.5, 2026-10-24).
import assert from "node:assert/strict"
import { tokens } from "../src/tokens.ts"
import { loadCard } from "./cards/index.ts"

const within = (est: number, real: number, pct: number) => Math.abs(est - real) / real <= pct
const ri = await loadCard("ri")
const yandao = await loadCard("yandao")
const banxing = await loadCard("banxing")
const en =
  "The road winds on through the bamboo, and you hear someone walking over fallen leaves far away. A keeps the player at arm's length until the bond is earned; the swordsman says little, and what he says is measured. ".repeat(
    6,
  )
for (const [name, text, real] of [
  ["理 opening", ri.greetings[0]!.text, 1129],
  ["盐道 fiction", yandao.fiction.map((f) => f.text ?? "").join("\n"), 339],
  ["伴星 opening", banxing.greetings[0]!.text, 692],
  ["理 band fragment", ri.fiction[1]!.text ?? "", 1616],
  ["English prose", en, 390],
] as const) {
  assert.ok(within(tokens(text), real, 0.05), `${name}: ${tokens(text)} vs ${real}`)
}
assert.equal(tokens(""), 0)
console.log("tokens ok")
