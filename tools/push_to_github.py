#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本仓库推送到 GitHub。

用法:
    GITHUB_TOKEN=ghp_xxx python3 tools/push_to_github.py <owner>/<repo> [--private]
    GITHUB_TOKEN=ghp_xxx python3 tools/push_to_github.py abaoxg/operit-deepseek-harness

行为:
    1. 校验 token（GET /user）
    2. 仓库不存在则自动创建（默认 public，可用 --private）
    3. git add / commit（有改动时）
    4. push 到 main
    5. **推送后把 remote 改回不带 token 的 URL**，避免 token 残留在 .git/config

安全说明:
    token 只从环境变量读取，不接受命令行参数（避免进入 shell history）。
    推送结束后 remote URL 会被清理为不含凭证的形式。
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(HERE)


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = r.stdout.decode("utf-8", "replace")
    if check and r.returncode != 0:
        raise RuntimeError("command failed: %s\n%s" % (" ".join(cmd), out))
    return r.returncode, out


def api(path, token, method="GET", payload=None):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"message": body}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", help="<owner>/<repo>")
    ap.add_argument("--private", action="store_true", help="创建为私有仓库")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--message", default="chore: sync patches and build")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("ERROR: 请通过环境变量提供 token:")
        print("  GITHUB_TOKEN=ghp_xxx python3 tools/push_to_github.py %s" % args.repo)
        return 2

    if "/" not in args.repo:
        print("ERROR: 仓库参数必须是 <owner>/<repo> 形式")
        return 2
    owner, name = args.repo.split("/", 1)

    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        print("ERROR: %s 不是 git 仓库，请先 git init" % REPO_DIR)
        return 2

    # ---------- 1. 校验 token ----------
    status, data = api("/user", token)
    if status != 200:
        print("ERROR: token 校验失败 (%d): %s" % (status, data.get("message")))
        return 1
    login = data.get("login")
    print("token 有效, 账号: %s" % login)
    if login != owner:
        print("注意: token 属于 %s，但目标 owner 是 %s（组织仓库则正常）" % (login, owner))

    # ---------- 2. 仓库存在性 ----------
    status, data = api("/repos/%s/%s" % (owner, name), token)
    if status == 200:
        print("仓库已存在: %s" % data.get("html_url"))
        if data.get("default_branch") and data["default_branch"] != args.branch:
            print("注意: 远端默认分支是 %s，本脚本推送到 %s"
                  % (data["default_branch"], args.branch))
    elif status == 404:
        print("仓库不存在，创建中...")
        st, info = api("/user/repos" if owner == login else "/orgs/%s/repos" % owner,
                       token, method="POST",
                       payload={
                           "name": name,
                           "private": bool(args.private),
                           "description": "Operit deepseek_harness plugin patches (P1 pnpm / P2 node / P3 WebView popup)",
                           "has_issues": True,
                           "has_wiki": False,
                       })
        if st not in (200, 201):
            print("ERROR: 创建仓库失败 (%d): %s" % (st, info.get("message")))
            return 1
        print("已创建: %s" % info.get("html_url"))
    else:
        print("ERROR: 查询仓库失败 (%d): %s" % (status, data.get("message")))
        return 1

    # ---------- 3. 配置 git 身份（若未设置） ----------
    rc, _ = run(["git", "config", "user.email"], cwd=REPO_DIR, check=False)
    if rc != 0:
        run(["git", "config", "user.email", "%s@users.noreply.github.com" % login], cwd=REPO_DIR)
    rc, _ = run(["git", "config", "user.name"], cwd=REPO_DIR, check=False)
    if rc != 0:
        run(["git", "config", "user.name", login], cwd=REPO_DIR)

    # ---------- 4. add / commit ----------
    run(["git", "add", "-A"], cwd=REPO_DIR)
    rc, out = run(["git", "status", "--porcelain"], cwd=REPO_DIR)
    if out.strip():
        run(["git", "commit", "-m", args.message], cwd=REPO_DIR)
        print("已提交变更")
    else:
        print("无待提交变更")

    # ---------- 5. push（token 只在这一次命令里出现） ----------
    auth_url = "https://x-access-token:%s@github.com/%s/%s.git" % (token, owner, name)
    clean_url = "https://github.com/%s/%s.git" % (owner, name)

    run(["git", "remote", "remove", "origin"], cwd=REPO_DIR, check=False)
    run(["git", "remote", "add", "origin", auth_url], cwd=REPO_DIR)
    try:
        rc, out = run(["git", "push", "-u", "origin", args.branch, "--force"], cwd=REPO_DIR, check=False)
        # 输出里可能带 token，做一次脱敏再打印
        safe = out.replace(token, "***").replace(auth_url, clean_url)
        print(safe.strip())
        push_ok = rc == 0
    finally:
        # 无论成功失败都把 remote 改回干净 URL
        run(["git", "remote", "set-url", "origin", clean_url], cwd=REPO_DIR, check=False)

    if not push_ok:
        print("ERROR: push 失败")
        return 1

    rc, head = run(["git", "rev-parse", "HEAD"], cwd=REPO_DIR, check=False)
    print("-" * 60)
    print("推送完成: https://github.com/%s/%s/tree/%s" % (owner, name, args.branch))
    print("commit: %s" % head.strip())
    print("remote 已清理为: %s" % clean_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())