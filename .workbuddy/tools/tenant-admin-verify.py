#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""租户成员 / 用量端点验证 —— 影子库，不碰生产。

背景：`/api/tenants/{tid}/members(GET/POST/DELETE)` 与 `/{tid}/usage(GET)` 原先调的
四个 db 函数**从未存在**（恒 500），且 members 只判 `_auth`（任何登录用户可增删**他人**
租户成员）。本次修复 = 补齐 erp_db 四个函数 + 把四个端点收紧到 `_platform_admin`。

覆盖：
  A 未登录            → 读 401 / 写被拦（401 或 403，CSRF 层可能先行）
  B 普通 boss（非平台管理员，模拟自注册用户）→ 四个端点全 403
  C 平台管理员        → 200，且 usage 数字与真实租户库逐表比对
  D 成员添加          → 不存在账号 400 / 提权角色 400 / 正常添加生效 / 重复添加幂等
  E 成员移除          → 非本租户 400 / 正常移除生效 / 最后一个成员受保护 400

夹具**完全自造**（两个租户 + 三个账号），不依赖影子库里预置的任何租户 ——
本地 dev 库与生产库的租户编号并不一致，写死 tenant_id 会得到"看起来通过"的假结论。

前置：
  1) cp ~/Documents/hergent-erp/server/erp.db /tmp/tt2/erp.db
  2) 起影子服务：ERP_DB_PATH=/tmp/tt2/erp.db ERP_SECRET=ttsec python3 server.py（PORT=8701）
     注意：`_init_users()` 只在 `python server.py` 的 __main__ 分支里跑；若改用
     `uvicorn server:app`，必须另外补一次 `python3 -c "import core; core._init_users()"`
     否则 invite_codes/platform_admins 三张表不存在。
  3) ERP_DB_PATH=/tmp/tt2/erp.db ERP_SECRET=ttsec python3 tenant-admin-verify.py
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:8701")
DBP = os.environ.get("ERP_DB_PATH", "/tmp/tt2/erp.db")
SERVER_DIR = os.environ.get("SERVER_DIR", os.path.expanduser("~/Documents/hergent-erp/server"))
PW = "Test12345"

# 🔴 必须绕开系统代理：本机 HTTP_PROXY 指向一个本地代理进程，urllib 默认会把它用在
# 127.0.0.1 上 → 回环请求变成 502 upstream connect failed（看起来像"服务挂了"）。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  —— {detail}" if detail else ""))
    return ok


def req(path, method="GET", body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    if token:
        # Bearer 头可整条绕过 CSRF 中间件，写操作必带
        r.add_header("Authorization", "Bearer " + token)
    try:
        with _OPENER.open(r, timeout=90) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, str(e)


def q1(sql, args=()):
    c = sqlite3.connect(DBP)
    try:
        return c.execute(sql, args).fetchone()
    finally:
        c.close()


def seed_fixtures():
    """自造夹具：一个"工作租户"（2 成员，用于增删）+ 一个"孤儿租户"（1 成员，用于保护）。"""
    sys.path.insert(0, SERVER_DIR)
    os.environ.setdefault("ERP_SECRET", "ttsec")
    import core       # 只为拿到与影子服务一致的密码哈希算法
    import erp_db as edb   # tenant_create 会顺带建出租户库（供 usage 逐表比对）

    c = sqlite3.connect(DBP)
    c.row_factory = sqlite3.Row
    try:
        def upsert(username, role):
            row = c.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if row:
                return int(row["id"])
            cur = c.execute(
                "INSERT INTO users (username,password_hash,display_name,role,is_active,password_changed) "
                "VALUES (?,?,?,?,1,1)",
                (username, core._hpw(PW), username, role),
            )
            return int(cur.lastrowid)

        def get_or_make_tenant(name, sub):
            row = c.execute("SELECT id FROM tenants WHERE subdomain=?", (sub,)).fetchone()
            if row:
                tid = int(row["id"])
                # 租户记录可能已存在但库文件被清掉了（重跑/清场）→ 补建，否则 usage 的
                # db_exists 断言会假失败，而实际实现是对的。
                if not os.path.exists(os.path.join(os.path.dirname(DBP), f"tenant_{tid}.db")):
                    edb.tenant_db_init(tid)
                return tid
            return int(edb.tenant_create(name, sub, "", "", "free", 5))

        plain = upsert("tt_plain_boss", "boss")   # 非平台管理员（= 自注册客户的样子）
        plat = upsert("tt_plat_admin", "boss")    # 平台管理员
        m1 = upsert("tt_mem_one", "user")
        m2 = upsert("tt_mem_two", "user")
        m3 = upsert("tt_mem_three", "user")
        solo = upsert("tt_solo", "user")
        c.execute("INSERT OR IGNORE INTO platform_admins (user_id, note) VALUES (?,?)",
                  (plat, "自测夹具：租户管理验证"))
        c.commit()

        work = get_or_make_tenant("自测工作租户", "tt-work")
        orphan = get_or_make_tenant("自测孤儿租户", "tt-orphan")
        for uid, tid in ((m1, work), (m2, work), (solo, orphan)):
            c.execute("INSERT OR IGNORE INTO user_tenants (user_id, tenant_id) VALUES (?,?)", (uid, tid))
        c.commit()
        return {"plain": plain, "plat": plat, "work": work, "orphan": orphan,
                "m1": m1, "m2": m2, "m3": m3, "solo": solo}
    finally:
        c.close()


def login(username):
    st, d = req("/api/auth/login", "POST", {"username": username, "password": PW})
    if st != 200 or not isinstance(d, dict):
        raise SystemExit(f"登录失败 {username}: HTTP {st} {str(d)[:200]}")
    return d.get("token")


def main():
    if not os.path.exists(DBP):
        raise SystemExit(f"影子库不存在：{DBP}（先 cp erp.db 过去）")

    print("=" * 78)
    print(f"租户成员 / 用量端点验证 · {BASE} · {DBP}")
    print("=" * 78)

    f = seed_fixtures()
    W, O = f["work"], f["orphan"]
    print(f"[夹具] 工作租户=tenant{W}（成员 m1/m2）· 孤儿租户=tenant{O}（唯一成员 solo）· "
          f"plain_boss=id{f['plain']} · plat_admin=id{f['plat']}\n")

    # ────────────────────────────── A. 未登录
    print("【A】未登录")
    for p in (f"/api/tenants/{W}/members", f"/api/tenants/{W}/usage"):
        st, d = req(p)
        check(f"未登录 GET {p} → 401", st == 401, f"HTTP {st}")
    for m, p, b in (("POST", f"/api/tenants/{W}/members", {"username": "x"}),
                    ("DELETE", f"/api/tenants/{W}/members/{f['m1']}", None)):
        st, d = req(p, m, b)
        # 写操作的 CSRF 中间件可能先于端点鉴权返回 403 —— 两者都是"拦住"，只要不是 200/500
        check(f"未登录 {m} {p} → 被拦（401/403）", st in (401, 403), f"HTTP {st}")

    # ────────────────────────────── B. 普通 boss
    print("\n【B】普通 boss（角色=boss 但不在平台管理员名单 —— 即自注册客户的样子）")
    ptok = login("tt_plain_boss")
    for m, p, b in (("GET", f"/api/tenants/{W}/members", None),
                    ("GET", f"/api/tenants/{W}/usage", None),
                    ("POST", f"/api/tenants/{W}/members", {"username": "tt_solo"}),
                    ("DELETE", f"/api/tenants/{W}/members/{f['m1']}", None)):
        st, d = req(p, m, b, token=ptok)
        msg = (d.get("detail") or d.get("error") or "") if isinstance(d, dict) else str(d)
        check(f"普通 boss {m} {p.split('/')[-1] or p} → 403", st == 403, f"HTTP {st} {str(msg)[:60]}")

    # ────────────────────────────── C. 平台管理员
    print("\n【C】平台管理员（在 platform_admins 名单内）")
    atok = login("tt_plat_admin")
    st, d = req(f"/api/tenants/{W}/members", token=atok)
    ok = st == 200 and isinstance(d, dict) and isinstance(d.get("data"), list)
    check("读成员 → 200 且 data 是列表（原先恒 500）", ok,
          f"HTTP {st}；{len(d.get('data') or []) if isinstance(d, dict) else '?'} 人")
    names = [m.get("username") for m in (d.get("data") or [])] if ok else []
    check("成员列表含夹具账号且字段齐备",
          ok and set(names) == {"tt_mem_one", "tt_mem_two"} and all(
              "role" in m and "display_name" in m for m in d["data"]),
          str(names))

    st, u = req(f"/api/tenants/{W}/usage", token=atok)
    ud = u.get("data") if isinstance(u, dict) else None
    ok = st == 200 and isinstance(ud, dict)
    check("读用量 → 200（原先恒 500）", ok, f"HTTP {st}")
    if ok:
        need = {"tenant_id", "member_count", "max_users", "db_exists", "db_size_mb", "data_stats"}
        check("用量字段齐备", need.issubset(set(ud)), str(sorted(ud.keys())))
        real = q1("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (W,))[0]
        check("member_count 与主库真实行数一致", ud.get("member_count") == real,
              f"接口 {ud.get('member_count')} vs 库 {real}")
        mx = q1("SELECT max_users FROM tenants WHERE id=?", (W,))
        check("max_users 与 tenants 表一致", mx is not None and ud.get("max_users") == mx[0],
              f"{ud.get('max_users')} vs {mx[0] if mx else 'None'}")
        tp = os.path.join(os.path.dirname(DBP), f"tenant_{W}.db")
        check("租户库已被识别（db_exists）", ud.get("db_exists") is True and os.path.exists(tp), tp)
        if ud.get("db_exists") and os.path.exists(tp):
            tc = sqlite3.connect(f"file:{tp}?mode=ro", uri=True)
            try:
                ds = ud.get("data_stats") or {}
                bad = []
                for t, n in ds.items():
                    rn = tc.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                    if rn != n:
                        bad.append(f"{t}: 接口 {n} vs 库 {rn}")
                check("data_stats 逐表与租户库真实行数一致", not bad and len(ds) > 0,
                      "; ".join(bad) or f"{len(ds)} 张表：{ds}")
            finally:
                tc.close()

    # ────────────────────────────── D. 加成员
    print("\n【D】成员添加")
    st, d = req(f"/api/tenants/{W}/members", "POST", {"username": "no_such_user_zz"}, token=atok)
    check("加不存在的账号 → 400", st == 400, f"HTTP {st} {str(d)[:90]}")
    st, d = req(f"/api/tenants/{W}/members", "POST",
                {"username": "tt_plain_boss", "role": "boss"}, token=atok)
    check("试图借成员管理提权 → 400", st == 400, f"HTTP {st} {str(d)[:90]}")
    before = q1("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (W,))[0]
    st, d = req(f"/api/tenants/{W}/members", "POST", {"username": "tt_plain_boss"}, token=atok)
    after = q1("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (W,))[0]
    check("正常加成员 → 200 且库里多一行", st == 200 and after == before + 1,
          f"HTTP {st}；{before} → {after}")
    st, d = req(f"/api/tenants/{W}/members", "POST", {"username": "tt_plain_boss"}, token=atok)
    mid = q1("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (W,))[0]
    check("重复加同一账号幂等（不重复插入）", st == 200 and mid == after, f"HTTP {st}；{mid}")

    # ────────────────────────────── E. 删成员
    print("\n【E】成员移除")
    st, d = req(f"/api/tenants/{W}/members/{f['solo']}", "DELETE", None, token=atok)
    check("移除不属于该租户的账号 → 400", st == 400, f"HTTP {st} {str(d)[:90]}")
    st, d = req(f"/api/tenants/{W}/members/{f['plain']}", "DELETE", None, token=atok)
    gone = q1("SELECT COUNT(*) FROM user_tenants WHERE user_id=? AND tenant_id=?",
              (f["plain"], W))[0]
    check("正常移除 → 200 且库里该行消失", st == 200 and gone == 0, f"HTTP {st}；剩 {gone} 行")
    st, d = req(f"/api/tenants/{O}/members/{f['solo']}", "DELETE", None, token=atok)
    still = q1("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (O,))[0]
    check("最后一个成员受保护 → 400 且未被删", st == 400 and still == 1,
          f"HTTP {st}；剩 {still} 行 {str(d)[:70]}")

    # ────────────────────────────── F. 静态路径不被 {tid} 吃掉
    # 这两个端点原先是死代码：被先注册的 /tenants/{tid} 当成 tid="my"/"current" 解析
    # → 对任何人恒 422。判据很直接：未登录必须 401（422 就说明又被吃掉了）。
    print("\n【F】静态路径 /tenants/my 与 /tenants/current")
    for p in ("/api/tenants/my", "/api/tenants/current"):
        st, _ = req(p)
        check(f"未登录 GET {p} → 401（若 422 则说明被 {{tid}} 吃掉）", st == 401, f"HTTP {st}")
    st, d = req("/api/tenants/my", token=ptok)
    ok = st == 200 and isinstance(d, dict) and isinstance(d.get("data"), list)
    check("普通账号 GET /api/tenants/my → 200 且是列表", ok,
          f"HTTP {st}；{d.get('data') if ok else str(d)[:80]}")
    # 用 tt_mem_one 查：它自始至终都在工作租户里（plain_boss 在 D/E 段被加过又移除）
    mtok = login("tt_mem_one")
    st, d = req("/api/tenants/my", token=mtok)
    lst = d.get("data") if isinstance(d, dict) else None
    real = [r[0] for r in sqlite3.connect(DBP).execute(
        "SELECT tenant_id FROM user_tenants ut JOIN users u ON u.id=ut.user_id "
        "WHERE u.username='tt_mem_one' ORDER BY tenant_id").fetchall()]
    check("该列表与主库 user_tenants 完全一致（真的查到了自己的租户）",
          isinstance(lst, list) and sorted(lst) == sorted(real) and W in lst,
          f"接口 {lst} vs 库 {real}")
    st, d = req("/api/tenants/current", token=ptok)
    check("普通账号 GET /api/tenants/current → 200", st == 200 and isinstance(d, dict), f"HTTP {st}")

    print("\n" + "=" * 78)
    print(f"通过 {len(PASS)} / 共 {len(PASS) + len(FAIL)}")
    if FAIL:
        for x in FAIL:
            print("  ✗ " + x)
        sys.exit(1)
    print("全部通过 ✅")


if __name__ == "__main__":
    main()
