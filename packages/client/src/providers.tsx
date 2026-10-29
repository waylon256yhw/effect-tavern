// The settings page's 模型服务 section: the provider list, one provider's detail (key, endpoint, grouped models, the
// probes of probe.ts), its two drawers (request settings, the service's model list) and the dialog that adds a
// provider. The key vault's drawer is vault.tsx, the dialogs about one model are models.tsx. Every write goes through
// wire.ts and comes back as the list; the drafts here are the drawer's and the dialog's, written on Save and on submit.
import { lookup } from "@effect-tavern/provider/src/names.ts"
import type { ModelEntry, Probe, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import { read } from "./bridge.ts"
import {
  ask,
  Avatar,
  copyKey,
  Drawer,
  FORMAT,
  FORMATS,
  grouped,
  Menu,
  Modal,
  Name,
  newId,
  type Opener,
  preview,
  Switch,
  ToList,
  type Pane,
} from "./controls.tsx"
import { Family } from "./family.tsx"
import {
  Check,
  Clue,
  Close,
  Copy,
  Eye,
  EyeOff,
  Fold,
  Key,
  Lightning,
  Minus,
  Next,
  Settings as Gear,
  Snippets as Plus,
  Sync,
  Trash,
} from "./icons.tsx"
import { AddModelDialog, addModels, ModelDialog, removeModels } from "./models.tsx"
import { createProbing, IDLE, result, type Slot } from "./probe.ts"
import { names, providers, registry, secrets } from "./store.ts"
import { VaultDrawer } from "./vault.tsx"
import { t } from "./i18n.ts"
import {
  addSecret,
  deleteProvider,
  listModels,
  putProvider,
  secretValue,
  setSecret,
  testProvider,
  type Listed,
} from "./wire.ts"

const providerOf = (id: string) => registry.get(providers).find((p) => p.id === id)
/** For handlers and snapshots (the registry, not a tracked read); JSX reads `vault()` itself. */
const secretOf = (p: Provider): SecretView | undefined => registry.get(secrets).find((s) => s.id === p.secret)
/** A model id matches a search by itself or by its table name. */
const hit = (id: string, q: string) =>
  `${id} ${lookup(read(names)(), id)?.name ?? ""}`.toLowerCase().includes(q.toLowerCase())
/** A model row's text: the table's name over the raw id, or the id alone when the table does not know it. */
const ModelName = (props: { id: string }) => (
  <Show when={lookup(read(names)(), props.id)} fallback={<span class="m-name">{props.id}</span>}>
    {(m) => (
      <span class="m-name">
        {m().name}
        <span class="m-id mono">{props.id}</span>
      </span>
    )}
  </Show>
)
/** A button inside a group's summary: it acts, the summary does not fold. */
const quiet = (run: () => void) => (e: MouseEvent) => (e.preventDefault(), e.stopPropagation(), run())
/** The endpoints with one format's URL set, or dropped when it is emptied. */
const setUrl = (p: Provider, f: Format, url: string): Provider["endpoints"] => {
  const { [f]: old, ...rest } = p.endpoints
  return url.trim() ? { ...rest, [f]: { ...old, url: url.trim() } } : rest
}
/** A latency for a slot of one width: `240ms`, `1.2s` past a second. */
const took = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
/** A listing probe's verdict, by the status first (0: nothing answered, the proxy or the route), then by what the
 *  address said: a listing, a refused key, no listing there, a page that is not an API, some other status. */
const verdict = (p: Probe): { text: string; tone: "ok" | "bad" | "" } =>
  !p.url
    ? { text: t("providers.cannotProbe"), tone: "bad" }
    : p.status === 0
      ? { text: t("providers.unreachable"), tone: "bad" }
      : p.ok
        ? { text: t("providers.connected", { what: took(p.ms) }), tone: "ok" }
        : p.status === 401 || p.status === 403
          ? { text: t("providers.keyRejected"), tone: "bad" }
          : p.status === 404
            ? { text: t("providers.noListing"), tone: "" }
            : p.status < 300
              ? { text: t("providers.notListing"), tone: "bad" }
              : { text: t("providers.connectedHttp", { status: p.status }), tone: "bad" }
/** The request a probe made, for a hint: `GET https://… → HTTP 400`. */
const sent = (p: Probe) =>
  p.url ? `${p.method} ${p.url}${p.status ? t("providers.arrowHttp", { status: p.status }) : ""}` : undefined
const ERR_CAP = 300
/** The bar under a probe that failed: the request as sent, the socket's code, the error to ERR_CAP characters (a
 *  gateway's error body can be a whole page; the copy carries all of it). Wraps; never on the row it explains. */
const ProbeError = (props: { probe: Probe }) => {
  const [copied, setCopied] = createSignal(false)
  const error = () => props.probe.error ?? ""
  // the code, unless the message already opens with it (Bun's fetch errors do)
  const code = () => (props.probe.code && !error().startsWith(props.probe.code) ? `${props.probe.code}: ` : "")
  const full = () => [sent(props.probe), `${code()}${error()}`].filter(Boolean).join("\n")
  return (
    <div class="probe-err">
      <div class="probe-err-text">
        <Show when={sent(props.probe)}>{(s) => <span class="mono">{s()}</span>}</Show>
        <span>
          {code()}
          {error().length > ERR_CAP ? `${error().slice(0, ERR_CAP)}…` : error()}
        </span>
      </div>
      <button
        type="button"
        class="icon sm"
        aria-label={t("providers.copyError")}
        onClick={() => void copyKey(full(), setCopied)}
      >
        <Show when={copied()} fallback={<Copy />}>
          <Check />
        </Show>
      </button>
    </div>
  )
}
const DRAWER_OUT = 250 // ms: past the drawer's --dur-3 slide, so its content leaves with it

export const Providers = (props: Pane) => {
  const list = read(providers)
  const [search, setSearch] = createSignal("")
  const shown = () => list().filter((p) => p.name.toLowerCase().includes(search().toLowerCase()))
  const current = () => list().find((p) => p.id === props.picked) ?? list()[0]
  let openAdd: () => void = () => {}
  // the vault drawer: the section's, so it opens with no provider too; `vaultFor` is the provider it was opened from
  const [vaultOpen, setVaultOpen] = createSignal(false)
  const [vaultFor, setVaultFor] = createSignal<string | undefined>()
  const openVault = (id: string | undefined) => (setVaultFor(id), setVaultOpen(true))
  return (
    <>
      <aside class="master-card" aria-label={t("providers.providers")}>
        <div class="master-top">
          <div class="input-box">
            <Clue aria-hidden="true" />
            <input
              type="search"
              placeholder={t("providers.searchProviders")}
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="master-list scroller">
          <For each={shown()} keyed={(p) => p.id}>
            {(p) => (
              <button
                type="button"
                class="p-row"
                aria-selected={p().id === current()?.id ? "true" : "false"}
                onClick={() => props.onPick(p().id)}
              >
                <Avatar name={p().name} />
                <span class="p-name">{p().name}</span>
                <span class={{ dot: true, on: p().enabled }} />
              </button>
            )}
          </For>
        </div>
        <div class="master-foot row">
          <button type="button" class="btn" onClick={() => openAdd()}>
            <Plus /> <span>{t("providers.addProvider")}</span>
          </button>
          <button
            type="button"
            class="icon boxed"
            aria-label={t("common.vault")}
            onClick={() => (props.onPick(props.picked ?? ""), openVault(undefined))}
          >
            <Key />
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label={t("providers.providerDetail")}>
        {/* keyed by id: another provider is a fresh detail (key, probe, search, drawer start over), a save is not */}
        <Show when={current()?.id} keyed fallback={<div class="empty">{t("providers.none")}</div>}>
          {(id) => <ProviderDetail id={id} onBack={props.onBack} onVault={() => openVault(id)} />}
        </Show>
        <Drawer open={vaultOpen()} label={t("common.vault")} onClose={() => setVaultOpen(false)}>
          <VaultDrawer for={vaultFor()} onClose={() => setVaultOpen(false)} />
        </Drawer>
      </section>
      <AddProviderDialog opener={(f) => (openAdd = () => f(undefined))} onAdded={props.onPick} />
    </>
  )
}

const ProviderDetail = (props: { id: string; onBack: () => void; onVault: () => void }) => {
  const list = read(providers)
  const vault = read(secrets)
  const p = () => list().find((x) => x.id === props.id)
  const save = (f: (p: Provider) => Provider) => {
    const x = p()
    if (x) void putProvider(f(x))
  }
  const [typed, setTyped] = createSignal("") // a key being typed
  const [reveal, setReveal] = createSignal(false)
  // the stored key while the eye is open, read on that click and dropped when it closes or the secret changes
  const [plain, setPlain] = createSignal<{ id: string; value: string } | null>(null)
  const [copied, setCopied] = createSignal(false)
  const [mq, setMq] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [folded, setFolded] = createSignal(false)
  const [drawer, setDrawer] = createSignal<"endpoint" | "sync" | null>(null)
  // what the drawer shows: set as it opens, kept while it slides out (DRAWER_OUT)
  const [shown, setShown] = createSignal<"endpoint" | "sync" | null>(null)
  const open = (d: "endpoint" | "sync") => (setShown(d), setDrawer(d))
  const shut = () => {
    setDrawer(null)
    setTimeout(() => drawer() || setShown(null), DRAWER_OUT)
  }
  let openModel: (m: ModelEntry) => void = () => {}
  let openAddModel: () => void = () => {}

  /** A typed key goes up once. Retyped on the provider's own secret (the one named after it), the value is replaced in
   *  place; on a secret the player named in the vault, it is a new secret under the provider's name. */
  // the key's write in flight: a drawer's first request and the probes wait for it, or they would go out keyless
  let savingKey: Promise<void> | undefined
  const keySaved = () => savingKey ?? Promise.resolve()
  const storeKey = (): Promise<void> => {
    const run: Promise<void> = writeKey()
      .then((how) => {
        // a key replaced in place changes nothing the probes watch: they start over here, with the new key (a new
        // secret changes the provider, and the probes see that themselves)
        if (how === "rekeyed") probing.restart()
      })
      .finally(() => {
        if (savingKey === run) savingKey = undefined
      })
    savingKey = run
    return run
  }
  /** The key's type is the key's to say (the server reads it off the value); the vault's menu overrides it there. */
  const writeKey = async (): Promise<"rekeyed" | "added" | undefined> => {
    const x = p()
    const value = typed().trim()
    if (!x || !value) return
    const own = secretOf(x)
    setTyped("")
    setPlain(null)
    if (own && own.name === x.name) {
      await setSecret(own.id, { name: own.name, value })
      return "rekeyed"
    }
    const s = await addSecret({ name: x.name, value })
    await putProvider({ ...x, secret: s.id })
    return "added"
  }
  /** What the field holds: the typed text, else the stored key while the eye is open on it. */
  const shownKey = (x: Provider) => typed() || (reveal() && plain()?.id === x.secret ? plain()!.value : "")
  const flipReveal = async () => {
    const on = !reveal() // a write lands on the next microtask: read the new value from here, not the signal
    setReveal(on)
    const x = p()
    if (!on) return setPlain(null)
    if (x && !typed() && secretOf(x)) setPlain({ id: x.secret!, value: await secretValue(x.secret!) })
  }
  const stored = (x: Provider) => (secretOf(x) ? secretValue(x.secret!) : "")
  /** The key field's part of a probe: a key still being typed goes up first, or the probe would go out without it. */
  const flushKey = () => {
    if (typed().trim()) void storeKey()
    return keySaved()
  }
  // the probes, this detail's (it remounts per provider): the connectivity's, and one per model tested
  const probing = createProbing({ provider: p, ready: flushKey, run: testProvider })
  const reach = () => probing.probes().reach
  const test = (id: string): Slot<Probe> => probing.probes().tests[id] ?? IDLE
  const failed = (s: Slot<Probe>) => (result(s)?.ok === false ? result(s) : undefined)
  /** The test's slot label: one width through its states. */
  const label = (s: Slot<Probe>) =>
    s.state === "idle"
      ? t("providers.probe")
      : s.state === "running"
        ? "…"
        : s.result.ok
          ? took(s.result.ms)
          : t("providers.failed")
  const endpoints = (x: Provider) => FORMATS.filter((f) => x.endpoints[f]?.url.trim()).length
  const models = (x: Provider) => x.models.map((m) => m.id).filter((id) => hit(id, mq()))

  return (
    <Show when={p()}>
      {(x) => (
        <>
          <header class="detail-header">
            <ToList onBack={props.onBack} />
            <Name value={x().name} label={t("providers.name")} onCommit={(name) => save((y) => ({ ...y, name }))} />
            <span class="spacer" />
            <button
              type="button"
              class="icon sm"
              aria-label={t("providers.deleteProvider")}
              onClick={() => ask(t("providers.confirmDelete", { name: x().name }), () => void deleteProvider(x().id))}
            >
              <Trash />
            </button>
            <Switch
              on={x().enabled}
              label={t("providers.enabled")}
              onFlip={() => save((y) => ({ ...y, enabled: !y.enabled }))}
            />
          </header>
          <div class="detail-scroll scroller">
            <div class="block">
              <div class="block-title">
                <h3>{t("providers.apiKey")}</h3>
                {/* connectivity results: a tag per distinct listing URL in the title row, so the controls below never move */}
                <Show when={reach().state !== "idle"}>
                  <div class="right probes">
                    <Show when={result(reach())} fallback={<span class="tag">…</span>}>
                      {(probes) => (
                        <For each={probes()} keyed={false}>
                          {(pr) => {
                            const v = () => verdict(pr())
                            return (
                              <span class={{ tag: true, ok: v().tone === "ok", bad: v().tone === "bad" }}>
                                {probes().length > 1
                                  ? `${pr()
                                      .formats.map((f) => FORMAT[f])
                                      .join("/")} · `
                                  : ""}
                                {v().text}
                              </span>
                            )
                          }}
                        </For>
                      )}
                    </Show>
                  </div>
                </Show>
              </div>
              <div
                class="row"
                onFocusOut={(e) =>
                  !e.currentTarget.contains(e.relatedTarget as Node | null) && typed().trim() && void storeKey()
                }
              >
                <div class="input-box grow">
                  <input
                    type={reveal() ? "text" : "password"}
                    class="mono"
                    autocomplete="off"
                    value={shownKey(x())}
                    placeholder={vault().find((s) => s.id === x().secret)?.hint ?? t("providers.keyPlaceholder")}
                    aria-label={t("providers.apiKey")}
                    onInput={(e) => (setTyped(e.currentTarget.value), setPlain(null))}
                    onKeyDown={(e) => e.key === "Enter" && void storeKey()}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={reveal() ? t("common.hideKey") : t("common.showKey")}
                    onClick={() => void flipReveal()}
                  >
                    <Show when={reveal()} fallback={<Eye />}>
                      <EyeOff />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("common.copyKey")}
                    onClick={() => void copyKey(typed().trim() || stored(x()), setCopied)}
                  >
                    <Show when={copied()} fallback={<Copy />}>
                      <Check />
                    </Show>
                  </button>
                </div>
                <button
                  type="button"
                  class="icon boxed"
                  aria-label={t("common.vault")}
                  onClick={() => (typed().trim() && void storeKey(), props.onVault())}
                >
                  <Key />
                </button>
                <button
                  type="button"
                  class="icon boxed"
                  aria-label={t("providers.probeLabel")}
                  disabled={reach().state === "running"}
                  onClick={() => void probing.reach()}
                >
                  <Lightning />
                </button>
              </div>
              {/* a failed probe explains itself under the row; a 404 does not: the address answered, it just lists nothing */}
              <Show when={result(reach())}>
                {(probes) => (
                  <For each={probes().filter((pr) => !pr.ok && pr.status !== 404)} keyed={false}>
                    {(pr) => <ProbeError probe={pr()} />}
                  </For>
                )}
              </Show>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>{t("providers.apiUrl")}</h3>
                <button type="button" class="link" onClick={() => open("endpoint")}>
                  {t("providers.addEndpoint")}
                </button>
                <div class="right">
                  <span class="tag">
                    {FORMAT[x().defaultFormat]} · {t("common.default")}
                    {endpoints(x()) > 1 ? ` (+${endpoints(x()) - 1})` : ""}
                  </span>
                </div>
              </div>
              <div class="row">
                <div class="input-box grow">
                  <input
                    type="url"
                    class="mono"
                    value={x().endpoints[x().defaultFormat]?.url ?? ""}
                    placeholder="https://api.example.com"
                    aria-label={t("providers.apiUrl")}
                    onChange={(e) =>
                      save((y) => ({ ...y, endpoints: setUrl(y, y.defaultFormat, e.currentTarget.value) }))
                    }
                  />
                </div>
                <button
                  type="button"
                  class="icon boxed"
                  aria-label={t("providers.requestConfig")}
                  onClick={() => open("endpoint")}
                >
                  <Gear />
                </button>
              </div>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>{t("providers.models")}</h3>
                <button
                  type="button"
                  class="icon sm"
                  aria-label={t("providers.toggleGroup")}
                  aria-pressed={folded() ? "true" : "false"}
                  onClick={() => setFolded(!folded())}
                >
                  <Fold />
                </button>
                <label class="inline-search" data-open={searching() || !!mq() ? "true" : "false"}>
                  <Clue aria-hidden="true" />
                  <input
                    type="search"
                    placeholder={t("providers.searchModels")}
                    aria-label={t("providers.searchModelsLabel")}
                    value={mq()}
                    onFocus={() => setSearching(true)}
                    onBlur={() => setSearching(false)}
                    onInput={(e) => setMq(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return
                      e.preventDefault() // the search's Escape: the page stays
                      setMq("")
                      e.currentTarget.blur()
                    }}
                  />
                </label>
                <div class="right">
                  <Show when={x().models.length}>
                    <Show
                      when={probing.batch()}
                      fallback={
                        <button type="button" class="btn sm ghost" onClick={() => void probing.testAll(models(x()))}>
                          {t("providers.probeAll")}
                        </button>
                      }
                    >
                      <button type="button" class="btn sm ghost" onClick={probing.stop}>
                        {t("providers.stop")}
                      </button>
                    </Show>
                  </Show>
                  <div class="btn-join">
                    <button type="button" class="btn sm" onClick={() => open("sync")}>
                      <Sync /> <span>{t("providers.sync")}</span>
                    </button>
                    <button
                      type="button"
                      class="btn sm"
                      aria-label={t("providers.addManually")}
                      onClick={() => openAddModel()}
                    >
                      <Plus />
                    </button>
                  </div>
                </div>
              </div>
              <div class="groups">
                <For
                  each={grouped(models(x()))}
                  keyed={(g) => g[0]}
                  fallback={
                    <div class="empty-card">
                      <span>{mq() ? t("providers.noMatch") : t("providers.noModels")}</span>
                      <Show when={!mq()}>
                        <button type="button" class="btn sm" onClick={() => open("sync")}>
                          <Sync /> {t("providers.syncList")}
                        </button>
                      </Show>
                    </div>
                  }
                >
                  {(g) => (
                    <details class="group" open={!folded()}>
                      <summary>
                        <Next class="chev" />
                        <span>{g()[0]}</span>
                        <span class="acts">
                          <button
                            type="button"
                            class="icon sm"
                            aria-label={t("providers.removeGroup")}
                            onClick={quiet(() =>
                              ask(t("providers.confirmRemoveGroup", { group: g()[0], n: g()[1].length }), () =>
                                removeModels(x(), g()[1]),
                              ),
                            )}
                          >
                            <Trash />
                          </button>
                        </span>
                      </summary>
                      <For each={g()[1]} keyed={(id) => id}>
                        {(id) => {
                          const probe = () => test(id())
                          return (
                            <>
                              <div class="m-row">
                                <Family id={id()} />
                                <ModelName id={id()} />
                                {/* the test's slot: one width through its states, so the row never reflows; a
                                    result shows the time or 失败, and a press tests again */}
                                <button
                                  type="button"
                                  class={{ "m-probe": true, ok: !!result(probe())?.ok, bad: !!failed(probe()) }}
                                  aria-label={t("providers.probeOne", { model: id() })}
                                  disabled={probe().state === "running"}
                                  onClick={() => void probing.test(id())}
                                >
                                  {label(probe())}
                                </button>
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label={t("providers.modelSettings")}
                                  onClick={() => openModel(x().models.find((m) => m.id === id())!)}
                                >
                                  <Gear />
                                </button>
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label={t("providers.removeModel")}
                                  onClick={() => removeModels(x(), [id()])}
                                >
                                  <Minus />
                                </button>
                              </div>
                              <Show when={failed(probe())}>{(pr) => <ProbeError probe={pr()} />}</Show>
                            </>
                          )
                        }}
                      </For>
                    </details>
                  )}
                </For>
              </div>
            </div>
          </div>

          <Drawer
            open={!!drawer()}
            label={shown() === "sync" ? t("providers.sync") : t("providers.requestConfig")}
            onClose={shut}
          >
            <Show when={shown() === "endpoint"}>
              <RequestDrawer id={props.id} ready={keySaved} onClose={shut} />
            </Show>
            <Show when={shown() === "sync"}>
              <SyncDrawer id={props.id} ready={keySaved} onClose={shut} />
            </Show>
          </Drawer>
          <ModelDialog id={props.id} opener={(f) => (openModel = f)} />
          <AddModelDialog id={props.id} opener={(f) => (openAddModel = () => f(undefined))} />
        </>
      )}
    </Show>
  )
}

// ───────── The request drawer: a draft of the provider's request settings, written on Save ─────────
interface Request {
  defaultFormat: Format
  endpoints: Record<Format, { url: string; exactPrefix: boolean }>
  ttl: "5m" | "1h"
  proxy: "env" | "direct" | "custom"
  proxyUrl: string
  headers: [string, string][]
}
const requestOf = (p: Provider): Request => ({
  defaultFormat: p.defaultFormat,
  endpoints: Object.fromEntries(
    FORMATS.map((f) => [f, { url: p.endpoints[f]?.url ?? "", exactPrefix: !!p.endpoints[f]?.exactPrefix }]),
  ) as Request["endpoints"],
  ttl: p.cacheTtl ?? "5m",
  proxy: p.proxy === undefined ? "env" : p.proxy === false ? "direct" : "custom",
  proxyUrl: typeof p.proxy === "string" ? p.proxy : "",
  headers: Object.entries(p.headers ?? {}),
})
const applied = (p: Provider, r: Request): Provider => {
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

const RequestDrawer = (props: { id: string; ready: () => Promise<void>; onClose: () => void }) => {
  const start = untrack(() => providerOf(props.id))
  const [r, setR] = createSignal<Request | undefined>(start && requestOf(start))
  const edit = (f: (r: Request) => Request) => setR((x) => (x ? f(x) : x))
  const setEndpoint = (f: Format, patch: Partial<Request["endpoints"][Format]>) =>
    edit((x) => ({ ...x, endpoints: { ...x.endpoints, [f]: { ...x.endpoints[f], ...patch } } }))
  const sample = () => providerOf(props.id)?.models[0]?.id
  const save = async () => {
    await props.ready()
    const p = providerOf(props.id)
    const d = r()
    if (!p || !d) return
    await putProvider(applied(p, d))
    props.onClose()
  }
  return (
    <Show when={r()}>
      {(d) => (
        <>
          <div class="drawer-head">
            <h3>{t("providers.requestConfig")}</h3>
            <span class="spacer" />
            <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onClose()}>
              <Close />
            </button>
          </div>
          <div class="drawer-body scroller">
            <For each={FORMATS} keyed={(f) => f}>
              {(f) => (
                <div class="field-group">
                  <div class="label-row">
                    <span class="fmt">
                      <strong>{FORMAT[f()]}</strong>
                      <Show
                        when={d().defaultFormat === f()}
                        fallback={
                          <button
                            type="button"
                            class="btn xs"
                            onClick={() => edit((x) => ({ ...x, defaultFormat: f() }))}
                          >
                            {t("providers.setDefault")}
                          </button>
                        }
                      >
                        <span class="tag ok">{t("common.default")}</span>
                      </Show>
                    </span>
                    <span class="exact">
                      <span>{t("providers.exactPrefix")}</span>
                      <Switch
                        on={d().endpoints[f()].exactPrefix}
                        label={t("providers.exactPrefixOf", { name: FORMAT[f()] })}
                        onFlip={() => setEndpoint(f(), { exactPrefix: !d().endpoints[f()].exactPrefix })}
                      />
                    </span>
                  </div>
                  <div class="input-box">
                    <input
                      type="url"
                      class="mono"
                      value={d().endpoints[f()].url}
                      placeholder={t("providers.baseUrlExample")}
                      aria-label={t("providers.urlOf", { name: FORMAT[f()] })}
                      onInput={(e) => setEndpoint(f(), { url: e.currentTarget.value })}
                    />
                  </div>
                  <Show when={d().endpoints[f()].url.trim()}>
                    {(url) => {
                      const pv = () => preview(f(), url(), d().endpoints[f()].exactPrefix, sample())
                      return <div class={{ resolved: true, err: !pv().ok }}>{pv().text}</div>
                    }}
                  </Show>
                </div>
              )}
            </For>
            <div class="drawer-more">
              {/* no auth menu here: how a key is sent is the key's (the vault's), not the endpoint's */}
              <div class="pair">
                <div class="field-group">
                  <span class="label">{t("providers.cacheTtl")}</span>
                  <Menu
                    small
                    label={t("providers.cacheTtl")}
                    value={d().ttl}
                    options={[
                      { value: "5m", label: t("providers.fiveMinutes") },
                      { value: "1h", label: t("providers.oneHour") },
                    ]}
                    onPick={(ttl) => edit((x) => ({ ...x, ttl }))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">{t("providers.proxy")}</span>
                  <Menu
                    small
                    label={t("providers.proxy")}
                    value={d().proxy}
                    options={[
                      { value: "env", label: t("providers.proxySystem") },
                      { value: "direct", label: t("providers.proxyDirect") },
                      { value: "custom", label: t("providers.proxyCustom") },
                    ]}
                    onPick={(proxy) => edit((x) => ({ ...x, proxy }))}
                  />
                </div>
              </div>
              <Show when={d().proxy === "custom"}>
                <div class="input-box sm">
                  <input
                    type="url"
                    class="mono"
                    placeholder="http://127.0.0.1:7890"
                    aria-label={t("providers.proxyUrl")}
                    value={d().proxyUrl}
                    onInput={(e) => {
                      const proxyUrl = e.currentTarget.value
                      edit((x) => ({ ...x, proxyUrl }))
                    }}
                  />
                </div>
              </Show>
              <div class="field-group">
                <span class="label">{t("providers.headers")}</span>
                <For each={d().headers} keyed={false}>
                  {(h, i) => (
                    <div class="header-row">
                      <div class="input-box sm">
                        <input
                          type="text"
                          class="mono"
                          placeholder={t("providers.headerName")}
                          aria-label={t("providers.headerNameLabel")}
                          value={h()[0]}
                          onInput={(e) => {
                            const k = e.currentTarget.value
                            edit((x) => ({ ...x, headers: x.headers.map((y, j) => (j === i ? [k, y[1]] : y)) }))
                          }}
                        />
                      </div>
                      <div class="input-box sm">
                        <input
                          type="text"
                          class="mono"
                          placeholder={t("providers.headerValue")}
                          aria-label={t("providers.headerValueLabel")}
                          value={h()[1]}
                          onInput={(e) => {
                            const v = e.currentTarget.value
                            edit((x) => ({ ...x, headers: x.headers.map((y, j) => (j === i ? [y[0], v] : y)) }))
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        class="icon sm"
                        aria-label={t("providers.removeHeader")}
                        onClick={() => edit((x) => ({ ...x, headers: x.headers.filter((_, j) => j !== i) }))}
                      >
                        <Close />
                      </button>
                    </div>
                  )}
                </For>
                <button
                  type="button"
                  class="dashed"
                  onClick={() => edit((x) => ({ ...x, headers: [...x.headers, ["", ""]] }))}
                >
                  <Plus /> <span>{t("providers.addHeader")}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="drawer-foot">
            <button type="button" class="btn" onClick={() => props.onClose()}>
              {t("common.cancel")}
            </button>
            <button type="button" class="btn primary" onClick={() => void save()}>
              {t("common.save")}
            </button>
          </div>
        </>
      )}
    </Show>
  )
}

// ───────── The sync drawer: the service's own model list, toggled into the provider's ─────────
const SyncDrawer = (props: { id: string; ready: () => Promise<void>; onClose: () => void }) => {
  const list = read(providers)
  const p = () => list().find((x) => x.id === props.id)
  const [remote, setRemote] = createSignal<{ models?: Listed[]; error?: string } | null>(null)
  const [q, setQ] = createSignal("")
  const shown = () => (remote()?.models ?? []).map((m) => m.id).filter((id) => hit(id, q()))
  /** Ids back to their listing rows (the groups are over ids), to add them as listed. */
  const pick = (ids: readonly string[]) => {
    const rows = new Map((remote()?.models ?? []).map((m) => [m.id, m]))
    return ids.map((id) => rows.get(id) ?? { id })
  }
  /** Models already in the list on the provider's default protocol that the listing puts on another endpoint: their
   *  format unset (one the player set stays), the listing's set. The only place a stored format is corrected. */
  const stale = (x: Provider) =>
    (remote()?.models ?? []).filter((r) => r.format && x.models.some((m) => m.id === r.id && m.format === undefined))
  const correct = (x: Provider) => {
    const fix = new Map(stale(x).map((r) => [r.id, r.format!]))
    void putProvider({ ...x, models: x.models.map((m) => (fix.has(m.id) ? { ...m, format: fix.get(m.id)! } : m)) })
  }
  onSettled(() => {
    void props
      .ready()
      .then(() => listModels(props.id))
      .then(
        (models) => setRemote({ models }),
        (e: unknown) => setRemote({ error: e instanceof Error ? e.message : String(e) }),
      )
  })
  return (
    <Show when={p()}>
      {(x) => (
        <>
          <div class="drawer-head">
            <h3>
              {x().name} {t("providers.models")}
            </h3>
            <Show when={remote()?.models}>{(models) => <span class="tag mono">{models().length}</span>}</Show>
            <span class="spacer" />
            <button
              type="button"
              class="btn sm ghost"
              disabled={!remote()?.models?.length}
              onClick={() => addModels(x(), remote()?.models ?? [])}
            >
              <Plus /> <span>{t("providers.addAll")}</span>
            </button>
            <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onClose()}>
              <Close />
            </button>
          </div>
          <div class="drawer-search">
            <div class="input-box">
              <Clue aria-hidden="true" />
              <input
                type="search"
                placeholder={t("providers.searchModels")}
                aria-label={t("providers.searchModelsLabel")}
                value={q()}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
            </div>
          </div>
          <Show when={stale(x()).length}>
            {(n) => (
              <div class="drawer-note">
                <span>{t("providers.staleModels", { n: n() })}</span>
                <button type="button" class="btn xs" onClick={() => correct(x())}>
                  {t("providers.correct")}
                </button>
              </div>
            )}
          </Show>
          <div class="drawer-body scroller">
            <Show when={remote()} fallback={<p class="none">{t("providers.fetching")}</p>}>
              {(r) => (
                <Show when={!r().error} fallback={<p class="none err">{r().error}</p>}>
                  <For
                    each={grouped(shown())}
                    keyed={(g) => g[0]}
                    fallback={<p class="none">{t("providers.noMatch")}</p>}
                  >
                    {(g) => (
                      <details class="group" open>
                        <summary>
                          <Next class="chev" />
                          <span>{g()[0]}</span>
                          <span class="tag mono">{g()[1].length}</span>
                          <span class="acts">
                            <button
                              type="button"
                              class="icon sm"
                              aria-label={t("providers.addGroup")}
                              disabled={g()[1].every((id) => x().models.some((m) => m.id === id))}
                              onClick={quiet(() => addModels(x(), pick(g()[1])))}
                            >
                              <Plus />
                            </button>
                            <button
                              type="button"
                              class="icon sm"
                              aria-label={t("providers.removeGroupAll")}
                              disabled={!g()[1].some((id) => x().models.some((m) => m.id === id))}
                              onClick={quiet(() => removeModels(x(), g()[1]))}
                            >
                              <Minus />
                            </button>
                          </span>
                        </summary>
                        <For each={g()[1]} keyed={(id) => id}>
                          {(id) => {
                            const added = () => x().models.some((m) => m.id === id())
                            return (
                              <div class={{ "m-row": true, added: added() }}>
                                <Family id={id()} />
                                <ModelName id={id()} />
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label={added() ? t("providers.removeModel") : t("models.addModel")}
                                  onClick={() => (added() ? removeModels(x(), [id()]) : addModels(x(), pick([id()])))}
                                >
                                  <Show when={added()} fallback={<Plus />}>
                                    <Minus />
                                  </Show>
                                </button>
                              </div>
                            )
                          }}
                        </For>
                      </details>
                    )}
                  </For>
                </Show>
              )}
            </Show>
          </div>
        </>
      )}
    </Show>
  )
}

// ───────── Add a provider ─────────
const BASE_URL: Record<Format, string> = {
  "openai-compatible": "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
}
const AddProviderDialog = (props: { opener: Opener<undefined>; onAdded: (id: string) => void }) => {
  let el!: HTMLDialogElement
  const fresh = () => ({
    name: "",
    key: "",
    def: "openai-compatible" as Format,
    urls: { "openai-compatible": "https://api.openai.com", anthropic: "", gemini: "" } as Record<Format, string>,
  })
  const [draft, setDraft] = createSignal(fresh())
  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    const d = draft()
    const id = newId("provider")
    const s = d.key.trim() ? await addSecret({ name: d.name.trim(), type: "api_key", value: d.key.trim() }) : undefined
    await putProvider({
      id,
      name: d.name.trim(),
      enabled: true,
      defaultFormat: d.def,
      endpoints: Object.fromEntries(
        FORMATS.filter((f) => d.urls[f]?.trim()).map((f) => [f, { url: d.urls[f].trim() }]),
      ),
      ...(s && { secret: s.id }),
      models: [],
    })
    el.close()
    props.onAdded(id)
  }
  return (
    <Modal
      title={t("providers.addCustom")}
      dialog={(d) => {
        el = d
        props.opener(() => (setDraft(fresh()), d.showModal()))
      }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div class="modal-body scroller">
          <div class="pair">
            <label class="field-group">
              <span class="label">
                {t("providers.name")} <span class="req">*</span>
              </span>
              <input
                class="field"
                type="text"
                required
                placeholder={t("providers.nameExample")}
                value={draft().name}
                onInput={(e) => {
                  const name = e.currentTarget.value
                  setDraft((d) => ({ ...d, name }))
                }}
              />
            </label>
            <label class="field-group">
              <span class="label">{t("providers.apiKey")}</span>
              <input
                class="field mono"
                type="password"
                autocomplete="off"
                placeholder={t("providers.enterKey")}
                value={draft().key}
                onInput={(e) => {
                  const key = e.currentTarget.value
                  setDraft((d) => ({ ...d, key }))
                }}
              />
            </label>
          </div>
          <div class="endpoints">
            <span class="label dim">{t("providers.endpoints")}</span>
            <For each={FORMATS} keyed={(f) => f}>
              {(f) => (
                <div class="field-group">
                  <div class="label-row">
                    <span class="label">{FORMAT[f()]}</span>
                    <Show
                      when={draft().def === f()}
                      fallback={
                        <button type="button" class="btn xs" onClick={() => setDraft((d) => ({ ...d, def: f() }))}>
                          {t("providers.setDefault")}
                        </button>
                      }
                    >
                      <span class="tag ok">{t("common.default")}</span>
                    </Show>
                  </div>
                  <input
                    class="field mono"
                    type="url"
                    placeholder={t("providers.baseUrlOf", { url: BASE_URL[f()] })}
                    aria-label={t("providers.urlOf", { name: FORMAT[f()] })}
                    value={draft().urls[f()] ?? ""}
                    onInput={(e) => {
                      const url = e.currentTarget.value
                      setDraft((d) => ({ ...d, urls: { ...d.urls, [f()]: url } }))
                    }}
                  />
                  <Show when={draft().urls[f()]?.trim()}>
                    {(url) => {
                      const pv = () => preview(f(), url(), false)
                      return <div class={{ resolved: true, err: !pv().ok }}>{pv().text}</div>
                    }}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn primary">
            {t("common.add")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
