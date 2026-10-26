#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v695b：`/api/auth/me` 多回一个 `platform_admin` 标记。

为什么需要：AiHub「用量与配额」里有个改档下拉（把 tier 从 free 改到 enterprise），
判据是 `roleIn(store.user.role, ADMIN_ROLES)` —— 也就是**任何租户管理员都看得见**。
而改档是商业条款，后端已收紧到 `_platform_admin`（见 patch_v695）。
后端收紧、前端还摆着下拉 ⇒ 客户点了报 403，等于给客户看一个必然失败的按钮。
所以前端要能知道「我是不是平台管理员」，判据必须由后端下发，前端不许自己猜
（角色表 `role` 说不了这事：每个自注册用户的 role 就是 boss）。

用法：
    python3 patch_v695b_me_platform_admin.py --target=/opt/hergent-erp/routers/auth.py [--dry-run]
"""
import sys
import shutil
import py_compile
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/auth.py")

OLD = '''def me(request: Request):
    from core import user_roles
    u = _auth(request)
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"],
            "role": u["role"], "roles": user_roles(u)}'''

NEW = '''def me(request: Request):
    from core import user_roles, is_platform_admin_user
    u = _auth(request)
    return {"id": u["id"], "username": u["username"], "display_name": u["display_name"],
            "role": u["role"], "roles": user_roles(u),
            # v695：平台管理员标记（platform_admins 名单表，fail-closed）。
            #   前端用它决定「改套餐下拉」要不要出现 —— 这是商业条款，不是租户管理权。
            #   前端不许用 role 自己推：每个自注册用户的 role 就是 boss。
            "platform_admin": is_platform_admin_user(u)}'''


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    src = target.read_text(encoding="utf-8")

    if '"platform_admin": is_platform_admin_user(u)' in src:
        print("已打过 v695b，跳过。")
        return 0
    n = src.count(OLD)
    if n != 1:
        print("anchors 命中 %d 次（必须 1），未修改。" % n)
        return 3
    if dry:
        print("[dry-run] 将给 /api/auth/me 加 platform_admin 字段")
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v695b")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)
    tmp = target.with_suffix(".v695b.tmp")
    tmp.write_text(src.replace(OLD, NEW, 1), encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败：%s" % e)
        return 4
    shutil.move(str(tmp), str(target))
    print("已写入 %s" % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
