#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修补上一支补丁引入的 NameError：demo_login 内未定义 is_production。

上一支 auth-cookie-patch 给 /demo-login 的 erp_token 与新增 hergent_auth 加了
`secure=is_production`，但 `is_production` 只定义在 /register 函数体内（局部名），
demo_login 是**另一个函数**，取不到 ⇒ NameError ⇒ /api/auth/demo-login 直接 500。

修法：在 demo_login 函数内显式定义该局部变量（与 register/login 完全同一行写法），
      保持三处口径一致，不改动其它任何逻辑。
"""
import io, os, sys, shutil

TARGET = "/opt/hergent-erp/routers/auth.py"
BACKUP = TARGET + ".bak-20261021-p04b"


def main():
    src = io.open(TARGET, "r", encoding="utf-8").read()

    if "P0-4 (v628): demo_login 局部 is_production" in src:
        print("已修补，跳过")
        return

    if not os.path.exists(BACKUP):
        shutil.copy2(TARGET, BACKUP)
        print("已备份 -> %s" % BACKUP)

    anchor = '''    resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                    secure=is_production, max_age=14400)'''
    new = '''    # P0-4 (v628): demo_login 局部 is_production —— 与 login/register 同一口径。
    #   🔴 它定义在各函数体内（局部变量），不能跨函数复用；上一支补丁在 demo_login
    #      里直接引用会 NameError ⇒ /api/auth/demo-login 500。
    is_production = os.environ.get("ENV", "") == "production"
    resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                    secure=is_production, max_age=14400)'''

    if anchor not in src:
        print("锚点未找到，中止")
        sys.exit(1)

    src = src.replace(anchor, new, 1)
    io.open(TARGET, "w", encoding="utf-8").write(src)

    import py_compile
    try:
        py_compile.compile(TARGET, doraise=True)
        print("已修补，语法 OK")
    except Exception as e:
        print("语法错误，回滚: %s" % e)
        shutil.copy2(BACKUP, TARGET)
        sys.exit(1)


if __name__ == "__main__":
    main()
