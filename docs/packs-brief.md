# 写作包 brief：enhancer 作为带 id 的实体，runtime 与 server 先行（2026-11-04，#69 §四的落地）

#69 的字段侧已成（Writing 页四节）。剩下的是包：一组带名字的玩家层东西，设置页建库、游玩中按卡挂载。11-04 三方对齐后定下的三条，不再重开：

1. **包与提示词模板（`Hat`）形态相反。** Hat 是有序、带 role 的协议消息；包是按 id 合并、每项独立的集合，没有 role、没有顺序、碰不到请求形状。
2. **IP 世界书进包，README 的边界句写错了。** 边界是"enhancer 不碰卡的 `Cond` 与状态"（不解锁、不开窗、不读 state），不是"不碰 lore"。lookup 通道本来就不是卡专属的（`session.ts` 的 `readable` 已是卡的 lore 条目 + recall 产物的行），玩家层词条是第三个来源。
3. **玩家层文本只有三种投递位置**：常驻头区（`Fragment.at` 缺省）、轮末叮嘱（`at: "tail"`）、按需查阅（词条：单层、无条件、首句即 hook）。

这一步只做 runtime + server + 文档，客户端（设置页「写作包」tab、Writing 页顶部的挂载 chips）另一个 PR，等 Gemini 的原型。

## 一、Schema（`packages/runtime/src/fragment.ts`，与 `Player`、`Hat` 同处）

```ts
export const PackEntry = Schema.Struct({ id: Schema.String, text: Schema.String }) // 一层；首句是 hook（lore.ts `hook`）
export const Pack = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  fragments: Schema.optionalKey(Schema.Array(Fragment)), // id 是槽位（style / setting / voice…），at 定头尾
  entries: Schema.optionalKey(Schema.Array(PackEntry)),
  lexicon: Schema.optionalKey(Schema.Array(Entry)),
  products: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
  snippets: Schema.optionalKey(Schema.Array(Snippet)),
})
// Player 上加一个字段：按卡挂载，同 persona
packs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))) // card id → 挂着的包 id，按挂载顺序
```

不进包的：`asks`（#69 §三：只在 Inspector）、`format`（打字便利，不是写法）、多层词条、`unlock` / `offer`、`when`。单项开关只有 `Fragment.enabled` 已有的那一个；词条、禁词、快捷输入不要就删。

## 二、五个接缝，每个一处

包在 session 里的读法和 `hat` / `persona` 一样：**每次请求从库里读**，构造参数 `packs?: () => readonly Pack[]`，挂载集 = `player.packs?.[card.id] ?? []` 按序查 id（库里没有的 id 跳过）。`setPlayer` 已经会刷新 `player`，不必再加什么。

| 接缝 | 现在 | 改成 |
|---|---|---|
| 框架 `frame()` | writing → global → forCard | writing → global → **挂载的包的 fragments（按挂载顺序）** → forCard。包的 mode 缺省取 `defaults.forCard`（挂到一张卡上是这张卡的决定）。forCard 仍最后写入 `mine`，玩家自己的本卡补充压过包。尾区 fragment 走它已有的路（`request.ts` `tail`），不另开 |
| lookup 索引 `L` | `makeLore(card.lore)` 建一次 | 每次请求重建：`card.lore` + 挂载的包的 entries，每条 `{ id: \`${pack.id}/${e.id}\`, layers: [e.text], unlock: () => 1 }`，无 `offer`。**id 前缀是代码锁**（frame 按 id 合并、投递按 id 记，不能撞卡的条目）；`/` 不与 `entryRef` 的 `@…#…` 冲突 |
| 回放 `derived.ts` `textIn` | `L.text(d)` 对未知 id 抛 `byId.get(d.id)!` | 未知 id 回 `""`，不抛。场景：第 3 轮投递了 `packA/x`，第 5 轮卸了包或删了包，旧节点的转录稿、`costIn`、投影照常算。与今天卡作者删一条 lore 的行为一致，不另做快照。`makeDerived` 的 `L` / `lore` 相应改成按请求读（函数），`readableOn` 的 `lore.length ? … : []` 短路要连包一起算 |
| 润色 `scan` | `[...player.writing.lexicon, ...card.lexicon]` | `[...玩家的, ...挂载的包的（按序）, ...卡的]` |
| 产物 `resolveProducts` | `resolve(defaults, card.products, player.products)` | 玩家的 toggle 压包的：`{ ...包1.products, ...包2.products, ...player.products }` 作第三参。`setPlayer` 已重算 |
| 快捷输入 `cardView.snippets` | `[...player.snippets, ...defaults]` | `[...player.snippets, ...挂载的包的, ...defaults]`，同样的 `note` 通道过滤 |

`cardView.meta.lore` 的计数仍是卡自己的尺寸，不含包；节点的 `readable` 自然含包的 hook。

## 三、Server

- `library.ts` / `data.ts`：`packs` 表，与 `hats` 同形（id → 一行 JSON，`Pack` 在边界解码）。删除一个包时从 `Player.packs` 的每张卡上摘掉它的 id 并写回玩家层（`personas.del` 已是这个样子）。
- `serve.ts`：`GET /packs`、`PUT /packs/<id>`（整行，解码为 `Pack`）、`DELETE /packs/<id>`，都答列表；头注释的路由清单补上。挂载走现有 `PUT /player`（`packs` 字段）。
- YAML ↔ JSON 是客户端那步的事（导入 / 导出文件），服务端只存 JSON 行，和 Hat 一样。仓库里带的第一个包（kill-slop 词表 + 一条尾区文风）等用户的文案，不在这个 PR。

## 四、文档

- README `enhancer` 那段：把"碰不到虚构、规则、lore"改成"碰不到卡的 `Cond` 与状态：不解锁、不开窗、不读 state；词条单层、无条件、首句即 hook"。
- GLOSSARY **enhancer** 条：加"词条"与"按卡挂载（`Player.packs`）"；**lore** 条加一句"玩家层的词条走同一索引，id 带包前缀"。
- `docs/client-shape.md` 若列了路由，补 `/packs`。

## 五、测试（bun assert，`test/*.ts`，`vp run verify` 绿）

runtime：

1. `frame`：包的 `style` 槽位在 global 之后、forCard 之前；mode 缺省 `defaults.forCard`；forCard 同槽压过包。
2. lookup 索引含 `pack/entry` 形式的 id，hook 是首句；未挂载的包不在 `readable` 里；同一卡的 lore 条目照旧。
3. 回放：一条已投递的 `packA/x` 在包卸载后，`textIn` 回空串，`node()` 与 `costIn` 不抛。
4. `scan` 命中包的词表；`resolveProducts` 玩家 toggle 压包的；`cardView.snippets` 顺序。

server：`/packs` 三条路由；`DELETE` 后 `/player` 的 `packs` 里不再有它。

## 六、不做

- 客户端任何改动。
- 包里的 `asks`、多层词条、每条词条 / 禁词的开关字段。
- 包的 lint（`unknown-frame-slot` 对包的 fragment）；等第一个真实包。
- 投递文本快照到 `Turn`。

## 七、增补（2026-11-04 下午）：包的 `products{}` 换成小剧场声明

原型暴露的问题：`products: Record<string, boolean>` 在离开具体卡的设置页里只能拨 `inner` / `options` 两个固定钮。按 `kindOf` 三分，world 产物的列名绑死在一张卡上，context 只有 `notes`（harness 常开），**只有 theater 能离开卡**。这一节是 #76 §三 第一条（玩家声明的产物）经由 #69 提前落地；§三 的 `view` 词表、tags、随机抽一条仍不做。

### 形状：受限的 `Product` 补丁

```ts
// fragment.ts，与 Pack 同处
export const Theater = Schema.Struct({
  id: Schema.String,
  label: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String), // 缺省 = 保留被补丁的那条的问法（改内置 inner 的开关而不改文字）
  on: Schema.optionalKey(Schema.Boolean), // 挂载时的默认；player.products[id] 仍是最后一道开关
})
// Player 加 theaters?: Theater[]（全局，Writing 页编辑）；Pack 的 products 删除，换 theaters?: Theater[]
```

一条小剧场只带 label / text / on。**新 id** 编译成固定的 `stage: "narrate"`、`shape: { kind: "text" }`，无 `feed` / `recall` / `fold` / `when`，`text` 必填；**补丁到已有条目**只改这三项，那条的 `stage`、`shape.max`、`when` 原样保留（包不能抬卡的上限、改卡的条件，也不改谁写它）。（落地 #142 时定：原稿"新 id 缺 text 走现有报错"改为丢弃，见下。）

### 合并：`resolve` 加一层，带一把锁

`resolve(defaults, card, theaters, toggles)`：默认 → 卡的补丁 → **小剧场补丁（挂载的包按序，再玩家自己的）** → 玩家开关。补丁按 id：撞上 `inner` 就是改它的文字与默认开关。

**锁（代码，不是提示词）**：一条小剧场补丁只能落在"不存在的 id"或"已有条目是 text 形状的 theater（`kindOf === "theater" && shape.kind === "text"`）"上。撞上 `notes`（context）、`options`（list 形状）或卡的 world 表（竹林的 `people`，`fold: { key }`）时，以及**新 id 没有 `text`** 时，**丢弃这条**，不抛：抛会让一张挂了包的卡在 session 打开时就死（`products()` 在构造时调一次）。测试断言丢弃，lint 以后再说。

### `cardView.products` 两处补

1. **加上小剧场层**：今天只 `resolve(defaults, card.products)`，玩家与包声明的小剧场前端完全看不见（Writing 页列表、动作行的索取菜单、正文下的块标题都读它）。改成同一条 `resolve` 链，**不含玩家的 `products` 开关**（`on` 仍是声明默认，客户端照旧在上面叠 `player.products`），即 `cardView(card, player, packs)` 已有的签名，里面把包与玩家的 theaters 传进去。
2. **透传 `text`**：至少 theater 类的条目带 `text`，否则 Writing 页打不开内置「人物心声」的原文来改。整条带也行，`text` 不是秘密（问法不是卡的虚构）。

客户端（不在这个 PR）：改了 `player.theaters` 或挂载后重新 `fetchCard` 一次，同快捷输入那样；Writing 页小剧场组里 `options` 只留右侧开关（list 形状，有自己的容器），text 形状的条目点开改名称与提示词。

### 测试补

- 补丁 `inner` 改文字、默认开关；新 id 成为 narrate 阶段 text 产物，`on: true` 时 narrate 的提问里出现它的块指令，`on: false` 时在 `demandable` 里。
- 锁：撞 `notes` / `options` / 一张 `{ key }` 表的小剧场被丢弃，session 照常打开。
- `cardView.products` 含包与玩家的小剧场、带 `text`，`on` 不含玩家开关。
- 包的 `products` 键：无真实包存在，不迁移；解码时多余键按 Schema 现有行为处理，测试里确认一行旧 JSON 仍能解码。

## 八、代称表（names）：`{{user}}` / `{{char}}` 与生态小剧场的兼容（2026-11-04 晚）

社区小剧场提示词几乎全带 `{{char}}` / `{{user}}`，群像卡还需要 `{{char1}}` / `{{char2}}`，难念的西幻专名需要 `{{char_place}}` 之类的代称。三方（用户、Gemini、本文）定下的形态：**一张专有名词字典，单遍纯替换，不是模板语言**。生态的 `{{setvar::…}}` / `{{random::…}}` / `{{time}}` 这类带参数、有副作用的脚本宏不做；片段互引、`Pack.entries` 作为可引用名、输出侧展开、别名都不做。

### 1. 概念与命名

- **代称（names）**：`Record<string, string>`，键是纯标识符，值是一个名字（人名、地名、作品名）。字段叫 `names`，不叫 `vars` / `macros`：它装的是专有名词，不是变量；"宏"留作生态词。GLOSSARY 加 **代称** 条，README 的 `{{char}}` 那句与 docs/card-reading.md "harness 里没有它的工作"一句改成"是一个声明的洞"。
- **洞（hole）**：文本里的 `{{key}}`。`user` / `char` 是两个约定键名，不是引擎特例。
- **三层声明**：`Card.names?`（作者默认，伴星写 `{ char: "依瑞丝" }`）、`Pack.names?`（包带的默认，诡秘包写 `{ char_place: "贝克兰德" }`）、`Player.names?: Record<cardId, Record<string, string>>`（玩家按卡指定或覆盖，同 persona / packs / tags 的模式）。
- **合并序**：`{ user: "玩家", ...card.names, ...挂载的包按序, ...player.names[card] }`，最后若有生效的人设则 `user = persona.name`（玩家覆盖卡的默认，与 persona 槽位一致）。

### 2. 纯函数（runtime，一个新文件 `names.ts`，导出给客户端共用）

```ts
export const HOLE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g
/** 填洞：全部填上回文本；有一个洞没值就回 undefined（这条不出门）。单遍，不递归。 */
export const expand = (text: string, names: Readonly<Record<string, string>>): string | undefined
/** 文本里的洞名集合，去重，按出现顺序。 */
export const holes = (text: string): string[]
```

**值的锁**：解码 `names` 时值必须是一行且不含 `{{`（Schema filter）。递归与"值里写模板"由此在定义上不存在。

### 3. 展开点：按条目，进组装之前，history 不碰

Gemini 核过 request.ts：`toP` 只套在 `Msg` 上，小剧场块指令（`blocks.asks`）、投递的 `told` / `must` / `may`、record 的 `asks` 全走 `sys(...)` 拼接，所以**不在 `toP` 做**，也不能在拼好的消息级丢弃（会把同一条 system 里正常的 `inner` 一起丢掉、或留下没有列表的悬空指令）。按条目展开，洞未填的那一条跳过：

| 条目 | 在哪展开 |
|---|---|
| frame / fiction 的 fragment、tail、hat 的 `Said` | 进 `head()` / 尾区 / hat 之前，对 `text` 逐条；未填则该条不发 |
| 产物问法 `question(p)`（record 的 `asks`、小剧场的 `blocks.asks`） | `asked` / `penned` 过滤时：`expand` 为 `undefined` 的产物本轮不问、不写块 |
| lore 与包词条的 hook（`index`）和层文本（`told` / `must` / `may`、`derived.ts` `textIn` 出口） | 进索引与投递时；未填的条目不进索引（不可被 lookup 挑中），已投递的旧节点回放同 §二 的空串规则 |
| 开场 `greet` | 落根节点时展开后存（节点是转录稿，存展开后的文字）；**洞未填则拒绝开局**，错误里带洞名 |
| `demand` | 洞未填则拒绝索取，错误里带洞名 |
| 玩家输入、history | **不展开**。输入由客户端在发送前用同一函数填（存进历史的是名字） |
| lexicon | 不展开（扫正文，不出门） |

`names` 每次请求与包一起读（`inForce` 同一处），`persona` 回调从只回 `text` 改为回 `{ name, text }`（server library.ts 把 `persona.name` 一起带出）。

### 4. 给客户端的两样（cardView）

- `names`：合并后的表（含 `user`）。客户端 snippet 插入输入框、发送前填输入，都用它。
- `holes`：当前卡 + 挂载的包 + 玩家层所有会出门的文本里扫出的洞名，减去已填的，按出现顺序。客户端据此长输入框、在小剧场 / 片段上标"需填写 `{{x}}`"。洞的集合从文本派生，不另建声明表。

### 5. 卡的 lint（lint.ts 两条）

- `unfilled-name`：卡文本（frame、fiction、greetings、lore、asks、products）里出现 `{{key}}` 而 `card.names` 没有它（`user` 除外）：作者该给默认。
- `unsupported-macro`：`{{…::…}}` 或其它非纯标识符的 `{{…}}`。

### 6. 测试

每个展开点各一条（frame、tail、hat、record ask、小剧场块、lore hook 与层、包词条、开场）；未填洞时那一条被跳过而邻条照发；开局与索取被拒且报洞名；history 里的字面 `{{char}}` 原样回传；合并序（人设名压卡的 `user`，玩家压包压卡）；值的锁（多行、含 `{{` 的值解码失败）；`holes` 的派生；两条 lint。server：`/cards/<id>` 回 `names` 与 `holes`；`PUT /player` 存 `names`。

### 7. 不在这个 PR

客户端（输入框、标记、snippet 展开）；`x18n` 式的"英文丢洞"检查不适用（没有第二语言）。

## 九、玩家层一体化：`layer.ts`（2026-11-05，三份设计比较后的合成，#69 之后的重构）

今天的状态：一个概念（harness 的提示词是带 id 的默认值，按作者覆盖），九种形状，session 里十四处"玩家自己的 + 包的 + 卡的 + 默认"各排各的序；全局片段让位给包、玩家小剧场却压过包；客户端伪造一行「全局基底」并在每个 tab 里分叉；按卡的数据散在五张 map，产物开关却是全局的；开关句子、问法、产物问法硬编码，前台看不见也改不了。这一节把它收成**一个模块、一种行、一次 resolve、结果带来源**。三份设计（最小接口 / 最大弹性 / 常见调用方优先）的合成，决定不再重开。

### 1. 一种行：`Layer`

```ts
// runtime/src/layer.ts。每个作者写的都是它：harness 叠加行、基底、每个包、本卡；卡在 resolve 内部投影成一行，不入库。
export const Layer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  fragments: optional(Array(Fragment)),   // id 是槽位（SLOTS）或自己的 id；at 头/尾；mode 对卡；入库时剥掉 when / role
  switches: optional(Writing),            // 写作开关（含 polish）；编译成 pov / verbosity 片段，排在本行自己的片段之前，mode: "yield"
  asks: optional(Array(Ask)),             // { id, text }：问法（lookup、direct、decide.*、record.*、narrate.*、polish、input.thought）与开关句子（switch.<key>.<value>）
  products: optional(Array(ProductPatch)),// harness 与卡：整补丁；其余等级：只带 label / text / on（见锁）
  entries: optional(Array(PackEntry)),    // 单层、无条件、首句即 hook；索引 id 为 `<行 id>/<条目 id>`
  lexicon: optional(Array(Entry)),
  snippets: optional(Array(Snippet)),
  format: optional(Array(Format)),
  names: optional(Names),
})
// 这个玩家在这张卡上：一行一卡，自己的表与路由
export const Local = Schema.Struct({ ...Layer.fields, card: Schema.String, mounts: optional(Array(String)), persona: optional(String), tags: optional(Array(String)) })
```

`Theater`、`Player`、`Pack`、`Player.defaults` 删除；`Pack` 即 `Layer`。`Writing` 不再带 `lexicon`（词表是行的字段）。

### 2. 一个序，一次 resolve

```ts
export interface Rows { harness?: Layer; base?: Layer; packs?: Layer[]; local?: Local; persona?: { name: string; text: string } }
export const harness = (input: "act" | "note"): Layer   // 代码默认作为一行：asks（含开关句子）、notes / options / inner、snippets、format
export const resolve = (card: Card, rows: Rows): Resolved   // 纯函数；resolve(card, {}) 与今天无包请求逐字节相同
```

**作者序，只在这里说一次**：harness（代码默认 + 叠加行按 id 盖上）→ 卡 → 基底 → `local.mounts` 顺序的包 → 本卡 → 人设（正文作为本卡行末尾的 `persona` 片段，名字最后填 `names.user`）。**同 id 后者赢**，对每一种都成立。唯一例外是片段的 `mode: "yield"`：低等级已填这个槽就不站上去；编译出的开关片段一律 yield（卡自己写了玩家的位置就整组接管）。

```ts
type From = "harness" | "card" | "base" | "local" | string /* 包 id */
type Item<T> = T & { from: From; compiled?: true }
export interface Resolved {
  frame: Item<Fragment>[]; tail: Item<Fragment>[]          // 洞已填；未填的条目不在这里
  asks: Record<string, Item<{ text: string }>>             // 每个 id 都有：链上第一个整条填得上的（harness 的没有洞）
  products: Item<Product>[]                                 // on 已定；问法已填，填不上的标 unasked
  entries: Item<{ id: string; text: string }>[]             // 进 lookup 索引的玩家层词条
  lexicon: Entry[]; snippets: Item<Snippet>[]; format: Item<Format>[]
  names: Names; holes: string[]
  switches: { value: Writing; sentences: Record<string, string>; taken: { pov: From | null; verbosity: From | null } }
  dropped: { from: From; kind: string; id?: string; why: string }[]   // 锁拒绝了什么：给前端画，从不抛
}
```

### 3. 锁（全在 resolve 里，等级 ≥ 基底一律不抛）

- 入库解码剥掉 `when` / `role`（harness 与卡除外）。
- 词条 id 加行前缀；单层；`unlock: () => 1`。
- **产物补丁按等级**：harness 与卡可以写整条；基底 / 包 / 本卡的补丁只取 `label` / `text` / `on`，**落在任何已有 id 上**（notes、options 的问法由此可见可改，形状、阶段、折叠不动）；新 id 编译成 `stage: "narrate"`、`shape: text`，缺 `text` 则丢弃。卡自己的形状错误仍在 session 打开时抛。
- 名字一行、不含 `{{`；`names.user` 缺省 "玩家"。
- 洞：按条目填；片段 / 词条 / 快捷输入未填则不出；产物未填则本轮不问；问法沿链回退；开局与索取仍拒绝并报洞名。
- 开关句子：`asks` 里 id 为 `switch.<key>.<value>` 的默认文本就是 `SENTENCES`；叠加行按 id 改一句即生效；整槽自由文本仍整组接管。`SENTENCES` 常量从 fragment.ts 搬进 harness 行。

### 4. 库与线

- 表：`pack(id, name, json)` 存 `harness`（叠加，常为空）、`base`、各包；`local(card, json)` 一卡一行。`player` 表删除，一次性迁移：`global / writing / asks / products / theaters / snippets / format` → `base`；`forCard / persona / packs / names / tags / products` → 各 `local`（`theaters` → `products` 补丁）。
- `GET /packs` → `[harness, base, ...packs]`，`harness` 行回的是**代码默认与叠加合并后的整行**；`PUT /packs/harness` 服务端只存与代码默认不同的项，缺项即复位；`DELETE` 对 `harness` / `base` 拒绝。`PUT /packs/<id>` 整行。
- `GET /cards/<id>/local`、`PUT /cards/<id>/local` 整行。`/player` 删除。`/personas` 不动。
- `GET /card` 与 `/cards/<id>`：`{ ...meta, greetings, rules, fiction, local, mounts: {id,name}[], layer: Resolved }`，唯一脱敏：`from === "card"` 的条目不带 `text`。客户端不再合并任何东西。
- session 构造参数：`rows: () => Rows`（库每次请求读），替换今天的 `persona` / `packs` / `player` / `players`。

### 5. 删除清单

runtime：`frame`、`mounted`、`Theater`、`Player`、`Pack`、`Player.defaults`、`theatersOf`、`namesOf`、`wordingOf`、`questionOf`、`withPersona`、`inForce` / `namesNow` / `loreNow` 的拼装；`product.ts resolve` 的小剧场参数改为按等级的补丁。
server：`/player` 路由、`players` 持久化、`persona` 回调。
测试：`test/packs.ts`、`test/names.ts` 的合并序、`test/product.ts` 的小剧场合并、`cardView.snippets` 顺序、`wordingOf` 链，全部由 `test/layer.ts` 一套走接口的测试取代（作者序、yield、基底在包前、接管与 `taken`、人设最后、锁落 `dropped` 且 session 照开、词条前缀、洞的四种处理、`on` 与 `from`、`resolve(card, {})` 逐字节等同旧请求、叠加行只存差异、迁移）。`request.ts`、`derived.ts` 回放、`lore.ts`、路由测试保留。

### 6. 文档

GLOSSARY：**玩家层** 条改写为"一种行 `Layer`，五个作者一个序"，**enhancer** 条改"包即一行"，删 `Player.*` 引用，**asks** 条加开关句子 id；README 第 130 段同步；§一–§八 不改（历史记录），本节是现行。

### 7. 客户端（另一个 PR，Gemini）

设置页：`[harness, base, ...packs]` 同一行模板，六个 tab（文风与要求 / 线索词条 / 润色禁词 / 记录与小剧场 / 快捷输入 / 问法），`harness` 行标「内置」、无删除。写作页：挂载 chips = `mounts`，代称 = `layer.names` + `holes`，开关 = `local.switches` 与 `sentences`，`taken` 非空且非 compiled 即灰掉并写接管者，产物 = `layer.products` 的 `from` / `on` / `text`，`dropped` 为警示条。删 `BASE_ID`、全部 `isBase()`、`sourceOf`、`pack.ts` 的合并与计数。

## 十、只有一个「内置」：基底并入 harness 叠加行（2026-11-05 晚）

#144 落地后设置页顶上有两行常驻：「内置」（harness 叠加，卡之前）与「全局基底」（base，卡之后）。两者在玩家眼里都是"默认"，并排就是重复。决定：**删除 base 这一级**，harness 叠加行就是玩家的全局行，id 仍为 `harness`，界面词「内置」。不是前端合并显示，是服务端少一级。

### 1. 作者序变为五级

harness（代码默认 + 玩家叠加按 id 盖上）→ 卡 → `local.mounts` 顺序的包 → 本卡 → 人设。叠加行在卡之前：玩家在「内置」里写的是默认值，卡对同 id 的声明压过它；本卡行永远最后，玩家在一张卡上的最后一句话仍是本卡。这与框架槽位最初的规则一致（全局让位、本卡覆盖）。

### 2. 叠加行的规则与包相同，只多"存差异"

- 解码走 `locked`（剥 `when` / `role`；产物补丁只取 label / text / on）。代码默认本身不经解码，仍可写整条。
- **新 id 的产物**在叠加行里与包一样编译成 `stage: "narrate"`、`shape: text`，缺 `text` 丢弃。今天叠加行按"整条"校验，新小剧场因无 shape 落进 `dropped`，这是 bug。
- **片段**：叠加行的片段按 `mode` 对卡，缺省 `yield`（卡写了这个槽就让位），写 `override` 则压过卡。客户端的「文风与要求」已露出冲突策略，正好用上。`resolve` 里今天"叠加行片段只在卡没有该槽时站上去"的硬规则改为读 `mode`。
- 词条、词表、快捷输入、代称、问法：与今天叠加行相同，位于卡之前。
- 存储不变：只存与代码默认的差异，缺项即复位；`GET /packs` 回合并后的整行。

### 3. 迁移

`pack` 表里已有的 `base` 行一次性并进 `harness` 叠加行：各列表拼接（叠加行的在前），`switches` 以 base 的覆盖，`products` 补丁按 id 以 base 的覆盖；然后删 `base` 行。`fromPlayer`（旧 `player` 表的迁移）直接写进 harness 叠加行，不再产出 base。`RESERVED` 只剩 `harness`。

### 4. 改动清单

runtime `layer.ts`：`Rows` 去 `base`；`From` 去 `"base"`；叠加行走 `locked` 与新 id 编译；片段按 `mode`。server：`library.ts`（`baseOf` 删除，列表 `[harness, ...packs]`，`DELETE` 只拒 `harness`）、`serve.ts` 头注释、`data.ts` 两处迁移。client：`isReservedPack` 只认 `harness`，列表与注释去 base，其余不动（行模板已同构）。测试：`test/layer.ts` 的 base 用例改写为叠加行用例（yield 缺省、override 压卡、新 id 小剧场、与包和本卡的序），`data.ts` 加 base→harness 迁移用例，`serve.ts` 列表长度。GLOSSARY / README 的"基底"字样删除。
