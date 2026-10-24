# 卡片静态资源目录与附件机制（收敛稿）

2026-10-25。本篇探讨如何解决插图卡、BGM 音乐播放器、语音包与图鉴卡等多媒体附件需求。

经与现有代码接缝（`Card`、`Product`、`record`、`rollOf`）对照收敛后，结论非常明确：**它不需要一套独立的「插件系统」或额外的「配图师工序」，落在现有接缝上只需要新增三样小东西：Card 上的 `catalogs` 字段、Product 里可引用 catalog 的 `enum` 形状，以及客户端画附件的标准视图。**

---

## 1. 背景：酒馆插图卡 SOP 的天花板

以酒馆生态中成熟的插图卡制作规范（《π的插图教程 — 插图卡制作SOP》，160 张规模的优菈卡案例）为例，创作者为了在单次请求、无静态资源层的酒馆里实现插图卡，不得不手动完成以下工程：

1. **统一前缀图床（Cloudflare R2）与严格文件命名**：将图片命名为 `<分类标签>-<具体内容>.png`（如 `小明-吃饭1.png`、`小明-吃饭2.png`），消灭随机哈希文件名带来的模型幻觉。
2. **用本地 Python 脚本把文件名编译成世界书文本**：扫描目录聚合成数千 Token 的 `<illustration_list>` 纯文本块；因体积过大（7000～8000 字），还必须拆成 `after_char`（蹭前缀缓存放总表）与 `d0`（深层放简短召回指令）两条世界书。
3. **靠正则与 `{{random}}` 做差分映射**：将 `小明-吃饭1/2` 在提示词里合并为一个语义键 `《小明-吃饭》`，再靠正则替换为 `https://.../$1{{random::1::2}}.png`。
4. **专门占用一个开场白做「图库测试」**：把整张 `<illustration_list>` 塞进一个 `first_mes`，既给玩家当 CG 画廊看，又供作者排查死链。

这套做法在酒馆里撞上了四堵墙：

- 主笔 `narrate` 每轮背负几千字文件名列表，挤占写作注意力；
- 全量常驻暴露，缺乏按当前状态（`State`）的粗筛；
- 单条正则 `$1{{random::1::2}}.png` 限制了差分张数，且渲染期随机每次刷新都会乱跳；
- 模型一旦拼错一个字就直接裂图。

---

## 2. 落在现有接缝上的三件小事

站在现有架构上看，`Catalog → Selector → Resolver` 的数据流完全正确，但中间不需要任何新工序或包装器，直接坍缩进现有的 `Card` 与 `record` 阶段即可：

```mermaid
flowchart LR
    A["1. Card.catalogs<br/>条目带 id / variants / when: Cond"] --> B["2. Record Product (enum / table)<br/>按 when 粗筛后动态生成 enum Schema"]
    B --> C["3. Resolver & Client View<br/>节点只存 id，读时用 rollOf(seed) 抽差分拼 URL"]
```

### 2.1 `Catalog`：Card 上的可选数据字段

`Catalog` 是 `Card` 上的一个可选字段，三张脸齐全（可求值、可画 GUI、可作 Schema 目标）：

- 每个条目包含语义键 `id`、差分文件列表 `variants`（如 `["优菈-挥剑1.png", "优菈-挥剑2.png"]`），以及可选的状态守卫 `when?: Cond`。
- 因为清单本身是卡片上的结构化数据，客户端可以直接在卡片页画出完整的「CG 画廊 / 曲库一览」，开发期也可直接批量检查资源 URL 可达性，彻底省掉「图库测试开场白」。

### 2.2 `Selector`：两种粒度全部坍缩为 `record` 的 `Product`

**不需要单独的「配图师工序」，也不需要在正文里写 `[[cg: ...]]` 标记**：

- `record` 阶段本来就看得到当轮正文（`prose(reply)`），而且 `record` 的 Schema 本来就是每次调用按结算后的状态 `settled.s` 现建的。
- 只要让 `Product` 的形状（`Shape` / `Col`）多一种 **`enum`（选项可来自指定的 `catalog`）**：
  - 在构建 `record` 请求时，代码按 `holds(item.when, settled.s)` 对该 `catalog` 做粗筛，将当前合法条目的 `id` 动态生成为 `Schema.Literals([...activeIds])`。
  - **回合级附件（如 BGM 播放器）**：直接声明为一个 `enum` 产物（指向 `bgm` catalog），`fold: "latest"`。
  - **段落级附件（如插图卡）**：直接声明为一张 `table` 产物，列为 `{ afterParagraph: int, id: enum(catalog) }`，`fold: "latest"`。
- **为什么这样更干净？**
  1. **主笔 `narrate` 零负担、正文零标记**：遵循 README「模型只写正文、不写控制标记」的原则，8000 字图名绝不进 `narrate`，也不进聊天历史。
  2. **省去额外模型调用**：配图/选曲直接搭 `record` 的顺风车一次完成。
  3. **物理消灭幻觉裂图**：因为 `enum` 就是解码 Schema，不在清单里的 `id` 在解码时根本不存在，不需要任何事后兜底回退逻辑。

### 2.3 `Resolver`：节点只存 `id`，读时确定性拼 URL

严格遵守 `src/journal.ts` §17（节点只存模型输出与 `seed`，其余皆为派生）：

- **落盘**：节点 `Turn.products` 里只存选出的 `id`（或 `{ afterParagraph, id }[]`），绝不存储完整 URL。日后若更换图床域名，改一下 `Catalog.baseUrl` 所有旧存档立即生效。
- **读取与差分抽取**：客户端或读取器拿到 `id` 后查 `Catalog` 表；若该条目有多个 `variants`，直接调用 `src/card.ts` 现成的 `rollOf(seed)` 确定性选出差分文件并拼上 `baseUrl`。同一次生成回放永远稳定，`swipe` 重生成（新 `seed`）则自然切换差分。

---

## 3. 明确不做的两件事

1. **不做文内标记 `[[cg: ...]]`**：模型在 `narrate` 中绝不输出附件控制标记，避免污染正文与历史。
2. **不封装 `illustrations()` / `bgmPlayer()` 构造器**：与不封装 `scene()` / `people()` 同理——具体玩法是卡片上的数据实例（`catalogs` + `products` 声明），不是底座能力。

---

## 4. 改动清单汇总

真正要新加的只有三处：

1. **`Card`**：多一个可选的 `catalogs` 字段；
2. **`Product`**：`Shape`（及表格 `Col`）多一种 `enum`，其选项可指向一个 `catalog`（在 `record` 时按 `when` 过滤动态生成）；
3. **客户端**：一个渲染附件的标准视图（段落后插图、常驻音频播放器、卡片页画廊）。
