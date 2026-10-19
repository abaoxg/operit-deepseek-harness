"use strict";
/* METADATA
{
  "name": "dsh_subagent",
  "display_name": {
    "zh": "DSH Sub-Agent",
    "en": "DSH Sub-Agent"
  },
  "description": {
    "zh": "把 DeepSeek Harness（DSH）作为独立 sub-agent 调用：将子任务委托给全新的 DSH headless 会话执行并返回最终答案。默认使用 workspace-write 权限、同步等待和受限运行时长；任务文件仅保存在 Linux 私有目录。支持显式异步、自定义工作目录、任务管理与取消。凭据由 DSH 原生 Web UI 管理，本包不读取密钥。",
    "en": "Invoke DeepSeek Harness (DSH) as an independent sub-agent and return its final answer. It defaults to workspace-write permissions, bounded synchronous execution, and a Linux-private task directory. Explicit async mode, custom working directories, task management, and cancellation are supported. Credentials stay in the native DSH Web UI; this package never reads secrets."
  },
  "enabled_by_default": false,
  "category": "AI",
  "tools": [
    {
      "name": "dsh_subagent_run",
      "description": {
        "zh": "【核心】把一个任务委托给 DSH headless sub-agent。默认 mode=sync，等待并返回最终答案；只有显式传 mode=async 才在后台运行并立即返回 taskId。两种模式都受 timeoutMs 硬性运行时限约束。DSH 固定使用 workspace-write：写入限制在 cwd 与临时目录，但读取、网络和进程可见性不受该模式限制。cwd 默认 /root/dsh_workspace，且不能是 / 或 /root。同一 cwd 同时只允许一个任务；并行任务必须使用不同 cwd。任务输入、日志和状态保存在仅当前 Linux 用户可访问的私有目录。",
        "en": "[Core] Delegate one task to a DSH headless sub-agent. mode defaults to sync and returns the final answer; background execution only occurs when mode=async is explicitly selected. timeoutMs is a hard runtime limit in both modes. DSH is fixed to workspace-write: writes are restricted to cwd and temporary roots, while reads, network access, and process visibility are not confined by that mode. cwd defaults to /root/dsh_workspace and cannot be / or /root. Only one task may run per cwd; parallel tasks require distinct directories. Inputs, logs, and state stay in a Linux-private directory."
      },
      "parameters": [
        {
          "name": "task",
          "description": { "zh": "交给 sub-agent 的任务描述（自然语言，越具体越好）", "en": "Task description for the sub-agent (natural language, the more specific the better)" },
          "type": "string",
          "required": true
        },
        {
          "name": "cwd",
          "description": { "zh": "sub-agent 工作目录（默认 /root/dsh_workspace；必须是绝对路径，且不能是 / 或 /root）", "en": "Sub-agent working directory (default /root/dsh_workspace; must be an absolute path and cannot be / or /root)" },
          "type": "string",
          "required": false
        },
        {
          "name": "model",
          "description": { "zh": "可选模型名，并写入任务元数据与 DSH_MODEL 环境变量", "en": "Optional model name, recorded in task metadata and exported as DSH_MODEL" },
          "type": "string",
          "required": false
        },
        {
          "name": "reasoningEffort",
          "description": { "zh": "可选推理强度：low、medium 或 high，并写入任务元数据与 DSH_REASONING_EFFORT 环境变量", "en": "Optional reasoning effort: low, medium, or high; recorded in task metadata and exported as DSH_REASONING_EFFORT" },
          "type": "string",
          "required": false
        },
        {
          "name": "mode",
          "description": { "zh": "sync=等待最终答案（默认）；async=显式后台运行并立即返回 taskId", "en": "sync=wait for the final answer (default); async=explicit background execution returning taskId immediately" },
          "type": "string",
          "required": false
        },
        {
          "name": "timeoutMs",
          "description": { "zh": "任务硬性运行时限（毫秒，默认 300000，范围 10000~3600000；sync/async 均生效）", "en": "Hard task runtime limit in milliseconds (default 300000, range 10000-3600000; applies to sync and async)" },
          "type": "string",
          "required": false
        },
        {
          "name": "maxOutputChars",
          "description": { "zh": "sync 模式返回结果最大字符数（默认 40000）", "en": "Max chars of sync result (default 40000)" },
          "type": "string",
          "required": false
        },
        {
          "name": "preset",
          "description": { "zh": "agent 模式：standard=标准（默认，完整工具）/ code=PTC（TypeScript 程序组合）/ minimal=极简（仅 bash+str_replace_editor，省 token）/ cordis=创造（运行时检查/插件实验）", "en": "Agent preset: standard=full (default) / code=PTC (TypeScript composition) / minimal=bash+str_replace_editor only (saves tokens) / cordis=runtime inspection/plugin experiments" },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "dsh_subagent_status",
      "description": {
        "zh": "查询 sub-agent 实时状态：进程状态（running/done/failed/cancelled/timeout）+ 会话解析（steps/turns、工具调用次数与最近调用、tokens 与缓存命中率、错误列表、当前正在干什么、最终答案）。",
        "en": "Query live sub-agent status: process state (running/done/failed/cancelled/timeout) plus session analysis (steps/turns, tool calls, tokens, cache hit rate, errors, current activity, and final answer)."
      },
      "parameters": [
        {
          "name": "taskId",
          "description": { "zh": "任务 ID（dsh_subagent_run 返回）", "en": "Task ID (returned by dsh_subagent_run)" },
          "type": "string",
          "required": true
        },
        {
          "name": "tailChars",
          "description": { "zh": "返回进程日志尾部字符数（默认 20000）", "en": "Chars of process log tail to return (default 20000)" },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "dsh_subagent_watch",
      "description": {
        "zh": "等待 sub-agent 任务到终态（阻塞等待，AI 无需自行轮询）：调用后一直等到任务完成/失败/取消，直接返回完整结果（含最终答案与日志尾部）。silent 默认 true：等待过程不推送进度，终态一次性返回；silent=false 则等待期间推送活动变化。超过 timeoutMs 仍未完成时同样直接返回（附当前状态快照与继续/取消提示），不无限阻塞。",
        "en": "Block until a sub-agent task reaches a terminal state (no manual polling needed): waits until done/failed/cancelled and returns the full result (final answer + log tail) in one shot. silent defaults to true (no progress push, single final return); set silent=false to push activity changes while waiting. If timeoutMs is exceeded it also returns directly (with a current-state snapshot and continue/cancel hints), never blocks forever."
      },
      "parameters": [
        {
          "name": "taskId",
          "description": { "zh": "任务 ID", "en": "Task ID" },
          "type": "string",
          "required": true
        },
        {
          "name": "timeoutMs",
          "description": { "zh": "最大等待毫秒（默认 600000=10 分钟；超时也会直接返回，任务仍在后台）", "en": "Max wait ms (default 600000=10min; on timeout it returns anyway, task keeps running in background)" },
          "type": "string",
          "required": false
        },
        {
          "name": "intervalMs",
          "description": { "zh": "轮询间隔毫秒（默认 5000）", "en": "Poll interval ms (default 5000)" },
          "type": "string",
          "required": false
        },
        {
          "name": "silent",
          "description": { "zh": "true=静默等待一次性返回（默认）；false=等待期间推送活动进度", "en": "true=silent wait, single final return (default); false=push activity progress while waiting" },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "dsh_subagent_panel",
      "description": {
        "zh": "生成全量实时状态（供工作区预览页/面板）：汇总所有 agent 任务，并将 state.json 保存在 Linux 私有任务目录。仅当显式传入 workspace 时，才把可能含任务活动与答案的 dsh-state.json 写入该工作区供预览页轮询。",
        "en": "Generate full live state for the preview panel and keep state.json in the Linux-private task directory. Only when workspace is explicitly supplied is dsh-state.json, which may include task activity and answers, written to that workspace for preview polling."
      },
      "parameters": [
        {
          "name": "workspace",
          "description": { "zh": "可选：工作区根路径（如 <workspace-root>，Operit 当前工作区目录），同步写 dsh-state.json", "en": "Optional: workspace root path (e.g. <workspace-root>, the active Operit workspace dir), also writes dsh-state.json there" },
          "type": "string",
          "required": false
        }
      ]
    },
    {
      "name": "dsh_subagent_cleanup",
      "description": {
        "zh": "清理已结束的 Sub-Agent 任务记录、日志和对应的已结束 DSH 会话；运行中的任务会保留。",
        "en": "Remove terminal Sub-Agent task records, logs, and their finished DSH sessions; running tasks are preserved."
      },
      "parameters": []
    },
    {
      "name": "dsh_subagent_list",
      "description": {
        "zh": "列出所有 sub-agent 任务（含运行中与历史）：taskId/状态/启动时间/摘要。",
        "en": "List all sub-agent tasks (running and history): taskId/status/start time/summary."
      },
      "parameters": []
    },
    {
      "name": "dsh_subagent_cancel",
      "description": {
        "zh": "取消运行中的 sub-agent 任务（kill 进程）。",
        "en": "Cancel a running sub-agent task (kills the process)."
      },
      "parameters": [
        {
          "name": "taskId",
          "description": { "zh": "要取消的任务 ID", "en": "Task ID to cancel" },
          "type": "string",
          "required": true
        }
      ]
    }
  ]
}
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.dsh_subagent_run = dsh_subagent_run;
exports.dsh_subagent_status = dsh_subagent_status;
exports.dsh_subagent_watch = dsh_subagent_watch;
exports.dsh_subagent_panel = dsh_subagent_panel;
exports.dsh_subagent_cleanup = dsh_subagent_cleanup;
exports.dsh_subagent_list = dsh_subagent_list;
exports.dsh_subagent_cancel = dsh_subagent_cancel;
// ============ 环境常量（与 shared/deepseek_harness_web_runtime.ts 一致） ============
const DSH_HOME = "/root/sidebar_deepseek_harness/dsh-home";
const DSH_BIN = "/root/sidebar_deepseek_harness/node_modules/.bin/dsh";
const DSH_SESSIONS_ROOT = "/root/sidebar_deepseek_harness/dsh-home/sessions";
const DEFAULT_CWD = "/root/dsh_workspace";
const JOBS_DIR_LINUX = "/root/sidebar_deepseek_harness/subagent-jobs";
const PARSE_PY = JOBS_DIR_LINUX + "/parse_session.py";
const STATE_JSON = JOBS_DIR_LINUX + "/state.json";
const DEFAULT_TIMEOUT_MS = 300000;
const MAX_TIMEOUT_MS = 3600000;
const DEFAULT_OUTPUT_CHARS = 40000;
/** 运行时脚本自举部署：解析器、Zstd 解码器和 watcher 缺失或版本旧时自动写入
 *  （脚本内容内嵌于本包，保证任何机器安装后开箱即用）。 */
const dsh_scripts_1 = require("../shared/dsh_scripts");
async function ensureWatcher() {
    return withRunLock("watcher", async () => {
        try {
            const pidRaw = (await readLinuxFile(JOBS_DIR_LINUX + "/watch.pid", "")).trim();
            if (pidRaw) {
                const alive = await execInTerminal("kill -0 " + pidRaw + " 2>/dev/null && grep -q 'dsh_watch.py' /proc/" + pidRaw + "/cmdline 2>/dev/null && echo ALIVE || echo DEAD", 10000);
                if (String(alive?.output || "").includes("ALIVE")) {
                    return;
                }
            }
            const workspace = (await readLinuxFile(JOBS_DIR_LINUX + "/watch_workspace.txt", "")).trim();
            const workspaceEnv = workspace ? "DSH_WATCH_WORKSPACE=" + shellQuote(workspace) + " " : "";
            const command = "cd " + shellQuote(JOBS_DIR_LINUX) + " && " + workspaceEnv +
                "nohup python3 dsh_watch.py > watch.log 2>&1 < /dev/null &";
            await execInTerminal(command, 15000);
        }
        catch (e) { /* watcher 自愈失败不阻断主工具 */ }
    });
}
async function ensureScripts() {
    try {
        await ensureJobsDirs();
        const checkAndWrite = async (name, content) => {
            const linuxPath = JOBS_DIR_LINUX + "/" + name;
            const head = await readLinuxFile(linuxPath, "");
            if (!head.includes("dsh-script: " + dsh_scripts_1.SCRIPTS_VERSION)) {
                await writeLinuxFile(linuxPath, content);
            }
        };
        await checkAndWrite("decode_zstd.cjs", dsh_scripts_1.DSH_ZSTD_DECODE_JS);
        await checkAndWrite("parse_session.py", dsh_scripts_1.PARSE_SESSION_PY);
        await checkAndWrite("dsh_watch.py", dsh_scripts_1.DSH_WATCH_PY);
        await ensureWatcher();
    }

    catch (e) { /* 自举失败不阻断主流程 */ }
}
const DEFAULT_TAIL_CHARS = 20000;
let cachedSessionId = null;
async function getSession() {
    if (cachedSessionId)
        return cachedSessionId;
    const session = await Tools.System.terminal.create("dsh_subagent_session");
    const sid = typeof session === "string" ? session : String(session?.sessionId || session);
    cachedSessionId = sid;
    return sid;
}
async function execInTerminal(command, timeoutMs) {
    const sessionId = await getSession();
    let streamedOutput = "";
    const result = await Tools.System.terminal.execStreaming(sessionId, command, {
        timeoutMs,
        onIntermediateResult: (event) => {
            if (event.type === "chunk" && event.chunk !== null && event.chunk !== undefined) {
                streamedOutput += String(event.chunk);
            }
        },
    });
    const finalOutput = typeof result?.output === "string"
        ? result.output
        : typeof result?.content === "string"
            ? result.content
            : "";
    if (streamedOutput && !finalOutput) {
        return { ...(result ?? {}), output: streamedOutput };
    }
    return result;
}
function newTaskId() {
    return "dsh-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
}
function safeTaskId(value) {
    const taskId = String(value || "").trim();
    if (!/^dsh-[a-z0-9]+-[a-z0-9]+$/.test(taskId)) {
        throw new Error("taskId 格式无效");
    }
    return taskId;
}
function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}
function parseInteger(value, fallback, minimum, maximum, name) {
    if (value === undefined || value === null || String(value).trim() === "")
        return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(name + " 必须是 " + minimum + " 到 " + maximum + " 之间的整数");
    }
    return parsed;
}
function parseMode(value) {
    const mode = value === undefined || value === null || String(value).trim() === ""
        ? "sync" : String(value).trim();
    if (mode !== "sync" && mode !== "async") {
        throw new Error("mode 仅支持 sync 或 async");
    }
    return mode;
}
function parsePreset(value) {
    if (value === undefined || value === null || String(value).trim() === "")
        return undefined;
    const preset = String(value).trim();
    if (!["standard", "code", "minimal", "cordis"].includes(preset)) {
        throw new Error("preset 仅支持 standard、code、minimal 或 cordis");
    }
    return preset;
}
function parseOptionalString(value, name, maximum) {
    if (value === undefined || value === null || String(value).trim() === "")
        return undefined;
    const parsed = String(value).trim();
    if (parsed.length > maximum || /[\0\r\n]/.test(parsed)) {
        throw new Error(name + " 长度或字符格式无效");
    }
    return parsed;
}
function parseModel(value) {
    return parseOptionalString(value, "model", 128);
}
function parseReasoningEffort(value) {
    const effort = parseOptionalString(value, "reasoningEffort", 16);
    if (effort === undefined)
        return undefined;
    if (!["low", "medium", "high"].includes(effort)) {
        throw new Error("reasoningEffort 仅支持 low、medium 或 high");
    }
    return effort;
}
function normalizeCwd(value) {
    const raw = value === undefined || value === null || String(value).trim() === ""
        ? DEFAULT_CWD : String(value).trim();
    if (!raw.startsWith("/") || /[\0\r\n]/.test(raw)) {
        throw new Error("cwd 必须是有效的 Linux 绝对路径");
    }
    const parts = raw.split("/");
    if (parts.includes("..")) {
        throw new Error("cwd 不能包含 .. 路径段");
    }
    const normalized = raw.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    if (normalized === "/" || normalized === "/root") {
        throw new Error("cwd 不能是 / 或 /root，请指定独立工作区目录");
    }
    return normalized;
}
function parseBoolean(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === "")
        return fallback;
    if (value === true || String(value).toLowerCase() === "true")
        return true;
    if (value === false || String(value).toLowerCase() === "false")
        return false;
    throw new Error("布尔参数仅支持 true 或 false");
}
function truncateOutput(value, maxChars) {
    if (value === undefined || value === null)
        return null;
    const text = String(value);
    if (text.length <= maxChars)
        return text;
    return "...[输出过长，仅显示尾部 " + maxChars + " 字符]...\n" + text.slice(-maxChars);
}
async function writeLinuxFile(path, content) {
    await Tools.Files.write(path, content, false, "linux");
}
async function readLinuxFile(linuxPath, fallback) {
    try {
        const r = await Tools.Files.read({ path: linuxPath, environment: "linux" });
        const content = typeof r === "string" ? r
            : (r && typeof r === "object" ? (r.content ?? r.text ?? "") : String(r ?? ""));
        return String(content ?? "");
    }
    catch (e) {
        return fallback || "";
    }
}
async function writeTaskInput(taskId, task) {
    await writeLinuxFile(JOBS_DIR_LINUX + "/input/" + taskId + ".txt", task);
}
async function requireTask(taskId) {
    const exists = await Tools.Files.exists(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "linux");
    if (!exists?.exists) {
        throw new Error("未找到任务：" + taskId);
    }
}
async function writeRunScript(taskId, cwd, preset, timeoutMs, model, reasoningEffort, sessionId) {
    const inputPath = JOBS_DIR_LINUX + "/input/" + taskId + ".txt";
    const scriptPath = JOBS_DIR_LINUX + "/run/" + taskId + ".sh";
    const timeoutSeconds = Math.max(10, Math.ceil(timeoutMs / 1000));
    const lines = [
        "#!/bin/bash",
        "set -u",
        "umask 077",
        "cd -- " + shellQuote(cwd) + " || exit 72",
        "export DSH_HOME=" + shellQuote(DSH_HOME),
        "export DSH_PERMISSION_MODE='workspace-write'",
        "export DSH_SESSION_ID=" + shellQuote(sessionId),
    ];
    if (preset) {
        lines.push("export DSH_AGENT_PRESET=" + shellQuote(preset));
    }
    if (model) {
        lines.push("export DSH_MODEL=" + shellQuote(model));
    }
    if (reasoningEffort) {
        lines.push("export DSH_REASONING_EFFORT=" + shellQuote(reasoningEffort));
    }
    lines.push("TASK=\"$(cat -- " + shellQuote(inputPath) + ")\" || exit 74");
    lines.push("rm -f -- " + shellQuote(inputPath) + " || exit 75");
    lines.push("exec timeout --signal=TERM --kill-after=10s " + timeoutSeconds + "s " + shellQuote(DSH_BIN) + " --profile headless \"$TASK\"");
    await writeLinuxFile(scriptPath, lines.join("\n") + "\n");
    await execInTerminal("chmod 700 -- " + shellQuote(scriptPath), 10000);
}
/** 从进程日志提取最终输出（P5/P6 兜底：会话解析不可用时，DSH 的完整答案一定在 out/<taskId>.log）。 */
async function extractAnswerFromLog(taskId, maxChars) {
    try {
        const raw = await readLinuxFile(JOBS_DIR_LINUX + "/out/" + taskId + ".log", "");
        if (!raw)
            return null;
        let body = raw.replace(/^nohup: ignoring input\s*/m, "").trim();
        const idx = body.lastIndexOf("EXIT_CODE=");
        if (idx >= 0)
            body = body.slice(0, idx).trim();
        if (!body)
            return null;
        const limit = maxChars || 40000;
        return body.length > limit
            ? "...[日志过长，仅显示尾部 " + limit + " 字符；完整日志见 out/" + taskId + ".log]...\n" + body.slice(-limit)
            : body;
    }
    catch (e) {
        return null;
    }
}
async function jobMeta(taskId) {
    const meta = {
        taskId,
        status: "unknown",
        pid: null,
        startedAt: null,
        exitCode: null,
        summary: "",
    };
    try {
        const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "{}");
        const parsed = JSON.parse(metaRaw || "{}");
        meta.startedAt = parsed.startedAt || null;
        meta.summary = parsed.summary || "";
    }
    catch (e) { /* ignore */ }
    try {
        const pidRaw = (await readLinuxFile(JOBS_DIR_LINUX + "/pid/" + taskId + ".pid", "")).trim();
        if (/^[1-9][0-9]*$/.test(pidRaw))
            meta.pid = pidRaw;
    }
    catch (e) { /* ignore */ }
    try {
        const codeRaw = (await readLinuxFile(JOBS_DIR_LINUX + "/code/" + taskId + ".code", "")).trim();
        if (/^-?[0-9]+$/.test(codeRaw))
            meta.exitCode = Number(codeRaw);
    }
    catch (e) { /* ignore */ }
    const stateFallback = await statusFromStateFile(taskId);
    if (meta.exitCode !== null) {
        meta.status = meta.exitCode === 0 ? "done"
            : (meta.exitCode === -2 ? "cancelled" : (meta.exitCode === 124 ? "timeout" : "failed"));
    }
    else if (meta.pid) {
        try {
            const alive = await execInTerminal("kill -0 " + meta.pid + " 2>/dev/null && echo ALIVE || echo DEAD", 10000);
            const out = String(alive?.output || "").trim();
            if (out.includes("ALIVE"))
                meta.status = "running";
            else if (stateFallback && ["done", "failed", "cancelled", "timeout"].includes(stateFallback.status)) {
                meta.status = stateFallback.status;
                meta.exitCode = stateFallback.exitCode;
            }
            else {
                meta.status = "failed";
                meta.exitCode = -1;
            }
        }
        catch (e) {
            meta.status = "unknown";
        }
    }
    else if (stateFallback) {
        meta.status = stateFallback.status;
        meta.pid = meta.pid || stateFallback.pid;
        meta.exitCode = stateFallback.exitCode;
    }
    return meta;
}
async function listAllJobs() {
    const metaDir = JOBS_DIR_LINUX + "/meta";
    const out = await execInTerminal("ls -1 -- " + shellQuote(metaDir) + " 2>/dev/null || true", 10000);
    const taskIds = String(out?.output || "").split("\n").map((s) => s.trim().replace(/\.json$/, ""))
        .filter((s) => /^dsh-[a-z0-9]+-[a-z0-9]+$/.test(s));
    const jobs = [];
    for (const taskId of taskIds) {
        jobs.push(await jobMeta(taskId));
    }
    jobs.sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")) || 0);
    return jobs;
}
async function ensureJobsDirs() {
    const directories = [
        JOBS_DIR_LINUX,
        JOBS_DIR_LINUX + "/input",
        JOBS_DIR_LINUX + "/run",
        JOBS_DIR_LINUX + "/out",
        JOBS_DIR_LINUX + "/pid",
        JOBS_DIR_LINUX + "/code",
        JOBS_DIR_LINUX + "/meta",
        DEFAULT_CWD,
    ];
    for (const directory of directories) {
        await Tools.Files.mkdir(directory, true, "linux");
    }
    await execInTerminal("chmod 700 -- " + directories.map(shellQuote).join(" "), 10000);
}
const runLock = new Map();
async function withRunLock(key, operation) {
    const previous = runLock.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    runLock.set(key, current);
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
        if (runLock.get(key) === current) {
            runLock.delete(key);
        }
    }
}
/** 同 cwd 互斥：DSH headless 同一工作目录同时只能有一个活跃会话，并发会共享会话导致结果串号。
 *  不同 cwd 的任务互不影响，可安全并行。 */
async function assertNoSameCwdRunning(cwd, skipTaskId) {
    const norm = (s) => String(s || "").replace(/\/+$/, "");
    const jobs = await listAllJobs();
    const running = jobs.filter((j) => j.status === "running");
    for (const j of running) {
        if (skipTaskId && j.taskId === skipTaskId)
            continue;
        let otherCwd = "";
        try {
            const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + j.taskId + ".json", "{}");
            otherCwd = (JSON.parse(metaRaw).cwd || "").replace(/\/+$/, "");
        }
        catch (e) { /* 读不到 cwd 的按不冲突处理 */ }
        if (otherCwd && norm(otherCwd) === norm(cwd)) {
            throw new Error("同工作目录已有运行中的 DSH 任务（" + j.taskId + "）。DSH headless 同一 cwd 仅支持单个活跃会话，并发会导致结果串号；请先等待其完成，或用 dsh_subagent_cancel 停止后再派新任务（不同 cwd 的任务可并行）。");
        }
    }
}
function b64(s) {
    // 沙箱内可能没有全局 Buffer；用 encodeURIComponent + btoa 不可靠，直接原样传由 python 兼容明文
    return s;
}
async function statusFromStateFile(taskId) {
    try {
        const raw = await readLinuxFile(STATE_JSON, "{}");
        const state = JSON.parse(raw || "{}");
        const agent = Array.isArray(state.agents) ? state.agents.find((item) => item && item.taskId === taskId) : undefined;
        if (!agent || typeof agent.status !== "string") {
            return null;
        }
        return {
            status: agent.status,
            pid: agent.pid || null,
            exitCode: typeof agent.exitCode === "number" ? agent.exitCode : null,
        };
    }
    catch (e) {
        return null;
    }
}
/** 解析任务对应的 DSH 会话，返回实时统计（工具调用/tokens/错误/当前活动/答案）。 */
async function parseSession(taskId, cwd, task, startedAtMs) {
    try {
        const snippet = ""; // Keep task text out of process arguments; cwd + start time identify the session.
        const cmd = "python3 " + shellQuote(PARSE_PY) + " " +
            shellQuote(taskId) + " " + shellQuote(cwd) + " " + shellQuote(snippet) + " " +
            shellQuote(DSH_SESSIONS_ROOT) + " " + startedAtMs + " 2>/dev/null";
        const res = await execInTerminal(cmd, 90000); // 大会话解析放宽（P5：15s 易超时导致 matched:false）
        const out = String(res?.output || "").trim();
        if (!out)
            return { matched: false };
        const parsed = JSON.parse(out);
        return parsed;
    }
    catch (e) {
        return { matched: false };
    }
}
const TERMINAL_STATES = ["done", "failed", "cancelled", "timeout"];
/** 完整状态：进程信息 + 会话实时统计 + 日志兜底答案（P5/P6：会话解析失败也能拿到最终输出） */
async function fullStatus(taskId) {
    const meta = await jobMeta(taskId);
    let session = { matched: false };
    let taskModel = null;
    let taskReasoningEffort = null;
    let requestedSessionId = null;
    try {
        const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "{}");
        const parsed = JSON.parse(metaRaw || "{}");
        taskModel = parsed.model || null;
        taskReasoningEffort = parsed.reasoningEffort || null;
        requestedSessionId = parsed.sessionId || null;
        const startedMs = parsed.startedAt ? new Date(parsed.startedAt).getTime() : 0;
        session = await parseSession(taskId, parsed.cwd || DEFAULT_CWD, parsed.task || "", startedMs);
    }
    catch (e) { /* ignore */ }
    // 日志兜底：终态任务若会话答案缺失，从 out/<taskId>.log 提取（status 回传 gap 根治）
    let answer = session.answer || null;
    let answerSource = null;
    if (session.matched === true)
        answerSource = "session";
    if (!answer && TERMINAL_STATES.indexOf(meta.status) !== -1) {
        const fromLog = await extractAnswerFromLog(taskId);
        if (fromLog) {
            answer = fromLog;
            answerSource = "log";
        }
    }
    const now = Date.now();
    const startedTs = meta.startedAt ? new Date(meta.startedAt).getTime() : 0;
    let preset;
    try {
        const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "{}");
        const parsed = JSON.parse(metaRaw || "{}");
        preset = parsed.preset;
    }
    catch (e) { /* ignore */ }
    return {
        ...meta,
        preset: preset || "standard",
        elapsedSec: startedTs ? Math.round((now - startedTs) / 1000) : null,
        session,
        answer,
        answerSource,
        model: taskModel,
        reasoningEffort: taskReasoningEffort,
        requestedSessionId,
    };
}
/** 聚合所有任务状态（供面板/预览页使用） */
async function collectState() {
    const jobs = await listAllJobs();
    const agents = [];
    for (const j of jobs.slice(-20).reverse()) {
        const full = await fullStatus(j.taskId);
        const s = full.session || {};
        const sessionMatched = s.matched === true;
        agents.push({
            taskId: j.taskId,
            status: full.status,
            preset: full.preset || "standard",
            pid: full.pid,
            startedAt: full.startedAt,
            elapsedSec: full.elapsedSec,
            exitCode: full.exitCode,
            cwd: s.cwd || null,
            sessionId: s.sessionId || null,
            requestedSessionId: full.requestedSessionId || null,
            model: full.model || null,
            reasoningEffort: full.reasoningEffort || null,
            matched: sessionMatched,
            buffered: full.status === "running" && !sessionMatched,
            steps: sessionMatched ? (s.steps ?? 0) : null,
            turns: sessionMatched ? (s.turns ?? 0) : null,
            toolCalls: sessionMatched ? (s.toolCalls || { total: 0, byTool: {} }) : null,
            tokens: sessionMatched ? (s.tokens || {}) : null,
            errors: (s.errors || []).slice(-5),
            currentActivity: full.status === "running" && s.matched !== true
                ? "运行中（DSH 会话缓冲未落盘，进度稍后可见；进程日志见 out/*.log）"
                : (s.lastActivity || null),
            answer: full.answer || null,
            answerSource: full.answerSource || null,
            hasFinish: full.status !== "running" && s.hasFinish === true,
        });
    }
    return {
        generatedAt: new Date().toISOString(),
        count: agents.length,
        running: agents.filter(a => a.status === "running").length,
        agents,
    };
}
// ============ 工具实现 ============
function buildLaunchCommand(taskId) {
    const scriptFile = JOBS_DIR_LINUX + "/run/" + taskId + ".sh";
    const logFile = JOBS_DIR_LINUX + "/out/" + taskId + ".log";
    const codeFile = JOBS_DIR_LINUX + "/code/" + taskId + ".code";
    const pidFile = JOBS_DIR_LINUX + "/pid/" + taskId + ".pid";
    const wrapped = "bash -- " + shellQuote(scriptFile) + "; code=$?; printf '%s\\n' \"$code\" > " +
        shellQuote(codeFile) + "; exit \"$code\"";
    return "umask 077; nohup bash -c " + shellQuote(wrapped) + " > " + shellQuote(logFile) +
        " 2>&1 < /dev/null & printf '%s\\n' \"$!\" > " + shellQuote(pidFile);
}
async function terminateTaskProcess(taskId, meta, exitCode) {
    if (meta.pid && /^[1-9][0-9]*$/.test(meta.pid)) {
        const pid = meta.pid;
        const command = "pkill -TERM -P " + pid + " 2>/dev/null || true; kill -TERM " + pid +
            " 2>/dev/null || true; sleep 1; pkill -KILL -P " + pid + " 2>/dev/null || true; kill -KILL " +
            pid + " 2>/dev/null || true";
        await execInTerminal(command, 10000);
    }
    await writeLinuxFile(JOBS_DIR_LINUX + "/code/" + taskId + ".code", String(exitCode));
}
async function dsh_subagent_run(params) {
    try {
        if (!params || !params.task || !String(params.task).trim()) {
            throw new Error("task 不能为空");
        }
        const task = String(params.task).trim();
        if (task.length > 200000) {
            throw new Error("task 不能超过 200000 个字符");
        }
        const cwd = normalizeCwd(params.cwd);
        const mode = parseMode(params.mode);
        const timeoutMs = parseInteger(params.timeoutMs, DEFAULT_TIMEOUT_MS, 10000, MAX_TIMEOUT_MS, "timeoutMs");
        const maxOutputChars = parseInteger(params.maxOutputChars, DEFAULT_OUTPUT_CHARS, 1000, 200000, "maxOutputChars");
        const preset = parsePreset(params.preset);
        const model = parseModel(params.model);
        const reasoningEffort = parseReasoningEffort(params.reasoningEffort);
        await ensureScripts();
        const runtime = await Tools.Files.exists(DSH_BIN, "linux");
        if (!runtime?.exists) {
            throw new Error("DeepSeek Harness 运行时尚未安装，请先初始化运行时");
        }
        const cwdStatus = await Tools.Files.exists(cwd, "linux");
        if (!cwdStatus?.exists) {
            throw new Error("cwd 不存在：" + cwd);
        }
        const launch = await withRunLock("cwd:" + cwd, async () => {
            // 检查、写入和启动必须在同一个临界区内完成，避免同 cwd 并发竞态。
            await assertNoSameCwdRunning(cwd);
            const taskId = newTaskId();
            const sessionId = taskId;
            await writeTaskInput(taskId, task);
            await writeRunScript(taskId, cwd, preset, timeoutMs, model, reasoningEffort, sessionId);
            const startedAt = new Date().toISOString();
            await writeLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", JSON.stringify({
                taskId,
                task: task.slice(0, 120),
                summary: task.slice(0, 120),
                startedAt,
                cwd,
                preset: preset || "standard",
                model: model || null,
                reasoningEffort: reasoningEffort || null,
                sessionId,
                permissionMode: "workspace-write",
                timeoutMs,
            }, null, 2));
            const launched = await execInTerminal(buildLaunchCommand(taskId), 15000);
            if (typeof launched?.exitCode === "number" && launched.exitCode !== 0) {
                throw new Error("DSH sub-agent 后台进程启动失败，exitCode=" + launched.exitCode);
            }
            return { taskId, sessionId };
        });
        const taskId = launch.taskId;
        const sessionId = launch.sessionId;
        if (mode === "async") {
            return {
                mode: "async",
                taskId,
                status: "running",
                cwd,
                task: task.slice(0, 120),
                model: model || null,
                reasoningEffort: reasoningEffort || null,
                requestedSessionId: sessionId,
                permissionMode: "workspace-write",
                timeoutMs,
                hint: "任务已显式转入后台；用 dsh_subagent_watch 等待结果或 dsh_subagent_cancel 停止任务。",
            };
        }
        const started = Date.now();
        const deadline = started + timeoutMs + 15000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const m = await jobMeta(taskId);
            if (m.status !== "running" && m.status !== "unknown") {
                const full = await fullStatus(taskId);
                return {
                    mode: "sync",
                    taskId,
                    status: m.status,
                    exitCode: m.exitCode,
                    cwd,
                    model: full.model || null,
                    reasoningEffort: full.reasoningEffort || null,
                    requestedSessionId: full.requestedSessionId || sessionId,
                    elapsedMs: Date.now() - started,
                    answer: truncateOutput(full.answer, maxOutputChars),
                    answerSource: full.answerSource || null,
                    permissionMode: "workspace-write",
                    timeoutMs,
                    logFile: JOBS_DIR_LINUX + "/out/" + taskId + ".log",
                };
            }
        }
        let finalMeta = await jobMeta(taskId);
        if (finalMeta.status === "running" || finalMeta.status === "unknown") {
            await terminateTaskProcess(taskId, finalMeta, 124);
            finalMeta = await jobMeta(taskId);
        }
        const full = await fullStatus(taskId);
        return {
            mode: "sync",
            taskId,
            status: "timeout",
            exitCode: finalMeta.exitCode,
            cwd,
            model: full.model || null,
            reasoningEffort: full.reasoningEffort || null,
            requestedSessionId: full.requestedSessionId || sessionId,
            elapsedMs: Date.now() - started,
            answer: truncateOutput(full.answer, maxOutputChars),
            answerSource: full.answerSource || null,
            permissionMode: "workspace-write",
            timeoutMs,
            hint: "任务已达到硬性运行时限并终止。",
            logFile: JOBS_DIR_LINUX + "/out/" + taskId + ".log",
        };
    }
    catch (e) {
        console.error("[dsh_subagent_run] " + e.message);
        throw e;
    }
}
async function dsh_subagent_status(params) {
    try {
        if (!params || !params.taskId)
            throw new Error("taskId 不能为空");
        const taskId = safeTaskId(String(params.taskId));
        await ensureScripts();
        await requireTask(taskId);
        const full = await fullStatus(taskId);
        const s = full.session || {};
        const sessionMatched = s.matched === true;
        const tailChars = parseInteger(params.tailChars, DEFAULT_TAIL_CHARS, 1000, 200000, "tailChars");
        const logRaw = await readLinuxFile(JOBS_DIR_LINUX + "/out/" + taskId + ".log", "");
        let tail = "";
        if (logRaw.length > tailChars) {
            tail = "...[日志过长，仅显示尾部 " + tailChars + " 字符；完整日志见 " + JOBS_DIR_LINUX + "/out/" + taskId + ".log]...\n" + logRaw.slice(-tailChars);
        }
        else {
            tail = logRaw;
        }
        return {
            taskId,
            status: full.status,
            pid: full.pid,
            startedAt: full.startedAt,
            elapsedSec: full.elapsedSec,
            exitCode: full.exitCode,
            sessionId: s.sessionId || null,
            requestedSessionId: full.requestedSessionId || null,
            model: full.model || null,
            reasoningEffort: full.reasoningEffort || null,
            sessionMatched,
            buffered: full.status === "running" && !sessionMatched,
            steps: sessionMatched ? (s.steps ?? 0) : null,
            turns: sessionMatched ? (s.turns ?? 0) : null,
            toolCalls: sessionMatched ? (s.toolCalls || { total: 0, byTool: {} }) : null,
            tokens: sessionMatched ? (s.tokens || {}) : null,
            errors: (s.errors || []).slice(-5),
            currentActivity: full.status === "running" && s.matched !== true
                ? "运行中（DSH 会话缓冲未落盘，进度稍后可见；进程日志见 out/*.log）"
                : (s.lastActivity || null),
            answer: full.answer || null,
            answerSource: full.answerSource || null,
            hasFinish: full.status !== "running" && s.hasFinish === true,
            permissionMode: "workspace-write",
            logTail: tail,
        };
    }
    catch (e) {
        console.error("[dsh_subagent_status] " + e.message);
        throw e;
    }
}
/** 等待任务到终态（阻塞等待，替代盲等/轮询）：默认静默等待，终态一次性返回完整结果；超时也直接返回（附当前快照）。 */
async function dsh_subagent_watch(params) {
    try {
        if (!params || !params.taskId)
            throw new Error("taskId 不能为空");
        const taskId = safeTaskId(String(params.taskId));
        await ensureScripts();
        await requireTask(taskId);
        const timeoutMs = parseInteger(params.timeoutMs, 600000, 15000, MAX_TIMEOUT_MS, "timeoutMs");
        const intervalMs = parseInteger(params.intervalMs, 5000, 2000, 60000, "intervalMs");
        const silent = parseBoolean(params.silent, true); // 默认静默：不推送进度，终态一次性返回
        const started = Date.now();
        let lastActivity = "";
        const progress = [];
        while (Date.now() - started < timeoutMs) {
            const st = await dsh_subagent_status({ taskId, tailChars: 3000 });
            const activity = st.currentActivity || st.status;
            if (activity !== lastActivity) {
                lastActivity = activity;
                progress.push({ t: Math.round((Date.now() - started) / 1000), status: st.status, activity });
                if (!silent) {
                    try {
                        sendIntermediateResult({ taskId, status: st.status, elapsedSec: st.elapsedSec, currentActivity: activity });
                    }
                    catch (e) { /* 进度推送可选 */ }
                }
            }
            if (TERMINAL_STATES.indexOf(st.status) !== -1) {
                return { ...st, watched: true, silent, progress, totalWaitSec: Math.round((Date.now() - started) / 1000) };
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        // 超时：取一次当前快照一并返回，由 AI 决定继续等待还是取消（任务仍在后台运行）
        let snapshot = null;
        try {
            snapshot = await dsh_subagent_status({ taskId, tailChars: 3000 });
        }
        catch (e) { /* ignore */ }
        return {
            taskId,
            status: "timeout",
            watched: true,
            silent,
            progress,
            totalWaitSec: Math.round((Date.now() - started) / 1000),
            currentSnapshot: snapshot,
            hint: "等待超时（" + Math.round(timeoutMs / 1000) + "s），任务仍在后台运行：可再次调用 dsh_subagent_watch 继续等待（把 timeoutMs 加大），或用 dsh_subagent_status 查询进度、dsh_subagent_cancel 停止。",
        };
    }
    catch (e) {
        console.error("[dsh_subagent_watch] " + e.message);
        throw e;
    }
}
const TASK_ARTIFACTS = [
    { directory: "input", suffix: ".txt" },
    { directory: "run", suffix: ".sh" },
    { directory: "out", suffix: ".log" },
    { directory: "pid", suffix: ".pid" },
    { directory: "code", suffix: ".code" },
    { directory: "meta", suffix: ".json" },
];
async function removeLinuxFile(linuxPath, recursive = false) {
    try {
        const exists = await Tools.Files.exists(linuxPath, "linux");
        if (!exists?.exists)
            return true;
        const result = await Tools.Files.deleteFile(linuxPath, recursive, "linux");
        return result?.successful !== false;
    }
    catch (e) {
        return false;
    }
}
function sessionPathFor(cwd, sessionId) {
    const sid = String(sessionId || "");
    if (!/^[A-Za-z0-9._-]+$/.test(sid) || sid === "." || sid === "..")
        return null;
    const rawCwd = String(cwd || DEFAULT_CWD).replace(/\\/g, "/");
    const parts = rawCwd.split("/").filter(Boolean);
    if (parts.includes(".."))
        return null;
    const slug = "--" + parts.join("-") + "--";
    return DSH_SESSIONS_ROOT + "/" + slug + "/" + sid;
}
async function cleanupTerminalTask(taskId) {
    const full = await fullStatus(taskId);
    const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "{}");
    let taskMeta = {};
    try {
        taskMeta = JSON.parse(metaRaw || "{}");
    }
    catch (e) { /* malformed metadata is removed with the task record */ }
    const failedPaths = [];
    let sessionCleaned = false;
    const sessionPath = sessionPathFor(taskMeta.cwd || DEFAULT_CWD, full.session?.sessionId);
    if (sessionPath) {
        const sessionExists = await Tools.Files.exists(sessionPath, "linux");
        if (sessionExists?.exists) {
            if (await removeLinuxFile(sessionPath, true))
                sessionCleaned = true;
            else
                failedPaths.push(sessionPath);
        }
    }
    for (const artifact of TASK_ARTIFACTS.slice(0, -1)) {
        const path = JOBS_DIR_LINUX + "/" + artifact.directory + "/" + taskId + artifact.suffix;
        if (!(await removeLinuxFile(path)))
            failedPaths.push(path);
    }
    const metaPath = JOBS_DIR_LINUX + "/meta/" + taskId + ".json";
    if (failedPaths.length === 0 && !(await removeLinuxFile(metaPath)))
        failedPaths.push(metaPath);
    return { taskId, sessionCleaned, failedPaths };
}
/** 清理已结束任务的监控文件和对应 DSH 会话；运行中的任务始终保留。 */
async function dsh_subagent_cleanup() {
    try {
        await ensureScripts();
        const jobs = await listAllJobs();
        const removedTaskIds = [];
        const retainedTaskIds = [];
        const failures = [];
        for (const job of jobs) {
            const current = await jobMeta(job.taskId);
            if (TERMINAL_STATES.indexOf(current.status) === -1) {
                retainedTaskIds.push(job.taskId);
                continue;
            }
            const result = await cleanupTerminalTask(job.taskId);
            if (result.failedPaths.length > 0)
                failures.push(result);
            else
                removedTaskIds.push(job.taskId);
        }
        const state = await collectState();
        await writeLinuxFile(STATE_JSON, JSON.stringify(state, null, 2));
        return {
            removed: removedTaskIds.length,
            removedTaskIds,
            retained: retainedTaskIds.length,
            retainedTaskIds,
            retainedRunning: state.running,
            failures,
            state,
            stateJson: STATE_JSON,
        };
    }
    catch (e) {
        console.error("[dsh_subagent_cleanup] " + e.message);
        throw e;
    }
}
/** 生成全量状态（供预览页/面板）：写 state.json，可选同步到工作区 dsh-state.json */
async function dsh_subagent_panel(params) {
    try {
        await ensureScripts();
        const state = await collectState();
        const stateJson = JSON.stringify(state, null, 2);
        await writeLinuxFile(STATE_JSON, stateJson);
        let workspaceSynced = false;
        let workspaceState = null;
        if (params && params.workspace) {
            const workspace = normalizeCwd(params.workspace);
            const workspaceStatus = await Tools.Files.exists(workspace, "linux");
            if (!workspaceStatus?.exists) {
                throw new Error("workspace 不存在：" + workspace);
            }
            workspaceState = workspace + "/dsh-state.json";
            await writeLinuxFile(workspaceState, stateJson);
            await writeLinuxFile(JOBS_DIR_LINUX + "/watch_workspace.txt", workspace);
            workspaceSynced = true;
        }
        return { ...state, stateJson: STATE_JSON, workspaceSynced, workspaceState };
    }
    catch (e) {
        console.error("[dsh_subagent_panel] " + e.message);
        throw e;
    }
}
async function dsh_subagent_list() {
    try {
        await ensureScripts();
        const jobs = await listAllJobs();
        return { count: jobs.length, jobs: jobs.slice(-50).reverse() };
    }
    catch (e) {
        console.error("[dsh_subagent_list] " + e.message);
        throw e;
    }
}
async function dsh_subagent_cancel(params) {
    try {
        if (!params || !params.taskId)
            throw new Error("taskId 不能为空");
        const taskId = safeTaskId(String(params.taskId));
        await ensureScripts();
        await requireTask(taskId);
        const meta = await jobMeta(taskId);
        if (meta.status !== "running") {
            return { taskId, status: meta.status, message: "任务不在运行中，无需取消" };
        }
        const fullBeforeCancel = await fullStatus(taskId);
        await terminateTaskProcess(taskId, meta, -2);
        let sessionCleaned = false;
        try {
            const metaRaw = await readLinuxFile(JOBS_DIR_LINUX + "/meta/" + taskId + ".json", "{}");
            const parsed = JSON.parse(metaRaw || "{}");
            const cwd = parsed.cwd || DEFAULT_CWD;
            const slug = "--" + cwd.replace(/\\/g, "/").split("/").filter(Boolean).join("-") + "--";
            const sid = String((fullBeforeCancel.session || {}).sessionId || "");
            if (/^[A-Za-z0-9._-]+$/.test(sid) && sid !== "." && sid !== "..") {
                const sessionPath = DSH_SESSIONS_ROOT + "/" + slug + "/" + sid;
                const sessionExists = await Tools.Files.exists(sessionPath, "linux");
                if (sessionExists?.exists) {
                    const deletion = await Tools.Files.deleteFile(sessionPath, true, "linux");
                    sessionCleaned = deletion?.successful !== false;
                }
            }
        }
        catch (e) { /* 清理失败不阻断 */ }
        return { taskId, pid: meta.pid, status: "cancelled", cancelled: true, sessionCleaned };
    }
    catch (e) {
        console.error("[dsh_subagent_cancel] " + e.message);
        throw e;
    }
}
