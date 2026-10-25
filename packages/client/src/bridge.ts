// An atom as a Solid accessor: since the atoms are Solid signals and memos (atom.ts), an atom is its own tracked getter.
import type { Accessor } from "solid-js"
import type { Atom } from "./atom.ts"

export const read = <A>(atom: Atom<A>): Accessor<A> => atom
