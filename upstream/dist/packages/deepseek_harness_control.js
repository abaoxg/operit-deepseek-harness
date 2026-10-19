"use strict";
/* METADATA
{
  "name": "deepseek_harness_control",
  "display_name": {
    "zh": "DeepSeek Harness Control",
    "en": "DeepSeek Harness Control"
  },
  "description": {
    "zh": "通过本机 DeepSeek Harness Web RPC 列出对话、设置界面主题、创建或复用会话，并发送消息后返回最终回复。",
    "en": "List conversations, set the interface theme, create or reuse a local DeepSeek Harness session, and send messages through Web RPC."
  },
  "enabled_by_default": true,
  "category": "System",
  "tools": [
    {
      "name": "usage_advice",
      "description": {
        "zh": "DeepSeek Harness 对话工具使用建议。",
        "en": "DeepSeek Harness conversation tool usage advice."
      },
      "parameters": [],
      "advice": true
    },
    {
      "name": "list_deepseek_harness_conversations",
      "description": {
        "zh": "列出 DeepSeek Harness 当前所有普通非空对话，返回标题和会话 ID。",
        "en": "List all current ordinary non-empty DeepSeek Harness conversations with titles and session IDs."
      },
      "parameters": []
    },
    {
      "name": "get_deepseek_harness_theme",
      "description": {
        "zh": "读取 DeepSeek Harness 当前持久化的界面主题。",
        "en": "Read the current persisted DeepSeek Harness interface theme."
      },
      "parameters": []
    },
    {
      "name": "set_deepseek_harness_theme",
      "description": {
        "zh": "设置 DeepSeek Harness 界面主题并持久化。支持 light（亮色）、dark（暗色）和 system（跟随系统）。",
        "en": "Set and persist the DeepSeek Harness interface theme: light, dark, or system."
      },
      "parameters": [
        {
          "name": "theme",
          "description": {
            "zh": "主题模式：light、dark 或 system。",
            "en": "Theme preference: light, dark, or system."
          },
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "name": "set_deepseek_harness_workspace",
      "description": {
        "zh": "将一个已存在的目录设置为 DeepSeek Harness 工作区；已注册时直接复用。",
        "en": "Set an existing directory as a DeepSeek Harness workspace, reusing it when already registered."
      },
      "parameters": [
        {
          "name": "path",
          "description": {
            "zh": "工作区绝对路径。",
            "en": "Absolute workspace directory path."
          },
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "name": "get_deepseek_harness_workspace_path",
      "description": {
        "zh": "读取 DeepSeek Harness 当前工作区路径（最近更新的已注册工作区）。",
        "en": "Read the current DeepSeek Harness workspace path (the most recently updated registered workspace)."
      },
      "parameters": []
    },
    {
      "name": "send_deepseek_harness_message",
      "description": {
        "zh": "通过 DeepSeek Harness Web RPC 发送一条文本消息，并等待当前回复完成。",
        "en": "Send one text message through DeepSeek Harness Web RPC and wait for the current reply to finish."
      },
      "parameters": [
        {
          "name": "message",
          "description": {
            "zh": "发送给 DeepSeek Harness 的消息内容。",
            "en": "Message content to send to DeepSeek Harness."
          },
          "type": "string",
          "required": true
        },
        {
          "name": "session_id",
          "description": {
            "zh": "可选的现有 DSH 会话 ID；不传时创建新会话。",
            "en": "Existing DSH session ID; a new session is created when omitted."
          },
          "type": "string",
          "required": false
        },
        {
          "name": "mode",
          "description": {
            "zh": "发送模式：queue（排队，默认）或 steer（中断当前回合并引导）。",
            "en": "Delivery mode: queue (default) or steer (interrupt and guide the active turn)."
          },
          "type": "string",
          "required": false
        },
        {
          "name": "timeout_ms",
          "description": {
            "zh": "等待最终回复的超时毫秒数，默认 120000，范围 1000-300000。",
            "en": "Timeout in milliseconds while waiting for the final reply; default 120000, range 1000-300000."
          },
          "type": "number",
          "required": false
        }
      ]
    }
  ]
}
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.usage_advice = usage_advice;
exports.list_deepseek_harness_conversations = list_deepseek_harness_conversations;
exports.get_deepseek_harness_theme = get_deepseek_harness_theme;
exports.set_deepseek_harness_theme = set_deepseek_harness_theme;
exports.set_deepseek_harness_workspace = set_deepseek_harness_workspace;
exports.get_deepseek_harness_workspace_path = get_deepseek_harness_workspace_path;
exports.send_deepseek_harness_message = send_deepseek_harness_message;
const deepseek_harness_web_runtime_js_1 = require("../shared/deepseek_harness_web_runtime.js");
const HISTORY_PAGE_MESSAGES = 50;
const THEME_NAMESPACE = "ui-theme";
const THEME_PREFERENCE_FIELD = "preference";
const THEME_PREFERENCES = ["light", "dark", "system"];
const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
let rpcCounter = 0;
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function errorMessage(error) {
    if (error instanceof Error) {
        return error.message || "Unknown error";
    }
    return String(error);
}
function nextRpcId(method) {
    rpcCounter += 1;
    return `operit-${method.replace(/[^a-z0-9.-]/gi, "-")}-${Date.now()}-${rpcCounter}`;
}
function responseContent(response) {
    if (typeof response.content === "string") {
        return response.content;
    }
    if (response.content === undefined || response.content === null) {
        return "";
    }
    return String(response.content);
}
async function callDshRpc(method, payload) {
    const response = await (0, deepseek_harness_web_runtime_js_1.callDeepSeekHarnessRpc)(method, { args: payload });
    const content = responseContent(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`DSH ${method} returned HTTP ${response.statusCode}: ${content.slice(0, 1000)}`);
    }
    let body;
    try {
        body = JSON.parse(content);
    }
    catch {
        throw new Error(`DSH ${method} returned invalid JSON: ${content.slice(0, 1000)}`);
    }
    const result = body.result;
    if (!isRecord(result)) {
        throw new Error(`DSH ${method} returned a response without a result.`);
    }
    if (result.ok !== true) {
        const rpcError = isRecord(result.error) ? result.error : {};
        const code = typeof rpcError.code === "string" ? rpcError.code : "RPC_ERROR";
        const message = typeof rpcError.message === "string"
            ? rpcError.message
            : "DSH RPC request failed.";
        const failure = new Error(`DSH ${method} failed: ${code}: ${message}`);
        failure.dshCode = code;
        throw failure;
    }
    return result.value;
}
function projectionTitleOf(item) {
    if (!isRecord(item.projections) || !isRecord(item.projections.values)) {
        return undefined;
    }
    const title = item.projections.values.title;
    if (typeof title !== "string" || title.trim() === "") {
        return undefined;
    }
    return title;
}
function workspaceBasename(value) {
    if (typeof value !== "string" || value === "") {
        return "";
    }
    const withoutTrailingSeparators = value.replace(/[\\/]+$/, "");
    if (withoutTrailingSeparators === "") {
        return "";
    }
    const parts = withoutTrailingSeparators.split(/[\\/]/);
    return parts[parts.length - 1] || "";
}
function parseConversationRow(value, index) {
    if (!isRecord(value)) {
        throw new Error(`DSH session.list returned an invalid item at index ${index}.`);
    }
    if (typeof value.sessionId !== "string" || value.sessionId.trim() === "") {
        throw new Error(`DSH session.list item ${index} has no valid sessionId.`);
    }
    if (typeof value.blank !== "boolean") {
        throw new Error(`DSH session.list item ${index} has no valid blank flag.`);
    }
    const sessionId = value.sessionId.trim();
    const title = projectionTitleOf(value) || workspaceBasename(value.cwd) || sessionId;
    return {
        blank: value.blank,
        subagent: value.origin === "subagent",
        conversation: {
            title,
            sessionId,
        },
    };
}
function emptyConversationResult() {
    return {
        success: false,
        status: "failed",
        count: 0,
        conversations: [],
    };
}
function parseDshError(error) {
    const typedError = error;
    return {
        ...emptyConversationResult(),
        message: errorMessage(error),
        ...(typeof typedError.dshCode === "string" ? { errorCode: typedError.dshCode } : {}),
    };
}
function parseMessage(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!Array.isArray(value)) {
        return "";
    }
    return value
        .map((part) => {
        if (!isRecord(part) || typeof part.text !== "string") {
            return "";
        }
        return part.text;
    })
        .join("");
}
function eventText(event) {
    if (!isRecord(event.data)) {
        return "";
    }
    const data = event.data;
    const nestedMessage = isRecord(data.message) ? data.message : undefined;
    if (nestedMessage !== undefined && "content" in nestedMessage) {
        return parseMessage(nestedMessage.content);
    }
    return parseMessage(data.content);
}
function eventSequence(event) {
    return typeof event.seq === "number" && Number.isFinite(event.seq) ? event.seq : -1;
}
function historyEvents(page) {
    if (!Array.isArray(page.events)) {
        return [];
    }
    return page.events
        .map((entry) => (isRecord(entry) && isRecord(entry.event) ? entry.event : undefined))
        .filter((event) => event !== undefined);
}
function highestSequence(events) {
    return events.reduce((highest, event) => Math.max(highest, eventSequence(event)), -1);
}
function extractTimeout(value) {
    if (value === undefined || value === null || value === "") {
        return DEFAULT_TIMEOUT_MS;
    }
    const timeout = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
        throw new Error(`timeout_ms must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
    }
    return timeout;
}
function extractMode(value) {
    if (value === undefined || value === null || value === "") {
        return "queue";
    }
    if (value === "queue" || value === "steer") {
        return value;
    }
    throw new Error('mode must be "queue" or "steer".');
}
function extractMessage(value) {
    if (typeof value !== "string") {
        throw new Error("message is required and must be a string.");
    }
    if (value.trim() === "") {
        throw new Error("message must not be empty.");
    }
    return value;
}
function extractSessionId(value) {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("session_id must be a non-empty string when provided.");
    }
    return value.trim();
}
function extractTheme(value) {
    if (typeof value !== "string" || !THEME_PREFERENCES.includes(value)) {
        throw new Error('theme must be "light", "dark", or "system".');
    }
    return value;
}
function extractWorkspacePath(value) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("path is required and must be a non-empty absolute path.");
    }
    const path = value.trim().replace(/[\\/]+$/, "") || "/";
    if (!path.startsWith("/")) {
        throw new Error("path must be an absolute Linux or Android storage path.");
    }
    return path;
}
function parseWorkspaceList(value) {
    if (!isRecord(value) || !Array.isArray(value.items)) {
        throw new Error("DSH workspace.list returned a response without an items array.");
    }
    return value.items.filter((item) => isRecord(item) && typeof item.path === "string" && typeof item.workspaceId === "string");
}
function currentWorkspace(items) {
    return [...items].sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""))[0];
}
function parseThemeDescriptor(value) {
    if (!isRecord(value) || value.ns !== THEME_NAMESPACE) {
        throw new Error("DSH settings returned an invalid ui-theme descriptor.");
    }
    const settings = value.value;
    if (!isRecord(settings) || !THEME_PREFERENCES.includes(settings[THEME_PREFERENCE_FIELD])) {
        throw new Error("DSH settings returned an invalid theme preference.");
    }
    if (!Number.isInteger(value.revision) || value.revision < 0) {
        throw new Error("DSH settings returned an invalid ui-theme revision.");
    }
    return {
        preference: settings[THEME_PREFERENCE_FIELD],
        revision: value.revision,
    };
}
function themeDescriptorFromDescribe(value) {
    if (!isRecord(value) || !Array.isArray(value.namespaces)) {
        throw new Error("DSH settings.describe returned an invalid response.");
    }
    if (value.writable !== true) {
        throw new Error("DSH settings provider is read-only.");
    }
    const descriptor = value.namespaces.find((candidate) => isRecord(candidate) && candidate.ns === THEME_NAMESPACE);
    if (descriptor === undefined) {
        throw new Error("DSH ui-theme settings are unavailable.");
    }
    return parseThemeDescriptor(descriptor);
}
async function ensureDeepSeekHarnessWeb() {
    const status = await (0, deepseek_harness_web_runtime_js_1.readDeepSeekHarnessWebServerStatus)();
    if (status.success) {
        return;
    }
    const started = await (0, deepseek_harness_web_runtime_js_1.startDeepSeekHarnessWebServer)();
    if (!started.success) {
        const diagnostic = started.diagnostic ? ` ${started.diagnostic}` : "";
        throw new Error(`${started.message}${diagnostic}`);
    }
}
async function readSessionCursor(sessionId) {
    const value = await callDshRpc("session/list", { _request: {} });
    const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
    const item = items.find((candidate) => isRecord(candidate) && candidate.sessionId === sessionId);
    if (item === undefined || !isRecord(item.projections) || typeof item.projections.asOfSeq !== "number") {
        return 0;
    }
    return item.projections.asOfSeq;
}
async function readSessionEvents(sessionId, throughSeq) {
    const value = await callDshRpc("session/page", {
        request: {
            address: { kind: "session", sessionId },
            throughSeq,
            maxMessages: HISTORY_PAGE_MESSAGES,
        },
    });
    const records = isRecord(value) && Array.isArray(value.records) ? value.records : [];
    return records
        .map((entry) => (isRecord(entry) && isRecord(entry.event) ? entry.event : undefined))
        .filter((event) => event !== undefined);
}
async function waitForAssistantReply(sessionId, message, baselineSeq, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastObservedUserSeq = baselineSeq;
    while (Date.now() < deadline) {
        const cursor = await readSessionCursor(sessionId);
        const events = await readSessionEvents(sessionId, cursor);
        const userMessages = events
            .filter((event) => event.type === "user/message" || event.type === "steering/message")
            .filter((event) => eventSequence(event) > baselineSeq && eventText(event) === message)
            .sort((left, right) => eventSequence(left) - eventSequence(right));
        const latestUserMessage = userMessages[userMessages.length - 1];
        if (latestUserMessage !== undefined) {
            lastObservedUserSeq = eventSequence(latestUserMessage);
            const assistantReplies = events
                .filter((event) => event.type === "assistant/message")
                .filter((event) => eventSequence(event) > lastObservedUserSeq)
                .map((event) => ({ sequence: eventSequence(event), text: eventText(event) }))
                .filter((reply) => reply.text !== "")
                .sort((left, right) => left.sequence - right.sequence);
            const lastReply = assistantReplies[assistantReplies.length - 1];
            const turnEnded = events.some((event) => event.type === "turn/end" && eventSequence(event) > lastObservedUserSeq);
            if (lastReply !== undefined && turnEnded) {
                return lastReply.text;
            }
            if (turnEnded && lastReply === undefined) {
                const endedEvents = events
                    .filter((event) => event.type === "turn/end" && eventSequence(event) > lastObservedUserSeq)
                    .sort((left, right) => eventSequence(left) - eventSequence(right));
                const ended = endedEvents[endedEvents.length - 1];
                const reason = isRecord(ended?.data) && isRecord(ended.data.reason)
                    ? ended.data.reason
                    : undefined;
                const kind = reason !== undefined && typeof reason.kind === "string"
                    ? reason.kind
                    : "unknown";
                throw new Error(`DSH turn ended with ${kind} before an assistant reply was recorded.`);
            }
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
    }
    throw Object.assign(new Error("DSH accepted the message but did not return a final assistant reply before the timeout."), { timeout: true, lastObservedUserSeq });
}
async function list_deepseek_harness_conversations() {
    try {
        await ensureDeepSeekHarnessWeb();
        const value = await callDshRpc("session/list", { _request: {} });
        if (!isRecord(value) || !Array.isArray(value.items)) {
            throw new Error("DSH session.list returned a response without an items array.");
        }
        const rows = value.items.map((item, index) => parseConversationRow(item, index));
        const conversations = rows
            .filter((row) => !row.blank && !row.subagent)
            .map((row) => row.conversation);
        return {
            success: true,
            status: "listed",
            count: conversations.length,
            conversations,
        };
    }
    catch (error) {
        return parseDshError(error);
    }
}
async function get_deepseek_harness_theme() {
    try {
        await ensureDeepSeekHarnessWeb();
        const described = await callDshRpc("settings/describe", {});
        const current = themeDescriptorFromDescribe(described);
        return {
            success: true,
            status: "read",
            theme: current.preference,
            revision: current.revision,
        };
    }
    catch (error) {
        return {
            success: false,
            status: "failed",
            message: errorMessage(error),
        };
    }
}
async function set_deepseek_harness_theme(params) {
    let requestedTheme;
    try {
        requestedTheme = extractTheme(params?.theme);
        await ensureDeepSeekHarnessWeb();
        const described = await callDshRpc("settings/describe", {});
        const current = themeDescriptorFromDescribe(described);
        if (current.preference === requestedTheme) {
            return {
                success: true,
                status: "unchanged",
                message: "DeepSeek Harness 主题已经是请求的模式。",
                theme: requestedTheme,
                previousTheme: current.preference,
                revision: current.revision,
            };
        }
        const changed = await callDshRpc("settings/mutate", {
            ns: THEME_NAMESPACE,
            ops: [{
                    op: "set",
                    path: [THEME_PREFERENCE_FIELD],
                    value: requestedTheme,
                }],
            expectedRevision: current.revision,
        });
        const updated = parseThemeDescriptor(changed);
        if (updated.preference !== requestedTheme) {
            throw new Error("DSH settings.mutate did not persist the requested theme.");
        }
        return {
            success: true,
            status: "updated",
            message: "DeepSeek Harness 主题已更新。",
            theme: updated.preference,
            previousTheme: current.preference,
            revision: updated.revision,
        };
    }
    catch (error) {
        const typedError = error;
        return {
            success: false,
            status: "failed",
            message: errorMessage(error),
            ...(requestedTheme === undefined ? {} : { theme: requestedTheme }),
            ...(typeof typedError.dshCode === "string" ? { errorCode: typedError.dshCode } : {}),
        };
    }
}
async function set_deepseek_harness_workspace(params) {
    let path;
    try {
        path = extractWorkspacePath(params?.path);
        await ensureDeepSeekHarnessWeb();
        const created = await callDshRpc("workspace/create", { request: { path } });
        if (!isRecord(created) || !isRecord(created.workspace)) {
            throw new Error("DSH workspace.create returned an invalid response.");
        }
        return {
            success: true,
            status: created.created === true ? "created" : "unchanged",
            path: created.workspace.path,
            workspaceId: created.workspace.workspaceId,
            workspace: created.workspace,
        };
    }
    catch (error) {
        return {
            success: false,
            status: "failed",
            message: errorMessage(error),
            ...(path === undefined ? {} : { path }),
        };
    }
}
async function get_deepseek_harness_workspace_path() {
    try {
        await ensureDeepSeekHarnessWeb();
        const stored = await (0, deepseek_harness_web_runtime_js_1.readDeepSeekHarnessWorkspaceStorage)();
        const items = isRecord(stored) && Array.isArray(stored.items) ? stored.items : [];
        const workspace = currentWorkspace(items);
        if (workspace === undefined) {
            return {
                success: true,
                status: "empty",
                path: null,
                workspaceId: null,
            };
        }
        return {
            success: true,
            status: "read",
            path: workspace.path,
            workspaceId: workspace.workspaceId,
            workspace,
        };
    }
    catch (error) {
        return {
            success: false,
            status: "failed",
            message: errorMessage(error),
        };
    }
}
async function usage_advice() {
    return {
        success: true,
        message: "Call list_deepseek_harness_conversations to retrieve ordinary non-empty conversations in DSH order. Each item contains a title and sessionId; pass that ID as session_id when continuing a conversation. " +
            "Call get_deepseek_harness_theme to read the persisted theme, or set_deepseek_harness_theme with theme=light, dark, or system to change it. " +
            "Call set_deepseek_harness_workspace with an existing absolute directory path to register or reuse a workspace; get_deepseek_harness_workspace_path returns the most recently updated registered workspace. " +
            "Call send_deepseek_harness_message with a required message. Omit session_id to create a new DSH session. The send tool waits for the final assistant reply and returns it in response.",
    };
}
async function send_deepseek_harness_message(params) {
    let sessionId;
    let promptAccepted = false;
    try {
        const message = extractMessage(params?.message);
        const mode = extractMode(params?.mode);
        const timeoutMs = extractTimeout(params?.timeout_ms);
        sessionId = extractSessionId(params?.session_id);
        await ensureDeepSeekHarnessWeb();
        if (sessionId === undefined) {
            const created = await callDshRpc("session/create", { request: {} });
            if (typeof created.sessionId !== "string" || created.sessionId.trim() === "") {
                throw new Error("DSH session.create did not return a sessionId.");
            }
            sessionId = created.sessionId;
        }
        const baselineSeq = await readSessionCursor(sessionId);
        const prompt = await callDshRpc("session/prompt", {
            request: {
                requestId: nextRpcId("session/prompt"),
                sessionId,
                mode,
                content: [{ type: "text", text: message }],
            },
        });
        if (prompt.accepted !== true) {
            throw new Error("DSH session.prompt returned without accepted=true.");
        }
        promptAccepted = true;
        const response = await waitForAssistantReply(sessionId, message, baselineSeq, timeoutMs);
        return {
            success: true,
            status: "completed",
            message: "DeepSeek Harness 已返回最终回复。",
            sessionId,
            response,
            promptAccepted,
        };
    }
    catch (error) {
        const typedError = error;
        const timeout = typedError.timeout === true;
        return {
            success: false,
            status: timeout ? "timeout" : "failed",
            message: errorMessage(error),
            sessionId,
            promptAccepted,
            ...(typeof typedError.dshCode === "string" ? { errorCode: typedError.dshCode } : {}),
        };
    }
}
