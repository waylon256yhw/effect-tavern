# 对标记录：2026 年的 agent harness 怎么处理会话、上下文与记忆

2026-10-18。读了七个系统，分两组。**Harness 组**（读源码与官方文档）：Hermes Agent（Nous Research，`main` ad06e63，v0.22.2）、OpenClaw（`main` 0a80f9e0，2026.10.4）、Codex CLI（openai/codex `main` 8c07694，rust-v0.163.0）、Claude Code（官方文档加本机转录文件）。**消费级 bot 组**（只有公开资料）：xAI Grok Bot（2026-08 beta）、OpenAI dots（2026-09-29）、Meta Muse（2026-09-08）、Google Gemini Spark（2026-05，10 月改名 Task）。五份原始调研在 scratchpad 的 `findings-*.md`，这里只留结论。

读法不同于前几份：不再按机制对照，先找七个系统**收敛到同一处**的东西，那是经过验证的工程实践；再看**分歧**，那是尚未定论或场景相关的；最后用**规模**当尺子。memory-table-reading §0 的三堆方法在这里反过来用：别人收敛到的地方，就是我们检验自己形态的参照。

## 1. 收敛表

| 维度 | Hermes | OpenClaw | Codex | Claude Code | 四个 bot | 本项目 |
|---|---|---|---|---|---|---|
| 转录单位与存储 | 会话 = SQLite 行，messages 表存 role / content / tool_calls / reasoning / api_content 字节副本 | 每 agent 一个 SQLite，`transcript_events(session_id, seq, event_json)` | 每线程一个追加 JSONL，SQLite 只做索引 | 每会话一个追加 JSONL，记录带 `uuid` / `parentUuid` | 不公开 | 日志树节点，只存模型输出与种子 |
| 原地改历史 | 不。软删除 `active=0` | 不。回退写标记 | 不。回退追加 `ThreadRolledBack`，读时跳过 | 不。一切追加，为保前缀缓存 | — | 不。节点不可变 |
| 分支 | 整份复制成新会话，`parent_session_id` | 条目树 `parentId`，fork / rewind / 切分支是一等操作 | 复制前缀成新线程，`forked_from_id`；文件内无兄弟 | `parentUuid` 成树但分支靠复制文件 | 不公开 | 兄弟节点 = swipe，一等 |
| 压缩谁写 | 辅助模型写结构化摘要 | 模型写，追加进转录；`safeguard` 模式代码审摘要，超时走确定性兜底 | 模型写（专用压缩提示词），服务端变体 | 同模型，在缓存前缀上追加一条总结请求；"单独便宜调用正是成本陷阱" | — | **代码折叠 notes**，不调模型 |
| 压缩保留什么 | 头 3 条、尾 10 到 25K、**每条用户消息原文**、正则锚点索引 | 新一半原文，老的用户消息按比例 | **用户消息原文**（20K 预算）、重插初始上下文、一条摘要；助手与工具 I/O 丢弃 | 结构化摘要、重注 CLAUDE.md 与记忆、重读最近 5 个文件 | — | 区间内 notes 与送入的 lore 文本；**玩家原文不保留** |
| 工具结果裁剪 | 先把老工具结果替成桩 | 每请求视图，不落盘 | 落盘截断 64 KB | 先清老工具结果再压缩，"最轻的压缩" | — | 没有工具 |
| 摘要存还是算 | 存为 assistant 行，下次更新它 | 存为 compaction 条目 | 存 `Compacted{replacement_history}`，恢复只重放其后 | 存在转录里 | — | 不存，按区间缓存重算 |
| 跨会话记忆是什么 | `MEMORY.md` 2200 字符 + `USER.md` 1375 字符 | `MEMORY.md`（策展）+ `USER.md` + 日记 `memory/YYYY-MM-DD.md` | `memory_summary.md` < 10 KB + `MEMORY.md` + 每线程 `rollout_summaries/` | `MEMORY.md` 索引 200 行 / 25 KB + 每条一个文件 | Grok Bot：偏好与工作摘要；dots：notes；Muse：VM 里的 `MEMORY.md` / `Soul.md` / `Identity.md`；Gemini：账户级过往聊天检索 | 无（见 §4） |
| 谁写、何时 | 模型用 `memory` 工具（add / patch / remove）；或每 10 轮一次后台 review fork | **唯一主写者是 dreaming**（后台 cron）；压缩前一次静默"flush"轮只追加日记 | 会话启动时对闲置 >12h 的线程跑两阶段后台提取与合并，沙盒子代理编辑文件 | 模型在会话中写，"不是每次会话都存" | 模型自动写；用户不能逐条看（Grok、dots）或能逐行改（Muse） | — |
| 上限怎么处理 | 溢出报错，模型自己合并；不自动压缩记忆 | 由 dreaming 的频率与多样性闸门决定升不升 | 两阶段都"允许且偏好 no-op" | 索引超限写成功但报错要求重写 | — | — |
| 注入 | 会话开始时冻结快照进系统提示词；中途写只落盘 | 只主会话注入 `MEMORY.md`；日记永不自动注入 | 开发者消息带摘要加指针，正文按需读并要引用 | 索引每次会话载入，正文按需读 | 每轮隐式 | — |
| 召回 | `session_search`：FTS5，不调模型 | 两道：零模型（FTS5 加向量，触发词 ≤3 条）；只在问过去时才升到子代理 | `rg` 扫文件 | 不做跨会话检索；不做代码向量索引（"陈旧索引"） | Gemini 做账户级检索并标注来源 | lookup 阶段：枚举（lore 钩子） |
| 人写与机器写 | `SOUL.md` 人写，agent 改要审批；记忆不按项目分 | 指令层只人写、总是注入；记忆行带 provenance，模型写不了 | `AGENTS.md` 人写、可信；记忆是"recall aid, not the only source for rules" | `CLAUDE.md` 人写；记忆按 git 仓库根分，本机不同步 | Grok Bot："记忆不是权威来源" | 玩家层 / 卡框架 / 虚构三个区人写；模型只写 notes 与产物 |
| 删掉的东西 | JSONL；压缩时轮换会话；**上下文压力提示**（"让模型提前放弃"）；memory 的 **`replace`**（"模型会整条抹掉多事实条目"） | QMD 后端、channel docking、JSON 日记；"无兼容别名，启动拒绝直到 doctor --fix" | 部分历史的子代理 fork；记忆表移出主库；外部 agent 记忆导入默认关 | 不做服务端记忆；压缩不另开便宜调用；"压缩本身不够，配结构化笔记与 git" | Muse 承认 forget 之后"可能仍然记得" | — |

## 2. 收敛点

七个系统互不相关，收敛到同一处的东西有六条。

1. **转录是追加日志，从不原地改。** 四个 harness 全是。回退、重试、分支都用标记或复制实现，历史文件不改写。理由一致：前缀缓存。本项目的节点不可变是同一条。
2. **分支没人做成文件内的兄弟节点，除了 OpenClaw。** Codex、Hermes、Claude Code 都是复制前缀开新线程。OpenClaw 的 `parentId` 树加 fork / rewind UI 是唯一的例外，而它是面向个人助手而非编码。swipe 作为一等兄弟节点是 AIRP 特有的需求（ST 也有），本项目做成树是对的，但要知道这是少数派，代价是视图必须按路径算。
3. **压缩：模型写摘要、追加进转录、近尾与用户原文保留、工具结果先裁。** 三个细节一致到可以当规则：用户消息原文优先保留（Codex 给 20K 预算全留，Hermes lean 模式每条留，OpenClaw 老用户消息按比例留）；工具结果裁剪是请求视图或落盘截断，不进摘要；摘要在缓存前缀上生成，不另开便宜调用。OpenClaw 加了一道代码审摘要加确定性兜底，Hermes 也有确定性兜底。
4. **跨会话记忆小、两层、模型写、系统只存、溢出报错。** 上限从 2200 字符到 25 KB，全是人能一眼看完的量。全部两层：常驻索引加按需正文（Claude Code 的 topic 文件、Codex 的 rollout_summaries、Hermes 的 skill_view、OpenClaw 的 memory_get）。超限不自动压缩，报错让模型自己收（Hermes、Claude Code）。memory-table-reading §0 里 memU 的终态在这里得到四次独立复现。
5. **一个主写者，后台写，偏好不写。** OpenClaw 明说"持久记忆只有一个主写者"（dreaming cron）；Hermes 每 10 轮一次后台 fork；Codex 两阶段后台提取，"no-op 允许且偏好"；Claude Code 在会话内写但"不是每次都存"。OpenClaw 的话最直接："写是难的那一半，写了什么比怎么索引重要。"
6. **人写的指令与机器写的记忆严格分层。** `AGENTS.md` / `CLAUDE.md` / `SOUL.md` 人写、总是注入、可信；记忆是辅助，不是规则来源（Codex 原话），OpenClaw 用 provenance 列让模型写不进指令层，Grok Bot 文档写"记忆不是权威来源"。本项目三个区人写、模型只写 notes 与产物，是同一个分层。

消费级 bot 组补一条：**四家都是任务 agent，bot 是持久对象、聊天是一次性的**；记忆全是模型写的笔记，用户要么看不见（Grok Bot、dots 不能逐条查改）、要么是文件（Muse 的 `MEMORY.md` 可逐行编辑）。没有一家用结构化数据库。Muse 的 `Soul.md` / `Identity.md` 与 Hermes、OpenClaw 的 `SOUL.md` 是同一个槽位：人格是人写的一个文件。

## 3. 分歧

- **记忆何时写**：会话内由模型用工具写（Hermes、Claude Code）对 只允许后台写（OpenClaw、Codex）。后者的理由是会话内写会污染（Codex 把带 MCP / 网页搜索的线程标 `polluted` 排除；OpenClaw 不让 cron、heartbeat、子代理会话产生候选）。
- **记忆作用域**：按机器全局（Hermes、Codex）、按 git 仓库根（Claude Code）、按 bot（Grok Bot、dots）。没有人按会话。
- **摘要存还是算**：四个 harness 全存，本项目全算。这不是分歧，是前提不同：它们没有 record 阶段，到压缩时手里只有散文，只能让模型写一次摘要再存起来；本项目每轮 record 已经提取了 notes，摘要是对 notes 的代码折叠，不需要模型也不需要存。Claude Code 的"压缩本身不够，要配结构化笔记"和 Codex 每线程一份 `rollout_summary`，都是在往 record 阶段的方向补。
- **用户原文是否进摘要**：三个 harness 一致保留，本项目的折叠把玩家原文全丢进 notes。它们保留的理由是用户消息承载意图；AIRP 里玩家的意图在 aside 通道，正文是虚构的一部分。这是本项目唯一与收敛点相反的地方，见 §5。

## 4. 规模

| 系统 | 核心有多大 | 增长在哪一层 | 在哪里停 |
|---|---|---|---|
| memU | 收敛后 500 行 | 宿主适配器（9 个） | 2026-07 之后无 release |
| Hermes | 未量（agent 没量 LOC） | 平台接入、插件记忆提供方、技能 hub | 策展器只归档不删；记忆上限是硬数字 |
| OpenClaw | `src/` 263 万行生产 + 353 万行测试，77 个顶层模块 | 182 个扩展、1374 页文档、987 个贡献者 | `VISION.md`：拒绝 >5000 行的 PR，无兼容别名；cron 从 4.4 万行减到 2.6 万行仍是"提案，部分实现" |
| Codex | 未量；rollout / history / state / memories 几个 crate | 服务端变体、项目分组、外部记忆导入 | 记忆默认关；外部导入默认关 |
| Claude Code | 闭源 | 插件、技能、钩子 | 不做服务端记忆、不做跨会话检索、不做代码索引 |
| shujuku | 24.5 万行，11 个测试 | 续写、推演、零层、向量各一套回合 | 没停 |
| 本项目 | runtime `src/` 约 530 行 | 卡（数据）、作者视图（沙盒）、provider、插件阶段 | 四张模板卡加检查器跑通即停 |

读数：**harness 核心（转录、压缩、记忆）在每个系统里都小**，几个文件、几千行以内；体量长在接入层与扩展层。OpenClaw 与 shujuku 是同一种病的两个剂量，区别只是前者有 987 个贡献者和一份事后补的 `VISION.md`。核心小不是因为没需求，是因为收敛点就那六条。所以 README 立场里可以写一条比"少写代码"更硬的：**核心有上限**，runtime 保持在一两千行量级，超出即说明有东西该是数据、该是插件、或该删。

## 5. 对本项目

**已经在收敛点上的**：追加式日志树；历史是视图；人写三区与模型写 notes 的分层；lore 两层加 lookup；record 阶段（它比收敛点多走了一步，摘要因此不用模型）。

**要定的**：

1. **玩家原文要不要活过折叠。** 三个 harness 一致保留用户原文；本项目的 `narratorHistory` 对折叠区间只给 notes 与 lore。AIRP 的区别是玩家正文是虚构的一部分，不是指令；但 aside 是指令。候选：折叠区间内保留 aside 原文（它们本来就不进转录稿，所以等于不变），正文只靠 notes。先不动，live 跑长局时看叙事者有没有丢玩家意图。
2. **AIRP 的记忆分两层，落点都已有，差别在谁写。**
   - **玩家的长期记忆**（题材取向、剧情偏好、NSFW 描写风格）：就是玩家层，`style` / `pov` / `language` 槽位、`asks` 覆盖、产物开关，即 enhancer，今天全由玩家手写。模型写的版本按收敛点定形：小、玩家可见可编辑、一个写点、偏好不写。比"模型写一段自由文本"更好的形状是**模型提议对玩家层槽位的修改**：局末或玩家触发时，对这一局的路径跑一次 record 式调用（"这个玩家反复把叙事往哪里拉"），输出几条对现有槽位的候选改动，玩家接受才落盘。记忆因此仍是玩家读得懂的数据，不出现第二种格式。方向定下，不是现在。
   - **这张卡、这一局的记忆**（事件、人物、细节）：已被更强的东西分完。决定性的数是字段，写后才知道的是读数，作者预设的是 `when` 门控的 fragment 与 lore，叙事者即兴的事实是 notes，窗口外要点名找回的是 `recall` 的 lookup。没有第五样。shujuku 的角色表、事件表是在 ST 里用模型维护前三行的替代品；这里前三行归代码与作者，模型只剩 notes。剩下的不是机制而是 notes 的质量（大世界卡上写成景物），产物带形状是对它的回答。in-context learning 则是转录稿本身在起作用。
   - 按卡、跨局的"上一局玩到哪"就是日志树本身。
3. **不给模型上下文压力提示。** Hermes 删掉它的理由（"让模型提前放弃"）直接适用于 narrate：输出上限是连接配置，不进提示词。现状已经如此，写进立场。
4. **记忆操作词表不要 `replace`。** Hermes 把 `replace` 换成 `patch` 的理由（模型整条抹掉多事实条目）对带 key 的 table 产物（memory-table-reading §6 第 3 条，ceiling）直接适用：到时词表是 upsert / delete，不是整表替换。
5. **压缩策略若要 LLM 版**，形状按三家一致的做法：在缓存前缀上追加一条请求、代码审结构、确定性兜底。现在的代码折叠已经是兜底本身。

**不做的**：OpenClaw 弃用分支时写 `branch_summary`（swipe 被弃是常态，没有总结价值）；dreaming 式后台 cron（没有后台，record 就是写点）；向量召回（lookup 的插件实现，memory-table-reading §6 第 5 条）。
