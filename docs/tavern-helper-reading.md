# 读酒馆助手记录：JS-Slash-Runner 4.11.3（生态自己长出来的运行时）

2026-10-17。读了酒馆助手（Tavern Helper，仓库 `N0VI028/JS-Slash-Runner`，commit 333e8a1，2026-10-16）。与 `card-reading.md`、`preset-reading.md` 不同，这次读的不是作者的作品，而是作者在 ST 不够用时自己长出来的运行时。读它的目的只有一个：它暴露给脚本的每一个 API，都是一条"harness 本该提供而 ST 没有"的需求；它用什么方式实现，则是 ST 这个宿主逼出来的形状。两者要分开看。

依据：仓库里的 `@types/function/*.d.ts` 与 `@types/iframe/*.d.ts`（公开 API 的类型与注释，共 161 个函数）、`src/function/generate/`（自建的生成管线，3.6k 行）、`src/panel/toolbox/prompt_viewer/wi_tracer/`（提示词溯源，75KB）、`src/panel/optimize/*/zh.md`（对 ST 默认行为的修正补丁说明）、`src/iframe/`（消息楼层 iframe 的引导脚本）、`src/store/settings/`（脚本与变量的存放位置）。没有读在线文档；没有读任何一份具体的脚本作品。

## 1. 它是什么

ST 没有给作者任何代码面。酒馆助手补上两种执行环境，再在上面铺一层对 ST 全部对象的读写 API：

| 执行环境 | 载体 | 生命周期 | 作用域 |
|---|---|---|---|
| 脚本库 | 一段 JS，存在全局设置、preset 的 `extensions.tavern_helper`、或角色卡的 `data.extensions.TavernHelper_*` | 随 ST 加载、切 preset、切卡而装卸 | 全局 / preset / 角色卡三级，可带按钮、可带自己的变量 |
| 楼层前端 | 聊天楼层正文里含 `<html>` / `<body>` 的代码块，每块一个 iframe | 随楼层渲染与销毁 | 该楼层 |

两种环境都拿到同一组全局函数（`predefine.js` 把父窗口的 `TavernHelper` 合并进 iframe 的 `window`），外加 lodash、zod、YAML、jQuery、Vue。iframe 是同源 srcdoc，不是沙箱：`cleanup_protector.js` 用 Proxy 包住父窗口的 `document.createElement` 与 jQuery，给脚本写进主页面的每个 DOM 节点打上 iframe 标记，卸载时按标记清理。隔离的目的是"能收拾"，不是"不能碰"。

## 2. API 清单，按它暴露的需求分类

### 2.1 对 ST 全部对象的增删改查

角色卡、persona、preset、世界书、正则、聊天楼层、脚本树、扩展安装，每一类都有 get / create / replace / update-with / delete 一整套。两点值得记：

- **它重新定型了 ST 的数据。** `WorldbookEntry` 把 ST 扁平的几十个字段收成 `strategy`（constant / selective / vectorized、主副键、扫描深度）、`position`（类型、角色、深度、顺序）、`recursion`、`effect`（sticky / cooldown / delay）四组；`Preset` 收成 `settings`（provider 参数）、`prompts`（有序列表）、`prompts_unused`、`extensions`（正则、脚本、变量）。旧的 `lorebook*` API 保留但标记废弃，新的 `worldbook*` 是重定型后的版本。生态自己也认为 ST 的数据模型不可读，这与 README 第二节"preset 拆成 fragment 加 provider 配置"是同一个判断的两种深度。
- **楼层是可任意改写的数组。** `setChatMessages` 可改任何楼层的正文、角色、隐藏标记、swipe 列表、当前 swipe、楼层变量；`createChatMessages` 可在任意位置插入；`rotateChatMessages` 可旋转区间。历史在这里是作者脚本的工作台，不是记录。

### 2.2 生成作为函数，不是按钮

`generate` 与 `generateRaw` 是整个 API 里最重的一块（`generate.d.ts` 547 行，实现 3.6k 行）。一次调用可以指定：

| 参数 | 含义 |
|---|---|
| `user_input`、`image` | 本次输入 |
| `overrides` | 覆盖世界书前后、persona、描述、性格、场景、示范、作者注释、整段历史 |
| `injects` | 按深度插入的消息；`position: 'none'` 表示不发给模型、只用于激活世界书 |
| `max_chat_history` | 历史截取 |
| `ordered_prompts`（仅 raw） | 占位符名与行内消息混排的列表，即一次性的自定义 preset |
| `custom_api` | 本次换 provider、模型、采样参数、请求头与请求体 |
| `tools` + `tool_choice` 或 `json_schema`（互斥） | 工具调用或结构化输出 |
| `should_stream`、`should_silence`、`generation_id` | 流式；不占用页面停止按钮；按 id 中止 |
| 返回 | 正文、reasoning、`reasoning_signature`、`tool_calls`（每个带 `thought_signature`） |

注释里反复出现的用法是"额外模型解析"：摘要、变量更新、分类、生成选项。Mvu 还暴露了 `isDuringExtraAnalysis()`，说明一回合里跑多次便宜请求已是生态的常态，只是全部手搭。

实现侧另有两层值得记：`toolCallCompat.ts`（502 行）把九种 source 的工具调用响应归一到三个家族；`createGenerationParametersCompat.ts` 按 ST 版本号动态 import 不同内部函数。这是建在没有稳定 API 的宿主上的代价，不是需求。

### 2.3 变量：七个作用域

`getVariables` 的 `type` 可取 global、preset、character、chat、message（按楼层号或负深度，且 ST 的楼层对象按 swipe 分别存变量）、script、extension。`getAllVariables` 的合并顺序是全局 → 角色卡 → 脚本 → 聊天 → 0 楼 → 中间楼层 → 最新楼层，后写覆盖先写。`registerVariableSchema` 接 zod，但注释明说"只影响变量管理器 UI 的校验，对代码没有任何影响"。

Mvu（变量框架）在此之上：从正文里解析 `_.set()` 命令，但真正有意思的是它的事件钩子。`COMMAND_PARSED` 的示例是修复 Gemini 在中文间插的连字符、修复繁体；`VARIABLE_UPDATE_ENDED` 的示例是把好感度夹在 0 以上、把单轮增幅夹在 ±3 以内。生态在"模型写、代码夹边界"这一步与本项目 `card.ts` 的效果加上限完全一致，只是它的输入是正文里的命令文本。

### 2.4 事件总线：82 个 ST 事件加 7 个自有事件加任意字符串

多数是 UI 与存档事件。构成"运行时掌控"的是这几个管线节点，监听者拿到的都是**可变的共享对象**：

| 事件 | 时刻 | 可改什么 |
|---|---|---|
| `GENERATION_AFTER_COMMANDS` | 装配之前 | 注入（`injectPrompts` 的推荐时机） |
| `GENERATE_AFTER_DATA` | 消息数组装配完 | 直接改 `prompt[]`。酒馆助手自己的"助手宏"就靠在这里对每条消息做正则替换 |
| `CHAT_COMPLETION_SETTINGS_READY` | 请求体就绪 | 改模型、采样、`messages`、`json_schema` 等所有字段 |
| `WORLD_INFO_ACTIVATED`、`WORLDINFO_SCAN_DONE` | 世界书扫描完 | 读到激活集、预算、递归层级、timed effects |
| `STREAM_TOKEN_RECEIVED`、`STREAM_REASONING_DONE` | 流式中 | 读 |
| `MESSAGE_RECEIVED(id, type)` | 落楼 | type 区分 normal / swipe / continue / regenerate / impersonate 等 |
| `TOOL_CALLS_PERFORMED` | 工具执行后 | 读 |

因为所有干预都是对同一对象的副作用，它需要 `eventMakeFirst` / `eventMakeLast` 来排监听者的先后。多个脚本改同一份提示词没有组合规则，只有顺序。

### 2.5 提示词查看器与溯源

查看器的工作方式：打开时发一次假的生成请求（dry run），拦下装配结果不发给模型。"内容溯源"再把每条消息的文本按字符区间对回世界书条目、preset 条目、卡字段、persona：先快照各来源展开后的文本，再在合并后的消息里按 `join('\n')` 的偏移累加定位。帮助文档自己写明：实验性，无法溯源第三方插件与脚本的内容，很多情况下结果不正确。75KB 的代码换来一个事后近似。

### 2.6 对 ST 默认行为的修正补丁

`src/panel/optimize/` 下六个开关，每一个都是作者群认为 ST 做错了的地方：

| 补丁 | 修正的是 |
|---|---|
| 最大化预设上下文长度 | ST 的 token 估算偏高且不计插件变换，按估算截断会丢本可完整发送的提示词；锁到 200 万等于关掉截断 |
| 强制推荐的世界书全局设置 | 扫描深度 2、预算 0、递归开、角色世界书优先等一整组；"作者默认都用这组，没有你改的必要" |
| 禁用不兼容选项 | 自动修复 Markdown、修剪不完整句子、禁止外部媒体、显示标签、禁止机器人消息里的 `{{char}}` `{{user}}` |
| 导出卡时携带最新世界书 | 导出可能带陈旧世界书 |
| 替换卡时同步世界书 | 更新卡不更新绑定的世界书 |
| "加载 N 条"改为"渲染 N 条" | 页面只渲染最近 N 楼 |

### 2.7 楼层前端与显示层

正文里的 HTML 代码块成为 iframe；注入固定的库栈（jQuery、jQuery UI、Vue、vue-router、Tailwind、FontAwesome，CDN 加载）；`vh` 被重写为视口变量；用户与角色头像作为 CSS 类暴露。`formatAsDisplayedMessage`、`formatAsTavernRegexedString`（指定来源、目标、深度后对任意文本跑 ST 正则）、`retrieveDisplayedMessage`、`refreshOneMessage` 让脚本把 ST 的显示管线当函数用。`registerMacroLike` 注册正则宏，同时作用于提示词与渲染。流式进 iframe 标记为 TODO。

生态里典型的用法是：模型输出带标签的数据，正则把它替换进一个 HTML 模板，酒馆助手渲染成 iframe。模型写数据、正则当模板、iframe 当视图。

## 3. 审视：去掉它，分阶段回合模型里什么会坏

按 README 第三节的方法逐项过。

| 酒馆助手的能力 | 去掉后坏的是 | 本项目的家 | 状态 |
|---|---|---|---|
| `generate` 的每次调用可换 provider、换形状、带工具或 schema、可中止 | 一回合多次便宜请求，各有各的请求形状 | `loop.ts` 每个阶段自己的请求；provider 适配器 | 已有，但 `generation_id` 式的按阶段中止与静默未做，流式未做 |
| `injects` 的 `position: 'none'`（只用于激活，不发送） | 查找阶段的输入不等于提示词文本 | 查找是独立阶段，输入自定 | 已有 |
| `overrides.chat_history`、`max_chat_history` | 历史按请求替换成另一种视图 | `history.ts` | 已有 |
| `ordered_prompts` 占位符加行内消息 | 请求形状归调用方 | harness 按阶段的请求形状 | 已有 |
| `reasoning_signature` / `thought_signature` 回传 | 多次调用之间 provider 要求携带签名 | provider 适配器 | 任何现代 provider 编排层（如 Vercel AI SDK）默认处理，不是本项目要做的事；酒馆助手要手写只因 ST 的这一层原始 |
| 七级变量作用域 | 运行状态、卡常量、玩家偏好三类 | 节点（含 swipe 为兄弟）、卡数据、玩家层 | 已有三类；preset / script / extension 作用域是实现产物，不需要 |
| Mvu 的夹边界钩子 | 模型写的数值要夹进上限 | `card.ts` 效果加上限，record 由代码施加 | 已有 |
| `registerVariableSchema` | 状态要有类型 | 卡数据的字段声明 | 已有，且是强制的，不只是校验 |
| 管线事件上改 `prompt[]`、改请求体 | 作者要在装配后再动一次 | 无。装配是纯函数，干预是阶段，不是钩子 | 按设计不做 |
| `eventMakeFirst` / `eventMakeLast` | 多个脚本改同一对象要排序 | 无。没有共享可变对象就没有排序问题 | 按设计不做 |
| `MESSAGE_RECEIVED` 后解析、更新、注入下一轮 | 写之后的结算与下一轮的揭示 | record / check 阶段；`when` fragment 与 lore 窗口 | 已有 |
| 脚本按钮插入输入 | 玩家的结构化动作 | 卡的动作 | 已有 |
| 提示词查看器的 dry run 加溯源 | 看到发出去的是什么、来自谁 | 装配纯函数，每个 fragment 有身份，trace 是派生视图 | 设计上免费，尚未做成视图 |
| 补丁：上下文长度锁最大 | 不按估算截断 | 预算由 harness 计算或交给 provider 报错，不给玩家一个猜测值去调 | 现代 harness 的常识，README 方向 6 已覆盖 |
| 补丁：世界书全局设置、不兼容选项 | 一组"唯一正确"的全局开关 | 不存在这些开关 | 已满足 |
| 补丁：卡与世界书分离导致陈旧 | 卡与它的知识是一个对象 | `lore` 数据形状收进卡（方向 4） | 方向 4 |
| 补丁：只渲染最近 N 楼 | 长对话的前端性能 | 前端协议 | 方向 5 |
| 楼层 iframe、模板正则、助手宏 | 每回合一个作者定义的视图，数据来自模型 | 节点上的读数与字段，作者声明的视图 | 方向 5。机制不要：模型不写 HTML，正则不当模板 |
| 对 ST 全部对象的 CRUD | 编辑器与脚本要能读写全部数据 | 卡、玩家层、节点都是数据，天然可读写 | 已满足 |
| `importRaw*`、`installExtension`、音频 | 平台杂项 | 无 | 不需要 |

## 4. 跨文件的规则

- **需求与形状分开读。** 酒馆助手的 161 个函数，需求侧几乎全部在本项目里已有家：一回合多次请求、历史按阶段换视图、状态在节点、代码夹边界、玩家动作结构化、trace。形状侧（可变共享对象上的钩子、监听者排序、正文解析命令、模型写 HTML、版本 shim）全部是 ST 逼出来的，一个都不要。
- **"harness 对运行时掌控到什么地步"的答案：到每一次请求。** 生态最重的 API 是 `generate`，不是变量、不是事件。作者要的是"这一次请求长什么样、发给谁、怎么收"由调用方决定。本项目"代码掌握循环"与"harness 拥有请求形状"合起来就是这个，差的是把它做成真实 provider 上可运行的东西，以及按阶段的中止、静默与流式。
- **状态的作用域只需要三个。** 七个作用域里，全局是玩家偏好，角色卡是卡常量，聊天与楼层是运行状态；preset、script、extension 三个是"逻辑住在哪里"的产物，本项目作者不写逻辑，这三个随之消失。楼层按 swipe 分别存变量，等于"swipe 是兄弟节点"。
- **溯源不该是一门工程。** 75KB 的事后对齐，自己承认不准，根因是装配过程里文本一经拼接就丢了来源。装配是纯函数、片段有身份，溯源就是装配的另一个输出。README 方向 5 的前端协议应直接包含它。
- **修正补丁与 provider 兼容层是 ST 的旧账，不是需求。** 不按估算截断、卡与知识是一个对象、签名回传、九种 source 的工具调用归一，这些在任何现代编排层或 SDK 里是默认行为。酒馆助手要手写它们只说明宿主有多原始，本项目换栈后顺带消失，不构成 README 的新条目。
- **生态的"视图"已经三层分离，只是让模型承担了错误的两层。** 模型手写带标签的文本甚至 HTML，正则当模板，iframe 当视图。同一轮输出里既要排格式又要更新变量，是把不同维度的任务混在一起，解析与书写两头都脆弱。本项目要的是：视图由作者在设计期写好（如西西弗斯的沙盒形态），模型每轮只产出带类型的数据，harness 持有 schema 与渲染协议；正文不承载任何一层。
