# 设置页（Connections & Player Assets）原型与双端改造交接（2026-10-25，Issue #33）

关联 Issue：`waylon256yhw/effect-tavern#33`（Connections page: model provider wire and client, a plain access point）  
交互原型：`docs/settings-prototype.html`（单文件自包含 HTML/CSS/JS，桌面端 + 390px 移动端 + 深浅双色，可直接打开对照）

本文档记录原型阶段已敲定的前端骨架、交互规范，以及即将移交生产环境（`packages/client` Solid 2.0 + 纯 CSS Cascade Layers + `packages/server` + `packages/provider`）改造时需要一并落地的双端机制与高危点。

---

## 一、已敲定的前端设计决策

### 1. 桌面端整体布局：画布负空间 + 三张独立圆角卡片
- 严格对齐主阅读器 `packages/client/src/chrome.css` 的 `.canvas` 布局语言：
  - 底层容器为 `--surface-0` 画布（`padding: var(--space-5); gap: var(--space-5)`），占满整个视口。
  - 页面拆分为 **三张常驻展开、不做折叠动效** 的 `--surface-1` 圆角卡片（`border-radius: var(--radius-dialog)`）：
    1. **左卡（`.nav-card`，`--shadow-1`）**：四大一级分区导航（`模型服务` / `默认模型` / `提示词模板` / `玩家人设`）。
    2. **中卡（`.master-card`，`--shadow-1`）**：当前分区的实体列表（服务商列表、模板列表、人设列表）+ 顶部搜索 + 底部新建按钮。当切换到「默认模型」单页签时，网格自动收束为「左卡 + 右卡」两栏（`data-columns="two"`）。
    3. **右卡（`.detail-card`，`--shadow-2`，主视觉层级）**：当前选中项的详情与配置面板。

### 2. 自我解释性与文案克制（零散文说明、零内部路径泄露）
- **严禁散文式旁白**：不在标题旁、按钮内、表单下方或 hover tooltip 中堆砌小字号灰色解释文案；常用功能完全依靠控件形态与交互流自我解释。
- **严禁泄露内部实现命名**：界面上绝不出现 `~/.deckled`、`url.ts`、`Connection.hat`、`SessionModel.effort` 等代码路径或内部字段名。
- **术语对齐**：内部概念 `hat`（帽子）在面向用户的界面中统一命名为 **「提示词模板」**；其三个阶段槽位分别命名为：
  - `narrate.head` → **前置引导消息 (Head)**
  - `narrate.tail` → **尾部续写预填 (Tail)**
  - `review.head` → **审阅阶段引导 (Review)**

### 3. 组件多样性与有机交互（对齐 Cherry Studio 2.0 多端点架构 + 侧滑抽屉卡）
拒绝把所有设置平铺成单一的「选块（segmented pills）」或外层散乱表单，按语义使用多元原语：
- **服务商顶栏（名称原位可改 + 启停开关）**：详情卡顶栏左侧为原位可编辑的服务商名称输入框，最右侧为删除按钮与滑动 Toggle Switch（`role="switch"`）。顶栏不放单一接口协议下拉框。
- **API 地址主卡保持极简，高级项与 URL 实时解析全部收进侧滑「请求配置」抽屉卡**：
  - **外层主详情卡（`.detail-card`）**：`API 地址` 标题行显示 `API 地址` + `添加端点` 链接按钮 + 右侧当前默认路由协议标签（如 `Anthropic · 默认 (+1)`）；下方输入行仅展示当前默认协议端点的 Base URL 输入框与右侧齿轮按钮 `⚙`。**外层主卡不再展示实时解析 URL 预览或散落的高级网络项**。
  - **侧滑「请求配置」卡片（点击 `添加端点` 或 `⚙`，从 `.detail-card` 右侧 swipe 滑出悬浮圆角抽屉卡 `.side-drawer`）**：
    - 直接平铺展示我们支持的三种常用协议端点（`OpenAI`、`Anthropic`、`Gemini`），无需额外「添加端点」折叠。
    - 每个协议端点标题旁显示 `默认` 徽章或 **「设为默认」** 按钮（决定该服务商发起请求时默认路由走哪条协议端点），右侧带独立的「精确前缀」开关。
    - **我们的优化增强点**：在侧滑「请求配置」卡片内部，每个已填写的端点输入框正下方运行客户端纯函数 `packages/provider/src/url.ts`（`normalize` + `plan`），以单行等宽字体实时回显实际请求路径预览（留空的非默认端点自动隐藏预览行，不报红字错误），既保持了主界面极简，又保留了精确的网关路径回显能力；同时将认证方式、缓存有效期、网络代理、自定义请求头（`+ 添加请求头`）全部收拢在这张侧滑卡片内。
- **添加服务商（Onboarding 紧凑无折叠）**：点击中卡底部「添加服务商」弹出居中 `<dialog>` Modal，**去掉顶部的无用大头像**，「服务商名称」与「API 密钥」双栏并排，下方「端点设置」直接紧凑平铺 `OpenAI`、`Anthropic`、`Gemini` 三个端点输入框（无需「更多设置」折叠，仅在填写 URL 的端点下展示实际请求路径并可一键切换 `设为默认`），一屏完整放下无需滚动条。
- **模型标题行：同行图标点击展开搜索框（零换行重排）+ 侧滑「同步模型」卡片**：
  - **点击图标同行展开搜索（`.inline-search`）**：在 `模型` 标题行直接同行排列：`模型` + `↕`（展开/折叠全部分组按钮） + **默认收起为 28×28 放大镜图标按钮 `🔍`、点击后原位向右侧平滑展开为搜索框（`width` 过渡动效，失焦且为空或按 `Esc` 时自动收起回放大镜图标）** + 右侧合并按钮组 `[ ↻ 同步模型 | + ]`。不折出第二行搜索栏，搜索框内部使用 `--text-footnote` 字号并隐藏多余原生清除占位，确保在 `390px` 移动端展开时也完整显示「搜索模型...」绝不截断。
  - **同步模型（Fetch Models）**：点击「同步模型」从 `.detail-card` 右侧滑出悬浮圆角抽屉卡（`.side-drawer`），支持搜索过滤、按前缀分组折叠、单项 `+ / —` 增删 toggle。
- **模型分组列表（不放行内冗余 Badge）与单模型设置弹窗**：
  - **行内极简**：已添加模型按前缀分组（`<details class="m-group">`）折叠展示；**单行严禁堆放提示词模板或思考强度的 Badge**（桌面端显得莫名其妙，移动端会直接挤没模型名字），只保留分组首字母圆标 + 完整模型 ID + 右侧两个图标按钮（设置齿轮、移除 `—`）。
  - 点击齿轮弹出 **单模型设置 `<dialog>` Modal**，内部组合使用：
    - **轻量自定义下拉菜单（严禁使用原生 `<select>`）**：原生 macOS `<select>` 会触发系统 NSMenu 闪烁动画与 ~250ms 关闭延迟；原型中已用 `.c-select` 验证，生产环境中直接使用原生 `popover="auto"` + CSS Anchor Positioning（对齐 `chrome.css` 的 `.snippets` 体系）渲染瞬时开合的轻量浮层菜单（带选中 `✓` 标记），且去除厚重的 `1.5px` 深色 focus 边框，只保留 `--hairline` 细线与柔和背景过渡：
      - 双栏并排：左侧选择 **「提示词模板」**（当模板尾部以 `assistant` 结尾且当前模型关闭了预填续写时，内联弹出黄色冲突告警条），右侧选择 **「请求端点协议」**（默认跟随服务商的 `默认` 端点，也可为单个模型显式指定走 `OpenAI` / `Anthropic` / `Gemini` 端点）。
      - 单栏：选择 **「结构化输出方式」**（原生 JSON Schema / 强制 Tool 调用 / 提示词内嵌 JSON）。
    - **固定档位刻度滑条（`.effort-stepper`，5 档显式刻度节点）**：思考强度（`关闭 / 低 / 中 / 高 / 最高`）。因为思考强度不是连续模拟量，不能用普通无刻度连续滑条造成歧义，必须做成类似 Deckled 的 **带 5 个固定节点圆点 + 底部可点选档位文字** 的步进轨道滑条。
    - **双栏精确数值输入框（`.token-grid`，不用滑条）**：并排放置 **「上下文上限 (Token)」** 与 **「最大输出 (Token)」** 两个 `<input type="number" placeholder="默认">` 输入框。Token 数需要细粒度精确填写（或留空走默认），不适合用粗粒度滑条。
    - **滑动开关 `role="switch"`**：允许预填续写（Prefill）、回传历史思考过程。

---

## 二、补充确认的双端核心机制

### 1. 服务商名称随时可改 + 同一服务商名下支持多协议端点（Multi-Endpoint Provider）
- **背景与设计演进**：
  - 现代聚合型服务商与中转站（如 New API、Sub2API、OpenRouter、硅基流动）普遍采用「同一个平台 + 同一把 API Key 下同时暴露多个 API Format 后缀（`/v1/chat/completions`、`/v1/messages`、`/v1beta/models/...`）」的架构。
  - 如果把 Provider 和单一 `format` 一对一死绑（哪怕允许中途切换），既不符合聚合服务商的真实心智，也会导致同一个中转站下混用 Claude 与 GPT 时被迫拆成多个重复 Provider。
- **双端设计（对齐 Cherry Studio 2.0）**：
  - 服务端 `Provider` 结构存入 `tavern.db` 的 `provider (id text primary key, name text not null, json text not null)` 表（与 `persona`、`hat` 表结构完全同构）：
    - `id`：稳定的内部主键（供「默认模型」与「按阶段指定模型」绑定 `(providerId, modelId)` 二元组）。
    - `name`：显示名称，创建后随时可在详情卡顶栏直接改名。
    - `defaultFormat: "openai-compatible" | "anthropic" | "gemini"`：该服务商的默认路由协议（在侧滑「请求配置」抽屉卡内通过 **「设为默认」** 切换）。
    - `endpoints: Partial<Record<Format, { url: string; exactPrefix?: boolean }>>`：按协议分别维护各自的 Base URL 与精确前缀开关。
    - **请求路由规则**：当向某个模型发起请求时，优先取模型级 `model.format` 覆盖项；若未单独指定，则取服务商的 `provider.defaultFormat`，并从 `provider.endpoints[effectiveFormat]` 取出对应 URL 交由 `packages/provider/src/url.ts` 的 `plan(effectiveFormat, endpoint, model.id)` 组装最终请求。

### 2. 基于 SQLite (`tavern.db`) 的通用简单密钥库（Key Vault）
- **现状核查**：
  - 服务端 `packages/server/src/data.ts`（`tavern.db`）目前只有 `player`、`persona`、`hat`、`card`、`story`、`node`、`call` 七张表，**尚未实现任何密钥表或服务商表**；`packages/provider/src/dev.ts` 仍靠 `localAnthropicKey()` 临时从环境变量或 `~/.deckled` 读取。
- **为什么需要独立的通用密钥库表（而非仅嵌在单个 Provider JSON 里）**：
  1. **跨平台单文件自包含**：桌面端与手机单端口二进制（Termux `bun src/main.ts`）共用同一个 `tavern.db`（`node:sqlite`），手机端无 OS Keychain；密钥落在 `tavern.db` 中最干净，且卡片、人设、存档的 JSON 导出/分享从不触碰该表。
  2. **跨服务商与通用模块复用**：同一个平台（如 SiliconFlow、OpenRouter、自建网关）经常需要分别按 `anthropic` 和 `openai-compatible` 协议建多个 Provider，或未来其他通用功能也需要引用密钥。独立的密钥库表让一把密钥可以命名保存、多处复用。
  3. **前后端脱敏边界（Write-only / 掩码回显，前端不拿明文）**：
     - 所有上游请求（`compile`、`listModels`、连通性测试）全部在服务端进程内发起，**浏览器端永远不需要拿到明文 API Key**。
     - `data.ts` 新增通用表：
       ```sql
       create table if not exists secret (id text primary key, name text not null, json text not null);
       create table if not exists provider (id text primary key, name text not null, json text not null);
       ```
     - Wire 协议（`GET /secrets` 与 `GET /providers`）向前端只返回脱敏摘要 `{ id, name, type: "api_key" | "auth_token", hint: "sk-ant-****3210" }`，绝不回传明文。
     - 前端修改 Provider 的名称、URL、模型列表或参数（`PUT /providers/<id>`）时，只传递 `secretId` 引用（或仅在用户新输入明文密钥时写入/更新 `secret`），彻底避免因前端未持明文而在保存配置时冲掉已有密钥。
     - **首次启动开发种子（Dev Seed）**：当 `tavern.db` 的 `secret` / `provider` 表为空且本机存在 `~/.deckled` 或 `ANTHROPIC_API_KEY` 时，自动种入一条默认密钥与 Provider，开发零迁移成本。
  4. **前端交互（已在 `docs/settings-prototype.html` 演示）**：
     - 对齐 Cherry Studio，在服务商详情卡的「API 密钥」输入框右侧、紧挨「检测」按钮旁放置一枚钥匙图标按钮 `🔑`（`aria-label="密钥库"`）。
     - 点击 `🔑` 弹出密钥库面板：可直接点选库中已存的命名密钥（显示名称 + `sk-ant-****3210` 掩码）、将当前输入框中的新密钥存入密钥库、或删除不再使用的密钥。

---

## 三、生产环境移植高危点与工程规范（Solid 2.0 + 纯 CSS）

`packages/client` 生产环境采用 **Solid 2.0 (`solid-js: 2.0.0-rc.15`) + 零第三方 UI 组件库 + 纯原生 HTML 原语（`<dialog>`、`popover="auto"`、CSS Anchor Positioning）+ 纯 CSS Cascade Layers（`@layer tokens, components, card, user`）**。原型 HTML 为了单文件演示写了命令式 DOM 脚本，移交生产实现时需重点把控以下 4 个高危点：

### 1. 严守 Solid 2.0 声明式响应式与原生 Top-Layer 原语（零 DOM 操作、零外部 UI 库）
- **状态驱动而非命令式 DOM**：所有列表过滤、分组折叠、抽屉开合、表单联动均通过 Solid 2.0 信号/派生状态声明式驱动，不搬运原型里的 `document.getElementById` 或手动拼 HTML。
- **复用 `chrome.css` 现有原生浮层原语**：
  - **下拉菜单与密钥库弹层**：使用 HTML 原生 `popover="auto"` + CSS Anchor Positioning（对齐 `packages/client/src/chrome.css` 中的 `.snippets` / `.session .snippets`：`position-anchor: auto; position-area: bottom; width: anchor-size(width)` + `@starting-style` 过渡）。因为 `popover="auto"` 直接渲染在浏览器 Top Layer，既避免了原生 `<select>` 的系统级闪烁与延迟，也绝不会撑破父卡片或触发滚动容器重算。
  - **模态框（添加服务商、单模型设置）**：直接复用 `<dialog>` 原语（对齐 `chrome.css` 的 `.confirm` / `.sheet` 体系）。

### 2. 主页面与弹出卡片「宽度严格收齐」（严防 Scrollbar 引发宽度重绘）
- **高危现象**：当模型分组 `<details>` 展开/收起、搜索过滤结果变长/变短、或在「请求配置」抽屉里新增请求头时，一旦纵向滚动条动态出现又消失，若未锁死宽度与滚动槽位，会导致卡片内部表单与行宽度频繁横向跳动重绘。
- **生产约束**：
  1. **固定壳层 + 内部独立滚动**：主画布锁定 `height: 100dvh`，三张主卡片（`.nav-card`、`.master-card`、`.detail-card`）、右侧滑出的抽屉卡（`.side-drawer`）以及弹出 `<dialog>` 均采用「顶栏固定 + 中部滚动区 `flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden` + 底栏固定」结构。
  2. **强制预留稳定滚动槽位**：所有纵向滚动容器统一加上 `scrollbar-gutter: stable`（对齐 `packages/client/src/reader.css` 第 30 行 `.scroll { scrollbar-gutter: stable; }`），并将顶栏、滚动内容区、底栏的左右内边距与网格列宽（`minmax(0, 1fr)`）严格收齐，确保无论是否出现滚动条，内容可用宽度恒定不变。
  3. **移动端 `<dialog>` 宽度收齐**：Top Layer `<dialog>` 在手机视口下统一使用 `width: min(29rem, calc(100% - 2 * var(--space-4))); box-sizing: border-box;`（对齐 `chrome.css` 第 411 行 `.confirm`），标题栏强制 `min-width: 0; overflow: hidden; text-overflow: ellipsis`。

### 3. Scrollbar 样式严格继承主页面极简规范
- 所有滚动区域（服务商列表、详情滚动区、侧滑「请求配置 / 同步模型」抽屉、下拉菜单浮层、弹窗内容区）**严禁出现浏览器默认粗滚动条**，统一继承 `packages/client/src/reader.css`（第 33–42 行）与 `chrome.css`（第 730–737 行 `.side`、`.glance .scrolls`）已经定型的极简细滚动条规范：
  ```css
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color var(--dur-3) var(--ease);
  ```
  并在 `:hover` 时才显露柔和滑块：
  ```css
  &:hover {
    scrollbar-color: var(--alpha-2) transparent;
  }
  ```

### 4. 移动端整体骨架与边角体验对齐
- **安全区与图标顶栏**：移动端顶部导航栏保留安全区内边距（`padding-top: var(--safe-top)`，避开手机刘海与屏幕圆角拐弯处），左侧展示当前分区标题，右侧以 4 枚图标按钮切换分区。
- **边角对齐**：列表态与详情态卡片圆角、分割线（`--hairline`）、行高与按钮尺寸严格复用 `tokens.css` 变量（`--control`、`--control-sm`、`--radius`、`--radius-dialog`），保证与主阅读器视觉浑然一体。
