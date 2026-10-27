#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v700：修「副驾角色头像又回退成 🚀 火箭图标」。

=====================================================================
🔴 根因（生产实测三条 curl，不是推测）
=====================================================================
老板 2026-10-27 报「副驾的角色头像怎么又回退到火箭图标」。

实测 `GET https://hergent.cn/api/ai/roles/copilot/avatar`：

    A. 完全不带 cookie                        → 200  image/png  96928B  256x256 ✅
    B. 有效 token（能量出租户）               → 200  image/png  96928B ✅
    C. 有效 token + hergent_tenant=1（无权）  → 403  TENANT_FORBIDDEN  ❌
    D. 过期/无效 token                        → 403  TENANT_REQUIRED  ❌

头像文件本身**都在**：`/opt/hergent-data/role-avatars/1/{copilot,accountant,cs,secretary,ops}.png`
（各 89~98KB，256x256）。数据库 `ai_roles.custom_avatar` 也全是 1。数据没坏。

坏的是访问链路：
`tenant_middleware` 对 `/api/ai` 前缀一律强制要求租户上下文（fail-closed），
而 `<img src>` 是浏览器自己发的请求 —— **带不了 `X-Tenant-Id` 自定义头**，
只能靠 `hergent_tenant` cookie 或 token 推导。只要任一出问题就 403：

  · 老板曾在演示站点点过「先看看演示效果」⇒ 残留 `hergent_tenant=<演示租户>`；
    业务接口因为自己带 `X-Tenant-Id` 头（client.js），头优先级更高所以**一切正常**，
    只有 `<img>` 掉进 cookie 分支 ⇒ 403 ⇒ 裂图 ⇒ RoleAvatar 回落 emoji 🚀。
  · 或 token 过期尚未被业务接口踢出时，<img> 先撞上 403。

⇒ 这就是「**只有头像坏，别的都正常**」的原因。端点本身设计是对的
（`ai_role_avatar_get` 量不到租户就走 `find_role_avatar_fallback`），
但它**根本没机会被执行** —— 中间件已经 403 了。

=====================================================================
修法（1 处，只放宽这一条 GET，不碰业务接口的 fail-closed）
=====================================================================
在 `tenant_middleware` 里、G2 强制判定**之前**插入头像专用分支：
  · 能量到租户 ⇒ 照常用它（**保住租户隔离**：客户看到的还是自己上传的那张）
  · 量不到 / 无权  ⇒ **不 403**，set_tenant_context(None) 放行，
    交给端点走 `find_role_avatar_fallback`（tenant 1 优先，与「未登录访问」现状同一条路径）
  · 非法 tenant id 的 400 校验保留（不因为放宽就把垃圾值吞掉）

不动 `auth_required_middleware`（它对头像 GET 早已豁免），
不动端点、不动落盘目录、不动数据库。

用法：
    python3 patch_v700_avatar_tenant.py [--target=/opt/hergent-erp/server.py] [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/server.py")

ANCHOR_OLD = '''    # G2 (2026-07-25): 所有 /api/ 业务路由默认要求租户上下文（fail-closed）
    tenant_id = request.headers.get("X-Tenant-Id") or request.cookies.get("hergent_tenant")'''

PATCH_NEW = '''    # v700：角色头像 GET 单独放宽 —— 它不是业务数据，是 <img> 直接引用的展示资源。
    #   🔴 为什么必须单独处理：<img> 是浏览器自发请求，**带不了 X-Tenant-Id 头**，
    #      只能靠 hergent_tenant cookie 或 token 推导。业务接口自己带头（client.js）
    #      所以一切正常，只有头像会 403 ⇒ 界面静默回落成 🚀（老板 2026-10-27 报「又回退」）。
    #   实测四条：无 cookie→200 / 有效 token→200 / cookie 残留无权租户→403 /
    #       token 过期→403。头像文件与 custom_avatar 全是好的，坏的只是这道门。
    #   策略：量得到租户就照常用（**租户隔离不放松**）；量不到或无权则放行为 None，
    #      交由端点走 find_role_avatar_fallback（与「未登录访问」同一条既有路径）。
    if request.method == "GET" and re.match(r"^/api/ai/roles/[^/]+/avatar$", path):
        _av_raw = (request.headers.get("X-Tenant-Id")
                   or request.cookies.get("hergent_tenant")
                   or request.query_params.get("tenant_id"))
        _av_t = None
        _av_bad = False
        if _av_raw is not None:
            try:
                _av_t = int(_av_raw)
            except (ValueError, TypeError):
                _av_bad = True
        if _av_bad:
            return JSONResponse(error_envelope(400, "无效的租户ID", "TENANT_INVALID"), status_code=400)
        _av_u = _get_user(request)
        if _av_t is not None and _av_u and not db.check_user_tenant(_av_u["id"], _av_t):
            _av_t = None      # 无权 ⇒ 不拦（拦了就是裂图 + 🚀），退回无租户走 fallback
        if _av_t is None and _av_u:
            _av_uts = db.get_user_tenants(_av_u["id"])
            if _av_uts:
                _av_t = _av_uts[0]
        db.set_tenant_context(_av_t)
        return await call_next(request)

    # G2 (2026-07-25): 所有 /api/ 业务路由默认要求租户上下文（fail-closed）
    tenant_id = request.headers.get("X-Tenant-Id") or request.cookies.get("hergent_tenant")'''


def apply(text, old, new, label, results):
    if new in text:
        results.append(("SKIP", label, "已是新版，跳过"))
        return text
    if old not in text:
        results.append(("FAIL", label, "锚点未命中"))
        return text
    if text.count(old) != 1:
        results.append(("FAIL", label, f"锚点出现 {text.count(old)} 次，不唯一"))
        return text
    results.append(("OK", label, ""))
    return text.replace(old, new, 1)


def main():
    args = list(sys.argv[1:])
    dry = "--dry-run" in args
    target = DEFAULT_TARGET
    for a in args:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print(f"目标文件不存在: {target}")
        return 1

    src = target.read_text(encoding="utf-8")
    results = []
    out = apply(src, ANCHOR_OLD, PATCH_NEW, "1. tenant_middleware 头像 GET 放宽", results)

    print("=" * 62)
    for st, label, note in results:
        mark = {"OK": "✅", "SKIP": "⏭ ", "FAIL": "❌"}[st]
        print(f"{mark} {label}" + (f"  ← {note}" if note else ""))
    print("=" * 62)
    if any(r[0] == "FAIL" for r in results):
        print("有锚点未命中，未写入任何文件。")
        return 2
    if out == src:
        print("内容无变化（已是新版），未写入。")
        return 0
    if dry:
        print("--dry-run：未写入文件。")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = target.with_suffix(target.suffix + f".bak-v700-{ts}")
    shutil.copy2(target, bak)
    target.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(target), doraise=True)
    except Exception as e:
        shutil.copy2(bak, target)
        print(f"❌ 语法检查失败，已回滚：{e}")
        return 3
    print(f"✅ 已写入 {target}\n   备份 {bak}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
