// Addresses into authored cards: diagnostics, preview explanations and workshop selections use these paths.
import type { Card } from "./card.ts"
import type { Cond } from "./cond.ts"

export const unlocks = (e: Card["lore"][number]) => (Array.isArray(e.unlock) ? e.unlock : [e.unlock]) as readonly Cond[]
export const unlockPath = (e: Card["lore"][number], i: number) =>
  Array.isArray(e.unlock) ? `lore.${e.id}.unlock[${i}]` : `lore.${e.id}.unlock`
export const whenPaths = (zone: string, entries: readonly { id: string; when?: Cond }[]): [string, Cond][] =>
  entries.flatMap((e): [string, Cond][] => (e.when ? [[`${zone}.${e.id}.when`, e.when]] : []))
export const conditionChildren = (path: string, c: Cond): [string, Cond][] =>
  "all" in c
    ? c.all.map((child, i) => [`${path}.all[${i}]`, child])
    : "any" in c
      ? c.any.map((child, i) => [`${path}.any[${i}]`, child])
      : "not" in c
        ? [[`${path}.not`, c.not]]
        : []

// Keep a recursive path inventory so ids containing dots remain unambiguous.
export const cardPaths = (card: Card): Set<string> => {
  const paths = new Set<string>(["$"])
  const visit = (v: unknown, path: string) => {
    paths.add(path)
    if (Array.isArray(v))
      v.forEach((x, i) => {
        visit(x, `${path}[${i}]`)
        if (x && typeof x === "object" && ("id" in x || "path" in x)) visit(x, `${path}.${x.id ?? x.path}`)
      })
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => visit(x, path ? `${path}.${k}` : k))
  }
  visit(card, "")
  return paths
}
export const selectedText = (card: Card, path: string): string => {
  const f = card.fiction.find((f) => path === `fiction.${f.id}`)
  if (f && f.text !== undefined) return f.text
  for (const e of card.lore)
    for (const [i, text] of e.layers.entries()) if (path === `lore.${e.id}.layers[${i}]`) return text
  const g = /^greetings\[(\d+)\]$/.exec(path)
  if (g && card.greetings[Number(g[1])]) {
    const gr = card.greetings[Number(g[1])]!
    return gr.text ?? gr.note ?? ""
  }
  throw new Error(`invalid selection ${path}`)
}
