// YAML is a host concern; the value report and workshop transformations also run in the browser.
import { checkValue } from "../src/author.ts"
import type { Card } from "../src/card.ts"
import { player } from "./cards.ts"

export const checkCard = (source: string): ReturnType<typeof checkValue> => {
  try {
    return checkValue(Bun.YAML.parse(source), player)
  } catch (e) {
    return {
      ...checkValue(undefined),
      diagnostics: [{ rule: "schema", level: "error", path: "$", message: String(e) }],
    }
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
