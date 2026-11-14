// The agent's reading of the shared controls (#181): the real components on a page with no server, driven through
// @ui-sdk's bridge instead of clicks. test/ui.ts builds this, serves it to headless Chrome and takes the result the
// page posts back; opened by hand, the result is `fixture.result` in the console.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { createSignal } from "solid-js"
import { ask, Confirm, dialogHandle, Menu, Modal, Prompt, Switch } from "../src/controls.tsx"
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
  for (const l of ["接口格式", "流式输出", "小剧场 · 第 1 轮", "小剧场 · 第 2 轮"])
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
