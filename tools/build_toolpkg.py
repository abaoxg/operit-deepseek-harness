#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 upstream/（官方 v0.7.2 原包解包树）构建打好补丁的 .toolpkg。

用法:
    python3 tools/build_toolpkg.py                       # 输出到 releases/
    python3 tools/build_toolpkg.py --out /tmp/out.toolpkg
    python3 tools/build_toolpkg.py --no-patch            # 原样重打包（用于校验基线）

流程:
    upstream/  --copy-->  临时目录  --apply_patches-->  zip  -->  releases/*.toolpkg

设计取舍:
    * 仓库不保存"已打补丁的全量代码树"，避免 upstream 与 patched 两份代码漂移。
    * upstream/ 保留官方原包内容（含 src 与 README），补丁逻辑集中在 apply_patches.py。
    * zip 内部路径不带顶层目录，与官方 toolpkg 保持一致（Operit 按 manifest.main 解析）。
"""

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
UPSTREAM = os.path.join(REPO, "upstream")
RELEASES = os.path.join(REPO, "releases")

# 与官方包保持一致的打包排除项
EXCLUDE_DIRS = {"__pycache__", ".git"}
EXCLUDE_FILES = {".DS_Store", "Thumbs.db"}
EXCLUDE_SUFFIX = (".pyc", ".pyo")


def collect_files(root):
    """返回 [(绝对路径, zip 内相对路径)]，按路径排序保证可复现。"""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_DIRS)
        for name in sorted(filenames):
            if name in EXCLUDE_FILES or name.endswith(EXCLUDE_SUFFIX):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            out.append((full, rel))
    out.sort(key=lambda x: x[1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="输出文件路径，默认 releases/<name>.toolpkg")
    ap.add_argument("--no-patch", action="store_true", help="不施加补丁，仅重新打包 upstream")
    args = ap.parse_args()

    if not os.path.isdir(UPSTREAM):
        print("ERROR: upstream/ 不存在: %s" % UPSTREAM)
        return 2

    manifest_path = os.path.join(UPSTREAM, "manifest.json")
    if not os.path.isfile(manifest_path):
        print("ERROR: upstream/manifest.json 不存在")
        return 2

    with io.open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    pkg_id = manifest["toolpkg_id"]
    version = manifest["version"]

    suffix = "" if args.no_patch else "-operitfix1"
    if args.out:
        out_path = os.path.abspath(args.out)
    else:
        os.makedirs(RELEASES, exist_ok=True)
        out_path = os.path.join(RELEASES, "%s-v%s%s.toolpkg" % (pkg_id, version, suffix))

    workdir = tempfile.mkdtemp(prefix="dsh_build_")
    try:
        stage = os.path.join(workdir, "stage")
        shutil.copytree(UPSTREAM, stage)

        if not args.no_patch:
            patcher = os.path.join(HERE, "apply_patches.py")
            r = subprocess.run([sys.executable, patcher, stage],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            sys.stdout.write(r.stdout.decode("utf-8", "replace"))
            if r.returncode != 0:
                print("ERROR: apply_patches.py 失败，中止打包")
                return 1

        files = collect_files(stage)
        if not files:
            print("ERROR: stage 目录为空")
            return 1

        # 校验入口文件存在
        main_entry = manifest.get("main", "dist/main.js")
        if main_entry.replace("/", os.sep) not in [f[1] for f in files]:
            print("ERROR: manifest.main=%s 不在打包清单中" % main_entry)
            return 1

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        if os.path.exists(out_path):
            os.remove(out_path)

        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for full, rel in files:
                # 固定 mtime 使构建可复现
                info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (0o644 & 0xFFFF) << 16
                with io.open(full, "rb") as fh:
                    z.writestr(info, fh.read())

        size = os.path.getsize(out_path)
        print("-" * 72)
        print("built: %s" % out_path)
        print("files: %d   bytes: %d" % (len(files), size))
        print("manifest: %s v%s%s" % (pkg_id, version, "" if args.no_patch else " (patched)"))
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())