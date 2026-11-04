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
