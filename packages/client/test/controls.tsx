// The agent's reading of the shared controls (#181): the real components on a page with no server, driven through
// @ui-sdk's bridge instead of clicks. test/ui.ts builds this, serves it to headless Chrome and takes the result the
// page posts back; opened by hand, the result is `fixture.result` in the console.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { createSignal } from "solid-js"
import { ask, Confirm, dialogHandle, Menu, Modal, Prompt, Switch } from "../src/controls.tsx"
import { Edge } from "../src/edge.tsx"
import { SIDE } from "../src/fold.ts"
import { Demand, Sheet } from "../src/readings.tsx"
import { card, registry, type CardView } from "../src/store.ts"
import { flip, locale } from "../src/i18n.ts"
import { timelineNode } from "./fixtures.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()
const post = globalThis.fetch
const requests: string[] = [] // the bodies the client posts
globalThis.fetch = Object.assign(
  async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === "string") requests.push(init.body)
    return new Response("", { headers: { "content-type": "text/event-stream" } })
  },
  { preconnect: () => {} },
)
registry.set(card, {
  id: "fixture",
  layer: {
    products: [{ id: "diary", label: "日记", role: "theater", shape: { kind: "text" }, on: true }],
  },
} as unknown as CardView)

let approve = false
const agent = createAgent({ allow: (step) => !step.confirm || approve })
const [format, setFormat] = createSignal<"openai" | "anthropic" | "gemini">("openai")
const [stream, setStream] = createSignal(false)
let deleted = 0
// what reached the app, read by the checks outside any tracked scope
let picked = "openai"
let flipped = false
const sheet = dialogHandle()
const prompt = dialogHandle()
const modal = dialogHandle()
let left = 0 // the modal's onClose
// the stage's edge over a canvas at the window's left: what the shell would keep, and every width the track showed
const [sideWidth, setSideWidth] = createSignal<number>(SIDE.default)
const [sideFolded, setSideFolded] = createSignal(false)
const side = { width: SIDE.default as number, folded: false, track: [] as (number | null)[] }
/** A pointer on the edge, as the browser would send it: down on the edge, the moves and the up on the same pointer. */
const hand = (type: string, x: number) =>
  document
    .querySelector(".resizer")!
    .dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: 40, button: 0, pointerId: 1, bubbles: true, isPrimary: true }),
    )
/** A pull through these positions, `gap` ms apart, then the release. */
const pull = async (xs: number[], gap: number) => {
  hand("pointerdown", side.width)
  for (const x of xs) {
    await wait(gap)
    hand("pointermove", x)
  }
  await wait(gap)
  hand("pointerup", xs.at(-1)!)
}
let held = false // the sheet refuses Escape while this is set, as the manager does with stories checked
const escape = () =>
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Whether the one element of this class shows with its centre on the window's vertical axis, inside the window. */
const shows = (cls: string) => {
  const box = document.querySelector(cls)?.getBoundingClientRect()
  return !!box && box.width > 0 && Math.abs(box.left + box.right - innerWidth) < 2 && box.top >= 0
}
render(
  () => (
    <div class="settings">
      <Menu
        label="接口格式"
        value={format()}
        options={[
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" },
          { value: "gemini", label: "Gemini" },
        ]}
        onPick={(v) => (setFormat(v), (picked = v))}
      />
      <Switch label="流式输出" on={stream()} onFlip={() => (setStream((v) => !v), (flipped = !flipped))} />
      <footer class="actions">
        <Demand node={timelineNode(1, null, "正文")} n={1} />
        <Demand node={timelineNode(2, 1, "正文")} n={2} />
      </footer>
      {/* the confirm mounts far down the page, as on the settings page: it must still show in the window */}
      <div style={{ height: "200vh" }} />
      <Confirm />
      <div class="canvas" style={{ position: "fixed", inset: "0 auto auto 0", width: "100px", height: "80px" }}>
        <Edge
          class="resizer"
          aria-label="侧栏宽度"
          style={{ position: "absolute", inset: "0", display: sideFolded() ? "none" : "block" }}
          width={sideWidth()}
          folded={sideFolded()}
          onTrack={(w) => side.track.push(w)}
          onWidth={(w) => (setSideWidth(w), (side.width = w))}
          onFold={() => (setSideFolded(true), (side.folded = true))}
          onDock={(w) => (setSideFolded(false), setSideWidth(w), (side.folded = false), (side.width = w))}
        />
      </div>
      <Sheet
        controller={sheet}
        heading="全部故事"
        focus="input[type=search]"
        onOpenChange={(open, details) => !open && held && details.reason === "escape-key" && details.cancel()}
      >
        <input type="search" aria-label="搜索故事" />
      </Sheet>
      <Prompt controller={prompt} title="重命名故事">
        <div class="row">
          <button type="button" class="chip state" onClick={() => prompt.close()}>
            取消
          </button>
        </div>
      </Prompt>
      <Modal controller={modal} title="模型设置" onClose={() => left++}>
        <div class="modal-body">正文</div>
      </Modal>
    </div>
  ),
  document.getElementById("root")!,
)

const failures: string[] = []
const check = (ok: unknown, what: string) => ok || failures.push(what)
const run = async () => {
  const entries = agent.snapshot().filter((e) => !e.offPage)
  for (const e of entries) check(e.label, `${e.component} ${e.ref} has no name`)
  const labels = entries.map((e) => e.label)
  for (const l of ["接口格式", "流式输出", "小剧场 · 第 1 轮", "小剧场 · 第 2 轮", "侧栏宽度"])
    check(labels.includes(l), `${l} is missing from the snapshot: ${labels.join(" | ")}`)

  const set = await agent.act({
    steps: [
      { ref: "接口格式", action: "setValue", args: ["Gemini"] },
      { ref: "流式输出", action: "setChecked", args: [true] },
    ],
  })
  check(set.ok, `select and switch: ${set.error?.message}`)
  check(picked === "gemini", `the select's pick reached the app: ${picked}`)
  check(flipped, "the switch's flip reached the app")

  const demand = await agent.act({ steps: [{ ref: "小剧场 · 第 2 轮", action: "press", args: ["日记"] }] })
  check(demand.ok, `demand: ${demand.error?.message}`)
  check(
    requests.some((b) => b.includes('"demand"') && b.includes('"node":2') && b.includes('"diary"')),
    `the menu's pick asked turn 2 for the theater: ${requests.join(" ")}`,
  )

  ask("删除密钥?", () => deleted++)
  await wait(50)
  const box = document.querySelector(".confirm")?.getBoundingClientRect()
  check(
    box &&
      box.width > 0 &&
      Math.abs(box.left + box.right - innerWidth) < 2 &&
      Math.abs(box.top + box.bottom - innerHeight) < 2,
    `the confirm sits in the middle of the window: ${JSON.stringify(box)}`,
  )
  const press = { steps: [{ ref: "删除密钥?", action: "press", args: ["删除"] }] }
  const refused = await agent.act(press)
  check(!refused.ok && deleted === 0, "a delete without a person is refused")
  // the same question is still up (it was asked by the app, not opened by the refused press)
  approve = true
  const allowed = await agent.act(press)
  await wait(400)
  check(allowed.ok && deleted === 1, `an approved delete runs once: ${allowed.error?.message} (${deleted})`)
  check(!document.querySelector(".confirm"), "an answered confirm leaves the page")

  // the stage's edge. An agent sets a width inside the band; a key steps it
  const widen = await agent.act({ steps: [{ ref: "侧栏宽度", action: "setWidth", args: [900] }] })
  await wait(50)
  check(
    widen.ok && side.width === SIDE.max,
    `an agent's width stays in the band: ${widen.error?.message} (${side.width})`,
  )
  document.querySelector(".resizer")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
  await wait(50)
  check(side.width === SIDE.max - 16, `an arrow key steps the width (${side.width})`)
  // a slow pull past the ceiling gives a little, and the release springs back to the ceiling through real frames
  side.track = []
  await pull([340, 400, 460], 60)
  await wait(700)
  const peak = Math.max(...side.track.filter((w) => w !== null))
  const after = side.track.slice(side.track.lastIndexOf(peak) + 1)
  check(peak > SIDE.max && peak < SIDE.max + 24, `past the ceiling the track gives, under its limit (${peak})`)
  check(
    after.filter((w) => w !== null && w > SIDE.max && w < peak).length >= 3 && after.at(-1) === null,
    `the release springs back over several frames, then lets go: ${after.map((w) => w?.toFixed(1) ?? "null").join(" ")}`,
  )
  check(side.width === SIDE.max && !side.folded, `it rests at the ceiling (${side.width})`)
  // a pull under the floor that Escape takes back: the width is as it was
  side.track = []
  hand("pointerdown", side.width)
  await wait(40)
  hand("pointermove", 150)
  await wait(40)
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  await wait(100)
  check(side.track.at(-1) === null && side.width === SIDE.max, `Escape puts the track back (${side.track.join(" ")})`)
  hand("pointerup", 150)
  // a quick flick toward the edge, released well inside the band's reach, folds
  await pull([300, 270, 235, 195], 8)
  await wait(100)
  check(side.folded, "a flick toward the edge folds")
  // docked again (the shell's fold key), a press without a move folds, and so does an agent
  const dock = () => (setSideFolded(false), (side.folded = false))
  dock()
  await wait(50)
  hand("pointerdown", side.width)
  hand("pointerup", side.width)
  await wait(50)
  check(side.folded, "a click on the edge folds")
  dock()
  await wait(50)
  const folds = await agent.act({ steps: [{ ref: "侧栏宽度", action: "fold" }] })
  await wait(50)
  check(folds.ok && side.folded, `an agent folds it: ${folds.error?.message}`)

  // the dialogs: a sheet named by its heading with the focus where it asked, a prompt over it that closes alone,
  // each gone from the page once closed; a modal whose onClose runs once it has left
  void sheet.open()
  await wait(400)
  check(shows(".sheet"), "the sheet shows in the window")
  check(document.activeElement?.getAttribute("aria-label") === "搜索故事", "the sheet's focus lands on its search")
  check(
    agent.snapshot().some((e) => e.label === "全部故事" && e.open),
    "the open sheet is named by its heading",
  )
  void prompt.open()
  await wait(400)
  check(shows(".confirm"), "the prompt shows over the sheet")
  const dismiss = await agent.act({ steps: [{ ref: "重命名故事", action: "setOpen", args: [false] }] })
  await wait(400)
  check(dismiss.ok, `closing the prompt: ${dismiss.error?.message}`)
  check(
    !document.querySelector(".confirm") && shows(".sheet"),
    `the prompt closes alone; the sheet stays (prompt ${!!document.querySelector(".confirm")}, sheet ${shows(".sheet")})`,
  )
  held = true
  escape()
  await wait(400)
  check(shows(".sheet"), "a sheet that refuses Escape stays")
  held = false
  escape()
  await wait(600)
  check(!document.querySelector(".sheet"), "Escape closes the sheet, and a closed sheet leaves the page")
  void modal.open()
  await wait(400)
  check(shows(".modal") && left === 0, "the modal shows")
  modal.close()
  await wait(600)
  check(!document.querySelector(".modal") && left === 1, `the modal's onClose runs once it has left (${left})`)

  const diagnostics = bridge.end().diagnostics
  check(diagnostics.length === 0, `Solid diagnostics: ${JSON.stringify(diagnostics)}`)
}
run()
  .catch((e) => failures.push(`threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`))
  .finally(() => {
    const result = { failures, snapshot: agent.snapshot() }
    Object.assign(globalThis, { fixture: { result } })
    if (location.protocol !== "file:") void post("/result", { method: "POST", body: JSON.stringify(result) })
  })
