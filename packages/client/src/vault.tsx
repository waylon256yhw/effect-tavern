// The key vault's drawer (the settings page's 模型服务 section, providers.tsx): every secret, named, typed, revealed or
// copied one click at a time, and a new one added. Secrets are their own table (/secrets); the drawer opens from the
// list with no provider in hand, or from a provider's detail, which then has a 使用 on every card.
import type { SecretView } from "@effect-tavern/provider/src/providers.ts"
import { createSignal, For, Show } from "solid-js"
import { read } from "./bridge.ts"
import { ask, copyKey, Menu } from "./controls.tsx"
import { Check, Close, Copy, Eye, EyeOff, Trash } from "./icons.tsx"
import { providers, secrets } from "./store.ts"
import { addSecret, deleteSecret, putProvider, secretValue, setSecret } from "./wire.ts"
import { t } from "./i18n.ts"

export const AUTH: { value: SecretView["type"]; label: string }[] = [
  { value: "api_key", label: "API Key Header" },
  { value: "auth_token", label: "Bearer Token" },
]

export const VaultDrawer = (props: { for: string | undefined; onClose: () => void }) => {
  const vault = read(secrets)
  const list = read(providers)
  const target = () => list().find((p) => p.id === props.for)
  const [draft, setDraft] = createSignal<{ name: string; type: SecretView["type"]; value: string }>({
    name: "",
    type: "api_key",
    value: "",
  })
  const add = async () => {
    const d = draft()
    if (!d.name.trim() || !d.value.trim()) return
    await addSecret({ name: d.name.trim(), type: d.type, value: d.value.trim() })
    setDraft({ ...d, name: "", value: "" })
  }
  return (
    <>
      <div class="drawer-head">
        <h3>{t("common.vault")}</h3>
        <Show when={target()}>{(t) => <span class="tag">{t().name}</span>}</Show>
        <span class="spacer" />
        <button type="button" class="icon sm" aria-label={t("common.close")} onClick={() => props.onClose()}>
          <Close />
        </button>
      </div>
      <div class="drawer-body scroller">
        <div class="field-group">
          <span class="label">{t("vault.addKey")}</span>
          <div class="row">
            <div class="input-box sm grow">
              <input
                type="text"
                placeholder={t("vault.keyName")}
                aria-label={t("vault.keyName")}
                value={draft().name}
                onInput={(e) => {
                  const name = e.currentTarget.value
                  setDraft((d) => ({ ...d, name }))
                }}
              />
            </div>
            <Menu
              small
              label={t("vault.auth")}
              value={draft().type}
              options={AUTH}
              onPick={(type) => setDraft((d) => ({ ...d, type }))}
            />
          </div>
          <div class="row">
            <div class="input-box sm grow">
              <input
                type="password"
                class="mono"
                autocomplete="off"
                placeholder={t("vault.key")}
                aria-label={t("vault.key")}
                value={draft().value}
                onInput={(e) => {
                  const value = e.currentTarget.value
                  setDraft((d) => ({ ...d, value }))
                }}
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
            </div>
            <button
              type="button"
              class="btn sm"
              disabled={!draft().name.trim() || !draft().value.trim()}
              onClick={() => void add()}
            >
              {t("common.add")}
            </button>
          </div>
        </div>
        <For each={vault()} keyed={(s) => s.id} fallback={<p class="none">{t("vault.empty")}</p>}>
          {(s) => {
            const [plain, setPlain] = createSignal<string | null>(null) // read on the eye's click, dropped on the next
            const [copied, setCopied] = createSignal(false)
            const flip = async () => setPlain(plain() === null ? await secretValue(s().id) : null)
            return (
              <div class="setting-card vault-card">
                <div class="row">
                  <div class="input-box sm grow">
                    <input
                      type="text"
                      value={s().name}
                      aria-label={t("vault.keyName")}
                      onChange={(e) => {
                        const name = e.currentTarget.value.trim()
                        if (name) void setSecret(s().id, { name, type: s().type })
                      }}
                    />
                  </div>
                  <Menu
                    small
                    label={t("vault.auth")}
                    value={s().type}
                    options={AUTH}
                    onPick={(type) => void setSecret(s().id, { name: s().name, type })}
                  />
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("vault.deleteKey")}
                    onClick={() => ask(t("vault.confirmDelete", { name: s().name }), () => void deleteSecret(s().id))}
                  >
                    <Trash />
                  </button>
                </div>
                <div class="row">
                  <span class="mono hint grow">{plain() ?? s().hint}</span>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={plain() === null ? t("common.showKey") : t("common.hideKey")}
                    onClick={() => void flip()}
                  >
                    <Show when={plain() !== null} fallback={<Eye />}>
                      <EyeOff />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="icon sm"
                    aria-label={t("common.copyKey")}
                    onClick={() => void copyKey(secretValue(s().id), setCopied)}
                  >
                    <Show when={copied()} fallback={<Copy />}>
                      <Check />
                    </Show>
                  </button>
                  <Show when={target()}>
                    {(tg) => (
                      <Show
                        when={tg().secret === s().id}
                        fallback={
                          <button
                            type="button"
                            class="btn xs"
                            onClick={() => void putProvider({ ...tg(), secret: s().id })}
                          >
                            {t("vault.use")}
                          </button>
                        }
                      >
                        <span class="tag ok">{t("vault.inUse")}</span>
                      </Show>
                    )}
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </>
  )
}
