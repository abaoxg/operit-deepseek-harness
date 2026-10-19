#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""变异测试（mutation test）：验证 apply_patches.py 在异常输入下「必须失败」。

存在意义：
    补丁脚本最大的风险不是打不上，而是「装作打上了」。如果锚点变了却仍然
    返回 0，打包脚本会产出一个「看似打了补丁、其实没打」的 toolpkg，用户
    装上后依旧闪退，而且极难排查。本测试专门防这一点。

每个用例：
    1. 复制 upstream 到临时目录
    2. 施加人为破坏
    3. 运行 apply_patches.py
    4. 断言退出码 != 0，且输出里出现对应锚点提示

用法:
    python3 tests/test_mutation.py
"""

import io
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
UPSTREAM = os.path.join(REPO, "upstream")
PATCHER = os.path.join(REPO, "tools", "apply_patches.py")

RUNTIME_JS = "dist/shared/deepseek_harness_web_runtime.js"
UI_JS = "dist/ui/deepseek_harness_dashboard/index.ui.js"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, ("  -- " + detail) if detail else ""))


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)


def run_patcher(root):
    r = subprocess.run([sys.executable, PATCHER, root],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return r.returncode, r.stdout.decode("utf-8", "replace")


def case(name, mutate, expect_hint):
    """mutate(stage_dir) 施加破坏，然后断言补丁器必须失败。"""
    tmp = tempfile.mkdtemp(prefix="dsh_mut_")
    try:
        stage = os.path.join(tmp, "stage")
        shutil.copytree(UPSTREAM, stage)
        mutate(stage)
        rc, out = run_patcher(stage)
        ok_rc = rc != 0
        ok_hint = expect_hint in out
        check("%s -> 退出码非 0" % name, ok_rc, "rc=%d" % rc)
        check("%s -> 输出含 %r" % (name, expect_hint), ok_hint,
              "" if ok_hint else out.strip()[-160:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def m_runtime_no_path(stage):
    """删掉 export PATH 那一行 -> P2 锚点缺失"""
    p = os.path.join(stage, RUNTIME_JS)
    s = read(p)
    s = s.replace("""        'export PATH="$PNPM_HOME:$PATH"',\n""", "", 1)
    write(p, s)


def m_runtime_no_config(stage):
    """改掉 const config = [ ... allowBuilds 结构 -> P1 锚点缺失"""
    p = os.path.join(stage, RUNTIME_JS)
    s = read(p)
    s = s.replace('    const config = [\n        "allowBuilds:",',
                  '    const cfg2 = [\n        "allowBuilds:",', 1)
    write(p, s)


def m_ui_no_anchor(stage):
    """改名 applyMobileLayoutCss -> P3 shim 锚点缺失"""
    p = os.path.join(stage, UI_JS)
    s = read(p)
    s = s.replace("async function applyMobileLayoutCss(controller, assets) {",
                  "async function applyLayoutCss(controller, assets) {", 1)
    write(p, s)


def m_ui_no_fin(stage):
    """删掉 onPageFinished 的调用链 -> P3-fin 锚点缺失"""
    p = os.path.join(stage, UI_JS)
    s = read(p)
    s = s.replace("""                    void loadMobileLayoutAssets()
                        .then((assets) => applyMobileLayoutCss(webViewController, assets))
""", "                    void loadMobileLayoutAssets()\n", 1)
    write(p, s)


def m_missing_file(stage):
    """直接删掉 UI 文件 -> 必须报 missing file"""
    os.remove(os.path.join(stage, UI_JS))


def main():
    if not os.path.isdir(UPSTREAM):
        print("ERROR: upstream/ 缺失")
        return 2

    case("M1 runtime 缺 export PATH", m_runtime_no_path, "P2 anchor missing")
    case("M2 runtime 缺 const config", m_runtime_no_config, "P1 anchor missing")
    case("M3 ui 缺 applyMobileLayoutCss", m_ui_no_anchor, "P3 anchor missing")
    case("M4 ui 缺 onPageFinished 链", m_ui_no_fin, "P3 anchor missing")
    case("M5 ui 文件缺失", m_missing_file, "missing file")

    # 对照组：未破坏时必须成功，否则说明测试本身有问题
    tmp = tempfile.mkdtemp(prefix="dsh_mut_ok_")
    try:
        stage = os.path.join(tmp, "stage")
        shutil.copytree(UPSTREAM, stage)
        rc, out = run_patcher(stage)
        check("M0 对照组（未破坏）必须成功", rc == 0, "rc=%d" % rc)
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