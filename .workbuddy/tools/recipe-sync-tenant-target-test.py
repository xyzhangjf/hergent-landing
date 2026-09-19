#!/usr/bin/env python3
"""recipe_sync.py 租户目标目录修复 —— 本地单测（不碰生产、不连真库）

被验证的缺陷（P0）
------------------
trigger_sync_from_service() 旧实现把「实时配方」写进全局 /root/.hermes/skills，
而租户网关只读 /opt/hermes-tenants/hergent_t<N>/skills → 用户改配方后，
网页按新值算、AI 按旧值答。

本脚本用「假 hermes_tenants + 假 erp_db + 临时租户目录」把修复后的行为钉死：
  T1  目标目录 = 该租户自己的 skills 目录（不是全局目录）
  T2  该租户没启用 AI（无 skills 目录）→ 跳过且不凭空创建
  T3  首次写入 → updated；内容未变再写 → unchanged
  T4  只改 AUTO_RECIPE 区块，正文其余内容一字不动
  T5  原子写：不留 .tmp 残渣；保留原文件权限位
  T6  网关在运行 且 内容有变 → 重启网关；内容未变 → 不重启
  T7  网关没在运行 → 不重启（不做无谓动作）
  T8  hermes_tenants 不可用 → fail-closed（不抛异常，返回 ok:False）
  T9  read_live_recipes 不改调用方的租户上下文（ContextVar 必须还原）
  T10 源码级护栏：不再有 sudo / subprocess 式写入，目录解析委托权威实现

运行：python3 .workbuddy/tools/recipe-sync-tenant-target-test.py
      （环境变量 HERGENT_SERVER_DIR 可覆盖后端 server 目录）
"""
import os
import sys
import types
import shutil
import tempfile
from pathlib import Path

SERVER = Path(os.environ.get(
    "HERGENT_SERVER_DIR", os.path.expanduser("~/Documents/hergent-erp/server")))
if not (SERVER / "recipe_sync.py").exists():
    print("找不到后端 server 目录：%s" % SERVER)
    sys.exit(2)
sys.path.insert(0, str(SERVER))

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


# ---------------------------------------------------------------- 假模块
class _FakeCursor:
    def execute(self, sql, params=()):          # noqa: ARG002
        return self

    def fetchone(self):
        return None                             # 无记录 → 走 FALLBACK 默认配方


class _FakeCtxMgr:
    def __enter__(self):
        return _FakeCursor()

    def __exit__(self, *a):
        return False


class FakeErpDb(types.ModuleType):
    """只实现 recipe_sync 用到的那几个函数，用于观测上下文读写。"""

    def __init__(self):
        super().__init__("erp_db")
        self.ctx = None

    def get_tenant_context(self):
        return self.ctx

    def set_tenant_context(self, tid=None):
        self.ctx = tid

    def get_db(self):
        return _FakeCtxMgr()


RESTART_CALLS = []


def make_fake_hermes_tenants(root, gateway_running=True):
    mod = types.ModuleType("hermes_tenants")

    def home_for(tid):
        return Path(root) / ("hergent_t%d" % int(tid))

    mod.home_for = home_for
    mod.available = lambda: True
    mod.gateway_pid = lambda tid: (4242 if gateway_running else None)

    def gateway_restart(tid, wait=True):        # noqa: ARG001
        RESTART_CALLS.append(int(tid))
        return {"ok": True, "state": "running"}

    mod.gateway_restart = gateway_restart
    return mod


def seed_tenant_skills(root, tid, body="正文一段不该被改的文字。\n"):
    d = Path(root) / ("hergent_t%d" % tid) / "skills"
    for mod_name in ("hergent-milk-expiry", "hergent-milk-forecast",
                     "hergent-milk-commission", "hergent-milk-rebate"):
        p = d / mod_name
        p.mkdir(parents=True, exist_ok=True)
        (p / "SKILL.md").write_text(
            "---\nname: %s\n---\n\n%s" % (mod_name, body), encoding="utf-8")
    return d


BODY = "正文一段不该被改的文字。\n"


def t1_root_target(rs, skills_t1):
    print("\n【T1】目标是该租户自己的 skills 目录")
    global RESTART_CALLS
    RESTART_CALLS = []
    out = rs.trigger_sync_from_service(1)
    exp = str(skills_t1)
    ok(out.get("ok") is True, "返回 ok=True")
    ok(out.get("skills_dir") == exp, "skills_dir = %s（实测 %s）" % (exp, out.get("skills_dir")))
    ok(out.get("tenant_id") == 1, "tenant_id = 1")
    ok(len(out.get("changed", [])) == 4, "4 个 skill 均被更新（changed=%s）" % out.get("changed"))
    body = (skills_t1 / "hergent-milk-expiry" / "SKILL.md").read_text(encoding="utf-8")
    ok("AUTO_RECIPE_START" in body, "AUTO_RECIPE 区块已写入")
    ok("threshold_days" in body, "含 loss 配方字段")
    ok(exp != "/root/.hermes/skills", "目标目录不是全局 /root/.hermes/skills")


def t4_body_untouched(skills_t1):
    print("\n【T4】只改 AUTO_RECIPE 区块，正文一字不动")
    after = (skills_t1 / "hergent-milk-expiry" / "SKILL.md").read_text(encoding="utf-8")
    ok(after.startswith("---\nname: hergent-milk-expiry\n---\n\n" + BODY),
       "正文前缀逐字保留（只在末尾追加了 AUTO_RECIPE 区块）")


def t3_unchanged(rs, skills_t1):
    print("\n【T3】内容未变 → unchanged（不重复写盘）")
    p = skills_t1 / "hergent-milk-expiry" / "SKILL.md"
    m1 = p.stat().st_mtime_ns
    out = rs.trigger_sync_from_service(1)
    m2 = p.stat().st_mtime_ns
    ok(out.get("changed") == [], "changed 为空（实测 %s）" % out.get("changed"))
    ok(all(v == "unchanged" for v in out["results"].values()),
       "results 全为 unchanged（实测 %s）" % sorted(set(out["results"].values())))
    ok(m1 == m2, "文件 mtime 未被无谓改动（Hermes 技能快照不必失效）")


def t6_restart_on_change(rs, skills_t1):
    print("\n【T6】网关在运行 且 内容有变 → 重启；内容未变 → 不重启")
    global RESTART_CALLS
    RESTART_CALLS = []
    rs.trigger_sync_from_service(1)
    ok(RESTART_CALLS == [], "内容未变时不重启网关（实测 %s）" % RESTART_CALLS)

    rs.FALLBACK["loss"]["threshold_days"] = 5       # 制造变化
    RESTART_CALLS = []
    out = rs.trigger_sync_from_service(1)
    ok(out.get("changed") == ["hergent-milk-expiry"],
       "只有货损 skill 变化（changed=%s）" % out.get("changed"))
    ok(out["results"]["hergent-milk-expiry"] == "updated"
       and all(v == "unchanged" for k, v in out["results"].items()
               if k != "hergent-milk-expiry"),
       "results 里仅 hergent-milk-expiry=updated，其余 unchanged（实测 %s）" % out["results"])
    ok(out.get("gateway_restarted") is True, "gateway_restarted=True")
    ok(RESTART_CALLS == [1], "gateway_restart 被调用于租户 1（实测 %s）" % RESTART_CALLS)
    body = (skills_t1 / "hergent-milk-expiry" / "SKILL.md").read_text(encoding="utf-8")
    ok("| 临期阈值 threshold_days | 5 天 |" in body, "租户 skill 里阈值已变 5 天")
    rs.FALLBACK["loss"]["threshold_days"] = 7       # 还原


def t5_atomic(rs, skills_t1):
    print("\n【T5】原子写：无 .tmp 残渣；保留原文件权限位")
    p = skills_t1 / "hergent-milk-expiry" / "SKILL.md"
    os.chmod(p, 0o600)
    rs.FALLBACK["loss"]["threshold_days"] = 4
    rs.trigger_sync_from_service(1)
    rs.FALLBACK["loss"]["threshold_days"] = 7
    mode = oct(p.stat().st_mode & 0o777)
    ok(mode == "0o600", "写后权限仍为 0o600（实测 %s）" % mode)
    junk = sorted(x.name for x in p.parent.iterdir() if x.name.endswith(".tmp"))
    ok(junk == [], "目录内无 .tmp 残渣（实测 %s）" % junk)


def t9_context(fake_db, rs):
    print("\n【T9】read_live_recipes 不改调用方的租户上下文")
    allok = True
    detail = []
    for before, ask in ((None, 1), (3, 3), (None, 7)):
        fake_db.ctx = before
        rs.read_live_recipes(ask)
        detail.append("%s→%s(请求%s)" % (before, fake_db.ctx, ask))
        if fake_db.ctx != before:
            allok = False
    ok(allok, "调用前后上下文不变：" + " ".join(detail))


def t11_no_context(rs, fake_db, skills_t1):
    print("\n【T11】拿不到租户号 → 宁可不写（防跨租户污染）")
    fake_db.ctx = None
    p = skills_t1 / "hergent-milk-expiry" / "SKILL.md"
    m1 = p.stat().st_mtime_ns
    out = rs.trigger_sync_from_service()        # 不传租户号，上下文也为空
    m2 = p.stat().st_mtime_ns
    ok(out.get("ok") is False, "返回 ok=False")
    ok(out.get("msg") == "no-tenant-context",
       "msg=no-tenant-context（实测 %s）" % out.get("msg"))
    ok(m1 == m2, "文件未被写入（若回退到租户 1 就会把 A 家口径写进 B 家）")


def t2_no_home(rs, fake_db, tmp):
    print("\n【T2】该租户未启用 AI（无 skills 目录）→ 跳过，且不凭空创建")
    fake_db.ctx = 99
    out = rs.trigger_sync_from_service(99)
    ok(out.get("skipped") == "no-tenant-skills",
       "skipped=no-tenant-skills（实测 %s）" % out.get("skipped"))
    ok(not (Path(tmp) / "hergent_t99").exists(), "未凭空创建 hergent_t99 目录")


def t7_no_gateway(rs, tmp):
    print("\n【T7】网关没在运行 → 不重启")
    global RESTART_CALLS
    sys.modules["hermes_tenants"] = make_fake_hermes_tenants(tmp, False)
    rs.FALLBACK["loss"]["threshold_days"] = 6
    RESTART_CALLS = []
    out = rs.trigger_sync_from_service(1)
    ok(out.get("changed") == ["hergent-milk-expiry"],
       "确实检测到变化（changed=%s）" % out.get("changed"))
    ok(RESTART_CALLS == [], "gateway_restart 未被调用（实测 %s）" % RESTART_CALLS)
    ok(out.get("gateway_restarted") is False, "gateway_restarted=False")
    rs.FALLBACK["loss"]["threshold_days"] = 7


def t8_failclosed(rs):
    print("\n【T8】hermes_tenants 不可用 → fail-closed，不抛异常")
    sys.modules["hermes_tenants"] = types.ModuleType("hermes_tenants")
    try:
        out = rs.trigger_sync_from_service(1)
        ok(out.get("ok") is False, "返回 ok=False")
        ok(out.get("msg") == "hermes-tenants-unavailable",
           "msg=hermes-tenants-unavailable（实测 %s）" % out.get("msg"))
    except Exception as e:                        # noqa: BLE001
        ok(False, "不应抛异常，实际抛出：%s" % e)


def t10_source_guard():
    print("\n【T10】源码级护栏：不再有 sudo 子进程式写入")
    src = (SERVER / "recipe_sync.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    ok("subprocess" not in code, "代码中不出现 subprocess")
    ok('"sudo"' not in code and "'sudo'" not in code, "代码中不出现 sudo 调用")
    ok("tenant_skills_dir" in src, "存在租户目录解析函数 tenant_skills_dir")
    ok("home_for(tenant_id)" in src, "目录解析委托 hermes_tenants.home_for（单一权威实现）")
    doc = src.split('"""')[1]
    ok("HERMES_HOME/skills" in doc, "文件头写明「租户网关只读自己目录」这一根因")


def main():
    import recipe_sync as rs

    tmp = Path(tempfile.mkdtemp(prefix="recipe-sync-test-"))
    try:
        skills_t1 = seed_tenant_skills(tmp, 1)
        fake_db = FakeErpDb()
        sys.modules["erp_db"] = fake_db
        sys.modules["hermes_tenants"] = make_fake_hermes_tenants(tmp, True)

        t1_root_target(rs, skills_t1)
        t4_body_untouched(skills_t1)
        t3_unchanged(rs, skills_t1)
        t6_restart_on_change(rs, skills_t1)
        t5_atomic(rs, skills_t1)
        t9_context(fake_db, rs)
        t11_no_context(rs, fake_db, skills_t1)
        t2_no_home(rs, fake_db, tmp)
        t7_no_gateway(rs, tmp)
        t8_failclosed(rs)
        t10_source_guard()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 56)
    print("recipe_sync 租户目标目录：%d PASS / %d FAIL" % (PASS, FAIL))
    print("=" * 56)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
