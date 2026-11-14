# Effect Tavern

[English](README.md) | **简体中文**

从零构建的 AI 角色扮演与交互叙事全栈系统，基于 **Effect v4**、**Solid 2.0**、**UI SDK（`@ui-sdk`）** 与 **Bun**。

Effect Tavern 将一张卡视为**声明式数据 + 确定性规则**，而非提示词魔咒与正则脚本的拼接。代码掌控执行循环、状态结算、带种子的随机检定与缓存断点；LLM 只在带类型的阶段接缝上被调用，负责分类判断、渲染正文与提取结构化事实。

---

## 核心架构

### 1. 多阶段回合管线

玩家的每一轮输入走固定骨架的阶段流水线，而非单次对话补全：

```text
lookup → (decide → settle)* → gate → direct → narrate → check → polish → record
```

- **结构化阶段按需开启与决策模型预检：** 纯聊天卡每轮只跑 `narrate` 与 `record`；`lookup`、`decide`、`direct`、`check`、`polish` 均根据卡片声明自动启停。可选的全局**决策模型（Decision Model）**支持以概率打分直接完成完整目录 `lookup` 检索与边界清晰的 `check` 预检，仅在需要时回退至语言模型调用。
- **正文非权威与后台阶段隔离：** 只有 `narrate` 读取 `fiction`、行文风格指令与对话转录稿（`transcript`），且绝不直接看到数值——状态仅通过带 `when` 条件的散文分段（`band`）送达叙事者；其余后台阶段仅读取 `<world>` 背景与 XML 标签包裹的待处理文本。
- **确定性结算、两阶段世界状态与过场（`passages`）：** 标量字段（`fields`）由带种子的动作检定（`actions`）与写后选择题读数（`readouts`）由代码结算；可变世界表与记录（`world`）通过 `record` 阶段的稀疏 `DomainChange` 事务更新，与追加式编年记忆（`chronicle`，如 `notes`）及纯面向玩家的小剧场（`theater`，如 `inner`、`options`、`<<aside>>`）严格分责；写后 `passages` 支持周目/幕间重置（`digest` 纪元边界）与终局收束（`over`）。

### 2. 不可变日志树与纯函数派生视图

- 每回合落为追加/修订树（`Log`）上的一个节点，仅持久化玩家输入、随机种子与模型输出。
- 分支切换（`checkout`）、重抽与重写（`swipe`、`reword`）、正文或输入修订（`edit`）、手动改值（`setField`）全部是树操作；当前状态、转录稿、本轮账本（`Ledger`）以及前缀压缩折叠均为路径上的纯函数派生（`Derived`），在 Anthropic、OpenAI 兼容端点与 Gemini 上保持字节级缓存前缀稳定。

### 3. 无预设（Preset-free）分层装配

- 用统一的 `Layer` 优先级序取代传统的大杂烩预设：
  `harness → card → 挂载的写作包（packs）→ 单卡本地设置（local）→ 人设（persona）`
- 玩家可独立调节写作开关（`pov`、`echo`、`agency`、`verbosity`、`polish`）、挂载写作包（`Pack`）、切换模型续写协议壳（`Hat`）、配置快捷片段与阶段模型路由，互不侵入卡片内部逻辑。

### 4. 与传统酒馆系统的核心边界

| 传统酒馆常见做法                     | Effect Tavern 替代机制                                                       | 架构原因                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **大杂烩预设（`Preset`）**           | `request.ts` + `Layer` / `Pack` / `switches` + `Hat` + `Connection`          | 将消息编排、玩家文风偏好、模型续写握手壳（预填/破限）与端点连接参数按权责彻底拆开。              |
| **角色卡（`Character Card` V2/V3）** | 统一 `Card` Schema + 双坐标（`participant` / `author` 视角）                 | 同一套结构自然表达单角色、群像、跑团与无主角大世界，无需把世界规则硬塞进人物描述字段。           |
| **楼层深度插入（`@D`）与作者注释**   | 严格的 `head` / `tail` 双区装配 + 单轮 `note` 通道                           | 绝不往历史对话中间插队，保证跨轮 KV 缓存前缀字节级命中，并保持 `transcript` 纯净。               |
| **世界书蓝绿灯关键词扫描**           | 状态门控 `Lore`（`unlock` 地板、`offer` 窗口、`sections`）+ `lookup`         | 告别正文中顺嘴提一词就误触发或换词就漏检，支持单调解锁深度、首句钩子按需检索与 `ContextPolicy`。 |
| **正文尾块状态栏 / MVU + 正则脚本**  | `decide` / `settle` + `record`（`Readout`、`Product`、`DomainChange`）       | `narrate` 只专注写小说且不看数值，状态推进与结构化抽取完全交由代码结算与独立 `record` 阶段。     |
| **线性楼层 `swipes` 与复制分支文件** | 不可变 `Log` 树（`checkout`、`swipe`、`reword`、`edit`）+ `Derived` 路径折叠 | 任意历史节点零拷贝分叉；回退、切支或改文时状态、解锁层与区间折叠摘要绝不失步。                   |

---

## 仓库结构

```text
packages/
  runtime/    回合管线、Card/Layer/Product Schema、决策模型快筛、日志树、派生折叠、静态 lint 与离线制卡 CLI
  provider/   语言模型与决策模型连接、AI SDK 编译（Anthropic / OpenAI 兼容 / Gemini）、缓存断点与流式原语
  server/     SQLite 文档库、HTTP + SSE 服务端、制卡工坊接口（compile / sort / review）与 `tavern` CLI
  client/     Solid 2.0 + @ui-sdk Web 客户端：空间画布壳层、阅读器、卡片详情、读数与小剧场、检查器、时间轴与设置
skills/
  card-author/  渐进式披露（Progressive Disclosure）制卡与旧卡重制 Agent Skill
samples/        完整重制样卡（如演示多日循环 `passages` 与 `digest` 边界的 `life-of-pi`）
site/           基于 Cloudflare Nimbus（Astro）的双语文档站（同时产出 HTML、净版 Markdown 与 llms.txt）
docs/           内部工程调研与设计简报档案
```

---

## 快速上手

### 环境要求

- **Bun** `>= 1.4.4` 且 **Node.js** `>= 24`
- **Vite+**（`vp` CLI，`pnpm@12.11.1`）

```sh
vp install
```

### Web 全栈开发与单端口服务

```sh
# 启动全栈开发服务（前端 HMR + 进程内 /api 会话，默认库为 .dev/tavern.db）
bun --bun vp run dev

# 使用零 Token 脚本模型或自定义 YAML 卡片目录启动
MODEL=fake CARDS=./my-cards bun --bun vp run dev

# 构建前端并以单端口启动整座酒馆（:7777 同时服务 /api 与静态前端）
cd packages/client && bun --bun vp build
bun run tavern serve --port 7777
```

### 终端游玩与无头宿主（`tavern`）

```sh
# 终端直接开局游玩（传 MODEL=fake 或 --model fake 即可零 Token 验证）
MODEL=fake bun run tavern play wuxia --greeting 0 --input "走进竹林"

# 管理故事库或单独启动无头 API 服务（默认库 .tavern/tavern.db；传 --url 连接运行中服务）
bun run tavern story list
bun run tavern serve --headless --port 7777
```

### 离线制卡与工坊工具链（`card`、`unroll`、`tavern card`）

```sh
# 离线零 Token 制卡闭环（脚手架、静态 lint 检查、阶段请求预览、场景回归断言）
bun packages/runtime/bin/card.ts init my-card --template readout
bun packages/runtime/bin/card.ts check wuxia
bun packages/runtime/bin/card.ts view ri --stage record --state affection=60
bun packages/runtime/bin/card.ts test wuxia

# 按装配顺序只读展开 SillyTavern V2/V3（PNG 或 JSON）旧卡
bun packages/runtime/bin/unroll.ts path/to/card.png

# AI 辅助工坊（编译规则绑定、原样段落归位、只读一致性审阅、校验安装）
bun run tavern card compile my-card.yaml --select fiction.setting --intent "增加交情读数" -o candidate.yaml
bun run tavern card install my-card.yaml
```

### 代码验证与文档站

```sh
vp check            # oxfmt + oxlint（含 Solid 2.0 规则）+ 类型检查
vp run verify       # 运行全仓断言自检（runtime、provider、server、client、x18n 词条及前端包边界检查）
cd packages/client && vp run verify:ui # 基于无头 Chrome 与 @ui-sdk Agent Bridge 的真实控件与 Solid 诊断自检

pnpm run docs:dev   # 本地启动 Nimbus 双语文档站
pnpm run docs:check # 执行 Nimbus 文档规范检查与静态构建验证
```

---

## 文档导航

- **文档站（`site/`）：** 中英双语功能文档，涵盖核心概念、制卡指南、CLI 与无头宿主、玩家层与写作包、Web 客户端与交互架构（自动生成面向 Agent 的 `/llms.txt` 与 `.md` 镜像）。
- **[GLOSSARY.md](GLOSSARY.md)：** 面向开发与 Agent 的全英文命名原语表（Ubiquitous Language），严格对齐代码标识符。
- **[skills/card-author/SKILL.md](skills/card-author/SKILL.md)：** 卡片设计、静态校验、场景测试与旧卡重制 Skill。
- **[CLAUDE.md](CLAUDE.md)：** Vite+ 工具链、Solid 2.0 响应式规范、UI SDK（`@ui-sdk`）控件约定、国际化（`x18n`）与本地开发规范。
