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
