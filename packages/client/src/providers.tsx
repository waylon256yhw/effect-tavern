// The settings page's 模型服务 section: the provider list, one provider's detail (key, endpoint, grouped models), its
// two drawers (request settings, the service's model list) and its dialogs (add a provider, one model's settings, add a
// model by id). Every write goes through wire.ts and comes back as the list; the drafts here are the drawer's and the
// dialogs', written on Save, on close and on submit.
import type { Effort } from "@effect-tavern/provider/src/call.ts"
import type { Capabilities } from "@effect-tavern/provider/src/connection.ts"
import type { ModelEntry, Provider, SecretView } from "@effect-tavern/provider/src/providers.ts"
import type { Format } from "@effect-tavern/provider/src/url.ts"
import { createSignal, For, onSettled, Show, untrack } from "solid-js"
import { read } from "./bridge.ts"
import {
  ask,
  Avatar,
  DEFAULTS,
  Drawer,
  FORMAT,
  FORMATS,
  grouped,
  hide,
  Menu,
  Modal,
  Name,
  newId,
  preview,
  Switch,
  ToList,
  type Pane,
} from "./controls.tsx"
import { Family } from "./family.tsx"
import {
  Clue,
  Close,
  Eye,
  EyeOff,
  Fold,
  Key,
  Minus,
  Next,
  Settings as Gear,
  Snippets as Plus,
  Sync,
  Trash,
} from "./icons.tsx"
import { hats, providers, registry, secrets } from "./store.ts"
import { addSecret, deleteProvider, deleteSecret, listModels, putProvider, setSecret, testProvider } from "./wire.ts"

const EFFORTS: [Effort, string][] = [
  ["off", "关闭"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["max", "最高"],
]
const providerOf = (id: string) => registry.get(providers).find((p) => p.id === id)
/** For handlers and snapshots (the registry, not a tracked read); JSX reads `vault()` itself. */
const secretOf = (p: Provider): SecretView | undefined => registry.get(secrets).find((s) => s.id === p.secret)
const addModels = (p: Provider, ids: readonly string[]) =>
  void putProvider({
    ...p,
    models: [...p.models, ...ids.filter((id) => !p.models.some((m) => m.id === id)).map((id) => ({ id }))],
  })
const removeModels = (p: Provider, ids: readonly string[]) =>
  void putProvider({ ...p, models: p.models.filter((m) => !ids.includes(m.id)) })
/** A button inside a group's summary: it acts, the summary does not fold. */
const quiet = (run: () => void) => (e: MouseEvent) => (e.preventDefault(), e.stopPropagation(), run())
/** The endpoints with one format's URL set, or dropped when it is emptied. */
const setUrl = (p: Provider, f: Format, url: string): Provider["endpoints"] => {
  const { [f]: old, ...rest } = p.endpoints
  return url.trim() ? { ...rest, [f]: { ...old, url: url.trim() } } : rest
}
const DRAWER_OUT = 250 // ms: past the drawer's --dur-3 slide, so its content leaves with it
/** Opens a dialog component from its parent: the dialog hands its open function up through `opener`. */
type Opener<A> = (open: (a: A) => void) => void

export const Providers = (props: Pane) => {
  const list = read(providers)
  const [search, setSearch] = createSignal("")
  const shown = () => list().filter((p) => p.name.toLowerCase().includes(search().toLowerCase()))
  const current = () => list().find((p) => p.id === props.picked) ?? list()[0]
  let openAdd: () => void = () => {}
  return (
    <>
      <aside class="master-card" aria-label="服务商">
        <div class="master-top">
          <div class="input-box">
            <Clue aria-hidden="true" />
            <input
              type="search"
              placeholder="搜索模型平台..."
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
        <div class="master-foot">
          <button type="button" class="btn" onClick={() => openAdd()}>
            <Plus /> <span>添加服务商</span>
          </button>
        </div>
      </aside>
      <section class="detail-card" aria-label="服务商详情">
        {/* keyed by id: another provider is a fresh detail (key, probe, search, drawer start over), a save is not */}
        <Show when={current()?.id} keyed fallback={<div class="empty">尚未添加服务商</div>}>
          {(id) => <ProviderDetail id={id} onBack={props.onBack} />}
        </Show>
      </section>
      <AddProviderDialog opener={(f) => (openAdd = () => f(undefined))} onAdded={props.onPick} />
    </>
  )
}

const ProviderDetail = (props: { id: string; onBack: () => void }) => {
  const list = read(providers)
  const vault = read(secrets)
  const p = () => list().find((x) => x.id === props.id)
  const save = (f: (p: Provider) => Provider) => {
    const x = p()
    if (x) void putProvider(f(x))
  }
  const [typed, setTyped] = createSignal("") // a key being typed: never shown back once saved
  const [reveal, setReveal] = createSignal(false)
  const [keyName, setKeyName] = createSignal("")
  const [probe, setProbe] = createSignal<{ ok: boolean; text: string } | null>(null)
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
   *  place; on a secret the player named, or under a name given in the vault, it is a new secret. */
  // the key's write in flight: a drawer's first request and the probe wait for it, or they would go out keyless
  let savingKey: Promise<void> | undefined
  const keySaved = () => savingKey ?? Promise.resolve()
  const storeKey = (name: string): Promise<void> => {
    const run: Promise<void> = writeKey(name).finally(() => {
      if (savingKey === run) savingKey = undefined
    })
    savingKey = run
    return run
  }
  const writeKey = async (name: string) => {
    const x = p()
    const value = typed().trim()
    if (!x || !value) return
    const own = secretOf(x)
    setTyped("")
    setKeyName("")
    if (!name.trim() && own && own.name === x.name) return setSecret(own.id, { name: own.name, type: own.type, value })
    const s = await addSecret({ name: name.trim() || x.name, type: own?.type ?? "api_key", value })
    await putProvider({ ...x, secret: s.id })
  }
  const runProbe = async () => {
    const x = p()
    if (!x) return
    if (typed().trim()) void storeKey("")
    await keySaved()
    setProbe({ ok: true, text: "…" })
    setProbe(await testProvider(x.id, x.models[0]?.id))
  }
  const endpoints = (x: Provider) => FORMATS.filter((f) => x.endpoints[f]?.url.trim()).length
  const models = (x: Provider) =>
    x.models.map((m) => m.id).filter((id) => id.toLowerCase().includes(mq().toLowerCase()))

  onSettled(() => {
    // the page's Escape leaves the drawer to this: it closes the drawer, not the page (settings.tsx checks the DOM)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(":popover-open, dialog[open]") && drawer()) shut()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  })

  return (
    <Show when={p()}>
      {(x) => (
        <>
          <header class="detail-header">
            <ToList onBack={props.onBack} />
            <Name value={x().name} label="服务商名称" onCommit={(name) => save((y) => ({ ...y, name }))} />
            <span class="spacer" />
            <button
              type="button"
              class="icon sm"
              aria-label="删除服务商"
              onClick={() => ask(`删除服务商「${x().name}」？`, () => void deleteProvider(x().id))}
            >
              <Trash />
            </button>
            <Switch on={x().enabled} label="启用服务商" onFlip={() => save((y) => ({ ...y, enabled: !y.enabled }))} />
          </header>
          <div class="detail-scroll scroller">
            <div class="block">
              <div class="block-title">
                <h3>API 密钥</h3>
                <div class="right">
                  <Show when={probe()}>
                    {(t) => <span class={{ tag: true, mono: true, ok: t().ok, bad: !t().ok }}>{t().text}</span>}
                  </Show>
                </div>
              </div>
              <div
                class="row keyrow"
                onFocusOut={(e) =>
                  !e.currentTarget.contains(e.relatedTarget as Node | null) && typed().trim() && void storeKey("")
                }
              >
                <div class="input-box grow">
                  <input
                    type={reveal() ? "text" : "password"}
                    class="mono"
                    autocomplete="off"
                    value={typed()}
                    placeholder={vault().find((s) => s.id === x().secret)?.hint ?? "输入或从密钥库选择"}
                    aria-label="API 密钥"
                    onInput={(e) => setTyped(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && void storeKey("")}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={reveal() ? "隐藏密钥" : "显示密钥"}
                    onClick={() => setReveal(!reveal())}
                  >
                    <Show when={reveal()} fallback={<Eye />}>
                      <EyeOff />
                    </Show>
                  </button>
                </div>
                <button type="button" class="icon boxed" aria-label="密钥库" popovertarget="vault">
                  <Key />
                </button>
                <div id="vault" class="snippets vault" popover>
                  <div class="vault-head">
                    <span>密钥库</span>
                  </div>
                  <Show when={typed().trim()}>
                    <div class="row">
                      <div class="input-box grow sm">
                        <input
                          type="text"
                          placeholder="密钥名称"
                          value={keyName()}
                          onInput={(e) => setKeyName(e.currentTarget.value)}
                        />
                      </div>
                      <button
                        type="button"
                        class="btn sm"
                        onClick={(e) => (hide(e.currentTarget), void storeKey(keyName()))}
                      >
                        存入当前密钥
                      </button>
                    </div>
                  </Show>
                  <For each={vault()} keyed={(s) => s.id}>
                    {(s) => (
                      <div class="vault-row" aria-current={s().id === x().secret ? "true" : undefined}>
                        <button
                          type="button"
                          class="pick"
                          onClick={(e) => {
                            hide(e.currentTarget)
                            setTyped("")
                            void putProvider({ ...x(), secret: s().id })
                          }}
                        >
                          <span class="name">{s().name}</span>
                          <span class="mono hint">{s().hint}</span>
                        </button>
                        <button
                          type="button"
                          class="icon sm"
                          aria-label="删除密钥"
                          onClick={() =>
                            ask(`删除密钥「${s().name}」？用到它的服务商将没有密钥。`, () => void deleteSecret(s().id))
                          }
                        >
                          <Trash />
                        </button>
                      </div>
                    )}
                  </For>
                  <Show when={!vault().length}>
                    <p class="none">密钥库为空</p>
                  </Show>
                </div>
                <button type="button" class="btn" onClick={() => void runProbe()}>
                  检测
                </button>
              </div>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>API 地址</h3>
                <button type="button" class="link" onClick={() => open("endpoint")}>
                  添加端点
                </button>
                <div class="right">
                  <span class="tag">
                    {FORMAT[x().defaultFormat]} · 默认
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
                    aria-label="API 地址"
                    onChange={(e) =>
                      save((y) => ({ ...y, endpoints: setUrl(y, y.defaultFormat, e.currentTarget.value) }))
                    }
                  />
                </div>
                <button type="button" class="icon boxed" aria-label="请求配置" onClick={() => open("endpoint")}>
                  <Gear />
                </button>
              </div>
            </div>

            <div class="block">
              <div class="block-title">
                <h3>模型</h3>
                <button
                  type="button"
                  class="icon sm"
                  aria-label="展开或折叠分组"
                  aria-pressed={folded() ? "true" : "false"}
                  onClick={() => setFolded(!folded())}
                >
                  <Fold />
                </button>
                <label class="inline-search" data-open={searching() || !!mq() ? "true" : "false"}>
                  <Clue aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="搜索模型..."
                    aria-label="搜索模型"
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
                  <div class="btn-join">
                    <button type="button" class="btn sm" onClick={() => open("sync")}>
                      <Sync /> <span>同步模型</span>
                    </button>
                    <button type="button" class="btn sm" aria-label="手动添加模型" onClick={() => openAddModel()}>
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
                      <span>{mq() ? "无匹配模型" : "尚未添加模型"}</span>
                      <Show when={!mq()}>
                        <button type="button" class="btn sm" onClick={() => open("sync")}>
                          <Sync /> 同步模型列表
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
                            aria-label="移除分组"
                            onClick={quiet(() =>
                              ask(`移除「${g()[0]}」分组的 ${g()[1].length} 个模型？`, () => removeModels(x(), g()[1])),
                            )}
                          >
                            <Trash />
                          </button>
                        </span>
                      </summary>
                      <For each={g()[1]} keyed={(id) => id}>
                        {(id) => (
                          <div class="m-row">
                            <Family id={id()} />
                            <span class="m-name">{id()}</span>
                            <button
                              type="button"
                              class="icon sm"
                              aria-label="模型设置"
                              onClick={() => openModel(x().models.find((m) => m.id === id())!)}
                            >
                              <Gear />
                            </button>
                            <button
                              type="button"
                              class="icon sm"
                              aria-label="移除模型"
                              onClick={() => removeModels(x(), [id()])}
                            >
                              <Minus />
                            </button>
                          </div>
                        )}
                      </For>
                    </details>
                  )}
                </For>
              </div>
            </div>
          </div>

          <Drawer open={!!drawer()} label={shown() === "sync" ? "同步模型" : "请求配置"} onClose={shut}>
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
  type: SecretView["type"]
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
  type: secretOf(p)?.type ?? "api_key",
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
    const s = secretOf(p)
    if (s && s.type !== d.type) await setSecret(s.id, { name: s.name, type: d.type })
    await putProvider(applied(p, d))
    props.onClose()
  }
  return (
    <Show when={r()}>
      {(d) => (
        <>
          <div class="drawer-head">
            <h3>请求配置</h3>
            <span class="spacer" />
            <button type="button" class="icon sm" aria-label="关闭" onClick={() => props.onClose()}>
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
                            设为默认
                          </button>
                        }
                      >
                        <span class="tag ok">默认</span>
                      </Show>
                    </span>
                    <span class="exact">
                      <span>精确前缀</span>
                      <Switch
                        on={d().endpoints[f()].exactPrefix}
                        label={`${FORMAT[f()]} 精确前缀`}
                        onFlip={() => setEndpoint(f(), { exactPrefix: !d().endpoints[f()].exactPrefix })}
                      />
                    </span>
                  </div>
                  <div class="input-box">
                    <input
                      type="url"
                      class="mono"
                      value={d().endpoints[f()].url}
                      placeholder="Base URL: https://example.com"
                      aria-label={`${FORMAT[f()]} 地址`}
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
              <div class="pair">
                <div class="field-group">
                  <span class="label">认证方式</span>
                  <Menu
                    small
                    label="认证方式"
                    value={d().type}
                    options={[
                      { value: "api_key", label: "API Key Header" },
                      { value: "auth_token", label: "Bearer Token" },
                    ]}
                    onPick={(type) => edit((x) => ({ ...x, type }))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">缓存有效期</span>
                  <Menu
                    small
                    label="缓存有效期"
                    value={d().ttl}
                    options={[
                      { value: "5m", label: "5 分钟" },
                      { value: "1h", label: "1 小时" },
                    ]}
                    onPick={(ttl) => edit((x) => ({ ...x, ttl }))}
                  />
                </div>
              </div>
              <div class="field-group">
                <span class="label">网络代理</span>
                <Menu
                  small
                  label="网络代理"
                  value={d().proxy}
                  options={[
                    { value: "env", label: "跟随系统环境" },
                    { value: "direct", label: "强制直连" },
                    { value: "custom", label: "自定义代理地址" },
                  ]}
                  onPick={(proxy) => edit((x) => ({ ...x, proxy }))}
                />
                <Show when={d().proxy === "custom"}>
                  <div class="input-box sm">
                    <input
                      type="url"
                      class="mono"
                      placeholder="http://127.0.0.1:7890"
                      aria-label="代理地址"
                      value={d().proxyUrl}
                      onInput={(e) => {
                        const proxyUrl = e.currentTarget.value
                        edit((x) => ({ ...x, proxyUrl }))
                      }}
                    />
                  </div>
                </Show>
              </div>
              <div class="field-group">
                <span class="label">自定义请求头</span>
                <For each={d().headers} keyed={false}>
                  {(h, i) => (
                    <div class="header-row">
                      <div class="input-box sm">
                        <input
                          type="text"
                          class="mono"
                          placeholder="Header"
                          aria-label="请求头名称"
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
                          placeholder="Value"
                          aria-label="请求头值"
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
                        aria-label="移除请求头"
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
                  <Plus /> <span>添加请求头</span>
                </button>
              </div>
            </div>
          </div>
          <div class="drawer-foot">
            <button type="button" class="btn" onClick={() => props.onClose()}>
              取消
            </button>
            <button type="button" class="btn primary" onClick={() => void save()}>
              保存
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
  const [remote, setRemote] = createSignal<{ ids?: string[]; error?: string } | null>(null)
  const [q, setQ] = createSignal("")
  const shown = () => (remote()?.ids ?? []).filter((id) => id.toLowerCase().includes(q().toLowerCase()))
  onSettled(() => {
    void props
      .ready()
      .then(() => listModels(props.id))
      .then(
        (ids) => setRemote({ ids }),
        (e: unknown) => setRemote({ error: e instanceof Error ? e.message : String(e) }),
      )
  })
  return (
    <Show when={p()}>
      {(x) => (
        <>
          <div class="drawer-head">
            <h3>{x().name} 模型</h3>
            <Show when={remote()?.ids}>{(ids) => <span class="tag mono">{ids().length}</span>}</Show>
            <span class="spacer" />
            <button
              type="button"
              class="btn sm ghost"
              disabled={!remote()?.ids?.length}
              onClick={() => addModels(x(), remote()?.ids ?? [])}
            >
              <Plus /> <span>添加全部</span>
            </button>
            <button type="button" class="icon sm" aria-label="关闭" onClick={() => props.onClose()}>
              <Close />
            </button>
          </div>
          <div class="drawer-search">
            <div class="input-box">
              <Clue aria-hidden="true" />
              <input
                type="search"
                placeholder="搜索模型..."
                aria-label="搜索模型"
                value={q()}
                onInput={(e) => setQ(e.currentTarget.value)}
              />
            </div>
          </div>
          <div class="drawer-body scroller">
            <Show when={remote()} fallback={<p class="none">正在获取模型列表…</p>}>
              {(r) => (
                <Show when={!r().error} fallback={<p class="none err">{r().error}</p>}>
                  <For each={grouped(shown())} keyed={(g) => g[0]} fallback={<p class="none">无匹配模型</p>}>
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
                              aria-label="添加分组全部模型"
                              disabled={g()[1].every((id) => x().models.some((m) => m.id === id))}
                              onClick={quiet(() => addModels(x(), g()[1]))}
                            >
                              <Plus />
                            </button>
                            <button
                              type="button"
                              class="icon sm"
                              aria-label="移除分组全部模型"
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
                                <span class="m-name">{id()}</span>
                                <button
                                  type="button"
                                  class="icon sm"
                                  aria-label={added() ? "移除模型" : "添加模型"}
                                  onClick={() => (added() ? removeModels(x(), [id()]) : addModels(x(), [id()]))}
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

// ───────── The model dialog: a draft of one entry, written when the dialog closes ─────────
const formatOf = (p: Provider, m: ModelEntry) => m.format ?? p.defaultFormat
const capOf = <K extends keyof Capabilities>(p: Provider, m: ModelEntry, k: K): Capabilities[K] =>
  (m.capabilities?.[k] as Capabilities[K] | undefined) ?? DEFAULTS[formatOf(p, m)][k]
const without = <K extends Exclude<keyof ModelEntry, "id">>(
  m: ModelEntry,
  k: K,
  v: ModelEntry[K] | undefined,
): ModelEntry => {
  const { [k]: _, ...rest } = m
  return (v === undefined ? rest : { ...rest, [k]: v }) as ModelEntry
}

const ModelDialog = (props: { id: string; opener: Opener<ModelEntry> }) => {
  const list = read(providers)
  const hatList = read(hats)
  const p = () => list().find((x) => x.id === props.id)
  let el!: HTMLDialogElement
  const [entry, setEntry] = createSignal<ModelEntry | null>(null)
  const change = (f: (m: ModelEntry) => ModelEntry) => setEntry((m) => (m ? f(m) : m))
  /** An override set only where it differs from the format's default. */
  const setCap = <K extends keyof Capabilities>(k: K, v: Capabilities[K]) => {
    const x = p()
    if (x)
      change((m) => {
        const { [k]: _, ...caps } = m.capabilities ?? {}
        const next = v === DEFAULTS[formatOf(x, m)][k] ? caps : { ...caps, [k]: v }
        const { capabilities: _c, ...rest } = m
        return Object.keys(next).length ? { ...rest, capabilities: next } : rest
      })
  }
  const conflict = (x: Provider, m: ModelEntry) =>
    hatList()
      .find((h) => h.id === m.hat)
      ?.narrate?.tail?.at(-1)?.role === "assistant" && !capOf(x, m, "prefill")
  const commit = () => {
    const m = entry()
    const x = p()
    setEntry(null)
    const stored = x?.models.find((y) => y.id === m?.id)
    if (m && x && JSON.stringify(m) !== JSON.stringify(stored))
      void putProvider({ ...x, models: x.models.map((y) => (y.id === m.id ? m : y)) })
  }
  return (
    <Modal
      title={entry()?.id ?? ""}
      dialog={(d) => {
        el = d
        props.opener((m) => (setEntry(m), d.showModal()))
      }}
      onClose={commit}
    >
      <Show when={entry() && p() ? { m: entry()!, x: p()! } : undefined}>
        {(c) => (
          <>
            <div class="modal-body scroller">
              <Show when={conflict(c().x, c().m)}>
                <div class="warn">所选提示词模板以 Assistant 消息结尾，请开启下方「允许预填续写」。</div>
              </Show>
              <div class="pair">
                <div class="field-group">
                  <span class="label">提示词模板</span>
                  <Menu
                    label="提示词模板"
                    value={c().m.hat ?? ""}
                    options={[
                      { value: "", label: "无模板" },
                      ...hatList().map((h) => ({ value: h.id, label: h.name })),
                    ]}
                    onPick={(v) => change((m) => without(m, "hat", v || undefined))}
                  />
                </div>
                <div class="field-group">
                  <span class="label">请求端点协议</span>
                  <Menu
                    label="请求端点协议"
                    value={c().m.format ?? ""}
                    options={[
                      { value: "", label: `默认 (${FORMAT[c().x.defaultFormat]})` },
                      ...FORMATS.map((f) => ({ value: f, label: FORMAT[f] })),
                    ]}
                    onPick={(v) => change((m) => without(m, "format", (v || undefined) as Format | undefined))}
                  />
                </div>
              </div>
              <div class="field-group">
                <span class="label">结构化输出方式</span>
                <Menu
                  label="结构化输出方式"
                  value={capOf(c().x, c().m, "structured")}
                  options={[
                    { value: "schema", label: "JSON Schema (原生)" },
                    { value: "tool", label: "Tool Call (强制工具)" },
                    { value: "json", label: "JSON Object (提示词内嵌)" },
                  ]}
                  onPick={(v) => setCap("structured", v)}
                />
              </div>
              <Effort value={c().m.effort} onPick={(v) => change((m) => without(m, "effort", v))} />
              <div class="pair">
                <label class="field-group">
                  <span class="label">上下文上限 (Token)</span>
                  <input
                    class="field mono"
                    type="number"
                    min="1024"
                    step="1024"
                    placeholder="默认"
                    value={c().m.contextTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "contextTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
                <label class="field-group">
                  <span class="label">最大输出 (Token)</span>
                  <input
                    class="field mono"
                    type="number"
                    min="256"
                    step="256"
                    placeholder="默认"
                    value={c().m.maxOutputTokens ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.currentTarget.value, 10)
                      change((m) => without(m, "maxOutputTokens", n > 0 ? n : undefined))
                    }}
                  />
                </label>
              </div>
              <div class="inline-row">
                <span>允许预填续写 (Prefill)</span>
                <Switch
                  on={capOf(c().x, c().m, "prefill")}
                  label="允许预填续写"
                  onFlip={() => setCap("prefill", !capOf(c().x, c().m, "prefill"))}
                />
              </div>
              <div class="inline-row">
                <span>回传历史思考过程</span>
                <Switch
                  on={capOf(c().x, c().m, "reasoningBack")}
                  label="回传历史思考过程"
                  onFlip={() => setCap("reasoningBack", !capOf(c().x, c().m, "reasoningBack"))}
                />
              </div>
            </div>
            <div class="modal-foot">
              <button type="button" class="btn primary" onClick={() => el.close()}>
                完成
              </button>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}

/** The effort stepper: five stops on a rail; unset reads 默认, and pressing the set stop unsets it. */
const Effort = (props: { value: Effort | undefined; onPick: (v: Effort | undefined) => void }) => {
  const at = () => EFFORTS.findIndex(([e]) => e === props.value)
  return (
    <div class="field-group">
      <div class="label-row">
        <span class="label">思考强度</span>
        <span class="tag mono">{EFFORTS[at()]?.[1] ?? "默认"}</span>
      </div>
      <div class="effort" role="radiogroup" aria-label="思考强度">
        <div class="rail">
          <div class="fill" style={{ width: `${Math.max(0, at()) * 25}%` }} />
        </div>
        <div class="stops">
          <For each={EFFORTS} keyed={false}>
            {(e, i) => (
              <button
                type="button"
                role="radio"
                aria-checked={at() === i ? "true" : "false"}
                class={{ stop: true, passed: i < at(), active: at() === i }}
                onClick={() => props.onPick(props.value === e()[0] ? undefined : e()[0])}
              >
                <span class="dot" />
                <span class="tick">{e()[1]}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

// ───────── Add a model by id; add a provider ─────────
const AddModelDialog = (props: { id: string; opener: Opener<undefined> }) => {
  let el!: HTMLDialogElement
  const [id, setId] = createSignal("")
  return (
    <Modal
      title="添加模型"
      narrow
      dialog={(d) => {
        el = d
        props.opener(() => (setId(""), d.showModal()))
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const p = providerOf(props.id)
          if (p && id().trim()) addModels(p, [id().trim()])
          el.close()
        }}
      >
        <div class="modal-body scroller">
          <label class="field-group">
            <span class="label">
              模型 ID <span class="req">*</span>
            </span>
            <input
              class="field mono"
              type="text"
              required
              placeholder="例如 claude-opus-4-6"
              value={id()}
              onInput={(e) => setId(e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" onClick={() => el.close()}>
            取消
          </button>
          <button type="submit" class="btn primary">
            添加
          </button>
        </div>
      </form>
    </Modal>
  )
}

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
      title="添加自定义服务商"
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
                服务商名称 <span class="req">*</span>
              </span>
              <input
                class="field"
                type="text"
                required
                placeholder="例如 OpenAI / 硅基中转"
                value={draft().name}
                onInput={(e) => {
                  const name = e.currentTarget.value
                  setDraft((d) => ({ ...d, name }))
                }}
              />
            </label>
            <label class="field-group">
              <span class="label">API 密钥</span>
              <input
                class="field mono"
                type="password"
                autocomplete="off"
                placeholder="输入 API 密钥"
                value={draft().key}
                onInput={(e) => {
                  const key = e.currentTarget.value
                  setDraft((d) => ({ ...d, key }))
                }}
              />
            </label>
          </div>
          <div class="endpoints">
            <span class="label dim">端点设置</span>
            <For each={FORMATS} keyed={(f) => f}>
              {(f) => (
                <div class="field-group">
                  <div class="label-row">
                    <span class="label">{FORMAT[f()]}</span>
                    <Show
                      when={draft().def === f()}
                      fallback={
                        <button type="button" class="btn xs" onClick={() => setDraft((d) => ({ ...d, def: f() }))}>
                          设为默认
                        </button>
                      }
                    >
                      <span class="tag ok">默认</span>
                    </Show>
                  </div>
                  <input
                    class="field mono"
                    type="url"
                    placeholder={`Base URL: ${BASE_URL[f()]}`}
                    aria-label={`${FORMAT[f()]} 地址`}
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
            取消
          </button>
          <button type="submit" class="btn primary">
            添加
          </button>
        </div>
      </form>
    </Modal>
  )
}
