#!/usr/bin/env python3
"""v301 单测：从**真实源码**抽出产物文件下载端点，用桩件在本地跑越权用例。

🔴 为什么这么写：不接受"另写一份判据再自证"。这里用 `ast` 从
   `routers/ai_assist.py` **原文**取出 `_MEDIA_ROOTS` / `_media_path_allowed` /
   `get_copilot_media` 三处定义，exec 到桩命名空间后**直接调用**——
   被测的就是即将部署的那份字节。
🔴 夹具里必须同时有「正例」和「反例」，否则判据没有判别力。
"""
import ast
import os
import shutil
import sys
import tempfile
import types

SRC = (sys.argv[1] if len(sys.argv) > 1
       else "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/ai_assist.py")

# ---- 从原文里取定义 ---------------------------------------------------------
src = open(SRC, encoding="utf-8").read()
tree = ast.parse(src)
want_assign = {"_MEDIA_ROOTS"}
want_func = {"_media_path_allowed", "get_copilot_media"}
class _FakeRouter:
    """`@router.get(...)` 装饰器在 exec 时会被求值 ⇒ 必须先备好桩件。"""
    def get(self, *_a, **_k):
        return lambda f: f


class _FakeRequest:
    """`def f(request: Request ...)` 的注解在 def 时就会求值 ⇒ 也必须有桩件。"""
    headers = {}


picked = []
ns = {"os": os, "router": _FakeRouter(), "Request": _FakeRequest}
for node in tree.body:
    nm = None
    if isinstance(node, ast.Assign):
        nm = next((t.id for t in node.targets if isinstance(t, ast.Name)), None)
        if nm not in want_assign:
            continue
    elif isinstance(node, ast.FunctionDef):
        nm = node.name
        if nm not in want_func:
            continue
    else:
        continue
    exec(compile(ast.Module([node], []), SRC, "exec"), ns)
    picked.append(nm)
missing = (want_assign | want_func) - set(picked)
print("① 从原文抽到的定义：%s" % ", ".join(sorted(picked)))
assert not missing, "❌ 没抽到：%s" % missing

# ---- 桩件 -------------------------------------------------------------------
class _HTTPExc(Exception):
    def __init__(self, status, detail=""):
        self.status_code, self.detail = status, detail
        super().__init__("%s %s" % (status, detail))


class _FakeFileResponse:
    def __init__(self, path, filename=None, headers=None):
        self.path, self.filename, self.headers = path, filename, headers or {}


BASE = tempfile.mkdtemp(prefix="v301-media-")
HOME = os.path.join(BASE, "hergent_t1")
OTHER = os.path.join(BASE, "hergent_t2")
OUTSIDE = os.path.join(BASE, "outside")
for d in (os.path.join(HOME, "output"), os.path.join(HOME, "media"),
          os.path.join(HOME, "private"), os.path.join(OTHER, "output"), OUTSIDE):
    os.makedirs(d, exist_ok=True)


def _mk(p, body="x"):
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)
    return p


GOOD_DOCX = _mk(os.path.join(HOME, "output", "25-BP正文-终版-v6.docx"), "docx-payload")
GOOD_PPTX = _mk(os.path.join(HOME, "output", "经营周会.pptx"), "pptx-payload")
GOOD_MD = _mk(os.path.join(HOME, "media", "note.md"), "md-payload")
HIDDEN = _mk(os.path.join(HOME, "output", ".env"), "SECRET=1")
NOT_IN_ROOT = _mk(os.path.join(HOME, "private", "secret.txt"), "private!")
OTHER_TENANT = _mk(os.path.join(OTHER, "output", "别人的.docx"), "other-tenant")
EVIL = _mk(os.path.join(OUTSIDE, "evil.txt"), "outside!")
os.symlink(OUTSIDE, os.path.join(HOME, "output", "link"))          # 目录符号链接逃逸
os.symlink(EVIL, os.path.join(HOME, "output", "link-file.txt"))    # 文件符号链接逃逸

fastapi_mod = types.ModuleType("fastapi")
fastapi_mod.HTTPException = _HTTPExc
res_mod = types.ModuleType("fastapi.responses")
res_mod.FileResponse = _FakeFileResponse
sys.modules["fastapi"] = fastapi_mod
sys.modules["fastapi.responses"] = res_mod

ht = types.ModuleType("hermes_tenants")
ht.home_for = lambda tid: HOME if int(tid) == 1 else OTHER
sys.modules["hermes_tenants"] = ht

db_stub = types.SimpleNamespace(get_tenant_context=lambda: 1)
ns.update({"_auth": lambda req: {"username": "boss"}, "db": db_stub,
           "HTTPException": _HTTPExc})
# 让 get_copilot_media 内部 import 到桩件
exec(compile(ast.Module([n for n in tree.body if isinstance(n, ast.FunctionDef)
                         and n.name in want_func], []), SRC, "exec"), ns)

get_media = ns["get_copilot_media"]
path_allowed = ns["_media_path_allowed"]

# ---- 用例 -------------------------------------------------------------------
CASES = [
    # (说明, 传入 path, 期望 status, 期望文件名)
    ("本租户 output/ 里的 docx（**正例**）", GOOD_DOCX, 200, "25-BP正文-终版-v6.docx"),
    ("本租户 output/ 里的 pptx（**正例**）", GOOD_PPTX, 200, "经营周会.pptx"),
    ("本租户 media/ 子树（**正例**）", GOOD_MD, 200, "note.md"),
    ("反例：非绝对路径", "output/a.docx", 400, None),
    ("反例：空路径", "", 400, None),
    ("反例：不在 output/media 子树（兄弟目录）", NOT_IN_ROOT, 403, None),
    ("反例：`../` 穿越出允许根", os.path.join(HOME, "output", "..", "private", "secret.txt"), 403, None),
    ("反例：**另一个租户**的家目录", OTHER_TENANT, 403, None),
    ("反例：目录级符号链接逃逸", os.path.join(HOME, "output", "link", "evil.txt"), 403, None),
    ("反例：文件级符号链接逃逸", os.path.join(HOME, "output", "link-file.txt"), 403, None),
    ("反例：系统文件", "/etc/passwd", 403, None),
    ("反例：隐藏文件", HIDDEN, 403, None),
    ("反例：目录本身（是目录不是文件）", os.path.join(HOME, "output"), 404, None),
    ("反例：允许根内但不存在的文件", os.path.join(HOME, "output", "查无此件.docx"), 404, None),
]

print("\n② 端点行为：%d 条" % len(CASES))
fails = []
for desc, p, want, want_name in CASES:
    try:
        r = get_media(types.SimpleNamespace(headers={}), path=p)
        got, name = 200, getattr(r, "filename", None)
        real = getattr(r, "path", None)
        headers = getattr(r, "headers", {}) or {}
    except _HTTPExc as e:
        got, name, real, headers = e.status_code, None, None, {}
    ok = (got == want) and (want != 200 or name == want_name)
    if want == 200:
        ok = ok and real == os.path.realpath(p) and "nosniff" in headers.get("X-Content-Type-Options", "")
    if not ok:
        fails.append(desc)
    print("   %s  %-42s 期望 %s 实际 %s%s"
          % ("✅" if ok else "❌", desc, want, got,
             ("  文件名=" + str(name)) if got == 200 else ""))

print("\n③ 纯函数直测 `_media_path_allowed`（正反两侧都要）")
pa_ok = path_allowed(GOOD_DOCX, HOME) == os.path.realpath(GOOD_DOCX)
pa_no = path_allowed(GOOD_DOCX, OTHER) is None
print("   ✅ 自己的家目录 ⇒ 放行：%s" % pa_ok)
print("   ✅ 拿别的家目录当根 ⇒ 拒绝：%s" % pa_no)
fails += [] if (pa_ok and pa_no) else ["_media_path_allowed 判别力"]

shutil.rmtree(BASE, ignore_errors=True)
print("\n%s  用例 %d 条，失败 %d 条" % ("🟢 全部通过" if not fails else "🔴 有失败", len(CASES) + 2, len(fails)))
for f in fails:
    print("   - " + f)
sys.exit(1 if fails else 0)
