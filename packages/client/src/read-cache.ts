// Only recent, explicitly opened views are retained. A new timeline/card object invalidates a read.
export const readCache = <T>(cap: number) => {
  const versions = new WeakMap<object, number>()
  let nextVersion = 0
  const entries = new Map<string, { version: unknown; promise: Promise<T> }>()
  return (key: string, owner: object, load: () => Promise<T>): Promise<T> => {
    let version = versions.get(owner)
    if (version === undefined) versions.set(owner, (version = ++nextVersion))
    const hit = entries.get(key)
    if (hit && hit.version === version) return hit.promise
    const promise = load().catch((e) => {
      if (entries.get(key)?.promise === promise) entries.delete(key)
      throw e
    })
    entries.delete(key)
    entries.set(key, { version, promise })
    while (entries.size > cap) entries.delete(entries.keys().next().value!)
    return promise
  }
}
