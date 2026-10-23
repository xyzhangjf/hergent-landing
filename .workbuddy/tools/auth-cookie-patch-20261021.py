#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
P0-4 (v628) 后端补丁：把网页端会话凭证从「localStorage + Bearer」迁到「httpOnly Cookie」。

背景（生产实测，2026-10-21）：
  /opt/hergent-erp/routers/auth.py 的 /login **只下发 csrf + tenant cookie，
  不下发 erp_token** —— 网页端登录后浏览器里没有 httpOnly 凭证，只能靠
  /login 响应体里的 token 存 localStorage 发 Bearer。这就是 P0-4 的根因。
  另 /logout 只 DELETE sessions 表，**不清浏览器 cookie**，退出后凭证残留。

本补丁做四件事（全部纯增量，不动 Bearer 分支 —— 小程序/桌面端/bot 依赖它）：
  A. /login      增加 erp_token(httpOnly) + hergent_auth(非 httpOnly 标记)
  B. /register   erp_token 补 secure；增加 hergent_auth
  C. /demo-login erp_token 补 secure；增加 hergent_auth
  D. /logout     清理 erp_token / hergent_auth / csrf_token / __Host-csrf

设计要点：
  * erp_token    = 真凭证，httpOnly ⇒ JS 读不到 ⇒ XSS 偷不走。
  * hergent_auth = **非** httpOnly 的「已登录」标记，仅供前端做 UI/路由守卫。
                   它没有鉴权价值（真边界是后端 _auth），泄露无收益。
                   （httpOnly 凭证 JS 无法感知存在，前端必须有个可见标记判断登录态，
                    业界通行做法，如 GitHub 的 logged_in cookie。）
幂等：已含 hergent_auth 的锚点会跳过，可重复执行。
"""
import io, os, shutil, sys, time

TARGET = "/opt/hergent-erp/routers/auth.py"
BACKUP = TARGET + ".bak-20261021-p04"

MARKER = "hergent_auth"


def read():
    with io.open(TARGET, "r", encoding="utf-8") as f:
        return f.read()


def write(s):
    with io.open(TARGET, "w", encoding="utf-8") as f:
        f.write(s)


def patch(src, anchor, new, tag):
    """精确替换单处锚点；已在则跳过；找不到即报错中止。"""
    if anchor not in src:
        print("  [FAIL] %s 锚点未找到，已中止（未写入）" % tag)
        sys.exit(1)
    print("  [ OK ] %s" % tag)
    return src.replace(anchor, new, 1)


def main():
    if not os.path.exists(TARGET):
        print("目标文件不存在: %s" % TARGET)
        sys.exit(1)

    src = read()
    orig = src

    if MARKER in src:
        print("检测到已含 %s ⇒ 判定为已打过补丁，直接退出（防叠加）。" % MARKER)
        print("如需重打：先 cp %s %s" % (BACKUP, TARGET))
        return

    if not os.path.exists(BACKUP):
        shutil.copy2(TARGET, BACKUP)
        print("已备份 -> %s" % BACKUP)
    else:
        print("备份已存在（沿用）: %s" % BACKUP)

    print("--- 开始打补丁 ---")

    # ---- A. /login：下发 erp_token + hergent_auth ----
    a_anchor = '''                resp.set_cookie("hergent_tenant", str(tenant_id), samesite="lax", max_age=31536000)
            except Exception as e:
                logging.getLogger("hergent").debug(f"optional step failed: {e}")
        return resp'''
    a_new = '''                resp.set_cookie("hergent_tenant", str(tenant_id), samesite="lax", max_age=31536000)
            except Exception as e:
                logging.getLogger("hergent").debug(f"optional step failed: {e}")
        # P0-4 (v628): 会话凭证改由 httpOnly cookie 承载，前端不再存 localStorage / 发 Bearer。
        #   erp_token    = 真凭证（httpOnly ⇒ JS 读不到 ⇒ XSS 偷不走）
        #   hergent_auth = 非 httpOnly 的「已登录」标记，仅供前端路由守卫/UI 判断，
        #                  无鉴权价值（真边界仍是后端 _auth）。httpOnly 凭证 JS 感知不到存在，
        #                  前端必须有个可见标记才能判登录态（业界通行做法）。
        #   ⚠️ 不动 Bearer 分支：小程序 / 桌面端 / bot token 仍走 Authorization 头。
        try:
            resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                            secure=is_production, max_age=86400)
            resp.set_cookie("hergent_auth", "1", httponly=False, samesite="lax",
                            secure=is_production, max_age=86400)
        except Exception as e:
            logging.getLogger("hergent").debug(f"optional step failed: {e}")
        return resp'''
    src = patch(src, a_anchor, a_new, "A. /login 下发 erp_token + hergent_auth")

    # ---- B. /register：erp_token 补 secure + 增加 hergent_auth ----
    b_anchor = '''    resp.set_cookie("erp_token", token, httponly=True, samesite="lax", max_age=86400)
    resp.set_cookie("hergent_tenant", str(tid), samesite="lax", max_age=31536000)
    return resp'''
    b_new = '''    resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                    secure=is_production, max_age=86400)
    resp.set_cookie("hergent_tenant", str(tid), samesite="lax", max_age=31536000)
    # P0-4 (v628): 与 /login 对齐的「已登录」非 httpOnly 标记（理由见 /login 处注释）
    resp.set_cookie("hergent_auth", "1", httponly=False, samesite="lax",
                    secure=is_production, max_age=86400)
    return resp'''
    src = patch(src, b_anchor, b_new, "B. /register 补 secure + hergent_auth")

    # ---- C. /demo-login：erp_token 补 secure + 增加 hergent_auth ----
    c_anchor = '''    resp.set_cookie("erp_token", token, httponly=True, samesite="lax", max_age=14400)
    resp.set_cookie("hergent_tenant", str(tid), samesite="lax", max_age=14400)'''
    c_new = '''    resp.set_cookie("erp_token", token, httponly=True, samesite="lax",
                    secure=is_production, max_age=14400)
    resp.set_cookie("hergent_tenant", str(tid), samesite="lax", max_age=14400)
    # P0-4 (v628): 与 /login 对齐的「已登录」非 httpOnly 标记（理由见 /login 处注释）
    resp.set_cookie("hergent_auth", "1", httponly=False, samesite="lax",
                    secure=is_production, max_age=14400)'''
    src = patch(src, c_anchor, c_new, "C. /demo-login 补 secure + hergent_auth")

    # ---- D. /logout：清浏览器端 cookie ----
    d_anchor = '''        if uname:
            db.audit_log(uname, "登出", "auth", "")
    resp = JSONResponse({"success": True})
    return resp'''
    d_new = '''        if uname:
            db.audit_log(uname, "登出", "auth", "")
    resp = JSONResponse({"success": True})
    # P0-4 (v628): 登出必须清掉浏览器端 cookie。
    #   🔴 原缺陷：这里只 DELETE sessions 表，浏览器里的 erp_token 原封不动 ——
    #      会话在服务端已失效，但 cookie 残留，同一台机器上任何人都能继续带着它发请求
    #      （且此前 /login 根本不下发 erp_token，所以这个洞一直没人踩到）。
    #   __Host- 前缀要求 Secure + Path=/ + 无 Domain；set_cookie 不传 domain 即满足。
    _is_prod = os.environ.get("ENV", "") == "production"
    for _ck in ("erp_token", "hergent_auth", "csrf_token", "__Host-csrf"):
        try:
            resp.set_cookie(_ck, "", httponly=(_ck == "erp_token"),
                            samesite="lax", secure=_is_prod, max_age=0)
        except Exception:
            pass
    return resp'''
    src = patch(src, d_anchor, d_new, "D. /logout 清理 cookie")

    if src == orig:
        print("--- 无变更 ---")
        return

    write(src)
    print("--- 已写入，校验语法 ---")
    import py_compile
    try:
        py_compile.compile(TARGET, doraise=True)
        print("语法 OK")
    except Exception as e:
        print("语法错误，回滚: %s" % e)
        shutil.copy2(BACKUP, TARGET)
        sys.exit(1)
    print("完成。备份: %s" % BACKUP)


if __name__ == "__main__":
    main()
