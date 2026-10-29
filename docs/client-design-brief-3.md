# 互动小说阅读器：第三轮（重画，2026-10-20）

设计稿：https://claude.ai/artifact/D1CiUYZ9pibP27VmE9xJuA（Design 画布，三张画板：手机阅读、手机 Record 弹层、桌面）。源文件在 `docs/client-canvas/`，画布是它的渲染。它取代 `client-shape.md` 开头那份 A / B / C 三方向稿：A 的顶部状态条放不下多项且对不齐，A 的结尾动作药丸难看，B / C 的传统语法反而正确。本轮取 C 的结构，跑在 `packages/client/src/tokens.css` 上，只有浅色一套。

## 一、定下的

**结构（C）。** 单栏。读者的话是一块 5% 灰的圆角底色，正文整行铺开不装卡片，两节之间只靠留白。桌面三张卡坐在 surface-0 画布上：左栏（标题、简介、Chapters、Pinned）、正文面板（阴影高一档，是主体）、右栏（Status 全表加本回合 Record）。分割只用凸起、留白和小灰阶，骨架不着色，一条视线最多穿过一层闭合边框。

**Record 是整页弹层，不是原位展开。** 手机上每节下面一个固定的小药丸按钮（图标加 "Record"），每节一样，不带每轮摘要；点开是遮罩加从顶部 56px 升起的整页面板，内容往下翻，Swipe / Reword / Edit 三个图标键收在底部。正文一个像素不被顶。状态在手机上是标题栏一个图标键（改了亮一个点），点开是全表，同一种弹层。

**Record 是读数面板，不是散文。** 五种元件，各对应一种数据：
- 刻度条：enum 字段。等长段，走过的段灰、本轮新到的段黑，下面标刻度名，当前加粗。
- 计量条：带 min / max 的 int，按数的含义分两种（`docs/meter-prototype.html`）。量（min ≥ 0，至多一个门槛）：深色从 min 填到当前值，本回合涨的一截接状态绿、跌的一截留淡红残影，门槛是一道刻度加数字，值和上限在右上。位（跨负区，或 fiction 变体切出两段以上）：不填充，等宽格一格一段，所在格加深，圆点标格内位置，本回合 was → now 画一段绿 / 红描边，格间标分界数字。Status 与 Record 同一张图，Record 多画变化。
- 检定条：`Action.roll` 的记录。标题行只有图标、技能名（上限 7 字、省略）、修正、结果徽章；掷出值标在轨道圆点上方，DC 标在竖线下方，难度以上淡绿。
- 场景格：三格并排，各一个图形、标签、加粗的值。
- 线索与备注：浅灰格，左侧图标，线索右侧一个 Pin 键。
唯一新颜色是状态绿 `#1f7a3f`，只用于成功 / 失败这类状态，和既有的 danger 红配对，不进品牌槽。

**Options 是容器。** 浮起的白色卡，顶部魔杖图标加 "Options" 小标，行间细线，每行序号、文字、右侧 ↵ 入框图标。点击只填输入框，从不代发。它是正文流里唯一浮起的东西：沉下去的读者那句话、无框的正文、浮起的选项，三层。

**骨架文字用英文，暂不做 i18n。** 卡的数据（字段名、章节名、场景值、正文）保持卡的语言。按 `GLOSSARY.md`：

| 骨架 | 词 | 依据 |
| --- | --- | --- |
| 每回合的附注面板 | Record | record 阶段挂在节点上的东西。不叫 Notes：产物 `notes` 与通道 `note` 已占两个名字 |
| 面板内的备注 | Notes | 产物 `notes` |
| 面板内的线索 | Clue | lore 揭示 |
| 三个兄弟动作 | Swipe / Reword / Edit | 词表名，不用 Redo / Rewrite |
| 输入通道开关 | Act / Note | 通道名；待定替代 Act / Direct |
| 回合 | Turn N · 场景名 | |
| 侧栏 | Chapters / Pinned / Status | |
| 默认状态分组 | Body / People / World / Belongings | 作者可覆盖 |
| 检定 | Success / DC | |

**两条 UI 规矩。**
1. 有既定图形的动作一律用图形加 `aria-label`，不用文字替代；控件旁不放说明性文字；入口按钮不透传每轮摘要。
2. 布局坏了先分类：数据是合法无界的（线索、备注、正文，允许折行）还是被 schema 约束的（数字、作者定义的短标签，不许折行，给上限和省略号）。被约束的数据撑坏布局是布局的错，不加宽、不折行，改排法。

## 二、工程决定

- **Base UI** 提供行为，不提供外观：Dialog（Record 弹层、状态弹层）、Menu / Popover（⋯、片段）、Toggle Group（Act / Note）、Meter（计量条的 role 与 aria）。它没有图表；刻度条、检定条是我们自己的几十行 CSS。输入框与 IME 控制器仍是我们的。装时钉版本。
- **样式分四层**，原生 `@layer tokens, components, card, user;`：默认令牌最底，组件样式只许用令牌，卡片作者带的 CSS 在上，读者自己的最上。后面的层无条件赢，不用 `!important`。一个主题就是一个 CSS 文件；设置面板将来的输出也只是它。
- **结构名是公开接口。** `.said`、`.prose`、`.record`、`.options`、`.composer` 这类名字一经承诺不随手改，需要一份名单和一条门禁，与 `test/tokens.ts` 同形。外观和结构是两条轴：结构只开几个有名字的开关（如 `data-said="block | bubble | quote"`），不给自由组合。
- **卡片带的 CSS 是不可信输入**，比读者层低一层；`url()` 泄露 IP、`@import` 拉远端，单用户先放，记下。
- **显示声明是服务端的缺口。** `Rules.Field` 只有 path / type / min / max / options / initial，够结算不够显示。缺标签、分组、单位、图标名。前端对每种形只有一个渲染器（int 带界 → 计量条，enum → 刻度条，roll → 检定条），作者选形不写组件。这层放哪、叫什么，下一个要定。

## 三、图标

旧稿与本稿的图标都是手画的内联 SVG（24 视框、1.7 描边、圆头），不是任何库。决定换成 Phosphor Icons（`@phosphor-icons/react`，regular 权重，六种权重同名可切）。对照：

| 用处 | 现在 | Phosphor |
| --- | --- | --- |
| Contents | 三横 | `List` |
| Status | 柱状 | `ChartBar` |
| More | 三点 | `DotsThree` |
| Send | 上箭头 | `ArrowUp` |
| Snippets | 加号 | `Plus` |
| Close | 叉 | `X` |
| Swipe | 循环箭头 | `ArrowClockwise` |
| Reword | 魔杖 | `MagicWand` |
| Edit | 铅笔 | `PencilSimple` |
| Record 入口 | 方框三横 | `Notepad` |
| 检定 | 骰子 | `DiceFive` |
| Pin | 图钉 | `PushPin` |
| Clue | 放大镜 | `MagnifyingGlass` |
| Notes | 书 | `BookOpen` |
| 位置 / 时间 / 天气 | 地标 / 落日 / 雨云 | `MapPin` / `SunHorizon` / `CloudRain` |
| Success | 对勾 | `Check` |
| 入框 | ↵ | `ArrowElbowDownLeft` |
| 变化方向 | 右箭头 | `ArrowRight` |

未装，等挑定。

## 四、没做的

深色套；状态全表的手机弹层（与 Record 弹层同形，内容换成右栏那张表）；等待、重写、停止状态；片段弹层；刻度名过长或刻度超过四级时的标签策略（只标当前刻度，待定）；Act / Note 与 Act / Direct 的取舍。
