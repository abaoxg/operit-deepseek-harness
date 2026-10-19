#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对 com.operit.deepseek_harness v0.7.2 的已解包目录就地打补丁。

用法:
    python3 tools/apply_patches.py <解包目录>
    python3 tools/apply_patches.py --check <解包目录>

例:
    python3 tools/apply_patches.py upstream
    python3 tools/apply_patches.py /data/data/com.ai.assistance.operit/files/toolpkg_cache/com.operit.deepseek_harness-e16f787d

特性:
  * 幂等：已打过补丁会跳过，不会重复插入。
  * 严格：锚点缺失直接以非 0 退出，绝不静默「改了一半」。
  * 双份：src/ 与 dist/ 同步处理（插件实际执行 dist，但 src 保持可读一致）。

补丁清单（共 3 组、4 个文件）:
  P1 pnpm-workspace.yaml 缺少 packages 字段 -> pnpm 9 拦截一切命令
  P2 非交互 shell 下 node 命中 v20 -> import.meta.main 为 undefined，DSH 静默退出
  P3 WebView 不支持 window.open 弹窗 -> Chromium 抛 IllegalArgumentException，宿主闪退
"""

import io
import os
import sys

# ---------- P2: 环境变量 ----------
PATH_OLD = """        'export PATH="$PNPM_HOME:$PATH"',"""
PATH_NEW = """        'export PATH="/usr/bin:$PNPM_HOME:$PATH"',
        'export NODE=/usr/bin/node',"""

# ---------- P1: pnpm-workspace packages ----------
WS_OLD = """    const config = [
        "allowBuilds:","""
WS_NEW = """    // pnpm >= 9 aborts EVERY command (including `pnpm init`) with
    // "ERROR packages field missing or empty" when a pnpm-workspace.yaml exists
    // but has no `packages` field. Always emit `packages` first.
    const config = [
        "packages:",
        '  - "."',
        "allowBuilds:","""

# ---------- P3: WebView 弹窗 shim ----------
UI_ANCHOR = "async function applyMobileLayoutCss(controller, assets) {"

SHIM_BLOCK = r"""const DSH_POPUP_SHIM = `
(function() {
  if (window.__dshPopupShimInstalled) { window.__dshPopupShimRefresh && window.__dshPopupShimRefresh(); return; }
  window.__dshPopupShimInstalled = true;
  const rawOpen = window.open ? window.open.bind(window) : null;

  function toast(text, url) {
    try {
      const id = "dsh-popup-shim-toast";
      let box = document.getElementById(id);
      if (!box) {
        box = document.createElement("div");
        box.id = id;
        box.style.cssText = "position:fixed;left:12px;right:12px;bottom:16px;z-index:2147483647;background:#1f2430;color:#fff;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.6;box-shadow:0 8px 28px rgba(0,0,0,.45);word-break:break-all;";
        document.body.appendChild(box);
      }
      box.textContent = "";
      const line = document.createElement("div");
      line.textContent = text;
      box.appendChild(line);
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.textContent = url;
        a.target = "_self";
        a.style.cssText = "color:#7cc4ff;display:block;margin-top:8px;text-decoration:underline;";
        box.appendChild(a);
        const btn = document.createElement("button");
        btn.textContent = "复制授权链接";
        btn.style.cssText = "margin-top:10px;padding:8px 14px;border-radius:8px;border:0;background:#3b7ddd;color:#fff;font-size:13px;";
        btn.onclick = function() {
          try {
            const ta = document.createElement("textarea");
            ta.value = url;
            ta.style.cssText = "position:fixed;left:-9999px;";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            btn.textContent = "已复制";
          } catch (e) {
            btn.textContent = "复制失败，请长按选择";
          }
        };
        box.appendChild(btn);
      }
      clearTimeout(window.__dshPopupShimTimer);
      window.__dshPopupShimTimer = setTimeout(function() {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
      }, 30000);
    } catch (e) {}
  }

  window.open = function(url) {
    const target = url && String(url).trim() !== "" && String(url) !== "about:blank" ? String(url) : "";
    if (target) {
      toast("登录需要在系统浏览器中完成，已为你打开新页面。若未跳转，请点下方链接或复制后在浏览器打开：", target);
      try { window.location.href = target; } catch (e) {}
      return null;
    }
    toast("登录窗口已被 Operit 内置浏览器拦截（WebView 不支持弹窗，强行弹窗会导致 Operit 闪退）。请在登录框里点「复制链接」，把授权地址粘贴到系统浏览器（如 Via / 夸克）中完成登录，完成后回到这里即可。");
    return null;
  };
  window.__dshPopupShimRefresh = function() {};
})();
`;

async function installDshPopupShim(controller) {
    try {
        await controller.evaluateJavascript(DSH_POPUP_SHIM);
        return true;
    } catch (error) {
        console.warn("[DSH Sidebar] popup shim injection failed", error);
        return false;
    }
}

"""

FIN_OLD = """                    void loadMobileLayoutAssets()
                        .then((assets) => applyMobileLayoutCss(webViewController, assets))"""

FIN_NEW = """                    void installDshPopupShim(webViewController)
                        .then(() => loadMobileLayoutAssets())
                        .then((assets) => applyMobileLayoutCss(webViewController, assets))"""

TARGETS = [
    "dist/shared/deepseek_harness_web_runtime.js",
    "src/shared/deepseek_harness_web_runtime.ts",
    "dist/ui/deepseek_harness_dashboard/index.ui.js",
    "src/ui/deepseek_harness_dashboard/index.ui.ts",
]


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def patch_runtime(path, dry):
    s = read(path)
    changed = []

    if "export NODE=/usr/bin/node" in s:
        changed.append("P2:already")
    elif PATH_OLD in s:
        s = s.replace(PATH_OLD, PATH_NEW, 1)
        changed.append("P2:ok")
    else:
        return "error", "P2 anchor missing (export PATH line)"

    if '"packages:",' in s:
        changed.append("P1:already")
    elif WS_OLD in s:
        s = s.replace(WS_OLD, WS_NEW, 1)
        changed.append("P1:ok")
    else:
        return "error", "P1 anchor missing (const config = [ ... allowBuilds)"

    if not dry:
        write(path, s)
    status = "already" if all(c.endswith(":already") for c in changed) else "patched"
    return status, ",".join(changed)


def patch_ui(path, dry):
    s = read(path)
    changed = []

    if "installDshPopupShim" in s:
        changed.append("P3:already")
    elif UI_ANCHOR in s:
        s = s.replace(UI_ANCHOR, SHIM_BLOCK + UI_ANCHOR, 1)
        changed.append("P3:shim-ok")
    else:
        return "error", "P3 anchor missing (applyMobileLayoutCss)"

    if FIN_NEW in s:
        changed.append("P3-fin:already")
    elif FIN_OLD in s:
        s = s.replace(FIN_OLD, FIN_NEW, 1)
        changed.append("P3-fin:ok")
    else:
        return "error", "P3 anchor missing (onPageFinished call chain)"

    if not dry:
        write(path, s)
    status = "already" if all(c.endswith(":already") for c in changed) else "patched"
    return status, ",".join(changed)


def main():
    args = [a for a in sys.argv[1:] if a not in ("--check", "-n")]
    dry = "--check" in sys.argv or "-n" in sys.argv

    if not args:
        print("usage: python3 tools/apply_patches.py [--check] <unpacked-plugin-dir>")
        return 2

    root = os.path.abspath(args[0])
    if not os.path.isdir(root):
        print("ERROR: not a directory: %s" % root)
        return 2

    print("target root: %s" % root)
    print("mode: %s" % ("CHECK ONLY (no write)" if dry else "PATCH (write)"))
    print("-" * 72)

    failed = 0
    for rel in TARGETS:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            print("[FAIL]   %-48s missing file" % rel)
            failed += 1
            continue
        fn = patch_runtime if "web_runtime" in rel else patch_ui
        status, detail = fn(path, dry)
        if status == "error":
            print("[FAIL]   %-48s %s" % (rel, detail))
            failed += 1
        else:
            print("[%-8s] %-48s %s" % (status.upper(), rel, detail))

    print("-" * 72)
    if failed:
        print("RESULT: FAILED (%d file(s))" % failed)
        return 1
    print("RESULT: OK (4 files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())