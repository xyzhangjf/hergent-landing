"""v391 公网冒烟（本地跑，禁代理）：证明 psi 薄壳经 nginx → 后端全链路生效，
且 RBAC 模块闸门在**公网**上同样只放行 boss/admin。
判别力：同一 sales 账号打自己的模块必须 200，否则 403 只是「角色啥都没权限」。"""
import json
import urllib.error
import urllib.request

BASE = "https://hergent.cn"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 禁一切代理

RESULTS = []


def call(method, path, token=None, tenant="1", body=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", tenant)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.data = data
        req.add_header("Content-Type", "application/json")
    try:
        with _OPENER.open(req, timeout=25) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return -1, "%s: %s" % (type(e).__name__, e)


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, detail))
    print("%s %s%s" % ("[OK]" if cond else "[FAIL]", name, ("  <- " + detail) if detail else ""))


# ① 匿名 ⇒ 401（公网链路通 + 认证层在前）
st, bd = call("GET", "/api/psi/stock")
ok("① 匿名 GET /api/psi/stock => 401", st == 401, "status=%s" % st)

# ② 登录取 sales token
st, bd = call("POST", "/api/auth/login", tenant=None,
              body={"username": "mptest", "password": "Mptest@1"})
tok = bd.get("token") if isinstance(bd, dict) else None
ok("② sales 账号登录成功（拿到 token）", bool(tok), "status=%s has_token=%s" % (st, bool(tok)))

if tok:
    # ③ sales 打 psi ⇒ 403 模块拒绝
    st, bd = call("GET", "/api/psi/stock", token=tok)
    d = bd if isinstance(bd, dict) else {}
    ok("③ sales GET /api/psi/stock => 403 MODULE_DENIED / inventory / 进销存",
       st == 403 and d.get("error_code") == "MODULE_DENIED"
       and d.get("module") == "inventory" and d.get("module_label") == "进销存",
       "status=%s code=%s label=%s" % (st, d.get("error_code"), d.get("module_label")))

    # ④ 判别力：同一 token 打自己的模块 ⇒ 200
    st, bd = call("GET", "/api/purchase-orders?limit=1", token=tok)
    ok("④ 判别力：同一 sales token 打 /api/purchase-orders => 200", st == 200, "status=%s" % st)

    # ⑤ 判别力（关键）：区分「命中前缀但无权」与「未命中任何前缀」两种 403
    #    前者 error_code=MODULE_DENIED，后者=MODULE_NOT_CONFIGURED
    #    ⇒ 证明 /api/psi 真被前缀表识别成 inventory，而不是 fail-closed 兜底
    st, bd = call("GET", "/api/definitely-not-real-prefix-v391/x", token=tok)
    d2 = bd if isinstance(bd, dict) else {}
    ok("⑤ 判别力：未命中前缀的路径 => 403 但 error_code=MODULE_NOT_CONFIGURED（与 psi 的 MODULE_DENIED 不同）",
       st == 403 and d2.get("error_code") == "MODULE_NOT_CONFIGURED",
       "status=%s code=%s" % (st, d2.get("error_code")))

bad = [r for r in RESULTS if not r[0]]
print("\n%s\n合计 %d 条，通过 %d，失败 %d\n%s" % ("=" * 58, len(RESULTS), len(RESULTS) - len(bad), len(bad), "=" * 58))
for _, n, dt in bad:
    print("  [FAIL] %s  %s" % (n, dt))
