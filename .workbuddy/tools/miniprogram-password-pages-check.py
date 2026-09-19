#!/usr/bin/env python3
"""小程序「改密 + 忘记密码」改动的静态核对。

小程序**没有**像 Web 前端那样的 CLI 构建/部署通道（Hergent 项目既定事实），
无法用 puppeteer 真机验证，所以只能把「运行时才会暴露的错误」在提交前静态拦掉：
JSON 是否合法、页面是否注册、文件是否齐全、WXML 标签是否配平、JS 是否可解析、
关键字符串是否落在该落的地方。

⚠️ 这**不能替代**在微信开发者工具里点一次「编译」—— 那一步必须由人来做。
"""
import json
import os
import re
import subprocess
import sys

MP = ("/Users/zhangjunfeng/Documents/laozhangai-product/"
      "forecast-order-miniprogram-20260812T023419087Z/miniprogram")
NODE = "/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  | " + str(extra)) if extra else ""))


def read(p):
    with open(os.path.join(MP, p), encoding="utf-8") as f:
        return f.read()


print("=" * 68)
print("T1 app.json")
app = json.loads(read("app.json"))
pages = app["pages"]
check("JSON 合法", True)
check("login 仍是首页（pages[0]）", pages[0] == "pages/login/login", pages[0])
check("已注册 pages/password/password", "pages/password/password" in pages)
check("已注册 pages/forgot/forgot", "pages/forgot/forgot" in pages)
check("导航栏标题仍是新名", app["window"]["navigationBarTitleText"] == "小赫智体报单助手",
      app["window"]["navigationBarTitleText"])
check("tabBar 未被改动（仍 2 项）", len(app["tabBar"]["list"]) == 2)

print("T2 新页面四件套是否齐全")
for pg in ("password", "forgot"):
    for ext in ("js", "wxml", "wxss", "json"):
        p = "pages/%s/%s.%s" % (pg, pg, ext)
        check("存在 %s" % p, os.path.exists(os.path.join(MP, p)))

print("T3 新页面 JSON 合法")
for pg in ("password", "forgot"):
    try:
        d = json.loads(read("pages/%s/%s.json" % (pg, pg)))
        check("%s.json 合法且含标题" % pg, bool(d.get("navigationBarTitleText")),
              d.get("navigationBarTitleText"))
    except Exception as e:
        check("%s.json 合法" % pg, False, e)

print("T4 WXML 标签配平")
for pg in ("password", "forgot"):
    for tag in ("view", "text", "scroll-view"):
        s = read("pages/%s/%s.wxml" % (pg, pg))
        op = len(re.findall(r"<%s[\s>]" % tag, s))
        cl = len(re.findall(r"</%s>" % tag, s))
        if op or cl:
            check("%s.wxml <%s> 配平 %d/%d" % (pg, tag, op, cl), op == cl)

print("T5 JS 语法（node --check）")
js_files = [
    "pages/password/password.js", "pages/forgot/forgot.js",
    "pages/login/login.js", "pages/mine/mine.js", "utils/track.js",
]
for p in js_files:
    r = subprocess.run([NODE, "--check", os.path.join(MP, p)],
                       capture_output=True, text=True)
    check("语法通过 %s" % p, r.returncode == 0, (r.stderr or "").strip()[:120])

print("T6 关键逻辑落点")
login_js = read("pages/login/login.js")
check("login.js 消费 require_password_change", "require_password_change" in login_js)
check("login.js 落 fs_need_pwd_change 标记", "fs_need_pwd_change" in login_js)
check("login.js onLoad 也拦未改密会话（防杀进程绕过）",
      login_js.count("fs_need_pwd_change") >= 2, "出现 %d 次" % login_js.count("fs_need_pwd_change"))
check("login.js 有 goForgot", "goForgot" in login_js)
check("原密码暂存内存而非 storage", "app.globalData.loginPw" in login_js and
      "setStorageSync('fs_login_pw'" not in login_js)

pw_js = read("pages/password/password.js")
check("改密页调 /api/auth/password", "/api/auth/password" in pw_js)
check("改密页改成功后清标记", "removeStorageSync('fs_need_pwd_change')" in pw_js)
check("改密页有 force 模式", "force" in pw_js)
check("改密页本地校验 8 位", "length < 8" in pw_js)
check("改密页本地校验数字+字母", "/[0-9]/" in pw_js and "/[a-zA-Z]/" in pw_js)

fg_js = read("pages/forgot/forgot.js")
check("忘记密码页调 /api/auth/forgot-reset", "/api/auth/forgot-reset" in fg_js)
check("忘记密码页不发旧密码字段", "old_password" not in fg_js)

print("T7 入口可见性")
lw = read("pages/login/login.wxml")
check("登录页有「忘记密码」入口", "goForgot" in lw and "忘记密码" in lw)
mw = read("pages/mine/mine.wxml")
check("我的页有「修改密码」入口", "goPassword" in mw and "修改密码" in mw)
mj = read("pages/mine/mine.js")
check("我的页有 goPassword 方法", "goPassword" in mj)
check("logout 清理 fs_need_pwd_change", "fs_need_pwd_change" in mj)

print("T8 与后端约定一致性")
pw_wxml = read("pages/password/password.wxml")
fg_wxml = read("pages/forgot/forgot.wxml")
check("改密页提交按钮文案随模式变化", "设置并进入" in pw_wxml and "确认修改" in pw_wxml)
check("强制模式不显示返回按钮", 'wx:if="{{!force}}"' in pw_wxml)
check("忘记密码页提示 30 分钟有效", "30 分钟" in fg_wxml)
check("忘记密码页说明找谁要码", "管理员" in fg_wxml)

print("=" * 68)
print("PASS %d / FAIL %d" % (len(PASS), len(FAIL)))
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  -", f)
sys.exit(1 if FAIL else 0)
