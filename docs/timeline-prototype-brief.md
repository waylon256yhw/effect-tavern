# Timeline 原型 brief（2026-10-23，给 Gemini 出 artifact demo）

和 `docs/inspector-prototype.html` 那次一样：这里只给数据、规则和约束，不给版式。要的是一个自包含的 HTML（数据内联、无依赖、无构建），桌面 1280 和手机 390 都能打开，light/dark 用 `light-dark()` 和文末的 token。文件顶部用注释写清布局算法（列怎么分配、簇怎么折叠、坐标怎么算），之后会移植到 Solid。

## 它是什么

session 的日志树整棵画出来的页面：所有线程（根）、所有分支、所有版本（兄弟）。和 Inspector 同级，是一个全幅页，从 ⋯ Session 菜单进入；Inspector 是一轮的横切面，这是整个 session 的纵切面。

两个角色，同一张图：
- 玩家的分支导航：我在哪、我试过什么别的、跳到哪一支去。
- 开发者验证 `log.ts` 的沙盘：在一个不动的坐标系上，肉眼看 head 怎么移、checkout 落在哪、drop 砍掉什么、head 落回哪。

上一版（左栏 192px 里的 git-graph 小图）失败在三处，这次的约束就是针对它们：线外节点是没有字的灰点；同深度共行、只有第一列有标签，灰点离标签比黑点还近；阅读线永远排在第一列，每次 checkout 整张图重排，所以它不是地图。

## 数据

服务端快照 `{ head, nodes }`。每个 node：

| 字段 | 含义 |
| --- | --- |
| `id` | 整数。新节点 id = 现有最大 + 1，所以子 id 大于父 id，同父兄弟按 id 升序就是版本顺序 |
| `parent` | 父 id，根为 null。同父兄弟 = 一轮的几个版本；根 = 线程（Start over 开新根） |
| `input.text` | 玩家台词；开场白节点为空 |
| `input.note` | 给叙事者的话（可无） |
| `sibling` | 产生它的动作：`null`（玩家的 act，含 Revise 后 Send 的新 act）、`swipe`（同台词重跑）、`reword`（同台词、同骰子、新正文）、`edit`（玩家改了正文或改了台词但留正文） |
| `end` | `end` 正常结束，`stopped` 中途被 Stop |
| `prose` | 正文（样例里截了 60 字） |
| `heading` | 场景名，卡没有 heading 时为空，常与上一轮相同（同一场景） |

另外可能存在 `draft { parent, input, text }`：正在写的一轮，还不是节点，正文在流式增长，失败就消失。

规模：真实故事几十到几百轮深，分叉稀疏（多数是末尾的 swipe，偶尔中游一个岔），线程一般一到三个。

## `log.ts` 的规则（demo 里 Checkout 和 Drop 要按它在本地改数据并重画）

- head 是一个叶，或 null（空线，等玩家第一句）。阅读线 = root → head 的链。
- `checkout(id)`：head 变为 id 子树里 id 最大的节点（也就是最新的叶；这是唯一的"最新"规则）。`checkout(null)`：空线。
- `drop(id)`：id 和它的子树消失。head 在其中时，落到幸存节点里 id 最大者；没有则 null。
- 节点只会落在 head 下面（act）或作为某节点的兄弟（swipe / reword / edit / Revise-Send）。没有"停在中间节点"的 head：停在中间看是阅读器的滚动位置，不是日志位置。

## 约束

1. **拓扑坐标只由 id 和 parent 决定，不读 head。** head、阅读线、draft 是叠在上面的高亮。任何 checkout / drop 之前之后，幸存节点的几何位置纹丝不动。
2. **每个节点无论在不在线上都可读**：id、轮数（深度 + 1）、成因（sibling）、玩家台词（无台词时正文首句），需要时场景名；一眼读完，不超过两行。竖向密度要紧：三百轮的故事也得能滚得动、看得清。页面用原生滚动（竖是时间，横是分支），不用拖拽平移和缩放库。
3. **簇与分叉分开**：同父、台词相同、各自没有子树的兄弟聚成一簇（version cluster），不撑宽整棵树；改了台词的兄弟、或长出了子孙的兄弟，是真分叉（branch），独立展开。样例里 2 的孩子 3、5、8、9 台词相同：3 和 5 各有子树，独立；8、9 无子树，成簇。
4. **两步**：单击任意节点 = 选中，详情栏预览它（台词、note、正文、成因、场景、它下面有几节、"Checkout 会落到 #N"），不改 head。详情栏的动作：Checkout、Open in reader、Inspect、Drop subtree（确认一次，用页面自己的 `<dialog>`，不用浏览器的）。demo 里 Checkout 和 Drop 真改本地数据并重画；Open 和 Inspect 是按钮即可。
5. **手机 390**：全幅；详情作为第二个 tab 或底部 sheet，和 Inspector 的做法一致。
6. **组件库是平台**：`<dialog>`、popover、原生滚动、CSS；不用 ReactFlow、dagre 或任何库。控件旁不放说明文字，用 aria-label 加 `data-hint`（hover 提示）；图标标 Phosphor 的名字，demo 里内联简单 SVG 即可。
7. **词汇**：Timeline、Thread（根）、Version（同父兄弟）、Branch、head、Checkout、Swipe / Reword / Edit / Revise、Stopped、Draft。

## 样例（fake 模型上长出的真实树，head = 6）

两个线程。线程 0：0 → 1 → 2 → {3 → {4, 10 reword, 11 edit}, 5 swipe → 6, 8 swipe, 9 swipe}。线程 7：7 → 12。阅读线 0 → 1 → 2 → 5 → 6。

```json
{"head":6,"nodes":[{"id":0,"parent":null,"input":{"text":"hi"},"sibling":null,"end":"end","prose":"第2段。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 2"},{"id":1,"parent":0,"input":{"text":"重写"},"sibling":null,"end":"end","prose":"第5段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 5"},{"id":2,"parent":1,"input":{"text":"我走进竹林深处，侧耳听风。"},"sibling":null,"end":"end","prose":"第6段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 6"},{"id":3,"parent":2,"input":{"text":"我拔剑，向林中暗影喝问。"},"sibling":null,"end":"end","prose":"第8段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 8"},{"id":4,"parent":3,"input":{"text":"我收剑入鞘，继续前行。"},"sibling":null,"end":"end","prose":"第10段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 10"},{"id":5,"parent":2,"input":{"text":"我拔剑，向林中暗影喝问。"},"sibling":"swipe","end":"end","prose":"第12段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 12"},{"id":6,"parent":5,"input":{"text":"我蹲下查看脚印。"},"sibling":null,"end":"end","prose":"第14段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 14"},{"id":7,"parent":null,"input":{"text":"另一个开头：我在山脚的茶棚歇脚。"},"sibling":null,"end":"end","prose":"第15段。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 15"},{"id":8,"parent":2,"input":{"text":"我拔剑，向林中暗影喝问。"},"sibling":"swipe","end":"end","prose":"第17段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 17"},{"id":9,"parent":2,"input":{"text":"我拔剑，向林中暗影喝问。"},"sibling":"swipe","end":"stopped","prose":"第19段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人","heading":"竹林深处 19"},{"id":10,"parent":3,"input":{"text":"我收剑入鞘，继续前行。","note":"更冷一些"},"sibling":"reword","end":"end","prose":"第21段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 21"},{"id":11,"parent":3,"input":{"text":"我收剑，却没有走，蹲在原地。"},"sibling":"edit","end":"end","prose":"第10段。二稿。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 21"},{"id":12,"parent":7,"input":{"text":"茶棚老板打量我的剑。"},"sibling":null,"end":"end","prose":"第22段。竹叶在风里翻了一遍又一遍，你听见远处有人踏着落叶走来。","heading":"竹林深处 22"}],"draft":{"parent":6,"input":{"text":"我顺着脚印往林子更深处走。"},"text":"第23段。脚印在一块青石前断了，"}}
```

（9 的 `end` 改成了 `stopped`，并加了一个挂在 6 下面的 draft，让 demo 把这两种状态也画出来。真实快照里 heading 每轮都变是 fake 模型的习惯，真卡上常常连着几轮同一场景。）

## Token（与 `packages/client/src/tokens.css` 一致）

```css
--surface-0: light-dark(#f9f9f7, #0b0b0b);  --surface-1: light-dark(#fcfcfb, #151515);
--surface-2: light-dark(#ffffff, #1a1a19);  --surface-3: light-dark(#ffffff, #20201f);
--ink: light-dark(#151515, #f5f5f5);  --ink-2: light-dark(#525252, #a3a3a3);  --ink-3: light-dark(#8a8a8a, #6f6f6f);
--alpha-1: light-dark(rgb(20 20 20 / 0.05), rgb(255 255 255 / 0.05));
--alpha-2: light-dark(rgb(20 20 20 / 0.1), rgb(255 255 255 / 0.09));
--alpha-3: light-dark(rgb(20 20 20 / 0.2), rgb(255 255 255 / 0.18));
--alpha-4: light-dark(rgb(20 20 20 / 0.35), rgb(255 255 255 / 0.3));
--line: var(--alpha-2);  --line-strong: var(--alpha-3);  --fill: var(--alpha-2);  --ghost-hover: var(--alpha-1);
--primary: var(--ink);  --primary-ink: var(--surface-1);
--danger: light-dark(#dc2626, #f87171);  --ok: light-dark(#1f7a3f, #4ade80);
--scrim: light-dark(rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.5));  --ring: var(--alpha-4);
--radius-sm: 4px;  --radius: 8px;  --radius-card: 12px;  --radius-dialog: 16px;  --radius-pill: 999px;
--control: 32px;  --control-sm: 24px;  --icon: 20px;  --icon-sm: 16px;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--text-caption: 0.6875rem;  --text-footnote: 0.75rem;  --text-body: 0.875rem;  --text-heading: 0.9375rem;
--text-prose: 1rem;  --text-title: 1.25rem;
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;  --space-4: 16px;  --space-5: 24px;  --space-6: 32px;
```
