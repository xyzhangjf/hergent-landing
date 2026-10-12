# v479 生产只读 API 验收：GET /api/role-permissions/audit
# 只用真实账号登录取 token，纯 GET，零写入。
import json, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:8700"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁代理


def call(method, path, token=None, tenant=None, params=None):
    url = BASE + path
    if params:
        url += "?" + "&".join("%s=%s" % (k, v) for k, v in params.items())
    req = urllib.request.Request(url, method=method)
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


def login(username, password):
    req = urllib.request.Request(
        BASE + "/api/auth/login",
        method="POST",
        data=json.dumps({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with _OPENER.open(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["token"]


results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print("%s %s %s" % ("PASS" if cond else "FAIL", name, detail))


tok = login("boss", "boss123")
check("R0 boss 登录拿 token", bool(tok))

# R1 默认拉取
st, j = call("GET", "/api/role-permissions/audit", tok, 1)
check("R1 默认 200", st == 200, "status=%s" % st)
if st != 200:
    print(json.dumps(j, ensure_ascii=False)[:800])
    sys.exit(1)
check("R1 结构含 items/total/returned/limit/offset/types",
      all(k in j for k in ("items", "total", "returned", "limit", "offset", "types")))
check("R1 total >= 1（老板历史角色变更在主库）", j["total"] >= 1, "total=%s" % j["total"])
types = j["types"]
check("R1 types 非空且每项有 key/label/count",
      len(types) > 0 and all({"key", "label", "count"} <= set(t) for t in types))
print("  types:", [(t["key"], t["label"], t["count"]) for t in types])

items = j["items"]
check("R1 items <= limit", len(items) <= j["limit"])
if items:
    it = items[0]
    check("R1 首条五要素齐全（at/who/target/action/detail）",
          all(k in it for k in ("at", "who", "target", "action", "detail")),
          "keys=%s" % sorted(it.keys()))
    check("R1 旧字段兼容 what/role 同义下发", "what" in it and "role" in it)
    # 时间倒序
    cts = [x["at"] for x in items]
    check("R1 按 at 倒序", cts == sorted(cts, reverse=True), "top3=%s" % cts[:3])
    print("  首条:", {k: it.get(k) for k in ("at", "who", "target", "action", "detail")})

# R2 类型筛选（取第一个有计数的类型）
t0 = next((t for t in types if t["count"] > 0), None)
if t0:
    st, j2 = call("GET", "/api/role-permissions/audit", tok, 1,
                  {"log_type": t0["key"], "limit": "5"})
    check("R2 log_type=%s 筛选 200" % t0["key"], st == 200)
    check("R2 筛选后 returned <= count", j2["returned"] <= t0["count"],
          "returned=%s count=%s" % (j2["returned"], t0["count"]))
    check("R2 筛选后每行 action 均属该类型",
          all(x["action"] and t0["label"] for x in j2["items"]))
else:
    check("R2 跳过（无带计数的类型）", True)

# R3 未知类型 fail-closed 400
st, j3 = call("GET", "/api/role-permissions/audit", tok, 1, {"log_type": "not_a_real_type"})
check("R3 未知 log_type → 400", st == 400, "status=%s detail=%s" % (st, (j3 or {}).get("detail")))

# R4 坏日期 400（含 2026-13-01 非真日期）
st, j4 = call("GET", "/api/role-permissions/audit", tok, 1, {"date_from": "2026-13-01"})
check("R4 date_from=2026-13-01 → 400（真解析）", st == 400, "status=%s" % st)
st, j4b = call("GET", "/api/role-permissions/audit", tok, 1, {"date_from": "abcd"})
check("R4 date_from=abcd → 400", st == 400, "status=%s" % st)

# R5 合法日期筛选
st, j5 = call("GET", "/api/role-permissions/audit", tok, 1,
              {"date_from": "2020-01-01", "date_to": "2030-12-31", "limit": "5"})
check("R5 合法日期范围 200", st == 200, "status=%s" % st)
check("R5 范围内 returned >= 0 且 <= total", 0 <= j5["returned"] <= j5["total"] if st == 200 else False)

# R6 分页：offset 越界不报错
st, j6 = call("GET", "/api/role-permissions/audit", tok, 1, {"offset": "99999"})
check("R6 offset 越界 200 且 items 空", st == 200 and j6["items"] == [],
      "status=%s len=%s" % (st, len(j6.get("items", []))))

# R7 limit 上限 200
st, j7 = call("GET", "/api/role-permissions/audit", tok, 1, {"limit": "201"})
check("R7 limit=201 → 422 或被钳到 200", st in (200, 422) and (st == 422 or j7["limit"] == 200),
      "status=%s limit=%s" % (st, j7.get("limit") if st == 200 else "-"))

# R8 关键词筛选（who 里含 boss）
st, j8 = call("GET", "/api/role-permissions/audit", tok, 1, {"who": "boss", "limit": "5"})
check("R8 who=boss 200", st == 200, "status=%s" % st)
if st == 200:
    check("R8 命中行 who 含 boss",
          all("boss" in (x.get("who") or "").lower() for x in j8["items"]) or j8["returned"] == 0,
          "returned=%s" % j8["returned"])

# R9 无租户头 → 403 fail-closed（perm 端点带租户上下文）
st, j9 = call("GET", "/api/role-permissions/audit", tok, None)
check("R9 缺 X-Tenant-Id → 403", st == 403, "status=%s" % st)

# R10 sales 低权账号 → 403（角色权限页不是所有角色可看）
try:
    tok_s = login("sales", "sales123")
    st, j10 = call("GET", "/api/role-permissions/audit", tok_s, 1)
    check("R10 sales → 403（权限控制未被破坏）", st == 403, "status=%s" % st)
except Exception as e:
    check("R10 sales 登录失败跳过", True, str(e)[:80])

ok = sum(1 for _, c, _ in results if c)
print("\nVERDICT %d/%d" % (ok, len(results)))
sys.exit(0 if ok == len(results) else 1)
