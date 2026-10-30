// The pure half of the providers cluster (review/architecture-review-2026-10-30.html card 9): what the settings page
// computes over a Provider before a write, with no state and no wire. A provider's model list against the service's
// listing (the format rule: a listed model on another endpoint takes the listing's format unless the player set one),
// one entry's format and capabilities, the request drawer's draft and its way back, and the routing pairs as the menus
// encode them. models.tsx, providers.tsx and settings.tsx draw and write; this file only answers.
import { DEFAULTS, type Capabilities } from "@effect-tavern/provider/src/capabilities.ts"
import type { ModelEntry, Provider } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import type { Pair } from "./store.ts"
import type { Listed } from "./wire.ts"

export const FORMATS: Format[] = ["openai-compatible", "anthropic", "gemini"]

// ───────── The model list against the listing ─────────
/** Listed models already in the list with no format of their own, which the listing puts on another endpoint. */
export const staleModels = (p: Provider, remote: readonly Listed[]): Listed[] =>
  remote.filter((r) => r.format && p.models.some((m) => m.id === r.id && m.format === undefined))
/** Those models given the listing's format; a format the player set stays. The only place a stored format is corrected. */
export const correctedModels = (p: Provider, remote: readonly Listed[]): Provider => {
  const fix = new Map(staleModels(p, remote).map((r) => [r.id, r.format!]))
  return { ...p, models: p.models.map((m) => (fix.has(m.id) ? { ...m, format: fix.get(m.id)! } : m)) }
}
/** The listing's models added as listed (with the format the listing put them under), after the same correction. */
export const withModels = (p: Provider, remote: readonly Listed[]): Provider => {
  const q = correctedModels(p, remote)
  return {
    ...q,
    models: [
      ...q.models,
      ...remote
        .filter((m) => !p.models.some((x) => x.id === m.id))
        .map(({ id, format }) => ({ id, ...(format && { format }) })),
    ],
  }
}
export const withoutModels = (p: Provider, ids: readonly string[]): Provider => ({
  ...p,
  models: p.models.filter((m) => !ids.includes(m.id)),
})

// ───────── One entry ─────────
export const formatOf = (p: Provider, m: ModelEntry): Format => m.format ?? p.defaultFormat
/** A capability: the entry's override, else its format's default. */
export const capOf = <K extends keyof Capabilities>(p: Provider, m: ModelEntry, k: K): Capabilities[K] =>
  (m.capabilities?.[k] as Capabilities[K] | undefined) ?? DEFAULTS[formatOf(p, m)][k]
/** The entry with one key set, or removed when the value is undefined. */
export const without = <K extends Exclude<keyof ModelEntry, "id">>(
  m: ModelEntry,
  k: K,
  v: ModelEntry[K] | undefined,
): ModelEntry => {
  const { [k]: _, ...rest } = m
  return (v === undefined ? rest : { ...rest, [k]: v }) as ModelEntry
}

// ───────── The request drawer's draft ─────────
export interface Request {
  defaultFormat: Format
  endpoints: Record<Format, { url: string; exactPrefix: boolean }>
  ttl: "5m" | "1h"
  proxy: "env" | "direct" | "custom"
  proxyUrl: string
  headers: [string, string][]
}
export const requestOf = (p: Provider): Request => ({
  defaultFormat: p.defaultFormat,
  endpoints: Object.fromEntries(
    FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
  ) as Request["endpoints"],
  ttl: p.cacheTtl ?? "5m",
  proxy: p.proxy === undefined ? "env" : p.proxy === false ? "direct" : "custom",
  proxyUrl: typeof p.proxy === "string" ? p.proxy : "",
  headers: Object.entries(p.headers ?? {}),
})
/** The draft written back: URLs trimmed and empty ones dropped, defaults (exactPrefix off, 5m, the env proxy, no
 *  headers) left out, a custom proxy with no URL is the env one, headers with an empty name dropped. */
export const applied = (p: Provider, r: Request): Provider => {
  const headers = Object.fromEntries(r.headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
  const { cacheTtl: _t, proxy: _p, headers: _h, ...rest } = p
  return {
    ...rest,
    defaultFormat: r.defaultFormat,
    endpoints: Object.fromEntries(
      FORMATS.filter((f) => r.endpoints[f].url.trim()).map((f) => [
        f,
        { url: r.endpoints[f].url.trim(), ...(r.endpoints[f].exactPrefix && { exactPrefix: true }) },
      ]),
    ),
    ...(r.ttl === "1h" && { cacheTtl: "1h" as const }),
    ...(r.proxy === "direct" && { proxy: false as const }),
    ...(r.proxy === "custom" && r.proxyUrl.trim() && { proxy: r.proxyUrl.trim() }),
    ...(Object.keys(headers).length && { headers }),
  }
}

// ───────── Routing pairs ─────────
/** A pair as one menu value (a NUL cannot occur in an id) and back. */
export const pairKey = (p: Pair) => `${p.provider}\u0000${p.model}`
export const pairOf = (k: string): Pair => {
  const [provider, model] = k.split("\u0000") as [string, string]
  return { provider, model }
}
/** Why a routed pair is not on offer: its provider or model gone, or its provider off; nothing when it is live. The
 *  name is the provider's, or its id once it is gone. */
export const stalePair = (
  providers: readonly Provider[],
  pair: Pair | undefined,
): { reason: "removed" | "disabled"; name: string; model: string } | undefined => {
  if (!pair) return undefined
  const p = providers.find((x) => x.id === pair.provider)
  const gone = !p || !p.models.some((m) => m.id === pair.model)
  if (!gone && p.enabled) return undefined
  return { reason: gone ? "removed" : "disabled", name: p?.name ?? pair.provider, model: pair.model }
}
