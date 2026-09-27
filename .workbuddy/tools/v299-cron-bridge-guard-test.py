#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v299「定时任务失败显式化」判据真码单测。

🔴 判据不是"照抄一份再断言"，而是用 `ast` 从**真文件**里切出**真函数**来跑：
   `server/routers/cron_tasks.py` 的 `_authority_job_count` 与 `_bridge_or_502`。
只读、离线、不碰生产数据（JOBS_JSON 注入临时路径）。

四条用例的判别力（缺任一条都会漏掉一类假绿）：
  ① 上游失败（bridge ok:false + traceback）   ⇒ 必须 502（旧行为：HTTP 200 + 空列表 → 页面空、零报错）
  ② 静默空（bridge ok:true + jobs:[]，而权威文件有 2 条）⇒ 必须 502（旧行为：谎报"没有任务"）
  ③ 真·无任务（bridge ok:true + jobs:[]，权威文件也空/不存在）⇒ 必须**放行**（不得误报）
  ④ 正常（bridge ok:true + jobs 非空）⇒ 必须放行且原样返回
  ⚠️ ③ 是 ② 的反例对照：没有 ③ 就证明不了 ② 不是"一律 502"的空断言。
"""
import ast
import json
import os
import sys
import tempfile
import textwrap

REPO = "/Users/zhangjunfeng/Documents/hergent-erp"
SRC = os.path.join(REPO, "server/routers/cron_tasks.py")
WANT = {"_authority_job_count", "_bridge_or_502"}


class FakeHTTPException(Exception):
    def __init__(self, status_code=None, detail=None, **kw):
        self.status_code = status_code
        self.detail = detail
        super().__init__("%s %s" % (status_code, detail))


def load_real_funcs():
    src = open(SRC, encoding="utf-8").read()
    tree = ast.parse(src)
    got = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in WANT:
            got[node.name] = textwrap.dedent(ast.get_source_segment(src, node))
    missing = WANT - set(got)
    if missing:
        raise SystemExit("!! 真文件里找不到函数：%s ⇒ 判据失效，先核对源码" % missing)
    return got


def make_ns(funcs, jobs_json_path, bridge_ret):
    ns = {
        "os": os, "json": json, "HTTPException": FakeHTTPException,
        "JOBS_JSON": jobs_json_path,
        "HERMES_HOME": "/root/.hermes",
    }

    def _bridge(action, job_id=None, data=None):
        ns["_bridge_calls"].append((action, job_id, data))
        return bridge_ret

    ns["_bridge"] = _bridge
    ns["_bridge_calls"] = []
    for name in ("_authority_job_count", "_bridge_or_502"):
        exec(compile(funcs[name], "<%s>" % name, "exec"), ns)
    return ns


CASES = []


def case(desc, bridge_ret, jobs_content, expect):
    CASES.append((desc, bridge_ret, jobs_content, expect))


case("① 上游失败：bridge ok:false + traceback ⇒ 必须 502",
     {"ok": False, "error": "Traceback (most recent call last):\n  File ...\nOSError: [Errno 30] Read-only file system: '/root/.hermes'"},
     {"jobs": [{"id": "a"}, {"id": "b"}]},
     ("raise", 502, "Hermes 定时任务服务调用失败"))

case("② 静默空：bridge ok:true + jobs=[] 而权威有 2 条 ⇒ 必须 502",
     {"ok": True, "jobs": []},
     {"jobs": [{"id": "a"}, {"id": "b"}]},
     ("raise", 502, "定时任务数据读取异常"))

case("③ 反例：bridge ok:true + jobs=[] 且权威也空 ⇒ 必须放行（不得误报）",
     {"ok": True, "jobs": []},
     {"jobs": []},
     ("pass", None, None))

case("④ 正常：bridge ok:true + jobs 非空 ⇒ 放行且原样返回",
     {"ok": True, "jobs": [{"id": "853f2e208ae2", "name": "每日经营要务预生成"}]},
     {"jobs": [{"id": "853f2e208ae2"}]},
     ("pass", None, None))

case("⑤ 反例：bridge ok:true + jobs=[] 且权威文件**不存在** ⇒ 必须放行（保守设计）",
     {"ok": True, "jobs": []},
     None,
     ("pass", None, None))

case("⑥ 反例：bridge ok:true + jobs=[] 且权威文件是坏 JSON ⇒ 必须放行（不得误报）",
     {"ok": True, "jobs": []},
     "{ this is not json",
     ("pass", None, None))


def main():
    funcs = load_real_funcs()
    print("判据来源（真文件切片）：%s" % SRC)
    print("切出函数：%s" % sorted(funcs))
    print("=" * 78)
    ok = bad = 0
    tmpdir = tempfile.mkdtemp(prefix="v299-cron-")
    for i, (desc, bridge_ret, jobs_content, expect) in enumerate(CASES):
        path = os.path.join(tmpdir, "case%d_jobs.json" % i)
        if jobs_content is None:
            if os.path.exists(path):
                os.remove(path)
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(jobs_content if isinstance(jobs_content, str) else json.dumps(jobs_content))
        ns = make_ns(funcs, path, bridge_ret)
        try:
            r = ns["_bridge_or_502"]("list")
            got = ("pass", None, None)
            ret = r
        except FakeHTTPException as e:
            got = ("raise", e.status_code, e.detail)
            ret = None
        good = (got[0] == expect[0]
                and (expect[1] is None or got[1] == expect[1])
                and (expect[2] is None or (got[2] and expect[2] in got[2])))
        if good:
            ok += 1
        else:
            bad += 1
        print("%s %s" % ("OK " if good else "!!!", desc))
        print("      期望=%s" % (expect,))
        print("      实得=%s" % (got,))
        if ret is not None:
            print("      返回=%s" % (json.dumps(ret, ensure_ascii=False)[:120],))
    print("=" * 78)
    print("%s  %d 通过 / %d 失败" % ("✅" if not bad else "❌", ok, bad))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
