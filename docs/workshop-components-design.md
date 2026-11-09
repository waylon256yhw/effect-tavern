# Workshop 前端组件化构建设计（Component-Based Workshop Architecture）

> 状态：设计定稿（2026-11-09，三方评审后修订）；唯一待拍板项见 §5.1。本文修正 #121 的导航句：卡页按**已声明的组件**组织，不按 schema 顶层；#121 的披露开关不变。
> 关联文档：[`docs/workshop-brief.md`](./workshop-brief.md)、[`docs/card-reading.md`](./card-reading.md)、[`docs/packs-brief.md`](./packs-brief.md)
> 关联已落地后端：[`packages/runtime/support/workshop.ts`](../packages/runtime/support/workshop.ts)、[`packages/server/src/author.ts`](../packages/server/src/author.ts)、[`packages/runtime/src/lint.ts`](../packages/runtime/src/lint.ts)

---

## 1. 背景与问题诊断：为什么固定 Tab 表单走不通？

在 Phase 2 后端（`checkCard` `empty-text` 门禁、`compile` / `sort` / `review` 三个闭词表纯函数接口、以及 `/api/cards/:id/draft` 草稿持久化）落地前后，我们尝试了三版基于固定分栏或固定顶栏 Tab（`设定 / 正文 / 暗线 / 规则`）的前端原型，均宣告失败。

复盘原因，核心症结在于：**把底层运行时装配结构（Runtime `Card` Schema）直接当成了作者侧的创作分类（Authoring Taxonomy）。**

1. **`Card.frame` 是覆盖协议，不是逼作者填表的旧酒馆冗余字段**
   - 在 [`packages/runtime/src/card.ts`](../packages/runtime/src/card.ts) 与 [`packages/runtime/src/layer.ts`](../packages/runtime/src/layer.ts) 中，`frame` 的 7 个槽位（`persona / pov / voice / style / setting / language / verbosity`）存在的唯一工程理由，是与玩家全局的 `Writing` 偏好层做按槽合并与让位（`Fragment.mode: "yield"`，`layer.ts` 的 `resolve`）。
   - 如果在 UI 上把它们画成常驻表单，就会立刻退化成 SillyTavern V2 时代为了迎合早期 ERP 与提示词魔咒而拍脑门定下的冗余格子（`Scenario`、`Personality`、`Mes_Example`）。绝大多数卡片根本不需要填满这 7 个槽。
2. **`Card.fiction: Fragment[]` 是装配切片数组，不是让作者在文本框里手搓伪 YAML**
   - Runtime 把 `fiction` 设计为 `Fragment[]`（[`packages/runtime/src/fragment.ts`](../packages/runtime/src/fragment.ts)），只是为了让不同段落能按文档顺序拼接，或挂载 `when: Cond` 在好感度/状态变化时整段进出。
   - 在现有迁移卡（如 [`banxing.yaml`](../packages/runtime/cards/banxing.yaml)、[`ri.yaml`](../packages/runtime/cards/ri.yaml)）中，`fiction[].text` 里之所以塞满了手写的缩进伪 YAML（`姓名: 依瑞丝`、`核心特质:`），纯粹是因为旧酒馆只有一个大号纯文本框，作者被迫用纯文本模拟结构化角色表。如果 Workshop 照搬文本框让作者继续手敲缩进，就没有提供任何 GUI Parser 的价值。
3. **生态中的卡片形态跨度极大，不存在一套所有卡通用的常驻标签页**
   - 有的卡是纯粹的散文（《公共妓女》），有的卡是无主角的碎片档案集（《灰色と青》），有的卡是标准单人角色表单+开场白（《伴星》），有的卡是好感度阶段驱动的恋爱剧（《圣女莉莉》），有的卡则是无固定人设、纯靠数值与世界账本运转的机制沙盒。
   - 把 `设定 / 正文 / 暗线 / 规则` 全部常驻在顶栏，会让纯散文卡显得臃肿，让机制卡的各个耦合面（变量定义、阶段描写、回合后判据）被拆散在不同 Tab 里。

---

## 2. 核心架构：一页画布，组件原位展开

Workshop 前端放弃「固定顶栏 Tab」，改为**组件化的一页**：画布本身就是编辑页，已挂载的组件在页上原位展开（长卡可按需折叠某些块），没有「先点块再进二级页」的跳转。纯散文卡打开就是一个可直接下笔的文稿流。

### 2.1 画布（卡片骨架装配页 / Blueprint Canvas）

画布占据完整一页，留白充足。折叠时只回答一个问题：**「这张卡是由哪几个组件拼出来的？」**；展开即编辑。

- **顶栏区域**：仅包含卡片名、一句话摘要（`summary`）、测试/状态切片预览入口、保存/发布按钮。
- **画布主体**：一列从上到下排列的**已挂载组件块（Component Blocks）**，底部是一个干净的 **`+ 添加组件`** 入口（以及可选的「导入原稿并自动分拣 `sort`」入口）。
- **直观区分卡片原型**：点进不同卡片时，画布呈现的骨架截然不同，一眼就能看清这张卡的性格：

| 生态典型卡 | 卡片形态特征 | 画布上挂载的组件序列 |
| :--- | :--- | :--- |
| **《公共妓女》**<br>（[`card-reading.md`](./card-reading.md) 案例，仓库内无 YAML） | 纯散文、无特定主角、无开场、无数值 | 1. `[自由正文段]`（单篇手稿） |
| **《灰色と青》**<br>（[`card-reading.md`](./card-reading.md) 案例，仓库内无 YAML） | 碎片化散文集（10 篇独立档案按序拼装） | 1. `[自由正文段 × 10]`（有序篇章流：设定框架 / 写作风格 / 时代气息 / 暗流…） |
| **《伴星》**<br>（[`banxing.yaml`](../packages/runtime/cards/banxing.yaml)） | 传统单人角色卡（固定人设 + 开场白） | 1. `[受控角色表单：依瑞丝]`<br>2. `[开场与视角]`（单开场 + 玩家关系一句话） |
| **《圣女莉莉》**<br>（[`ri.yaml`](../packages/runtime/cards/ri.yaml)） | 好感度阶段卡（多角色 + 6 档阶段 + 隐藏心事 + 多开场） | 1. `[受控角色表单：莉莉 / 罗伦斯]`<br>2. `[状态与阶段选择器：好感度 0–100]`<br>3. `[暗线与词条：告白心事]`<br>4. `[开场与视角 × 3]`（含第 3 支 IF 线初始好感度覆写） |
| **《盐道》**<br>（[`yandao.yaml`](../packages/runtime/cards/yandao.yaml)） | 机制与世界驱动（无固定主角、绿灯词条库、动作检定、世界账本） | 1. `[自由正文段：世界基底]`<br>2. `[暗线与词条（绿灯库）]`<br>3. `[动作与检定骰]`<br>4. `[小剧场与世界账本]`<br>5. `[开场与视角 × 2]` |

### 2.2 组件的编辑形态

每个组件在画布上展开后只提供该组件最自然的编辑形态（纯文稿纸、阶段滑轨、词条抽屉等），绝不混杂无关控件。聚焦视图（只看一个组件）是原型可以试的细节，不是架构承诺。

---

## 3. Runtime 表现力与可选组件的完整映射

为确保组件形态完整且不丢失底层 Harness 的任何能力，我们将 [`packages/runtime/src/`](../packages/runtime/src/) 的全部表现力梳理为 **四大组、8 个可选组件**（若 §5.1 裁掉组件 2，则为 7 个）。每项底层能力在前端都有明确、自然的落点：

### A 组：叙事基底（Head & Node 0）

#### 组件 1：`[自由正文段]`（Free Prose Block）
- **创作定位**：面向《公共妓女》《灰色と青》这类散文化、无法做固定键值拆解的设定手稿，或沙盒卡的宏观世界背景。
- **交互形态**：
  - 极简的无边框纯文稿编辑器（单篇大文本框，或可拖拽排序的「篇章卡片流」）。
  - 默认无任何勾选框或条件徽章，就是纯粹的手打字体验。
- **Runtime 映射**：
  - 映射为 `Card.fiction` 中的常驻 `Fragment`（无 `when` 条件，位于 `Head` 缓存区内）。

#### 组件 2：`[受控角色表单]`（Controlled Character Sheet）— **待拍板，见 §5.1；评审建议裁掉**
- **创作定位**：面向《伴星》《圣女莉莉》等有明确角色的卡片。**彻底消灭在纯文本框里手敲缩进伪 YAML 的历史技术债。**
- **交互形态**：
  - 结构化的键值与分组列表编辑器（GUI Parser）。
  - 预设常见维度（如「身份/外貌」「核心性格」「言行举止」「随身物品」「过往经历」），支持作者自由增删自定义键名（Key）与多行列表值（Value）。
  - 一张卡可以挂载 1 个角色表单（如《伴星》依瑞丝），也可以挂载多个角色表单（如《圣女莉莉》的莉莉 + 罗伦斯）。
- **Runtime 映射**：
  - 编译/序列化为 `Card.fiction` 中格式统一、Token 紧凑的结构化常驻 `Fragment`，同时在前端保留结构化表单的双向反解析编辑能力（详见第 5 节开放问题）。

#### 组件 3：`[开场与视角]`（Openings & Frame Coordinates）
- **创作定位**：放置开场白（Node 0），以及卡片级最核心的视角与身份落点。
- **交互形态**：
  - **开场白列表**：1 到 N 个纯粹的普通文本框（如《伴星》1 个开场，《圣女莉莉》3 个不同情景开场）。
  - **IF 线开场初始状态绑定（按需展开）**：当卡片挂载了状态组件时，允许某个特定开场附带初始状态覆写（例如《圣女莉莉》第 3 个 IF 线开场：「开局好感度直接设为 `75`」，对应 [`ri.yaml`](../packages/runtime/cards/ri.yaml) 中 `greetings[2].do`）。
  - **交互通道与人称坐标**：
    - 默认玩家通道选择：`input: "act"`（玩家作为剧内角色行动，如《伴星》）或 `input: "note"`（玩家作为场外导演旁白指点，如《灰色と青》）。
    - 可选普通文本框：「玩家默认身份（`frame.persona`）」与「卡片专属文风要求（`frame.style` / `pov` / `voice`）」。不填则完全让位给玩家的全局写作包。
- **Runtime 映射**：
  - `Card.greetings: Greeting[]`，`Greeting = { text, do?: Effect_[] }`
  - `Card.input: "act" | "note"`
  - `Card.frame`（按需写入非空槽位）

---

### B 组：动态上下文（Context & Lookup — `lore.ts` + `context.ts`）

在 [`packages/runtime/src/lore.ts`](../packages/runtime/src/lore.ts) 与 [`packages/runtime/src/context.ts`](../packages/runtime/src/context.ts) 中，Runtime 已经将所有上下文条目收敛为了统一的 `ContextItem` 与 `ContextPolicy`（`access: { model, player }`、`activation: "always" | "on_demand"`、`residency: "turn" | "window" | "permanent"`）。

「单层按需词条」与「多层推进暗线」在作者心智上不同，但它们是同一个 schema 类型（`LoreEntry`）：一条词条加深一层就会从一个组件跳到另一个，而单层词条也可以合法地带 `offer` 窗口。所以只有一个 lore 组件，差异在**条目内部按声明露出**：

#### 组件 4：`[暗线与词条]`（Lore — Context Entries & Progressive Layers）
- **创作定位**：卡片自带的一切受状态控制、可按需读取的知识：传统意义上的「绿灯世界书（AI 检索词条）」、「卡片级写作手法条目」、「玩家可手动调用的卡片级 Skill」，以及像《理》的「告白心事」、《竹林》的「旧契真相」那样随剧情分层剥开的秘密。
- **交互形态**：
  - 词条列表。新建一条时只露出最轻的形态，3 个要素：
    1. **首句索引（Hook / 标题句）**：即 `lore.ts` 的 `hook`：`layers[0]` 的第一句。告诉作者：「这句话会常驻在索引目录里，AI 或玩家靠这句话决定要不要点开全文」。
    2. **词条正文**：展开后的具体设定、地点风物、或一段特定的描写技法指导。
    3. **调用方式与驻留周期（2 个轻量开关）**：
       - **谁能触发（Access）**：
         - `AI 自动检索（绿灯词条）`：`access: { model: true, player: false }` —— 模型在 `lookup` 阶段通过 `search_context` / `read_context` 自主翻阅。
         - `玩家手动挂载（Human-Invoke Skill）`：`access: { model: false, player: true }` —— 暴露在客户端 `playerCatalog` 中，玩家在发消息时通过 `input.invoke` 主动点亮（如卡片专属的「战斗描写强化」「回忆闪回模式」）。
         - `双方皆可`：`access: { model: true, player: true }`。
       - **驻留周期（Residency）**：`本轮有效 (turn)` / `滑窗保留 (window, N 轮)` / `永久常驻 (permanent)`。
       - **可选前置锁（Unlock）**：默认无条件开放；也可挂一个简单的条件（如「到达王都后才出现在检索目录中」）。
  - **条目内按声明露出**：点「+ 加深一层」，这一条才长出阶梯视图（层 1 表象 → 层 2 端倪 → 层 3 核心），每层配置**解锁门槛（`unlock[n]`）**（跨过即沿路径单调保持）；点「+ 窗口」才出现**主动提示窗口（`offer`，整条一个 Cond）**（满足时导演把暗示递给本轮叙事者）。单层、无门槛的条目永远只是一句 hook 加一段正文加两个开关。
- **Runtime 映射**：
  - `Card.lore: LoreEntry[]`（`layers`、`unlock`、`offer`、`ContextPolicy`）与 `Card.director`。加载现有卡时不做分流：每条按自己声明了什么展开。

---

### C 组：数值与机制（Rules & Settlement — `card.ts`）

在传统 Tab 设计中，定义一个变量（`rules.fields`）、写不同数值区间的角色表现（`fiction[].when`）、以及写回合后怎么加减分（`rules.readouts`）被割裂在三个地方。组件化设计将它们按**机制用途**聚合为两个组件：

#### 组件 5：`[状态与阶段选择器]`（State Axis, Stage Bands & Readouts）
- **创作定位**：面向《圣女莉莉》的好感度系统、理智值、腐化度、阵营声望等核心状态轴。把「变量定义 + 阶段表现文本 + 回合后加减分判据」收拢在同一个组件视图内闭环完成。
- **交互形态**：
  - **顶部：状态轴定义**：定义一个数值轴（如 `affection`，0–100，初值 30，`gauge` 仪表盘或 `scale` 刻度尺）、布尔开关或枚举状态（`rules.fields`）。
  - **中部：阶段表现切片（Stage Bands）**：沿着该数值轴切分阶段（如 `< 20 厌恶`、`20–40 疏离`、`40–60 敬仰`、`60–80 暗恋`、`>= 80 挚爱`）。点击任意一档，直接编辑该档位下注入给模型的角色状态描写（即带 `when` 条件的 `fiction` 切片）。
  - **底部：回合后变化判据（Readouts）**：配置每回合正文生成后，后台如何根据本轮剧情发展自动加减该数值（如 `affection_shift` 的多选一判据列表：冷淡 `-3` / 平常 `0` / 亲近 `+3` / 突破 `+6`）。
  - **与后端 `compile` 的原生咬合**：作者可以在该组件底部直接输入一句自然语言意图（如「好感度分 5 档，到达 80 解锁告白事件；每回合根据互动亲疏在 -5 到 +5 之间浮动」），点击生成即可调用 `POST /api/author/compile` 自动搭好全部档位骨架与加减分槽位，并留出空白判据框（带 `empty-text` 提示）由作者亲手填完那几句关键判据。
- **Runtime 映射**：
  - `Card.rules.fields` + 关联该字段的 `Card.fiction[].when` + 关联该字段的 `Card.rules.readouts`。代码已经这样看它：`card.ts` 的 `drawn` 从 fiction 的 `when` 反推字段的档位刻度（`cuts`），`prose-cannot-move` lint 把只由动作写的字段指向读数。

#### 组件 6：`[动作与检定骰]`（Actions, Dice & Ending）
- **创作定位**：面向 RPG 检定卡与机制沙盒卡（如《竹林》的「亮剑逼问」检定、跑团卡的技能检定、回合上限与结局收束）。普通恋爱/聊天卡完全不需要挂载此组件。
- **交互形态**：
  - **回合前动作菜单（Actions）**：配置何时向玩家浮现可选动作（`when`）、成功率算法（`Chance`：固定概率 / 随属性线性变化 / 后台分类器按 `tiers` 评判）、以及检定成功（`hit`）与失败（`miss`）各自触发的状态变更。
  - **结局与回合上限（Over / Cap）**：配置触发结局收束的条件（`rules.over`）与最大回合数（`rules.cap`）。
- **Runtime 映射**：
  - `Card.rules.actions`、`Card.rules.over`、`Card.rules.cap`。

---

### D 组：回合副产物与事后把关（Products & Post-Turn Quality Control）

在 [`packages/runtime/src/product.ts`](../packages/runtime/src/product.ts)、[`packages/runtime/src/derived.ts`](../packages/runtime/src/derived.ts) 与 [`packages/runtime/src/world.ts`](../packages/runtime/src/world.ts) 中，卡片可以自带 `products: Product[]`、`guard: string[]`、`lexicon` 与 `names`。它们回应了「卡片级小剧场」与「沙盒动态状态栏/世界表」的诉求：

#### 组件 7：`[小剧场与世界账本]`（Card Products — Theater & World State）
- **创作定位**：定制每回合正文之外的**附属栏位（Side Blocks）**与**结构化世界状态表**。内部按用途分为两个直观子项：
  1. **卡片级小剧场与心声（`role: "theater" | "inner" | "options"`）**：
     - 开关或微调内置的「角色内心独白（`inner`）」与「行动建议（`options`）」。
     - 新增卡片专属的**小小剧场（`role: "theater"`）**：例如每回合附带的「八卦小报」「弹幕吐槽」「随身系统提示音」或玩家按需点击生成的「番外小剧场（`trigger: "demand"`）」。
  2. **动态世界账本（`role: "world" | "chronicle"`）**：
     - 面向沙盒卡与多人物卡：定义结构化的 `record`（当前时间/地点/天气）、`table`（在场 NPC 状态表、背包物品栏）或 `list`（见闻编年史）。
     - 配置是否将当前状态回喂给下一轮开头（`feed: true`，渲染为 `Current:`），以及是否允许 AI 像查词典一样按需回溯历史记录（`recall`，通过 `memory:...` 进入 `lookup`）。
- **Runtime 映射**：
  - `Card.products: Product[]`（[`packages/runtime/src/product.ts`](../packages/runtime/src/product.ts)）。

#### 组件 8：`[事后护栏与禁词]`（Guard, Lexicon & Names）
- **创作定位**：不污染正面叙事提示词（避免「不要想粉红色大象」效应）、只在正文生成后执行的审校规则与专有名词表。
- **交互形态**：
  - **行为禁令列表（`guard`）**：一行一条事后检查规则（如「严禁替玩家扮演的角色做决定或开口说话」「未解锁真相前不得提及盐引二字」），在 `check` 阶段触发自动重写。
  - **陈词滥调替换（`lexicon`）**：配置禁用词与润色方向（`{ pattern, hint }`），供 `polish` 阶段定向修辞。
  - **代称默认值表（`names`）**：卡文本里每个 `{{key}}` 洞的卡方默认值，玩家层可覆盖（`unfilled-name` lint 查没有默认值的洞）。
- **Runtime 映射**：
  - `Card.guard: string[]`、`Card.lexicon: Entry[]`（`polish.ts`，`{ pattern, hint? }`）、`Card.names: Names`（`names.ts`：`{{key}}` 洞的默认值表，GLOSSARY 代称；不是角色宏）。

---

## 4. 已落地后端接口（Phase 2 Backend）在组件化模型下的落点

[`0297ae0f`](../packages/runtime/support/workshop.ts) 已落地的后端架构（`checkCard` 的 `empty-text` 门禁、`compile` / `sort` / `review` 三个闭词表纯函数应用器、以及 `/api/cards/:id/draft` 草稿端点）不需要做任何推翻，在组件化前端中反而拥有了更清晰的交互挂载点：

| 后端能力 / 接口 | 在组件化前端中的自然落点 | 为什么比全局按钮更好用 |
| :--- | :--- | :--- |
| **`POST /api/author/compile`**<br>（意图编译为闭词表结构增量，判据置空 `""`） | 挂载在 **`[状态与阶段选择器]`**、**`[暗线与词条]`**、**`[动作与检定骰]`** 组件内部（或 `+ 添加组件` 时的自然语言向导）。 | 作者在配好感度或暗线时才需要编译规则；生成的空白判据框（触发 `empty-text` 门禁）直接就地显示在当前组件的 `Readouts` / `Actions` 区域里，引导作者当场手填补齐，无需去右侧全局报错栏大海捞针。 |
| **`POST /api/author/sort`**<br>（段落索引归位，锁死原文字节不变） | 挂载在画布的 **「导入散乱原稿」** 入口。 | 作者把一大段未整理的设定稿粘贴进来，`sort` 按段落索引自动拆解并生成对应的 `[自由正文段]`、`[开场与视角]`、`[设定词条]` 与 `[暗线与词条]` 组件块，摆放到骨架页上。 |
| **`POST /api/author/review`** + **`checkCard`** + **`view`（`card view --json`）** | 挂载在画布顶栏的 **「预览与审读（切片 / 检查）」** 抽屉。 | 当作者从具体组件退回卡片骨架页时，可以拉动状态滑块查看当前各组件组装出的最终 Prompt 切片（`Head` / `Turn` / `Cue`），并运行静态 `checkCard` 与语义 `review` 检查跨组件矛盾（如正文与暗线门槛冲突）。 |
| **`PUT / DELETE /api/cards/:id/draft`** + **`empty-text` 安装门禁** | 自动绑定在组件的每次编辑与顶栏「保存入库」按钮上。 | 只要组件内还有 `compile` 留下的空白判据（`empty-text` error），卡片就安全地保存在 `drafts` 表中（允许随时刷新页面不丢进度），填完所有判据后一键转正写入 `cards` 表。 |

---

## 5. 评审结论与唯一待拍板项

### 5.1 待拍板：组件 2 `[受控角色表单]` 去留

- **评审建议：裁掉。** GLOSSARY §45 的立场是散文被原样读到就是表达力，schema 的责任是对散文透明。《伴星》《理》正文里的键值缩进是 ST 导入卡的原样，本项目对这种习惯的处理是改写成散文（《竹林》）与按 `label` 分段（《盐道》的「官府与盐帮」「眼下」）。做一个把键值序列化成文本的表单，是把这个习惯制度化。裁掉后，导入卡的键值块原样放进 `[自由正文段]`，作者下次修订时改成几段带 `label` 的散文。
- **若保留**，形式只有一种：结构化数据由代码在装配时渲染成文本（同 fields → 状态表、Shape → `render()`），需要 `Fragment` 上一个新的结构字段；**绝不**约定文本格式再由前端反解析（下面原方案 A 出局）。
- 原提案留档：

1. **`[受控角色表单]` 在 `Card` YAML 中的序列化与反解析约定**
   - 当作者在 GUI 中使用 `[受控角色表单]` 填写了结构化的角色属性（如「姓名」「性格」「外貌」「经历」），保存为 `Card` 时：
     - **方案 A（零 Schema 改动，约定 Markdown/YAML 块格式）**：将其序列化为 `Card.fiction` 中一段带固定标题约定（例如以 `## 角色：<名字>` 开头、内部为标准 `Key: Value` 列表）的 `Fragment`。前端打开卡片时，通过轻量 Parser 识别该格式并还原为 `[受控角色表单]` 组件；无法识别的普通段落则自动作为 `[自由正文段]` 呈现。
     - **方案 B（显式元数据或子类型）**：在 `Fragment` 上允许一个可选的描述性标记或结构化字段，省去文本反解析。
   - 倾向于讨论哪种方式更符合 Runtime 极简原则且最稳健。

2. **lore 的分流规则** —— **已解决**：不分流，一个组件，条目内按声明露出（见组件 4）。`!offer` 作为判据本来就不成立。

3. **多组件在 `Card.fiction` 中的组装顺序与可视化** —— **已确认**，补一条代价：
   - 一张卡可能同时挂载了 `[自由正文段：世界背景]`、`[受控角色表单：女主]`、以及 `[状态与阶段选择器]` 产出的 5 段带 `when` 条件的阶段描写。
   - 在 Runtime 的 `request.ts` 装配中，`fiction` 严格按照数组下标顺序拼接（无条件段进 `Head`，有条件段按需进 `Turn`）。画布上的组件上下拖拽顺序，将直接决定它们在 `Card.fiction` 数组中的先后次序。无条件段同时是头区缓存前缀的一部分，拖动顺序会让下一轮的前缀失配一次；界面不必阻止，但不要把它藏起来。
