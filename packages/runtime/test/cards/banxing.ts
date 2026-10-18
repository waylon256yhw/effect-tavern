// 伴星 (docs/card-reading.md §2.1): a pure-chat companion card, read from the V3 JSON export in ~/Downloads.
// What the record said each field becomes: the Note line is frame (style), the rest of the description is character,
// first_mes is the greeting node, mes_example has no slot (kept here as a character fragment labelled as示范 so the
// voice demonstration is not lost), creator_notes never enter the prompt. No numbers, actions, windows or rules.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { decodeCard } from "../../src/card.ts"

const PLAYER = "你"
const macros = (s: string, char: string) => s.replaceAll("{{user}}", PLAYER).replaceAll("{{char}}", char)

export const load = (path = join(homedir(), "Downloads", "伴星.json")) => {
  const d = (JSON.parse(readFileSync(path, "utf8")) as { data: Record<string, string> }).data
  const char = "依瑞丝" // the card's {{char}} is the work's name, not the character's (record §2.1)
  const [note, ...rest] = d.description.split("\n\n")
  return decodeCard({
    id: "banxing",
    frame: [{ id: "style", text: macros(note ?? "", char) }],
    fiction: [
      { id: "character", text: macros(rest.join("\n\n"), char) },
      { id: "examples", text: `示范（${char}的声音）：\n${macros(d.mes_example.replace(/<START>\n?/g, ""), char)}` },
    ],
    greetings: [{ text: macros(d.first_mes, char) }],
    rules: { fields: [], actions: [] },
    lore: [],
    guard: [],
  })
}

export const turns = [
  "我把游戏机放回床头柜，侧过身看着她的侧脸。“排到第几了？”",
  "“你刚才说，和我在一起也很自由。”我顿了顿，“这话是认真的吗？”",
  "我伸手把被子往她那边拉了拉，没说话，只是看着手机微光里她的手指。",
  "“那就别睡了。你想打几局，我在旁边看着。”我把可乐罐拿远了一点。",
]
