# operit-deepseek-harness（社区维护补丁版）

对 Operit 插件 **`com.operit.deepseek_harness` v0.7.2** 的社区维护补丁，修掉三个会让插件「装了也用不了」的问题。

> **这不是官方仓库。** 上游作者：AAswordsman & luojiaping & 空悲切 & zjxdzh & 芸。
> 本仓库只保存**补丁与构建脚本**，原始代码全部原样保留在 `upstream/`。

---

## 这个仓库解决什么

DeepSeek Harness（DSH）是跑在本机 Linux 容器里的 AI 编程 Agent，Operit 插件把它嵌进侧边栏。在 Android + proot 环境下，官方 v0.7.2 会遇到三个叠加故障：

| 编号 | 现象 | 根因 |
|---|---|---|
| **P1** | 启用后报「DeepSeek Harness 安装失败」，退出码 20 | `pnpm-workspace.yaml` 只写了 `allowBuilds` 没有 `packages` 字段，pnpm 9 会拒绝执行**任何**命令（含 `pnpm init`） |
| **P2** | 进度卡在 **88%「正在等待 DeepSeek Harness Web 服务响应」**，一直不动 | `/usr/local/bin/node` 指向 v20；`bash -lc` 重置 PATH 后命中 v20。DSH 入口是 `if (import.meta.main) await runCli()`，`import.meta.main` 是 Node ≥22 特性，v20 下为 `undefined` → **runCli 根本不执行**，进程静默退出、日志 0 字节 |
| **P3** | 在插件里点「登录」，**Operit 整个 App 闪退** | DSH 登录按钮点击瞬间执行 `window.open("about:blank","_blank")` 预开授权页。Operit 内嵌 WebView 不允许父 WebView 承载自己的弹窗，Chromium 在主线程抛 `IllegalArgumentException` 且无人捕获 |

三条是**独立的**，修了一条不代表另两条好。本仓库三个都修。

---

## 快速使用（只想用，不想开发）

1. 下载 [`releases/com.operit.deepseek_harness-v0.7.2-operitfix1.toolpkg`](releases/)
2. 在 Operit 里导入该包，覆盖原插件
3. 重启 Operit
4. 打开侧边栏插件，等待启动（**首次启动约 55–90 秒**，见下文「耐心」）

> **首次启动很慢是正常的。** proot 下加载 600+ 个 npm 包，实测：0.2.0 时代 35 秒，0.2.1 需要 55–60 秒。插件内部等待上限是 120 秒，**判定失败前必须等满至少 90 秒**。

### 关于登录（P3 补丁后的行为）

补丁不会让「弹窗登录」变得可用——WebView 根本做不到——而是**改走降级路径**，让你不闪退。

点「登录」后你会看到一条底部提示条，而不是崩溃。此时有两条路：

**路线 A：API Key 登录（推荐，最省事）**

插件内 Web UI → Settings → Models → 选 **api-key** 方式 → 粘贴 `DEEPSEEK_API_KEY`。全程不触发任何弹窗。

**路线 B：外部浏览器登录**

登录框里点「复制链接」，把授权地址粘贴到系统浏览器（Via / 夸克等）打开完成登录。完成后回到插件内刷新即可。

> 也可以用 `http://127.0.0.1:<端口>/?token=<token>` 直接在外部浏览器打开整个 Web UI。
> 当前 token 每次重启服务都会变，最新值在运行时目录的 `deepseek-harness-web.log` 里。

---

## 仓库结构

```
operit-deepseek-harness/
├── upstream/                 # 官方 v0.7.2 原包解包树（未改动，作为补丁基线）
├── patches/                  # 4 个文件的 unified diff（人工审阅用）
├── tools/
│   ├── apply_patches.py      # 施加 P1/P2/P3 补丁（幂等、锚点严格）
│   └── build_toolpkg.py      # 从 upstream + 补丁构建 .toolpkg
├── tests/
│   ├── test_patches.py       # 主回归：补丁正确性 + 打包 + 与线上逐字节对比
│   ├── shim_behavior.mjs     # 真实执行 shim，验证 window.open 行为契约
│   └── test_mutation.py      # 变异测试：锚点缺失时必须失败，不许「装作打上」
├── releases/                 # 构建产物
└── docs/                     # 排障全过程记录
```

**为什么仓库里没有一份「已打补丁的完整代码树」？**
避免 `upstream/` 和 `patched/` 两份代码慢慢漂移，到最后没人知道线上跑的是哪一份。补丁逻辑只存在于 `apply_patches.py`，产物由 `build_toolpkg.py` 现场生成。`upstream/` 永远是干净的官方基线。

---

## 开发流程

```bash
# 1. 施加补丁到副本并构建
python3 tools/build_toolpkg.py
#    -> releases/com.operit.deepseek_harness-v0.7.2-operitfix1.toolpkg

# 2. 打补丁到已解包的插件目录（例如直接改设备上的缓存）
python3 tools/apply_patches.py /path/to/toolpkg_cache/com.operit.deepseek_harness-xxxxxxxx

# 3. 只检查不写入
python3 tools/apply_patches.py --check /path/to/dir

# 4. 跑测试
python3 tests/test_patches.py
python3 tests/test_mutation.py
node tests/shim_behavior.mjs /path/to/index.ui.js

# 5. 与线上运行中的缓存逐字节对比（真机验收）
python3 tests/test_patches.py --cache /data/data/com.ai.assistance.operit/files/toolpkg_cache/com.operit.deepseek_harness-xxxxxxxx
```

`apply_patches.py` 的设计约束：

- **幂等**：已打过会跳过，不会重复插入
- **严格**：锚点找不到直接非 0 退出，绝不「改了一半还返回成功」
- **双份**：`src/` 和 `dist/` 同步处理（插件执行 `dist`，`src` 保持可读一致）

---

## 补丁细节

### P1 — pnpm-workspace 补 `packages` 字段

文件：`dist/shared/deepseek_harness_web_runtime.js` + `src/.../deepseek_harness_web_runtime.ts`

函数 `buildPnpmBuildApprovalScript()` 生成的 yaml 从：

```yaml
allowBuilds:
  "node-pty": true
  ...
```

改为：

```yaml
packages:
  - "."
allowBuilds:
  "node-pty": true
  ...
```

`allowBuilds` 白名单 5 个包原样保留，**只是补了 `packages`**。

### P2 — 强制 node 走 /usr/bin

同一文件，函数 `buildRuntimeEnvironment()`：

```diff
-        'export PATH="$PNPM_HOME:$PATH"',
+        'export PATH="/usr/bin:$PNPM_HOME:$PATH"',
+        'export NODE=/usr/bin/node',
```

> 注意：**只改 `.bashrc` 是无效的**。`/root/.bashrc` 第 5 行有 `[ -z "$PS1" ] && return`，非交互 shell 进来就 return，后面所有 export 都被跳过。这是踩过的坑。真正彻底的做法是把 `/usr/local/bin/node` 软链改对：
> ```bash
> ln -sfn /usr/bin/node /usr/local/bin/node   # v24.22.0
> ```
> 两件事一起做才稳（软链治本，环境变量兜底）。

### P3 — 拦截 window.open 弹窗

文件：`dist/ui/deepseek_harness_dashboard/index.ui.js` + `src/.../index.ui.ts`

利用插件 UI 本来就有的 JS 注入通道 `controller.evaluateJavascript`（原本用来注入 mobile layout CSS），在 `onPageFinished` 时**先注入 shim，再注入 CSS**：

```js
void installDshPopupShim(webViewController)
    .then(() => loadMobileLayoutCss...)
```

shim 的关键设计：**返回 `null` 而不是假的 window 对象**。

DSH 侧源码（`dsh-client-ui-settings-account/lib/client.js`）：

```js
begin() {
  this.popup = window.open("about:blank", "_blank");
  if (this.popup) this.popup.opener = null;   // popup 为 null -> 跳过
}
update(view) {
  this.popup?.close();                         // ?. 短路
  if (this.popup && !this.popup.closed) this.popup.location.replace(...)  // 短路
}
```

上游注释自己写着 `blocked popups need the copy-link route`——**作者早就预料到弹窗会被拦，并预留了 copyLink 兜底**。我们只是让它真的走进那条路。

所以 shim 只做三件事：
- `window.open("about:blank")` → 直接 `return null` + 提示条
- `window.open(真实URL)` → 提示条 + 复制按钮 + 同窗口跳转尝试，`return null`
- 不修改 DSH 任何业务代码

---

## 测试

| 测试 | 覆盖 | 结果 |
|---|---|---|
| `test_patches.py` | 基线干净性、补丁正确性、注入顺序、幂等、shim 语法、全部 JS `node --check`、manifest 完整性、打包回读、与线上缓存逐字节对比 | 45/45 |
| `shim_behavior.mjs` | 用 DOM mock **真实执行** shim：返回 null、DSH 后续 `?.` 安全、提示条、复制按钮、重复注入、8 种异常输入、无 DOM 环境 | 16/16 |
| `test_mutation.py` | 人为破坏 4 个锚点 + 删文件，断言补丁器**必须失败** | 11/11 |

`shim_behavior.mjs` 是行为测试而非静态断言——静态 grep 只能证明「代码里有这几个字」，证明不了「执行时真的返回 null」。P3 修复的正确性完全取决于返回值，所以必须真跑。

`test_mutation.py` 防的是最阴的失败模式：补丁没打上却返回成功，产出一个「看起来修好了、实际没修」的包。

---

## 已知限制

1. **补丁在 `toolpkg_cache` 里，插件升级或重置会被覆盖。** 这是插件机制的固有问题。重打：`python3 tools/apply_patches.py <缓存目录>`，然后重启 Operit。

2. **本例的 node_modules 层面问题不在补丁范围内。** 排查过程中还遇到过一个独立问题：插件自动把 DSH 从 0.2.0 升到 0.2.1 后，若根 `package.json` 锁死了 `@deepseek-ai/*` 子包旧版本，会出现 `does not provide an export named 'executeSessionTitleLlm'` 之类的报错。
   **教训：不要在根 `package.json` 硬锁 `@deepseek-ai` 子包版本。** pnpm 也不会自动安装 peer 依赖，缺包要手动 `pnpm add -w`。这类问题靠改插件代码解决不了，属于运行时依赖管理，因此**没有**做成补丁。

3. **根治 P3 需要 Operit 宿主改动**，插件侧只能兜底。正确修法二选一：
   - `WebSettings.setSupportMultipleWindows(false)`
   - 实现 `WebChromeClient.onCreateWindow`

   当前 `UI.WebView` DSL 只暴露了 `javaScriptEnabled` / `domStorageEnabled` / `safeBrowsingEnabled` 等，**没有多窗口开关**。

4. **`dsh --version` 输出为空**（rc=0）是上游已知问题，不影响启动。

5. **P2 只是兜底，不是万能药。** 如果设备上 `/usr/bin/node` 本身就低于 22，环境变量改了也没用，必须换 node。补丁假设 `/usr/bin/node` 是 v22+。

---

## 版本约定

- `-operitfix1` 后缀表示这是针对 Operit/Android 环境的第三方修补版，与官方版本号区分
- 上游发布新版本时，把新包解包替换 `upstream/`，先跑 `python3 tools/apply_patches.py --check upstream` 看锚点是否还匹配：
  - 全 `already` 或 `patched` → 补丁仍然适用
  - 出现 `anchor missing` → 上游改动了相关代码，需要重新核对补丁

---

## 许可

原始代码版权归上游作者所有。本仓库的补丁脚本与文档以 MIT 发布，`upstream/` 内容沿用上游许可。
