// The log tree as threads of rows and lanes (docs/timeline-prototype.html's algorithm): a root is a thread, drawn
// on its own; row = depth within the thread; the first unit under a parent continues its lane, every other unit
// takes the first lane right of it that is free from that row on. A unit is one child with a subtree, or the childless
// children that share a line (the versions of a turn no one read on from: a version cluster). Static: a function of
// ids, parents and lines only, never of head, so the picture holds still while head and the reading line move over it
// (they are highlights, drawn by the view). The draft (the node being written) is placed under its parent as DRAFT.
// Pure: no Solid, no DOM. (Not timeline.ts: a .ts beside a .tsx of one name confuses the type-aware lint.)
import * as L from "@effect-tavern/runtime/src/log.ts"

export const DRAFT = -1
export interface Cell {
  ids: L.Id[] // one node, or a cluster's members in id order
  parent: L.Id | null
  thread: number
  row: number
  lane: number
}
export interface Thread {
  root: L.Id | null // null: a draft opening a new thread
  rows: number
  lanes: number
}
export interface Layout {
  threads: Thread[]
  cells: Cell[] // parents before children
  at: Map<L.Id, Cell>
}

export const layout = <T extends L.Noded>(log: L.Log<T>, line: (n: T) => string, draftParent?: L.Id | null): Layout => {
  const parents = new Set([...log.nodes.values()].map((n) => n.parent))
  const units = (parent: L.Id): L.Id[][] => {
    const out: L.Id[][] = []
    const by = new Map<string, L.Id[]>()
    for (const k of L.children(log, parent)) {
      if (parents.has(k.id)) out.push([k.id])
      else {
        let u = by.get(line(k))
        if (!u) {
          u = []
          by.set(line(k), u)
          out.push(u)
        }
        u.push(k.id)
      }
    }
    return out
  }
  const threads: Thread[] = []
  const cells: Cell[] = []
  const at = new Map<L.Id, Cell>()
  const open = (root: L.Id | null): Thread => {
    const t: Thread = { root, rows: 0, lanes: 0 }
    threads.push(t)
    return t
  }
  const place = (t: Thread, ids: L.Id[], parent: L.Id | null, row: number, lane: number) => {
    const c: Cell = { ids, parent, thread: threads.indexOf(t), row, lane }
    cells.push(c)
    for (const id of ids) at.set(id, c)
    t.rows = Math.max(t.rows, row + 1)
    t.lanes = Math.max(t.lanes, lane + 1)
  }
  for (const r of L.children(log, null)) {
    const t = open(r.id)
    const end: number[] = [] // per lane, the last row it holds
    // ponytail: a lane frees from the row after its branch ends and is never reused above a later branch, so wide
    // trees waste lanes to the right. Interval packing if it ever shows.
    const free = (row: number, from: number) => {
      let l = from
      while ((end[l] ?? -1) >= row) l++
      return l
    }
    const visit = (ids: L.Id[], parent: L.Id | null, row: number, lane: number) => {
      place(t, ids, parent, row, lane)
      end[lane] = Math.max(end[lane] ?? -1, row)
      if (ids.length === 1)
        units(ids[0]!).forEach((u, i) => visit(u, ids[0]!, row + 1, i === 0 ? lane : free(row + 1, lane + 1)))
    }
    visit([r.id], null, 0, 0)
  }
  // the draft: its parent's lane when the cell below is free, else the first free lane right of it; a root draft
  // opens a thread
  if (draftParent === null) place(open(null), [DRAFT], null, 0, 0)
  else if (draftParent !== undefined) {
    const p = at.get(draftParent)
    if (p) {
      const t = threads[p.thread]!
      const row = p.row + 1
      let lane = p.lane
      while (cells.some((c) => c.thread === p.thread && c.row === row && c.lane === lane)) lane++
      place(t, [DRAFT], draftParent, row, lane)
    }
  }
  return { threads, cells, at }
}
