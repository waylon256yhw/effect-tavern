> 归档：原型阶段的调研记录，从 MagVarUpdate 仓库搬入。文中"本仓库"指 MagVarUpdate，章节编号被代码注释里的 §n 引用。现状以根目录 README 为准。

# 变量系统与 AIRP 运行时：调研与原型记录

记录日期：2026-10-08。这是一份思考与调研记录，不是实现计划，也不对应本仓库的任何功能改动。

文中引用的 `file:line` 均对应下文"调研对象版本"表里的提交。标注"子代理阅读"的结论来自自动化代码阅读报告，附有出处，但未逐条人工复核；标注"二手"的结论只来自第三方文档。

## 结论摘要

1. 现有方案的根本问题不是"文本还是 tool call"，而是三件事搅在一起：叙事、判断、记账都交给同一个 LLM，规则写在 prompt 里，正确性靠解析器兜底。
2. 状态的存储、分支、回滚在生态里已有多个独立实现（ERA、小白 state2、Luker floor-state、TauriTavern、DSH），本质都是"按消息/swipe 记录、可重放的修改日志"，属于已解决问题。
3. "类型在代码一侧强制执行"几乎没人做。schema 要么不存在，要么只发给 provider、本地不校验，要么事后由外挂脚本校验。
4. 新项目（TauriTavern Agent 模式、Luker Director、小白 Tavern Manager、DSH）普遍在往"让 LLM 掌握更多循环"的方向走。没有项目让卡的代码掌握回合、把 LLM 当作带类型的函数调用。
5. 我们推演出的方向是控制反转：卡 = schema + 确定性规则的程序，LLM 只做判断（分类、评级、概率）和渲染文字，数值与结果由代码和带种子的随机数决定，状态 = 对日志树的依次结算。
6. Effect v4 的 `effect/ai` `Decision`、`OpenAiStructuredOutput`、`Random.withSeed` 恰好提供了这套结构所需的原语。一个 136 行的原型在类型和运行上验证了结构成立，但没有接真实模型，判断质量未知。
7. 提示词装配（第 8 节）：ST 的 preset 条目与世界书条目可合并为同一种 Fragment（激活 × 位置），装配是对聊天路径的纯函数，swipe 只是树上的兄弟节点。harness 掌握历史也能做"在倒数第 N 层注入"，回应了 5.1 节对 DSH 的观察。
8. 回合是固定骨架的流程，而不是一次调用（第 9、10 节）：先由代码结算，再写正文；"决定 → 结算"可以在结构化层循环多次，正文只写一次。每个阶段配置自己的请求形状，swipe 按阶段区分为换说法、重掷、重想。
9. 纯文本 RP 的揭示与伏笔（第 11 至 13 节）：读者必须在本轮感受到揭示，所以作者预设的秘密必须在写之前交给叙事者。默认只做信息闸门和"机会"，玩家优先于作者；导演与护栏由作者主动开启。护栏只在事后检查，不写进叙事者的提示词，因为禁令本身就是提示。
10. 作者体验（第 16 节）：卡格式是编辑器与运行时之间的契约。作者不手写逻辑；自然语言在编写时编译一次成 schema 数据，GUI 是它的视图。文字不含控制流，变体是各自带条件的 fragment，条件是一棵封闭的小树，也因此能声明每段依赖哪些状态。
11. 回合记录与分阶段视图（第 17 节）：一个节点 = 玩家输入加系统为它产出的全部块，不再有交替楼层。历史是按阶段渲染的纯函数视图，从不存储：只有叙事者看转录稿，结构化阶段只看事实，且大多只看本轮。压缩也是派生视图，用一段回合的 notes 与已送入的世界书文本按代码折叠成摘要，按区间缓存、跨分支共享，节点不被改动。卡在角色之上多出一个"框架"层（文风、基调、世界原型），常驻头区。
12. 玩家层与接线（第 18 节）：玩家有自己的框架层，排在卡的框架之前，分通用与按卡两级。框架 fragment 的 id 就是槽位，与卡同名槽位的关系（覆盖、让位、并存）由玩家按条设置，默认值可调；观众由层决定。头区内所有不带 `when` 的 fragment 排在带 `when` 的之前，缓存前缀因此最大。preset 作为提示词对象不再存在，只剩 provider 配置。`continue` 与压缩策略只作文字记录。
13. 一回合的接线（第 19 节）：lookup、决定与结算、开窗、导演、叙述、检查、记录接成一个循环。开窗在结算之后，因为窗口可能取决于本轮产生的事件。循环里没有任何工具：查阅是对可读 id 字面量枚举的结构化选择，动作是 decide 阶段；模型从不掌握循环，于是没有工具定义需要门控或缓存，§15.4 的前两项消失。截断恢复在 narrate 阶段内部完成，一轮只记录一次。
14. 模块化（第 20 节）：`cond`、`fragment`、`lore`、`journal`、`history` 抽成 `prototype/src/` 的模块；`lore.ts`、`views.ts`、`assemble.ts` 改为导入同一份模块并保留原断言，`loop.ts` 也导入它们。对每个模块做一处变异，两个消费者同时失败，这才是"原件能组合"的证明。顺带发现此前 tsconfig 只列了六个旧文件，第 17 至 19 节的三个原型从未被 `tsc` 检查过，现已纳入。
15. 压缩进入循环（第 21 节）：叙述之前按块折叠路径前缀，边界按块移动，两次移动之间摘要对象不变；节点不动，世界书去重不受影响，因为送入记录在节点上而不在视图里。
16. 卡的 RPG 部分是数据（第 22 节）：字段带边界、动作、概率、效果（set / add / event）、终局条件、世界书门，全部是封闭词汇的数据，由解释器执行。效果里唯一的分支是骰子；LLM 进入结算的唯一入口是概率，随 decide 一起输出、记录在拍上。此前三个 RPG 原型都能写成数据，`loop.ts` 换成数据卡后断言不改。
17. 收尾（第 23 节）：原型阶段到此为止。记录了一个担忧（设计过于 RPG 化、被代码和流程定死）和它的三个具体落点：读数性状态在正文之后由模型分档、代码步进，而不是写之前按菜单结算；输入驱动的窗口需要一次 LLM 判断，媒介未定；玩家直接改正文应被模型容纳但未讨论。原型将搬出本仓库。

## 1. 出发点

SillyTavern（下称 ST）以 preset 为核心：提示词模块化拼接，生成完全由 LLM 自由输出。变量框架（MVU 等）在这个前提下，长期用"让模型在正文里按格式写更新命令，再用解析器提取"的方式维护状态。

讨论的起点是：只要更新仍依赖纯文本格式，这种形态就很难真正可靠。下面先核实 MVU 的现状，再逐步推演。

## 2. 本仓库（MVU）现状

### 2.1 三条更新路径

`src/store.ts:141` 的 `更新方式` 在两种模式间切换，额外模型解析又有三种应答格式：

| 路径 | 机制 | 位置 |
|---|---|---|
| 随AI输出 | 主回复里写 `_.set(...)` 文本 DSL，或 `<patch>` 块中的 JSON Patch | `src/function/update_variables.ts:445` |
| 额外模型解析 · 聊天消息 | 单独请求，模型按文本 DSL 输出 | `src/function/update/invoke_extra_model.ts` |
| 额外模型解析 · 工具调用 | tool call，但参数是 `delta: string`，里面装的仍是文本 DSL | `src/function/function_call.ts:22-38` |
| 额外模型解析 · 格式化输出 | 通用 JSON Patch schema，`strict: false` | `src/function/function_call.ts:129-151` |
| pi 多 provider 网关 | 自建 34 个来源与 OAuth，约一万行 | `src/function/update/pi/`、`doc/pi_multiprovider_integration.md` |

`function_call.ts:9-16` 解释了为什么不在主回复里直接用 tool call：`auto` 模式下模型会无视工具，`required` 模式下正文会被吃掉。这个约束是真实的。

tool schema 的描述里要求模型 *"calculate time passed; decide whether dramatic updates are allowed"*（`function_call.ts:30`）：本应由代码执行的数值规则，被交给 LLM 用自然语言推理。

### 2.2 解析成本

- `extractCommands`（`update_variables.ts:445`）用正则加手写括号匹配查找命令。
- `parseCommandValue`（`update_variables.ts:226`）依次尝试 JSON、JSON5、YAML、受限 mathjs。
- `incremental_repair.ts`（约 34K）专门做修复。

这些代码都在为"模型输出了不规范的文本"兜底。

### 2.3 Zod 的真实位置：外挂的影子执行器

本仓库只在设置（`src/store.ts`）和角色覆盖（`src/function/character_override/schema.ts`）中使用 Zod。对变量做 Zod 校验的是另一个仓库的脚本 `StageDog/tavern_resource` 的 `util/mvu_zod.ts`，由卡作者从 CDN 引入。MVU 与它的联系只有三个事件：

- `mag_command_parsed_for_zod`（`update_variables.ts:901`）
- `mag_command_parsed_ended_for_zod`（`:910`）
- `mag_variable_update_ended_for_zod`（`:1652`）

`mvu_zod.ts` 的实际行为：

1. 在 `on_command_parsed` 中，把每条命令在 `stat_data` 的副本上重新执行一遍（自己实现了 set、add、insert、delete、move），用 `safeParse` 校验后写回。
2. 在 `_ended_for_zod` 中执行 `commands.length = 0`，MVU 自己的执行循环拿到空列表。
3. 在 `update_ended_for_zod` 中把 `variables.schema` 设为字符串 `'没有用别管这个'`，并删除 `display_data`、`delta_data`。`src/function/schema.ts:30` 的 `@ts-expect-error` 特判就是为了配合它。

结果是两套类型机制互斥：卡启用 zod 后，MVU 自己的 schema 推导与调和被外部脚本覆盖。同一套 DSL 也有两份不一致的值解析器；mvu_zod 遇到 `{...}`/`[...]` 会用 `new Function(\`return ${trimmed}\`)()` 求值，等于执行模型输出。

这三个事件已被多个第三方运行时（OmniTavern、dsh-tavern、operit_mvu 等）当作必须兼容的约定照搬，成了一份没写成文档的公共接口。

### 2.4 卡的 schema 无法被 MVU 读取

`registerMvuSchema` 只把 schema 交给 Tavern Helper 的 `registerVariableSchema`，后者存进内部 Pinia store（`JS-Slash-Runner/src/function/variables.ts:10-37`），没有读取接口。MVU 与卡脚本又在不同的 iframe 中，因此"用卡的 Zod schema 生成 JSON Schema 去约束生成"这条路在现有架构下走不通。

## 3. ST 能提供的接口

| 能力 | 位置 |
|---|---|
| 生成前拦截 | manifest 的 `generate_interceptor`（`public/scripts/extensions.js:2033`） |
| 提示词注入、宏 | `setExtensionPrompt`、`registerMacro`（`public/scripts/st-context.js:40`、`:180`） |
| 工具注册 | `registerFunctionTool`，支持 stealth（`st-context.js:183`） |
| 用其他连接配置发请求 | `ConnectionManagerRequestService.sendRequest(profileId, …, overridePayload)`（`public/scripts/extensions/shared.js:423`） |
| 结构化输出透传 | 后端按来源转换 `json_schema`：Claude 走强制工具或 `output_config`，Gemini 走 `responseSchema`，不支持的来源塞进 prompt（`src/endpoints/backends/chat-completions.js:303-318`、`:499`、`:816`） |
| 角色卡扩展字段 | `writeExtensionField`（`st-context.js:207`） |
| 每 swipe 的元数据 | `swipe_info[i].extra`（`public/script.js:3707`），删除 swipe 时与 `swipes` 同步 splice（`script.js:9339` 起的 `deleteSwipe`） |
| server plugin | `/api/plugins/<id>` 路由（`src/plugin-loader.js:213-222`），需用户开启 `enableServerPlugins` |

ST 拥有 `Generate()` 主循环，扩展只能拦截和监听。

## 4. 第一版推演：在 ST 内部做

### 4.1 三个角色

| 角色 | 对状态的权限 | 执行者 | ST 落点 |
|---|---|---|---|
| 叙事者 | 只读 | 主模型 | 宏或 `setExtensionPrompt` 渲染状态 |
| 记账员 | 读写 | 单独一次请求 | `MESSAGE_RECEIVED` 后用 `ConnectionManagerRequestService` 带 `json_schema` 请求 |
| 规则引擎 | 校验、截断 | 确定性代码 | schema 约束 |

代价是每轮多一次调用。

### 4.2 设计决定

1. schema 是数据：JSON Schema 写在角色卡 `data.extensions`，每字段 `description` 给记账员，`x-visible` 控制叙事者可见性。Zod 只作为作者侧工具。
2. 结构化输出复用 ST 后端的 `json_schema` 转换，不自建 provider 层。pi 层的价值在于 ST 连接未覆盖的来源与 OAuth，对"结构化更新变量"不是必需。
3. 输出形状：只含变化字段的 `changes` 对象 + `remove: string[]`。放弃数组元素级操作；路径枚举式 patch 大概率过不了 OpenAI strict 与 Gemini `responseSchema` 的子集限制。
4. 兜底只认 JSON，失败带错误信息重试一次，不再做解析级联。
5. 规则引擎 v1 只做 `minimum`、`maximum`、`enum` 截断；作者 JS 是已知上限，暂不设计。

### 4.3 看过 ERA 之后的修正

ERA 能随意"顺序重算"，是因为重算只是重新解析正文里的 JSON，确定且免费。若记账员是一次 LLM 调用，重算时不能再调模型。修正为：

- 每个 swipe 在 `swipe_info.extra` 中只存**记账员这次的输出**；
- 当前状态 = 沿可见消息链依次合并这些输出；
- 编辑某条消息时只对这一条重新请求。

这等于采用事件溯源，同时不需要往正文插锚点，也不需要可逆日志或完整快照。

## 5. 生态横向调研

### 5.1 各项目要点

**ERA**（`RockingSisyphus/ERA-EfficientRollbackArchitecture`）

- 只有主回复一次调用：正文后接 `<VariableThink>`，再接 `<VariableInsert>`/`<VariableEdit>`/`<VariableDelete>` JSON 块（`doc/…/ERA规则提示词.txt`）。
- 没有类型，只有 `$meta.updatable` 写保护（`src/ERA变量框架/core/crud/update.ts:62`）。
- 解析克制：标准 `JSON.parse` 加去注释与花括号配对（`utils/data.ts:170`、`:242`）。
- 事件溯源：EditLogs 集中存于 chat 变量，以写进正文的 MK 锚点 `<era_data>{...}</era_data>` 对应消息（`core/key/mk.ts`）；`resyncStateOnHistoryChange` 找分歧点、逆序撤销、顺序重算（`core/sync.ts`）。
- 它要绕开的"删 swipe 后内容与变量错位"，ST 核心的 `swipe_info` 并不存在（见第 3 节）；推测问题出在 Tavern Helper 自存的消息变量，未在 TH 中确认。
- 未看到清理已删除 MK 日志的逻辑（仅 grep，未实测）。

**LittleWhiteBox**（`RT15548/LittleWhiteBox`）

- 变量 1.0：`<plot-log>` 块 + 每楼快照（`modules/variables/variables-core.js:52`）。
- 变量 2.0（state2）：主回复输出 `<state>` 块（YAML 风格 `路径: 值`，`+{}` 追加）；`$schema` 按示例声明结构，`$range`/`$step`/`$enum`/`$ro` 在写入时强制执行（`modules/variables/state2/README.md`）。这是对比中唯一做到写入时类型强制的方案。schema 本身也写在消息正文中，后续楼层的写入日志可携带规则（`state2/executor.js:373`），未确认是否禁止 AI 修改 schema。
- 存储：`chat_metadata` 中每楼一条写入日志（`executor.js:373`），每 N 楼一个全量 checkpoint（`:388`），内容签名保证幂等；回滚 = 恢复 checkpoint + 重放（`:665`）。
- varevent：`condition` 用 `eval`（`modules/variables/varevent-editor.js:195`），`js_execute` 用 `new Function`（`:204`）；来源包括 `CHAT_COMPLETION_PROMPT_READY` 时组装好的整个 prompt（`:292`），其中含历史 AI 回复。静态阅读未实测，可能存在未发现的开关。
- Tavern 模块（`modules/tavern/`）：嵌在 ST 中的独立聊天运行时。会话与消息存在自建 IndexedDB（Dexie，`shared/session-db.ts`），自有回合循环（`app-src/runtime/run-once.ts`）与 provider 适配器；每轮后由 Manager agent 用真实工具循环（`app-src/runtime/manager.ts:439-440`）维护 Memory、Map、Status、Tasks 等领域状态，带事务、版本号检查、dryRun。文档写明"Prompt 负责空间组织与证据政策，schema 负责字段、枚举与渲染语义，工具结果负责反馈"（`modules/tavern/docs/manager-prompt-and-map-contract.md`）。领域写死，是游戏产品而非通用变量框架。

**Luker**（`funnycups/Luker`，ST fork；子代理阅读）

- floor-state：按（楼层, swipe）记录 RFC 6902 JSON Patch 提交，删除、删 swipe、分支由核心代码在插件事件前处理（`public/scripts/floor-state/core.js:1-29`、`:130`、`:154`；`floor-state.js:409-438`）。明确不支持聊天中途切换 swipe（`core.js:23-26`）。写入者只有代码，无 schema。
- variable-op-log：把回复里的 `{{setvar}}` 等宏提取为 `message.extra.var_ops` 并在历史变化时重放（`public/scripts/variable-op-log/`）。值为字符串，无 schema。
- `generateTask({tools | jsonSchema})`：带类型的单次请求 API，但 schema 只交给 provider，本地只 `JSON.parse`（`public/scripts/generate-task.js:781-815`）。
- `message-takeover`：扩展可接管回复槽位（`script.js:9062-9102`）。
- Orchestrator 扩展的 Director 模式：接管 `GENERATE_TAKEOVER_DISPATCH`，跑 LLM 主 agent 工具循环（默认最多 40 轮），工具不写游戏状态。
- 卡自带工具用 `new AsyncFunction` 编译（`per-run-custom-tools.js:16-40`），CardApp 是同源 `import()`（`card-app/loader.js:231-234`），无沙箱。

**TauriTavern**（`Darkatse/TauriTavern`；子代理阅读）

- 保留 ST 1.18.0 前端，后端用 Rust/Tauri 重写，前端拦截 `/api/...` 路由到 Rust 命令（`docs/FrontendGuide.md`）。
- "包管理器"指各 OS 的安装渠道（winget、Scoop、Homebrew 等），没有扩展注册中心。
- Agent 模式：前端组装首个 prompt 后由 Rust 接管工具循环（`docs/Agent/README.md:31`），LLM 决定调用什么、何时结束。内置工具中唯一的确定性游戏原语是 `dice.roll`。
- Skill 脚本跑在 QuickJS 沙箱（30 秒、32 MB，无网络与 DOM；`tt-adapter-quickjs/src/engine.rs`），仅在模型调用时执行。
- 每个 swipe 一个版本的工作区 `persist/`，ID 写入 `message.extra.tauritavern.agent.persistStateId`（`docs/Agent/Workspace.md:64-70`）。
- 无原生变量系统、无 schema；对 MVU/JSR 只做渲染与生命周期兼容。

**PureTavern**（`Lianues/PureTavern`）

- 把 ST 移到纯前端，数据存 IndexedDB，可选远程代理只转发请求；首次启动离线导入 Tavern Helper 4.8.19，MVU 原样可用。对状态没有新设计。

**DeepSeek Harness（DSH，`deepseek-ai/deepseek-harness`）与 dsh-tavern（`Player-MINEPIG/dsh-tavern`）**

- DSH 自称 "Everything is a Plugin"：会话是只追加事件日志，分支是原生 fork；agent 循环通过一串 waterfall 钩子开放（system-prompt 组装、pre-step、request 配置、`tools.guard`、`llm/stream`、session 事件）；工具、权限、沙箱是一等概念。
- dsh-tavern 把 ST 的卡、preset、世界书导入 DSH，但"不替换 agent 循环，不保存第二份对话历史"（`docs/DSH_MESSAGE_FLOW_en.md`）。swipe、回滚、分支都实现为 DSH 会话 fork。
- 明确不支持 MVU 与 Tavern Helper；RP 模式钉死只读沙箱并拦截高危工具，没有任何状态系统。
- 它指出 harness 的代价：DSH 没有请求时重排消息列表的钩子，ST 式"在第 N 层以某角色注入"做不到。harness 拥有历史，就收走了 preset 依赖的自由拼装。

**Liyuan**（`weidu12123/Liyuan`；二手，来自 `flizzywine/dsh-tavern` 的审计文档 `docs/research/liyuan-mvu-compatibility.md`）

- 剥除主模型可见的 MVU 更新规则，主模型只写正文；另一次隐藏的"场记"模型读正文与当前状态树，输出补丁写入宿主自有的状态树。与第 4 节的拆分思路独立趋同。

### 5.2 横向对比

| 项目 | 谁掌握回合循环 | 状态存在哪 | schema | 谁写状态 | 卡/扩展代码隔离 |
|---|---|---|---|---|---|
| MVU | ST | 每楼快照 | 外挂 Zod，事后校验 | LLM（文本 DSL，或额外调用） | 无 |
| ERA | ST | 修改日志 + 正文锚点 | 无 | LLM（回复内 JSON） | 无 |
| 小白 state2 | ST | 写入日志 + checkpoint | 写入时强制检查 | LLM（回复内 YAML） | 无（varevent 用 `eval`） |
| 小白 Tavern | LLM（Manager agent） | 自建 IndexedDB | 领域工具写死 | LLM（带类型工具） | — |
| Luker | ST + Director agent | 按（楼层, swipe）的 JSON Patch 日志 | 无 | 代码；`{{setvar}}` 宏 | 无 |
| TauriTavern | Agent 模式下为 LLM | 每 swipe 一版工作区文件 | 无 | LLM（改文件） | QuickJS 沙箱 |
| dsh-tavern / DSH | DSH | 事件日志，分支即 fork | 无 | 无（RP 只读） | 权限层，非沙箱 |
| Liyuan（二手） | 自建 | 自建状态树 | 无 | 隐藏场记模型 | — |

## 6. 观点演进

### 6.1 GUI 类比：两个独立的本质

手写 YAML/JSON 配置与用 GUI 填表的差别有两层：

1. **正确性由媒介保证。** 对 LLM 而言就是约束解码与 tool calling。在 prompt 里要求"必须输出严格合法的 JSON"，等于让人手写配置再祈祷别写错；解析级联与修复器就是给手写配置做的纠错器。schema 不会消失，它从"给填写者看的说明"变成"媒介本身的形状"。
2. **操作单位从"改数据"变成"做动作"。** GUI 上点"购买"，背后封装了扣钱、加物品、检查余额。现有方案（包括第 4 节）都让模型直接改状态，即便套上约束解码也仍是记账。

由此推出职责划分：模型判断"发生了什么"，从给定动作中选择并填参数；代码计算变化、执行约束、存储。从叙事中抽取事件是语义理解，正是 LLM 擅长的；维护数值一致性是记账，正是它不擅长的。MVU 的 "decide whether dramatic updates are allowed" 与 state2 的 `$step`，都是在先让模型算数之后再限制它算得别太离谱。

边界：开放世界需要兜底的自由文本动作（进入记忆，不进入数值）；动作效果必须有人定义；卡作者侧也应有 GUI 式的结构编辑器。

### 6.2 卡必须是代码；关键是谁掌握主循环

生态里的卡早已是代码，只是没有沙箱、没有类型、没有确定性：mvu_zod 从 CDN 加载并通过未文档化事件接管执行，varevent 直接 `eval`，ERA 往正文写锚点，Tavern Helper 本身就是 iframe 脚本注入运行时。ST 拥有 `Generate()`，扩展永远寄生在别人的循环里，于是每个框架各自重造解析、存储、回滚、provider 层。

控制反转后的结构：

```ts
// 卡 = 一个确定性的游戏程序；LLM 只作为它调用的带类型函数存在
interface Card<S, A> {
  init(seed: number): S;
  actions: JsonSchema;                                    // 玩家意图的类型
  step(s: S, a: A, rng: Rng): { s: S; events: Event[] };  // 纯函数，可重放
  view(s: S): Visible;                                    // 叙事者可见部分
}

interface Llm {                                           // harness 提供，约束解码保证类型
  parse<A>(input: string, ctx: Visible, schema: JsonSchema): A | Unsupported;
  narrate(events: Event[], ctx: Visible, style: Style): string;
}
// 回合：玩家文本 → parse → step → narrate
```

harness 需要提供：沙箱运行时、带种子的随机数与纯函数 `step`（确定性重放）、带类型的 LLM 调用、支持分支的状态存储。

两个代价：

1. **"AI 不当 GM"是另一种产品。** 能发生的事件上限是作者写进 `step` 的内容；玩家输入映射不到动作时只能返回 `Unsupported`。因此 AI 是否参与裁决应由作者选择（例如在 `step` 内调用 `llm.adjudicate()`），框架不预设立场。
2. **渲染出的文字一定会越界。** 采取"文字不具备权威性，状态以引擎为准，UI 展示引擎状态"的立场。

这一形态在 ST 内部做不出来，因为 ST 拥有循环。现成组件最接近的是 Luker（`message-takeover` + `generateTask` + `floor-state`），缺沙箱、本地 schema 校验、由卡驱动回合；沙箱可参考 TauriTavern 的 QuickJS。缺的是"卡就是程序"的约定和写卡工具，而不是基础设施。

## 7. Effect v4 原型

### 7.1 使用的原语

使用 `effect@4.0.0`（2026-10-01 发布；当时最新为 4.0.2，因本机 npm 新版本冷却期未安装；`@effect/ai-*` provider 包同样未安装）。

**`effect/ai` 的 `Decision` / `DecisionModel`（`@stability unstable`）**

- 三种判断：`classify`（选标签）、`rate`（有序档位）、`probability`（成立概率）。
- `ClassifyAnswer`、`RateAnswer` 返回完整 `probabilities` 分布，`rating` 是按概率加权的位置（`dist/ai/Decision.d.ts:99-130`）。
- `DecisionModel.make` 校验分布之和为 1、评级在档位范围内，不合格报 `AiError.InvalidOutputError`（`dist/ai/DecisionModel.d.ts:164-168`）。
- 用法上的解读（非 Effect 文档声明的意图）：模型估计"成功概率""对手危险度"，代码掷骰子、算伤害，对应跑团里"GM 定难度、骰子定结果"；模型只能在给定标签与档位内作答，合法性由库保证。

**`effect/ai/OpenAiStructuredOutput.toCodecOpenAI`（`dist/ai/OpenAiStructuredOutput.d.ts:57`）**

- 原文："The codec remains authoritative: the provider JSON Schema can be a lossy, less restrictive representation."
- 转换：可选字段 → 必填可空；带索引签名的对象 → `[key, value]` 数组；`oneOf` → `anyOf`；根节点必须是对象且不能是 `anyOf`。
- 即 schema 只维护一份：投给 provider 的可以宽松，解码仍按原 schema 严格校验。这回答了 4.2 节对 strict 模式的担心，也补上了 MVU 与小白 state2 的缺口。

**`Random.withSeed`（`dist/Random.d.ts:260`）**：同一种子产生同一随机序列。

### 7.2 结构

| 层 | 内容 | Effect 对应 |
|---|---|---|
| 卡 | `State`/`Judge` 的 schema + 纯函数 `step` | `Schema`、`Decision.make` |
| 判断 | 每回合一次结构化调用 | `DecisionModel`，通过 Layer 注入（真实 provider 或测试实现） |
| 日志 | 树形节点 `{parent, input, answers, seed}` | 原型用 `Map`；状态 = 从根到节点的依次结算 |
| 确定性 | 每节点一个种子 | `Random.withSeed` |
| 不变量 | `step` 结果按 schema 解码 | `Schema.decodeUnknownSync` |
| 叙事 | 事件 → 文字，不具备权威性 | 原型为桩函数；生产用 `LanguageModel.generateText` |

### 7.3 代码

代码见 `prototype/harness.ts`。`DecisionModel` 是测试实现（关键词规则），不是真实模型。

### 7.4 运行方式与结果

`prototype/` 是独立的 npm 目录，不在本仓库的 tsconfig、eslint、jest 范围内（注：2026-10-09 之前其 tsconfig 只列了前六个文件，`views.ts`、`assemble.ts`、`loop.ts` 的首版未经 `tsc`，见第 20 节）：

```sh
cd prototype && npm i && npm run check   # tsc + 各原型的断言
```

2026-10-08 在 Node 26.5.0、TypeScript 7.0.2 下的输出（类型检查无错误，断言全部通过）：

```text
#0 {"hp":100,"gold":25,"day":1}  You win 25 gold.
#1 {"hp":45,"gold":25,"day":1}  You take 55 damage.
#2 {"hp":65,"gold":25,"day":2}  You rest (+20 hp).
fork #3 from #0: {"hp":100,"gold":25,"day":2}  You rest (+0 hp).
{"type":"object","properties":{"hp":{"type":"integer","minimum":0,"maximum":100,"description":"a value between 0 and 100"},"gold":{"type":"integer","minimum":0,"description":"a value greater than or equal to 0"},"day":{"type":"integer"}},"required":["hp","gold","day"],"additionalProperties":false}
ok
```

断言验证的是：重放结果等于实时结算结果且可重复；重放不调用模型；从中间节点分叉不影响原分支；越界状态被 schema 拒绝。

### 7.5 原型没有证明的、以及 Effect 不提供的

| 项 | 现状 | 方向 |
|---|---|---|
| 真实模型的判断质量 | 完全未测；概率与评级为手填 | 接真实 provider，检验分布是否校准、是否稳定。这决定"LLM 只判断"能否在实际中成立 |
| 沙箱 | Effect 程序形式的卡是完全受信任的代码 | 卡放进 Worker（`effect/workers`），宿主与卡之间以 `Schema` 定义 RPC（`effect/rpc`）；宿主持有模型与日志，卡只持有 `step` |
| 树形日志 | `effect/eventlog` 是同步/复制用的事件日志，未确认支持分叉 | 自建树形日志，存储层可用 `effect/persistence` |
| 模型调用的持久化 | 原型中调用失败即失败 | 用 `effect/workflow` 的 `Activity` 包裹，持久化并可安全重放 |
| 带参数的动作 | 意图只做了分类 | `buy(item)` 一类需要 `LanguageModel.generateObject`，未覆盖 |
| API 稳定性 | `Decision` 标记为 unstable，发布一周 | API 可能变化 |

## 8. 提示词装配原型：preset、世界书、swipe

代码见 `prototype/prompt.ts`。第 17、18 节取代了本节的一部分（`assemble` 在第 18 节重做）：`keys`、`trigger`、任意层的 `depth` 与 `Node extends Msg` 的交替楼层树退役；`when`、`before`/`after`、纯锚点保留，第 16.5 节仍建在其上。`prompt.ts` 本身未改，本节保留作对照。目标不是兼容 ST 的数据格式，而是找出 preset 与世界书背后最小的结构。

### 8.1 一个形状：Fragment

ST 的 preset 条目与世界书条目只是默认值不同，可以合并为同一种 `Fragment`，由两个正交维度描述：

| 维度 | 取值 | ST 中对应 |
|---|---|---|
| 激活 | `enabled`（用户开关，可被 `options` 覆盖） | preset 条目开关 |
| | `trigger`（生成类型 normal / swipe / continue） | preset 的 `injection_trigger`（`public/scripts/PromptManager.js:182`） |
| | `keys`（在扫描窗口内匹配） | 世界书关键词，扫描深度 |
| 位置 | 无 `at`：按列表顺序排布，列表本身就是布局；`id: "history"` 是聊天记录 | preset 的相对位置条目与各 marker |
| | `before` / `after` 任一 fragment 的 id | 世界书 before/after char、AN top/bottom、EM top/bottom（`public/scripts/world-info.js:855`） |
| | `depth`：插在聊天记录倒数第 depth 条之前，注入项不计数，超出长度则置顶 | 世界书 atDepth、preset 的 in-chat 条目、作者注释 |

由此得到的几点：

- **锚点不需要单独的概念。** 任何 fragment 的 id 都是锚点；无文本的 fragment 就是纯锚点（ST 的 marker）。挂在锚点上的内容随锚点一起启停；锚点 id 不存在时直接报错，不静默丢弃。
- **扫描窗口 = 最新输入 + 之前 scan-1 条消息。** "以用户最新输入为基准"的动态插入，就是 `depth` 位置加上窗口内的关键词激活。
- **代码生成的 fragment 与数据 fragment 地位相同。** 第 7 节的状态视图、变量渲染，只是往列表里多放几个由代码算出的 fragment，不需要宏语言，也不需要单独的插件接口。
- **harness 掌握历史不妨碍自由拼装。** 5.1 节记录了 DSH 因为没有重排消息的钩子而做不到"在第 N 层以某角色注入"；这里历史只是 `assemble` 的一个参数，`depth` 注入直接落在 provider 收到的 `Prompt` 里（见 8.3 断言）。问题在钩子设计，不在 harness 拥有历史。
- **装配是纯函数** `assemble(fragments, path, { kind, options, scan }) → Prompt`，输出 `effect/ai` 的 `Prompt`，任何 provider Layer 都能直接消费。Effect 在这里只提供数据的 Schema 校验（如 `depth ≥ 0`）、`Prompt` 类型和 `LanguageModel` 服务接口；装配本身不需要 Effect。

### 8.2 Swipe

swipe 不是独立功能：聊天是一棵树，swipe = 同一父节点下再生成一个子节点，历史 = 从根到当前节点的路径。因为装配只读路径，世界书激活自动跟随选中的分支；sticky、cooldown 一类计时效果原则上也能沿路径重算，不需要额外存储（未实现）。这与第 7 节的日志树是同一棵树。

### 8.3 断言覆盖

- 禁用条目不出现，`options` 可覆盖开关；`before`/`after` 落在锚点两侧。
- 同一 `depth` 的条目按 `order` 排序；`depth 2` 落在倒数第二条之前，`depth 0` 落在最新输入之后；验证的是 fake provider 实际收到的 `Prompt`。
- 同一用户输入在两个 swipe 分支上激活不同的世界书条目；扫描窗口移出后，早先命中的关键词不再生效。
- swipe 专属条目只在 `kind: "swipe"` 时出现。
- 未知锚点、挂在非内联 fragment 上的锚点、缺少 `history` 时的 `depth` 都报错；`depth: -1` 在解码时被拒绝。

### 8.4 未覆盖

互斥选项组（单选；目前 `options` 只覆盖独立开关）、次要关键词与逻辑、递归激活、概率、token 预算、计时效果、多世界书合并与优先级、连续 system 消息的合并（交给 provider 层）、流式生成与 continue 的拼接。均不影响上述结构，需要时在 `assemble` 内增加。

## 9. 回合即流程：turn 原型

代码见 `prototype/turn.ts`。一次回合不是一次 LLM 调用，而是固定骨架的流程：

```
lookup → decide → resolve → narrate → record
 (LLM)    (LLM)    (代码)    (LLM)     (LLM)
```

- **先结算，后叙述。** MVU 是先写正文、再更新变量，两者容易对不上。这里 `resolve` 由代码掷骰并产生事件，`narrate` 只渲染已定的结果；`record` 在正文之后抽取软事实（记忆、印象），不碰数值。
- **骨架固定，内容可空。** 每个回合节点都有同样的块：`read`、`decide`、`seed`、`prose`、`notes`。LLM 的输出逐块记录；`resolve` 的结果在重放时重新推导。
- **每个阶段有自己的请求形状。** lookup、decide、record 用结构化输出；narrate 是纯文本，不带工具。这绕开了 §2.1"`auto` 模式下模型无视工具，`required` 模式下正文被吃掉"的困境。
- **lookup 的闸门就是 schema。** 可选条目是按当前状态生成的字面量枚举，未解锁的条目不是合法答案，目录里也不出现。
- **校验失败只重试该阶段。** decide 解码失败会重新请求 decide，不会重跑 lookup。
- **swipe 分三种**，都是从某个阶段起重新执行：
  - `reword`：从 narrate 起。意图、种子、事件不变，只换文字。
  - `reroll`：从 resolve 起。意图不变，换种子，结果可能翻转。
  - `rethink`：从 lookup 起，全部重来。

断言覆盖：

- 各阶段的调用顺序，以及 narrate 请求不带工具。
- 未解锁的条目解码失败，解锁后可以被读取。
- decide 失败时只重试 decide。
- 三种 swipe 各自只调用自己及下游的阶段。
- 所有 swipe 都是同一父节点下的兄弟节点。
- 重放不调用模型，原分支不受影响。

两处变异（去掉重试、让 swipe 全部重跑）都会让断言失败。

未覆盖：

- lookup 走真实的工具循环（现在是一次结构化选择）。
- 一个回合内 decide→resolve→narrate 重复多次，比如打斗中途掷骰。
- 导演与叙事者的上下文隔离。
- 阶段间共享前缀（目前每个阶段是独立的 prompt）。
- 用 `effect/workflow` 的 `Activity` 做可续跑执行。

## 10. 一回合多次结算：beats 原型

代码见 `prototype/beats.ts`。问题：一次玩家输入可能对应多次结算，比如"砍到它倒下为止"、"小心地进攻，受伤就撤"。第 9 节"块的形状固定"的前提能否成立？

### 10.1 四种做法

| 做法 | 问题 |
|---|---|
| A. 一次决定规划所有动作，代码依次结算，最后叙述一次 | 规划时看不到结果，"受伤就撤"只能由代码预先编码条件 |
| B. 每个动作都走一遍"决定 → 结算 → 叙述" | 叙述调用 N 次，正文分段拼接；换说法会牵连后续所有段 |
| C. 叙述者写到一半调用掷骰工具，拿到结果再继续写 | 循环由模型掌握，模型可以不掷骰直接写结果（§2.1 的 `auto` 问题）；从正文里证明不了"该掷没掷" |
| **D. 结构化层循环"决定 → 结算"，最后叙述一次** | 第一个正文 token 之前要等所有决定完成 |

采用 D：

- 循环发生在结构化输出这一层，每次决定都能看到之前的结果，所以能随结果调整（A 做不到）。
- 正文只写一次（B 做不到）。
- 掷骰由代码执行，模型绕不过去（C 做不到）。

D 的延迟代价可以由前端承担：每结算完一拍，就先显示骰子和数值变化，相当于桌上先掷骰、GM 后讲述。

### 10.2 依赖规则

决定 k 只看状态和前 k 拍的事件，不看正文；正文能看到一切。这条规则直接规定了 swipe 要重做什么：

- `reword`：只重新叙述，所有拍不变。
- `reroll(k)`：保留前 k 拍和第 k 拍的决定，第 k 拍换种子，之后的拍全部重新决定，再叙述。
- `rethink`：同一父节点、同一输入，重新 `run()`，与第 9 节一致。

块的形状仍然固定：`{ beats: Array<{ decide, seed }>, end, prose }`，只是"决定"从单个值变成了数组。

### 10.3 终止

"结束"是模型看过已有结果之后做出的决定（`next: "end"`），不是结算之前预先猜的标志。另有两种由代码终止的方式：有人血量归零或已逃跑（`over`），以及拍数上限（`cap`）。三种原因都记录在回合里。

### 10.4 断言覆盖

- "砍到倒下为止"：循环由代码终止，每拍一次决定，最后只叙述一次，叙述能看到全部事件。
- "进攻一次"：一拍之后模型决定结束。由模型结束时会多出一次决定调用（决定次数 = 拍数 + 1）。
- 第 k 次决定的提示词里恰好包含前 k 拍的事件。
- "小心进攻"：第一拍受伤后，第二次决定选择逃跑。
- 拍数上限由代码执行。
- `reword` 只调用叙述，所有拍不变。
- `reroll(1)`：第 0 拍不变，第 1 拍决定不变、种子变；只对之后的拍重新调用决定。示例中第 1 拍重掷后仍然命中，但之后的拍用了新种子，第 3 拍变成受伤，最终以 `cap` 结束，而不是击倒对手。
- 重放不调用模型。

两处变异（决定看不到已有事件、重掷时保留所有拍）都会让断言失败。

### 10.5 未覆盖

- 中途把控制权交还玩家（`ask`）：语义上等同于 `end`，但需要 UI 配合。
- NPC 自己的回合。
- `reroll` 没有检查 `k` 是否越界。
- 一次决定同时产生多个并行动作。
- 叙述必须穿插在结算之间的场景，例如中途揭示改变了后续选择；目前认为这种情况应拆成多个回合。

## 11. 揭示时刻与本轮简报

本节是讨论记录，没有原型。

### 11.1 问题

第 10 节的例子都偏 RPG。纯文本 RP 更常见的情形是：自由对话，加上一些大纲性质的线索与伏笔。设想一个武侠场景：主角 A 与反派 B 对打，用户和叙事者都不知道 B 的身份。用户输入"出剑"，正文写到剑划破 B 的衣服，露出一枚纹身，A 认出那是失踪多年挚友才有的纹身。这样的揭示，在 harness 里应该以什么形式展开？"动态提示词"是在本轮生效，还是下一轮生效？

### 11.2 两个时间点与一条硬约束

- **读者何时感受到揭示**：必须在本轮正文里。推到下一轮，中间会插进玩家的输入，这场戏就断了。
- **系统何时提交揭示**：可以在写正文之前，也可以在之后。
- **硬约束：正文不可能包含写作者不知道的信息。** 对作者预设的秘密，不存在"写完后 judge 发现、再反哺本轮"的路径，除非重写或续写。写完之后能提交的，只有叙事者已经写出的东西。

"用户和 AI 都不知情"因此是两种不同的情况：

- **作者预设的秘密**：系统里一定有人知道，"推演"是导演做的；叙事者的任务是把埋好的细节写得像偶然撞见。
- **即兴转折**：本来就没有被隐藏的东西，系统要做的只是把新事实收进正史。

### 11.3 三种机制

| 机制 | 谁决定 | 叙事者何时知道 | 系统何时提交 |
|---|---|---|---|
| 计划式 | 导演在决定循环中发出 `Reveal` 这一拍 | 写之前，收到明确指令 | 写之前（结算阶段） |
| 待发式 | 导演与代码打开窗口，叙事者挑时机 | 窗口打开时，指令是"合适时可以揭示" | 写之后，记录阶段确认确实揭示了才提交 |
| 涌现式 | 叙事者即兴发挥 | 它自己发明的 | 留在历史里即可 |

上面的武侠例子属于待发式。"写完再检测"行不通：叙事者在不知情的状态下，最多只会写出"一道旧伤疤"。

**与第 8 节的张力。** 待发式确实把秘密交给了叙事者，但只在导演和代码批准的窗口里。最坏的情况是"窗口内揭示得稍早"，而不是"整局都在漏底"。是否开窗由导演和代码决定，叙事者只决定写在哪一句。第 8 节的原则因此收窄为"窗口外不能给"。

**reword 的限定。** 在开了窗的回合里，两个兄弟 swipe 可能一个揭示、一个没有，提交的正史就不同。这是正确的，因为它们本来就是两个分支。但第 10 节"换说法只改文字"的说法需要加上这个限定。

### 11.4 泛化：本轮简报

揭示只是一个实例。纯文本 RP 里，本轮正文同时受几股力量牵引：

- 玩家输入：玩家的能动性；
- 作者的长线安排：线索、大纲、节奏；
- preset 的常驻规则；
- 叙事者自己的发挥。

ST 把它们一起塞进一个提示词，让 LLM 隐式地裁决，指令打架、强行推剧情、大纲被无视，大多源于此。

本轮简报把裁决显式化、按回合进行：写之前，给叙事者一份 `must` / `may` / `must-not` 清单；写之后，做针对性的检查。

- 计划式揭示 = `must`
- 待发式揭示 = `may`
- 伏笔线索 = 可以暗示的 `may`
- 未解锁的秘密 = 不出现在简报里
- 设定冲突 = `must-not`

它在第 9 节流程里占据的，正是 RPG 卡里"决定 → 结算"的位置：**RPG 卡在写之前结算数值，文本卡在写之前裁决意图。**

由此得到两层指令：常驻规则归 preset，本轮意图归简报。ST 里许多"破限、指令和用户输入互相打架"的问题，都是常驻规则在做本该按回合做的事。

**最难的冲突是作者的 `must` 与玩家的行动。** 导演计划"划破衣服、露出纹身"，用户却输入"我收剑离开"。这时简报必须改变计划：推迟揭示，或者换一种暴露方式。所以导演裁决必须是看过用户输入之后、按回合做出的 LLM 判断，不能是静态规则。建议的默认优先级如下，卡可以覆盖（第 13 节修订了这一默认：`must` 与 `must-not` 都改为按需开启，默认只有"玩家优先于作者的机会"）：

1. `must-not`（秘密、设定）
2. 玩家对自己角色的控制权
3. 作者的 `must`
4. `may`
5. 风格

### 11.5 深浅与边界

**harness 一侧很薄**，只提供：

- 叙述之前的一个槽位与简报 schema；
- 由状态决定哪些条目能进入简报，沿用 `turn.ts` 的"枚举即闸门"；
- 叙述之后的一次针对性检查；
- 一条写回状态的路径。

怎么裁决、怎么写，交给 LLM 和卡作者。所以它不是边角补丁，而是文本卡的骨架；同时也不是镣铐：没有声明线索的卡，简报为空，也不发生导演调用，退化为纯聊天。成本只随卡声明的内容增长。

三类机制的归属：

- **涌现式**：留在 LLM 层。历史本来就承载了它，harness 只需不去妨碍。
- **对照设定**：harness 提供挂钩，但只做针对性检查。检查范围仅限本轮简报的 `must` / `must-not` 和尚未解锁的线索阶段，不做开放式的事实抽取。一次分类调用，失败就重写或记录。
- **计划式、待发式**：属于 harness，因为它们依赖状态闸门和写回：`Revealed` → 线索阶段 → 下一轮的 `view`。

### 11.6 仍未解决

穿插叙述（叙述 → 判断 → 续写）只在一种情况下需要：即兴产生的事实，要在同一轮触发作者预设的揭示。在真实的卡提出需要之前不做。

## 12. 本轮简报：brief 原型

本节记录的是第一版：默认就调用导演，`must-not` 写进叙述提示词。第 13 节把它改成了分层、按需开启的形态，`prototype/brief.ts` 现在是第 13 节的版本，本节保留作对照。

第一版验证了第 11 节的骨架。示例卡有两条线索：`friend`（B 就是挚友，纹身）和 `heir`（挚友是隐藏的王位继承人）。

### 12.1 五个环节

| 环节 | 执行者 | 内容 |
|---|---|---|
| gate | 代码 | 根据状态和输入决定哪些线索开窗：`friend` 需要拔剑且尚未揭示；`heir` 需要已经揭示 `friend` 且提到王位 |
| direct | LLM | 只在已开窗的线索里挑 `must` / `may`，schema 的字面量枚举就是开窗列表；没有开窗时不发生调用 |
| narrate | LLM | 只看到简报条目和已经揭示的事实；`must-not` 由开窗线索的 `protect` 提供 |
| check | LLM | 对简报条目做一次分类，判断哪些已揭示、哪些违规；违反 `must-not` 或漏掉 `must` 时只重新叙述，最多一次，重写的提示词附上"上一稿错在哪" |
| record | 代码 | 已揭示的条目是唯一的写回；状态 = 路径上所有已揭示条目的并集。重写后仍未修正的违规记在回合里，交给 UI |

### 12.2 断言覆盖

- 客栈寒暄时没有开窗：只调用一次叙述，退化为纯聊天。
- 拔剑开窗：导演把 `friend` 列为 `may`。第一稿写死了 B，违反 `must-not`，只重写叙述；第二稿揭示了纹身。调用顺序为 `direct, narrate, check, narrate, check`。
- 对同一份简报做 `reword`，这一稿没有揭示，两个兄弟分支提交的正史不同。
- 揭示后的下一轮：叙述提示词的已知事实里有 B 的身份，窗口关闭，不调用导演。未揭示的分支再次拔剑时，窗口重新打开。
- `must`：第一稿漏掉揭示，重写的提示词写明"missed MUST friend"，第二稿揭示。
- 重写机会用尽（两稿都写死了 B）：保留正文，回合记录 `violated: ["friend"]`。重写的提示词附上了被违反的 `protect` 原文。
- `heir` 的窗口从未打开，它的秘密没有出现在任何提示词里，包括导演的提示词；开窗列表只有 `friend` 时，`heir` 无法解码进简报。

五处变异都会让断言失败：

- 不重新叙述；
- 门控失效，所有线索都开窗；
- 简报为空时仍调用导演；
- 重写提示词丢掉原简报；
- 漏掉 `must` 时不重写。

### 12.3 观察与未覆盖

- **导演也受门控。** 导演只看到已开窗线索的秘密。如果伏笔需要导演提前知道更多，就要给线索增加"可暗示"阶段，而不是放宽门控。
- **`protect` 本身会透露一点信息。** "B 这一轮不会死"暗示 B 有剧情分量。只在开窗时出现，代价可以接受。
- **重写必须说明错在哪。** 用相同的提示词重写，真实模型大概率会写出同样的错误；所以重写时附上检查结果。检查只是发现问题，附上错误才能纠正方向。
- **重写失败时的处理。** 一次重写后仍然违规，就保留正文，把违规记在回合里，由 UI 决定是否提示用户。
- **未覆盖：**
  - 由导演主动产生的 `must-not`（目前只来自线索声明）。
  - 作者的 `must` 与玩家输入冲突时的改写。
  - 检查所用的真实分类质量。
  - 穿插叙述。

## 13. 分层的简报与作者规则

代码见 `prototype/brief.ts`（取代第 12 节的版本）。

### 13.1 为什么放松

作者的 `must` 与玩家的行动没有通解：玩家会怎么推进、LLM 会被哪段提示词带着走，都无法预知。过去在纯文本提示词里"上锁"，即大篇幅地列出禁止事项，长期来看会"破线"，原因有二：

1. **提示词之间互相拉扯。** 禁令与玩家输入、角色设定相互较劲，哪边的效应强，就往哪边走。
2. **禁令本身就是提示。** "禁止出现 X"会把 X 一直放在上下文里。聊得越久，禁令的权重被稀释，X 却始终在场。

所以简报不应是默认生效、积极干预的机制。它应该拆成两类：

- **信息闸门**：不往提示词里加内容，而是把未开窗的秘密拿掉。它没有张力，也没有额外调用，适合作为默认。
- **行为约束**：作为高门槛的护栏，由创作者主动开启。

### 13.2 四层

| 层 | 内容 | 额外调用 | 默认 |
|---|---|---|---|
| 闸门 | 未开窗的线索不进入任何上下文，包括导演的 | 无 | 开 |
| 机会 | 开窗的线索作为 `may` 交给叙事者；检查一次是否揭示，以便写回 | 有开窗线索时一次 | 开 |
| 导演 | LLM 在开窗线索中挑 `must` / `may`，规划时能看到作者规则 | 一次 | 卡开启才有 |
| 护栏 | 作者规则只在事后检查，不预先给叙事者看；违规时附上被违反的规则原文，让叙事者重写 | 每轮一次检查，加上可能的重写 | 写了规则才有 |

默认情况下，玩家优先于作者。作者的工具是"机会"而非"命令"：玩家收剑离开，窗口就留到下次。

**护栏放在叙事者的提示词之外。** 原因有两个：

- 叙事者的上下文里不出现被禁的概念，也就不会被引向它。
- 检查是一次独立的小调用，只读本轮正文和规则，不读聊天记录，所以不会随对话变长而失效。

代价是重写次数可能多一些。叙事者唯一会看到规则的时刻，是违规之后的那次重写。这句纠正必须是临时的：它放在第 8 节三区中的尾部，只用于这一次重写，不能沉淀进日志。否则纠正一多，就会在日志里重新累积出一份禁令清单。始终需要叙事者看到的常驻指令，应该放在 preset 里，而不是写成护栏规则。

### 13.3 作者规则的对接

卡编辑器提供一个可选的输入栏。作者可以写自然语言，也可以勾选预置模块（如 `no-ntr`）。

- **在编写时编译一次，而不是每轮解析。** 自然语言由一次 LLM 调用拆成若干条可以单独检查的原子规则；模块直接展开成规则。结果按 `Rule = { id, text }` 的 schema 校验后存进卡里，并回显给作者确认或修改。这个 schema 就是编辑器与 harness 之间的契约。
- **写了才生效。** 输入栏为空时：没有编译调用，没有护栏检查，任何提示词里都没有规则。
- **规则在运行时的去向：** 导演（若开启）规划时能看到；检查调用每轮都看到；叙事者只在违规后的重写中看到被违反的那一条。

### 13.4 断言覆盖

- 作者什么都没写：不调用编译，规则为空。
- 默认卡：
  - 客栈寒暄只调用一次叙述。
  - 拔剑开窗后是"叙述、检查"，没有导演调用。
  - 换说法之后，两个分支的正史不同。
  - 揭示后的下一轮窗口关闭；未揭示的分支会重新开窗。
- 有护栏的卡：
  - 自然语言加一个模块编译成三条规则，只调用一次。
  - 没开窗的客栈回合也会检查。
  - 写死 B 的稿子被抓到，重写的提示词只附上那一条规则；重写机会用尽时，违规记在回合里。
- 开启导演的卡：导演的提示词里有作者规则；漏掉 `must` 时重写。
- 全局检查：
  - 所有叙述提示词在"Previous draft broke"之前都不含任何规则原文；
  - `heir` 的秘密没进过任何提示词；
  - 窗口关闭时，`heir` 无法解码进简报。

五处变异都会让断言失败：

- 把规则写进叙述提示词；
- 不论卡是否开启，都调用导演；
- 没有开窗线索时跳过护栏检查；
- 空输入也调用编译；
- 重写时不附上错误。

### 13.5 未覆盖

- **规则的作用范围。** 比如"只在与 B 对决时生效"。目前写了规则就每轮检查。
- **编辑器里的确认环节。** 目前假设编译结果直接被接受。
- **规则 id 的稳定性。** 自然语言规则按位置编号（`r0`、`r1`），而回合里的 `violated` 记录的就是这些 id。作者改写规则重新编译后，旧记录可能指向别的规则。需要稳定的 id，比如按内容哈希，或在作者确认时保留原 id。模块 id 没有这个问题。
- **检查的真实准确率。** 尤其是"背叛"这类需要理解整段剧情的规则，单看本轮正文可能不够。

## 14. 世界书：分层、受状态控制的知识

代码见 `prototype/src/lore.ts`，`prototype/lore.ts` 是它的测试（第 20 节起；`index` 与 `readable` 的拆分见 20.1）。它取代 `turn.ts` 里临时定义的 `lore` 和 `brief.ts` 里的 `threads`。这两处本质上是同一种东西，区别只在于由叙事者主动查阅，还是由剧情推送；分开定义的话，作者写一个秘密就要写两遍。

### 14.1 模型

设定资料与秘密，是同一条目的不同层。以"李"为例：第 1 层"A 十年前失踪的挚友，左肩鹤纹"，可以查阅；第 2 层"B 就是李"，由开窗推送。

- **第 0 层**：隐藏。不进目录，不可查阅，不会开窗。
- **第 1..n 层**：逐层加深，第一层的首句就是目录里的钩子。
- **当前层** = max(代码保底 `unlock(s)`, 这条路径上已经送入上下文或已揭示的最深层)。

由此得到三条规则：

- **存在与否由代码决定，深浅由窗口决定。** 开窗只会把已经可见的条目往深推一层，不会让隐藏的条目凭空出现。这条规则是原型断言抓出来的：初版允许窗口把第 0 层的条目推到第 1 层。
- **知识留存，权限可以收回。** 访问权由状态决定，状态变了（比如回忆章节）保底层数可能下降；但已经进过上下文的内容不会被"忘掉"。从送入之前分叉出去的分支，则从未知道。
- **每次只推一层。** 开窗时只把下一层交给简报，更深的层不会提前出现。

### 14.2 接口

世界书模块只提供对（状态, 路径）的纯函数查询，自己不调用 LLM：

| 函数 | 作用 | 谁使用 |
|---|---|---|
| `index` | 当前可查阅的条目和钩子，id 列表就是查阅阶段的枚举闸门 | 查阅阶段 |
| `read` | 到当前层为止、这条路径还没送入过上下文的内容；不可读时返回 undefined | 查阅阶段，读到的内容只追加一次 |
| `offers` | 窗口打开的条目的下一层 | 简报，作为 `may` |
| `delivered` | 这条路径上已经送入过上下文的内容 | 去重，对缓存友好 |

不归它管的部分：

- 放在提示词的哪里：preset；
- 何时调用模型：流程；
- 作者规则：护栏；
- 关键词激活：已放弃。

### 14.3 断言覆盖

- 隐藏条目不进目录、不可读、不开窗。
- 同一条目先查阅第 1 层，再由开窗推进到第 2 层；已送入的层不再重复返回。
- 跳过查阅、直接得到揭示的分支，读取时只补上缺的第 1 层；揭示之前分叉出去的分支看不到第 2 层；没有触发条件就不开窗。
- 第 2 章的代码保底让 `heir` 进入第 1 层；开窗只给第 2 层，不给第 3 层。回到第 1 章（保底降为 0）时，学过的路径仍在第 2 层，没学过的路径为 0。
- 已揭示到最后一层的条目不再开窗。
- 每条路径上，每个条目的当前层都只增不减。

五处变异都会让断言失败：

- 当前层只看代码保底；
- 允许窗口推出第 0 层的条目；
- `read` 不去重；
- 开窗一次给出多层；
- 揭示不计入"已送入"。

### 14.4 未覆盖

- 单层内部的再细分（类似 Skill 的子文件）。
- ~~压缩会清空"已送入"的记录~~ 第 17 节订正：视图是纯函数，压缩不改任何记录；被压缩区间内送入的世界书文本进入摘要，`delivered` 照常去重。
- 编辑器里分层编写的界面。
- 与 `turn.ts`、`brief.ts` 的实际接线，留到服务端 agent 原型时再做。

## 15. 服务端 agent：调研

本节只做调研，不做选择。第 19 节的接线原型给出了一个与 15.2 不同的结论：AIRP 的回合里没有工具，15.4 的前两项因此不再成立。本节保留作对照。

- 前面的讨论覆盖了两件事：提示词怎么装配（代码问题），以及提示词怎么处理（语文问题）。
- 下一步是服务端 agent。默认形态仍是纯文本 chatbot，只在关键环节需要 agent 能力：流程中的某几个阶段、查阅收起来的世界书、执行动作。
- 已确定的约束：只开放少数几个固定的内置工具，不做自由的命令行式工具集。

### 15.1 参考资料

**pi-from-scratch**（`SaladDay/pi-from-scratch`，约 600 行，零依赖）

- 核心是 `src/agent.ts` 的一个 `while` 循环：流式调用 LLM，有工具调用就执行，结果放回上下文，直到模型不再调用工具。
- 值得参考：
  - 边界情况的处理：
    - 输出被 `max_tokens` 截断时不执行工具调用，把错误作为工具结果交回模型；
    - 中断时丢弃未完成的工具调用；
    - 中断跳过的工具调用补上 `error: aborted` 结果，因为 API 要求每个工具调用都有结果；
    - 出错时保留已生成的文字。
  - 对外只有一条事件流。
  - 会话以只追加的 JSONL 落盘，逐行容错。
- 不照搬：
  - 循环由模型掌握，没有步数上限，即第 10 节否定的做法 C；
  - 上下文是一个被原地修改的线性数组，压缩会改写历史；
  - 工具参数不校验，并提供 bash。

**chatbot-template**（`shadcn-ui/chatbot-template`，Next.js、AI SDK v7、shadcn）

- 值得参考：
  - 消息由带类型的 parts 组成，每种 part 对应一个组件，类型从工具定义推导。这就是"固定块 → 前端自然长出来"的现成实现。
  - 工具 part 的状态流转：`input-streaming → input-available → output-available / output-error`。
  - 服务端护栏：校验请求体、限制步数和输出 token、客户端断开即中止。
- 不照搬：
  - 历史由客户端掌握，每次请求都把全部消息发给服务端。这与服务端持有秘密、客户端输入不可信的前提冲突。应改为服务端持有日志树，客户端只发本轮输入。
  - 与 Next.js 路由绑定。
- 待查证：能否在前端沿用 AI SDK 的 UI 消息流协议和 `useChat`，由 Effect 服务端输出这个协议。

**Mastra**（`mastra-ai/mastra` `ecd3761`，core 约 32 万行）

- 太重：运行时依赖同时带着 AI SDK provider 的 v5/v6/v7、两套 A2A SDK、遥测和 hono；agent 循环本身也建在它的工作流引擎上。能借的是概念。
- 值得借的概念：
  1. **可见即可执行，检查两次。** `activeTools` 决定模型能看到哪些工具，执行时再按同一份列表检查（`loop/workflows/agentic-execution/tool-call-step.ts:403-425`）。
  2. **校验失败作为工具结果交回模型**，附逐字段错误（`tools/validation.ts:630-635`）。不学它的宽松修补，比如把 `query` 改名成 `prompt`。
  3. **授权只来自可信边界。** 模型在参数里写入的恢复数据不能给自己授权（`tool-call-step.ts:514-521`）。
  4. **配置分层并存成数据。** 它自己承认函数式策略无法序列化，重启后会丢失。
  5. **保守的默认值**：
     - 默认最多 5 步（`llm/model/model.loop.ts:160-170`）；
     - 输出被截断视为终止；
     - 中断时未完成的工具调用保持未完成；
     - 有工具需要审批时改为逐个执行。
- 不借：
  - 审批与权限策略（允许 / 询问 / 拒绝、类别授权，见 `agent-controller/session.ts:3864-3885`）：为危险工具设计，我们的工具只读或由代码裁决；
  - 通用处理器流水线；
  - 线性 thread 存储：无父指针、无版本，分支只能整段复制；
  - 多用户的 RBAC / 细粒度鉴权。

### 15.2 工具集的初步想法

- 模型能看到的工具完全由卡声明的内容决定，没有默认工具，和第 13 节"写了才生效"同一原则：
  - `lore_read`：卡有世界书，且 `index` 非空时才有；
  - `act`：卡声明了动作 schema 时才有；
  - 纯聊天卡的工具列表为空。
- `ask_user` 不属于 AIRP。RP 里每轮结束，控制权本来就交还玩家，它与对话本身重复。互动小说式的选项按钮是界面层的可选 part，不是工具。只在助手、生产力这类其他模式下，由模式配置开启。
- 掷骰不是工具，是结算阶段里由代码完成的事；叙述阶段不带工具。
- 初步的分层：harness 默认 → 模式 → 卡 → 阶段 → 执行时检查。设想"每层只能收窄，不能放宽"，比 Mastra 的合并、覆盖更容易推断。"可选模型"即按阶段选模型，比如叙事者用强模型，导演和检查用便宜模型。

### 15.3 Effect 4.0.0 的 `Toolkit`（实测）

- **`failureMode`。** `Tool.make` 的 `failureMode` 默认为 `"error"`（`dist/ai/Tool.js:290`）。实测模型传入未解锁的 id 时：
  - `"error"`：整个 `generateText` 失败，报 `ToolParameterValidationError`；
  - `"return"`：作为 `isFailure: true` 的工具结果进入下一步提示词，说明为 `Expected "li" at ["id"]`。

  处理函数报错、返回值不合 schema 时，同样遵循这个选项（`dist/ai/Toolkit.js:126-191`）。
- **模型调用了工具集里没有的工具：** 整个响应在解码阶段报 `InvalidOutputError`，不会作为工具结果交回模型。这一点与 Mastra 不同，需要在循环里捕获。
- **单步执行。** `generateText` 只执行一步：执行本次响应里的工具调用，然后返回。多步循环需要自己写，参见 `ai-docs/src/71_ai/30_chat.ts:118-137`。相关选项：
  - `disableToolCallResolution`：只返回工具调用、不执行；
  - `concurrency`：工具执行并发度。
- **`toolChoice` 的 `oneOf` 会把列表外的工具从请求中过滤掉**（`LanguageModel.js:493`），所以按阶段收窄会改变发出的工具定义。
- **自带审批机制**：`needsApproval`、`tool-approval-request`。
- **`Chat` 模块**把历史存为线性列表，与日志树不符；可以直接用 `Prompt` 从路径拼装。

### 15.4 待选择

- **世界书闸门放在参数 schema 还是处理函数里。**
  - 参数写成 `Literals(可查阅 id)`：约束解码，闸门最强，但每次解锁都会改变工具定义；
  - 参数写成 `String`，在处理函数里调用 `lore.read`：同样由代码执行，工具定义整局稳定，新解锁的条目以追加方式告知。
- **工具定义的变化对缓存的影响如何处理。** 例如只在会话开始或首次解锁时更新工具列表。
- **前端协议。** 是否沿用 AI SDK 的 UI 消息流协议。
- **每层只收窄的配置模型的具体形状。**

## 16. 可变提示词与作者体验

### 16.1 ST-Prompt-Template 做了什么

`zonde306/ST-Prompt-Template` 让提示词里的每一段文字都成为 EJS 模板，发送前用变量渲染一遍，再交给模型。

- **上下文**：变量按"全局 → 初始 → 聊天 → 楼层（含 swipe）"合并（`src/function/variables.ts:52-59`），另有读函数 `getwi`、`getchar`、`getpreset` 和写函数 `setvar`。swipe 与 continue 读上一层的变量（`src/modules/handler.ts:36, 43`）。
- **手段**：
  - 条件文字：`<% if (...) { %>…<% } %>`；
  - 条目闸门：`@@if 表达式`，在 ST 激活世界书之前剔除条目（`handler.ts:105`）；
  - 组合：`getwi("条目名")` 由代码拉取另一条目并递归渲染（`src/function/ejs.ts:344`），绕过世界书的全部激活逻辑；
  - 具名插槽：世界书 `injectPrompt("CoT", …)` 写内容，预设 `getPromptsInjected("CoT")` 决定位置；
  - 定位：`[GENERATE:BEFORE/AFTER]`、`[GENERATE:idx:…]`、`@INJECT pos/target/regex`，都作用在渲染后的消息上。
- **输出侧**：模型回复里的 `<% setvar(...) %>` 也会被执行（README 示例 3）。

### 16.2 语义上的对应

"提示词 = 状态的函数"与第 8 节"代码 fragment 与数据 fragment 地位相同"是同一个方向。

| ST-PT | 本文 | 结论 |
|---|---|---|
| `@@if`、条件文字 | Fragment 的激活条件；lore.ts 的 `unlock(s)` | 一致 |
| 按楼层 / swipe 存变量，swipe 时读上一层 | 日志树每个节点一份状态，装配读父节点 | 一致，且不需要偏移量 |
| `getwi` | `lore.read`，由代码调用 | 一致；但组合必须经过 `lore` 的查询，否则会绕过第 0 层隐藏 |
| 具名插槽 | 第 8 节的纯锚点 | 已有：预设放一个无文本的 fragment，卡把 fragment 挂上去 |

具名插槽有一处行为不同：ST-PT 里预设没有读取的插槽，内容静默丢弃；第 8 节里挂在不存在的锚点上会报错。卡和预设常被混用，这意味着"卡加载失败"与"内容悄悄消失"之间要做选择，目前保留报错。
| 按渲染后的序号或正则定位 | `before / after / depth` | 不要；在字符串上数位置很脆弱 |

不照搬的：

1. **渲染有副作用。** 模板里能 `setvar`，同一份模板在 dry run、生成、楼层渲染时都会执行，代码因此到处是 `isDryRun`、`isInPlace` 的特判（`handler.ts:20-36`）。本文的渲染是纯函数，写状态只发生在结算阶段。
2. **模型输出被当作代码执行。** 等于让模型记账，并且能执行任意 JS。
3. **在渲染结果上拼接。** `collectPrompts` 依赖执行顺序，token 预算也因此算不准（其文档"词符计数"一节自述）。

### 16.3 作者体验是卡格式的问题

文字里嵌逻辑，对作者而言与手写 MVU 变量、手写 JSON/YAML 配置没有区别；ST-PT 的语法是普通作者几乎无法手写的。"一直这么做"不说明它好。

这既不是运行时的问题，也不是前端的问题，而是两者之间的契约，即卡格式。第 13.3 节对作者规则已经这样处理：作者写自然语言或勾选模块，编写时编译一次，按 schema 校验，回显确认，harness 只读数据。这里把它推广到整张卡。

第 6.1 节"正确性由媒介保证"同样适用于作者：

- **自然语言**：输入方式之一，经一次编译变成数据；
- **schema 数据**：唯一被存储、被运行时读取的形式；
- **GUI**：数据的视图和编辑器。

没有人手写 JSON；schema 不再是给填写者看的说明，而是编辑器的形状。

### 16.4 封闭词汇：文字与逻辑分离

schema 的每种节点都要同时满足：对应一种控件；能作为约束解码的目标；运行时可以直接求值，不需要解释层。由此推出：

- **文字里没有控制流。** 同一内容的几个变体，是几条各自带条件的 fragment。
- **条件是一棵很小的树**：相等、数值比较，用 `all / any / not` 组合，作用在状态的路径上。它在编辑器里是一个筛选器，而不是一门语言。

形式从已有原型里来，不新发明：

| 形式 | 出处 | 编辑器形态 |
|---|---|---|
| Fragment：文字 + 位置 + 激活条件 | 第 8 节，本节加 `when` | 文本框 + 位置选择 + 筛选器 |
| 世界书条目：各层 + `unlock` + `offer` | 第 14 节 | 分层文本 + 筛选器 |
| 作者规则 | 第 13 节 | 自然语言输入 + 回显列表 |
| 动作 schema | 第 9、10 节的 decide | 字段表单 |
| 具名插槽 | 第 8 节的纯锚点 | 预设里放置，卡里选择 |

真正的逻辑只有条件这一种。

未定：`offer` 目前是对玩家输入跑正则（`lore.ts` 的 `/sword/.test(input)`）。放进编辑器后，它要么是关键词列表，要么是"当玩家提到……时"由 LLM 判断。这是唯一媒介选择不明显的形式。

**与第 6.2 节"卡必须是代码"不矛盾。** 卡是可执行的数据：运行的是这套封闭结构。开发者的代码模块只是词汇之外的兜底，不是作者的路径。

**附带的收益。** 条件树声明了每个 fragment 依赖哪些状态路径。harness 不必逐轮比较渲染结果，就知道哪些 fragment 会变、应当放在后面；"缓存是基础设施"所需的信息由此直接得到。全功能 JS 模板给不出这个信息。

### 16.5 原型：`prompt.ts` 加上 `when`

代码见 `prototype/prompt.ts`。

- `Fragment` 新增可选的 `when: Cond`。`Cond` 是递归 schema，五种节点：`{ path, is }`（相等）、`{ path, op, value }`（`lt / lte / gt / gte`，值只能是数字）、`all`、`any`、`not`。
- `assemble` 新增 `state` 参数，激活条件多一项 `holds(when, state)`。
- `reads(cond)` 返回条件依赖的状态路径。
- 预设里加了一个纯锚点 `cot`，作为具名插槽。

断言覆盖：

- 信任低于 50 时只出现"保持距离"；不低于 50 时只出现"信任你"；信任不低于 80 且立过誓时再多一条。三条变体的文字里都没有逻辑。
- 卡挂在 `cot` 上的 fragment 出现在预设放置插槽的位置。
- `reads` 列出 `mira.trust`、`mira.oath`；原有的 fragment 都没有 `when`，即不依赖状态。
- 路径不存在、对非数字做比较都报错；`value` 为字符串的比较在解码时被拒绝。

未覆盖：

- 卡加载时按状态 schema 检查路径与类型（目前在求值时才报错），这应当是编辑器和加载器的工作；
- 由自然语言编译出 `Cond` 的那次调用；
- ~~世界书条目的 `unlock` 仍是函数，尚未改用 `Cond`~~ 第 22 节：Cond 形式已在 `loop.ts` 的适配器里，条目数据形状待收口；
- 按 `reads` 调整 fragment 的位置以利于缓存。

## 17. 回合记录与分阶段视图

代码见 `prototype/src/journal.ts` 与 `prototype/src/history.ts`，`prototype/views.ts` 是它们的测试（第 20 节起）。这是服务端 agent 原型的第一个决定：第 7、9、10、12 至 14 节的原型各自有一份 journal 与 State 形状，接线之前先要有统一的回合记录，以及"每个阶段把历史看成什么"。

### 17.1 回合记录

一个节点 = 玩家输入加系统为它产出的全部块。字段是各原型 `Turn` 接口的并集，没有新发明：

```
Turn { id, parent
  input: { text, aside? }         // aside：只对本轮生效的指令（OOC）
  read: Disclosure[]              // lookup 送入的世界书层
  beats: { decide, seed }[]; end  // 决定 → 结算循环
  brief: { must, may, tone? }     // 导演或机会；tone 是本轮基调
  prose                           // 非权威
  fired: Disclosure[]             // check 确认的揭示，计入已送入
  violated; notes }
```

只存 LLM 输出与种子；事件、状态、`delivered` 集合都是派生。卡没声明的功能，对应块为空。

这取代了 `prompt.ts` 里 `Node extends Msg` 的交替楼层树，那是 ST 的 chat 结构。接线时 `assemble` 的 `path` 参数从 `Msg[]` 改为 `Turn[]` 加阶段，由渲染器产出消息。随之退役的还有 Fragment 的 `keys`（§14.2 已放弃）、`trigger`（swipe 已由 reword / reroll / rethink 定义；`continue` 尚未定义）和任意层的 `depth`。`depth` 背后的真实需求保留为尾区的一个槽位：常驻文风指令会在长对话里被稀释，这是模型本性，不是 ST 的迷信。`prompt.ts` 未改，§8.3 关于 depth 与 swipe 触发的断言仍在 `check` 里运行；清理留到接线时。

### 17.2 视图

一条规则：**只有叙事者看转录稿；结构化阶段只看事实，且大多只看本轮。**

| 阶段 | 过去回合看到 | 本轮看到 |
|---|---|---|
| lookup | 无 | 目录钩子、状态、input |
| 导演 / decide | input、事件、fired、notes；不看 prose | 框架层（不看角色层）；input、状态、本轮已结算的拍。导演另外看到作者规则、已开窗线索、aside（第 19.1 节拆分了这一行） |
| narrate | input.text、prose、当轮送入的世界书文本；不看 brief、notes、aside、种子 | 框架层、角色层在头区；当轮查阅到的世界书文本、状态渲染的 fragment、事件、brief（含 tone）、aside 在尾区 |
| check | 无 | prose、brief、规则 |
| record | 已有 notes（去重） | input、prose |

来源：导演不看 prose 是 §10.2 跨回合的推广，§11.4 要求它看过玩家输入；叙事者不看过去的 brief 是 §13.2 "纠正不沉淀"的推论，否则日志里会长出一份指令史；视图不存储是 §8 "装配是纯函数"的推论，所以换 preset 后整段历史重新渲染。世界书文本必须留在叙事者的历史里，否则 `lore.read` 的去重（§14.2）会在压缩后拒绝重发已被丢掉的内容。

接受的张力：prose 非权威，却是叙事者对过去唯一的记忆。读者看到的就是 prose，连续性优先；RPG 卡若需要，可声明在过去回合后附一行事件（未实现）。

### 17.3 压缩是派生视图

把早期楼层替换为摘要是 ST 生态的通行做法。这里的差别只在机制：

- 摘要存在以 `(起始 turn, 结束 turn)` 为键的旁表里，不写进任何节点；id 全局唯一，所以这个键就是一个路径前缀。
- 摘要 = 区间内 notes 与已送入世界书文本的代码折叠，不对长篇 prose 再跑一次 LLM。
- 叙事者渲染路径时，用能覆盖前缀的最长摘要替换那段回合，其余照常。
- 从区间之后分叉出去的兄弟分支复用同一个摘要对象。
- 导演视图本身紧凑，暂不压缩。何时压、压多少是策略，未定。

### 17.4 record 默认开

`notes` 的读者是导演、record 自己和压缩折叠；叙事者只在摘要里读到它。因为 notes 是压缩的唯一来源，record 每轮都跑，纯聊天卡每轮两次调用（narrate、record）。这是对"额外机制声明才有"的一处有意放宽：换来的是压缩不需要 LLM，而且逐轮抽取的事实比事后对长文摘要更新鲜、更利于缓存。

### 17.5 框架层

卡在角色之上多一层。给 §16.4 的表补一行：

| 层 | 内容 | 区位 | 复用 |
|---|---|---|---|
| 框架 | 文风、情感基调、历史与政治文化原型、科技形态、体裁惯例 | 头区，无 `when`，全量缓存 | 可跨角色、跨卡 |
| 角色 | 外貌、性格、语气 | 头区 | 单卡 |
| 剧情 | 线索、世界书层、规则、动作 | 状态门控 | 单卡 |

这也解决了 §16.2 的"卡和预设常被混用"：ST 的 preset 是框架内容、provider 管道、破限三样叠在一起。框架是内容，进卡格式；管道是配置。

"导演"由此是一个更高阶的概念：把常驻框架加本轮处境变成本轮指导的那个东西。没有 LLM 导演时它是代码，简报为空或放一段编写时编译好的框架摘要；有导演时简报多出 `tone`。静态与动态的分界：科技形态、历史原型永远是头区 fragment，随场景变化的基调才由导演调制。过去回合的 brief 不渲染给叙事者，所以 tone 不会沉淀。

### 17.6 断言覆盖

- 纯聊天卡每轮恰好 `narrate, record`。
- 叙事者视图含过去的 input、prose 与送入的世界书文本；不含过去任何 tone、notes、aside；含本轮 tone 与 aside，aside 只出现在它所属的那一轮。
- 导演视图不含任何 prose；含事件、fired、notes、规则与本轮 aside。
- check 只见本轮 prose 与简报；record 见已有 notes 与本轮 prose，不见过去 prose。
- 连续两轮叙事者视图的头部消息逐条相同。
- 压缩：节点序列化前后相同；摘要含区间内 notes 与两层世界书文本，不含区间内 prose；区间外 prose 照常；`delivered` 仍含被压缩的两层；再次压缩命中缓存；区间之后分叉的分支复用同一摘要对象，旁表只有一项；从区间内部分叉的分支拿不到它。

五处变异都会让断言失败：叙事者渲染过去的 notes；导演渲染 prose；压缩改写节点；跳过 record；折叠丢掉世界书文本。

### 17.7 未覆盖

- lookup 视图、无导演卡的框架摘要、`continue` 的定义。
- 压缩策略，以及摘要是否需要一次 LLM 润色。
- RPG 卡在过去回合后附事件行的可选项。
- 与 `prompt.ts` `assemble` 的实际接线。

## 18. 玩家层、接线、continue 与压缩策略

代码见 `prototype/src/fragment.ts`（`frame`、`head`），`prototype/assemble.ts` 是它的测试（第 20 节起）。它把 §8 的 `assemble` 重做在"层 + `Turn[]` + 阶段"之上，取代 `prompt.ts` 的 Msg 树历史。`prompt.ts` 未改，保留作对照。

### 18.1 玩家层

ST 的用户侧只有一块 persona，针对一对一 RP。这里玩家有自己的框架层，排在卡的框架之前，分两级：

- **通用**：文风、篇幅、语言、人称、内容偏好、persona 等，对所有卡生效；
- **按卡**：对某张卡的专门设定。

与卡的框架合并的规则：**框架 fragment 的 id 就是槽位。** 位置与覆盖是两回事：位置固定为玩家区 → 卡框架 → 角色；槽位关系与渲染位置无关。

槽位冲突没有固定的全局顺序。玩家的每条框架 fragment 对卡的同名槽位有三种关系，由玩家按条设置（`mode`）：

| 关系 | 含义 |
|---|---|
| `override` 覆盖 | 我的替换卡的，仍渲染在玩家区 |
| `yield` 让位 | 卡的胜出，我的只填卡没写的槽位 |
| `both` 并存 | 两条都出现 |

没设置时走默认值，默认值也是玩家（或 harness）的设置：通用条目默认让位，按卡条目默认覆盖。理由是作者和玩家都预想不到实际怎么玩，所以这不该是规则，而是可调的设置。玩家自己的两级之间没有选项：按卡替换通用的同名槽位，两条都是玩家写的。

一个作者或玩家写下的东西和实际用起来是两回事，所以最终的玩法归玩家调，不归 harness 定。

断言覆盖三种关系各一条、默认填充、翻转通用默认为覆盖、翻转按卡默认为让位。三处变异都会让断言失败：忽略 `mode` 全部并存；忽略默认设置；按卡不替换通用。

按槽位覆盖只在双方用同一套槽位名时有意义。这把框架槽位变成一个封闭集合（语言、篇幅、人称、时态、基调、内容边界、世界原型、科技形态……），即 §16.4 的封闭词汇应用到框架上。原型用自由 id，编辑器负责收口。ST 的 persona 是玩家层里的一个槽位，可按卡覆盖。

**preset 的退场。** 文字内容归入框架层（作者的或玩家的）之后，"preset"作为一个提示词对象在这个模型里不存在了，剩下的只是 provider 配置。

### 18.2 接线

- 观众由层决定，不需要 per-fragment 的观众字段：叙事者看玩家层、卡框架、角色；导演看玩家层、卡框架。
- Fragment 删去 `keys`、`trigger`、`depth`，`assemble` 删去 `scan` 选项；保留 `when`、`before`/`after`、锚点、`enabled`/`options`、`order`。
- 历史参数从 `Msg[]` 变为 `Turn[]`，按阶段渲染（§17.2）。
- **缓存排序。** 对整个头区做两趟：所有不带 `when` 的 fragment 按区顺序，然后所有带 `when` 的按区顺序。锚点上挂着带 `when` 的条目时，锚点整体算作易变。这样玩家仍在卡之前，而逐字节稳定的前缀最大。若按区内各自排序，玩家通用层里一个带 `when` 的条目就会把整个卡框架推出稳定前缀。这是 §16.4 "条件树声明依赖、缓存由此获得信息"的兑现。

断言覆盖：槽位关系见 §18.1；导演视图不含角色层与 prose，含账本；只有状态变化时头区前缀逐字节相同，易变条目落在前缀之后、玩家先于卡；缺失锚点报错、禁用锚点隐藏挂件。三处变异都会让断言失败：取消两趟排序；导演也看角色层；槽位匹配不看 id（玩家与卡的槽位永不相遇）。

### 18.3 continue

两种 continue，两种机制：

- **截断恢复**：`max_tokens` 截断发生在 narrate 阶段内部、节点尚未存在时。harness 以已有文字为 assistant 前缀重试，结果只作为这一轮的 prose 记录一次。属于回合循环，留到服务端 agent 原型。§15.1 记录了 pi 与 Mastra 对截断的处理。
- **玩家 continue**：不重要。是一个输入为空的新子回合，尾区放一条占位指令（ST 的做法），由玩家触发，走正常流程。

待查：effect/ai 核心没有 prefill 概念，provider 适配器是否统一接受尾部 assistant 消息作前缀，本地未装适配器，未实测。不统一的来源退回尾区指令。

### 18.4 压缩策略

从 §17.3 直接推出两条：

- 折叠是代码，免费。`compress` 不再是独立步骤：渲染按 token 预算自己选区间，旁表退化为纯缓存。
- 边界不能每轮移动，否则摘要文本每轮变、前缀每轮失效。唯一的旋钮是：边界按 M 轮一块移动，两次移动之间摘要逐字节稳定。

LLM 润色不做。

### 18.5 未覆盖

- 尾区的事件、brief、aside 仍在 `views.ts`，回合循环接线时并入。
- 槽位的封闭词汇与编辑器。
- 玩家层是否还需要第三级（例如按角色、按会话）。
- 作者一侧没有旋钮：只有玩家 fragment 带 `mode`，只有玩家有默认设置。作者能否把某个槽位标为"提示"（例如 setting），由编辑器展示给玩家，未定。

## 19. 一回合的接线

代码见 `prototype/loop.ts`。把 §9/§10 的结算循环、§13 的简报与护栏、§14 的分层世界书、§17 的回合记录与视图、§18 的头区接成一个 `run`。

### 19.1 顺序

```
lookup → (decide → settle)* → gate → direct → narrate → check → record
```

- **开窗在结算之后。** §11.1 的例子里，剑划破衣服才露出纹身：窗口取决于本轮产生的事件，所以 `offers` 读的是结算后的状态与事件，而不是父节点的。断言：同一输入在全部 miss 的种子下不开窗。这是此前任何原型都没定的一处顺序。
- **lookup 只在有新东西可读时发生。** 目录 = 可读且本路径尚未送入的条目。送过的层不再出现在目录里，也就没有这次调用。
- **导演只在卡开启且有窗口时调用；检查只在有规则或有窗口时调用。** 纯聊天卡一轮恰好 narrate、record。
- **§17.2 的"导演 / decide"一行在时间上拆成两行。** 开窗在结算之后，所以 decide 看不到窗口；decide 也不看 aside 与规则，它回答的是"发生什么"，aside 说的是"怎么讲"。导演在 decide 看到的之外，再看到窗口、作者规则、aside。
- **`offer` 换了形状。** `lore.ts` 的 `offer(s, input)` 对玩家文本跑正则；这里是 `offer(events)`，读结算后的事件。§16.4 说 `offer` 是唯一媒介不明的形式，现在事件驱动的窗口有了代码一侧的答案：它就是 §16.5 的 `Cond`，作用在状态与事件上。输入驱动的窗口仍在关键词与 LLM 判断之间待定。（第 22 节：事件驱动的 `offer` 已是 Cond 的 `{ event }` 叶子。）
- **`index` 相对 §14.2 收窄**：排除本路径已送到当前层的条目。这由路径去重推出，§14.2 没有写明。

### 19.2 没有工具

§15.2 设想 `lore_read` 与 `act` 两个固定工具。接线之后发现循环里一个工具都没有：

- 查阅是一次结构化选择，schema 是可读 id 的字面量枚举（§9 的"枚举即闸门"），读取由代码完成；
- 动作是 decide 阶段的结构化输出，结算由代码完成。

模型从不掌握循环，每次调用都是带类型的函数。于是没有工具定义需要在参数 schema 与处理函数之间选闸门（§15.4 第 1 项），也没有工具定义的变化需要为缓存处理（§15.4 第 2 项）。"只开放少数固定工具"在 AIRP 模式下读作零个。"服务端 agent"这个标题本身带着 agent 框架的残留：这里是一个流程，不是一个 agent。工具只在助手、生产力一类其他模式里由模式配置开启。

### 19.3 截断恢复

narrate 的回应以 `length` 结束时，在同一阶段内以已有文字作尾部 assistant 消息再问一次，拼接后作为这一轮的 prose 记录一次。断言：两次 narrate 调用，第二次的提示词以 assistant 消息结尾，journal 只多一个节点。假模型接受这个前缀是因为它被写成接受；provider 是否统一支持（§18.3 待查）这条断言不能证明。

### 19.4 断言覆盖

- 纯聊天卡：`narrate, record`。全功能卡首轮：`lookup, decide, narrate, check, record`；打斗轮：`decide ×3, direct, narrate, check, record`，第 k 次 decide 的提示词恰含前 k 拍事件。
- 查阅到的层出现在本轮尾区、下一轮历史里，之后不再被读出；`heir` 从未进目录。
- 开窗依赖结算后的事件；导演提示词不含 prose，叙事者提示词不含账本。
- 上一轮的 aside 与 tone 不进下一轮的叙事者视图；连续两轮头区逐条相同。
- 条目到达最后一层后不再开窗。
- 截断：见 19.3。
- 护栏：写死 B 的稿子被重写一次，纠正语在重写的尾区，不进下一轮历史。
- reword 只调用 `narrate, check, record`，read、beats、brief 原样保留，是同一父节点下的兄弟；重放不调用模型。

四处变异都会让断言失败：开窗读结算前的状态；不恢复截断；纠正语写进 prose；目录不按路径去重（已送入的层再次送入）。

### 19.5 代价与下一步

首版是独立文件，重新声明了 `settle`（beats.ts）、`index`/`read`/`offers`（lore.ts）、历史视图（views.ts）和只含字符串的头区（assemble.ts）的精简版，只证明各部分能接在一起。第 20 节已把它改为导入模块。

未覆盖：压缩进入循环、§18 的槽位关系、reroll / rethink、`continue`、流式输出、持久化（`effect/workflow`）。

## 20. 模块化

代码见 `prototype/src/`。`lore.ts`、`views.ts`、`assemble.ts`、`loop.ts` 改为导入这些模块并保留各自的断言；`harness.ts`、`prompt.ts`、`turn.ts`、`beats.ts`、`brief.ts` 是被取代的记录，不动。

### 20.1 模块

| 模块 | 内容 | 出处 | 消费者 |
|---|---|---|---|
| `cond` | `Cond` schema、`holds`、`reads` | §16.5 | fragment、assemble.ts |
| `fragment` | `Fragment`（含 `mode`）、`Player`、`frame`（槽位关系）、`head`（锚点、`when`、两趟排序） | §8、§18 | assemble.ts、loop.ts |
| `lore` | `Entry<S, C>`、`makeLore`：`index`、`readable`、`read`、`offers`、`text` | §14、§19 | lore.ts、views.ts、loop.ts |
| `journal` | `Turn<B>`、`makeJournal`、`deliveredIn`、`deliveredOn` | §17 | views.ts、assemble.ts、loop.ts |
| `history` | `narratorHistory`、`ledger`、`makeSummaries` | §17.2、§17.3 | views.ts、assemble.ts、loop.ts |

接口上做了三处统一，都是原型之间的分歧：

- **窗口的上下文是类型参数。** `Entry<S, C>` 的 `offer(s, ctx)`：lore.ts 的测试传玩家输入，loop.ts 传结算后的事件。§19.1 说的 `Cond` 版本是第三种 `C`。
- **送入记录只是 `Disclosure[]`。** lore 的查询不再依赖节点，由调用方从路径折叠出来，lore 与 journal 互不引用。
- **`index` 与 `readable` 分开。** 前者是可见条目的钩子，后者是"可见且本路径有新层"的 id 列表，即查阅阶段的枚举；为空就不调用。
- `Turn<B>` 对拍的类型泛化，`narratorHistory` 与 `ledger` 以函数注入世界书文本和事件推导，模块不持有卡的内容。

### 20.2 组合的证明

§19.5 说接线原型"没有证明原件能直接组合"。现在同一份模块代码同时跑过原测试文件与 `loop.ts` 的断言。对每个模块做一处变异，看两个消费者是否都失败：

| 变异 | 失败的文件 |
|---|---|
| `lore.readable` 忽略送入记录 | lore.ts、loop.ts |
| `journal.deliveredIn` 丢掉 `fired` | views.ts、loop.ts |
| `history.narratorHistory` 不渲染送入的世界书 | views.ts、loop.ts |
| `fragment.frame` 丢掉玩家区 | assemble.ts、loop.ts（本节给 loop.ts 加了"头区首条是玩家层"的断言，否则它不检查玩家区） |
| `cond.holds` 把 `gte` 反转 | assemble.ts（唯一消费者） |

### 20.3 tsconfig 的疏漏

`prototype/tsconfig.json` 原来用 `files` 列出前六个文件。第 17 至 19 节的 `views.ts`、`assemble.ts`、`loop.ts` 从未被 `tsc` 检查，此前的"类型检查无错误"对这三个文件是空话；Node 的类型剥离只验证了运行时。改为 `include: ["*.ts", "src/*.ts"]` 后暴露两处错误（`generateObject` 的 schema 约束、一处循环推断），已修。`check` 现在是九个文件的 `tsc` 加断言。

### 20.4 未覆盖

- 模块没有自己的测试文件，仍靠四个消费脚本的断言。
- ~~`loop.ts` 的结算仍在文件内~~ 第 22 节改为数据卡。简报与检查的 schema 是 harness 的，由开窗列表和规则派生，不属于卡。
- ~~压缩尚未进入 `loop.ts`~~ 见第 21 节。

## 21. 压缩进入循环

代码见 `prototype/src/history.ts` 的 `folded` 与 `prototype/loop.ts`。§18.4 的两条结论落地：

- 每次叙述之前，`history` 对路径调用 `compress(path, len − folded(len, keep, block))`，再用带摘要的 `narratorHistory` 渲染。`compress` 不是独立步骤，旁表只是缓存。
- `folded(len, keep, block) = ⌊(len − keep) / block⌋ × block`：边界按块移动。参数目前是回合数（`keep: 2, block: 2`），接上真实 tokenizer 后改为 token 预算；这是一个标了 `ponytail:` 的旋钮。

断言覆盖：

- 路径长 4 时折叠前两回合：叙事者视图含 `Summary:`，不含被折叠的 prose，含其后的 prose；折叠区间内送入的两层世界书文本都在摘要里。
- 再走一轮（长 5）：摘要对象是同一个，旁表仍只有一项；这一轮没有 lookup 调用，因为送入记录在节点上，折叠不影响 `readable`。
- 长 6 时折叠四回合：新摘要覆盖到第四回合，旁表两项，视图不再含第三回合的 prose。

**视图由策略决定，不由缓存决定。** 首版让 `narratorHistory` 自己在旁表里挑"能覆盖前缀的最长摘要"（§17.3 的措辞）。一旦更长的分支渲染过，较短路径再渲染时会拿到更长的摘要：同样的节点、同样的策略，视图却取决于别的分支做过什么，违反 §17.2 "视图是纯函数"，也让旧回合的 reword 看到与原来不同的历史。改为 `compress` 按策略返回本路径的摘要，`narratorHistory` 只接受这一个；旁表只是缓存，缓存不改变结果。§17.3 的"最长摘要"据此订正。断言：t8 存在之后重渲染 t6 的路径，仍只折叠第一块。

两处变异让断言失败：边界每轮移动；视图改回从旁表挑最长摘要。

未覆盖：token 预算；导演账本的压缩；摘要是否需要一次 LLM 润色（§18.4 决定不做）。

## 22. 卡的 RPG 部分是数据

代码见 `prototype/src/card.ts`，`prototype/card.ts` 是它的测试；`prototype/loop.ts` 的卡换成了数据。

### 22.1 词汇

每种节点都通过 §16.4 的准入：对应一种控件、能做结构化输出的目标、运行时直接求值。

| 形式 | 形状 | 出处 |
|---|---|---|
| 字段 | `{ path, type: int / number / boolean, min?, max?, initial }` | §4.2；越界由 `add` 按边界截断，所以没有 `clamp` 效果 |
| 动作 | `{ id, text, when?: Cond, roll?: Chance, hit / miss }` 或无 `roll` 的 `do` | §9 "枚举即闸门"：`when` 不成立的动作不进 decide 的枚举，所以效果里不需要 `if` |
| 概率 | 常数、`{ path }`、`{ judge: 文字 }` | turn.ts 的 `success`、harness.ts 的 `Decision.probability` |
| 效果 | `{ path, set }`、`{ path, add: 数或 { path } }`、`{ event: 模板 }` | 仅此三种；模板里 `{path}` 插入效果之后的状态值 |
| 终局 | `over: Cond`、`cap` | §10.3 的三种结束，`end` 仍归模型 |
| 世界书门 | `unlock: Cond`（成立即第 1 层）、`offer: Cond` | §16.5 的缺口；§19.1。注：`src/lore.ts` 的条目仍以函数接收 `unlock` / `offer`，Cond 形式目前只在 `loop.ts` 的 `gate` 适配器里，条目的数据形状还没有收进 `card.ts` |

Cond 只加了一个叶子 `{ event: "label" }`：本轮是否产生过该事件。`holds` 多一个可选的事件列表参数，`reads` 对它返回空。

两条规则：

- **效果里唯一的分支是骰子。** "受伤就撤"由模型每拍决定（§10.2），不进效果。
- **LLM 进入结算的唯一入口是概率。** decide 的 schema 由当前状态派生：枚举是可用动作加 `end`；只有当某个可用动作的概率是 `judge` 时才多出 `chance` 字段。概率记录在拍上，所以 `reroll`（§9 定义，尚无原型）会自然保留难度、只换种子；card.ts 用固定概率、不同种子折叠验证的是这一机制。拍上缺概率是错误，不是默认 0.5。

### 22.2 两处修订

- §16.4 "真正的逻辑只有条件这一种"是为文本卡写的。效果是第二种封闭形式，但它是对状态的变更数据，控制流仍只有条件和骰子。
- §6.2 的 `llm.adjudicate()` 收窄为概率这一个入口。幅度分档（`rate`）等真实卡提出再加。

### 22.3 验收

- harness.ts 的赢钱 / 受伤 / 休息（judge 概率，边界截断到 100）、beats.ts 的攻击 / 逃跑（`flee` 以 `when` 门控在受伤后可用，`over` 含血量归零与已逃跑）、loop.ts 的攻击 / 交谈，全部写成了数据。
- `loop.ts` 换成数据卡与数据门之后，所有断言不改。结算、`over`、`cap` 都来自卡数据。
- 四处变异：去掉边界截断（card.ts 失败，loop.ts 不受影响，因为它的状态没碰到边界）；judge 概率缺失时默认 0.5（card.ts）；结算忽略 `when` 门（card.ts）；`over` 永不成立（card.ts；loop.ts 的测试里没有走到终局，不受影响）。

### 22.4 天花板

带参数查表的动作（`buy(item)`，§7.5）、超过一个路径引用的公式、动态实体、时间、嵌套字段路径。这些走开发者模块，签名与 `settle` 相同，是 §16.4 说的词汇之外的兜底。

未覆盖：自然语言到这套数据的那次编译；编辑器形态；`unlock` 的多层地板（目前 Cond 成立只到第 1 层）。

## 23. 收尾：担忧、方向与搬迁

原型开发到第 22 节为止。编译（自然语言到卡数据）、编辑器、前端协议、持久化、流式都是后续工作，等原型本身聊完再接，它们是接缝性质的。

### 23.1 担忧

讨论中反复出现一个担忧：设计会不会太 RPG 化，太多东西被代码和流程定死。AI RP 本身是自由的。立场是：玩家的自由与 harness 的不自由是相对的，甚至相辅相成。harness 在记账、去重、门控、重放上不自由，正是为了让文字那一侧完全自由。ST 的问题是反过来的：文字那侧塞满规则与禁令，记账那侧靠祈祷。

对照文档，目前留住自由的地方：

- 纯聊天卡一轮只有叙述和记录（§17.4、§19.1），其余阶段声明了才有。
- 正文非权威（§6.2），叙事者不被审查；护栏事后检查且不进叙事者提示词（§13.2）。
- 即兴事实留在历史和 notes 里就是正史（§11.3）。
- 作者的工具是机会而非命令（§13.2）。

每个结构化阶段必须保持 opt-in，这是以后每次加东西的检查项。

### 23.2 风险的三个具体落点

1. **混合卡没有被服务到。** 生态里最常见的卡是自由聊天加几个数值（好感、心情、金钱，§5 的 MVU 与 state2 全是这类）。目前数值进入结算只有一条路：写之前、按菜单选动作（§9、§22）。这对 HP 与骰子正确，对好感错误：好感不决定剧情，它是对剧情的读数。应承认两种状态：**决定性的**，写之前结算，正文渲染它；**读数性的**，写之后由模型分档评估（`Decision.rate`，§7.1），代码施加有界步进。这是 §6.1 "模型判断发生了什么、代码算变化"的原意，也是 state2 `$step` 做对的方向。§9 "record 不碰数值"要为读数性状态放松；record 阶段是它的自然位置，不增加调用。这一点应排在后续讨论的最前面。
2. **窗口只能由代码条件打开。** 事件驱动的 `offer` 已是 Cond（§22），但输入驱动的窗口，即"玩家聊到了这件事"，媒介未定（§16.4、§19.1）。自由 RP 里这是常态。它应可以是一次便宜的 LLM 分类，而不只是对状态的比较。这是自由对话与作者伏笔之间的接缝，目前空着。
3. **玩家直接改正文。** RP 里最普通的操作，文档从未讨论。模型天然容纳它：正文非权威，改过的正文是同一父节点下的新兄弟节点，check 与 record 对它重跑，记入正史的只是读数与揭示。需要写明并加断言。

### 23.3 搬迁

本仓库是临时实验台。原型将搬出去，建独立仓库或作为 monorepo 后端的一部分。随行的是 `prototype/src/` 五个模块加 `card.ts`、四个消费它们的测试脚本（lore、views、assemble、loop、card）、本文档。`harness.ts`、`prompt.ts`、`turn.ts`、`beats.ts`、`brief.ts` 是被取代的记录，留在这里即可。MVU 本身不再开发。

### 23.4 带走的待办

- §23.2 的三点，第 1 点优先。
- 自然语言到卡数据的编译（§13.3、§16.3、§22.4）。
- 世界书条目的 `unlock` / `offer` 数据形状收进卡（§22.1 注）。
- 截断恢复的 provider 前缀支持（§18.3、§19.3 待查）。
- 前端协议（§15.4 第 3 项）、持久化（`effect/workflow`）、流式。
- token 预算替代回合数的压缩旋钮（§21）。

## 附：调研对象版本

| 对象 | 版本 / 提交 | 日期 |
|---|---|---|
| MagVarUpdate（本仓库） | `54be11b` | 2026-10-08 |
| SillyTavern | `06bde939f` | 2026-09-14 |
| StageDog/tavern_resource `util/mvu_zod.ts` | main | 2026-10-08 读取 |
| N0VI028/JS-Slash-Runner `src/function/variables.ts` | main | 2026-10-08 读取 |
| RockingSisyphus/ERA-EfficientRollbackArchitecture | `74bd1f6` | 2026-10-08 |
| RT15548/LittleWhiteBox | `66cb100`（3.1.6） | 2026-09-27 |
| funnycups/Luker | `c3c7578` | 2026-10-08 |
| Darkatse/TauriTavern | `a1855be` | 2026-09-19 |
| Lianues/PureTavern | `9a1e854` | 2026-07-31 |
| Player-MINEPIG/dsh-tavern | `5b774e5`（2.5.1，目标 DSH 0.2.0-rc.2） | 2026-10-08 |
| weidu12123/Liyuan（二手） | `227c1d5`，经 flizzywine/dsh-tavern 审计文档 | 2026-08-27 |
| effect | 4.0.0 | 2026-10-01 发布 |
| SaladDay/pi-from-scratch | `599d0ba` | 2026-08-18 |
| shadcn-ui/chatbot-template | `55c9330` | 2026-09-28 |
| mastra-ai/mastra（packages/core） | `ecd3761` | 2026-10-08 |
| zonde306/ST-Prompt-Template | `d6f520d` | 2026-09-06 |
