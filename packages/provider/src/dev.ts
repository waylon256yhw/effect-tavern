// Developer-machine conveniences for live checks. Nothing here runs in the harness proper.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Connection } from "./connection.ts"

/** The Anthropic API key at hand: ANTHROPIC_API_KEY, else the api_key profile pointed at api.anthropic.com in
 *  Deckled's local store (~/.deckled). Never printed. */
export const localAnthropicKey = (): string | undefined => {
  if (process.env["ANTHROPIC_API_KEY"]) return process.env["ANTHROPIC_API_KEY"]
  try {
    const dir = join(homedir(), ".deckled")
    const profiles = JSON.parse(readFileSync(join(dir, "providers.json"), "utf8")) as Record<
      string,
      { format?: string; endpoint?: { url?: string } }
    >
    const creds = JSON.parse(readFileSync(join(dir, "credentials.json"), "utf8")) as Record<
      string,
      { type?: string; key?: string }
    >
    const id = Object.keys(profiles).find(
      (k) =>
        profiles[k]?.format === "anthropic-messages" &&
        profiles[k]?.endpoint?.url?.startsWith("https://api.anthropic.com") &&
        creds[k]?.type === "api_key",
    )
    return id ? creds[id]?.key : undefined
  } catch {
    return undefined
  }
}

/** A live Anthropic connection on the developer machine, or undefined when there is no key. The shell's https_proxy
 *  becomes the connection's explicit proxy. */
export const localAnthropic = (model = "claude-haiku-5-5"): Connection | undefined => {
  const key = localAnthropicKey()
  if (!key) return undefined
  return {
    id: "anthropic-local",
    format: "anthropic",
    endpoint: { url: "https://api.anthropic.com", resolution: "format-default" },
    credential: { type: "api_key", key },
    model,
    proxy: process.env["https_proxy"] ?? process.env["HTTPS_PROXY"],
  }
}
