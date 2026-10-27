#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""遗留平台表引用审计：谁在读租户库里的 users / sessions / tenants / user_tenants？

背景：`tenant_N.db` 里残留着主库平台表的旧快照（`db/connection.py::_ensure_tenant_db`
那场 `backup()` 事故）。清理（DROP）之前必须回答：**有没有代码在租户上下文里读它们**。
若答案是"有"，那这些副本就是**承重**的 —— 直接 DROP 会让那些接口静默变成空/错。

本脚本不猜，分两段证据链：

  ① **连接类型**：该函数取连接用的是
       master  = `core._master_db()` / `_master_conn()` / `sqlite3.connect(DB_PATH)`（恒主库）
       tenant  = `get_db()` / `get_db_tx()` / `_connect()` —— 这三个都**跟随租户上下文**
                 （见 db/connection.py：`_sqlite_connect()` 用 `_tenant_db.get() or DB_PATH`）
       param   = 连接由调用方传入（`def f(conn)`），本层无法判定
       none    = 函数体内没有取连接的代码（用模块级全局，或根本没执行）
  ② **路由上下文**：若该函数是 HTTP 端点，按 `server.py` 的中间件前缀表判定它跑在
       主库上下文 还是 租户上下文：
       `_TENANT_MASTER_PREFIXES` / `_TENANT_PUBLIC_PREFIXES` ⇒ 主库（`set_tenant_context(None)`）
       其余 `/api/*` ⇒ 租户上下文（fail-closed）

只有「tenant 连接 + 租户上下文」才是**真正的危险项**（读的是租户库里的旧副本）。
「tenant 连接 + 主库上下文」是安全的：上下文为 None 时同一函数回落到主库。

用法：
    python3 tools/hergent/v706/scan_legacy_reads.py /path/to/backend
    python3 tools/hergent/v706/scan_legacy_reads.py /path/to/backend --json
"""
import argparse
import io
import json
import os
import re
import sys
import tokenize

TABLES = ["users", "sessions", "user_tenants", "tenants", "invite_codes", "invite_uses"]
REF_RE = re.compile(r"\b(FROM|INTO|UPDATE|JOIN)\s+(%s)\b" % "|".join(TABLES), re.I)

# 与 server.py 的中间件同源（这里复述一份：审计脚本不该 import 被审计的代码）
MASTER_PREFIXES = (
    "/api/users", "/api/permissions", "/api/force-logout", "/api/config", "/api/monitor",
    "/api/auth", "/api/tenants", "/api/api-tokens", "/api/internal", "/api/system",
    "/api/health", "/api/bot", "/api/webhook", "/api/portal", "/api/feature-flags",
    "/api/csp-report", "/api/v1", "/metrics", "/api/versions",
)

ROUTE_RE = re.compile(
    r"@(app|router)\.(get|post|put|patch|delete)\(\s*[\"']([^\"']+)[\"']")
DEF_RE = re.compile(r"^(async )?def (\w+)")
CALL_RE = re.compile(r"\b(\w+)\s*\(")


def code_lines(path):
    """去掉注释与字符串字面量后的代码行（按原行号对齐）。

    为什么必须去：本仓注释里大量出现 `get_db()`、`users` 这类字眼（例如
    「不要用 get_db() 读主库表」），直接正则会把**注释**当成证据。
    """
    src = open(path, encoding="utf-8", errors="replace").read()
    buf = {}
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            ln = tok.start[0]
            if tok.type == tokenize.COMMENT:
                buf[ln] = buf.get(ln, "") + " "
            elif tok.type == tokenize.STRING:
                buf[ln] = buf.get(ln, "") + " __S__ "
            elif tok.type in (tokenize.NEWLINE, tokenize.NL):
                buf[ln] = buf.get(ln, "") + "\n"
            else:
                # 🔴 必须补一个空格：token 直接相连会把 `with get_db() as db`
                # 粘成 `withget_db()asdb`，`\bget_db` 就再也匹配不上（实测踩过）。
                buf[ln] = buf.get(ln, "") + " " + tok.string
    except Exception:
        return src.split("\n")
    n = max(buf) if buf else 0
    return [buf.get(i, "") for i in range(1, n + 2)]


def find_funcs(raw):
    """→ [(name, start, end, route_path or None)]，只认顶层 def，路由取上方最近装饰器。"""
    out, cur = [], None
    for i, line in enumerate(raw):
        m = DEF_RE.match(line)
        if not m:
            continue
        if cur:
            out.append((cur[0], cur[1], i - 1, cur[2]))
        route = None
        for j in range(i - 1, max(-1, i - 6), -1):
            s = raw[j].strip()
            if not s:
                continue
            rm = ROUTE_RE.search(raw[j])
            if rm:
                route = rm.group(3)
                break
            if not s.startswith("@"):
                break
        cur = (m.group(2), i, route)
    if cur:
        out.append((cur[0], cur[1], len(raw) - 1, cur[2]))
    return out


def conn_kind(body):
    # ⚠️ code_lines() 在 token 之间补了空格（否则 `with get_db()` 会粘成一个词），
    #    所以这里的正则一律按「允许空白」写，不能写死成 `get_db()`。
    master = re.search(r"_master_db|_master_conn|_master_ro_conn", body) or \
        re.search(r"sqlite3\s*\.\s*connect\s*\(\s*(DB_PATH|f?\s*\"file:)", body)
    tenant = re.search(r"\bget_db(_tx)?\s*\(\s*\)", body) or \
        re.search(r"(?<![\w.])_connect\s*\(\s*\)", body)
    if master and tenant:
        return "mixed"
    if master:
        return "master"
    if tenant:
        return "tenant"
    if re.search(r"def \w+\([^)]*\b(conn|db|con|c)\b", body.split("\n")[0] if body else ""):
        return "param"
    return "none"


def route_ctx(route):
    if not route:
        return None
    p = route if route.startswith("/") else "/" + route
    if p.startswith(MASTER_PREFIXES):
        return "master"
    if p.startswith("/api"):
        return "tenant"
    return "non-api"


def scan(root):
    results = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__" and not d.startswith(".")]
        for fn in sorted(files):
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dirpath, fn)
            raw = open(path, encoding="utf-8", errors="replace").read().split("\n")
            code = code_lines(path)
            for name, s, e, route in find_funcs(raw):
                hits = [i + 1 for i in range(s, min(e + 1, len(raw)))
                        if REF_RE.search(raw[i]) and not raw[i].strip().startswith("#")]
                if not hits:
                    continue
                body = "\n".join(code[s:e + 1])
                kind = conn_kind(body)
                ctx = route_ctx(route)
                if kind == "tenant" and ctx == "tenant":
                    level, why = "DANGER", "租户连接 + 租户上下文 ⇒ 读的是租户库里的旧副本"
                elif kind in ("tenant", "mixed") and ctx is None:
                    level, why = "UNKNOWN", "非端点（helper/CLI）⇒ 由调用方决定上下文，需人工追调用链"
                elif kind == "mixed":
                    level, why = "MIXED", "同函数内混用主库与租户连接"
                elif kind == "param":
                    level, why = "PARAM", "连接由调用方传入"
                elif kind in ("tenant",) and ctx == "master":
                    level, why = "SAFE", "租户连接但端点在主库上下文（上下文为 None ⇒ 回落主库）"
                elif kind == "master":
                    level, why = "SAFE", "显式主库连接"
                else:
                    level, why = "SAFE", "无可判定的取连接代码（未执行到 / 用全局连接）"
                results.append({
                    "file": os.path.relpath(path, root), "func": name,
                    "line": hits[0], "refs": len(hits), "route": route,
                    "conn": kind, "ctx": ctx, "level": level, "why": why,
                })
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", help="后端源码目录（生产布局 /opt/hergent-erp）")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not os.path.isdir(a.root):
        print("目录不存在：%s" % a.root, file=sys.stderr)
        return 1
    rows = scan(a.root)
    order = {"DANGER": 0, "MIXED": 1, "UNKNOWN": 2, "PARAM": 3, "SAFE": 4}
    rows.sort(key=lambda r: (order[r["level"]], r["file"], r["line"]))
    if a.json:
        print(json.dumps({"total": len(rows),
                          "by_level": {k: sum(1 for r in rows if r["level"] == k)
                                       for k in order},
                          "rows": rows}, ensure_ascii=False, indent=2))
        return 0
    counts = {k: sum(1 for r in rows if r["level"] == k) for k in order}
    print("=" * 96)
    print("遗留平台表引用审计  共 %d 个函数：%s" % (
        len(rows), "  ".join("%s=%d" % (k, counts[k]) for k in order)))
    print("=" * 96)
    for lv in order:
        sub = [r for r in rows if r["level"] == lv]
        if not sub:
            continue
        print("\n【%s】%s" % (lv, sub[0]["why"]))
        for r in sub:
            print("  %-20s %-36s L%-6d x%-2d conn=%-7s ctx=%-7s %s" % (
                r["file"], r["func"], r["line"], r["refs"], r["conn"],
                r["ctx"] or "-", r["route"] or ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
