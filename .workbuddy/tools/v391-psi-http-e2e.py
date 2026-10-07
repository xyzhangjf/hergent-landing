"""v391 · 批次 4 验收（真 HTTP 层）—— 起真实 app，打真请求，判 boss 200 / 非 boss 403。

为什么要到这一层：上面那套「直接调端点函数」的验收**绕过了 rbac_middleware**，
证明不了计划文档 §六 的验收判据「boss `GET /api/psi/stock` → 200；非 boss → 403 且
`detail` 是模块拒绝原因」。中间件是唯一裁决者，必须真打。

零生产写入：
  · 只读生产库做快照（`v391-snapshot-prod-db.py`，sqlite backup API）
  · 全部写到影子目录的**副本**；session token 也只插影子主库
  · 起的是本机 uvicorn，不碰线上

⚠️ 判别力（每条都要能反过来红）：
  · sales 打 /api/psi/stock 必须 403，**同一 token** 打 /api/purchase-orders 必须 200
    ⇒ 证明 403 来自「进销存模块闸门」，不是「这个角色什么都没权限」
  · boss 打 /api/psi/<不存在> 必须 404 ⇒ 证明不是「整段前缀兜底拒绝」也不是「整段放行」
  · 无 token 必须 401 ⇒ 与 403 分开，证明认证层在授权层之前
"""
import json
import os
import shutil
import socket
import subprocess
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request

PORT = 18799
BASE = f"http://127.0.0.1:{PORT}"


def http(method, path, token=None, tenant="1", body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", tenant)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
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
        return -1, f"{type(e).__name__}: {e}"


RESULTS = []


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, detail))
    print(f"{'✅' if cond else '❌'} {name}" + (f"  ← {detail}" if detail else ""))


def main():
    snap = sys.argv[1]
    srv = os.path.expanduser("~/Documents/hergent-erp/server")
    venv_py = sys.executable

    shadow = tempfile.mkdtemp(prefix="v391-http-")
    for f in ("erp.db", "tenant_1.db"):
        shutil.copy2(os.path.join(snap, f), os.path.join(shadow, f))
    print(f"影子目录 = {shadow}")

    # ── 造会话（只写影子主库）────────────────────────────────────
    con = sqlite3.connect(os.path.join(shadow, "erp.db"))
    con.row_factory = sqlite3.Row
    pick = {}
    for role in ("boss", "sales", "supervisor", "accountant"):
        r = con.execute("SELECT id,username,display_name FROM users "
                        "WHERE role=? AND is_active=1 ORDER BY id LIMIT 1", (role,)).fetchone()
        pick[role] = dict(r) if r else None
    toks = {}
    for role, u in pick.items():
        if not u:
            continue
        t = f"v391-probe-{role}"
        toks[role] = t
        con.execute("INSERT OR REPLACE INTO sessions "
                    "(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
                    "VALUES (?,?,datetime('now','localtime'),datetime('now','localtime','+2 hours'),'127.0.0.1','probe',datetime('now','localtime'))",
                    (t, u["id"]))
    con.commit()
    con.close()
    print("会话已造：" + ", ".join(f"{k}={v['display_name']}(id={v['id']})" for k, v in pick.items() if v))

    # ── 起真实 app（只 import，不启 scheduler）───────────────────
    env = dict(os.environ)
    env.update({"ERP_SECRET": "shadow-only-not-a-secret", "DEEPSEEK_API_KEY": "shadow-dummy",
                "ERP_DB_PATH": os.path.join(shadow, "erp.db"),
                "PYTHONPATH": srv})
    launcher = (f"import uvicorn; from server import app; "
                f"uvicorn.run(app, host='127.0.0.1', port={PORT}, log_level='error')")
    proc = subprocess.Popen([venv_py, "-c", launcher], cwd=srv, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        up = False
        for _ in range(60):
            try:
                s = socket.create_connection(("127.0.0.1", PORT), timeout=1)
                s.close(); up = True; break
            except OSError:
                if proc.poll() is not None:
                    break
                time.sleep(0.5)
        ok("真实 app 已起（uvicorn 127.0.0.1:%d）" % PORT, up)
        if not up:
            return 1
        time.sleep(1.0)

        # ① 认证层：无 token
        st, bd = http("GET", "/api/psi/stock")
        ok("① 无 token ⇒ 401（认证先于授权）", st == 401, f"status={st}")

        # ② boss 200
        st, bd = http("GET", "/api/psi/stock", toks["boss"])
        ok("② boss GET /api/psi/stock ⇒ 200", st == 200,
           f"status={st} total={bd.get('total') if isinstance(bd, dict) else str(bd)[:60]}")
        st2, bd2 = http("GET", "/api/psi/meta", toks["boss"])
        ok("② boss GET /api/psi/meta ⇒ 200 且 module=inventory",
           st2 == 200 and isinstance(bd2, dict) and bd2.get("module") == "inventory",
           f"status={st2} body={str(bd2)[:60]}")
        st3, bd3 = http("GET", "/api/psi/stock/summary", toks["boss"])
        ok("② boss GET /api/psi/stock/summary ⇒ 200",
           st3 == 200 and isinstance(bd3, dict) and "missing_expiry_rows" in bd3,
           f"status={st3} missing_expiry={bd3.get('missing_expiry_rows') if isinstance(bd3, dict) else '-'}")
        st4, bd4 = http("GET", "/api/psi/sale-orders?limit=1", toks["boss"])
        ok("② boss GET /api/psi/sale-orders ⇒ 200", st4 == 200, f"status={st4}")

        # ③ 非 boss 403 + 模块拒绝原因
        for role in ("sales", "supervisor", "accountant"):
            if role not in toks:
                continue
            st, bd = http("GET", "/api/psi/stock", toks[role])
            d = bd if isinstance(bd, dict) else {}
            ok(f"③ {role} GET /api/psi/stock ⇒ 403 且是**模块**拒绝（MODULE_DENIED / inventory / 进销存）",
               st == 403 and d.get("error_code") == "MODULE_DENIED"
               and d.get("module") == "inventory" and d.get("module_label") == "进销存",
               f"status={st} error_code={d.get('error_code')} label={d.get('module_label')}")

        # ④ 判别力：同一 sales token 打自己的模块必须 200
        st, bd = http("GET", "/api/purchase-orders?limit=1", toks["sales"])
        ok("④ 判别力：同一 sales token 打 /api/purchase-orders ⇒ 200（证 403 来自进销存闸门，不是角色全禁）",
           st == 200, f"status={st}")

        # ⑤ 判别力：boss 打不存在的 psi 子路径 ⇒ 404（不是兜底拒绝/放行）
        st, bd = http("GET", "/api/psi/definitely-not-a-route-v391", toks["boss"])
        ok("⑤ 判别力：boss 打 /api/psi/<不存在> ⇒ 404（前缀非兜底）", st == 404, f"status={st}")

        # ⑥ 批次字段 fail-loud（真 HTTP）
        st, bd = http("POST", "/api/psi/purchase-orders", toks["boss"],
                      body={"supplier_id": 2886, "warehouse_id": 1,
                            "items": [{"product_id": 1161, "quantity": 1, "unit_price": 1,
                                       "batch_no": "B1", "expiry_date": "2026-11-01"}]})
        ok("⑥ boss POST 采购单带批次字段 ⇒ 400（显式拒绝，不静默丢）", st == 400, f"status={st}")

        # ⑦ 非法租户 id（中间件最外层）
        st, bd = http("GET", "/api/psi/stock", toks["boss"], tenant="abc")
        ok("⑦ X-Tenant-Id 非法 ⇒ 400 TENANT_INVALID（RBAC 先于 auth，且不误判成 403）",
           st == 400, f"status={st}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(shadow, ignore_errors=True)

    bad = [r for r in RESULTS if not r[0]]
    print(f"\n{'=' * 62}\n合计 {len(RESULTS)} 条，通过 {len(RESULTS) - len(bad)}，失败 {len(bad)}\n{'=' * 62}")
    for _, n, d in bad:
        print(f"  ❌ {n}  {d}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
