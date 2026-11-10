# 离线制卡工具

在仓库根目录运行 `bun packages/runtime/bin/card.ts <command>`，或进入
`packages/runtime` 后运行 `bun run card <command>`。所有命令均不打开 DATA 库、不调用在线模型。
文件路径支持 YAML（含 `.yml`）；也可直接使用四张内置卡的名字。

```sh
bun run card init my-card --template chat
bun run card check my-card.yaml --json
bun run card view my-card.yaml --stage direct --state hp=2 --events won --persona '你是一位旅人。'
bun run card test my-card.yaml scenario.yaml
```

`init` 在当前目录独占创建 `<id>.yaml`，已有文件会报错。四种最小脚手架只表达两个坐标，
不预装战斗或好感机制；这些机制由作者添加：

| 模板 | persona | 默认输入 |
| --- | --- | --- |
| chat | 有 | act |
| readout | 有 | note |
| rpg | 无 | act |
| world | 无 | note |

`check` 依次检查 YAML、Card Schema、规则初值、静态 lint 和开场/请求预览。
`--json` 的 stdout 是一个 JSON 对象，含 `diagnostics`、`fields`（含 drawn 规格）、
`greetings`、`sections` 和 `total` Token 估算。error 返回 1，只有 warn 返回 0；
YAML/Schema 错误使用 `schema`，文件读取失败使用 `io`。

`view` 支持 `--stage narrate|direct|record|lookup`、`--greeting N`、重复的 `--state k=v`、
`--events a,b`、`--pin id`（卡片也接受 `card:id`，Pack 使用 `pack:<row>/<entry>`）、`--persona text` 和 `--json`。
状态按初值 → 开场 do → 覆盖值计算；输出条件的每个子句、路径当前值、槽位来源，以及实际
`request()` 分段和缓存断点。事件按运行时语义用于 lore offer；fiction/action 的 when 不读取事件。
`--pin` 是本轮主动选择已解锁且允许玩家访问的 lore，不绕过访问权限。

预览没有历史、模型回复或历史披露；未披露 lore 的 since 为 Infinity、shown 为 0。narrate 默认把当前开窗列为 may，direct 展示导演的输入；
导演实际选择及多回合状态应通过 `test` 验证。`record` 预览使用空正文。

## 场景契约

场景格式严格校验，多余键报错。省略场景文件时执行一轮默认 fake 模型冒烟测试。
测试采用默认玩家层 `plain`（中文、options 开启）。每步 `replies` 按阶段提供回答队列：narrate 为字符串，record 为传给 `defaultAnswer` 的
产品值及 `answers`，其余为阶段结构化 JSON。未指定阶段使用默认 fake 回答；指定的队列
耗尽或没被完整消费都会失败。复杂自定义产品需在 record 回答中提供符合其 Schema 的值。
没有真实模型调用；fake 调用的 Token 用量为零。

```yaml
seed: 42             # 首个规则掷骰用 seed + 1，后续每次 +1；默认 0
# greeting: 0       # 可选；省略时从规则初值直接开始
steps:
  - text: 向前走
    # note: 推进剧情
    # invoke: [card:secret]  # 遵守实际玩家访问权限
    replies:
      narrate: ["你走到了门口。"]
      record:
        - notes: 已到门口
          options: []
          # answers: {warmth: close}
    expect:
      # state: {hp: 2}
      events: []
      windows: []
      lore: []
      end: end
      products: {notes: 已到门口}
```

`state`、`products` 按给出的键做深相等断言；`events`、`windows`、`lore` 按顺序精确匹配。
后两者使用 `id#层数`：windows 是当前回合开窗候选，lore 是 lookup/主动选择及 check 确认的披露。
`end` 对应实际回合结束原因（end/over/cap/stopped）。每步自动验证字段边界和 record 已提交；
失败报告步骤序号并返回 1。相同 seed 和回答序列得到相同规则结果。

## 展开 ST 卡（unroll）

`unroll` 是读卡仪器，不是转换器（#31）：把一张 SillyTavern 卡按 ST 自己的装配顺序展开成文档，
让人和代理看清作者让模型按什么顺序读到什么。它只读不写，不产出本项目的卡，也不调用模型。

```sh
bun run unroll card.png --user 李
bun run unroll card.json --json
```

输入两种：内嵌角色块的 PNG（取 `tEXt` 中的 `ccv3`，没有则取 `chara`；base64 JSON，不校验 CRC），
或 V2/V3 JSON（`spec` 为 `chara_card_v2` / `chara_card_v3`）。V1 卡报错。

输出两种：默认 Markdown，依次为 `before_char` 条目、`description`、`personality`、`scenario`、
`after_char` 条目、按 ST 规则切好的 `mes_example`（补 `<START>`、丢首行、按 `名字:` 切成
example_user / example_assistant）、`first_mes` 与各 `alternate_greetings`、带深度和 role 的深度条目，
最后是触发表（每个非 constant 条目的 keys、secondary keys 与 selectiveLogic，按 `insertion_order`）
和停用条目。作者写了 `system_prompt` / `post_history_instructions` 时分别排在最前和深度条目之后。
每个条目标出名字、constant 或 selective、位置和 `insertion_order`。`{{char}}`、`{{user}}`
（`--user`，默认 `User`）机械展开，其余宏原样保留并在末行列出；`extensions` 只列键名。
`--json` 输出同一份材料：按顺序的块及其位置元数据、触发表、未展开的宏。

Markdown 每块是一个带 `##` 标题的段落（字段内的空行压成单换行），可以直接作为
`tavern card sort <card> <source>` 的源稿，按段落下标归位到自己的卡里，再走 `check` / `view`。
