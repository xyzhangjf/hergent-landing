#!/usr/bin/env python3
"""P0 端到端实测：改配方 → 本租户 Hermes 技能是否跟随

在**生产**上跑（改完立即改回）。验证链：
  PUT /api/loss/recipe（真 API，真登录）
    → 后端写 workflow_recipes
    → recipe_sync 写 **租户** skills/hergent-milk-expiry/SKILL.md
    → 内容有变 → 重启该租户网关（Hermes 技能索引有进程内 LRU 缓存，键不含 mtime）

断言：
  A1 租户 SKILL.md 的「临期阈值」= 新值，且「同步时间」是本次
  A2 全局 /root/.hermes/skills 那份**未被触碰**（不再是同步目标）
  A3 租户网关 PID 发生变化（证明重启真的发生）
  A4 无 .tmp 残渣
  A5 改回原值后 SKILL.md 也回到原值（双向跟随）

用法：runuser -u hergent -- python3 /tmp/e2e_recipe_sync.py
"""
import json
import os
import re
import time
import glob
import sqlite3
import urllib.request

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 必须禁代理
BASE = "http://127.0.0.1:8700"
TID = 1
SKILL = "/opt/hermes-tenants/hergent_t1/skills/hergent-milk-expiry/SKILL.md"
GSKILL = "/root/.hermes/skills/hergent-milk-expiry/SKILL.md"

PASS = 0
FAIL = 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + msg)
    else:
        FAIL += 1
        print("  FAIL  " + msg)


def api(method, path, body=None, token=None, tenant=None):
    r = urllib.request.Request(BASE + path, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if tenant:
        r.add_header("X-Tenant-Id", str(tenant))
    data = json.dumps(body).encode() if body is not None else None
    try:
        with OPENER.open(r, data, timeout=90) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def read_field(path, field):
    try:
        with open(path, encoding="utf-8") as f:
            md = f.read()
    except OSError as e:
        return None, "READ-ERR:" + str(e)
    m = re.search(r"\|\s*" + re.escape(field) + r"\s*\|\s*([^|]+?)\s*\|", md)
    return (m.group(1).strip() if m else None), md


def sync_time(path):
    _, md = read_field(path, "临期阈值 threshold_days")
    m = re.search(r"同步时间：([^\n(]+)", md or "")
    return (m.group(1).strip() if m else None)


def gateway_pid():
    for p in glob.glob("/proc/[0-9]*/cmdline"):
        try:
            with open(p, "rb") as f:
                cl = f.read().decode("utf-8", "replace").split("\x00")
        except OSError:
            continue
        if len(cl) > 1 and "hermes" in cl[0] and "gateway" in cl and "run" in cl:
            # 只看 HERMES_HOME 指向本租户的那个
            env = os.path.join(os.path.dirname(p), "environ")
            try:
                with open(env, "rb") as f:
                    e = f.read().decode("utf-8", "replace")
            except OSError:
                continue
            if "hergent_t1" in e:
                return int(os.path.basename(os.path.dirname(p)))
    return None


def db_recipe():
    c = sqlite3.connect("/opt/hergent-erp/tenant_1.db")
    r = c.execute("SELECT recipe FROM workflow_recipes WHERE key='loss_recipe'").fetchone()
    c.close()
    return json.loads(r[0]) if r and r[0] else {}


def main():
    print("== 步骤 1：登录 ==")
    # 凭据不入库：提审测试账号密码见 memory/topics/deploy-ops.md
    # 跑法：HG_PASS='<密码>' python3 recipe-sync-e2e-prod.py
    _pw = os.environ.get("HG_PASS", "")
    if not _pw:
        print("需要环境变量 HG_PASS（提审测试账号密码，见 memory/topics/deploy-ops.md）")
        return 1
    st, j = api("POST", "/api/auth/login",
                {"username": os.environ.get("HG_USER", "mptest"), "password": _pw})
    ok(st == 200 and j.get("token"), "登录 200 且拿到 token（实测 %s）" % st)
    tok = j.get("token")
    if not tok:
        print("  登录失败，终止:", j)
        return 1

    base = db_recipe()
    orig = int(base.get("threshold_days") or 7)
    print("   当前配方 threshold_days = %s" % orig)

    t_before_tenant = sync_time(SKILL)
    g_before = read_field(GSKILL, "临期阈值 threshold_days")[0]
    g_mtime_before = os.stat(GSKILL).st_mtime_ns if os.path.exists(GSKILL) else None
    pid_before = gateway_pid()
    print("   租户 SKILL 同步时间=%s；全局那份=%s；租户网关 pid=%s" % (t_before_tenant, g_before, pid_before))

    NEW = 5 if orig != 5 else 6

    try:
        print("\n== 步骤 2：通过真 API 改配方 %s → %s ==" % (orig, NEW))
        body = dict(base)
        body["threshold_days"] = NEW
        st, j = api("PUT", "/api/loss/recipe", body, token=tok, tenant=TID)
        ok(st == 200, "PUT /api/loss/recipe -> %s" % st)
        ok(int(db_recipe().get("threshold_days")) == NEW,
           "DB 已落库 threshold_days=%s" % NEW)

        print("\n【A1】租户 skill 跟随新值")
        v, _ = read_field(SKILL, "临期阈值 threshold_days")
        ok(v == "%s 天" % NEW, "租户 SKILL 阈值 = %s（实测 %s）" % (NEW, v))
        t_after = sync_time(SKILL)
        ok(t_after and t_after != t_before_tenant,
           "同步时间已刷新（%s → %s）" % (t_before_tenant, t_after))

        print("\n【A2】全局那份不再被触碰")
        g_after = read_field(GSKILL, "临期阈值 threshold_days")[0]
        g_mtime_after = os.stat(GSKILL).st_mtime_ns if os.path.exists(GSKILL) else None
        ok(g_after == g_before, "全局 SKILL 内容未变（%s）" % g_after)
        ok(g_mtime_after == g_mtime_before, "全局 SKILL mtime 未变（它已不是同步目标）")

        print("\n【A3】租户网关被重启（Hermes 技能索引 LRU 缓存键不含 mtime，不重启读不到新技能）")
        time.sleep(3)
        pid_after = gateway_pid()
        ok(pid_after is not None, "租户网关仍在运行（pid=%s）" % pid_after)
        ok(pid_after != pid_before, "网关 PID 已变化（%s → %s）" % (pid_before, pid_after))

        print("\n【A4】无 .tmp 残渣")
        junk = glob.glob(SKILL + ".tmp") + glob.glob("/opt/hermes-tenants/hergent_t1/skills/*/SKILL.md.tmp")
        ok(junk == [], "无 .tmp 残渣（实测 %s）" % junk)

        print("\n== 步骤 3：改回原值 %s ==" % orig)
        body2 = dict(base)
        body2["threshold_days"] = orig
        st, j = api("PUT", "/api/loss/recipe", body2, token=tok, tenant=TID)
        ok(st == 200, "PUT 改回 -> %s" % st)
        v2, _ = read_field(SKILL, "临期阈值 threshold_days")
        ok(v2 == "%s 天" % orig, "租户 SKILL 已回到 %s（实测 %s）" % (orig, v2))

    finally:
        # 兜底：确保配方回到原值
        try:
            cur = db_recipe()
            if int(cur.get("threshold_days") or 0) != orig:
                b = dict(cur)
                b["threshold_days"] = orig
                api("PUT", "/api/loss/recipe", b, token=tok, tenant=TID)
                print("\n   [兜底] 已把配方改回 %s" % orig)
        except Exception as e:                                    # noqa: BLE001
            print("\n   [兜底] 复位失败：%s" % e)

    print("\n" + "=" * 56)
    print("P0 端到端实测：%d PASS / %d FAIL" % (PASS, FAIL))
    print("=" * 56)
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
