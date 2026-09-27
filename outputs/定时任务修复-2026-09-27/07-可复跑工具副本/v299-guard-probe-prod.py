#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v299 生产侧判据台：在**服务沙箱内**加载**生产真文件**，验证三条守卫分支。

🔴 判别力设计（缺一条就不能算验证过）：
  ① 正常路径 —— 用**真 bridge**（sudo）读**真数据** ⇒ 期望 ok:true 且 jobs 非空
     （同时证明服务沙箱内能读到 /root/.hermes）
  ② 上游失败 —— monkeypatch `_bridge` 返回 ok:false ⇒ 期望 **HTTPException 502**
     （旧行为：HTTP 200 + 空列表 ⇒ 前端渲染成"没有定时任务"）
  ③ 静默空 —— monkeypatch `_bridge` 返回 ok:true + jobs=[]，而权威文件里有 N>0 条
     ⇒ 期望 **HTTPException 502**（防"去掉 sudo 后读错目录"这类假绿）
  ④ 权威文件可读性 —— 直接调 `_authority_job_count()` ⇒ 期望返回 int（而非 None）
     ⚠️ 若这里返回 None，③ 的守卫就永远不会触发（保守设计）⇒ 必须单独确认它真的读得到

安全：②③ 只替换内存里的函数引用，**不写任何数据**；① 是只读 list。
"""
import importlib.util
import sys
import types

TARGET = "/opt/hergent-erp/routers/cron_tasks.py"


def stub(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m


def load_prod():
    """加载生产真文件（stub 掉 core / erp_db，避免碰 DB）。"""
    stub("core", _auth=lambda r: None)
    stub("erp_db", get_db=None)
    spec = importlib.util.spec_from_file_location("ct_prod", TARGET)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ct = load_prod()
    print("已加载生产真文件：%s" % TARGET)
    print("HERMES_HOME = %s" % ct.HERMES_HOME)
    print("JOBS_JSON   = %s" % ct.JOBS_JSON)
    print("=" * 76)

    # ④ 先验权威文件可读性 —— 它是 ③ 能生效的前提
    n = ct._authority_job_count()
    print("④ _authority_job_count() ⇒ %r  %s" % (n, "OK" if isinstance(n, int) else "!! 读到 None ⇒ 守卫 ③ 永不触发"))

    # ① 正常路径（真 bridge）
    try:
        r = ct._bridge_or_502("list")
        jobs = r.get("jobs") or []
        print("① 正常路径 ⇒ ok=%s jobs=%d  %s" % (r.get("ok"), len(jobs), "OK" if r.get("ok") and jobs else "!!"))
        for j in jobs:
            print("     · %s  %s  state=%s" % (j.get("id"), j.get("name"), j.get("state")))
    except Exception as e:
        print("① 正常路径 ⇒ !!! %s: %s" % (type(e).__name__, str(e)[:200]))

    real_bridge = ct._bridge

    # ② 上游失败 ⇒ 期望 502
    ct._bridge = lambda *a, **k: {"ok": False, "error": "SIMULATED: Traceback ... OSError EROFS"}
    try:
        ct._bridge_or_502("list")
        print("② 上游失败 ⇒ !!! 未抛异常（应 502）")
    except Exception as e:
        sc = getattr(e, "status_code", None)
        print("② 上游失败 ⇒ %s %s  %s" % (type(e).__name__, sc, "OK" if sc == 502 else "!!"))
        print("     detail=%s" % str(getattr(e, "detail", ""))[:110])

    # ③ 静默空（权威有 N>0）⇒ 期望 502
    ct._bridge = lambda *a, **k: {"ok": True, "jobs": []}
    try:
        ct._bridge_or_502("list")
        print("③ 静默空 ⇒ !!! 未抛异常（应 502）")
    except Exception as e:
        sc = getattr(e, "status_code", None)
        print("③ 静默空 ⇒ %s %s  %s" % (type(e).__name__, sc, "OK" if sc == 502 else "!!"))
        print("     detail=%s" % str(getattr(e, "detail", ""))[:130])

    ct._bridge = real_bridge
    print("=" * 76)
    print("判据台结束（未写任何数据）")


if __name__ == "__main__":
    main()
