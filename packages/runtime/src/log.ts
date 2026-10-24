// The log tree, self-contained: nodes with a parent, siblings under one parent as the versions of a turn, a root's
// subtree as a thread, and one head (a leaf, or null: an empty line awaiting the first input) as the only "where we
// are". A Log is a value; the writes decide a Change and `apply` is the only mutation, so a replica that applies every
// Change in order equals the authority by construction. A new id is one past every id ever handed out (`next`, kept
// in the snapshot), so a child's id is greater than its parent's and the greatest id in any subtree is a leaf: that
// one rule is "newest"; and an id never comes back after a drop, so anything keyed by ids (a summary cached by range)
// can never name a node it did not mean. No imports: the runtime, the server and the client all use this file, and it knows none of them.
export type Id = number
export interface Noded {
  readonly id: Id
  readonly parent: Id | null
}
export interface Log<T extends Noded> {
  readonly nodes: ReadonlyMap<Id, T>
  readonly head: Id | null
  readonly next: Id // the next id to hand out: one past every id ever present
}
/** The plain form: what a store keeps and the wire carries. */
export interface Snapshot<T> {
  readonly nodes: readonly T[]
  readonly head: Id | null
  readonly next?: Id // absent in a snapshot written before ids were kept: one past the greatest present
}
/** One write as data: a node lands (new, or amended in place), the dropped leave, head is set. Also the wire event. */
export interface Change<T> {
  readonly node?: T
  readonly dropped?: readonly Id[]
  readonly head: Id | null
}
/** Persistence at the log's seam: `read` the whole once, then `write` each Change as it is committed (an append for a
 *  row store; a snapshot store writes `log` whole and ignores the change). `log` is the log after the change: a row
 *  store keeps its `head` and `next` beside the nodes, so an id never comes back after a drop. */
export interface Store<T extends Noded> {
  read: () => Snapshot<T> | undefined
  write: (c: Change<T>, log: Log<T>) => void
}
type Written<T extends Noded> = [Log<T>, Change<T>]

export const of = <T extends Noded>(s?: Snapshot<T>): Log<T> => ({
  nodes: new Map((s?.nodes ?? []).map((n) => [n.id, n])),
  head: s?.head ?? null,
  next: Math.max(s?.next ?? 0, ...(s?.nodes ?? []).map((n) => n.id + 1)),
})
export const snapshot = <T extends Noded>(log: Log<T>): Snapshot<T> => ({
  nodes: [...log.nodes.values()],
  head: log.head,
  next: log.next,
})

// ───────── Reads: pure, every list in id order; an unknown id throws `no node N` (a caller's bug, never a state) ─────────
const missing = (id: Id) => new Error(`no node ${id}`)
export const get = <T extends Noded>(log: Log<T>, id: Id): T => {
  const n = log.nodes.get(id)
  if (!n) throw missing(id)
  return n
}
/** Root → id, inclusive; [] for null. */
export const chain = <T extends Noded>(log: Log<T>, id: Id | null): T[] => {
  const out: T[] = []
  for (let n = id === null ? undefined : get(log, id); n; n = n.parent === null ? undefined : log.nodes.get(n.parent))
    out.unshift(n)
  return out
}
/** The reading line: root → head. */
export const path = <T extends Noded>(log: Log<T>): T[] => chain(log, log.head)
/** A parent's children in id order: the versions of a turn; `null` gives the roots, the threads. */
export const children = <T extends Noded>(log: Log<T>, parent: Id | null): T[] =>
  [...log.nodes.values()].filter((n) => n.parent === parent).sort((a, b) => a.id - b.id)
/** The subtree, the node itself first. One pass in id order: a child's id is greater than its parent's, so a node's
 *  parent is already known to be inside (or not) when the node is reached. */
const under = <T extends Noded>(log: Log<T>, id: Id): T[] => {
  const inside = new Set([get(log, id).id]) // `add` returns the set: a node under an inside parent is marked and kept
  return [...log.nodes.values()]
    .sort((a, b) => a.id - b.id)
    .filter((n) => inside.has(n.id) || (n.parent !== null && inside.has(n.parent) && inside.add(n.id)))
}
/** How many nodes follow a node: what a checkout away from it leaves behind. */
export const below = <T extends Noded>(log: Log<T>, id: Id): number => under(log, id).length - 1
/** The newest leaf in a node's subtree (the node itself when childless): the greatest id there. */
export const leaf = <T extends Noded>(log: Log<T>, id: Id): Id => under(log, id).at(-1)!.id

// ───────── Writes: each decides a Change and returns the log after it; `apply` is the only mutation ─────────
export const apply = <T extends Noded>(log: Log<T>, c: Change<T>): Log<T> => {
  const nodes = new Map(log.nodes)
  for (const id of c.dropped ?? []) nodes.delete(id)
  if (c.node) {
    if (c.node.parent !== null && !nodes.has(c.node.parent)) throw missing(c.node.parent)
    nodes.set(c.node.id, c.node)
  }
  if (c.head !== null && !nodes.has(c.head)) throw missing(c.head)
  return { nodes, head: c.head, next: Math.max(log.next, c.node ? c.node.id + 1 : 0) }
}
const write = <T extends Noded>(log: Log<T>, c: Change<T>): Written<T> => [apply(log, c), c]
/** A new node under its parent (null: a root); it becomes head. */
export const add = <T extends Noded>(log: Log<T>, node: Omit<T, "id">): Written<T> =>
  write(log, { node: { ...node, id: log.next } as T, head: log.next })
/** The node replaced in place: id, parent and head kept. */
export const amend = <T extends Noded>(log: Log<T>, id: Id, patch: Partial<Omit<T, "id" | "parent">>): Written<T> =>
  write(log, { node: { ...get(log, id), ...patch } as T, head: log.head })
/** Head moves to the newest leaf under the node (a version's whole follow-up comes back); null empties the line. */
export const checkout = <T extends Noded>(log: Log<T>, id: Id | null): Written<T> =>
  write(log, { head: id === null ? null : leaf(log, id) })
/** The node and everything under it leave; head inside the drop falls to the newest surviving leaf, or null. */
export const drop = <T extends Noded>(log: Log<T>, id: Id): Written<T> => {
  const dropped = under(log, id).map((n) => n.id)
  const top = Math.max(-1, ...[...log.nodes.keys()].filter((k) => !dropped.includes(k)))
  const head = log.head !== null && dropped.includes(log.head) ? (top < 0 ? null : top) : log.head
  return write(log, { dropped, head })
}

/** The authority's holder: one value, each commit written to the store as its Change; no store = memory. */
export const hold = <T extends Noded>(store?: Store<T>) => {
  let log = of(store?.read())
  return {
    get log() {
      return log
    },
    commit: ([next, c]: Written<T>): Change<T> => {
      log = next
      store?.write(c, log)
      return c
    },
  }
}
