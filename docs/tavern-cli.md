# CLI 宿主：安装、游玩与故事管理

仓库根目录运行 `bun run tavern`。`tavern card init|check|view|test` 复用
[离线制卡工具](card-cli.md)；宿主入口另外提供以下命令：

```sh
bun run tavern card install ./my-card.yaml
bun run tavern story list --json
bun run tavern story new my-card
MODEL=fake bun run tavern play my-card --input '你好' --jsonl
MODEL=fake bun run tavern play 1
bun run tavern story show 1
bun run tavern story export 1 --format md > story.md
bun run tavern story export 1 --format json > story.json
bun run tavern story delete 1
MODEL=fake bun run tavern serve --headless --port 7777
```

没有 `--url` 时，直接打开 `DATA/tavern.db`；`DATA` 默认是当前目录的 `.tavern`。
`CARDS` 可指定模板 YAML 目录。安装卡覆盖同 id 模板。已有服务占用这个库会报错，
提示进程、库路径及 `--url`；不会自动切换到另一个库。

给 install、play、story 子命令传 `--url http://127.0.0.1:7777`（末尾带 `/api` 也可），
就通过 HTTP/SSE 连接已有服务。这种模式不读取本地 DATA，也不读取本地模型配置：

```sh
bun run tavern card install ./my-card.yaml --url http://127.0.0.1:7777
bun run tavern play 1 --url http://127.0.0.1:7777 --input '继续' --jsonl
```

开发网页服务默认使用 `.dev`，因此与网页共享故事时传它的 `--url`。
网页刷新或重新 attach 后能观察终端写入；本轮没有增加空闲客户端的推送通知。

`MODEL=fake` 在本地宿主使用零 Token 脚本模型，单次游玩也可传 `play --model fake`；真实游玩使用库中已有的 provider/routing。
不会读取开发机私有凭据。远程模式由服务端决定模型。`serve` 默认同时服务已构建的
`packages/client/dist`（需要有 `index.html`）；构建不存在时自动只提供 `/api`，
`--headless` 则始终只提供 `/api`。默认监听 `127.0.0.1`，`HOST` 可覆盖。

`card install` 与所有 `story` 子命令支持 `--json`。安装返回 `{id, installed}`，新建返回 `{id}`，
删除返回 `{id, deleted}`，list/show 返回故事列表/节点快照；export 的 `--json` 等价于 `--format json`。
show 默认打印阅读文本。`story delete` 是正式命令，`story drop` 保留为兼容别名。

## 普通终端游玩

`play` 的纯数字参数只表示故事 id，不存在时报 `no story`；其他参数作为卡片 id 新建故事。
`play 1 --card` 显式用卡片 id `1` 新建故事，即使故事 `1` 已存在。
进入时先 attach 未结束的回合或消费待报告错误；提示的 `story N` 写到 stderr。
`--input` 跑一条输入后退出，省略则逐行交互，也支持 stdin 管道。
普通输入遵循卡片默认的 act/note 通道；开场由 `/greet` 显式选择。

| 命令 | 行为 |
| --- | --- |
| `/greet [index]` | 选择开场（默认 0） |
| `/act text`、`/note text` | 角色行动或场外指导 |
| `/pin resource-id` | 本轮调用可用上下文，如 `card:guide`、`pack:p/entry` |
| `/set field=value` | 修改当前节点字段，支持 JSON 标量和未加引号的字符串 |
| `/swipe [node]` | 对节点重跑，默认当前 head |
| `/reword [note]` | 重写当前 head 的正文 |
| `/checkout node`、`/checkout root` | 切换分支或清空当前位置 |
| `/tree` | 输出故事节点树 JSON |
| `/context`、`/detail [node]` | 当前上下文、节点字段变化与结算详情 |
| `/inspect [node]` | 读取调用 trace；远程正文可见性遵守服务端 inspect 配置 |
| `/attach` | 接收正在运行的回合或待消费错误 |
| `/stop`、Ctrl-C | 停止当前回合，沿用宿主的撤回/保留部分正文语义 |
| `/help`、`/quit` | 帮助、退出 |

普通输出逐段打印正文、阶段名、字段变化、掷骰及建议选项。
`--jsonl` 的 stdout 每行一个事件，包括 `story`、`attach`、运行时公开事件及 `/tree`、`/inspect`
命令结果；错误说明和提示写 stderr。使用普通 readline 行输入，不启用 raw mode 或终端重绘。
输入按行串行处理。交互终端中 `/stop` 可直接打断正在运行的回合，错误打印后可继续输入；
管道模式遇到首个错误即返回非零退出码，后续已缓冲的指令也不会执行。`/quit` 等此前排队输入完成后退出。

`card install` 先通过 checkCard，再调用 library.cards.put；失败不会安装。
安装期间的回合仍使用原卡；如果无人订阅的回合失败，缓存保留到下一次 attach 消费错误，
随后才加载新卡。不会因读取节点或再次装卡而丢失该错误。

## 制卡工坊（阶段二后端）

宿主使用 `routing.stages.author`，未配置时依次回退到 `routing.default` 和环境模型。三条命令与 install 共用本地直连和 `--url` 连接方式，只返回候选或诊断，不自动安装。

```sh
bun run tavern card compile my-card.yaml --select fiction.setting --select 'lore.letter.layers[1]' --intent '交情达到 8 时提起信件' -o candidate.yaml
bun run tavern card sort my-card.yaml notes.md -o candidate.yaml
bun run tavern card review my-card.yaml --json --url http://localhost:7777
```

`compile` 返回包含机制增量与绑定的整卡候选，新建的正文和判据槽留空。结构错误最多回喂修正一次，回喂前过滤 `empty-text`。诊断打印到 stderr。规则变化且旁边存在 `<card>.scenario.yaml` 时，使用已有的零 token 场景执行器回归，并在 stderr 报告 PASS/FAIL；失败仍保留候选。

`sort` 按空行拆分源稿，再按下标逐字复制整段；一个槽接收多段时，按源稿顺序以两个换行连接。compile 和 sort 未指定 `-o` / `--output` 时将 YAML 输出到 stdout。`review --json` 输出诊断数组，人类可读的警告打印到 stderr；review 只读，宿主过滤掉不存在的卡片路径。

HTTP 客户端调用 `POST /api/author/compile {card, select, intent}`、`/api/author/sort {card, source, paragraphs?}` 和 `/api/author/review {card}`，分别得到 `{candidate, diagnostics}`、`{candidate, placements}` 和 `{diagnostics}`。传入 `paragraphs` 可保留作者手动划选的段落边界。

草稿在 SQLite 中一卡一行：`GET /api/cards/:id/draft` 返回 `{card, draft}`，有草稿时返回完整草稿，否则返回完整已安装卡。`PUT` 接收 `{card}`，卡片 id 必须与 URL 一致，允许判据未完成；`DELETE` 放弃草稿。草稿重启后仍保留，不影响运行中的故事。安装成功即清草稿；HTTP 与库直接调用都校验初始状态并拒绝所有 lint error，包括空白作者文本。安装失败保留已安装卡和草稿。

模型输出契约位于 `runtime/support/workshop.ts`：compile 接收 `fields`、`actions`、`readouts`、`products`、`over`、`cap`、`slots` 和必填的 `bindings`。fiction/lore 绑定为 `{to, when}`，开场白绑定为 `{to, do}`。`roll: {judged: true}` 创建空 `judge`；输出 schema 没有正文、判据或展示标签字段。Sort 为 `{paragraphs: number[], to: string}[]`，目标是 `frame.<id>`、`fiction.<new-id>`、`greetings[n]` 或 `lore.<id>.layers[n]`。Review 固定使用 `rule: "review:consistency"` 和 `level: "warn"`。解码丢弃未声明字段；模型夹带的文本不会进入候选，已有作者文本保持原样。
