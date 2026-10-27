#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`_safe_migrate` 冻结基线的离线验证（**不连生产**）。

四组判据：
  ① 与基线一致 ⇒ 退出 0
  ② 改动历史迁移的 SQL（名字不变）⇒ 退出 2，且指出是哪条
  ③ 新增一条裸 DDL ⇒ 退出 2
  ④ 删掉一条历史迁移 ⇒ 退出 0（只提示，不算错：已跑过的库不受影响）

用法：python3 test_safe_migrate_guard.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE / "inventory_safe_migrate.py"
PASS, FAIL = [], []


def ok(cond, label, extra=""):
    (PASS if cond else FAIL).append(label)
    print(("✅ " if cond else "❌ ") + label + (("  ← " + str(extra)) if extra else ""))


SRC = '''def _safe_migrate(name, sql):
    pass


def boot():
    _safe_migrate("v1_products_origin", "ALTER TABLE products ADD COLUMN origin TEXT DEFAULT ''")
    _safe_migrate_script("v2_index", "CREATE INDEX IF NOT EXISTS ix_p ON products(name);")


def late():
    _safe_migrate("v3_contacts_level", "ALTER TABLE contacts ADD COLUMN level TEXT DEFAULT ''")
'''


def run(root, *args):
    r = subprocess.run([sys.executable, str(TOOL), str(root)] + list(args),
                       capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def main():
    tmp = Path(tempfile.mkdtemp(prefix="v706-guard-"))
    src = tmp / "src"
    src.mkdir()
    (src / "erp_db.py").write_text(SRC, encoding="utf-8")
    base = tmp / "baseline.txt"

    print("\n=== ① 写入基线后自检 ===")
    rc, out = run(src, "--write-baseline", "--baseline", str(base))
    ok(rc == 0 and base.exists(), "基线已生成", out[-200:])
    entries = [l for l in base.read_text(encoding="utf-8").split("\n")
               if l.strip() and not l.strip().startswith("#")]
    ok(len(entries) == 3, "基线含 3 条迁移条目（不含注释头）", len(entries))
    rc, out = run(src, "--check", "--baseline", str(base))
    ok(rc == 0 and "与基线一致" in out, "一致时退出 0", out[-200:])
    ok("3 条历史迁移" in out, "报告条数正确（3）", out[-200:])

    print("\n=== ② 改历史迁移的 SQL（名字不变）===")
    p = src / "erp_db.py"
    s = p.read_text(encoding="utf-8")
    p.write_text(s.replace("ADD COLUMN origin TEXT DEFAULT ''",
                           "ADD COLUMN origin TEXT DEFAULT 'milk'"), encoding="utf-8")
    rc, out = run(src, "--check", "--baseline", str(base))
    ok(rc == 2, "退出 2", rc)
    ok("v1_products_origin" in out, "点名是哪条被改", out[-300:])
    ok("永远不会" in out, "说明后果（已跑过的库拿不到新逻辑）", out[-300:])

    print("\n=== ③ 新增一条裸 DDL ===")
    p.write_text(SRC + '\n_safe_migrate("v9_sneaky", "ALTER TABLE products ADD COLUMN x TEXT")\n',
                 encoding="utf-8")
    rc, out = run(src, "--check", "--baseline", str(base))
    ok(rc == 2, "退出 2", rc)
    ok("v9_sneaky" in out and "必须改写成" in out, "点名并要求写成 patch", out[-300:])

    print("\n=== ④ 删掉一条历史迁移（仅提示）===")
    # 用 `pass` 占位而不是留空函数体：后者会造出语法错误，测的就不是"删迁移"了
    p.write_text(SRC.replace(
        '    _safe_migrate("v3_contacts_level", "ALTER TABLE contacts ADD COLUMN level TEXT DEFAULT \'\'")\n',
        "    pass\n"), encoding="utf-8")
    rc, out = run(src, "--check", "--baseline", str(base))
    ok(rc == 0, "退出 0（删历史迁移不影响已跑过的库）", rc)
    ok("已不存在" in out, "如实提示基线里有、源码里没了", out[-300:])

    print("\n=== ⑤ 源码语法坏掉 ⇒ 报解析失败（不许把检查器自己搞崩）===")
    p.write_text(SRC + "\ndef broken(:\n", encoding="utf-8")
    rc, out = run(src, "--check", "--baseline", str(base))
    ok(rc == 2, "退出 2", rc)
    ok("解析失败" in out, "报「解析失败」而不是抛异常", out[-200:])
    ok("Traceback" not in out, "没有崩栈（崩栈在 CI 里会被误读成工具坏了）", out[-200:])

    print("\n" + "=" * 60)
    print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
    if FAIL:
        print("失败：")
        for f in FAIL:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
