# 制卡工坊（Workshop）：三个受锁的 AI 操作，长在卡页的编辑态上

状态（2026-11-09）：后端 Step 2.1、2.2、2.4 已实现；Step 2.3 编辑态待实现。前置：Phase 1 全部落地（`docs/headless-cli-brief.md`、`docs/card-cli.md`、`docs/tavern-cli.md`）。追踪见 Issue #155 阶段二。

## 1. 它是什么

工坊不是一个新页面、一个聊天窗或一张"制卡引导卡"。它是 #121 卡片详情页的**编辑态**，加上三个作者主动召唤的 AI 操作。基底是纯粹的 GUI parser：作者在页面上写 frame、fiction、greetings、lore 的文字，用划选把段落拆层、挂条件；不碰 AI 也能做完一张卡。AI 操作只是三颗按钮，每一颗的输出都是一份**候选卡（整卡 `Card` 值）**，页面画出当前卡与候选卡的结构 diff，作者逐块采纳或丢弃。

两条已有立场合在一起就是边界：README 说作者不手写逻辑与配置格式（自然语言编译一次成 schema 数据）；项目底线说 AI 不写语文。Card schema 本身把两者分开了：

| 类别 | 字段 | 谁写 |
| --- | --- | --- |
| 封闭词汇（代码） | `Field` 边界与初值、`Cond`、`Effect_`、`Chance` 的数值与 `path` 形式、`Shape`、`unlock` / `offer`、产物角色、`over` / `cap` | 模型可以生成 |
| 接线标识符 | `id`、`path`、`event`、enum 的 `options[]` 值 | 模型可以生成，格式锁为 token（无空白） |
| 判据语文（rubric） | `Action.text`、`Readout.text`、`Readout.options[].text`、`Chance.judge` | 只有作者 |
| 正文语文 | `Fragment.text`、`LoreEntry.layers[]`、`Greeting.text` | 只有作者 |
| 展示词 | `Field.label` / `group`、`Fragment.label`、`title`、`summary` | 可选，模型一律不填 |

判据语文归作者，是因为 `wuxia` 跑得好靠的正是读数选项措辞的分寸；`event` 归标识符，是因为模板里它就是 `warmth:close`、`strike:hit` 这样的 token，lint 按字符串同一性接线，进叙事者的只是 ledger 一行。

## 2. 五条不变式

1. **一页一模型，按声明露出。** 工坊是 #121 卡页的原位编辑。未声明的部分不占界面：纯散文卡默认就是一页干净的文稿流；作者声明了字段与规则，结构区才长出来；按了 check / view 或三个操作，诊断切片与 diff 才展开。这是 README"结构化阶段全部 opt-in"在编辑器上的投影，不是"多张脸"。
2. **候选即整卡，diff 是两个值的结构差。** 没有 AST patch 协议，没有草稿状态机。模型从不输出整卡（否则它就能改写正文）：模型输出的是封闭词汇的增量与绑定，宿主用一个纯函数把它施加到当前卡上得到候选。施加函数只写封闭词汇与标识符键，`text` 键只能被创建为空串，永远不能被赋值。
3. **compile：散文在先，只编逻辑与接线，判据留空。** 主输入是作者选中的已有段落（按路径：`fiction.<id>`、`lore.<id>.layers[n]`、`greetings[n]`）加一句机制意图；输出是挂在这些段落上的绑定，以及支撑它们的 `fields` / `actions` / `readouts` / `over`。绑定目标是封闭的四种：`fiction.<id>.when`、`lore.<id>.unlock[n]`（按层）、`lore.<id>.offer`（整条一个 Cond，不按层）、`greetings[n].do`（IF 线开局的效果，盐道与竹林的第二条开场白就是这个形状）。所有判据与正文槽回到作者面前都是空的，旁边由 `phrase.ts` 标出它的机械含义（`close · 交情 +8 · event warmth:close`）。只有作者明确要一条还没有文字的规则时，compile 才新建空的正文槽。
4. **sort：整段归位，绝不破句。** 模型输出的是**源稿段落的下标**与目的槽位，不是文字；宿主按下标复制整段。一个槽可以收几段，按源稿顺序连接。段内摘句进 lore 只能由作者在编辑器里划选完成。
5. **review：只读，只报路径。** 唯一同时读正文、规则与判据的操作。输出严格是 `Diagnostic[]`，`rule` 前缀 `review:`，`level` 恒为 `warn`：非确定性的读法不能阻止安装，阻止安装的只有 lint。

## 3. 代码锁

不写一句"请不要改写作者的文字"。每条边界都是 schema 或一行纯函数：

- **compile 的输出 schema 没有任何正文或判据字符串字段。** `Action`、`Readout`、`Chance.judge` 在模型侧的类型是去掉 `text` / `judge` 的版本；宿主施加时补 `""`。不要把它们作为 optional 留在模型 schema 里。
- **标识符格式锁。** `id`、`event`、enum 值、`path`：`^[\p{L}\p{N}_:.\-{}]+$`（`event` 允许 `{path}` 插值花括号）。加在模型侧 schema 上即可；是否同时加到 `Card` schema 看四张模板是否全过。
- **新 lint 规则 `empty-text`（error）。** 文本存在但去空白后为空串即报：`fiction[].text`（必填）、`frame[].text` 与 `asks[].text`（`undefined` 是合法的空槽位声明，`test/lint.ts` 已有断言，不报；显式 `""` 才报）、`lore.<id>.layers[n]`、`greetings[].text`、`guard[]`、`Action.text`、`Readout.text`、`options[].text`、`Chance.judge`、非内置 `products[].text`（自定义产物的问法也是判据）。今天只有 CLI 的 `tavern card install` 在入库前跑 `checkCard`；`library.cards.put`（即 `PUT /cards/:id`）只跑 `decodeCard` 与 `makeCard`，不跑 `rpg.validate(rpg.initial)` 也不跑 `lint`。Step 2.2 把这两步放进 `cards.put` 本身，error 即抛，于是任何入口都装不进判据没写完的候选；CLI 侧的 `checkCard` 保留，只是不再是唯一的门。手写卡同样受益。
- **sort 的结构锁。** 模型 schema 里只有 `{ paragraphs: number[], to: path }[]`；下标越界或重复即拒绝。文字从不经过模型。
- **review 的类型锁。** 输出 schema 是 `Diagnostic` 去掉自由 `rule` 与 `level`（两者为字面量），`path` 必须是候选卡上存在的路径，宿主校验后不存在的条目丢弃。
- **自愈循环看不见 `empty-text`。** compile 结果过 `checkCard` 后若有 `unknown-path`、`orphan-event`、`reserved-path` 这类结构错误，把诊断回喂模型修一次（预算 2 步）。`empty-text` 是给作者的，回喂前过滤掉，否则模型被要求填它 schema 里不存在的字段，白耗预算。

## 4. 接在 Phase 1 的哪里

Phase 1 已经给了每一环，工坊不新建平行机制：

| 工坊需要 | Phase 1 已有 | 怎么接 |
| --- | --- | --- |
| 候选卡校验 | `checkCard(source)`（`runtime/support/author.ts`） | 候选序列化为 YAML 后过它；`diagnostics` 进 diff 面板，`sections` / `total` 显示候选的 token 变化 |
| 解释为什么没生效 | `card view --json`（子句求值、槽位来源、分段与断点） | 候选与当前卡各跑一次，并排显示同一 `--state` 下哪些 band / window / readout 变了 |
| 零 token 回归 | `runScenario`（`runtime/support/scenario.ts`） | 卡旁若有 `*.scenario.yaml`，候选触及 `rules` 时自动跑一遍；失败列入 diff 面板，不阻止采纳 |
| 入库 | `library.cards.put` / `PUT /cards/:id` / `tavern card install` | 候选不直接入库；作者采纳后页面保存草稿，install 时才 put。`cards.put` 今天不 lint，Step 2.2 补上（见 §3） |
| 模型 | `library.routing`、`provider.object` | 三个操作用一个新路由键 `author`（缺省落 `default`）；都是单次 `object()`，compile 多一次回喂。不用 `runStageTools`：没有工具，没有事务 |
| 双模 | `tavern` 宿主的本地 / `--url` | 三个操作住在宿主（需要模型），不住离线 `card` 命令；`--url` 模式走三条 POST 路由 |
| 测试 | aimock（`bun run verify`，不花钱） | 每个操作一组 fixture：正常、越界（模型夹带正文 → schema 丢弃，候选保持作者文本）、回喂修正 |

## 5. 接口

CLI（`bun run tavern`，本地直连或 `--url`）：

```sh
tavern card compile my-card.yaml --select fiction.pei-warm --select lore.letter.layers[1] \
  --intent '交情过 8 她主动提那封信；没回应不算拒绝' -o candidate.yaml
tavern card sort my-card.yaml notes.md -o candidate.yaml        # 段落下标 → 槽位，整段复制
tavern card review my-card.yaml --json                           # review:* 诊断，不改文件
```

三条都读文件、写文件、打 stderr 日志；`-o` 省略时候选打到 stdout。diff 在 CLI 层不画：`git diff` 或 `card check candidate.yaml` 就是作者的审查面。

HTTP（`serve.ts`，供 `--url` 与客户端）：

```
POST /author/compile  { card, select: path[], intent }        → { candidate, diagnostics }
POST /author/sort     { card, source, paragraphs?: string[] } → { candidate, placements }
POST /author/review   { card }                                → { diagnostics }
GET  /cards/:id/draft                                         → { card, draft: boolean }：有草稿返回草稿，否则返回已安装的完整 Card
PUT  /cards/:id/draft { card }                                → 一卡一行，覆盖
DELETE /cards/:id/draft                                       → 放弃草稿，回到正式卡
```

`GET /cards/:id` 返回的是脱敏的 `cardView`（不带 frame / fiction / lore / guard 正文），编辑态不能从它起步，所以 draft 的 GET 是唯一返回整卡原文的路由；库是本地私有的，这与 #121 的披露开关同一理由。`cards.put` 成功即删除该卡的 draft 行，否则下次进来读到的是旧草稿。

`paragraphs` 省略时按空行切源稿；客户端把作者在编辑器里的划选结果作为 `paragraphs` 传入，这样 GUI 里的"拆"始终是人做的。

客户端（#121 卡页编辑态）：

- 文稿流：frame、fiction、greetings、lore 的正文可直接写；划选一段 → "拆为变体 / 收进第 n 层"，生成带空 `when` 的新片段或新层，作者再填条件（表单，`phrase.ts` 反译）。
- 结构区：只在卡声明了 `rules` / `products` 时出现；每个 Action、Readout 行左边是 `phrase.ts` 的机械标注，右边是作者的判据输入框，空的标红（即 `empty-text`）。
- 三颗按钮长在它们作用的节上：compile 在选中段落的浮条上，sort 在导入入口（#31 卸载器的出口），review 在页顶。
- diff 面板：逐块采纳；每次采纳后重跑 `checkCard`，采纳一条写字段的动作而丢弃该字段会立刻显示 `unknown-path`。块之间不独立，lint 是仲裁。
- 草稿：一卡一行（`draft` 表），自动保存；install 按钮 = `cards.put`，error 时按钮禁用并指向第一条诊断。

## 6. 不做

- 生成、润色、改写、纠错任何正文或判据字符串。连 typo 也不改：那是编辑器的拼写检查。
- 聊天窗、对话式助手、"制卡引导卡"、把工坊做成一张特殊卡或特殊游玩模式。
- 模型替 `card test` 场景写玩家输入或 `replies.narrate`。它们不进卡，但是模型写的虚构句子；留到阶段二之后单独决定。
- AST patch 协议、语义 diff 引擎、草稿状态机、三层版本号（沿用 Phase 1 的不做）。
- 段内自动切分；跨段重排以外的任何对源稿字节的改动。
- 把 `empty-text` 以外的任何 lint 规则降级来迁就模型输出；模型修不好就返回带诊断的候选，作者看着改。

## 7. 落地步骤

### Step 2.1 锁（runtime，不接模型）
- [x] `lint.ts`：`empty-text` 规则；四张模板与 `card init` 脚手架必须仍然 0 error（脚手架的占位句保留，它们不是空串）。
- [x] `runtime/src/workshop.ts`：`applyCompile(card, output): Card` 与 `applySort(card, source, placements): Card` 两个纯函数，加模型侧 schema（`CompileOutput`、`SortOutput`、`ReviewOutput`）。`test/author.ts` 断言两条不同的不变式：
  - `applyCompile`：永远不改任何已有 `text`；它创建的每个 `text` 都是 `""`；只写封闭词汇与标识符键。
  - `applySort`：永远不改卡上已有的非空条目；只追加新的 `fiction` / `greetings` 条目或新的 `lore` 层，或填入 `text` 为 `undefined` / `""` 的 `frame` 槽位；写入的每个 `text` 严格等于 `source` 对应下标的段落（多段按原序以 `\n\n` 连接）；下标越界或重复抛错；`to` 指向新 `lore.<id>` 时初始化 `unlock: { all: [] }`、`offer: { any: [] }`，层只能追加到末尾（`layers[1]` 不能先于 `layers[0]` 出现）。
- [x] 标识符 pattern 先只加在模型侧 schema；对 `Card` schema 的收紧另开一条 lint `bad-identifier`（warn）看模板反应再决定。

### Step 2.2 三个操作（server 宿主）
- [x] `library.cards.put` 加 `rpg.validate(rpg.initial)` 与 `lint` 无 error 校验，error 抛出；`server/test/author.ts` 断言带 `empty-text` 的卡被 HTTP 与直接调用同样拒绝。
- [x] `library.author.{compile,sort,review}`：`object()` 一次，compile 过滤 `empty-text` 后最多回喂一次；路由键 `author`。
- [x] `serve.ts` 三条 POST + `draft` 表与 `GET/PUT/DELETE /cards/:id/draft`（GET 回退到完整已安装卡，put 成功即清草稿）；`tavern card compile|sort|review` 本地与 `--url` 两模。
- [x] aimock fixtures：每操作三组；`server/test/author.ts` 覆盖 CLI 本地与 `--url` 往返。
- [x] `docs/tavern-cli.md` 补三条命令。

### Step 2.3 编辑态（client，#121 的编辑那一轮）
- [ ] 卡页编辑态：按声明露出；文稿流直接写；划选拆段；结构区的判据输入框。
- [ ] diff 面板与逐块采纳，采纳后重跑 check；候选 vs 当前的 view 并排。
- [ ] 草稿自动保存，install 走 `PUT /cards/:id`。
- [ ] #31 卸载器的碎片进 sort 的入口。

### Step 2.4 把立场写给外部 agent
- [x] `card-author` skill 的"Semantic side"一节加一段：工坊三操作的边界即外部 agent 写卡时的边界（可以编规则与接线，不写正文与判据）。CLI 是中立工具，锁不住拿 Claude Code 改 YAML 的作者，这一段是对他们说话的唯一地方。

验收北极星：没有浏览器的环境里，作者写好三段散文与一句机制意图，`tavern card compile` 给出一份只多了字段、读数、条件与空判据槽的候选；`card check` 报出的唯一 error 是 `empty-text`；作者填完判据，`card test` 跑过旧场景，`card install` 入库。整个过程模型没有产出一个进卡的汉字。
