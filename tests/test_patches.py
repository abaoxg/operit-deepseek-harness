#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回归测试：验证 upstream/ 与补丁后的产物。

用法:
    python3 tests/test_patches.py
    python3 tests/test_patches.py --cache /path/to/toolpkg_cache/xxx   # 额外对比线上缓存

退出码 0 = 全部通过，1 = 有失败。
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
UPSTREAM = os.path.join(REPO, "upstream")
PATCHER = os.path.join(REPO, "tools", "apply_patches.py")
BUILDER = os.path.join(REPO, "tools", "build_toolpkg.py")

RUNTIME_JS = "dist/shared/deepseek_harness_web_runtime.js"
RUNTIME_TS = "src/shared/deepseek_harness_web_runtime.ts"
UI_JS = "dist/ui/deepseek_harness_dashboard/index.ui.js"
UI_TS = "src/ui/deepseek_harness_dashboard/index.ui.ts"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))
    return ok


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace")


def extract_shim(ui_text):
    """从 UI 文件里抽出 DSH_POPUP_SHIM 模板字符串的内容（纯 JS）。"""
    m = re.search(r"const DSH_POPUP_SHIM = `\n(.*?)\n`;", ui_text, re.S)
    if not m:
        return None
    return m.group(1)


def main():
    cache = None
    if "--cache" in sys.argv:
        i = sys.argv.index("--cache")
        if i + 1 < len(sys.argv):
            cache = sys.argv[i + 1]

    if not os.path.isdir(UPSTREAM):
        print("ERROR: upstream/ 缺失")
        return 2

    tmp = tempfile.mkdtemp(prefix="dsh_test_")
    try:
        stage = os.path.join(tmp, "stage")
        shutil.copytree(UPSTREAM, stage)

        # ---------- T1 基线：upstream 必须是原版，不含任何补丁 ----------
        base_runtime = read(os.path.join(stage, RUNTIME_JS))
        base_ui = read(os.path.join(stage, UI_JS))
        check("T1a upstream runtime 无 NODE 补丁",
              "export NODE=/usr/bin/node" not in base_runtime)
        check("T1b upstream runtime 无 packages 补丁",
              '"packages:",' not in base_runtime)
        check("T1c upstream ui 无 popup shim",
              "installDshPopupShim" not in base_ui)

        # ---------- T2 --check 模式不写文件 ----------
        rc, out = run([sys.executable, PATCHER, "--check", stage])
        after_check = read(os.path.join(stage, UI_JS))
        check("T2a --check 返回 0", rc == 0, "rc=%d" % rc)
        check("T2b --check 不改动文件", after_check == base_ui)

        # ---------- T3 施加补丁 ----------
        rc, out = run([sys.executable, PATCHER, stage])
        check("T3 apply_patches 返回 0", rc == 0, "rc=%d" % rc)

        for rel, need in [
            (RUNTIME_JS, ['export PATH="/usr/bin:$PNPM_HOME:$PATH"',
                          "export NODE=/usr/bin/node",
                          '"packages:",',
                          '  - "."']),
            (RUNTIME_TS, ['export PATH="/usr/bin:$PNPM_HOME:$PATH"',
                          "export NODE=/usr/bin/node",
                          '"packages:",']),
            (UI_JS, ["const DSH_POPUP_SHIM = `",
                     "async function installDshPopupShim(controller) {",
                     "await controller.evaluateJavascript(DSH_POPUP_SHIM);",
                     "void installDshPopupShim(webViewController)"]),
            (UI_TS, ["const DSH_POPUP_SHIM = `",
                     "async function installDshPopupShim(controller) {",
                     "void installDshPopupShim(webViewController)"]),
        ]:
            text = read(os.path.join(stage, rel))
            for needle in need:
                check("T3 %s 含 %r" % (os.path.basename(rel), needle[:40]),
                      needle in text)

        # ---------- T4 顺序正确性：shim 注入必须在 CSS 注入之前 ----------
        ui = read(os.path.join(stage, UI_JS))
        idx_shim = ui.find("void installDshPopupShim(webViewController)")
        idx_css = ui.find("applyMobileLayoutCss(webViewController, assets)", idx_shim if idx_shim > 0 else 0)
        check("T4 onPageFinished 里 shim 在 CSS 之前",
              idx_shim > 0 and idx_css > idx_shim,
              "shim@%d css@%d" % (idx_shim, idx_css))
        # 旧的单行调用应已不存在
        check("T4b 旧调用链已被替换",
              "void loadMobileLayoutAssets()\n                        .then((assets) => applyMobileLayoutCss" not in ui)

        # ---------- T5 幂等 ----------
        before = {p: read(os.path.join(stage, p)) for p in (RUNTIME_JS, UI_JS)}
        rc, out = run([sys.executable, PATCHER, stage])
        after = {p: read(os.path.join(stage, p)) for p in (RUNTIME_JS, UI_JS)}
        check("T5a 二次执行返回 0", rc == 0, "rc=%d" % rc)
        check("T5b 二次执行不改动内容", before == after)

        # ---------- T6 shim JS 自身语法合法 ----------
        shim = extract_shim(read(os.path.join(stage, UI_JS)))
        if shim is None:
            check("T6 shim 提取", False, "未匹配到 DSH_POPUP_SHIM")
        else:
            p = os.path.join(tmp, "shim.mjs")
            with io.open(p, "w", encoding="utf-8") as f:
                f.write(shim)
            rc, out = run(["/usr/bin/node" if os.path.exists("/usr/bin/node") else "node", "--check", p])
            check("T6 shim JS 语法合法", rc == 0, (out.strip()[:200] if rc else ""))
            check("T6b shim 覆盖 window.open", "window.open = function" in shim)
            check("T6c shim 返回 null（走 DSH 降级路径）", "return null;" in shim)
            check("T6d shim 对 about:blank 不弹窗",
                  '"about:blank"' in shim)
            check("T6e shim 提供复制兜底", "复制授权链接" in shim)

        # ---------- T7 所有 JS 语法合法 ----------
        bad = []
        for dirpath, _, files in os.walk(stage):
            for name in files:
                if not name.endswith(".js"):
                    continue
                full = os.path.join(dirpath, name)
                tmpm = os.path.join(tmp, "chk.mjs")
                shutil.copyfile(full, tmpm)
                rc, out = run(["/usr/bin/node" if os.path.exists("/usr/bin/node") else "node", "--check", tmpm])
                if rc != 0:
                    bad.append((os.path.relpath(full, stage), out.strip()[:120]))
        check("T7 全部 js 通过 node --check", not bad, str(bad)[:300])

        # ---------- T8 manifest ----------
        man = json.load(io.open(os.path.join(stage, "manifest.json"), encoding="utf-8"))
        check("T8a manifest 版本 0.7.2", man.get("version") == "0.7.2")
        check("T8b manifest 子包数 3", len(man.get("subpackages", [])) == 3)
        check("T8c dsh_subagent 默认关闭",
              any(s["id"] == "dsh_subagent" and s["enabled_by_default"] is False
                  for s in man["subpackages"]))
        entry_ok = all(os.path.isfile(os.path.join(stage, s["entry"])) for s in man["subpackages"])
        check("T8d 所有子包 entry 存在", entry_ok)
        res_ok = all(os.path.isfile(os.path.join(stage, r["path"])) for r in man.get("resources", []))
        check("T8e 所有 resources 存在", res_ok)

        # ---------- T9 构建 toolpkg 并回读 ----------
        out_pkg = os.path.join(tmp, "out.toolpkg")
        rc, out = run([sys.executable, BUILDER, "--out", out_pkg], cwd=REPO)
        check("T9a build_toolpkg 返回 0", rc == 0, "rc=%d" % rc)
        if os.path.isfile(out_pkg):
            import zipfile
            with zipfile.ZipFile(out_pkg) as z:
                names = z.namelist()
                check("T9b 包内 25 个文件", len(names) == 25, str(len(names)))
                check("T9c 包内路径无顶层目录", all(not n.startswith("/") for n in names))
                check("T9d 包内含 dist/main.js", "dist/main.js" in names)
                check("T9e 包内含 manifest.json", "manifest.json" in names)
                inner_ui = z.read(UI_JS).decode("utf-8")
                check("T9f 包内 UI 已含 shim", "installDshPopupShim" in inner_ui)
                inner_rt = z.read(RUNTIME_JS).decode("utf-8")
                check("T9g 包内 runtime 已含 NODE 补丁",
                      "export NODE=/usr/bin/node" in inner_rt)
                check("T9h 包内 runtime 已含 packages 补丁",
                      '"packages:",' in inner_rt)
        else:
            check("T9b 包已生成", False)

        # ---------- T9i 行为测试：真实执行 shim JS ----------
        shim_test = os.path.join(HERE, "shim_behavior.mjs")
        node_bin = "/usr/bin/node" if os.path.exists("/usr/bin/node") else "node"
        if os.path.isfile(shim_test):
            rc, out = run([node_bin, shim_test, os.path.join(stage, UI_JS)])
            tail = [l for l in out.strip().splitlines() if l.startswith("RESULT:")]
            check("T9i shim 行为测试通过", rc == 0,
                  (tail[-1] if tail else out.strip()[-200:]))
        else:
            check("T9i 行为测试脚本存在", False, shim_test)

        # ---------- T10 可选：与线上缓存对比 ----------
        if cache:
            if not os.path.isdir(cache):
                check("T10 缓存目录存在", False, cache)
            else:
                same, diff = 0, []
                for dirpath, _, files in os.walk(stage):
                    for name in files:
                        full = os.path.join(dirpath, name)
                        rel = os.path.relpath(full, stage)
                        target = os.path.join(cache, rel)
                        if not os.path.isfile(target):
                            diff.append("missing:" + rel)
                        elif open(full, "rb").read() != open(target, "rb").read():
                            diff.append("diff:" + rel)
                        else:
                            same += 1
                check("T10 与线上缓存逐字节一致", not diff,
                      "same=%d diff=%s" % (same, diff[:5]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("=" * 72)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("RESULT: %d/%d passed" % (passed, total))
    if passed != total:
        print("FAILED:")
        for name, ok, detail in results:
            if not ok:
                print("  - %s %s" % (name, detail))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())