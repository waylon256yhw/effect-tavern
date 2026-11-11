import { validateCard } from "../src/author.ts"
// Host-side authoring: decode failures and semantic diagnostics share one report.
import { drawn, type Card } from "../src/card.ts"
import { type Diagnostic } from "../src/lint.ts"
import { fields, openings, view } from "../src/view.ts"
import { player } from "./cards.ts"

export const checkCard = (source: string) => {
  const diagnostics: Diagnostic[] = []
  let card: Card | undefined
  let preview: ReturnType<typeof view> | undefined
  let greetings: string[] = []
  try {
    const checked = validateCard(Bun.YAML.parse(source))
    card = checked.card
    diagnostics.push(...checked.diagnostics)
    if (card && !diagnostics.some((d) => d.level === "error")) {
      preview = view(card, player)
      greetings = openings(card, player)
    }
  } catch (e) {
    diagnostics.push({ rule: "schema", level: "error", path: "$", message: String(e) })
  }

  return {
    diagnostics,
    fields:
      card?.rules.fields.map((f) => ({
        ...f,
        drawn: drawn(
          f,
          card!.fiction.map((f) => f.when),
        ),
      })) ?? [],
    fieldLines: card ? fields(card) : [],
    greetings,
    sections: preview?.sections ?? [],
    total: preview?.total ?? 0,
  }
}

export const templates = ["chat", "readout", "rpg", "world"] as const
export const scaffold = (id: string, template: (typeof templates)[number]) => {
  if (!/^[\p{L}\p{N}_-]+$/u.test(id)) throw new Error("id must contain only letters, numbers, _ or -")
  const persona = template === "chat" || template === "readout"
  const card: Card = {
    id,
    title: id,
    input: template === "readout" || template === "world" ? "note" : "act",
    frame: persona ? [{ id: "persona", text: "{{user}}是来到此地的旅人。" }] : [],
    fiction: [{ id: "setting", text: "雨停了，门外传来脚步声。" }],
    greetings: [{ text: "门被轻轻推开。" }],
    rules: { fields: [], actions: [] },
    lore: [],
    guard: [],
  }
  return `# ${template}: persona=${persona}, input=${card.input}\n# frame: 玩家身份与叙事约定；fiction: 世界、人物与条件变体。\n# rules: 声明字段与动作；lore: 分层知识；guard: 叙事约束。\n# greetings[].do 可设置开场状态。使用 card check / view / test 验证。\n${Bun.YAML.stringify(card)}`
}
