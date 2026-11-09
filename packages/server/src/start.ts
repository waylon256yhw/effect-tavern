// Both standalone entrypoints share listener, shutdown and optional static-file handling.
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import { openHost } from "./host.ts"
import { app } from "./serve.ts"

export const staticRoot = (dist?: string) => (dist && existsSync(join(dist, "index.html")) ? dist : undefined)

export const start = async ({
  port = Number(process.env["PORT"] ?? 7777),
  dist,
}: { port?: number; dist?: string } = {}) => {
  const { handler, data } = await openHost()
  const host = process.env["HOST"] ?? "127.0.0.1"
  const server = createServer(app(handler, staticRoot(dist)))
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, host, resolve)
    })
    const address = server.address()
    console.error(`http://${host}:${typeof address === "object" && address ? address.port : port}/api`)
    await new Promise<void>((resolve) => {
      const stop = () => server.close()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
      server.once("close", () => {
        process.off("SIGINT", stop)
        process.off("SIGTERM", stop)
        resolve()
      })
    })
  } finally {
    data.close()
  }
}
