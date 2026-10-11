#!/usr/bin/env python3
"""v469 资金管理能力闸门 —— 生产 API 层真机探针（只读）。

目的：证明「AI 说配好了」= 「生产上真的按模块裁决」，而不是只在代码里看着对。

三层判据：
  ① 无鉴权      ⇒ 401（**不是 404** —— 404 说明 router 根本没挂上）
  ② 有鉴权 + 有 funds ⇒ 200（闸门**能开**）
  ③ 有鉴权 + 无 funds ⇒ 403 且文案含中文名「资金管理」（闸门**能关**，且不渲染内部键）

③ 需要拿一个「无 funds 的角色」的 token。生产上临时拿不到 ⇒ 本脚本用
`--revoke-tenant` 做**受控 A/B**：临时摘掉该租户 boss 的 funds（先备份）→ 重启 → 断言 403
→ 还原 → 重启 → 断言 200。**默认不跑**，必须显式加 `--ab` 才执行，且只允许对**演示租户**（10）。

用法：
    python3 v469-funds-gate-api-probe.py            # 只跑 ①②（零风险）
    python3 v469-funds-gate-api-probe.py --ab       # 追加 ③ 受控 A/B（需 ssh）
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

BASE = "https://erp.hergent.cn"
FUND_PATHS = [
    "/api/funds/meta",
    "/api/funds/balance",
    "/api/funds/flow",
    "/api/funds/statements/customer",
    "/api/funds/cost/summary",
    "/api/funds/staff-debt",
    "/api/funds/bank-reconcile",
]

fail = []


def call(path, token=None, tenant=None):
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("X-Client", "web")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", str(tenant))
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def demo_login():
    req = urllib.request.Request(BASE + "/api/auth/demo-login", method="POST",
                                 data=b"", headers={"X-Client": "web"})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read().decode())
    return d["token"], d.get("tenant_id"), d.get("user", {})


def main():
    print("=" * 64)
    print("① 无鉴权 ⇒ 期望 401（404 = router 未挂载）")
    codes = []
    for p in FUND_PATHS[:3]:
        st, _ = call(p)
        codes.append(st)
        print(f"   {st}  {p}")
    if codes != [401, 401, 401]:
        fail.append(f"无鉴权期望 401，实测 {codes}")

    print()
    print("② 演示 boss（tenant 10，已授 funds）⇒ 期望全 200")
    token, tenant, user = demo_login()
    print(f"   登录为 {user.get('username')} / role={user.get('role')} / tenant={tenant}")
    for p in FUND_PATHS:
        st, body = call(p, token, tenant)
        ok = st == 200
        if not ok:
            fail.append(f"{p} 期望 200，实测 {st}")
        print(f"   {st}  {'OK ' if ok else 'FAIL'} {p}")

    if "--ab" in sys.argv:
        print()
        print("③ 受控 A/B：临时摘掉 tenant 10 boss 的 funds ⇒ 期望 403 且文案含「资金管理」")
        if tenant != 10:
            fail.append("A/B 只允许对演示租户 10 执行")
        else:
            run_ab(token, tenant)
    else:
        print()
        print("③ 已跳过（未加 --ab）。默认只跑 ①② ⇒ 零写操作。")

    print()
    if fail:
        print("❌ 失败项：")
        for f in fail:
            print("   -", f)
        return 1
    print("✅ 全部通过")
    return 0


def ssh(cmd, timeout=90):
    return subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "root@47.113.224.140", cmd],
        capture_output=True, text=True, timeout=timeout)


def run_ab(token, tenant):
    # 摘掉 / 还原 走同一个脚本，用 SQL 直接改并断言「只动了 funds」
    revoke = (
        "cd /opt/hergent-erp && python3 - <<'PY'\n"
        "import sqlite3, json\n"
        "c = sqlite3.connect('tenant_10.db')\n"
        "row = c.execute(\"SELECT permissions FROM role_permissions WHERE role_name='boss'\").fetchone()\n"
        "p = json.loads(row[0]); before = list(p)\n"
        "if 'funds' in p: p.remove('funds')\n"
        "with c: c.execute(\"UPDATE role_permissions SET permissions=? WHERE role_name='boss'\", (json.dumps(p, ensure_ascii=False),))\n"
        "assert sorted(json.loads(c.execute(\"SELECT permissions FROM role_permissions WHERE role_name='boss'\").fetchone()[0]) + ['funds']) == sorted(before)\n"
        "print('revoked', len(before), '->', len(p))\n"
        "PY")
    restore = (
        "cd /opt/hergent-erp && python3 - <<'PY'\n"
        "import sqlite3, json\n"
        "c = sqlite3.connect('tenant_10.db')\n"
        "row = c.execute(\"SELECT permissions FROM role_permissions WHERE role_name='boss'\").fetchone()\n"
        "p = json.loads(row[0])\n"
        "if 'funds' not in p: p.append('funds')\n"
        "with c: c.execute(\"UPDATE role_permissions SET permissions=? WHERE role_name='boss'\", (json.dumps(p, ensure_ascii=False),))\n"
        "print('restored', len(p), '含 funds =', 'funds' in json.loads(c.execute(\"SELECT permissions FROM role_permissions WHERE role_name='boss'\").fetchone()[0]))\n"
        "PY")

    def restart():
        return ssh("systemctl restart hergent-erp.service && sleep 5 && systemctl is-active hergent-erp.service")

    try:
        print("   · 备份 + 摘除 funds …")
        print("    ", ssh("cp -p /opt/hergent-erp/tenant_10.db /opt/hergent-erp/_backup/tenant_10.db.pre-v469ab-$(date +%Y%m%d-%H%M%S) && echo backed-up").stdout.strip())
        print("    ", ssh(revoke).stdout.strip())
        print("   · 重启 →", restart().stdout.strip())
        st, body = call("/api/funds/meta", token, tenant)
        has_cn = "资金管理" in body
        print(f"   → {st}  文案含「资金管理」= {has_cn}")
        print(f"      body: {body[:160]}")
        if st != 403:
            fail.append(f"A/B 摘除后期望 403，实测 {st}")
        if not has_cn:
            fail.append("403 文案未渲染中文名「资金管理」（MODULE_LABEL 未生效）")
    finally:
        print("   · 还原 funds …")
        print("    ", ssh(restore).stdout.strip())
        print("   · 重启 →", restart().stdout.strip())
        st2, _ = call("/api/funds/meta", token, tenant)
        print(f"   → 还原后 {st2}（期望 200）")
        if st2 != 200:
            fail.append(f"还原后期望 200，实测 {st2} —— 🔴 必须人工检查 tenant_10！")


if __name__ == "__main__":
    sys.exit(main())
