import assert from "node:assert/strict"
import { lookup } from "../src/names.ts"

const names = {
  "meta/muse-spark-1.1": { name: "Muse Spark 1.1", family: "muse" },
  "anthropic/claude-haiku-5-5": { name: "Claude Haiku 5.5", family: "claude-haiku" },
}
const muse = { owner: "meta", name: "Muse Spark 1.1", family: "muse" }
assert.deepEqual(lookup(names, "meta/muse-spark-1.1"), muse) // exact owner/model
assert.deepEqual(lookup(names, "muse-spark-1.1"), muse) // last path segment
assert.deepEqual(lookup(names, "relay/meta/muse-spark-1.1"), muse)
assert.equal(lookup(names, "claude-haiku-5-5")?.owner, "anthropic")
assert.equal(lookup(names, "some/unknown-model-x"), undefined) // nothing: the caller shows the id
assert.equal(lookup(names, "spark"), undefined)
console.log("names ok")
