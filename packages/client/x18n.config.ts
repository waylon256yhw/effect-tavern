// x18n (#67): the static side of src/i18n.ts. `vp run verify` runs `x18n check`: a `t()` key not in zh-CN.ts, a key
// no code reads, a key en.ts lacks, a `{hole}` the English drops, a glossary term rendered another way. Our own
// `t()` has no preset, so the `{name}` placeholder syntax is declared here (without it placeholder-mismatch is a
// no-op), and hard-string detection is told what is not a word: selectors, icon paths, HTTP verbs, storage keys,
// the shader in dust.ts, the rule DSL of phrase.ts (and / or / not are the card's grammar, not the chrome's).
const braces = {
  id: "braces",
  example: "{name}",
  find: (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((m) => ({
      syntax: "braces",
      text: m[0],
      name: m[1]!,
      range: { start: m.index, end: m.index + m[0].length },
    })),
}
export default {
  sourceLocale: "zh-CN",
  locales: ["zh-CN", "en"],
  resources: [{ pattern: "src/locales/{locale}.ts" }],
  usage: {
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["src/locales/**"],
    calls: [{ callee: "t" }],
    // keys a table holds as data and `t()` reads where the word is drawn (the switches, the tabs, the stages, the
    // phases, the card page's spec rows): used, though no call names them
    keysInUse: [
      "switches.*",
      "writing.tab*",
      "models.effort*",
      "settings.stage*",
      "settings.slot*",
      "settings.providers",
      "settings.routing",
      "settings.templates",
      "settings.personas",
      "app.phase*",
      "card.spec*",
    ],
  },
  plugins: [{ name: "tavern", placeholders: [braces] }],
  glossary: [
    {
      term: "Record",
      translations: { "zh-CN": "记录" },
      note: "the per-turn readings panel; never Notes (a product) or Note (the channel)",
    },
    { term: "Swipe", translations: { "zh-CN": "换一版" } },
    { term: "Reword", translations: { "zh-CN": "重写" } },
    { term: "Status", translations: { "zh-CN": "状态" } },
    { term: "Options", translations: { "zh-CN": "选项" } },
    { term: "Timeline", translations: { "zh-CN": "时间线" } },
    { term: "Inspector", translations: { "zh-CN": "检查器" } },
    { term: "Persona", translations: { "zh-CN": "人设" } },
  ],
  checks: { "hard-string": "warning", glossary: "warning", "unused-key": "error", "missing-translation": "error" },
  extract: {
    keygen: "empty",
    // not words of the chrome: selectors, icon paths, HTTP verbs, storage keys; glyph marks (HEAD, →leaf, a count's
    // unit letter), the automation banner, the vault's two protocol names, and ago()'s "刚刚" (locale-driven already)
    ignore: [
      "/^[.#\\[]/",
      "/^~icons\\//",
      "/^(GET|POST|PUT|DELETE|PATCH)$/",
      "/^(theme|locale)$/",
      "HEAD",
      "→leaf",
      "v",
      "c",
      "T",
      "automation",
      "Bearer Token",
      "API Key Header",
      "刚刚",
    ],
    ignoreByFile: { "src/dust.ts": ["/.*/"], "src/phrase.ts": ["/.*/"], "src/probe.ts": ["no probe"] },
    templates: [
      { template: '{t("{key}"{args})}', kinds: ["jsx-text"], imports: ['import { t } from "./i18n.ts"'] },
      { template: '{attr}={t("{key}"{args})}', kinds: ["jsx-attribute"], imports: ['import { t } from "./i18n.ts"'] },
      { template: 't("{key}"{args})', kinds: ["js-string", "js-template"], imports: ['import { t } from "./i18n.ts"'] },
    ],
  },
}
