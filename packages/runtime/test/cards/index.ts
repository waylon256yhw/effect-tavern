/// <reference types="bun" />
// The four template cards by name, and the player layers the live scripts, the tests and the server share. A card is one
// YAML file in this directory (`<name>.yaml`, prose in block scalars), parsed by Bun and decoded by `decodeCard`; ri is a
// converter over third-party files (`bun test/cards/ri.ts` writes the converted card to .dev/ri.yaml).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { decodeCard, type Card } from "../../src/card.ts"
import { decodeFragments as frags, type Player } from "../../src/fragment.ts"

// a compiled binary (server `bun run compile`) embeds this directory as cards/ beside its entry
const dir = new URL(import.meta.url.includes("$bunfs") ? "cards/" : "./", import.meta.url)
/** A card file: YAML, decoded through the Card schema. A missing file fails naming it (ENOENT, with the path). */
export const readCard = (path: string | URL): Card => decodeCard(Bun.YAML.parse(readFileSync(path, "utf8")))
/** A converter's card written as YAML to .dev/<id>.yaml at the repo root, where the toolchain reads it like any card. */
export const emit = (card: Card) => {
  const out = new URL(`../../../../.dev/${card.id}.yaml`, import.meta.url)
  mkdirSync(new URL(".", out), { recursive: true })
  writeFileSync(out, Bun.YAML.stringify(card, null, 2))
  console.log(fileURLToPath(out))
}

// The test player: language only, options on (the card declares nothing about options).
export const plain: Player = {
  global: frags([{ id: "language", text: "使用自然、舒展的现代中文写作。" }]),
  forCard: {},
  products: { options: true },
}

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
  global: plain.global,
  forCard: {},
  products: { options: true },
}

const converters: Record<string, () => Promise<Card>> = {
  ri: async () => (await import("./ri.ts")).load(),
}
export const cardNames = ["wuxia", "yandao", "banxing", ...Object.keys(converters)]
export const loadCard = async (name: string): Promise<Card> =>
  converters[name] ? converters[name]() : readCard(new URL(`${name}.yaml`, dir))

/** 竹林, the self-check card; `chat` is the same card with everything structured switched off: no actions, lore or
 *  director, so a turn is narrate + record only (README §2). */
export const full = readCard(new URL("wuxia.yaml", dir))
export const chat: Card = {
  ...full,
  rules: { fields: full.rules.fields, actions: [] },
  lore: [],
  guard: [],
  director: false,
}
