# Changelog

本仓库对 `com.operit.deepseek_harness` 的补丁记录。
版本号规则：`<上游版本>-operitfix<N>`，N 从 1 开始递增。

---

## [0.7.2-operitfix1] - 2026-10-19

基于官方 `com.operit.deepseek_harness` v0.7.2。

### 修复

**P1 — pnpm-workspace 缺 `packages` 字段导致安装失败（退出码 20）**

`buildPnpmBuildApprovalScript()` 生成的 `pnpm-workspace.yaml` 只有 `allowBuilds`，
缺 `packages`。pnpm 9 只要看到该文件存在但 `packages` 为空，就拒绝执行**任何**
命令（包括 `pnpm init`），于是插件报 `runtime_fail 20`。

修复：config 数组最前面补 `packages:` 与 `  - "."`，`allowBuilds` 白名单 5 个包原样保留。

文件：
- `dist/shared/deepseek_harness_web_runtime.js`
- `src/shared/deepseek_harness_web_runtime.ts`

---

**P2 — node 解析到 v20 导致静默退出（卡 88%）**

DSH 入口 `@deepseek-ai/dsh/lib/bin.js` 末行是 `if (import.meta.main) await runCli();`。
`import.meta.main` 是 Node ≥22 特性，v20 下为 `undefined`，`runCli()` 从不执行，
进程 0 退出、不监听、日志 0 字节，插件等 120 秒超时后报 88%。

根因是 `/usr/local/bin/node` 软链指向 v20 目录，而 `/usr/local/bin` 在 PATH 里
优先于 `/usr/bin`。

修复（两层）：
1. **环境层（本补丁）**：`buildRuntimeEnvironment()` 里把 `/usr/bin` 前置到 PATH，
   并显式 `export NODE=/usr/bin/node`
2. **系统层（需手动做一次）**：`ln -sfn /usr/bin/node /usr/local/bin/node`

> 只改 `/root/.bashrc` 无效：第 5 行 `[ -z "$PS1" ] && return` 会让非交互 shell
> 直接 return，后续 export 全部跳过。

文件：同 P1。

---

**P3 — 点登录触发 WebView 弹窗导致 Operit 闪退**

DSH 登录按钮点击瞬间执行 `window.open("about:blank", "_blank")` 预开授权页。
Operit 内嵌 WebView 不允许父 WebView 承载自己的弹窗，Chromium 在主线程
`handleMessage` 里抛 `IllegalArgumentException`，`Looper.loopOnce` 无人捕获 →
App 闪退。栈里没有任何插件 JS 帧，属 Java 层崩溃，JS 侧 try/catch 无法拦截。

修复：复用插件 UI 已有的 `controller.evaluateJavascript` 注入通道（原本用于
注入 mobile layout CSS），在 `onPageFinished` 时**先注入 shim 再注入 CSS**。

shim 覆盖 `window.open`，**返回 `null`**（而非假 window 对象），使 DSH 侧
`this.popup?.close()` / `if (this.popup && ...)` 全部短路，从而走上游预留的
`copyLink` 降级路径：
- `window.open("about:blank")` → `return null` + 底部提示条
- `window.open(真实 URL)` → 提示条 + 复制按钮 + 同窗口跳转尝试，`return null`

文件：
- `dist/ui/deepseek_harness_dashboard/index.ui.js`
- `src/ui/deepseek_harness_dashboard/index.ui.ts`

---

### 新增

- `tools/apply_patches.py` — 幂等、锚点严格的补丁器，支持 `--check` 干跑
- `tools/build_toolpkg.py` — 从 `upstream/` + 补丁构建 `.toolpkg`
- `tests/test_patches.py` — 45 项回归（含与线上运行缓存逐字节对比）
- `tests/shim_behavior.mjs` — 用 DOM mock 真实执行 shim，16 项行为断言
- `tests/test_mutation.py` — 11 项变异测试，确保锚点缺失时补丁器必须失败
- `docs/TROUBLESHOOTING.md` — 五轮排障全过程与证据链
- `patches/` — 4 个文件的 unified diff，供人工审阅

### 验证

| 项目 | 结果 |
|---|---|
| `test_patches.py` | 45/45 通过 |
| `shim_behavior.mjs` | 16/16 通过 |
| `test_mutation.py` | 11/11 通过 |
| 全部 JS `node --check` | 10/10 通过 |
| 构建产物 vs 线上运行缓存 | 25 个文件**逐字节一致** |
| DSH 服务健康 | `{"ok":true,"statusCode":303,"message":"ready"}` |

### 未包含（不属于插件代码问题）

- **`node_modules` 文件损坏**（koffi 整包 NUL 填充、LLM 包文件丢失）：属运行时依赖
  损坏，需手动 `pnpm add -w` 重装
- **`@deepseek-ai` 子包版本错配**：不要在根 `package.json` 硬锁子包版本；pnpm 不会
  自动安装 peerDependencies，缺包需手动补装
- **根治 P3 需要 Operit 宿主改动**：`WebSettings.setSupportMultipleWindows(false)`
  或实现 `WebChromeClient.onCreateWindow`。当前 `UI.WebView` DSL 未暴露该开关

---

## 已知上游问题（非本仓库引入）

- `dsh --version` 输出为空（rc=0），不影响 `dsh web` 启动
- 88% 进度值是 `reportProgress(..., 88)` 的静态常量，每秒重打，不代表真实进度
- `waitForHealth()` 每轮都新起 `bash -lc` + `curl`，proot 下开销大，会拖慢启动