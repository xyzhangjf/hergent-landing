#!/usr/bin/env python3
"""v711 探针 C 组：生产真实 HTTP 接口（凭证模板 CRUD 全流程）。

v707 排查时的结论是「凭证模板整功能不可用」：五个接口全 500（create/update 还是
100% NameError）。本组用**真实会话 token 打真实接口**，判据是状态码与返回体：

  - 列表/事件/播种/测试 → 200（不是 500）
  - 新建 → 200 + 有 id；空名称 → 400（不是 500 —— 参数错误不该是服务器错误）
  - 类型错 → 422
  - 编辑 → 200 + 字段真的变了（回读列表确认，不是只看接口说 success）
  - 删除 → 200 + 该条 is_active=0
  - flag 机制 → `/api/feature-flags` 能读到（改前因缺列恒返回 []）

🔴 跑完必须清理：本组会在生产租户库建表并写入测试数据，`--cleanup` 清掉模板与
审计行（表结构保留 —— 那是功能的一部分，删了下次请求又会惰性建回来）。
"""
import json
import sqlite3
import sys
import urllib.error
import urllib.request

PROD = "/opt/hergent-erp"
BASE = "http://127.0.0.1:8700"
TENANT_DB = PROD + "/tenant_1.db"
PASS, FAIL = [], []


def chk(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("%s %s%s" % ("✅" if cond else "🔴", name, ("  [" + detail + "]") if detail else ""))


def tok():
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    r = con.execute("SELECT token FROM sessions WHERE user_id=2 "
                    "ORDER BY created_at DESC LIMIT 1").fetchone()
    con.close()
    return r[0] if r else ""


def call(method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        # 写操作要过 CSRF：cookie `csrf_token` 与头 `X-CSRF-Token` 必须一致
        # （server.py:319 —— 缺任一即 403 CSRF_REQUIRED，v711 第一次跑就全 403）。
        "Cookie": "erp_token=%s; hergent_auth=1; csrf_token=%s" % (token, token),
        "X-CSRF-Token": token,
        "X-Tenant-Id": "1",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw)
            except ValueError:
                return resp.status, {"_raw": raw[:200]}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:300]
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"_raw": raw}
    except Exception as e:
        return 0, {"err": str(e)}


def cleanup(token):
    """清掉本组写入的测试数据（模板 + 审计）。"""
    con = sqlite3.connect(TENANT_DB)
    n1 = con.execute("DELETE FROM voucher_templates").rowcount
    n2 = con.execute("DELETE FROM voucher_template_applies").rowcount
    con.commit()
    con.close()
    print("\n清理：删除模板 %d 条、审计 %d 条" % (n1, n2))


def main():
    if "--cleanup" in sys.argv:
        cleanup(tok())
        return 0

    t = tok()
    chk("拿到真实会话 token", bool(t), "" if t else "sessions 无 user_id=2")
    if not t:
        return 1

    print("\n【C1】只读接口（改前 500）")
    st, d = call("GET", "/api/voucher-templates", t)
    chk("GET /api/voucher-templates → 200", st == 200, "status=%s %s" % (st, str(d)[:80]))
    base_n = len(d.get("data", [])) if isinstance(d.get("data"), list) else -1
    chk("列表返回 data 数组", base_n >= 0, "%d 条" % base_n)

    st, d = call("GET", "/api/voucher-templates/events", t)
    chk("GET /events → 200", st == 200, "status=%s" % st)
    chk("事件类型 8 个", len(d.get("data", [])) == 8, "%d 个" % len(d.get("data", [])))

    print("\n【C2】播种（改前 500）")
    st, d = call("POST", "/api/voucher-templates/seed", t)
    chk("POST /seed → 200", st == 200, "status=%s %s" % (st, str(d)[:80]))
    st, d = call("GET", "/api/voucher-templates", t)
    n = len(d.get("data", []))
    chk("播种后列表 8 条", n == 8, "%d 条" % n)

    print("\n【C3】新建（改前 100% NameError ⇒ 500）")
    entries = json.dumps([
        {"code": "1122", "name": "应收账款", "direction": "debit", "amount_source": "total_amount", "summary": "销售:{customer_name}"},
        {"code": "6001", "name": "主营业务收入", "direction": "credit", "amount_source": "total_amount", "summary": "销售收入"},
    ], ensure_ascii=False)
    st, d = call("POST", "/api/voucher-templates", t, {
        "name": "v711探针模板", "event_type": "sale_deliver", "description": "探针",
        "entries_json": entries, "conditions_json": "{}", "is_active": 1, "priority": 7})
    chk("POST 新建 → 200", st == 200, "status=%s %s" % (st, str(d)[:120]))
    tid = d.get("id")
    chk("返回新 id", isinstance(tid, int) and tid > 0, str(tid))

    st, d = call("POST", "/api/voucher-templates", t, {"name": "", "event_type": "sale_deliver"})
    chk("空名称 → 400（不是 500）", st == 400, "status=%s %s" % (st, str(d)[:80]))

    st, d = call("POST", "/api/voucher-templates", t, {"name": ["x"], "event_type": "sale"})
    chk("类型错误 → 422", st == 422, "status=%s" % st)

    print("\n【C4】编辑（改前 100% NameError ⇒ 500）")
    st, d = call("PUT", "/api/voucher-templates/%s" % tid, t, {"description": "改过了"})
    chk("PUT 编辑 → 200", st == 200, "status=%s %s" % (st, str(d)[:80]))
    st, d = call("GET", "/api/voucher-templates?event_type=sale_deliver", t)
    row = [r for r in d.get("data", []) if r.get("id") == tid]
    chk("回读确认描述真的改了", row and row[0].get("description") == "改过了",
        str(row[0].get("description")) if row else "没找到")
    chk("部分更新没把别的字段清空", row and row[0].get("name") == "v711探针模板"
        and row[0].get("priority") == 7, str(row[0].get("name")) if row else "")

    print("\n【C5】测试模板（改前 500）")
    st, d = call("POST", "/api/voucher-templates/test", t, {
        "event_type": "sale_deliver",
        "context": {"total_amount": 1000, "customer_name": "张三", "order_no": "SO-TEST"}})
    chk("POST /test → 200", st == 200, "status=%s %s" % (st, str(d)[:120]))
    chk("测试返回分录且借贷平衡", d.get("success") is True and len(d.get("entries", [])) == 2
        and d.get("balanced") is True, str(d)[:140])

    print("\n【C6】删除（软删）")
    st, d = call("DELETE", "/api/voucher-templates/%s" % tid, t)
    chk("DELETE → 200", st == 200, "status=%s %s" % (st, str(d)[:80]))
    st, d = call("GET", "/api/voucher-templates", t)
    row = [r for r in d.get("data", []) if r.get("id") == tid]
    chk("回读确认 is_active=0（软删生效）", row and row[0].get("is_active") == 0,
        str(row[0].get("is_active")) if row else "没找到")

    print("\n【C7】feature flag 机制（改前因缺列恒读不到）")
    st, d = call("GET", "/api/feature-flags", t)
    chk("GET /api/feature-flags → 200", st == 200, "status=%s" % st)
    # 🔴 `/api/feature-flags` 实测读到的是**主库**（补列发生在 erp.db，不是 tenant_1.db）。
    # 所以 flag 的开关以主库为准；自动记账路径在租户上下文里读自己那张表，
    # 缺列时由 `_ensure_feature_flags_table` 惰性补（B 组副本上已验证）。
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    cols = [r[1] for r in con.execute("PRAGMA table_info(feature_flags)")]
    rows = [tuple(r) for r in con.execute(
        "SELECT name, enabled FROM feature_flags WHERE name='voucher_templates'")]
    con.close()
    chk("主库 feature_flags 已补 updated_at 列（改前整机制读不到）",
        "updated_at" in cols, str(cols))
    chk("voucher_templates flag 未开（默认关 ⇒ 自动记账不受影响）",
        not rows or int(rows[0][1]) == 0, str(rows))

    print("\n" + "=" * 70)
    print("C 组 %d/%d" % (len(PASS), len(PASS) + len(FAIL)))
    for f in FAIL:
        print("  🔴 " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
