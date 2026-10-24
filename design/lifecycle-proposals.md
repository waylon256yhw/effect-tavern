# 回合生命周期拓展与工序解耦提案（收敛稿）

2026-10-25。区别于 `docs/` 下对现有生态材料的事实拆解，本目录存放面向下一阶段的架构提案（Proposals）。

本篇经代码接缝对照收敛后，明确了四个方向的取舍：**真正需要动代码的只有「正文后置场外块（`aside` Part）」「`check` 阶段代码级反八股词表」与「按工序路由 `SessionModel`」三件小事**，其余全部复用现有机制或按 YAGNI 暂缓。

---

## 1. 后置场外附言块（Post-prose `aside` Part）

### 1.1 取舍：只做正文后置块，不做前置文内 CoT

生态预设中常见的「一次性生成内容」分两类，经评估分开处理：

- **正文之后的幕后小剧场 / 角色吐槽 / 作者附言（做）**：只供玩家当轮阅读找乐，不属于故事正史。由于依赖完整角色人设（`card.fiction`）、对话语境（`history`）与高创造力采样，挂在已命中前缀缓存的 `narrate` 末尾顺手生成成本最低、语气最自然。
- **正文之前的文内构思 / In-text CoT（不做）**：
  1. 所对接的模型均已具备原生 thinking 能力，`src/fragment.ts` 中的 `{ type: "reasoning" }` `Part` 已经是这件事的正规通道；
  2. 前置块的风险比后置块高一个量级：一旦模型漏写闭合定界符，整段构思就会直接漏成正文并写入历史，比没有更糟。

### 1.2 机制：复用 `journal.ts` 的 `Part[]` 接缝

无需事后正则清洗，直接沿着现有的 `Turn.reply: readonly Part[]` 扩展一种 `{ type: "aside", id, label, text }`：

1. **流式切分**：`narrate` 流式接收器识别末尾固定定界符，将正文之后的小剧场切为 `{ type: "aside" }` 存入 `reply`，正文照常作为 `{ type: "text", text }` 流出。
2. **白拿的四重隔离**：
   因为全系统读取正文均通过 `prose(t)`（只取 `p.type === "text"`），`aside` 块自动获得以下性质，无需在各阶段写特殊分支：
   - **不进历史（`narratorHistory`）**：下一轮拼接历史只取 `prose(t)`，模型在后续轮次完全看不到上一轮的小剧场，杜绝画风跑偏与格式滚雪球。
   - **不进 `check`**：小剧场里的戏言不会误触发 `guard` 禁令或冒领 `must` 揭示。
   - **不进 `record` 与压缩**：场外玩笑不会被记入 `notes` 摘要，也不会影响 `readouts` 状态判定。
   - **客户端原生可画**：节点 `turn.reply` 完整保留该块，客户端按 `id / label` 画成折叠块即可。

---

## 2. `check` 阶段的代码级反八股（Anti-slop Lexicon）

### 2.1 痛点与思路

为防止模型写出高频套话（如「手指收紧又松开」「指节发白」「一丝不易察觉」「不是……而是……」），若将禁令常驻在 `style` 槽位中，既浪费每轮头区 Token，又容易引发「粉红大象效应」。

更便宜、更干净的做法是将反八股沉淀到事后 **`check` 阶段**，用纯代码扫描接管：

1. **代码级确定性扫描（0ms，不调模型）**：
   - **禁用词表（Slop Lexicon）**：扫描当轮 `prose` 是否命中玩家层或卡声明的禁用词组与句式。
   - **近期结尾意象复读检测**：比对最近几轮正文的收尾，拦截高频重复的景物或微动作收束。
2. **复用 `narrate.correction` 重写路径**：
   - 平时 `narrate` 提示词保持干净，不背负负面禁令表；
   - 仅当某轮草稿实际撞上词表或复读检测时，才把当轮命中的具体病灶拼进已有的 `narrate.correction` 触发重写。
   - **不引入独立的「润色器」模型**：已有的 `correction` 重写路径已经足够闭环。
   - **代价边界**：每次命中都会触发一次完整的 `narrate` 重写，早期若词表过宽命中率可能不低，因此词表应只收确凿的高频套话。

---

## 3. 导演阶段（`direct`）：暂不动

`direct` 目前仅在 `card.director && offered.length` 时运行，输出固定为 `Brief = { must, may, tone }`。当前没有任何实际卡片需要额外的导演规划字段；在真实卡片提出需求前保持现状，未来若需扩展再照 `Product` 的声明式形状设计。

---

## 4. Provider 层的按工序路由（Stage-to-Connection Binding）

`src/session.ts` 预留了接缝注释：`a real harness binds stages to connections`。

### 4.1 机制与缓存安全性

在 `src/request.ts` 中，六个阶段的上下文视图本来就是分离的，只有 `narrate` 读取完整的 `card.fiction` 与 `history` 并依赖长前缀缓存。将 `Session` 接收的单一 `M: SessionModel` 换成按 `Phase` 查表加默认回退（`SessionModel` 本身已打包 `format`、`prefill`、`ttl`），改动极小且完全不影响 `narrate` 的缓存命中。

### 4.2 关键边界：`record` 不是纯提取

在配置各阶段的模型时，有一条必须注意的实机边界：

- **`lookup` 与 `check`**：任务边界单纯，可以安全路由到极速、低成本的轻量模型（如 Haiku / Flash-Lite）。
- **`record` 不能盲目降级**：`record` 不仅负责提取 `notes` 和表格，还负责回答推动数值状态的 **`readouts`（叙事判断）**。实机测试（如竹林卡 `warmth` 连续四轮 `flat`）表明 `readouts` 对模型的微妙语境判断力敏感，若将 `record` 路由到更弱的模型，会让状态判定的质量显著劣化。
