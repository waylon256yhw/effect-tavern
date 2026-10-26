// The model-name table (provider names.ts): models.dev's models.json (~500 KB, keyed `owner/model`) reduced to
// {name, family}. names.json beside this file is the vendored baseline, bundled into the binary by the import, so a
// fresh install reads names without the network; `bun run names` re-fetches it by hand. On start, `refresh` asks
// models.dev with the ETag in force (the library's `names` row, else the baseline's) and replaces the row on a 200;
// a 304, offline or any error keeps what is there.
import type { Names } from "@effect-tavern/provider/src/names.ts"
import { writeFileSync } from "node:fs"
import baseline from "./names.json" with { type: "json" }
import type { Data } from "./data.ts"

const source = "https://models.dev/models.json"
type Table = { etag: string | null; names: Names }

const reduce = (all: Record<string, { name?: unknown; family?: unknown }>): Names =>
  Object.fromEntries(
    Object.entries(all)
      .filter(([, m]) => typeof m.name === "string")
      .map(([k, m]) => [k, { name: m.name as string, family: typeof m.family === "string" ? m.family : "" }]),
  )
const fetchTable = async (etag: string | null): Promise<Table | undefined> => {
  const res = await fetch(source, {
    headers: etag ? { "if-none-match": etag } : {},
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 304) return undefined
  if (!res.ok) throw new Error(`${source}: ${res.status}`)
  return { etag: res.headers.get("etag"), names: reduce((await res.json()) as never) }
}

/** The table in force: the library's row, else the vendored baseline. */
export const names = (data: Data): Names => data.names.read()?.names ?? (baseline as Table).names

/** In the background, never awaited by startup. */
export const refresh = async (data: Data) => {
  try {
    const t = await fetchTable(data.names.read()?.etag ?? (baseline as Table).etag)
    if (t) data.names.write(t)
  } catch (e) {
    console.debug(`model names not refreshed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

if (import.meta.main) {
  const t = (await fetchTable(null))!
  writeFileSync(new URL("names.json", import.meta.url), JSON.stringify(t) + "\n")
  console.log(`${Object.keys(t.names).length} names, etag ${t.etag}`)
}
