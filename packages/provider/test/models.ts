// listModels offline, on CopilotKit's aimock with provider-native model catalogs and the required-header policy: each
// format's auth table and list parser against the shape that provider answers (Anthropic `data[].id`, which needs
// `anthropic-version`; Gemini `models[].name` with its `models/` prefix; OpenAI `data[].id`), and a request without the
// version header refused as Anthropic refuses it. Then the shapes no provider mock has: a gateway's
// `supported_endpoints`, a 2xx that is no listing, a fetch that throws.
import { LLMock } from "@copilotkit/aimock"
import assert from "node:assert/strict"
import { listModels, type Connection, type Listed, type Trace } from "../src/connection.ts"
import type { Format } from "../src/url.ts"

const ids = ["claude-haiku-5-5", "gemini-2.5-flash", "gpt-5"]
const mock = new LLMock({ port: 0, policy: { requiredHeaders: "enforce", modelCatalog: "native" } })
for (const model of ids) mock.on({ model }, { content: "ok" })
await mock.start()
try {
  const conn = (format: Format): Connection => ({
    id: format,
    format,
    endpoint: { url: mock.url, resolution: "format-default" },
    credential: { type: "api_key", key: "test-key" },
    model: "",
  })
  // each native catalog lists its own family; the OpenAI list is every fixture model; no native catalog says formats
  const id = (m: Listed) => m.id
  assert.deepEqual(await listModels(conn("anthropic")), [{ id: "claude-haiku-5-5" }])
  assert.deepEqual(await listModels(conn("gemini")), [{ id: "gemini-2.5-flash" }])
  assert.deepEqual((await listModels(conn("openai-compatible"))).map(id).toSorted(), ids)
  const bare: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete("anthropic-version")
    return fetch(input, { ...init, headers })
  }
  await assert.rejects(listModels(conn("anthropic"), { fetch: bare }), /model listing failed: HTTP 400/)

  // a gateway's listing says where each model is served (CommandCode's `supported_endpoints`): the formats whose
  // operation path it names, in RULES order; a path of no format (`/responses`) is dropped, an empty list stays empty
  const gateway: typeof fetch = async () =>
    Response.json({
      data: [
        { id: "claude-x", supported_endpoints: ["/messages"] },
        { id: "gpt-x", supported_endpoints: ["/chat/completions", "/responses"] },
        { id: "both", supported_endpoints: ["/chat/completions", "/messages"] },
        { id: "none", supported_endpoints: ["/embeddings"] },
        { id: "plain" },
      ],
    })
  assert.deepEqual(await listModels(conn("anthropic"), { fetch: gateway }), [
    { id: "claude-x", formats: ["anthropic"] },
    { id: "gpt-x", formats: ["openai-compatible"] },
    { id: "both", formats: ["anthropic", "openai-compatible"] },
    { id: "none", formats: [] },
    { id: "plain" },
  ])
  // a 2xx that is no listing (a reverse proxy's index page) is "not JSON", and the trace still says 200
  const traces: Trace[] = []
  const page: typeof fetch = async () => new Response("<!doctype html>", { status: 200 })
  await assert.rejects(
    listModels(conn("openai-compatible"), { fetch: page, onTrace: (t) => traces.push(t) }),
    /model listing failed: not JSON/,
  )
  assert.deepEqual([traces.length, traces[0]!.status, traces[0]!.method], [1, 200, "GET"])
  // a fetch that throws is traced as status 0 (the probe's "nothing answered"), and the error goes on up
  const dead: typeof fetch = async () => {
    throw Object.assign(new TypeError("Unable to connect"), { code: "ECONNREFUSED" })
  }
  await assert.rejects(
    listModels(conn("openai-compatible"), { fetch: dead, onTrace: (t) => traces.push(t) }),
    (e: Error & { code?: string }) => e.code === "ECONNREFUSED",
  )
  assert.deepEqual([traces.length, traces[1]!.status, traces[1]!.url], [2, 0, `${mock.url}/v1/models`])
} finally {
  await mock.stop()
}
console.log("models ok")
