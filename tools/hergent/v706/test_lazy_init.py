#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v706 第⑤步（懒建表读路径）的离线验证（**不连生产**）。

判据：
  ① 补丁打上后，9 个目标函数的**第一条语句**就是对应的 ensure（docstring 之后）
  ② 缩进就地跟随（制表符函数保持制表符，空格函数保持空格）—— 混用会 SyntaxError
  ③ 幂等：再跑一遍 = 0 处改动
  ④ 回滚：`--revert` 后与原文**逐字节**相同
  ⑤ 回归本条：函数的**下一个函数**里有 ensure 时，不许把本函数判成"已有"而静默跳过
     （这是补丁脚本第一版真踩中的坑，dry-run 报「7 处 / 目标 9 个」才暴露）
  ⑥ 负向：把插入行删掉，检测器必须重新报出来（证明检测有牙，不是恒绿）

用法：
    python3 test_lazy_init.py [--src .tmp-audit]
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent          # <repo>/tools/hergent/v706
TOOLS = HERE.parent                              # <repo>/tools/hergent
ROOT = TOOLS.parent.parent                       # <repo>
PATCHER = TOOLS / "patch_v706_lazy_init.py"

sys.path.insert(0, str(TOOLS))
import patch_v706_lazy_init as P            # noqa: E402

PASS, FAIL = [], []


def ok(cond, msg, detail=""):
    (PASS if cond else FAIL).append(msg)
    print(("  ✅ " if cond else "  ❌ ") + msg + (("   ← %s" % detail) if (detail and not cond) else ""))


def run(root, *args):
    r = subprocess.run([sys.executable, str(PATCHER), "--root", str(root), *args],
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


# 最小可测样本：一个"读了懒建表却没 ensure"的函数 + 一个**下一个函数里带 ensure**的情形
SAMPLE = '''\
def ncr_disposition(ncr_id, disposition):
\twith get_db() as db:
\t\tdb.execute("UPDATE non_conformances SET disposition=? WHERE id=?", (disposition, ncr_id))
\t\tdb.commit()


def ncr_close(ncr_id):
\twith get_db() as db:
\t\tdb.execute("UPDATE non_conformances SET status='closed' WHERE id=?", (ncr_id,))
\t\tdb.commit()


def pick_wave_list(warehouse_id=0):
    """列出波次。

    多行 docstring，插入点必须在它**之后**。
    """
    with get_db() as db:
        return db.execute("SELECT * FROM pick_waves").fetchall()


def job_list(status=''):
    _init_recruitment_tables()
    with get_db() as db:
        return db.execute("SELECT * FROM hr_jobs").fetchall()


def job_close(jid):
    with get_db() as db:
        db.execute("UPDATE hr_jobs SET status='closed' WHERE id=?", (jid,))
        db.commit()
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / ".tmp-audit"))
    a = ap.parse_args()

    print("=" * 74)
    print("v706 懒建表读路径 · 离线验证")
    print("=" * 74)

    tmp = tempfile.mkdtemp()
    try:
        f = Path(tmp) / "erp_db.py"
        f.write_text(SAMPLE, encoding="utf-8")

        print("\n=== ① 幂等判据不许越界（注入了 job_list 的 ensure 在 job_close 之前）===")
        rc, out = run(tmp)
        ok(rc == 0, "退出 0（4 个目标全部改到）", "rc=%s\n%s" % (rc, out[-300:]))
        src = f.read_text(encoding="utf-8")
        for fn, ens in [("ncr_disposition", "_init_qms_tables"),
                        ("ncr_close", "_init_qms_tables"),
                        ("pick_wave_list", "_init_wms_tables"),
                        ("job_close", "_init_recruitment_tables")]:
            m = re.search(r"^def %s\(.*?\n(.*?)(?=\n\ndef |\Z)" % fn, src, re.S | re.M)
            body = m.group(1) if m else ""
            ok(bool(re.search(r"^\s*%s\(" % ens, body, re.M)),
               "%s 已补 %s()" % (fn, ens), body[:120])

        print("\n=== ② job_list 已有 ensure，不许重复插 ===")
        n = len(re.findall(r"^\s*_init_recruitment_tables\(", src, re.M))
        ok(n == 2, "_init_recruitment_tables 出现 2 次（job_list 原有 + job_close 新增）", n)

        print("\n=== ③ 缩进就地跟随 ===")
        ok("\t_init_qms_tables()" in src, "制表符函数保持制表符")
        ok("\n    _init_wms_tables()" in src, "空格函数保持 4 空格")
        import ast
        try:
            ast.parse(src)
            ok(True, "插入后源码可解析")
        except SyntaxError as e:
            ok(False, "插入后源码可解析", str(e))

        print("\n=== ④ docstring 之后插入（插在 docstring 之前会变成它的返回值）===")
        i_doc = src.index("多行 docstring")
        i_ins = src.index("_init_wms_tables()")
        ok(i_ins > i_doc, "插入点在 docstring 之后", "ins=%d doc=%d" % (i_ins, i_doc))

        print("\n=== ⑤ 幂等：再跑一遍 0 改动 ===")
        before = f.read_text(encoding="utf-8")
        rc, out = run(tmp)
        ok("改动 0 处" in out, "第二次执行 0 处改动", out[-160:])
        ok(f.read_text(encoding="utf-8") == before, "文件内容未变")

        print("\n=== ⑥ 回滚逐字节复原 ===")
        rc, out = run(tmp, "--revert")
        ok(rc == 0, "回滚退出 0", out[-160:])
        ok(f.read_text(encoding="utf-8") == SAMPLE, "回滚后与原文逐字节相同")

        print("\n=== ⑦ 负向：检测有牙（删掉插入行应被重新报出）===")
        run(tmp)                                     # 重新打上
        src2 = f.read_text(encoding="utf-8").replace(
            "    _init_wms_tables()  # v706：读之前先 ensure（懒建表，否则首次访问 no such table）\n", "")
        f.write_text(src2, encoding="utf-8")
        rc, out = run(tmp)
        ok("+ pick_wave_list" in out, "删掉的那处被重新补上（不是恒绿）", out[-200:])

        # —— 真实生产副本 ——
        src_dir = Path(a.src)
        real = src_dir / "erp_db.py"
        if real.exists():
            print("\n=== ⑧ 真实生产副本：9 个目标全部就位 ===")
            txt = real.read_text(encoding="utf-8")
            miss = []
            for fn, ens in P.TARGETS.items():
                m = re.search(r"^def %s\(.*?\n(.*?)(?=\n\ndef |\Z)" % re.escape(fn), txt, re.S | re.M)
                if not m or not re.search(r"^\s*%s\(" % ens, m.group(1), re.M):
                    miss.append(fn)
            ok(not miss, "9/9 目标函数体内都有 ensure", ",".join(miss))
            rc, out = run(src_dir, "--strict")
            ok(rc == 0, "--strict 退出 0（9 个目标函数全部找到）", out[-200:])
            ok("改动 0 处" in out, "真实副本已幂等（0 处待改）", out[-160:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 74)
    print("通过 %d / 失败 %d" % (len(PASS), len(FAIL)))
    if FAIL:
        print("失败项：" + "; ".join(FAIL))
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
