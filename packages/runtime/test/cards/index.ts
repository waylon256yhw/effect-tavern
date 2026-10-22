// The four template cards by name, and the player layer the live scripts and the server share.
import type { Card } from "../../src/card.ts"
import type { Player } from "../../src/fragment.ts"
import { full, player as wuxiaPlayer } from "./wuxia.ts"

// The player layer: language, and the point-of-view slot every player sets once. Without the second, Haiku wrote the
// player's answer to the confession for them (docs/provider-reading.md §10). A card with no player in the fiction
// (yandao) fills the same slot itself; the player's global `pov` yields to it (fragment.ts defaults).
export const player: Player = {
  global: [
    ...wuxiaPlayer.global,
    { id: "pov", text: "用第二人称写玩家。玩家只做输入里做的事、只说输入里说的话；不替玩家说话，不替玩家做决定。" },
  ],
  forCard: {},
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
