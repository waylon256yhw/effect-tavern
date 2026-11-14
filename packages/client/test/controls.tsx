// The agent's reading of the shared controls (#181): the real components on a page with no server, driven through
// @ui-sdk's bridge instead of clicks. test/ui.ts builds this, serves it to headless Chrome and takes the result the
// page posts back; opened by hand, the result is `fixture.result` in the console.
import { render } from "@solidjs/web"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { createAgent } from "@ui-sdk/solid/agent"
import { createSignal } from "solid-js"
import { ask, Confirm, Menu, Switch } from "../src/controls.tsx"
import { Demand } from "../src/readings.tsx"
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
  await new Promise((r) => setTimeout(r, 50))
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
  approve = true
  ask("删除密钥?", () => deleted++)
  await new Promise((r) => setTimeout(r, 50))
  const allowed = await agent.act(press)
  await new Promise((r) => setTimeout(r, 50))
  check(allowed.ok && deleted === 1, `an approved delete runs once: ${allowed.error?.message} (${deleted})`)

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
