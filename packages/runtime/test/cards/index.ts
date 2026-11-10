import type { Card } from "../../src/card.ts"
import { loadCard } from "../../support/cards.ts"
export * from "../../support/cards.ts"

/** 竹林, the self-check card; `chat` is the same card with everything structured switched off: no actions, lore or
 *  director, so a turn is narrate + record only (README §2). */
export const full = await loadCard("wuxia")
const { lexicon: _lexicon, names: _names, ...bare } = full
export const chat: Card = {
  ...bare,
  rules: { fields: full.rules.fields, actions: [] },
  lore: [],
  guard: [],
  director: false,
}
