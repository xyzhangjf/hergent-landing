# -*- coding: utf-8 -*-
"""v289（2026-09-27）密码长度校验：**唯一口径**的离线单测。

用法：
  cd server && /usr/bin/python3 tests/test_pwd_policy_v289.py

⚠️ 本文件**不连数据库、不写任何文件、不依赖运行中的服务**：
   · A 段是纯函数断言
   · B 段是**源码结构断言**（AST 解析，确认每个写入口都调用权威函数）
   · C 段是前端文案断言（目录不存在则 SKIP，供服务器上跑）

为什么这么测（而不是"发个请求试试"）：
   本缺陷的根因是「**同一条规则被抄成多份、改一处漏一处**」——
   所以单测要能**证明"只有一个判据"**，而不只是"某一次请求被拒"：
     · 只测行为 ⇒ 下次有人再抄一份，测试照样全绿
     · 同时断言"全仓不再有裸写长度判断" ⇒ 一旦有人再抄，测试**立刻红**
   这正是 v289 想钉住的东西。
"""
import ast
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER = os.path.dirname(_HERE)
sys.path.insert(0, _SERVER)
os.environ.setdefault("ERP_SECRET", "unit-test-only")

from core import _validate_password as vp  # noqa: E402

# 前端源（跨仓）。不存在则 C 段 SKIP —— 便于在服务器上单独跑本文件。
FE_NEW = os.environ.get(
    "FE_NEW", "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages")
FE_OLD = os.environ.get("FE_OLD", os.path.join(os.path.dirname(_SERVER), "static"))

_PASS, _FAIL, _SKIP = [], [], []


def ck(name, cond, extra=""):
    (_PASS if cond else _FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name
          + (("  <<< " + str(extra)) if (extra and not cond) else ""))


def skip(name, why):
    _SKIP.append(name)
    print("  [SKIP] " + name + "  <<< " + why)


print("=" * 70)
print("A. 权威函数 core._validate_password 的真实口径")
print("  规则：≥8 个字符，且**同时**包含字母和数字")
print("=" * 70)
ck("A1  4 位纯字母被拒", vp("abcd")[0] is False)
ck("A2  4 位纯数字被拒", vp("1234")[0] is False)
ck("A3  8 位含字母数字通过", vp("abcd1234")[0] is True)
ck("A4  8 位纯字母被拒（必须含数字）", vp("abcdefgh")[0] is False)
ck("A5  8 位纯数字被拒（必须含字母）", vp("12345678")[0] is False)
ck("A6  3 位含字母数字被拒", vp("Ab1")[0] is False)
ck("A7  空密码被拒", vp("")[0] is False)
ck("A8  中文+字母数字且≥8 位通过", vp("某员工abc123")[0] is True)
ck("A9  长度不足时的提示含「8」", "8" in vp("abcd")[1], vp("abcd")[1])
ck("A10 缺字母/数字时的提示说清要求",
   ("数字" in vp("abcdefgh")[1]) and ("字母" in vp("abcdefgh")[1]), vp("abcdefgh")[1])

print()
print("=" * 70)
print("B. 每个密码写入口都必须调用权威函数，且全仓不再有裸写长度判断")
print("=" * 70)


def _funcs(path, names):
    """返回 {函数名: 该函数的源码片段}"""
    src = _read(path)
    tree = ast.parse(src)
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            out[node.name] = ast.get_source_segment(src, node) or ""
    return out


def _read(path):
    with open(path, encoding="utf-8", errors="ignore") as f:
        return f.read()


_fs = _funcs(os.path.join(_SERVER, "routers/forecast_submissions.py"), {"create_staff_account"})
_body = _fs.get("create_staff_account", "")
ck("B1  开通员工账号（/staff-accounts）调用权威函数", "_validate_password(" in _body)
ck("B2  开通员工账号已无裸写「4 位」判断", "len(password) < 4" not in _body)

_au = _funcs(os.path.join(_SERVER, "routers/auth.py"),
             {"register", "reset_password", "change_password"})
ck("B3  注册（/register）调用权威函数", "_validate_password(" in _au.get("register", ""))
ck("B4  管理员重置（/reset-password）调用权威函数",
   "_validate_password(" in _au.get("reset_password", ""))
ck("B5  本人改密（/password）调用权威函数",
   "_validate_password(" in _au.get("change_password", ""))
ck("B6  老板重置（server.py reset_user_password）调用权威函数",
   "_validate_password(" in _funcs(os.path.join(_SERVER, "server.py"),
                                   {"reset_user_password"}).get("reset_user_password", ""))

# 🔴 关键断言：全仓不得再有**裸写**的密码长度判断（去掉注释后再判，避免注释误报）
BARE = re.compile(r"len\(\s*(new_)?password\s*\)\s*<\s*\d")
_hits = []
for _root, _dirs, _files in os.walk(_SERVER):
    if any(x in _root for x in ("node_modules", "__pycache__", ".git")) or _root.endswith("tests"):
        continue
    for _fn in _files:
        if not _fn.endswith(".py"):
            continue
        _p = os.path.join(_root, _fn)
        for _i, _line in enumerate(_read(_p).splitlines(), 1):
            _code = _line.split("#", 1)[0]          # 先剥注释
            if BARE.search(_code):
                _hits.append("%s:%d" % (os.path.relpath(_p, _SERVER), _i))
ck("B7  全后端零裸写密码长度判断", not _hits, _hits)

# 反向：权威函数确实只有一处定义
_defs = [os.path.relpath(os.path.join(r, f), _SERVER)
         for r, d, fs in os.walk(_SERVER) if "__pycache__" not in r
         for f in fs if f.endswith(".py")
         and re.search(r"^def _validate_password", _read(os.path.join(r, f)),
                       re.MULTILINE)]
ck("B8  权威函数全仓只定义一次", len(_defs) == 1, _defs)

print()
print("=" * 70)
print("C. 前端提示文案与阈值必须与后端口径一致")
print("=" * 70)
_fe_ok = os.path.isdir(FE_NEW) and os.path.isdir(FE_OLD)
if not _fe_ok:
    skip("C 段（前端文案）", "前端源码目录不可达：FE_NEW=%s / FE_OLD=%s" % (FE_NEW, FE_OLD))
else:
    _ea = _read(os.path.join(FE_NEW, "EmployeeArchive.vue"))
    _lg = _read(os.path.join(FE_NEW, "Login.vue"))
    _ih = _read(os.path.join(FE_OLD, "index.html"))
    _aj = _read(os.path.join(FE_OLD, "app.js"))

    ck("C1  员工档案页定义阈值常量 PWD_MIN = 8", "const PWD_MIN = 8" in _ea)
    ck("C2  员工档案页文案常量含「8 位」与「字母」",
       ("PWD_HINT" in _ea) and ("至少 8 位" in _ea) and ("字母" in _ea))
    ck("C3  员工档案页不再出现「至少 4 位」", "至少 4 位" not in _ea)
    ck("C4  两个密码框阈值都走 pwdOk()，不再比长度",
       _ea.count("pwdOk(") >= 4, "pwdOk 出现 %d 次" % _ea.count("pwdOk("))
    ck("C5  员工档案页不再有 length < 4", "length < 4" not in _ea)
    ck("C6  登录页注册框文案补上「含字母和数字」",
       "密码（至少 8 位，含字母和数字）" in _lg)
    ck("C7  旧前端 index.html 密码框提示已更新",
       "至少 8 位，含字母和数字" in _ih)
    ck("C8  旧前端 index.html 无「至少4位」", "至少4位" not in _ih)
    ck("C9  旧前端 app.js 两处预校验都按 8 位判",
       ("p.length<8" in _aj) and ("n.length<8" in _aj))
    ck("C10 旧前端 app.js 无 length<4 的密码判断", "length<4" not in _aj)
    ck("C11 旧前端 app.js 预校验含字母数字要求",
       _aj.count("/[0-9]/.test(") >= 2 and _aj.count("/[a-zA-Z]/.test(") >= 2)

print()
print("=" * 70)
print("结果：通过 %d / 失败 %d / 跳过 %d" % (len(_PASS), len(_FAIL), len(_SKIP)))
print("=" * 70)
if _FAIL:
    for n in _FAIL:
        print("  🔴 " + n)
    sys.exit(1)
print("  ✅ 全部通过")
