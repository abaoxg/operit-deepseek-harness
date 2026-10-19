/**
 * 用最小 DOM mock 真实执行 DSH_POPUP_SHIM，验证 window.open 的行为契约。
 *
 * 契约（依据 dsh-client-ui-settings-account/lib/client.js 的 begin()/update()）：
 *   begin()  -> popup = window.open("about:blank","_blank"); if (popup) popup.opener = null;
 *   update() -> this.popup?.close() / this.popup.location.replace(url)
 *
 * 期望：
 *   1. window.open("about:blank") 返回 null   -> popup 为 null，后续 ?. 全短路，不报错
 *   2. window.open(真实URL)        返回 null   -> 同上，且提示用户
 *   3. 两种情况都不得抛异常（抛异常会被 DSH 的 try/catch 吞掉并显示失败）
 *   4. 重复注入不重复绑定（幂等）
 *   5. 非字符串/undefined 输入不崩
 *
 * 用法: node tests/shim_behavior.mjs <path-to-index.ui.js>
 */

import fs from "node:fs";
import vm from "node:vm";

const uiPath = process.argv[2];
if (!uiPath) {
  console.error("usage: node tests/shim_behavior.mjs <index.ui.js>");
  process.exit(2);
}

const src = fs.readFileSync(uiPath, "utf8");

// 抽出 const DSH_POPUP_SHIM = `...`;
const m = src.match(/const DSH_POPUP_SHIM = `\n([\s\S]*?)\n`;/);
if (!m) {
  console.error("FATAL: 未找到 DSH_POPUP_SHIM");
  process.exit(1);
}
const shimSource = m[1];

// ---------- 最小 DOM mock ----------
function makeElement(tag) {
  const el = {
    tagName: tag,
    id: "",
    style: { cssText: "" },
    children: [],
    textContent: "",
    href: "",
    target: "",
    value: "",
    onclick: null,
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    select() {},
    querySelectorAll() {
      return [];
    },
  };
  return el;
}

function makeSandbox() {
  const store = new Map();
  const body = makeElement("body");
  const sandbox = {
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    __store: store,
    __body: body,
    document: {
      body,
      documentElement: makeElement("html"),
      head: makeElement("head"),
      createElement: makeElement,
      getElementById(id) {
        // 只在 body 子树里找
        const walk = (node) => {
          if (node.id === id) return node;
          for (const c of node.children) {
            const r = walk(c);
            if (r) return r;
          }
          return null;
        };
        return walk(body);
      },
      execCommand() {
        return true;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { href: "" };
  return sandbox;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? "  -- " + detail : ""}`);
}

// ---------- S1: shim 可执行且安装标记就位 ----------
let sandbox = makeSandbox();
vm.createContext(sandbox);
try {
  vm.runInContext(shimSource, sandbox, { timeout: 5000 });
  check("S1 shim 无异常执行", true);
} catch (e) {
  check("S1 shim 无异常执行", false, String(e));
  process.exit(1);
}
check("S1b 安装标记 __dshPopupShimInstalled", sandbox.window.__dshPopupShimInstalled === true);
check("S1c window.open 已被替换", typeof sandbox.window.open === "function");

// ---------- S2: about:blank（DSH begin() 的真实调用） ----------
let ret2, threw2 = null;
try {
  ret2 = sandbox.window.open("about:blank", "_blank");
} catch (e) {
  threw2 = e;
}
check("S2a about:blank 不抛异常", threw2 === null, threw2 ? String(threw2) : "");
check("S2b about:blank 返回 null（关键：让 DSH 走降级）", ret2 === null, "got " + String(ret2));

// 模拟 DSH 后续代码：this.popup 为 null 时 optional chaining 必须安全
let optOk = true;
try {
  const popup = ret2;
  if (popup) popup.opener = null;
  popup?.close?.();
  popup?.location?.replace?.("x");
} catch (e) {
  optOk = false;
}
check("S2c DSH 后续 ?. 调用安全", optOk);

// 应弹出提示条
const toast1 = sandbox.document.getElementById("dsh-popup-shim-toast");
check("S2d 弹出提示条", toast1 !== null);
if (toast1) {
  const text = toast1.children.map((c) => c.textContent).join(" ");
  check("S2e 提示文案说明弹窗被拦截", text.includes("拦截"), text.slice(0, 40));
}

// ---------- S3: 真实 URL ----------
let ret3, threw3 = null;
try {
  ret3 = sandbox.window.open("https://platform.deepseek.com/auth/xyz", "_blank");
} catch (e) {
  threw3 = e;
}
check("S3a 真实 URL 不抛异常", threw3 === null, threw3 ? String(threw3) : "");
check("S3b 真实 URL 也返回 null", ret3 === null, "got " + String(ret3));
check("S3c 提供了 URL 链接", sandbox.document.getElementById("dsh-popup-shim-toast").children.some(
  (c) => c.tagName === "a" && String(c.href).includes("platform.deepseek.com")
));
check("S3d 提供复制按钮", sandbox.document.getElementById("dsh-popup-shim-toast").children.some(
  (c) => c.tagName === "button"
));

// ---------- S4: 幂等（重复注入） ----------
const openBefore = sandbox.window.open;
try {
  vm.runInContext(shimSource, sandbox, { timeout: 5000 });
  check("S4 重复注入不抛异常", true);
} catch (e) {
  check("S4 重复注入不抛异常", false, String(e));
}
// 第二次注入会 early-return，不应替换或叠加
check("S4b 重复注入不重复绑定", sandbox.window.open === openBefore);

// ---------- S5: 异常输入健壮性 ----------
const weirds = [undefined, null, "", "   ", 0, {}, [], "javascript:void(0)"];
let weirdFail = [];
for (const w of weirds) {
  try {
    const r = sandbox.window.open(w);
    if (r !== null) weirdFail.push(`ret(${JSON.stringify(w)})!=null`);
  } catch (e) {
    weirdFail.push(`${JSON.stringify(w)} threw ${e}`);
  }
}
check("S5 异常/空输入全部安全且返回 null", weirdFail.length === 0, weirdFail.join("; "));

// ---------- S6: 无 DOM 环境下不炸（防御性） ----------
{
  const bare = { console, setTimeout, clearTimeout };
  bare.window = bare;
  bare.globalThis = bare;
  bare.location = { href: "" };
  vm.createContext(bare);
  let bareOk = true, bareErr = "";
  try {
    vm.runInContext(shimSource, bare, { timeout: 5000 });
    bare.window.open("about:blank"); // 无 document 时应被 try/catch 兜住
  } catch (e) {
    bareOk = false;
    bareErr = String(e);
  }
  check("S6 无 document 环境下不抛异常", bareOk, bareErr);
}

console.log("=".repeat(60));
const passed = results.filter((r) => r.ok).length;
console.log(`RESULT: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.log("FAILED:");
  for (const r of results) if (!r.ok) console.log(`  - ${r.name} ${r.detail}`);
  process.exit(1);
}
process.exit(0);