#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
credscan-untracked.py — 入库前凭据扫描（Hergent 未跟踪资产归档 SOP §2）

用法:
    python3 .workbuddy/tools/credscan-untracked.py            # 扫全部未跟踪文本文件
    python3 .workbuddy/tools/credscan-untracked.py --list f   # 只扫清单文件里的路径

判据来源 = `git ls-files -o --exclude-standard -z`（-z 防中文引号转义）。
命中 ≠ 阻断：需再查该串是否早已在历史/已跟踪文件中（另跑 git log -S / git grep）。

退出码: 0 = 无命中; 1 = 有命中。
"""
import subprocess
import sys
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".woff", ".woff2",
              ".ico", ".db", ".sqlite", ".asar", ".dmg", ".zip", ".gz", ".tar"}

# 模式：(名称, 正则)
PATTERNS = [
    ("私钥块",        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("Bearer长令牌",  re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("api_key赋值",   re.compile(r"(?i)\b(api[_-]?key|apikey|secret[_-]?key)\b\s*[:=]\s*['\"][^'\"]{8,}['\"]")),
    ("明文密码赋值",  re.compile(r"(?i)\b(password|passwd|pwd)\b\s*[:=]\s*['\"][^'\"]{4,}['\"]")),
    ("ERP_SECRET",    re.compile(r"ERP_SECRET\s*[:=]\s*['\"]?[^'\"\s]{6,}")),
    ("长十六进制",    re.compile(r"\b[0-9a-fA-F]{32,}\b")),
    ("手机号(中国)",  re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("身份证",        re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")),
    ("网关明文key",   re.compile(r"hergent-prod-gateway-key")),
    ("硬编码口令",    re.compile(r"hergent2026")),
    ("本地绝对路径token", re.compile(r"/tmp/[A-Za-z0-9_\-]*token[A-Za-z0-9_\-]*")),
]

# 常见「非凭据」白名单：md5/sha 摘要行、uuid、纯示例占位
SAFE_CTX = re.compile(r"(?i)(md5|sha1|sha256|checksum|hash|etag|uuid|示例|placeholder|xxx+|<your|例:|例如)")


def untracked():
    out = subprocess.run(
        ["git", "ls-files", "-o", "--exclude-standard", "-z"],
        cwd=ROOT, capture_output=True)
    return [p for p in out.stdout.decode("utf-8", "replace").split("\0") if p]


def main():
    if "--list" in sys.argv:
        i = sys.argv.index("--list")
        with open(sys.argv[i + 1], "r", encoding="utf-8") as f:
            files = [ln.rstrip("\n") for ln in f if ln.strip()]
    else:
        files = untracked()

    hits = []
    scanned = 0
    for rel in files:
        ext = os.path.splitext(rel)[1].lower()
        if ext in BINARY_EXT:
            continue
        ap = os.path.join(ROOT, rel)
        try:
            with open(ap, "r", encoding="utf-8", errors="strict") as f:
                lines = f.readlines()
        except (UnicodeDecodeError, OSError, IsADirectoryError):
            continue
        scanned += 1
        for ln_no, line in enumerate(lines, 1):
            for name, pat in PATTERNS:
                m = pat.search(line)
                if not m:
                    continue
                # 白名单：同行含 md5/sha/示例 等 => 降级为 INFO 不报
                level = "INFO" if SAFE_CTX.search(line) else "🔴HIT"
                hits.append((level, name, rel, ln_no, line.strip()[:160]))

    print(f"扫描文件数(文本): {scanned} / 未跟踪总数: {len(files)}")
    print("=" * 70)
    real = [h for h in hits if h[0] == "🔴HIT"]
    info = [h for h in hits if h[0] == "INFO"]
    if not real:
        print("✅ 无高置信命中（🔴HIT = 0）")
    for lv, name, rel, ln_no, snip in real:
        print(f"{lv} [{name}] {rel}:{ln_no}\n    {snip}")
    if info:
        print(f"\n— 已降级 INFO（疑似 md5/示例，{len(info)} 条，供人工扫一眼）—")
        for lv, name, rel, ln_no, snip in info[:30]:
            print(f"  INFO [{name}] {rel}:{ln_no}  {snip}")
    return 1 if real else 0


if __name__ == "__main__":
    sys.exit(main())
