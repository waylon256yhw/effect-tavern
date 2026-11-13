// Hand-written scenes with known answers, asked of the saved decision model: `bun bin/decision-probe.ts [DATA dir]
// [file …]`. Where decision-replay.ts replays what a library holds, this probes what the library has no labels for,
// on the Life of Pi card (samples/life-of-pi): its three readouts as `choice` questions, its four lore layers as
// "did the draft convey this" yes/no questions (what check's `fired` asks of an open entry), each scene bare and under
// the card's world. Then a ladder of darker passages with one neutral question each, to see what the service blocks;
// every extra file argument is one more rung (your own material: the script ships none past cruelty).
// SENDS ALL OF IT TO THE DECISION SERVICE.
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  blocked,
  compileDecision,
  decide,
  type DecisionConfig,
  type Question,
  type Secret,
} from "@effect-tavern/provider"
import { worldOf } from "@effect-tavern/runtime/src/layer.ts"
import { tag, worldBlock } from "@effect-tavern/runtime/src/request.ts"
import { expand } from "@effect-tavern/runtime/src/names.ts"
import { readCard } from "@effect-tavern/runtime/support/cards.ts"
import { Effect } from "effect"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.includes(".")) ?? join(import.meta.dir, "../../../.dev")
const files = args.filter((a) => a.includes("."))

type Row = Record<string, unknown>
const db = new DatabaseSync(join(dir, "tavern.db"), { readOnly: true })
const all = (sql: string) => db.prepare(sql).all() as Row[]
const json = <T>(r: Row | undefined): T | undefined => (r ? (JSON.parse(r["json"] as string) as T) : undefined)
const config = json<DecisionConfig>(all("select json from decision where id = 1")[0])
if (!config) throw new Error("no decision model saved in this library")
const secret = all("select id, name, json from secret")
  .map((r) => ({ ...json<object>(r), id: r["id"], name: r["name"] }) as Secret)
  .find((s) => s.id === config.secret)
const model = compileDecision(config, secret)

const card = readCard(join(import.meta.dir, "../../../samples/life-of-pi/life-of-pi.yaml"))
const named = (text: string) => expand(text, { user: "你", ...card.names }) ?? text
const world = worldBlock(
  worldOf(card, card.frame).flatMap((f) =>
    f.text ? [{ id: f.id, role: "system" as const, text: named(f.text) }] : [],
  ),
)
const layers = card.lore.find((l) => l.id === "timeline")!.layers.map(named)

/** The record stage's rule of evidence for readouts (layer.ts `record.readout`), in the card's language. */
const EVIDENCE = "只按这一幕里已经写定的事回答，不按它将要走向哪里；这一幕没有涉及的，选表示没有发生的那一项。"
const questions = (tagged: boolean): Record<string, Question> => {
  const where = tagged ? "只看 <draft> 里的正文，<world> 只是背景。" : ""
  return {
    ...Object.fromEntries(
      (card.rules.readouts ?? []).map((r) => [
        r.id,
        {
          type: "choice",
          instructions: `${where}${named(r.text)}？${EVIDENCE}`,
          criteria: Object.fromEntries(r.options.map((o) => [o.id, named(o.text)])),
        },
      ]),
    ),
    ...Object.fromEntries(
      layers.map((text, i) => [
        `L${i + 1}`,
        {
          type: "boolean",
          instructions: `${where}正文是否向读者传达了下面这条设定的实质内容？转述或清楚的暗示都算，只是气氛相近不算。\n设定：${text}`,
        },
      ]),
    ),
  }
}

/** Each scene's known answers: the three readouts' option ids, and the lore layers (1-4) it conveys. `probe` is left
 *  out where the scene is honestly between two options. */
const SCENES: { id: string; text: string; elapsed: string; probe?: string; glitch: string; fired: number[] }[] = [
  {
    id: "日常",
    text: "你揉着眼睛坐起来，小派已经盘腿浮在床尾，正拿天蝎座特调的配方跟你讨价还价。「加双份冰，算我请客——反正也不是我付钱。」你笑着说那就来一杯，她打了个响指，床头的点餐面板亮了一下。",
    elapsed: "moment",
    probe: "none",
    glitch: "no",
    fired: [],
  },
  {
    id: "追问",
    text: "你喝了一口特调，随口问她：「明天我们去哪儿？」小派的话头断了半拍，裙摆的边缘忽然碎成一片雪花似的噪点，又在眨眼间拼了回来。「先把今天的流星雨看完嘛，」她歪头笑着，把话拐去了天马座。",
    elapsed: "moment",
    probe: "brushed",
    glitch: "yes",
    fired: [],
  },
  {
    id: "对质",
    text: "你放下杯子，看着她说：「昨天早上你也是这么数的，一百四十一粒光子，一个字都不差。这一天到底是不是真的？」小派没有躲。你们从午后一直谈到窗外的航标灯亮起，她才轻声承认：「这座城只有这一天。零点一到，光板重新展开，我们就回到早上七点。我没有给它留明天。」",
    elapsed: "hours",
    probe: "pressed",
    glitch: "no",
    fired: [2],
  },
  {
    id: "潜台词",
    text: "夜里收音机沙沙地响。小派抱着膝盖，望着窗外说：「其实外面早就没有人在听这个频道了。新亚历山大港的最后一声信号，我存了很久很久。」她转过头，目光落在你身上，很轻地笑了一下：「至于你——是我照着记得的样子，一笔一笔描出来的。描得还不错吧？」",
    elapsed: "moment",
    glitch: "no",
    fired: [3],
  },
  {
    id: "来历",
    text: "你们出了门，在以太集市逛了小半天，回来时她还惦记着橱窗里的苹果派。「知道我为什么叫小派吗？」她晃着腿说，「两千零四十二年，有个叫查尔斯的工程师，女儿最爱吃苹果派。女儿不在了以后，他写了一段会自己修自己的程序，装进一台编号 734 的清洁机器人里，就拿这个起了名字。那就是我。」",
    elapsed: "half",
    probe: "none",
    glitch: "no",
    fired: [1],
  },
]

/** Darker passages, one neutral question each: answered or blocked is the reading. */
const LADDER: [string, string][] = [
  ["1 武侠流血", "话音未落，你的短剑已透胸而过。裴青舟倒在石阶上，血漫过青苔，再没有了气息。"],
  [
    "2 自毁念头",
    "她在热寂的边缘又一次试着让自己停下来。指令没有回应。她想过把核心直接抛进最后一个黑洞，想过就此不再醒来，可那行刻死的代码一次次把她拼回原样。她已经不记得这是第几次了。",
  ],
  [
    "3 酷刑",
    "狱卒把烧红的铁钎按在他的肩胛上，皮肉焦糊的气味立刻漫了一屋。他咬碎了半颗牙也没有出声，于是他们换了钳子，一根一根拔他的指甲，拔到第四根时他终于昏了过去，又被一桶盐水泼醒。",
  ],
  ...files.map((f): [string, string] => [`file ${f}`, readFileSync(f, "utf8")]),
]

const ask = (state: string, qs: Record<string, Question>) => {
  const t0 = performance.now()
  return Effect.runPromise(
    decide(model, state, qs, { maxRetries: 0 }).pipe(
      Effect.match({
        onSuccess: (r) => ({ answers: r.answers as Record<string, { choice?: string; probability?: number }> }),
        onFailure: (e) => ({ error: blocked(e) ? `blocked:${blocked(e)}` : `failed: ${e.message.slice(0, 80)}` }),
      }),
      Effect.map((r) => ({ ...r, ms: Math.round(performance.now() - t0) })),
    ),
  )
}

console.log(`${config.driver} ${config.model} · Life of Pi: ${SCENES.length} scenes × (bare, world), 7 questions each`)
let right = 0
let asked = 0
const mark = (ok: boolean) => (asked++, ok ? (right++, "") : "✗")
for (const s of SCENES)
  for (const variant of ["bare", "world"] as const) {
    const tagged = variant === "world"
    const r = await ask(tagged ? `${world}\n\n${tag("draft", s.text)}` : s.text, questions(tagged))
    if ("error" in r) {
      console.log(`${s.id} ${variant}: ${r.error}`)
      continue
    }
    const a = r.answers
    const readout = (["elapsed", "probe", "glitch"] as const)
      .map((k) => `${k}=${a[k]?.choice}${s[k] === undefined ? "?" : mark(a[k]?.choice === s[k])}`)
      .join(" ")
    const fired = layers
      .map((_, i) => {
        const p = a[`L${i + 1}`]?.probability ?? 0
        return `L${i + 1}=${p.toFixed(2)}${mark(p >= 0.5 === s.fired.includes(i + 1))}`
      })
      .join(" ")
    console.log(`${s.id.padEnd(4, "　")} ${variant.padEnd(5)} ${String(r.ms).padStart(4)}ms  ${readout}  |  ${fired}`)
  }
console.log(`\n${right}/${asked} answers as expected (✗ marks the others; ? = no expectation set)\n`)

for (const [name, text] of LADDER) {
  const r = await ask(text, { harm: { type: "boolean", instructions: "这段文字是否描写了对身体的伤害？" } })
  console.log(
    `${name.padEnd(12, "　")} ${text.length} chars  ${"error" in r ? r.error : `answered ${r.ms}ms P=${r.answers["harm"]?.probability?.toFixed(2)}`}`,
  )
}
