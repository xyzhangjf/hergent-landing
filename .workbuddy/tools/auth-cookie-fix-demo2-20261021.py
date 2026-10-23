#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补 /demo-login 的 CSRF cookie。

为什么必须：P0-4 把网页端改成纯 cookie 凭证后，**state-changing 请求一律要求
X-CSRF-Token 头 == csrf cookie**（Bearer 才免 CSRF）。而 /demo-login 原本不下发
任何 csrf cookie ⇒ demo 用户（只读演示）点「退出」都会吃 403 CSRF_REQUIRED，
等于这次改造引入一个新故障。/login 与 /register 都已下发，此处对齐。
"""
import io, os, sys, shutil

TARGET = "/opt/hergent-erp/routers/auth.py"
BACKUP = TARGET + ".bak-20261021-p04c"


def main():
    src = io.open(TARGET, "r", encoding="utf-8").read()

    if "P0-4 (v628): demo 也下发 CSRF" in src:
        print("已打过，跳过")
        return

    if not os.path.exists(BACKUP):
        shutil.copy2(TARGET, BACKUP)
        print("已备份 -> %s" % BACKUP)

    anchor = '''    is_production = os.environ.get("ENV", "") == "production"
    resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                    secure=is_production, max_age=14400)'''

    new = '''    is_production = os.environ.get("ENV", "") == "production"
    # P0-4 (v628): demo 也下发 CSRF —— 改纯 cookie 凭证后写操作一律要 X-CSRF-Token，
    #   而 demo 原本一个 csrf cookie 都没有 ⇒ 连「退出」都会 403 CSRF_REQUIRED。
    #   与 /login、/register 完全对齐（同名、同 secure/samesite 策略）。
    csrf_token = secrets.token_urlsafe(32)
    resp.set_cookie(key="__Host-csrf", value=csrf_token, samesite="strict",
                    httponly=False, secure=is_production, max_age=14400)
    resp.set_cookie(key="csrf_token", value=csrf_token, samesite="lax",
                    httponly=False, secure=is_production, max_age=14400)
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
