# 类型检查器实测：tsc 7.0.2、tsc 7.1 beta、tsrs、bun check

2026-10-27。问题：`verify` 里的 `tsc` 能不能换成更快的检查器。候选三个，基准是各包当时钉的 `typescript@7.0.2`（微软的 Go 版 tsc）：

- **tsc 7.1.0-beta**：微软下一版，同一条 Go 线。
- **tsrs 0.20.0-ts7.1.0-beta**：`oxc-project/tsrs`（Boshen），TypeScript 7.1 beta 的 Rust 移植，命令行同 tsc，多一个 `--fast`（"可能偏离钉住的 TypeScript 行为"）。npm 包名是 `tsrs`，不是 `ts-rs`；这条版本线从 2026-10-10 开始发。
- **bun check**：Bun 1.4.4 内建，读最近的 tsconfig.json，"报与 tsc 相同的错误，用全部 CPU 核"；`--threads` 控线程。帮助里不写对齐的 TypeScript 版本。

## 0. 结论

**四个对我们的代码报的东西一致；bun check 最快，tsrs 最省内存，tsc 7.1 beta 只比 7.0.2 好一两成。** 同为 7.1 beta，Rust 移植比 Go 版快约 2 倍、内存约一半，差距是移植本身，不是版本。bun check 的领先来自多线程，单线程时比 tsrs 慢。

据此 `verify` 换成了 `bun check`：零新依赖（Bun 本来就是运行时），不用钉 beta，不用 `minimumReleaseAgeExclude`。`typescript` 依赖留着，编辑器的 tsserver 要它。绝对值都在 0.25 秒以内，省下的时间在整轮 verify 里不显眼；手机上内存更有意义。

## 1. 正确性

- 四个包（client、provider、runtime、server）在四个检查器下全部零错误。
- 在 `runtime/src/card.ts` 末尾加 `const __x: number = "no"`，四个都报 `src/card.ts(255,7): error TS2322: Type 'string' is not assignable to type 'number'.`，行列一致。
- tsconfig 没开 incremental，没有 tsbuildinfo，测到的不是缓存。`skipLibCheck: true`，所以 runtime 的 43 万行（563 个文件）大多是只绑定不检查的 .d.ts，这是绝对时间这么短的原因。

## 2. 数字

macOS，Apple Silicon，`/usr/bin/time -l`，每格跑 6 次丢掉第一次，取 5 次的中位数；墙钟 / 峰值 RSS。

| 包       | tsc 7.0.2      | tsc 7.1 beta   | tsrs           | bun check      | bun check 单线程 |
| -------- | -------------- | -------------- | -------------- | -------------- | ---------------- |
| client   | 0.24s / 445 MB | 0.22s / 353 MB | 0.09s / 175 MB | 0.06s / 219 MB | 0.17s / 160 MB   |
| provider | 0.12s / 227 MB | 0.10s / 178 MB | 0.06s / 99 MB  | 0.03s / 150 MB | 0.07s / 102 MB   |
| runtime  | 0.16s / 313 MB | 0.13s / 239 MB | 0.07s / 123 MB | 0.04s / 167 MB | 0.10s / 117 MB   |
| server   | 0.17s / 311 MB | 0.13s / 242 MB | 0.07s / 126 MB | 0.04s / 168 MB | 0.10s / 120 MB   |

`tsrs --fast` 另测过一轮，比默认快约一成（client 0.08s / 156 MB），不值得换行为偏差。

runtime 的 `--extendedDiagnostics`：tsrs 检查 0.026s、总 0.045s、内存 127 MB；tsc 7.0.2 检查 0.081s、总 0.133s、内存 253 MB。`bun check --timing`：563 个文件加载 15.9ms，39 个检查 16.3ms。

## 3. 复测

候选装在临时目录，不进仓库：`npm i tsrs@<ver> --min-release-age=0`、`npm i typescript@7.1.0-beta --min-release-age=0`。在每个包目录里跑 `tsc`、`<dir>/node_modules/.bin/tsrs`、`bun check --no-script`（有 `check` 脚本时 bun check 会改跑脚本，`--no-script` 关掉）。
