// The installation gate over a value, shared by hosts and authoring tools. No rendering or platform IO.
import { decodeCard, makeCard, type Card } from "./card.ts"
import { resolve } from "./layer.ts"
import { lint, type Diagnostic } from "./lint.ts"
import { initialWorld } from "./world.ts"

export const validateCard = (value: unknown): { card?: Card; diagnostics: Diagnostic[] } => {
  let card: Card | undefined
  const diagnostics: Diagnostic[] = []
  try {
    card = decodeCard(value)
    const rpg = makeCard(card.rules)
    rpg.validate(rpg.initial)
    initialWorld(resolve(card, {}).products)
    diagnostics.push(...lint(card))
  } catch (e) {
    diagnostics.push({ rule: "schema", level: "error", path: "$", message: String(e) })
  }
  return { card, diagnostics }
}
