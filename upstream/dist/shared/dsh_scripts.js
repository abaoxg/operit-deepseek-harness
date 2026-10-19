"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DSH_WATCH_PY = exports.PARSE_SESSION_PY = exports.DSH_ZSTD_DECODE_JS = exports.SCRIPTS_VERSION = void 0;
// 由脚本自动生成：DSH sub-agent 运行时脚本内嵌常量。
// 版本标记与文件头部 # dsh-script: v5 对应，插件按此标记决定是否覆盖部署。
exports.SCRIPTS_VERSION = "v5";
exports.DSH_ZSTD_DECODE_JS = `// dsh-script: v5
"use strict";

const fs = require("node:fs");
const { constants, zstdDecompressSync } = require("node:zlib");

const ZSTD_MAGIC = 0xfd2fb528;

function scanFrameEnd(buffer, start) {
    let offset = start;
    if (buffer.length - offset < 4)
        return null;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC)
        throw new Error("Invalid Zstandard frame magic at byte " + offset);
    offset += 4;
    if (offset === buffer.length)
        return null;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0)
        throw new Error("Invalid reserved Zstandard frame-header bit at byte " + (offset - 1));
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
        ? (singleSegment ? 1 : 0)
        : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes)
        return null;
    offset += remainingHeaderBytes;
    for (;;) {
        if (buffer.length - offset < 3)
            return null;
        const blockHeader = buffer.readUIntLE(offset, 3);
        offset += 3;
        const lastBlock = (blockHeader & 1) !== 0;
        const blockType = (blockHeader >>> 1) & 3;
        const blockSize = blockHeader >>> 3;
        if (blockType === 3)
            throw new Error("Invalid reserved Zstandard block type at byte " + (offset - 3));
        const payloadBytes = blockType === 1 ? 1 : blockSize;
        if (buffer.length - offset < payloadBytes)
            return null;
        offset += payloadBytes;
        if (lastBlock)
            break;
    }
    if (checksum) {
        if (buffer.length - offset < 4)
            return null;
        offset += 4;
    }
    return offset;
}

const path = process.argv[2];
if (!path)
    throw new Error("Usage: node decode_zstd.cjs FILE");
const source = fs.readFileSync(path);
let offset = 0;
while (offset < source.length) {
    const end = scanFrameEnd(source, offset);
    if (end === null) {
        try {
            process.stdout.write(zstdDecompressSync(source.subarray(offset), {
                finishFlush: constants.ZSTD_e_flush,
            }));
        }
        catch (_) {
            // A live incomplete tail may not yet contain decodable bytes.
        }
        break;
    }
    process.stdout.write(zstdDecompressSync(source.subarray(offset, end)));
    offset = end;
}
`;
exports.PARSE_SESSION_PY = `#!/usr/bin/env python3
# dsh-script: v5
# DSH sub-agent 会话实时解析器（增强版：状态细分 + 时间线 + 工具调用历史）
# 用法: python3 parse_session.py <task_id> <cwd> <task_snippet> <sessions_root> <started_at_ms>
# 输出: JSON 汇总（工具调用统计 / tokens / 缓存命中 / 错误 / 当前活动 / 状态细分 / 时间线 / 最终答案）
import base64
import json
import os
import subprocess
import sys


ZSTD_DECODER_JS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "decode_zstd.cjs"
)


def bd(s):
    """base64 解码参数（兼容明文）"""
    try:
        return base64.b64decode(s).decode("utf-8")
    except Exception:
        return s


def slugify(cwd):
    parts = [p for p in cwd.replace("\\\\", "/").split("/") if p]
    return "--" + "-".join(parts) + "--"
def start_zstd_decoder(path):
    return subprocess.Popen(
        ["node", ZSTD_DECODER_JS, path],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )


def zstd_lines(path):
    """流式解压所有独立 Zstandard 帧；容忍运行中的截断尾帧。"""
    process = None
    try:
        process = start_zstd_decoder(path)
        for raw in process.stdout:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                yield line
    except Exception:
        return
    finally:
        if process is not None:
            try:
                if process.stdout is not None:
                    process.stdout.close()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                except Exception:
                    pass
                try:
                    process.wait(timeout=5)
                except Exception:
                    pass
            except Exception:
                pass


def zstd_head(path, nbytes=20000):
    """只解压文件前 nbytes 字节（快速预筛：用户消息在会话早期）"""
    process = None
    try:
        process = start_zstd_decoder(path)
        data = process.stdout.read(nbytes)
        return data.decode("utf-8", errors="replace")
    except Exception:
        return ""
    finally:
        if process is not None:
            try:
                if process.poll() is None:
                    process.terminate()
            except Exception:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                    process.wait(timeout=5)
                except Exception:
                    pass
            except Exception:
                pass




def find_session(sessions_root, cwd, snippet, started_at_ms):
    """按 cwd slug + user/message 文本匹配任务对应的会话目录。"""
    slug = slugify(cwd)
    base = os.path.join(sessions_root, slug)
    if not os.path.isdir(base):
        return None
    best = None
    best_score = -1
    for name in os.listdir(base):
        sdir = os.path.join(base, name)
        if not os.path.isdir(sdir):
            continue
        for f in os.listdir(sdir):
            if not (".jsonl.zstd" in f):
                continue
            fpath = os.path.join(sdir, f)
            # 快速预筛：snippet 不在文件头部 → 不是该任务会话，跳过（免全量解压）
            if snippet:
                head = zstd_head(fpath)
                if snippet not in head:
                    continue
            for line in zstd_lines(fpath):
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                if ev.get("type") == "user/message":
                    texts = []
                    for c in ev.get("data", {}).get("content", []):
                        if isinstance(c, dict) and c.get("type") == "text":
                            texts.append(c.get("text", ""))
                    joined = " ".join(texts)
                    if snippet and joined.startswith(snippet):
                        created = ev.get("time", 0)
                        score = 1000000 - abs(created - started_at_ms)
                        if score > best_score:
                            best_score = score
                            best = (sdir, fpath)
                            break
                elif ev.get("type") == "session":
                    created = ev.get("createdAt", 0)
                    if started_at_ms and abs(created - started_at_ms) < 60000:
                        score = 500000 - abs(created - started_at_ms)
                        if score > best_score:
                            best_score = score
                            best = (sdir, fpath)
    return best


def summarize_args(args):
    try:
        args_obj = json.loads(args)
        return json.dumps(args_obj, ensure_ascii=False)[:160]
    except Exception:
        return str(args)[:160]


def parse_session(sdir, fpath, task_id):
    stats = {
        "sessionId": os.path.basename(sdir),
        "file": fpath,
        "steps": 0,
        "turns": 0,
        "toolCalls": {"total": 0, "byTool": {}, "latest": None},
        "tokens": {"input": 0, "output": 0, "cacheRead": 0, "reasoning": 0},
        "errors": [],
        "reasoningTail": "",
        "answer": None,
        "lastActivity": None,
        "lastActivityTime": None,
        "hasFinish": False,
        "finishedAt": None,
        "finalReason": None,
        # ===== 增强字段 =====
        "state": "idle",            # finished / tool_exec / thinking / writing / waiting_llm / planning / idle
        "stateLabel": "空闲",
        "timeline": [],             # 最近事件时间线 [{t: 相对秒, type, text}]
        "recentCalls": [],          # 最近工具调用 [{time, name, args, step, ok, err}]
    }
    current_tool = None
    reasoning_seen = False
    base_ts = None
    # 状态候选：记录最后几个关键事件的类型（用于尾部状态判定）
    last_kind = None   # tool/call | tool/result | reasoning | delta | step/start | turn/start | finish | text
    last_tool_name = None

    def push_timeline(ts, etype, text):
        nonlocal base_ts
        if base_ts is None:
            base_ts = ts
        rel = round((ts - base_ts) / 1000) if ts and base_ts else None
        stats["timeline"].append({"t": rel, "type": etype, "text": text[:120]})

    for line in zstd_lines(fpath):
        try:
            ev = json.loads(line)
        except Exception:
            continue
        t = ev.get("type")
        seq = ev.get("seq")
        ts = ev.get("time")
        if ts:
            stats["lastActivityTime"] = ts
        if t == "step/start":
            stats["steps"] += 1
            n = ev.get("data", {}).get("step")
            stats["lastActivity"] = "step %d 开始" % n
            last_kind = "step/start"
            push_timeline(ts, "step/start", "步骤 %d 开始" % n)
        elif t == "turn/start":
            stats["turns"] += 1
            n = ev.get("data", {}).get("turn")
            stats["lastActivity"] = "turn %d 开始" % n
            last_kind = "turn/start"
            push_timeline(ts, "turn/start", "回合 %d 开始" % n)
        elif t == "tool/call":
            d = ev.get("data", {})
            name = d.get("name", "?")
            stats["toolCalls"]["total"] += 1
            stats["toolCalls"]["byTool"][name] = stats["toolCalls"]["byTool"].get(name, 0) + 1
            args_summary = summarize_args(d.get("arguments", ""))
            stats["toolCalls"]["latest"] = {
                "name": name, "args": args_summary, "step": d.get("step"), "time": ts,
            }
            current_tool = stats["toolCalls"]["latest"]
            stats["lastActivity"] = "调用工具 %s: %s" % (name, args_summary[:100])
            last_kind = "tool/call"
            last_tool_name = name
            stats["recentCalls"].append({
                "time": ts, "name": name, "args": args_summary,
                "step": d.get("step"), "ok": None, "err": None,
            })
            push_timeline(ts, "tool/call", "工具 %s %s" % (name, args_summary[:80]))
        elif t == "tool/result":
            d = ev.get("data", {})
            content = json.dumps(d.get("message", {}).get("content", []), ensure_ascii=False)
            lowered = content.lower()
            is_error = False
            if '"iserror": true' in lowered:
                is_error = True
            elif '"iserror": false' not in lowered:
                is_error = any(k in lowered for k in ("error:", "denied", "refused", "no such file", "command not found", "permission denied"))
            if is_error:
                stats["errors"].append({
                    "step": d.get("step"),
                    "tool": current_tool["name"] if current_tool else "?",
                    "snippet": content[:200],
                    "time": ts,
                })
            # 回填最近一次未决调用
            if stats["recentCalls"]:
                stats["recentCalls"][-1]["ok"] = not is_error
                stats["recentCalls"][-1]["err"] = content[:120] if is_error else None
            stats["lastActivity"] = "工具已返回" + ("（出错）" if is_error else "")
            last_kind = "tool/result"
            push_timeline(ts, "tool/result", "工具返回" + ("（出错）" if is_error else ""))
        elif t == "assistant/chunk":
            chunk = ev.get("data", {}).get("chunk", {})
            ct = chunk.get("type")
            if ct == "usage":
                u = chunk.get("usage", {})
                stats["tokens"]["input"] += u.get("inputTokens", 0)
                stats["tokens"]["output"] += u.get("outputTokens", 0)
                stats["tokens"]["cacheRead"] += u.get("cacheReadTokens", 0)
                stats["tokens"]["reasoning"] += u.get("reasoningTokens", 0)
            elif ct == "reasoning":
                txt = chunk.get("text", "")
                if txt:
                    stats["reasoningTail"] = txt[-180:]
                    stats["lastActivity"] = "思考中… " + txt[-80:]
                last_kind = "reasoning"
                if not reasoning_seen:
                    reasoning_seen = True
                    push_timeline(ts, "reasoning", "开始思考…")
            elif ct == "reasoning-delta":
                # pi-ai 通道的思考流（增量文本；usage 无独立 reasoning 计数，折叠在 output 中）
                txt = chunk.get("text", "")
                if txt:
                    stats["reasoningTail"] = txt[-180:]
                    stats["lastActivity"] = "思考中… " + txt[-80:]
                last_kind = "reasoning"
                if not reasoning_seen:
                    reasoning_seen = True
                    push_timeline(ts, "reasoning", "开始思考…")
            elif ct == "delta":
                txt = chunk.get("text", "")
                if txt:
                    stats["lastActivity"] = "正在输出… " + txt[-60:]
                    last_kind = "delta"
            elif ct == "finish":
                stats["hasFinish"] = True
                stats["finalReason"] = json.dumps(chunk.get("reason", {}), ensure_ascii=False)
                stats["finishedAt"] = ts
                last_kind = "finish"
                push_timeline(ts, "finish", "完成（%s）" % (chunk.get("reason", {}).get("finishReason", "?")))
        elif t == "assistant/message":
            msg = ev.get("data", {}).get("message", {})
            content = msg.get("content", [])
            texts = []
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    texts.append(c.get("text", ""))
            if texts:
                stats["answer"] = "\\n".join(texts)
                last_kind = "text"
                push_timeline(ts, "answer", "生成回复（%d 字）" % len("\\n".join(texts)))
    # tokens 汇总
    tok = stats["tokens"]
    tok["total"] = tok["input"] + tok["output"]
    if tok["input"] + tok["cacheRead"] > 0:
        tok["cacheHitRate"] = round(tok["cacheRead"] * 100.0 / (tok["input"] + tok["cacheRead"]), 1)
    else:
        tok["cacheHitRate"] = 0.0
    # ===== 状态细分判定（按最后事件类型）=====
    if stats["hasFinish"]:
        stats["state"] = "finished"
        stats["stateLabel"] = "已完成"
    elif last_kind == "tool/call":
        stats["state"] = "tool_exec"
        stats["stateLabel"] = "正在执行工具：%s" % (last_tool_name or "?")
    elif last_kind == "reasoning":
        stats["state"] = "thinking"
        stats["stateLabel"] = "思考中…"
    elif last_kind == "delta":
        stats["state"] = "writing"
        stats["stateLabel"] = "正在生成回复…"
    elif last_kind == "tool/result":
        stats["state"] = "waiting_llm"
        stats["stateLabel"] = "工具已返回，等待 LLM 响应…"
    elif last_kind == "step/start":
        stats["state"] = "planning"
        stats["stateLabel"] = "步骤开始，等待 LLM 规划…"
    elif last_kind == "turn/start":
        stats["state"] = "waiting_llm"
        stats["stateLabel"] = "回合开始，等待 LLM 响应…"
    else:
        stats["state"] = "waiting_llm"
        stats["stateLabel"] = "等待 LLM 响应…"
    # 截断时间线 / 工具历史
    stats["timeline"] = stats["timeline"][-30:]
    stats["recentCalls"] = stats["recentCalls"][-10:]
    return stats


def main():
    task_id = bd(sys.argv[1])
    cwd = bd(sys.argv[2])
    snippet = bd(sys.argv[3])
    sessions_root = sys.argv[4]
    started_at_ms = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else 0
    found = find_session(sessions_root, cwd, snippet, started_at_ms)
    if not found:
        print(json.dumps({"taskId": task_id, "matched": False}))
        return
    sdir, fpath = found
    stats = parse_session(sdir, fpath, task_id)
    stats["taskId"] = task_id
    stats["matched"] = True
    stats["cwd"] = cwd
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()`;
exports.DSH_WATCH_PY = `#!/usr/bin/env python3
# dsh-script: v5
# DSH 实时监控 watcher：常驻后台，每 5 秒刷新 dsh-state.json（不依赖 AI 手动调 panel）
# 启动: nohup python3 dsh_watch.py > watch.log 2>&1 &   （写 pid 到 watch.pid）
# 停止: kill $(cat watch.pid)
# 说明: 只读 jobs/meta 与 DSH 会话文件，不影响正在运行的 agent 任务。
import glob
import json
import os
import re
import subprocess
import sys
import time

JOBS = "/root/sidebar_deepseek_harness/subagent-jobs"
SESSIONS = "/root/sidebar_deepseek_harness/dsh-home/sessions"
PARSE = JOBS + "/parse_session.py"
STATE_JSON = JOBS + "/state.json"
# 目标工作区：必须用环境变量 DSH_WATCH_WORKSPACE 指定（预览页 index.html 放在该工作区根目录）
# 未指定时只写 jobs 目录的 state.json，不写任何工作区副本。
import os as _os
WORKSPACE = _os.environ.get("DSH_WATCH_WORKSPACE", "").strip()
WORKSPACE_STATE = (WORKSPACE + "/dsh-state.json") if WORKSPACE else None
INTERVAL = 5          # 秒：基础轮询
FULL_EVERY = 60       # 秒：已完成任务全量重解析周期
MAX_JOBS = 20
PID_FILE = JOBS + "/watch.pid"

CACHE = {}            # taskId -> agent dict
last_full = 0.0


def read_or(fn, default):
    try:
        with open(fn) as f:
            return f.read().strip()
    except Exception:
        return default


def job_status(meta, pid_file, code_file):
    """与插件 jobMeta 一致的状态判定"""
    code = read_or(code_file, "")
    if code:
        try:
            ec = int(code)
        except Exception:
            ec = None
        if ec == 0:
            return "done", 0
        if ec == -2:
            return "cancelled", -2
        if ec == 124:
            return "timeout", 124
        return "failed", ec
    pid = read_or(pid_file, "")
    if pid and re.fullmatch(r"[1-9][0-9]*", pid):
        try:
            r = subprocess.run(["kill", "-0", pid], capture_output=True)
            if r.returncode == 0:
                return "running", None
        except Exception:
            pass
        return "failed", -1
    # 无有效 pid 且无 code：任务尚未完成启动记录。
    return "unknown", None


def parse_task(task_id, cwd, task, started_ms):
    snippet = ""  # Keep task text out of process arguments.
    try:
        r = subprocess.run(
            ["python3", PARSE, task_id, cwd, snippet, SESSIONS, str(started_ms)],
            capture_output=True, text=True, timeout=30,
        )
        out = (r.stdout or "").strip()
        if not out:
            return {"matched": False}
        return json.loads(out)
    except Exception:
        return {"matched": False}


def build_agent(m, st, ec, s):
    now = time.time() * 1000
    started_ms = 0
    try:
        started_ms = int(m.get("startedAtMs") or 0)
    except Exception:
        pass
    return {
        "taskId": m["taskId"],
        "status": st,
        "preset": m.get("preset") or "standard",
        "pid": m.get("pid"),
        "startedAt": m.get("startedAt"),
        "elapsedSec": round((now - started_ms) / 1000) if started_ms else None,
        "exitCode": ec,
        "cwd": s.get("cwd") or None,
        "sessionId": s.get("sessionId") or None,
        "matched": s.get("matched") is True,
        "steps": s.get("steps") or 0,
        "turns": s.get("turns") or 0,
        "toolCalls": s.get("toolCalls") or {"total": 0, "byTool": {}},
        "tokens": s.get("tokens") or {},
        "errors": (s.get("errors") or [])[-5:],
        "currentActivity": s.get("lastActivity") or None,
        "state": s.get("state") or "idle",
        "stateLabel": s.get("stateLabel") or "空闲",
        "timeline": s.get("timeline") or [],
        "recentCalls": s.get("recentCalls") or [],
        "answer": s.get("answer") or None,
        "hasFinish": s.get("hasFinish") is True,
    }


def finalize_agent(a, st, pid_file):
    """运行中任务的修正：DSH 每回合 LLM 响应结束都会发 finish chunk（回合级，非任务级），
    running 任务的 state==finished / hasFinish 是误读，重置为运行中，防止误判"已完成"。"""
    if a["status"] == "running":
        a["hasFinish"] = False
        if a["state"] == "finished" or a["stateLabel"] == "已完成":
            a["state"] = "waiting_llm"
            a["stateLabel"] = "运行中（回合间/思考）…"
        if not a["matched"]:
            a["buffered"] = True
            a["stateLabel"] = "运行中（会话缓冲未落盘，进度稍后可见）"
            log = read_or(JOBS + "/out/" + a["taskId"] + ".log", "")
            tail = log.strip().split("\\n")[-1] if log.strip() else ""
            if tail and "EXIT_CODE" not in tail:
                a["logTail"] = tail[:120]
    return a


def load_metas():
    metas = []
    for f in sorted(glob.glob(JOBS + "/meta/*.json")):
        try:
            with open(f) as fp:
                m = json.load(fp)
            tid = str(m.get("taskId") or "")
            if not re.fullmatch(r"dsh-[a-z0-9]+-[a-z0-9]+", tid):
                continue
            m["taskId"] = tid
            m["pid"] = read_or(JOBS + "/pid/" + tid + ".pid", "") or None
            try:
                m["startedAtMs"] = int(m.get("startedAt") and
                                       time.mktime(time.strptime(m["startedAt"][:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
            except Exception:
                m["startedAtMs"] = 0
            metas.append(m)
        except Exception:
            continue
    return metas[-MAX_JOBS:]


def main():
    global last_full, CACHE
    os.umask(0o077)
    if os.path.exists(PID_FILE):
        old = read_or(PID_FILE, "")
        if old:
            r = subprocess.run(["kill", "-0", str(old)], capture_output=True)
            if r.returncode == 0:
                print("already running pid", old)
                return
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))
    print("dsh_watch started pid", os.getpid(), flush=True)
    while True:
        t0 = time.time()
        now_full = (time.time() - last_full) >= FULL_EVERY
        agents = []
        for m in load_metas():
            tid = m["taskId"]
            st, ec = job_status(m, JOBS + "/pid/" + tid + ".pid", JOBS + "/code/" + tid + ".code")
            cached = CACHE.get(tid)
            # 缓冲中任务：会话未落盘，解析读不到；仅刷新耗时/PID，每 FULL_EVERY 秒重试一次解析
            if st == "running" and cached and cached.get("buffered") and not now_full:
                cached["elapsedSec"] = round((time.time() * 1000 - (m.get("startedAtMs") or 0)) / 1000) if m.get("startedAtMs") else None
                cached["pid"] = m.get("pid")
                agents.append(cached)
                continue
            need = (st == "running") or now_full or (tid not in CACHE) or (CACHE[tid]["status"] != st)
            if need:
                s = parse_task(tid, m.get("cwd") or "/root/dsh_workspace", m.get("task") or "", m.get("startedAtMs") or 0)
                a = build_agent(m, st, ec, s)
                agents.append(finalize_agent(a, st, JOBS + "/pid/" + tid + ".pid"))
            else:
                agents.append(CACHE[tid])
        state = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".%03dZ" % (int(time.time() * 1000) % 1000),
            "count": len(agents),
            "running": sum(1 for a in agents if a["status"] == "running"),
            "agents": agents,
        }
        try:
            with open(STATE_JSON, "w") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
            if WORKSPACE_STATE:
                with open(WORKSPACE_STATE, "w") as f:
                    json.dump(state, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("write state failed:", e, flush=True)
        CACHE = {a["taskId"]: a for a in agents}
        if now_full:
            last_full = time.time()
        # 下一轮：保证 interval（解析耗时较长时立即下一轮）
        dt = time.time() - t0
        time.sleep(max(0.5, INTERVAL - dt))


if __name__ == "__main__":
    main()`;
