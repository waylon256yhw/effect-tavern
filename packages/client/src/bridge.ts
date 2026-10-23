// An atom as a Solid accessor: one signal per atom for the page's life, owned by no component, like the registry it
// mirrors (store.ts). The registry notifies synchronously from whoever wrote; Solid applies on the next microtask.
import type * as Atom from "effect/reactivity/Atom"
import { type Accessor, createSignal, runWithOwner } from "solid-js"
import { registry } from "./store.ts"

const signals = new WeakMap<Atom.Atom<unknown>, Accessor<unknown>>()
export const read = <A>(atom: Atom.Atom<A>): Accessor<A> => {
  let s = signals.get(atom)
  if (!s) {
    const [get, set] = runWithOwner(null, () => createSignal<A>(registry.get(atom) as Exclude<A, Function>))!
    registry.subscribe(atom, (v) => set(() => v))
    signals.set(atom, (s = get))
  }
  return s as Accessor<A>
}
