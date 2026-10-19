"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeepSeekHarnessWebServerUrl = getDeepSeekHarnessWebServerUrl;
exports.getDeepSeekHarnessWebServerAuthenticatedUrl = getDeepSeekHarnessWebServerAuthenticatedUrl;
exports.callDeepSeekHarnessRpc = callDeepSeekHarnessRpc;
exports.readDeepSeekHarnessWorkspaceStorage = readDeepSeekHarnessWorkspaceStorage;
exports.isDeepSeekHarnessRuntimeInstalled = isDeepSeekHarnessRuntimeInstalled;
exports.readDeepSeekHarnessWebFailure = readDeepSeekHarnessWebFailure;
exports.readDeepSeekHarnessWebServerStatus = readDeepSeekHarnessWebServerStatus;
exports.inspectDeepSeekHarnessRuntime = inspectDeepSeekHarnessRuntime;
exports.readDeepSeekHarnessReleaseNotes = readDeepSeekHarnessReleaseNotes;
exports.installDeepSeekHarnessRuntime = installDeepSeekHarnessRuntime;
exports.resetDeepSeekHarnessRuntime = resetDeepSeekHarnessRuntime;
exports.startDeepSeekHarnessWebServer = startDeepSeekHarnessWebServer;
exports.stopDeepSeekHarnessWebServer = stopDeepSeekHarnessWebServer;
const DEFAULT_PORT = 3081;
const LOOPBACK_HOST = "127.0.0.1";
const DSH_PACKAGE_NAME = "@deepseek-ai/dsh";
// Release versions are resolved from GitHub Releases instead of npm latest.
const DSH_RELEASES_API_URL = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=30";
const STARTUP_HEALTH_WAIT_MS = 120000;
const TERMINAL_SESSION_NAME = "sidebar_deepseek_harness_web_server";
const LINUX_RUNTIME_DIR = "/root/sidebar_deepseek_harness";
const DSH_HOME_DIR = `${LINUX_RUNTIME_DIR}/dsh-home`;
const LINUX_WORKSPACE_DIR = "/root/dsh_workspace";
const LINUX_LOG_PATH = `${LINUX_RUNTIME_DIR}/deepseek-harness-web.log`;
const LINUX_HEALTH_PATH = `${LINUX_RUNTIME_DIR}/operit-health.json`;
const LINUX_PID_PATH = `${LINUX_RUNTIME_DIR}/deepseek-harness-web.pid`;
const DSH_PACKAGE_MANIFEST_PATH = `${LINUX_RUNTIME_DIR}/node_modules/${DSH_PACKAGE_NAME}/package.json`;
const DSH_CLI_PATH = `${LINUX_RUNTIME_DIR}/node_modules/.bin/dsh`;
const DSH_PROCESS_MARKER = "operit_deepseek_harness_web";
const DSH_PROCESS_MARKER_ENV = `OPERIT_DSH_PROCESS_MARKER=${DSH_PROCESS_MARKER}`;
const LINUX_PNPM_HOME = "/root/.local/share/pnpm";
const PNPM_WORKSPACE_PATH = `${LINUX_RUNTIME_DIR}/pnpm-workspace.yaml`;
const DSH_ALLOWED_BUILD_PACKAGES = [
    "@deepseek-ai/dsh-subprocess-local",
    "@google/genai",
    "koffi",
    "node-pty",
    "protobufjs",
];
function shellQuote(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function bashCommand(script) {
    return `bash -lc ${shellQuote(script)}`;
}
function isDshVersion(value) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
function parseRuntimeEvents(output) {
    const events = [];
    const lines = output.replace(/\r/g, "").split("\n");
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("{") || !line.endsWith("}")) {
            continue;
        }
        try {
            const record = JSON.parse(line);
            if (record.type === "process_status" && record.running === true) {
                events.push({ type: "process_status", running: true });
            }
            else if (record.type === "health" &&
                typeof record.ok === "boolean" &&
                typeof record.statusCode === "number") {
                const healthEvent = {
                    type: "health",
                    ok: record.ok,
                    statusCode: record.statusCode,
                };
                if (typeof record.message === "string") {
                    healthEvent.message = record.message;
                }
                events.push(healthEvent);
            }
            else if (record.type === "version" &&
                (record.source === "installed" || record.source === "latest") &&
                typeof record.version === "string" &&
                isDshVersion(record.version)) {
                events.push({ type: "version", source: record.source, version: record.version });
            }
            else if (record.type === "version_failure" && typeof record.message === "string") {
                events.push({ type: "version_failure", message: record.message });
            }
            else if (record.type === "install_progress" &&
                typeof record.progress === "number" &&
                typeof record.message === "string") {
                events.push({ type: "install_progress", progress: record.progress, message: record.message });
            }
            else if (record.type === "install_output" && typeof record.output === "string") {
                events.push({ type: "install_output", output: record.output });
            }
            else if (record.type === "install_result" &&
                (record.status === "ready" || record.status === "failed")) {
                const installResult = {
                    type: "install_result",
                    status: record.status,
                };
                if (typeof record.message === "string") {
                    installResult.message = record.message;
                }
                if (typeof record.command === "string") {
                    installResult.command = record.command;
                }
                if (typeof record.exitCode === "number") {
                    installResult.exitCode = record.exitCode;
                }
                events.push(installResult);
            }
        }
        catch (error) {
            console.error("DeepSeek Harness runtime event parsing failed", error);
        }
    }
    return events;
}
function buildRuntimeEventEmitterScript() {
    const eventScript = [
        "const [type, first, second, third, fourth] = process.argv.slice(1);",
        "let event;",
        "if (type === 'process_status') { event = { type, running: first === 'true' }; }",
        "else if (type === 'health') { event = { type, ok: first === 'true', statusCode: Number(second), message: third }; }",
        "else if (type === 'version') { event = { type, source: first, version: second }; }",
        "else if (type === 'version_failure') { event = { type, message: first }; }",
        "else if (type === 'install_progress') { event = { type, progress: Number(first), message: second }; }",
        "else if (type === 'install_result') { event = { type, status: first }; if (second) event.message = second; if (third) event.command = third; if (fourth !== undefined) event.exitCode = Number(fourth); }",
        "else { process.exit(2); }",
        "process.stdout.write(JSON.stringify(event) + '\\n');",
    ].join("");
    const outputScript = [
        "const readline = require('node:readline');",
        "const reader = readline.createInterface({ input: process.stdin });",
        "reader.on('line', (output) => process.stdout.write(JSON.stringify({ type: 'install_output', output }) + '\\n'));",
    ].join("");
    return [
        `runtime_event() { node -e ${shellQuote(eventScript)} "$@"; }`,
        `runtime_output() { node -e ${shellQuote(outputScript)}; }`,
    ].join("\n");
}
function buildServerUrl() {
    return `http://${LOOPBACK_HOST}:${DEFAULT_PORT}`;
}
/**
 * 从 Web 服务日志中解析最近一次启动打印的进程 token。
 * 新版 DSH 会对所有 HTTP 请求做会话鉴权，URL 形如 http://127.0.0.1:3081/?token=xxx，
 * 首次带 token 访问会下发 dsh-auth cookie，之后页面内请求凭 cookie 放行。
 */
function extractAuthTokenFromLog(logTail) {
    if (typeof logTail !== "string") {
        return undefined;
    }
    const matches = [...logTail.matchAll(/[?&]token=([A-Za-z0-9_-]+)/g)];
    if (matches.length === 0) {
        return undefined;
    }
    return matches[matches.length - 1][1];
}
/** 把 token 拼进 URL；拿不到 token 时退回裸地址（兼容旧版 DSH）。 */
function buildAuthenticatedServerUrl(token) {
    if (!token) {
        return buildServerUrl();
    }
    return `${buildServerUrl()}/?token=${token}`;
}
/** 读取日志并返回带 token 的地址。 */
async function resolveAuthenticatedServerUrl() {
    const logTail = await readLinuxLogTail();
    return buildAuthenticatedServerUrl(extractAuthTokenFromLog(logTail));
}
async function getDeepSeekHarnessWebServerAuthenticatedUrl() {
    return resolveAuthenticatedServerUrl();
}
function getDeepSeekHarnessWebServerUrl() {
    return buildServerUrl();
}

/** \u901a\u8fc7 Linux \u8fd0\u884c\u65f6\u7684 curl \u6267\u884c\u4e00\u6b21 DSH Web RPC\uff1a\u5148\u6362\u53d6\u4f1a\u8bdd cookie\uff0c\u518d\u5e26 cookie \u8bf7\u6c42 /api\u3002 */
async function callDeepSeekHarnessRpc(method, payload) {
    const logTail = await readLinuxLogTail();
    const token = extractAuthTokenFromLog(logTail);
    const base = buildServerUrl();
    const jarPath = "/tmp/dsh_operit_rpc_cookies.txt";
    const bodyPath = "/tmp/dsh_operit_rpc_body.json";
    const outPath = "/tmp/dsh_operit_rpc_out.json";
    const rpcId = `operit-${method.replace(/[^a-z0-9.-]/gi, "-")}-${Date.now()}`;
    const envelope = JSON.stringify({ type: "client-request", rpcId, method, payload });
    const script = [
        buildRuntimeEnvironment(),
        `printf '%s' ${shellQuote(envelope)} > ${shellQuote(bodyPath)}`,
        `rm -f ${shellQuote(jarPath)}`,
        `if [ -n ${shellQuote(token ?? "")} ]; then curl -sS --max-time 10 -c ${shellQuote(jarPath)} -o /dev/null ${shellQuote(`${base}/?token=${token}`)} || true; fi`,
        `code="$(curl -sS --max-time 60 -b ${shellQuote(jarPath)} -H 'content-type: application/json' -X POST --data-binary @${shellQuote(bodyPath)} -o ${shellQuote(outPath)} -w '%{http_code}' ${shellQuote(`${base}/api/${method}`)} 2>/dev/null || true)"`,
        `echo "HTTP_CODE:$code"`,
        `cat ${shellQuote(outPath)} 2>/dev/null || true`,
    ].join("\n");
    const result = await executeRuntimeCommand(bashCommand(script), 70000);
    const output = typeof result?.output === "string" ? result.output : "";
    const lines = output.split(/\r?\n/);
    let statusCode = 0;
    let bodyStart = -1;
    for (let index = 0; index < lines.length; index += 1) {
        const found = /^HTTP_CODE:(\d+)$/.exec(lines[index].trim());
        if (found) {
            statusCode = Number(found[1]);
            bodyStart = index + 1;
        }
    }
    const content = bodyStart >= 0 ? lines.slice(bodyStart).join("\n").trim() : "";
    return { statusCode, content };
}

/** \u8bfb\u53d6 DSH \u5de5\u4f5c\u533a\u5b58\u50a8\uff08rc.2 \u6ca1\u6709 workspace/list \u7aef\u70b9\uff0c\u7528\u4f5c\u540e\u5907\uff09\u3002 */
async function readDeepSeekHarnessWorkspaceStorage() {
    try {
        const storagePath = `${DSH_HOME_DIR}/storages/workspace.json`;
        const exists = await Tools.Files.exists(storagePath, "linux");
        if (!exists || exists.exists !== true) {
            return { items: [] };
        }
        const file = await Tools.Files.read({ path: storagePath, environment: "linux" });
        const parsed = JSON.parse(file.content);
        const table = parsed && parsed.tables && parsed.tables.workspaces;
        const items = table && typeof table === "object"
            ? Object.values(table).filter((entry) => entry && typeof entry === "object")
            : [];
        return { items };
    }
    catch (error) {
        return { items: [] };
    }
}
function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
function reportProgress(onProgress, message, progress, output) {
    if (onProgress === undefined) {
        return;
    }
    onProgress({ message, progress, output });
}
function buildRuntimeEnvironment() {
    return [
        `export HOME=${shellQuote("/root")}`,
        `export PNPM_HOME=${shellQuote(LINUX_PNPM_HOME)}`,
        'export PATH="$PNPM_HOME:$PATH"',
        `export DSH_HOME=${shellQuote(DSH_HOME_DIR)}`,
        'export BROWSER=/bin/true',
        `mkdir -p ${shellQuote(LINUX_RUNTIME_DIR)}`,
        `mkdir -p ${shellQuote(DSH_HOME_DIR)}`,
        `mkdir -p ${shellQuote(LINUX_PNPM_HOME)}`,
    ].join("\n");
}
async function getTerminalSessionId() {
    const session = await Tools.System.terminal.create(TERMINAL_SESSION_NAME);
    const sessionId = session.sessionId.trim();
    if (!sessionId) {
        throw new Error("DeepSeek Harness terminal session was not created.");
    }
    return sessionId;
}
async function executeRuntimeCommand(command, timeoutMs) {
    const sessionId = await getTerminalSessionId();
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
async function executeRuntimeCommandStreaming(command, timeoutMs, onProgress, onOutput) {
    const sessionId = await getTerminalSessionId();
    return Tools.System.terminal.execStreaming(sessionId, command, {
        timeoutMs,
        onIntermediateResult: (event) => {
            if (event.type !== "chunk" || event.chunk === null || event.chunk === undefined) {
                return;
            }
            onOutput?.(String(event.chunk));
            for (const runtimeEvent of parseRuntimeEvents(String(event.chunk))) {
                if (runtimeEvent.type === "install_progress") {
                    reportProgress(onProgress, runtimeEvent.message, runtimeEvent.progress);
                }
                else if (runtimeEvent.type === "install_output") {
                    reportProgress(onProgress, "正在安装 DeepSeek Harness", 55, runtimeEvent.output);
                }
            }
        },
    });
}
async function readLinuxLogTail() {
    try {
        const exists = await Tools.Files.exists(LINUX_LOG_PATH, "linux");
        if (!exists.exists) {
            return undefined;
        }
        const result = await Tools.Files.read({
            path: LINUX_LOG_PATH,
            environment: "linux",
        });
        const content = result.content.trim();
        if (!content) {
            return undefined;
        }
        return content.split(/\r?\n/).slice(-30).join("\n");
    }
    catch (error) {
        console.error("DeepSeek Harness log read failed", error);
        return undefined;
    }
}
async function readRuntimePid() {
    const exists = await Tools.Files.exists(LINUX_PID_PATH, "linux");
    if (!exists.exists) {
        return undefined;
    }
    const result = await Tools.Files.read({
        path: LINUX_PID_PATH,
        environment: "linux",
    });
    const pid = result.content.trim();
    return pid || undefined;
}
async function waitForLinuxPathGone(path, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const remaining = await Tools.Files.exists(path, "linux");
        if (!remaining.exists) {
            return true;
        }
        await sleep(250);
    }
    const remaining = await Tools.Files.exists(path, "linux");
    return !remaining.exists;
}
async function deleteLinuxPathIfExists(path, onProgress) {
    const exists = await Tools.Files.exists(path, "linux");
    if (!exists.exists) {
        onProgress?.(`跳过：${path} 不存在`);
        return;
    }
    onProgress?.(`开始删除：${path}`);
    // Keep one streamed line per filesystem entry for the installation-style log.
    // If the Android bridge stops forwarding a large stream, the deletion itself
    // may still finish in the terminal session, so confirm the target afterward.
    const command = [
        "cd /root || exit 72",
        `target=${shellQuote(path)}`,
        'if [ -e "$target" ] || [ -L "$target" ]; then',
        '  find "$target" -depth -print -delete',
        "  find_status=$?",
        "else",
        "  find_status=0",
        "fi",
        'if [ "$find_status" -ne 0 ]; then',
        "  exit \"$find_status\"",
        "fi",
        'if [ -e "$target" ] || [ -L "$target" ]; then',
        "  exit 1",
        "fi",
    ].join("\n");
    let deleteOutputBuffer = "";
    const streamDeleteOutput = (output) => {
        deleteOutputBuffer += String(output).replace(/\r/g, "");
        const lines = deleteOutputBuffer.split("\n");
        deleteOutputBuffer = lines.pop() || "";
        for (const line of lines) {
            const entry = line.trim();
            if (entry) {
                onProgress?.(`删除：${entry}`);
            }
        }
    };
    const flushDeleteOutput = () => {
        const entry = deleteOutputBuffer.trim();
        deleteOutputBuffer = "";
        if (entry) {
            onProgress?.(`删除：${entry}`);
        }
    };
    let result;
    try {
        result = await executeRuntimeCommandStreaming(bashCommand(command), 300000, undefined, streamDeleteOutput);
        flushDeleteOutput();
    }
    catch (error) {
        flushDeleteOutput();
        if (await waitForLinuxPathGone(path)) {
            onProgress?.(`删除完成：${path}`);
            return;
        }
        throw error;
    }
    if (typeof result?.exitCode === "number" && result.exitCode !== 0) {
        if (await waitForLinuxPathGone(path)) {
            onProgress?.(`删除完成：${path}`);
            return;
        }
        throw new Error(`删除命令返回退出码 ${result.exitCode}：${path}`);
    }
    if (!(await waitForLinuxPathGone(path))) {
        throw new Error(`删除命令完成但目标仍存在：${path}`);
    }
    onProgress?.(`删除完成：${path}`);
}
async function stopRuntimeForReset() {
    try {
        const pid = await readRuntimePid();
        if (pid === undefined || !/^[1-9][0-9]*$/.test(pid)) {
            return;
        }
        const command = [
            `pid=${shellQuote(pid)}`,
            "if kill -0 \"$pid\" >/dev/null 2>&1; then",
            `  if tr '\\0' '\\n' < \"/proc/$pid/environ\" 2>/dev/null | grep -Fx ${shellQuote(DSH_PROCESS_MARKER_ENV)} >/dev/null; then`,
            "    kill \"$pid\" >/dev/null 2>&1 || true",
            "    sleep 1",
            "    if kill -0 \"$pid\" >/dev/null 2>&1; then kill -9 \"$pid\" >/dev/null 2>&1 || true; fi",
            "  fi",
            "fi",
        ].join("\n");
        const result = await Tools.System.shell(command);
        if (typeof result.exitCode === "number" && result.exitCode !== 0) {
            console.warn("DeepSeek Harness reset stop command returned a non-zero exit code", result.exitCode);
        }
    }
    catch (error) {
        console.warn("DeepSeek Harness reset process stop failed; continuing with directory deletion", error);
    }
}
async function isDshRuntimeInstalled() {
    const [manifest, cli] = await Promise.all([
        Tools.Files.exists(DSH_PACKAGE_MANIFEST_PATH, "linux"),
        Tools.Files.exists(DSH_CLI_PATH, "linux"),
    ]);
    return manifest.exists && cli.exists;
}
async function isDeepSeekHarnessRuntimeInstalled() {
    return isDshRuntimeInstalled();
}
function readVersionEvent(events, source) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const runtimeEvent = events[index];
        if (runtimeEvent !== undefined &&
            runtimeEvent.type === "version" &&
            runtimeEvent.source === source) {
            return runtimeEvent.version;
        }
    }
    return undefined;
}
function readVersionFailureEvent(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const runtimeEvent = events[index];
        if (runtimeEvent !== undefined && runtimeEvent.type === "version_failure") {
            return runtimeEvent.message;
        }
    }
    return undefined;
}
async function readInstalledDshVersion() {
    if (!(await isDshRuntimeInstalled())) {
        return undefined;
    }
    // Read the absolute manifest through the Linux file API. A terminal-relative
    // require here would inspect /root after a new session and misreport a valid installation.
    try {
        const result = await Tools.Files.read({
            path: DSH_PACKAGE_MANIFEST_PATH,
            environment: "linux",
        });
        const manifest = JSON.parse(result.content);
        if (typeof manifest.version !== "string" || !isDshVersion(manifest.version)) {
            throw new Error("DeepSeek Harness package.json does not contain a valid version.");
        }
        return manifest.version;
    }
    catch (error) {
        console.error("DeepSeek Harness installed version read failed", error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法读取已安装的 DeepSeek Harness 版本：${message}`);
    }
}
function responseContent(response) {
    if (typeof response?.content === "string") {
        return response.content;
    }
    if (response?.content === undefined || response?.content === null) {
        return "";
    }
    return String(response.content);
}
function normalizeReleaseVersion(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().replace(/^dsh-v/i, "").replace(/^v/i, "");
}
function compareDshVersions(leftValue, rightValue) {
    const parse = (value) => {
        const normalized = normalizeReleaseVersion(value);
        const match = normalized.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-(.+))?$/);
        if (!match) {
            return undefined;
        }
        return {
            numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
            prerelease: match[4] ? match[4].split(".") : [],
        };
    };
    const left = parse(leftValue);
    const right = parse(rightValue);
    if (!left || !right) {
        return String(leftValue).localeCompare(String(rightValue));
    }
    for (let index = 0; index < left.numbers.length; index += 1) {
        if (left.numbers[index] !== right.numbers[index]) {
            return left.numbers[index] > right.numbers[index] ? 1 : -1;
        }
    }
    if (left.prerelease.length === 0 && right.prerelease.length > 0) {
        return 1;
    }
    if (left.prerelease.length > 0 && right.prerelease.length === 0) {
        return -1;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === rightPart) {
            continue;
        }
        if (leftPart === undefined) {
            return -1;
        }
        if (rightPart === undefined) {
            return 1;
        }
        const leftNumeric = /^[0-9]+$/.test(leftPart);
        const rightNumeric = /^[0-9]+$/.test(rightPart);
        if (leftNumeric && rightNumeric) {
            return Number(leftPart) > Number(rightPart) ? 1 : -1;
        }
        if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        }
        return leftPart.localeCompare(rightPart);
    }
    return 0;
}
async function readDeepSeekHarnessReleaseNotes(version) {
    const normalizedVersion = normalizeReleaseVersion(version);
    if (!normalizedVersion) {
        throw new Error("发行版本号为空。");
    }
    const response = await Tools.Net.httpGet(DSH_RELEASES_API_URL);
    const content = responseContent(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitHub Releases 返回 HTTP ${response.statusCode}`);
    }
    const releases = JSON.parse(content);
    if (!Array.isArray(releases)) {
        throw new Error("GitHub Releases 返回了无效数据。");
    }
    const release = releases.find((entry) => entry && typeof entry === "object" && normalizeReleaseVersion(entry.tag_name) === normalizedVersion);
    if (!release) {
        return undefined;
    }
    return {
        version: normalizedVersion,
        tagName: typeof release.tag_name === "string" ? release.tag_name : normalizedVersion,
        name: typeof release.name === "string" && release.name.trim() ? release.name.trim() : `DeepSeek Harness ${normalizedVersion}`,
        publishedAt: typeof release.published_at === "string" ? release.published_at : "",
        body: typeof release.body === "string" && release.body.trim() ? release.body.trim() : "本次发行未提供更新说明。",
        url: typeof release.html_url === "string" ? release.html_url : "https://github.com/deepseek-ai/deepseek-harness/releases",
    };
}
async function readLatestDshVersion() {
    const response = await Tools.Net.httpGet(DSH_RELEASES_API_URL);
    const content = responseContent(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`GitHub Releases 返回 HTTP ${response.statusCode}`);
    }
    const releases = JSON.parse(content);
    if (!Array.isArray(releases)) {
        throw new Error("GitHub Releases 返回了无效数据。");
    }
    const versions = releases
        .filter((entry) => entry && typeof entry === "object" && entry.draft !== true)
        .map((entry) => normalizeReleaseVersion(entry.tag_name))
        .filter((version) => isDshVersion(version));
    if (versions.length === 0) {
        throw new Error("GitHub Releases 中没有找到有效的 DeepSeek Harness 版本。");
    }
    return versions.reduce((latest, candidate) => compareDshVersions(candidate, latest) > 0 ? candidate : latest);
}
async function isRuntimeProcessRunning(pid) {
    if (pid === undefined || !/^[1-9][0-9]*$/.test(pid)) {
        return false;
    }
    try {
        const result = await executeRuntimeCommand(bashCommand([
            buildRuntimeEventEmitterScript(),
            buildRuntimeProcessCheckScript(),
            `is_deepseek_harness_process ${shellQuote(pid)} report`,
        ].join("\n")), 10000);
        return parseRuntimeEvents(result.output).some((runtimeEvent) => runtimeEvent.type === "process_status" && runtimeEvent.running);
    }
    catch (error) {
        console.error("DeepSeek Harness process state check failed", error);
        return false;
    }
}
async function buildStartupDiagnostic(message) {
    const logTail = await readLinuxLogTail();
    if (logTail === undefined) {
        return message;
    }
    return `${message}\n\nLinux runtime log:\n${logTail}`;
}
function readInstallResultEvent(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const runtimeEvent = events[index];
        if (runtimeEvent !== undefined && runtimeEvent.type === "install_result") {
            return runtimeEvent;
        }
    }
    return undefined;
}
function buildInstallDiagnostic(output) {
    const events = parseRuntimeEvents(output);
    const installResult = readInstallResultEvent(events);
    const recentOutput = events
        .filter((runtimeEvent) => runtimeEvent.type === "install_output")
        .slice(-8)
        .map((runtimeEvent) => runtimeEvent.output)
        .join("\n")
        .trim();
    if (installResult !== undefined) {
        const details = [];
        if (installResult.message !== undefined) {
            details.push(installResult.message);
        }
        if (installResult.command !== undefined) {
            details.push(`执行命令: ${installResult.command}`);
        }
        if (installResult.exitCode !== undefined) {
            details.push(`命令退出码: ${installResult.exitCode}`);
        }
        if (recentOutput) {
            details.push(`命令输出:\n${recentOutput}`);
        }
        return details.join("\n\n");
    }
    const rawOutput = output.trim();
    if (rawOutput) {
        return [
            "安装命令未返回结构化结果。以下是终端原始输出：",
            rawOutput.split(/\r?\n/).slice(-20).join("\n"),
        ].join("\n\n");
    }
    return "安装命令未返回结构化结果，并且终端没有产生输出。";
}
function installCompleted(exitCode, timedOut, output) {
    const installResult = readInstallResultEvent(parseRuntimeEvents(output));
    return (exitCode === 0 &&
        timedOut !== true &&
        installResult !== undefined &&
        installResult.status === "ready");
}
async function readDeepSeekHarnessWebFailure() {
    const logTail = await readLinuxLogTail();
    if (logTail === undefined) {
        return "DeepSeek Harness Web stopped before the page could connect.";
    }
    const lines = logTail.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line !== undefined && line.trim()) {
            return `DeepSeek Harness Web stopped: ${line}`;
        }
    }
    return "DeepSeek Harness Web stopped before the page could connect.";
}
async function readHealth() {
    try {
        const logTail = await readLinuxLogTail();
        const healthUrl = shellQuote(buildAuthenticatedServerUrl(extractAuthTokenFromLog(logTail)));
        const nodeHealthScript = "const http = require('node:http'); const target = process.argv[1]; const req = http.get(target, { timeout: 5000 }, (res) => { console.log(res.statusCode); res.resume(); }); req.on('timeout', () => req.destroy()); req.on('error', () => {});";
        const healthPath = shellQuote(LINUX_HEALTH_PATH);
        await executeRuntimeCommand(bashCommand([
            buildRuntimeEnvironment(),
            buildRuntimeEventEmitterScript(),
            `rm -f ${healthPath}`,
            "if command -v curl >/dev/null 2>&1; then",
            `  health_code=\"$(curl --connect-timeout 2 --max-time 5 -sS -o /dev/null -w '%{http_code}' ${healthUrl} 2>/dev/null || true)\"`,
            "else",
            `  health_code=\"$(node -e ${shellQuote(nodeHealthScript)} ${healthUrl} 2>/dev/null | tail -1)\"`,
            "fi",
            "case \"$health_code\" in",
            "  2??|3??|401) printf '{\"ok\":true,\"statusCode\":%s,\"message\":\"ready\"}\\n' \"$health_code\" > " + healthPath + "; runtime_event health true \"$health_code\" 'DeepSeek Harness Web is ready.' ;;",
            "  *) printf '{\"ok\":false,\"statusCode\":%s,\"message\":\"not reachable\"}\\n' \"${health_code:-0}\" > " + healthPath + "; runtime_event health false \"${health_code:-0}\" 'DeepSeek Harness is not reachable inside the Linux runtime.' ;;",
            "esac",
        ].join("\n")), 10000);
        const healthFile = await Tools.Files.read({
            path: LINUX_HEALTH_PATH,
            environment: "linux",
        });
        const healthRecord = JSON.parse(healthFile.content);
        if (typeof healthRecord.ok === "boolean" && typeof healthRecord.statusCode === "number") {
            return {
                ok: healthRecord.ok,
                message: healthRecord.ok
                    ? `DeepSeek Harness Web is ready inside the Linux runtime (HTTP ${healthRecord.statusCode}).`
                    : `DeepSeek Harness is not reachable inside the Linux runtime (HTTP ${healthRecord.statusCode || 0}).`,
            };
        }
        return { ok: false, message: "Linux runtime health check returned an invalid result." };
    }
    catch {
        return { ok: false, message: "DeepSeek Harness is not reachable inside the Linux runtime." };
    }
}
async function waitForHealth(onProgress) {
    const deadline = Date.now() + STARTUP_HEALTH_WAIT_MS;
    let latest = await readHealth();
    while (!latest.ok && Date.now() < deadline) {
        reportProgress(onProgress, "正在等待 DeepSeek Harness Web 服务响应", 88);
        await sleep(1000);
        latest = await readHealth();
    }
    return latest;
}
async function stopRuntime() {
    const command = bashCommand([
        buildRuntimeEnvironment(),
        buildRuntimeEventEmitterScript(),
        buildRuntimeProcessCheckScript(),
        `if [ -f ${shellQuote(LINUX_PID_PATH)} ]; then`,
        `  pid="$(cat ${shellQuote(LINUX_PID_PATH)})"`,
        "  if is_deepseek_harness_process \"$pid\"; then",
        "    kill \"$pid\" >/dev/null 2>&1 || true",
        "    sleep 1",
        "    if is_deepseek_harness_process \"$pid\"; then kill -9 \"$pid\" >/dev/null 2>&1 || true; sleep 1; fi",
        "  fi",
        "  if ! is_deepseek_harness_process \"$pid\"; then",
        `    rm -f ${shellQuote(LINUX_PID_PATH)}`,
        "  fi",
        "fi",
    ].join("\n"));
    await executeRuntimeCommand(command, 10000);
}
async function readDeepSeekHarnessWebServerStatus() {
    const [health, pid, logTail] = await Promise.all([
        readHealth(),
        readRuntimePid(),
        readLinuxLogTail(),
    ]);
    const processRunning = await isRuntimeProcessRunning(pid);
    const status = health.ok ? "running" : processRunning ? "starting" : "stopped";
    return {
        success: health.ok,
        status,
        message: processRunning && !health.ok ? "DeepSeek Harness Web is starting." : health.message,
        url: buildAuthenticatedServerUrl(extractAuthTokenFromLog(logTail)),
        port: DEFAULT_PORT,
        runtimeDir: LINUX_RUNTIME_DIR,
        dshHomeDir: DSH_HOME_DIR,
        logPath: LINUX_LOG_PATH,
        pid,
        logTail,
    };
}
async function inspectDeepSeekHarnessRuntime(params = {}) {
    reportProgress(params.onProgress, "正在检查本地 DeepSeek Harness", 8);
    try {
        const installedVersion = await readInstalledDshVersion();
        if (installedVersion === undefined) {
            return {
                status: "uninitialized",
                message: "DeepSeek Harness 尚未初始化。",
            };
        }
        reportProgress(params.onProgress, "正在检查 DeepSeek Harness 更新", 20);
        const latestVersion = await readLatestDshVersion();
        const versionComparison = compareDshVersions(latestVersion, installedVersion);
        if (versionComparison <= 0) {
            const message = versionComparison === 0
                ? `DeepSeek Harness ${installedVersion} 已是最新版本。`
                : `当前 DeepSeek Harness ${installedVersion} 高于 GitHub Releases 最新版本 ${latestVersion}，不会降级。`;
            return {
                status: "ready",
                message,
                installedVersion,
                latestVersion,
            };
        }
        return {
            status: "update_available",
            message: `发现 DeepSeek Harness ${latestVersion}。`,
            installedVersion,
            latestVersion,
        };
    }
    catch (error) {
        console.error("DeepSeek Harness runtime inspection failed", error);
        const diagnostic = error instanceof Error ? error.message : String(error);
        return {
            status: "failed",
            message: "无法完成 DeepSeek Harness 版本检查。",
            diagnostic,
        };
    }
}
function buildNodePtySetupScript() {
    // The Android Linux container can make node-gyp's Release output a symlink
    // into obj.target. node-pty's postinstall removes obj.target afterwards,
    // so keep a dereferenced native binary before validating the module. pnpm
    // reserves the install command for dependency installation, so invoke its
    // bundled node-gyp entry directly instead of running the package lifecycle.
    return [
        "node_pty_store_dir=\"$(find node_modules/.pnpm -maxdepth 1 -type d -name 'node-pty@*' -print -quit)\"",
        "if [ -z \"$node_pty_store_dir\" ]; then",
        "  runtime_fail 15 'node-pty was not installed with the DeepSeek Harness runtime.' 'find node_modules/.pnpm -maxdepth 1 -type d -name node-pty@*'",
        "fi",
        "node_pty_dir=\"$node_pty_store_dir/node_modules/node-pty\"",
        "node_pty_release_path=\"$node_pty_dir/build/Release/pty.node\"",
        "if [ ! -f \"$node_pty_release_path\" ]; then",
        "  node_gyp_script=\"$(find /usr/lib/node_modules /usr/local/lib/node_modules /root/.local/share/pnpm -path '*/node-gyp/bin/node-gyp.js' -type f -print -quit 2>/dev/null)\"",
        "  if [ -z \"$node_gyp_script\" ]; then",
        "    runtime_fail 17 'pnpm node-gyp entry was not found in the Linux runtime.' 'find pnpm node-gyp/bin/node-gyp.js'",
        "  fi",
        "  if ! (cd \"$node_pty_dir\" && node \"$node_gyp_script\" rebuild --nodedir=/usr) 2>&1 | runtime_output; then",
        "    runtime_fail 16 'node-pty native module build failed.' 'node node-gyp.js rebuild --nodedir=/usr'",
        "  fi",
        "fi",
        "if [ ! -f \"$node_pty_release_path\" ]; then",
        "  runtime_fail 16 'node-pty native module build did not produce build/Release/pty.node.' 'test -f node-pty/build/Release/pty.node'",
        "fi",
        "if [ -L \"$node_pty_release_path\" ]; then",
        "  node_pty_copy_path=\"$node_pty_release_path.operit-copy\"",
        "  if ! cp -L \"$node_pty_release_path\" \"$node_pty_copy_path\"; then",
        "    runtime_fail 16 'node-pty native module copy failed.' 'cp -L node-pty/build/Release/pty.node'",
        "  fi",
        "  if ! rm -f \"$node_pty_release_path\"; then",
        "    runtime_fail 16 'node-pty native module replacement failed.' 'rm -f node-pty/build/Release/pty.node'",
        "  fi",
        "  if ! mv \"$node_pty_copy_path\" \"$node_pty_release_path\"; then",
        "    runtime_fail 16 'node-pty native module finalization failed.' 'mv node-pty/build/Release/pty.node.operit-copy node-pty/build/Release/pty.node'",
        "  fi",
        "fi",
        // find returns node_pty_dir relative to the runtime directory. Node treats a
        // path without ./ as a package name, so this must be an explicit file path.
        "if ! node -e \"require(process.argv[1])\" \"./$node_pty_dir\" 2>&1 | runtime_output; then",
        "  runtime_fail 18 'node-pty native module could not be loaded.' 'node -e require(node-pty)'",
        "fi",
    ].join("\n");
}
function buildRuntimeProcessCheckScript() {
    return [
        "is_deepseek_harness_process() {",
        "  runtime_pid=\"$1\"",
        "  if [ -z \"$runtime_pid\" ] || ! kill -0 \"$runtime_pid\" >/dev/null 2>&1; then",
        "    return 1",
        "  fi",
        `  if tr '\\0' '\\n' < \"/proc/$runtime_pid/environ\" 2>/dev/null | grep -Fx ${shellQuote(DSH_PROCESS_MARKER_ENV)} >/dev/null; then`,
        "    if [ \"$2\" = report ]; then",
        "      runtime_event process_status true",
        "    fi",
        "    return 0",
        "  fi",
        "  return 1",
        "}",
    ].join("\n");
}
function buildNativeBuildToolsPreparationScript() {
    return [
        "if ! command -v gcc >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1; then",
        "  export DEBIAN_FRONTEND=noninteractive",
        "  runtime_progress 35 '正在配置 Linux 软件包'",
        "  if ! dpkg --configure -a 2>&1 | runtime_output; then",
        "    runtime_fail 23 'Linux package configuration failed before DeepSeek Harness installation.' 'dpkg --configure -a'",
        "  fi",
        "  runtime_progress 40 '正在更新 Linux 软件包索引'",
        "  if ! apt-get update 2>&1 | runtime_output; then",
        "    runtime_fail 23 'Linux package index update failed before DeepSeek Harness installation.' 'apt-get update'",
        "  fi",
        "  runtime_progress 46 '正在安装 Linux 编译工具'",
        "  if ! apt-get install -y --no-install-recommends build-essential 2>&1 | runtime_output; then",
        "    runtime_fail 23 'build-essential installation failed before DeepSeek Harness installation.' 'apt-get install -y --no-install-recommends build-essential'",
        "  fi",
        "fi",
    ].join("\n");
}
function buildPnpmBuildApprovalScript() {
    const config = [
        "allowBuilds:",
        ...DSH_ALLOWED_BUILD_PACKAGES.map((packageName) => `  ${JSON.stringify(packageName)}: true`),
        "",
    ].join("\n");
    return `printf %s ${shellQuote(config)} > ${shellQuote(PNPM_WORKSPACE_PATH)}`;
}
async function installRuntime(onProgress, targetVersion) {
    const command = bashCommand([
        buildRuntimeEnvironment(),
        "if ! command -v node >/dev/null 2>&1; then",
        `  printf '%s\\n' ${shellQuote(JSON.stringify({
            type: "install_result",
            status: "failed",
            message: "Node.js is required in the Linux runtime.",
            command: "command -v node",
            exitCode: 11,
        }))}`,
        "  exit 11",
        "fi",
        buildRuntimeEventEmitterScript(),
        "set -o pipefail",
        "runtime_progress() { runtime_event install_progress \"$1\" \"$2\"; }",
        "runtime_fail() { runtime_event install_result failed \"$2\" \"$3\" \"$1\"; exit \"$1\"; }",
        "runtime_progress 20 '正在检查 Node.js 与 pnpm'",
        "if ! command -v pnpm >/dev/null 2>&1; then",
        "  runtime_fail 12 'pnpm is required in the Linux runtime.' 'command -v pnpm'",
        "fi",
        `cd ${shellQuote(LINUX_RUNTIME_DIR)}`,
        buildNativeBuildToolsPreparationScript(),
        "runtime_progress 52 '正在配置 pnpm 依赖构建策略'",
        buildPnpmBuildApprovalScript(),
        "if [ ! -f package.json ]; then",
        "  runtime_progress 56 '正在创建 DeepSeek Harness 运行时'",
        "  if ! pnpm init 2>&1 | runtime_output; then",
        "    runtime_fail 20 'DeepSeek Harness runtime package initialization failed.' 'pnpm init'",
        "  fi",
        "fi",
        "runtime_progress 60 '正在使用 GitHub Releases 最新版本'",
        `target_version=${shellQuote(targetVersion)}`,
        "if [ -z \"$target_version\" ]; then",
        "  runtime_fail 24 'GitHub Releases did not provide a valid DeepSeek Harness version.' 'GitHub Releases version resolution'",
        "fi",
        "printf '%s\\n' \"目标版本 $target_version\" | runtime_output",
        "runtime_progress 64 '正在安装 DeepSeek Harness'",
        `if ! pnpm add --prod "${DSH_PACKAGE_NAME}@$target_version" --reporter=append-only 2>&1 | runtime_output; then`,
        `  runtime_fail 21 'Failed to install the resolved DeepSeek Harness version.' 'pnpm add --prod ${DSH_PACKAGE_NAME}@<version> --reporter=append-only'`,
        "fi",
        "runtime_progress 76 '正在执行依赖构建脚本'",
        "if ! pnpm install --prod --reporter=append-only 2>&1 | runtime_output; then",
        "  runtime_fail 22 'Failed to run approved DeepSeek Harness dependency build scripts.' 'pnpm install --prod --reporter=append-only'",
        "fi",
        "if [ ! -x node_modules/.bin/dsh ]; then",
        "  runtime_fail 13 'DeepSeek Harness CLI was not installed.' 'test -x node_modules/.bin/dsh'",
        "fi",
        "if ! installed_version=\"$(node -p \"require('./node_modules/@deepseek-ai/dsh/package.json').version\")\"; then",
        "  runtime_fail 14 'Could not read the installed DeepSeek Harness version.' 'node -p require(@deepseek-ai/dsh/package.json).version'",
        "fi",
        "if [ -z \"$installed_version\" ]; then",
        "  runtime_fail 14 'Installed DeepSeek Harness version is empty.' 'test -n installed_version'",
        "fi",
        "runtime_progress 82 '已确认 DeepSeek Harness 版本'",
        "if [ \"$installed_version\" != \"$target_version\" ]; then",
        "  runtime_fail 25 \"DeepSeek Harness 版本未更新：仍为 $installed_version，目标 $target_version\" 'version verification'",
        "fi",
        "printf '%s\\n' \"已安装版本 $installed_version\" | runtime_output",
        "runtime_progress 86 '正在准备 node-pty 原生模块'",
        buildNodePtySetupScript(),
        "runtime_progress 96 '正在验证 DeepSeek Harness'",
        "if ! ./node_modules/.bin/dsh --version 2>&1 | runtime_output; then",
        "  runtime_fail 19 'DeepSeek Harness CLI could not be executed.' './node_modules/.bin/dsh --version'",
        "fi",
        "runtime_event install_result ready",
    ].join("\n"));
    return executeRuntimeCommandStreaming(command, 300000, onProgress);
}
async function installDeepSeekHarnessRuntime(params = {}) {
    reportProgress(params.onProgress, "正在准备 DeepSeek Harness 安装", 12);
    try {
        reportProgress(params.onProgress, "正在读取 GitHub Releases 最新版本", 16);
        const targetVersion = await readLatestDshVersion();
        const installedVersion = (await isDshRuntimeInstalled())
            ? await readInstalledDshVersion()
            : undefined;
        if (installedVersion !== undefined && compareDshVersions(targetVersion, installedVersion) <= 0) {
            return {
                success: true,
                message: compareDshVersions(targetVersion, installedVersion) === 0
                    ? `DeepSeek Harness ${installedVersion} 已是最新版本，无需安装。`
                    : `当前版本 ${installedVersion} 高于目标版本 ${targetVersion}，已阻止降级。`,
                skipped: true,
                installedVersion,
                targetVersion,
            };
        }
        const installResult = await installRuntime(params.onProgress, targetVersion);
        if (installCompleted(installResult.exitCode, installResult.timedOut, installResult.output)) {
            return {
                success: true,
                message: "DeepSeek Harness 已安装。",
            };
        }
        const structuredResult = readInstallResultEvent(parseRuntimeEvents(installResult.output));
        return {
            success: false,
            message: "DeepSeek Harness 安装失败。",
            executedCommand: structuredResult?.command ?? installResult.command,
            installExitCode: installResult.exitCode,
            installTimedOut: installResult.timedOut,
            installOutput: installResult.output,
            diagnostic: buildInstallDiagnostic(installResult.output),
        };
    }
    catch (error) {
        console.error("DeepSeek Harness runtime installation failed", error);
        const diagnostic = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            message: "DeepSeek Harness 安装命令无法执行。",
            diagnostic,
        };
    }
}
async function startRuntime() {
    const sessionId = await getTerminalSessionId();
    const command = bashCommand([
        buildRuntimeEnvironment(),
        buildRuntimeEventEmitterScript(),
        buildRuntimeProcessCheckScript(),
        `cd ${shellQuote(LINUX_RUNTIME_DIR)}`,
        `if [ -f ${shellQuote(LINUX_PID_PATH)} ]; then`,
        `  pid="$(cat ${shellQuote(LINUX_PID_PATH)})"`,
        "  if is_deepseek_harness_process \"$pid\"; then",
        "    kill \"$pid\" >/dev/null 2>&1",
        "  fi",
        `  rm -f ${shellQuote(LINUX_PID_PATH)}`,
        "fi",
        `: > ${shellQuote(LINUX_LOG_PATH)}`,
        // Detach DSH from the terminal session so sidebar navigation cannot terminate Web and PTY work.
        // rc.8 supports --no-open; keep BROWSER=/bin/true as a second line of defense on Android.
        `${DSH_PROCESS_MARKER_ENV} setsid nohup ./node_modules/.bin/dsh web --host ${LOOPBACK_HOST} --port ${DEFAULT_PORT} --trusted-host ${LOOPBACK_HOST}:${DEFAULT_PORT} --no-open >> ${shellQuote(LINUX_LOG_PATH)} 2>&1 &`,
        `echo $! > ${shellQuote(LINUX_PID_PATH)}`,
    ].join("\n"));
    await Tools.System.terminal.execStreaming(sessionId, command, {
        timeoutMs: 10000,
    });
    return sessionId;
}
function buildResult(success, status, message, url) {
    return {
        success,
        status,
        message,
        url: url ?? buildServerUrl(),
        port: DEFAULT_PORT,
        runtimeDir: LINUX_RUNTIME_DIR,
        dshHomeDir: DSH_HOME_DIR,
        logPath: LINUX_LOG_PATH,
    };
}
async function startDeepSeekHarnessWebServer(params = {}) {
    reportProgress(params.onProgress, "正在检查 DeepSeek Harness Web", 40);
    if (!(await isDshRuntimeInstalled())) {
        return buildResult(false, "failed", "DeepSeek Harness 尚未初始化。");
    }
    const existingHealth = await readHealth();
    if (existingHealth.ok && !params.forceRestart) {
        return buildResult(true, "running", existingHealth.message, await resolveAuthenticatedServerUrl());
    }
    if (params.forceRestart) {
        reportProgress(params.onProgress, "正在停止 DeepSeek Harness Web", 50);
        await stopRuntime();
    }
    else {
        const existingPid = await readRuntimePid();
        if (await isRuntimeProcessRunning(existingPid)) {
            reportProgress(params.onProgress, "正在等待 DeepSeek Harness Web 服务响应", 80);
            const health = await waitForHealth(params.onProgress);
            if (health.ok) {
                return buildResult(true, "running", health.message, await resolveAuthenticatedServerUrl());
            }
            const result = buildResult(false, "failed", "DeepSeek Harness Web is still starting.");
            result.diagnostic = await buildStartupDiagnostic(health.message);
            result.logTail = await readLinuxLogTail();
            return result;
        }
    }
    reportProgress(params.onProgress, "正在启动 DeepSeek Harness Web", 80);
    const sessionId = await startRuntime();
    const health = await waitForHealth(params.onProgress);
    if (!health.ok) {
        const result = buildResult(false, "failed", "DeepSeek Harness Web did not become ready within 2 minutes.");
        result.sessionId = sessionId;
        result.diagnostic = await buildStartupDiagnostic(health.message);
        result.logTail = await readLinuxLogTail();
        return result;
    }
    const result = buildResult(true, "started", health.message, await resolveAuthenticatedServerUrl());
    result.sessionId = sessionId;
    return result;
}
async function resetDeepSeekHarnessRuntime(params = {}) {
    const onProgress = params.onProgress;
    try {
        onProgress?.("正在停止 DeepSeek Harness Web 服务");
        await stopRuntimeForReset();
        await deleteLinuxPathIfExists(LINUX_RUNTIME_DIR, onProgress);
        await deleteLinuxPathIfExists(LINUX_WORKSPACE_DIR, onProgress);
        onProgress?.("重置完成");
        return {
            success: true,
            status: "reset",
            message: "DeepSeek Harness 运行时和工作流目录已删除。",
        };
    }
    catch (error) {
        console.error("DeepSeek Harness runtime reset failed", error);
        const diagnostic = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            status: "failed",
            message: "DeepSeek Harness 重置命令无法执行。",
            diagnostic,
        };
    }
}
async function stopDeepSeekHarnessWebServer() {
    await stopRuntime();
    let status = await readDeepSeekHarnessWebServerStatus();
    for (let attempt = 0; attempt < 10 && status.status !== "stopped"; attempt += 1) {
        await sleep(250);
        status = await readDeepSeekHarnessWebServerStatus();
    }
    if (status.status === "stopped") {
        return {
            ...status,
            success: true,
            status: "stopped",
            message: "DeepSeek Harness Web stopped.",
        };
    }
    return {
        ...status,
        success: false,
        message: status.message || "DeepSeek Harness Web did not stop.",
    };
}
