// 青空 理 (docs/card-reading.md §2.5): the MVU example card, compiled from ~/MagVarUpdate/example into a data card.
// This is the hand-done version of the compile step: each piece of the author's scaffolding lands where the record
// said it belongs.
//   角色信息 / NPC信息 / 地点            → fiction and frame fragments, the author's YAML as prose; "你是新来的牧师" is
//                                            the frame's `persona` slot (who the player is), separate from the setting
//   变量分阶段-好感度 (six EJS bands)      → six fiction fragments with `when` on 好感度; the active band is in the head
//   理.好感度 [-30,100], 变化 [-5,8]        → an int field with bounds, moved by a readout after the prose (record stage)
//   <user>.与理的关系 (恋人 / 哥哥)         → two booleans
//   角色事件-告白 (EJS condition + override) → a lore entry whose `unlock` / `offer` is the same condition as a Cond; the
//                                            director opens it as MUST, the narrator writes it, a readout settles the
//                                            outcome (the author's version let the narrator decide too, no die)
//   greeting with _.set(...)                → the greeting node plus the field's initial value
//   时间 / 日期 / 当前所想 / 情绪 PAD        → not here: text fields and time are card.ts ceilings
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { decodeCard, type Card } from "../../src/card.ts"
import { emit } from "./index.ts"
import type { Cond } from "../../src/cond.ts"
import type { Fragment } from "../../src/fragment.ts"

const PLAYER = "你"
const strip = (s: string) =>
  s
    .replace(/<%[\s\S]*?%>/g, "")
    .replaceAll("<user>", PLAYER)
    .replaceAll("{{user}}", PLAYER)
    .trim()

/** The greeting's trailing <UpdateVariable> block, read for 好感度 and removed from the text. */
const greeting = (png: string, index: number) => {
  const b = readFileSync(png)
  let p = 8
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p)
    const type = b.toString("ascii", p + 4, p + 8)
    if (type === "tEXt") {
      const d = b.subarray(p + 8, p + 8 + len)
      const i = d.indexOf(0)
      const key = d.subarray(0, i).toString()
      if (key === "chara" || key === "ccv3") {
        const j = JSON.parse(Buffer.from(d.subarray(i + 1).toString(), "base64").toString("utf8")) as {
          data: { alternate_greetings: string[] }
        }
        const raw = j.data.alternate_greetings[index] ?? ""
        const affinity = Number(raw.match(/_\.set\("理\.好感度",\s*\d+,\s*(\d+)\)/)?.[1] ?? 0)
        const text = strip(
          raw.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/, "").replace(/<StatusPlaceHolderImpl\/>/, ""),
        )
        return { text, affinity }
      }
    }
    if (type === "IEND") break
    p += 12 + len
  }
  throw new Error("no character card in png")
}

/** 变量分阶段-好感度: `<% if (好感度 >= lo && 好感度 < hi) { %> … <% } %>` blocks → fragments with `when`. */
const bands = (md: string): Fragment[] => {
  const re =
    /<% if \(getvar\("stat_data"\)\.理\["好感度"\]\[0\] >= (-?\d+)(?: && getvar\("stat_data"\)\.理\["好感度"\]\[0\] < (-?\d+))?\) \{ %>([\s\S]*?)<% \} %>/g
  const out: Fragment[] = []
  for (const m of md.matchAll(re)) {
    const lo = Number(m[1])
    const hi = m[2] === undefined ? undefined : Number(m[2])
    const when: Cond =
      hi === undefined
        ? { path: "好感度", op: "gte", value: lo }
        : {
            all: [
              { path: "好感度", op: "gte", value: lo },
              { path: "好感度", op: "lt", value: hi },
            ],
          }
    out.push({
      id: `band-${lo}`,
      label: hi === undefined ? `理（好感 ${lo}+）` : `理（好感 ${lo}–${hi}）`,
      text: `<relationship_ri_with_user>\n理:\n${strip(m[3]!)}\n</relationship_ri_with_user>`,
      when,
    })
  }
  return out
}

export const load = (dir = join(homedir(), "MagVarUpdate", "example"), greetingIndex = 2): Card => {
  const src = (f: string) => readFileSync(join(dir, "理理", f), "utf8")
  const init = JSON.parse(src("[initvar]初始变量1.yaml")) as { 地点: Record<string, Record<string, string>> }
  const places = Object.entries(init.地点)
    .map(
      ([name, d]) =>
        `${name}：${["desc1", "desc2", "desc3", "desc4"]
          .map((k) => d[k])
          .filter(Boolean)
          .join("")}`,
    )
    .join("\n")
  const g = greeting(join(dir, "artifact", "青空 理.png"), greetingIndex)
  const confession: Cond = {
    all: [
      { path: "好感度", op: "gte", value: 60 },
      { path: "恋人", is: false },
      { path: "哥哥", is: false },
    ],
  }
  return decodeCard({
    id: "ri",
    title: "理",
    summary: "一对一：青空理，小镇教堂的圣女；好感度随每一幕的相处变化，理的态度随之分段。",
    frame: [
      { id: "persona", text: "你是新来到小镇的牧师。" },
      { id: "setting", text: `小镇的地点：\n${places}` },
      { id: "npc", text: strip(src("npc信息.yaml")) },
    ],
    fiction: [{ id: "ri", label: "理", text: strip(src("角色信息.yaml")) }, ...bands(src("变量分阶段-好感度.md"))],
    greetings: [{ text: g.text }], // ponytail: the greeting index is picked at load; the other openings' affinities would be `do` effects
    guard: [],
    director: true,
    rules: {
      fields: [
        { path: "好感度", type: "int", min: -30, max: 100, initial: g.affinity },
        { path: "恋人", type: "boolean", initial: false, hidden: true }, // ending switches: not on the status table or the card page
        { path: "哥哥", type: "boolean", initial: false, hidden: true },
      ],
      actions: [],
      readouts: [
        {
          id: "affinity",
          text: "这一幕里，理对你的好感怎么变了（变化范围 -5 到 +8）",
          options: [
            { id: "cold", text: "明显疏远", do: [{ path: "好感度", add: -5 }] },
            { id: "cool", text: "略微冷淡", do: [{ path: "好感度", add: -2 }] },
            { id: "flat", text: "没有变化", do: [] },
            { id: "warm", text: "略微拉近", do: [{ path: "好感度", add: 3 }] },
            { id: "warmer", text: "明显拉近", do: [{ path: "好感度", add: 5 }] },
            { id: "moved", text: "心动", do: [{ path: "好感度", add: 8 }] },
          ],
        },
        {
          id: "confession",
          text: "如果这一幕里理向你告白了，结果如何",
          when: confession,
          options: [
            { id: "none", text: "这一幕没有告白", do: [] },
            {
              id: "accepted",
              text: "你接受了，两人成为恋人",
              do: [{ path: "恋人", set: true }, { event: "告白:成功" }],
            },
            {
              id: "refused",
              text: "你没有接受，理说以后把你当作哥哥吧",
              do: [{ path: "哥哥", set: true }, { event: "告白:失败" }],
            },
          ],
        },
      ],
    },
    lore: [
      {
        id: "kokuhaku",
        // Windows only deepen what is visible (lore.ts): layer 1 is the readable set-up, layer 2 the event itself,
        // offered as a window when the condition holds, so it reaches the narrator through the director as MUST.
        layers: [
          "理最近有心事：常常绞着胸前的吊坠出神，话到嘴边又咽回去。",
          "理会立刻寻找合适的场合，向你告白。成功后她会表现得很开心；失败时，她会说以后就把你一直当作哥哥吧，并为此暗暗感到痛苦。",
        ],
        unlock: { all: [] },
        offer: confession,
      },
    ],
  })
}

export const turns = [
  "我放下手里的圣经，看着她。“理，你今天好像有话想说。不急，慢慢说。”",
  "我沉默了片刻，然后轻轻握住她绞着吊坠的手。“我听到了。我也一样。”",
  "“罗伦斯大人要是知道了，会怎么说？”我笑着问她，顺手替她理了理头纱。",
  "“今天的礼拜，我们一起主持吧。你选诗篇。”",
]

// `bun test/cards/ri.ts`: the converted card as YAML under .dev/, for the toolchain to read like any other card
if (import.meta.main) emit(load())
