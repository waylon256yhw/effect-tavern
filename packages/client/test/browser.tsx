// Isolated UI acceptance fixture: real components, a scripted transport, no dev server or model calls.
import { render } from "@solidjs/web"
import { createSignal, Show } from "solid-js"
import { installDiagnosticsBridge } from "@solidjs/diagnostics/browser"
import { Composer } from "../src/composer.tsx"
import { Said } from "../src/App.tsx"
import { TurnRecord, StatusTable } from "../src/readings.tsx"
import { Inspect } from "../src/inspector.tsx"
import { Loading } from "solid-js"
import {
  composition,
  card,
  log,
  stories,
  registry,
  type CardView,
  updateComposition,
  error,
  dismiss,
} from "../src/store.ts"
import { locale, flip } from "../src/i18n.ts"
import { timelineNode, token } from "./fixtures.ts"
import * as L from "@effect-tavern/runtime/src/log.ts"
import "../src/app.css"

const bridge = installDiagnosticsBridge()
bridge.begin()
if (locale() !== "zh-CN") flip()
const n = {
  ...timelineNode(1, null, "正文", ""),
  input: { text: "", invoke: ["pack:p/guide"] },
  invocations: [{ ...token("pack:p/guide"), title: "细腻描写" }],
}
registry.set(log, L.of({ nodes: [n], head: 1 }))
registry.set(stories, { current: 1, stories: [] })
registry.set(card, {
  id: "fixture",
  title: "Fixture",
  lore: { entries: 0, layers: 0 },
  tokens: { head: 0 },
  director: false,
  guard: 0,
  input: "act",
  greetings: [],
  mounts: [{ id: "p", name: "叙事写作包" }],
  rules: { fields: [{ path: "hp", type: "int", min: 0, max: 100, initial: 40 }], actions: [] },
  fiction: [],
  layer: {
    snippets: [
      { name: "心声", text: "⦅", after: "⦆" },
      { name: "场外", text: "", note: true },
      { name: "继续", text: "继续" },
    ],
    format: [],
    products: [],
    names: {},
  },
} as unknown as CardView)
const requests: string[] = []
const catalog = [
  {
    resourceId: "pack:p/guide",
    title: "细腻描写",
    summary: "让动作与景物自然相连",
    source: "pack",
    category: "p",
    available: true,
  },
  ...Array.from({ length: 24 }, (_, i) => ({
    resourceId: `pack:p/item${i}`,
    title: `写作技巧 ${i}`,
    summary: `技巧说明 ${i}`,
    source: "pack",
    category: "p",
    available: true,
  })),
  {
    resourceId: "card:invoke",
    title: "查看线索",
    summary: "已经解锁的卡片功能",
    source: "card",
    category: "card",
    available: true,
  },
]
let fail = true
let sent: unknown
const detail = {
  id: 1,
  checks: [],
  deliveries: [],
  fieldChanges: [{ path: "hp", was: 40, now: 30 }],
  changes: [],
  productChanges: [],
  events: [],
  beats: [],
  brief: { must: [], may: [], tone: "" },
  products: {},
}
const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  requests.push(url)
  if (url.includes("/context?"))
    return Response.json({
      worldState: { fields: { hp: 30 }, world: {}, lore: {} },
      products: {},
      playerCatalog: catalog,
    })
  if (url.endsWith("/detail")) return Response.json(detail)
  if (url.endsWith("/trace"))
    return Response.json([
      {
        kind: "call",
        phase: "record",
        msgs: [{ role: "system", content: "fixture" }],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        ms: 20,
        out: {
          status: "completed",
          budget: { maxSteps: 3 },
          trace: [
            {
              index: 0,
              messages: [],
              finishReason: "tool-calls",
              calls: [
                {
                  toolCallId: "t1",
                  name: "patch_people",
                  input: { entityId: "e1", patch: { stance: "ready" } },
                  result: { ok: false, code: "missing", message: "Unknown entity" },
                  replayed: false,
                  ms: 1,
                },
              ],
            },
          ],
        },
      },
    ])
  if (url.endsWith("/stories")) return Response.json({ current: 1, stories: [] })
  if (init?.method === "POST") {
    if (typeof init.body !== "string") throw new Error("expected JSON body")
    sent = JSON.parse(init.body)
    return new Response(
      fail
        ? 'event: error\ndata: {"message":"fixture failure"}\n\n'
        : `event: change\ndata: ${JSON.stringify({ kind: "change", node: n, head: 1 })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )
  }
  throw new Error(`unexpected ${url}`)
}
globalThis.fetch = Object.assign(fakeFetch, { preconnect: () => {} })
const [panel, setPanel] = createSignal(location.hash.slice(1) || "composer")
Object.assign(globalThis, {
  fixture: {
    bridge,
    requests,
    get sent() {
      return sent
    },
    get draft() {
      return registry.get(composition)
    },
    get error() {
      return registry.get(error)
    },
    panel: setPanel,
    fail: (v: boolean) => {
      fail = v
    },
    clear: () => {
      dismiss()
      updateComposition({ text: "", note: "", invocations: [], noteOpen: false })
    },
  },
})
render(
  () => (
    <div
      class="frame"
      style={{
        position: "relative",
        height: "100vh",
        width: "min(760px, 100vw)",
        margin: "auto",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      <div style={{ padding: "24px", flex: "1" }}>
        <Said input={n.input} node={n} />
      </div>
      <Show when={panel() === "record"}>
        <TurnRecord node={n} />
      </Show>
      <Show when={panel() === "status"}>
        <Loading fallback="Loading">
          <StatusTable />
        </Loading>
      </Show>
      <Show when={panel() === "inspect"}>
        <Inspect id={1} />
      </Show>
      <Composer />
    </div>
  ),
  document.getElementById("root")!,
)
