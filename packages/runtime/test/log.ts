// src/log.ts through its interface: ids, head, versions, threads, drop, the replica equal to the authority, the store.
import assert from "node:assert/strict"
import * as L from "../src/log.ts"

interface N extends L.Noded {
  text: string
}
const ids = (ns: readonly N[]) => ns.map((n) => n.id)

// a root, two versions of the second turn, a follow-up under the second version
let log = L.of<N>()
let c: L.Change<N>
;[log, c] = L.add(log, { parent: null, text: "root" })
assert.deepEqual(c, { node: { id: 0, parent: null, text: "root" }, head: 0 })
;[log] = L.add(log, { parent: 0, text: "a" })
;[log] = L.add(log, { parent: 0, text: "b" })
;[log] = L.add(log, { parent: 2, text: "b2" })
assert.deepEqual([log.head, ids(L.path(log))], [3, [0, 2, 3]]) // a new node is head; the line runs to it
assert.deepEqual(ids(L.children(log, 0)), [1, 2]) // the versions, in id order
assert.deepEqual([L.below(log, 0), L.below(log, 2), L.below(log, 3)], [3, 1, 0])
assert.deepEqual([L.leaf(log, 0), L.leaf(log, 1), L.leaf(log, 2)], [3, 1, 3])

// checkout: a version's whole follow-up comes back; null empties the line, the nodes stay
;[log, c] = L.checkout(log, 1)
assert.deepEqual([c, ids(L.path(log))], [{ head: 1 }, [0, 1]])
;[log] = L.checkout(log, 2)
assert.deepEqual(ids(L.path(log)), [0, 2, 3])
;[log] = L.checkout(log, null)
assert.deepEqual([log.head, L.path(log), log.nodes.size], [null, [], 4])
;[log] = L.add(log, { parent: null, text: "thread 2" }) // the next root: a second thread
assert.deepEqual([log.head, ids(L.children(log, null))], [4, [0, 4]])

// amend keeps id, parent and head
;[log, c] = L.amend(log, 1, { text: "a'" })
assert.deepEqual([c.node, c.head, L.get(log, 1).parent], [{ id: 1, parent: 0, text: "a'" }, 4, 0])

// drop: the subtree in id order; head inside falls to the newest surviving leaf; ids never come back
;[log] = L.checkout(log, 2)
;[log, c] = L.drop(log, 2)
assert.deepEqual([c.dropped, c.head, [...log.nodes.keys()]], [[2, 3], 4, [0, 1, 4]])
;[log, c] = L.add(log, { parent: 1, text: "after the hole" })
assert.equal(c.node!.id, 5)
;[log, c] = L.drop(log, 0)
assert.deepEqual([c.dropped, c.head], [[0, 1, 5], 4])
;[log, c] = L.drop(log, 4)
assert.deepEqual([c, log.nodes.size], [{ dropped: [4], head: null }, 0])

// the replica: applying every Change in order equals the authority
const kept: L.Change<N>[] = []
const auth = L.hold<N>()
const commit = (w: [L.Log<N>, L.Change<N>]) => kept.push(auth.commit(w))
commit(L.add(auth.log, { parent: null, text: "r" }))
commit(L.add(auth.log, { parent: 0, text: "x" }))
commit(L.add(auth.log, { parent: 0, text: "y" }))
commit(L.amend(auth.log, 1, { text: "x'" }))
commit(L.checkout(auth.log, 1))
commit(L.drop(auth.log, 2))
const replica = kept.reduce(L.apply, L.of<N>())
assert.deepEqual(L.snapshot(replica), L.snapshot(auth.log))

// the store: reloaded from what it wrote is the same log, and ids continue one past the greatest present
let disk: L.Snapshot<N> | undefined
const store: L.Store<N> = { read: () => disk, write: (s) => void (disk = s) }
const h = L.hold<N>(store)
h.commit(L.add(h.log, { parent: null, text: "r" }))
h.commit(L.add(h.log, { parent: 0, text: "c" }))
h.commit(L.drop(h.log, 1))
const back = L.hold<N>(store)
assert.deepEqual(L.snapshot(back.log), L.snapshot(h.log))
assert.equal(back.commit(L.add(back.log, { parent: 0, text: "d" })).node!.id, 1)

// errors: an unknown id, a child of a missing parent, a head that is not there; the log is untouched
assert.throws(() => L.get(log, 9), /no node 9/)
assert.throws(() => L.add(log, { parent: 9, text: "" }), /no node 9/)
assert.throws(() => L.apply(log, { head: 9 }), /no node 9/)
assert.throws(() => L.drop(log, 9), /no node 9/)
console.log("ok")
