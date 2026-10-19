# 排障全过程记录

真实设备：小米 Redmi / Android 13 / proot Ubuntu 容器
宿主：Operit 1.12.2（versionCode 51, targetSdk 34）
WebView：`com.google.android.webview` 155.0.8059.43
插件：`com.operit.deepseek_harness` v0.7.2
DSH：`@deepseek-ai/dsh` 0.2.1-rc.2

三次故障现象不同、根因不同，但都会被用户描述成「插件打不开」。这里按时间顺序记录证据链，方便以后遇到类似症状时快速定位。

---

## 第一轮：启用即报「安装失败」退出码 20

### 现象
插件启用后立刻弹出「DeepSeek Harness 安装失败 / runtime package initialization failed」，退出码 20。

### 取证

```bash
cat /root/sidebar_deepseek_harness/... # 发现 pnpm 阶段就挂了
```

插件 `installRuntime()` 在调用 `pnpm init` **之前**，先用 `buildPnpmBuildApprovalScript()` 写 `pnpm-workspace.yaml`。生成内容只有：

```yaml
allowBuilds:
  "node-pty": true
  ...
```

**没有 `packages` 字段。**

pnpm 9.15.9 的规则：只要 `pnpm-workspace.yaml` 存在但 `packages` 字段缺失或为空，**任何**包管理命令（包括 `pnpm init`）都直接拒绝执行：

```
ERROR packages field missing or empty
```

于是 `! pnpm init` 成立 → `runtime_fail 20`。

### 为什么之前没人发现
因为只有在「已有 pnpm-workspace.yaml 但没有 packages」这个组合下才触发。本地开发用 pnpm 8 或用 `pnpm init` 先建 workspace 都不会遇到。

### 修复
`buildPnpmBuildApprovalScript()` 的 config 数组最前面插入两行：

```js
"packages:",
'  - "."',
```

`allowBuilds` 白名单 5 个包原样保留，不起任何变化。

---

## 第二轮：三个 LLM 包 import 失败

### 现象
安装通过了，但 `dsh web` 启动打出三条 warning：

```
llm-pi-ai (@deepseek-ai/dsh-llm-pi-ai): failed to import
llm-deepseek (@deepseek-ai/dsh-llm-deepseek-api-key): failed to import
llm-deepseek-account (@deepseek-ai/dsh-llm-deepseek-account): failed to import
```

### 取证

写了个 Node 脚本直接 `import` 目标包，拿真实错误（比看 warning 文本强）：

```js
// /tmp/imp.mjs
const m = await import('@deepseek-ai/dsh-llm-pi-ai');
```

得到 `ERR_MODULE_NOT_FOUND`。然后逐层查，发现 `.pnpm` 里有**两种不同的文件损坏**：

1. `@deepseek-ai+dsh-llm-deepseek@0.2.0-rc.2_*` 目录**完全为空**（只剩空 node_modules）
2. `@deepseek-ai+dsh-llm-pi-ai@*` 的 `lib/` 目录为空（`lib/index.js` 丢失）
3. `@earendil-works/pi-ai@0.87.1` 的 `dist/auth/` 整个目录丢失

### 更早的坑：koffi 整包被 NUL 填充

更早还遇到过一次更诡异的损坏：

```
node_modules/.pnpm/koffi@3.1.1/node_modules/koffi/package.json  size=2067  内容全是 \0
```

遍历整个 koffi 目录：**80 个文件全部「size 不变、内容全零」**，包括 `index.cjs`、`index.d.ts`、`native/*.cc`。

铁证：从 registry 下载原版 `koffi-3.1.1.tgz`，解出来的 `package.json` **也是 2067 字节**。大小完全一致，说明这是**原地零填充型的文件系统损坏**，不是截断。

这条很关键：如果是截断，容易发现；原地零填充会让文件看起来「大小正常」，pnpm 的完整性校验不一定能发现。

### 修复

```bash
mv node_modules/.pnpm/koffi@3.1.1 /tmp/koffi_corrupt_bak    # 留证
pnpm add -w koffi@3.1.1
pnpm add -w @deepseek-ai/dsh-llm-deepseek@0.2.0-rc.2       # 30.7s
pnpm add -w @deepseek-ai/dsh-llm-pi-ai@0.2.0-rc.2          # 39.1s
pnpm add -w @earendil-works/pi-ai@0.87.1                   # 37s
```

### 教训
**pnpm 认为「包已存在」就不会重下。** 文件被 NUL 填充或部分丢失时，必须先手动 `mv` 掉损坏目录再 `pnpm add`，否则它会认为一切正常、什么都不做。

---

## 第三轮：卡在 88%（三次误判）

这一轮最难，因为现象（88% 不动）看起来像「服务启动慢」，实际是「进程秒退」。中间误判了两次。

### 现场取证三件套

判断「进程秒退」还是「进程慢」，看这三个一起：

| 检查项 | 秒退的特征 | 慢的特征 |
|---|---|---|
| pid 文件 | 写了 pid，但该进程已不存在 | pid 存在且进程活着 |
| 日志 | **0 字节** | 有内容或逐步增长 |
| health | `not reachable` | 最终变 `ready` |

本例三项全中「秒退」，但当时我先往「慢」的方向查了。

### 误判一：以为是 PATH 顺序问题

看到 `bash -lc` 环境下 `node -v` 是 v20，第一反应是 PATH 里 `/usr/local/bin` 排在 `/usr/bin` 前面。

于是改 `/root/.bashrc`，在末尾加 `export PATH=...`。

**验证时发现完全无效：**

```bash
$ env -i bash -lc 'node -v'
v20.18.1      # 改了 .bashrc 还是 v20
```

查 `.bashrc` 第 5 行：

```bash
[ -z "$PS1" ] && return
```

**非交互 shell 一进来就 return，后面所有 export 全部不执行。**

所以改 `.bashrc` 里的 PATH **永远无效**。这是完全白做的一轮。

> 这个坑值得单独记住：任何「改了 `.bashrc` 但 `bash -c` / `bash -lc` 不生效」的情况，先去看文件开头有没有这行 early return。

### 误判二：以为是路径顺序，其实是软链

继续查：

```bash
$ ls -l /usr/local/bin/node
lrwxrwxrwx ... /usr/local/bin/node -> /usr/local/lib/nodejs/node-v20.18.1-linux-arm64/bin/node
$ ls -l /usr/bin/node
-rwxr-xr-x ... /usr/bin/node        # v24.22.0
```

**`/usr/local/bin/node` 本身就是指向 v20 的软链接。**

而 `/usr/local/bin` 在绝大多数 PATH 里都排在 `/usr/bin` 前面。所以无论怎么调 PATH 顺序，最后都会命中这个软链——除非显式把 `/usr/bin` 插到最前面。

**是先看软链，还是先改 PATH，这个顺序决定了要绕多少弯。** 正确顺序是先 `ls -l $(command -v node)`。

### 真根因：v20 让 `runCli()` 根本不执行

为什么 v20 会导致「进程 0 退出、无日志、无监听」？

DSH 的 `@deepseek-ai/dsh/lib/bin.js` 最后一行：

```js
if (import.meta.main) await runCli();
```

`import.meta.main` 是 **Node ≥ 22** 才有的特性。v20 下它是 `undefined` → 整个 `if` 直接跳过 → `runCli()` **从未被调用** → 进程正常退出（exit code 0）、什么都不做、什么都不打印。

实测对比：
- v24：主模块执行时 `import.meta.main === true`，被 import 时 `false` → 行为正确
- v20：永远 `undefined` → 永远不执行

### 修复

```bash
ln -sfn /usr/bin/node /usr/local/bin/node    # 治本
```

验证：

```bash
$ ls -l /usr/local/bin/node
... /usr/local/bin/node -> /usr/bin/node
$ node -v
v24.22.0
$ env -i bash -lc 'node -v'
v24.22.0
$ pnpm -v
9.15.9        # 用 v24 跑 pnpm 正常
```

加上插件内 `buildRuntimeEnvironment()` 的兜底（P2 补丁），双保险。

### 修复后实测

```
PORT_UP at 35s
HTTP root = 401
warning 数 = 0
日志: dsh web: http://127.0.0.1:3081/?token=xxx
```

---

## 第四轮：重启后 88% 复发（自己埋的雷）

### 现象
上次修好了，重启 Operit 后又卡 88%。取证三件套：pid 写了但进程没了、日志 0 字节、health not reachable。

软链正常、补丁也在位。那是什么变了？

### 关键发现

运行时目录里出现了两个新文件，时间戳是重启后的：

**`operit-env.sh`**
```bash
export NODE_BIN=/usr/bin/node
export PATH=/usr/bin:$PATH
unset NODE_OPTIONS
```

**`operit-dsh.mjs`**
```js
import { runCli } from "./node_modules/@deepseek-ai/dsh/lib/bin.js";
await runCli();
```

这是**插件自己写的 node 兼容 shim**——直接 import 后手动 `await runCli()`，绕过 `import.meta.main` 判断。说明上游作者也遇到过同样的问题。

同时 `package.json` 被改写了：`@deepseek-ai/dsh` 从 `0.2.0-rc.2` 自动升到了 `0.2.1-rc.2`。

### 真根因

上一轮为了修 LLM 包丢失，我在根 `package.json` 里硬锁了版本：

```json
"@deepseek-ai/dsh-llm-deepseek": "0.2.0-rc.2",
"@deepseek-ai/dsh-llm-pi-ai": "0.2.0-rc.2"
```

DSH 升到 0.2.1 后，0.2.1 的子包 `peerDependencies` 要求 `0.2.1-rc.2`。但**根 `package.json` 的显式版本优先级高于 peer 依赖**，于是 0.2.1 的包被迫 import 0.2.0 的模块，导出对不上：

```
SyntaxError: ... does not provide an export named 'executeSessionTitleLlm'
SyntaxError: ... does not provide an export named 'catalogModelFields'
```

### 第二个坑：pnpm 不自动装 peer 依赖

即使版本对齐了，还缺包。`node_modules/@deepseek-ai/` 下**根本没有**这三个包的软链：

- `dsh-session-title-llm`
- `dsh-session-title-first-prompt-llm`
- `dsh-llm-deepseek-account`

**pnpm 不会自动安装 peerDependencies。** 必须手动 `pnpm add -w`。

### 为什么表现是「88% 卡住」而不是直接报错

这些 SyntaxError 发生在 profile 加载阶段。进程在跑、CPU 在烧，但永远到不了 listen 状态。插件等 120 秒超时 → 报 not reachable → UI 停在 88%。

实测启动耗时：

| 版本状态 | 启动耗时 |
|---|---|
| 0.2.0 干净 | 35 秒 |
| 0.2.1 + 版本错配 | 60 秒（然后失败） |
| 0.2.1 修好后 | **55 秒** |

### 88% 这个数字的来源

`dist/shared/deepseek_harness_web_runtime.js`：

```js
const STARTUP_HEALTH_WAIT_MS = 120000;   // L21

// waitForHealth() 内 L744
reportProgress(onProgress, "正在等待 DeepSeek Harness Web 服务响应", 88);
```

**88 是一个静态常量，每秒重打一次**，所以视觉上「卡住不动」。它不是真实进度。

而且每次 `readHealth()` 都会新起一个 `bash -lc` + `curl`，在 proot 下开销巨大，会**反过来拖慢**启动。这是 88% 现象的放大器。

### 修复

```bash
# 1. 版本对齐
sed -i 's/0\.2\.0-rc\.2/0.2.1-rc.2/' package.json   # 两个子包

# 2. 重装母包
pnpm add -w @deepseek-ai/dsh-llm-deepseek@0.2.1-rc.2 \
           @deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2          # 49.6s

# 3. 补装 peer 依赖（关键，pnpm 不会自动做）
pnpm add -w @deepseek-ai/dsh-session-title-llm@0.2.1-rc.2 \
           @deepseek-ai/dsh-session-title-first-prompt-llm@0.2.1-rc.2 \
           @deepseek-ai/dsh-llm-deepseek-account@0.2.1-rc.2   # 44.1s
```

实测：`READY at 55s`，日志只有一行 token URL，warning 数 0。

### 教训

**不要在根 `package.json` 硬锁 `@deepseek-ai` 子包版本。** 插件会自动升级母包，一旦锁死就是版本错配雷。宁可让 pnpm 自己解析。

---

## 第五轮：点登录 → Operit 直接闪退

### 现象
在插件侧边栏的 DSH Web UI 里点「登录」，Operit **整个 App 闪退**。

崩溃日志：`/storage/emulated/0/Download/Operit/operit_log_20261019_151141.txt`（72934 字节 / 555 行）

### 取证要点：grep 什么

**第一次 grep 用错了关键字。**

```bash
grep -nE 'FATAL|Fatal signal|SIGSEGV|SIGABRT|ANR |AndroidRuntime|OutOfMemory' log.txt
```

结果只有一条：`544: E/CrashReportActivity: Displaying crash report, chars=758`。

**换成 `Exception|CrashReportActivity` 才命中。**

另外：Operit 的日志被 Compose DSL 的 `progress dispatchAction` 刷屏，崩溃块**永远在文件末尾**，直接 `sed -n '480,555p'` 看尾部最快。

### 崩溃原文（第 546-555 行）

```
java.lang.IllegalArgumentException: Parent WebView cannot host its own popup window.
Please use WebSettings.setSupportMultipleWindows(false)
    at WV.zq.d(chromium-SystemWebViewGoogle6432.aab-stable-805904303:3)
    at com.android.webview.chromium.s0.handleMessage(...:52)
    at android.os.Handler.dispatchMessage(Handler.java:106)
    at android.os.Looper.loopOnce(Looper.java:210)
    at android.os.Looper.loop(Looper.java:299)
    at android.app.ActivityThread.main(ActivityThread.java:8247)
    at com.android.internal.os.RuntimeInit$MethodAndArgsCaller.run(...:559)
    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:954)
```

**关键判据：栈里没有一行插件 JS 代码，全是 chromium / Handler / Looper。**

这说明崩溃发生在 **Java 层主线程**，不是插件 JS 抛的异常。JS 侧的 try/catch **根本拦不住**。

### 触发源码

```bash
# 在 dsh 的前端包里搜 window.open
grep -rl 'window.open' node_modules/.pnpm/@deepseek-ai+dsh-client-ui-settings-account*
```

命中 `lib/client.js`，offset 40250：

```js
/** Preopen a tab during the user's click; blocked popups need the copy-link route. */
begin() {
  this.dispose();
  this.popup = window.open("about:blank", "_blank");   // ← 就是这行
  if (this.popup) this.popup.opener = null;
}
```

**注意注释：`blocked popups need the copy-link route`。**

上游作者**早就预料到弹窗会被拦**，并预留了 `copyLink` 兜底：

```js
const copyLink = async (authorizeUrl) => {
  await navigator.clipboard.writeText(authorizeUrlWithTheme(authorizeUrl, colorScheme));
  setCopyResult({ messageKey: "copiedLink" });
};
```

### 为什么必崩

1. 弹窗请求由 WebView Chromium 在**主线程 Handler** 的 `handleMessage` 里派发
2. 该 WebView 的父容器无法承载子窗口 → Chromium 校验失败 → 直接 `throw IllegalArgumentException`
3. 异常在 `Looper.loopOnce` 里无人捕获 → 主线程崩溃 → App 闪退

**这跟「用 try/catch 包住 window.open」完全无关**——异常在 Java 层，JS 抓不到。

### 修复思路

插件 UI 本来就有 JS 注入通道（原本用来注入 mobile layout CSS）：

```js
await controller.evaluateJavascript(script);
```

复用它，在 `onPageFinished` 时注入 `window.open` 的覆盖 shim。

**核心设计：返回 `null` 而不是假的 window 对象。**

因为 DSH 后续代码是：

```js
this.popup?.close();                                    // ?. 短路
this.popup.location.replace(...)  // 前面有 if (this.popup && ...) 保护
```

返回 `null` → 所有 `?.` 全部短路 → 不报错 → 走 copyLink 降级路径。

如果返回一个假对象（看似更「友好」），后续 `popup.location.replace()` 会访问不存在的属性，反而可能抛新异常。

### 修复后的行为

- 点「登录」→ 底部出现提示条，说明 WebView 不支持弹窗
- 提示条提供：授权链接、复制按钮
- 不闪退

用户此时可以：
- **路线 A**：Settings → Models → api-key 方式，粘 `DEEPSEEK_API_KEY`（全程无弹窗）
- **路线 B**：复制授权链接 → 粘到系统浏览器（Via / 夸克）完成登录

### 顺带验证：外部浏览器可用

```bash
# proot 内
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3081/
401                                        # 需要鉴权，正常

# Android 侧（关键，证明外部浏览器能直连）
$ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3081/?token=xxx"
303                                        # 通过
```

设备已装浏览器：`mark.via`（Via）、`com.quark.clouddrive`（夸克）、`com.android.browser`。

所以 `http://127.0.0.1:3081/?token=<token>` 粘到外部浏览器即可完整使用 Web UI。

### 登录前的凭据状态

`/root/sidebar_deepseek_harness/dsh-home/.credentials.yaml`（223 字节）只有：

```yaml
version: ...
records:
  client-connection/browser-session:
    kind: ...
    payload: {version, secret}
refs:
  DEEPSEEK_API_KEY: ...
```

`browser-session` 只是占位，说明登录并未完成。

---

## 环境备忘（下次直接用）

### 插件与运行时路径

```
toolpkg 缓存：/data/data/com.ai.assistance.operit/files/toolpkg_cache/com.operit.deepseek_harness-<hash>/
运行时目录：  /root/sidebar_deepseek_harness
DSH_HOME：    /root/sidebar_deepseek_harness/dsh-home
日志：        /root/sidebar_deepseek_harness/deepseek-harness-web.log
健康文件：    /root/sidebar_deepseek_harness/operit-health.json
```

### 启动命令模板

```bash
OPERIT_DSH_PROCESS_MARKER=operit_deepseek_harness_web \
  setsid nohup ./node_modules/.bin/dsh web \
  --host 127.0.0.1 --port 3081 --trusted-host 127.0.0.1:3081 --no-open \
  >> deepseek-harness-web.log 2>&1 &
```

### 安全操作约束

**这一条是用整机 OOM 换来的：**

- **绝不并发起多个 `dsh web` 探测进程。** 每个加载 600+ 包、数百 MB。曾因连开多个把用户手机直接卡死。
- 每次启动必须：`setsid` + `timeout -s KILL N` + 记 PID + 结束立即 `pkill`
- 排查完必须清理残留：`ps -ef | grep proot`，曾残留 7 个 proot 会话占 500MB+
- **判定启动失败最短等待 90 秒**（0.2.1 需要 55-60 秒，插件上限 120 秒）

### 跨系统路径陷阱

**proot 的 `/tmp` 和 Android 的 `/tmp` 不是同一个。** proot 里写 `/tmp/x`，Android shell 看不见；反之亦然。

- 备份要写 `/storage/emulated/0/Download/Operit/backup/`（持久目录）
- **绝不能写 `cleanOnExit/`** —— 目录名就是「退出即清理」，实测 2 分钟后备份无痕消失
- Android 侧读 proot 文件需走完整路径：
  `/data/data/com.ai.assistance.operit/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/tmp/...`

### 日志缓冲

重定向到文件时 stdout 是**块缓冲**，日志长时间 0 字节不代表没输出。要实时看用 `fs.writeSync(2, ...)` 写 stderr。

### 调试手段：NODE_OPTIONS 打点

想定位「进程活着但不监听」，用 `NODE_OPTIONS` 预加载钩子：

```bash
NODE_OPTIONS='--require /tmp/hook.cjs' node ...
```

`hook.cjs` 里 hook `net.Server.prototype.listen`，打印时间戳。本次实测到 `LISTEN called: [3081, "127.0.0.1"]` 出现在 **43.4~47.1 秒**，证明「不是死锁，只是慢」。

---

## 三轮根因串联

```
第一轮  pnpm-workspace.yaml 缺 packages       → runtime_fail 20（装不上）
第二轮  koffi 整包 NUL + 3 个 LLM 包文件丢失   → import 失败（装上了跑不起来）
第三轮  /usr/local/bin/node 软链指向 v20      → import.meta.main 为 undefined（88% 卡死）
第四轮  根 package.json 锁死子包 + peer 缺失   → 版本错配（重启后 88% 复发）
第五轮  WebView 弹窗 window.open              → IllegalArgumentException（点登录闪退）
```

**每一轮都缺一不可，但每轮的修复都不会自动覆盖其他轮。** 所以插件升级/重置后，前四轮的问题可能重新出现，第五轮补丁也会被覆盖。

本仓库的 `apply_patches.py` 覆盖的是 P1（第一轮）、P2（第三轮兜底）、P3（第五轮）。第二轮和第四轮属于 `node_modules` 运行时依赖问题，改插件代码解决不了，见 README「已知限制」。