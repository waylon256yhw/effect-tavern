// listModels offline, on CopilotKit's aimock with provider-native model catalogs and the required-header policy: each
// format's auth table and list parser against the shape that provider answers (Anthropic `data[].id`, which needs
// `anthropic-version`; Gemini `models[].name` with its `models/` prefix; OpenAI `data[].id`), and a request without the
// version header refused as Anthropic refuses it.
import { LLMock } from "@copilotkit/aimock"
import assert from "node:assert/strict"
import { listModels, type Connection } from "../src/connection.ts"
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
  // each native catalog lists its own family; the OpenAI list is every fixture model
  assert.deepEqual(await listModels(conn("anthropic")), ["claude-haiku-5-5"])
  assert.deepEqual(await listModels(conn("gemini")), ["gemini-2.5-flash"])
  assert.deepEqual((await listModels(conn("openai-compatible"))).toSorted(), ids)
  const bare: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete("anthropic-version")
    return fetch(input, { ...init, headers })
  }
  await assert.rejects(listModels(conn("anthropic"), { fetch: bare }), /model listing failed: HTTP 400/)
} finally {
  await mock.stop()
}
console.log("models ok")
