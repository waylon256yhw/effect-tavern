// Production application: the same host and lifecycle as the CLI, with embedded client assets.
import { fileURLToPath } from "node:url"
import { start } from "./start.ts"

const dist = fileURLToPath(
  new URL(import.meta.url.includes("$bunfs") ? "dist/" : "../../client/dist/", import.meta.url),
)
await start({ dist })
