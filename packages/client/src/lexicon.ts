// The lexicon as a file: what the Writing page's 导出 writes and 导入 reads, so a list a player gathers while reading
// can be kept, shared, or kept up by a tool outside the app. JSON only: an array of `{ pattern, hint? }` (polish.ts
// `Entry`), or an object with a `lexicon` key holding one (the shape a player layer or a pack file carries). Reading is
// strict about shape and lenient about junk: a row without a non-empty string pattern is dropped, a hint that is not
// a string is dropped, duplicates (by pattern) keep the first. Pure, so a test reads it without the page.
import type { Entry } from "@effect-tavern/runtime/src/polish.ts"

export const FILE = "lexicon.json"

/** The entries in a file's text, or why it is not a lexicon. */
export const parseLexicon = (text: string): { entries: Entry[] } | { error: string } => {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { error: "不是 JSON 文件" }
  }
  const list = Array.isArray(v)
    ? v
    : v && typeof v === "object" && Array.isArray((v as { lexicon?: unknown }).lexicon)
      ? (v as { lexicon: unknown[] }).lexicon
      : undefined
  if (!list) return { error: "文件里没有词表：需要一个数组，或带 lexicon 键的对象" }
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const row of list) {
    if (!row || typeof row !== "object") continue
    const { pattern, hint } = row as { pattern?: unknown; hint?: unknown }
    if (typeof pattern !== "string" || !pattern.trim() || seen.has(pattern)) continue
    seen.add(pattern)
    entries.push(typeof hint === "string" && hint.trim() ? { pattern, hint } : { pattern })
  }
  return { entries }
}
/** The file's text for a list: one entry per line, so a diff reads. */
export const serializeLexicon = (entries: readonly Entry[]): string => JSON.stringify(entries, null, 2) + "\n"
/** The player's list with a file's entries added after it, the player's winning on a shared pattern. */
export const mergeLexicon = (mine: readonly Entry[], theirs: readonly Entry[]): Entry[] => {
  const have = new Set(mine.map((e) => e.pattern))
  return [...mine, ...theirs.filter((e) => !have.has(e.pattern))]
}
