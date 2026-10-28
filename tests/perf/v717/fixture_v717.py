#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717 真机夹具：在生产造一条**临时**费用单 + 登录态，供浏览器探针使用。

  --create          建临时会话 + 一张「内部·办公费 1000 元」费用单，打印 {token,eid,month}
  --delete <eid> <token>   删费用单 / 凭证 / 往来账 / 会话，并自证残留 0

只在生产本机运行（直接读写 erp.db / tenant_1.db）。
"""
import json
import secrets
import sqlite3
import sys
import time

DB_MAIN = "/opt/hergent-erp/erp.db"
DB_TENANT = "/opt/hergent-erp/tenant_1.db"


def create():
    m = sqlite3.connect(DB_MAIN)
    m.row_factory = sqlite3.Row
    boss = m.execute("SELECT id FROM users WHERE role='boss' AND is_active=1 LIMIT 1").fetchone()
    tok = secrets.token_hex(24)
    m.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at,last_activity) "
        "VALUES(?,?,datetime('now','localtime'),datetime('now','localtime','+2 hours'),"
        "datetime('now','localtime'))", (tok, boss["id"]))
    m.commit()
    m.close()

    # 用真实接口建单，确保走的是生产代码路径（不是直接写库）
    import subprocess
    body = json.dumps({"type": "internal", "amount": 1000, "category_id": 6,
                       "note": "__v717_ui_probe__ 办公用品"})
    cmd = ["curl", "-s", "-m", "20", "-X", "POST",
           "-H", "Authorization: Bearer " + tok,
           "-H", "Cookie: erp_token=%s; csrf_token=v717ui" % tok,
           "-H", "X-CSRF-Token: v717ui", "-H", "Content-Type: application/json",
           "-d", body, "http://127.0.0.1:8700/api/expense-orders"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except Exception:
        print(json.dumps({"error": "建单返回非 JSON", "raw": r.stdout[:200]}, ensure_ascii=False))
        return
    print(json.dumps({"token": tok, "eid": d.get("id"),
                      "order_no": d.get("order_no"),
                      "month": time.strftime("%Y-%m")}, ensure_ascii=False))


def delete(eid, tok):
    c = sqlite3.connect(DB_TENANT)
    c.execute("DELETE FROM journal_entries WHERE ref_type IN ('expense','expense_pay') AND ref_id=?",
              (eid,))
    c.execute("DELETE FROM receivables WHERE ref_type='expense' AND ref_id=?", (eid,))
    c.execute("DELETE FROM expense_orders WHERE id=?", (eid,))
    c.commit()
    left_j = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_id=? "
                       "AND ref_type IN ('expense','expense_pay')", (eid,)).fetchone()[0]
    left_o = c.execute("SELECT COUNT(*) FROM expense_orders WHERE id=?", (eid,)).fetchone()[0]
    left_e = c.execute("SELECT COUNT(*) FROM expense_orders").fetchone()[0]
    c.close()
    m = sqlite3.connect(DB_MAIN)
    m.execute("DELETE FROM sessions WHERE token=?", (tok,))
    m.commit()
    resid_s = m.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    m.close()
    print(json.dumps({"journal_residual": left_j, "order_residual": left_o,
                      "expense_orders_total": left_e,
                      "sessions_residual": resid_s}, ensure_ascii=False))


if __name__ == "__main__":
    if sys.argv[1] == "--create":
        create()
    elif sys.argv[1] == "--delete":
        delete(int(sys.argv[2]), sys.argv[3])
    else:
        sys.exit("用法: --create | --delete <eid> <token>")
