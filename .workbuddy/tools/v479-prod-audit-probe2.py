# v479 追加定性：R9/R10 对照实验
# R9: 对照旧端点（v475 起的 /api/role-permissions 列表）在同样缺 X-Tenant-Id 条件下是否也 200
#     —— 若旧端点同样 200，说明是「boss 单租户 middleware 回退」的既有设计，非 v479 回归。
# R10: sales/sales123 已 401（提审清理批次失效），换 accountant 账号验 RBAC 403。
import json, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:8700"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method, path, token=None, tenant=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", str(tenant))
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = None
        return e.code, body


def login(u, p):
    req = urllib.request.Request(
        BASE + "/api/auth/login", method="POST",
        data=json.dumps({"username": u, "password": p}).encode(),
        headers={"Content-Type": "application/json"})
    with _OPENER.open(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["token"]


# R9 对照：boss token、缺 X-Tenant-Id，打旧端点
tok = login("boss", "boss123")
st_old, _ = call("GET", "/api/role-permissions", tok, None)
st_new, _ = call("GET", "/api/role-permissions/audit", tok, None)
print("R9 对照：旧端点(role-permissions) 缺租户头 status=%s；新端点(audit) status=%s" % (st_old, st_new))
print("R9 结论：%s" % ("既有单租户回退行为，非 v479 回归" if st_old == 200 == st_new
                    else "🔴 两端点行为不一致，需深入排查"))

# R10 换 accountant
try:
    tok_a = login("accountant", "acc123")
    st, j = call("GET", "/api/role-permissions/audit", tok_a, 1)
    print("R10 accountant → audit status=%s detail=%s" % (st, (j or {}).get("detail", "")[:60]))
    print("R10 结论：%s" % ("RBAC 403 生效，权限控制未被破坏" if st == 403
                          else "accountant 可读 audit（若其角色本就有该模块权限则为预期，需人工确认）"))
except urllib.error.HTTPError as e:
    print("R10 accountant 登录失败 status=%s（账号可能已失效，无法验证 RBAC 403）" % e.code)
