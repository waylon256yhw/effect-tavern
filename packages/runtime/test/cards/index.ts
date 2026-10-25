// The four template cards by name, and the player layer the live scripts and the server share.
import type { Card } from "../../src/card.ts"
import type { Player } from "../../src/fragment.ts"
import { full, player as wuxiaPlayer } from "./wuxia.ts"

// The player layer: language, and the writing switches every player sets once (fragment.ts `Writing`): the player is 你,
// the narrator restates their line before the reaction and writes nothing they did not give. Without the last, Haiku
// wrote the player's answer to the confession for them (docs/provider-reading.md §10). A card with no player in the
// fiction (yandao) fills the `pov` slot itself and the compiled one yields to it (fragment.ts defaults). `options` is
// this player's toggle: the dev and live sessions run with it, a card declares nothing about it. The lexicon is a sample
// pack for the polish stage (src/polish.ts), a dozen stock phrases of Chinese web fiction; the runtime's own is empty.
export const lexicon = [
  { pattern: "指节*白", hint: "套路微表情" },
  { pattern: "喉结*滚动", hint: "套路微表情" },
  { pattern: "嘴角*勾起", hint: "套路微表情" },
  { pattern: "眼底*闪过一丝", hint: "套路微表情" },
  { pattern: "不易察觉", hint: "叙述者替读者察觉" },
  { pattern: "深吸一口气", hint: "填充动作" },
  { pattern: "绷紧的弦", hint: "陈词比喻" },
  { pattern: "石子*湖", hint: "陈词比喻" },
  { pattern: "空气*凝固", hint: "陈词比喻" },
  { pattern: "漏了一拍", hint: "陈词比喻" },
  { pattern: "仿佛*静止", hint: "陈词比喻" },
  { pattern: "不是*而是", hint: "先否定再肯定的八股句式" },
]
export const player: Player = {
  writing: { pov: "second", echo: true, agency: "strict", lexicon },
  global: wuxiaPlayer.global,
  forCard: {},
  products: { options: true },
}

const cards: Record<string, () => Promise<Card>> = {
  wuxia: async () => full,
  banxing: async () => (await import("./banxing.ts")).load(),
  ri: async () => (await import("./ri.ts")).load(),
  yandao: async () => (await import("./yandao.ts")).load(),
}
export const loadCard = (name: string): Promise<Card> => {
  const load = cards[name]
  if (!load) throw new Error(`unknown card ${name}`)
  return load()
}
