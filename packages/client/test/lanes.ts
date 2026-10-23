// The lanes layout: a trunk in lane 0; a later version steps right; childless siblings with one line are a cluster
// and a sibling with its own subtree or another line is a branch; a branch holds its lane past a shallower fork; a
// second root is a second thread from lane 0; the draft continues its parent's lane or steps right of a taken cell;
// a root draft is its own thread; and head never moves anything.
import assert from "node:assert/strict"
import * as L from "@effect-tavern/runtime/src/log.ts"
import { DRAFT, layout } from "../src/lanes.ts"

type N = { id: number; parent: number | null; line: string }
const n = (id: number, parent: number | null, line = `l${id}`): N => ({ id, parent, line })
const of = (nodes: N[], head: number | null) => L.of({ nodes, head })
const lay = (nodes: N[], head: number | null, draft?: number | null) => layout(of(nodes, head), (x) => x.line, draft)
const at = (l: ReturnType<typeof layout>, id: number) => {
  const c = l.at.get(id)!
  return [c.thread, c.row, c.lane]
}

let l = lay([n(0, null), n(1, 0), n(2, 1), n(3, 2)], 3)
assert.deepEqual(
  l.cells.map((c) => [c.ids, c.row, c.lane]),
  [
    [[0], 0, 0],
    [[1], 1, 0],
    [[2], 2, 0],
    [[3], 3, 0],
  ],
)
assert.deepEqual([l.threads.length, l.threads[0]!.rows, l.threads[0]!.lanes], [1, 4, 1])

// the sample tree of docs/timeline-prototype-brief.md: under 2, 3 and 5 have subtrees (branches), 8 and 9 share
// 3's line without one (a cluster); under 3, 4 and 10 share a line (a cluster), 11 revised it (a branch)
const tree = [
  n(0, null),
  n(1, 0),
  n(2, 1),
  n(3, 2, "draw"),
  n(4, 3, "sheathe"),
  n(5, 2, "draw"),
  n(6, 5),
  n(7, null),
  n(8, 2, "draw"),
  n(9, 2, "draw"),
  n(10, 3, "sheathe"),
  n(11, 3, "stay"),
  n(12, 7),
]
for (const head of [6, 11, 4, 12, null]) {
  l = lay(tree, head)
  assert.deepEqual(at(l, 3), [0, 3, 0])
  assert.deepEqual(l.at.get(4), l.at.get(10))
  assert.deepEqual(l.at.get(4)!.ids, [4, 10])
  assert.deepEqual(at(l, 4), [0, 4, 0])
  assert.deepEqual(at(l, 11), [0, 4, 1])
  assert.deepEqual(at(l, 5), [0, 3, 2])
  assert.deepEqual(at(l, 6), [0, 4, 2])
  assert.deepEqual(l.at.get(8)!.ids, [8, 9])
  assert.deepEqual(at(l, 8), [0, 3, 3])
  assert.deepEqual(at(l, 7), [1, 0, 0])
  assert.deepEqual(at(l, 12), [1, 1, 0])
  assert.deepEqual(
    l.threads.map((t) => [t.root, t.rows, t.lanes]),
    [
      [0, 5, 4],
      [7, 2, 1],
    ],
  )
}

// the draft: under head it continues the lane; under a node whose cell below is taken it steps right; under null
// it opens a thread
l = lay(tree, 6, 6)
assert.deepEqual(at(l, DRAFT), [0, 5, 2])
l = lay(tree, 6, 2)
assert.deepEqual(at(l, DRAFT), [0, 3, 1])
l = lay(tree, 6, null)
assert.deepEqual([at(l, DRAFT), l.threads.at(-1)!.root], [[2, 0, 0], null])
l = lay([], null, null)
assert.deepEqual([at(l, DRAFT), l.threads.length], [[0, 0, 0], 1])
assert.deepEqual(lay([], null), { threads: [], cells: [], at: new Map() })
console.log("lanes ok")
