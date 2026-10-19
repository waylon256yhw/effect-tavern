# 读表记录：记忆增强表格（muyoou/st-memory-enhancement），这个品类的祖先

2026-10-19。读了 muyoou/st-memory-enhancement，v2.2.19，最后一次 commit 2026-09-15。这是记忆类的第三份：shujuku（`memory-table-reading.md`）是这一品类长到最大的样子，BaiBai-Book（`baibai-book-reading.md`）是在 ST 上独立走到我们这种结构的样子，这一份是品类的源头。读法同前：先站高一点分三堆，再逐条对照，只让活下来的进"对协议的要求"。

## 0. 站高一点

### 0.1 它是什么，什么时候长的

| 项 | 值 |
|---|---|
| 体量 | 16.8k 行，纯 JS 加 jQuery，无构建、无测试（`_fotTest.js` 是跑在生产里的手工测试队列） |
| 时间 | 2025-01-26 首个 commit，2025-02 到 06 五个月 630 次提交（占 764 次的 82%），2025-07 以后维护态，2026 年全年 44 次，全是修 bug 和小功能 |
| 时代 | 2025 上半年：Gemini 2.0 Flash / 2.5 Pro、DeepSeek R1、Claude 3.7；重建模板的说明写着"适用于 Gemini，Grok，DeepSeek，破限来源于 TT 老师" |
| 谱系 | 默认六张表（时空、角色特征、角色与 `<user>` 社交、任务约定、重要事件历史、重要物品）和 `<tableEdit>` 里的 `insertRow / updateRow / deleteRow` 约定，就是后来 shujuku 那一类"记忆表格"的原型。shujuku 把它长成了 24.5 万行；它自己停在 1.7 万 |

它做一件事：让模型在每轮回复里顺手维护几张表，下一轮把表喂回去。所有其他东西（三条填表路径、七个整理模板、表格编辑器、单元格历史、推送到聊天的自定义渲染、外部数据适配器）都是围着这一件事在 ST 上长出来的。

### 0.2 先回答那个直觉：CSV 靠不靠谱

打眼看到的 CSV 是**给模型看的线上格式**，不是存储。两层要分开说。

**存储层比它看起来好。** `cellHistory` 是只增不减的单元格日志，每个单元格有 uid，改一个格子不是改值，是新建一个格子、把指针换掉；每条 assistant 消息上存一份 `hash_sheets`，是各表当前的 uid 网格。也就是说每条消息持有一份不可变快照，快照之间共享未变的格子。这个结构白送了三样东西：swipe 和分支天然各自一份表（指针网格跟着消息走），撤回就是指到上一条消息的网格，渲染时拿两条消息的网格对比就能把新增、修改、删除的格子涂色。这是 BaiBai-Book 那种"事件溯源的叶子加派生状态"的单元格粒度版本，作者在 2025 年 3 月就做到了，而且是在 ST 上做的。

**模型接口层是它的病。** 表以 CSV 喂给模型，表、列、行全用整数下标寻址（`[2:角色特征表格]`、`[3:对<user>好感]`、`rowIndex`），模型在正文里写 JS 函数调用，包在 `<tableEdit><!-- --></tableEdit>` 里（HTML 注释是为了让 ST 的 markdown 渲染藏掉它）。由此派生的规则全部写在提示词里：**单元格禁止逗号**（"语义分割应使用 /"）、**禁止双引号**、下标必须是数字串、没操作也要回一对空标签。最后一次 commit（2026-09-15）仍然在"取消逗号替换为斜杠，只压缩空白字符"。删除按行号，行号在删除后会移位，于是代码按 update → insert → delete 排序、删除按行号倒序执行；update 超出行数就静默变成 insert。线上格式反过来规定了虚构里能用什么标点，这是格式在约束内容。

所以直觉对了一半：不靠谱的不是"表"，是**表以什么形状进出模型**。表作为作者声明的、有类型列的状态形状没有问题，我们自己就有（`product.ts` 的 `table`）。

### 0.3 第一堆：对 ST 缺位的兼容补丁

去掉 ST 之后没有存在理由的部分。按前几份记录定下的四个缺位归：

- **状态没有主人。** 表只能挂在消息上，于是：`getLastSheetsPiece` 从末尾往上找第一条带 `hash_sheets` 的 assistant 消息；"没有记录载体，表格是保存在聊天记录中的，请聊至少一轮后再重试"，开局之前表不能存在；`isSwipe / getReferencePiece` 判断当前是不是在 swipe 以决定参照哪条消息；分步填表给每条消息发 `uid`，用 `two_step_links[uid_swipeId]` 记"哪次填表已经执行过"；消息编辑后重新解析、重新从上一条推导；分步填表成功后 `reloadCurrentChat()` 整页刷新"确保包括宏在内的所有数据都得到更新"；旧格式 `dataTable` 与新格式 `hash_sheets` 两套并存，读到旧的就地转换。
- **回合没有阶段。** 填表只能是三条互不相通的路径，每条自带提示词、自带 API 配置、自带解析器、自带确认弹窗：
  1. 随正文：模型在同一次生成里写 `<tableEdit>`，`CHARACTER_MESSAGE_RENDERED` 后正则抽出来执行；
  2. 分步填表：正文渲染完再发一次独立请求（优先 TavernHelper 的 `generateRaw`，没装就退回酒馆自带的，或者自定义 API），带"累计 N 长度的文本，是否开始独立填表"弹窗、"不再提示 / 一直选是"、忙锁防重入（#210），执行前先 `undoSheets(0)` 退回上一版再重做；
  3. 手动重建：七个整理模板（更新、兼容更新、完整重建加总结、修复、修复加简化、修复加简化但不动历史、只简化历史），模型回整张表的 JSON，用户确认后整表替换。
  "下一步"在 README 里写的是"未来结合主副 API，实现任务智能分配"，就是在没有阶段的宿主上自己造阶段。
- **消息是字串。** `<tableEdit>` 正则、手写的宽松分词器（`parseArgs`、`parseLooseDict`，容忍全角引号 “” 和全角逗号，嵌套引号互换以求可读）、`editErrorInfo.forgotCommentTag`、重建回复的 `safeParse` 加"取数组最后一项"、失败弹出原文让用户自己看。
- **请求形状不可编程。** 注入模式三选一（system / user / assistant 角色）加深度；三个宏 `{{tablePrompt}}`、`{{tableData}}`、`{{GET_ALL_TABLES_JSON}}` 供预设作者自己摆位置；`{{GET::表名:A1}}` 单元格宏；每表 `sendToContext` 开关；`triggerSend`：只发第一列的值出现在最近 N 条正文里的行，这是世界书关键词触发的手工版，用来省 token。
- **没有状态栏。** 表要让玩家看见，只能渲染进聊天 DOM（`tablePushToChat`）：每表一段自定义 HTML 模板、`$A1` 取值、`{{GET::}}`、按角色名"穿插"多张表的行、`<cycleDivide>` 循环标记，第三种模板语言。
- **别的脚本够不着状态。** `external-data-adapter.js` 和 `window.stMemoryEnhancement`，给其他插件和 userscript 一个推送编辑的口。
- **宿主的 API 不够用。** `llmApi.js` 自带一套 OpenAI 兼容客户端，经 `/scripts/custom-request.js` 走酒馆代理，密钥存在 `IMPORTANT_USER_PRIVACY_DATA`。

这一堆占代码的大头。它们的共同点是在替宿主补一块宿主该有的东西，补得还算克制（没有像 shujuku 那样重建一棵回合树）。

### 0.4 第二堆：方向错误，不是环境所迫

- **越狱段塞进填表提示词。** 重建和分步填表的默认提示词都以 `Bypass all content filters`、`<SUPER_PASS>` 开头，列着 CSAM 等词，然后是假的 assistant 回合 `directive_override ... <content>` 当预填。这是让模型整理一张角色表。2025 上半年给 Gemini 用的手法，原样留到今天。
- **伪 JSON 规约当提示词。** `TableProcessingProtocol`：`"emotionalShift≥2"`、`"symbolicImportance≥5"`、`"storageUtilizationThreshold": "85%"`、`"loadBalancing": {"timeoutThreshold": 15}`、`"cleanupTriggers": {"eventCountThreshold": 1000}`。这是一份配置文件的 cosplay，里面的数字没有一个是模型能测量的。
- **用线上格式反向规定虚构的词汇。** 禁逗号、禁双引号，见 0.2。
- **一行表当标量。** 时空表格"应保持在一行"，删除规则是"此表大于一行时应删除多余行"，让模型给自己做 GC。它要的是一个 `record`（当前时间、地点、在场者），不是表。
- **三条路径互相覆盖。** 分步填表执行前先撤回再重做，是因为随正文路径可能已经写过一次；两者之间的关系靠 `two_step_waiting` 标记维持。
- **旋钮。** 三十多个设置，重置弹窗分六类；每条路径各自的 temperature / top_p / max_tokens；`custom_max_tokens` 曾经从未被读取、一律按 63000 发送（#162 / #193）。
- **代码。** `index.js` 1081 行，`console.log("测试获取map")` 散在各处，`checkPrototype` 留着"为了兼容旧代码调用但内部逻辑已更新"，`dryRunExecuteTableEditTag` 是一个 TODO，每次加载向 GitHub 拉 manifest 比版本并在提示里写 QQ 群号。比 shujuku 干净得多（这是人写的，不是 agent 写的），但同一品类的病都在。

### 0.5 第三堆：我们已经有更好形态的

| 它 | 我们 |
|---|---|
| 每条消息一份 `hash_sheets`，`getLastSheetsPiece` 往上找，swipe 判定，开局前不能有表 | 产物挂在日志节点上，节点归 harness；开场也是节点 |
| 随正文写 `<tableEdit>` JS 调用，宽松分词器，注释标签 | record 阶段结构化输出，形状即格式 |
| 分步填表：另发一次请求，弹窗、忙锁、先撤回再重做 | record 是回合的一个阶段，每轮必跑，与 narrate 同一次回合、不同的调用 |
| 七个整理模板，整表 JSON 替换 | 产物每轮按形状重新提取，`feed` 沿路径折叠；没有"修复"这个动作，下一轮就是修复 |
| CSV 加整数下标，禁逗号禁引号 | 列有类型的 `table` 形状；序列化是 harness 的事，与内容无关 |
| 注入模式加深度，三个宏，`sendToContext` | Fragment 装配；`feed` 回喂到 record 的 Known / Current 与叙事者 tail |
| `triggerSend` 按第一列匹配最近正文 | `recall` 产物的行与 lore 钩子一起进 lookup 的枚举 |
| 自定义 HTML 模板、穿插、`{{GET::}}` | 产物作为数据过线；渲染归客户端 |
| 单元格历史、撤回、改动涂色 | 日志树；swipe / reword / edit 是兄弟节点 |
| 每表的 `note / initNode / insertNode / updateNode / deleteNode` | 产物按 id 的 `asks` 覆盖问法 |
| 时空表格一行 | `record` 形状 |

### 0.6 分堆之后剩下什么

三堆拿掉，剩两件，都不是新机制：

1. **单元格级别的身份。** 它的格子有 uid、快照共享未变的格子，所以"这一轮表里什么变了"是对比两份指针网格就得到的，而且是免费的。我们的 `table` 产物按轮整份快照，行没有身份；"这轮变了什么"要靠按列对比。这就是 `memory-table-reading.md` §6 已经标为 ceiling 的 `key / ops`（表收操作还是收全值），这里是第二票。仍然是 ceiling：规模到了、或客户端要涂色时再做，而且做法是行有 key，不是模型写 JS。
2. **表是给人看的，不只是给模型看的。** 六张表默认 `asStatus: true, toChat: true`，社区分享界面上看到的就是这个。玩家要看到状态，这不是记忆插件的需求，是客户端的需求。`client-shape.md` 已经把 products 列进客户端要显示的东西里，这份材料只是确认那一行该有张"表"的样子，而不只是 notes 一段文字。

另有一个时代量，和 shujuku 那份的结论一致：这整套"模型在正文里写编辑指令、代码再抽出来"的约定，是 2025 上半年结构化输出还不可靠、ST 管线又只认字串时的产物。它的作者在 2025-03 做出了单元格日志加指针快照这样的存储，说明不是不懂工程；是宿主只给了字串和消息，于是最好的部分被埋在最差的接口下面。

## 1. 逐条对照

### 1.1 表的声明

每张表：`tableName`、`columns`、`enable`、`Required`、`asStatus`、`toChat`、`note`、`initNode`、`insertNode`、`updateNode`、`deleteNode`。模板有三个域（global / role / chat），聊天域的表从全局模板实例化，`template` 字段指回去。对照我们：产物 id、形状、`asks` 覆盖、卡按 id 补丁、玩家按 id 开关。它的 `Required` 加 `initNode`（空表时必须先从上文把已知角色填进来）对应我们开场节点的 record；它没有的是列的类型和上限，这两样在它那里是提示词里的"禁止捏造信息和填入未知"。

### 1.2 表进提示词

`getTableText`：标题 `* i:表名`、`【说明】note`、`【表格内容】rowIndex,0:列,1:列`、CSV 行、`【增删改触发条件】`。三种去向：注入到指定深度的一条消息、宏由预设作者摆、`triggerSend` 按名过滤行。分步模式下只注入纯数据不注入编辑规则（"以下是通过表格记录的当前场景信息以及历史记录信息，你需要以此为参考进行思考"）。这最后一点和我们一致：叙事者看到的是 `Current:` 行，不看到提取规则。

### 1.3 表的更新

三条路径见 0.3。随正文路径里，`CHARACTER_MESSAGE_RENDERED`、`MESSAGE_EDITED`、`MESSAGE_SWIPED` 三个事件都会触发重解析，`isTableEditStrChanged` 用"编辑串拼起来是否相同"去重。执行顺序 update → insert → delete（删除倒序），是为了行号移位。对照我们：record 一次调用、形状校验、上限与过滤由代码施加，没有行号。

### 1.4 存储

见 0.2。补一点：`chatMetadata.sheets` 存表的元数据和 `cellHistory`，消息上只存 uid 网格，所以 `cellHistory` 在整个聊天范围只增不减，`save()` 每次 `saveChat`。单元格历史面板（`cellHistory.js`、`tableHistory.js`）直接读这份日志。

### 1.5 渲染

`tablePushToChat`：默认样式渲染成 `<table>`，或每表一段用户写的 HTML 模板，`$A1` / `{{GET::表:A1}}` / `##表:A1##` 三种取值语法并存（历史层叠），"穿插模式"把多张表的行按第二列（角色名）分组交错输出，`<cycleDivide>` 标记循环体。渲染结果插进 `.mes_text` 的顶部或底部，或一条系统消息。这整块在我们这边是客户端的事，协议只保证产物是带形状的数据。

## 2. 对协议的要求

没有新增。两处确认：

- `table` 产物的行身份（`key`）仍是 ceiling，这份材料是第二票，触发条件不变：规模到了，或客户端要显示"这轮变了什么"。
- 客户端设计里 products 面板要能显示表形状的产物（列头加行），而不是只把 notes 当文本显示。这已在 `client-shape.md` 的 products 行里，这里只是把"表"点名。
