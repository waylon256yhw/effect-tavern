import assert from "node:assert/strict"
import { lookup } from "../src/names.ts"

// entries as models.dev has them (packages/server/src/names.json)
const names = {
  "meta/muse-spark-1.1": { name: "Muse Spark 1.1", family: "muse" },
  "anthropic/claude-haiku-5-5": { name: "Claude Haiku 5.5", family: "claude-haiku" },
  "deepseek/deepseek-v3": { name: "DeepSeek-V3", family: "deepseek" },
  "moonshotai/kimi-k2": { name: "Kimi K2 0711", family: "kimi-k2" },
  "zhipuai/glm-4.5": { name: "GLM-4.5", family: "glm" },
  "anthropic/claude-3-7-sonnet-20250219": { name: "Claude Sonnet 3.7", family: "claude-sonnet" },
  "anthropic/claude-sonnet-4-5": { name: "Claude Sonnet 4.5 (latest)", family: "claude-sonnet" },
  "anthropic/claude-sonnet-4-5-20250929": { name: "Claude Sonnet 4.5", family: "claude-sonnet" },
  "openai/gpt-4o": { name: "GPT-4o", family: "gpt" },
  "openai/gpt-4o-2024-11-20": { name: "GPT-4o (2024-11-20)", family: "gpt" },
}
const muse = { owner: "meta", name: "Muse Spark 1.1", family: "muse" }
assert.deepEqual(lookup(names, "meta/muse-spark-1.1"), muse) // exact owner/model
assert.deepEqual(lookup(names, "muse-spark-1.1"), muse) // last path segment
assert.deepEqual(lookup(names, "relay/meta/muse-spark-1.1"), muse)
assert.equal(lookup(names, "claude-haiku-5-5")?.owner, "anthropic")
// relay spellings: case, owner aliases, dotted versions, a date tail on the table's side
assert.equal(lookup(names, "deepseek-ai/DeepSeek-V3")?.name, "DeepSeek-V3")
assert.equal(lookup(names, "moonshotai/Kimi-K2")?.name, "Kimi K2 0711")
assert.deepEqual(lookup(names, "zai-org/GLM-4.5"), { owner: "zhipuai", name: "GLM-4.5", family: "glm" })
assert.equal(lookup(names, "anthropic/claude-3.7-sonnet")?.name, "Claude Sonnet 3.7")
assert.equal(lookup(names, "claude-sonnet-4-5")?.name, "Claude Sonnet 4.5") // " (latest)" dropped
assert.equal(lookup(names, "claude-sonnet-4-5-latest")?.name, "Claude Sonnet 4.5")
assert.equal(lookup(names, "gpt-4o-2024-11-20")?.name, "GPT-4o (2024-11-20)") // its own dated entry, not the alias
// nothing: the caller shows the id
assert.equal(lookup(names, "some/unknown-model-x"), undefined)
assert.equal(lookup(names, "spark"), undefined)
console.log("names ok")
