#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
后端测试统一入口（P1-2）

背景：/opt/hergent-erp/tests/ 里存在**两代**测试，混在一起跑会崩：
  ① 脚本式（16 个）：模块顶层直接跑完再 sys.exit(...)，pytest 一 import
     就会执行它们 ⇒ pytest 收集阶段 INTERNALERROR，整个套件一条都跑不了。
  ② pytest 式（6 个）：标准 test_* 函数，可被 pytest 正常收集。

本脚本用 AST 自动分类（新增文件无需改这里），分别执行并汇总：
  - pytest 式  → 一次性交给 pytest 跑
  - 脚本式     → 逐个 subprocess 跑，按退出码判定

用法：
    python3 tests/run_all_tests.py                # 跑全部
    python3 tests/run_all_tests.py --only pytest  # 只跑 pytest 式
    python3 tests/run_all_tests.py --only script  # 只跑脚本式
    python3 tests/run_all_tests.py --list         # 只列分类不执行
退出码：全部通过 0；有失败 1。
"""
import ast
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # /opt/hergent-erp


def load_env():
    """把 .env 灌进 os.environ。

    为什么必须：生产由 systemd 加载 .env，但**直接跑脚本不会** ⇒
    core.py 在 import 期就 raise "ERP_SECRET environment variable is required"，
    4 个测试因此全红 —— 那是环境差异，不是代码缺陷。
    """
    p = os.path.join(ROOT, ".env")
    if not os.path.exists(p):
        return
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)  # 已显式设置的优先


load_env()


def classify(path):
    """用 AST 判定：模块顶层是否直接调用 sys.exit(...) → 脚本式。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=path)
    except SyntaxError as e:
        return "broken:%s" % e
    for node in tree.body:
        # 顶层语句里的 Call（含 if __name__ 之类分支内部不算，只扫第一层）
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call):
                fn = sub.func
                name = ""
                if isinstance(fn, ast.Attribute):
                    name = "%s.%s" % (getattr(fn.value, "id", ""), fn.attr)
                elif isinstance(fn, ast.Name):
                    name = fn.id
                if name in ("sys.exit", "exit", "quit"):
                    return "script"
    return "pytest"


def discover():
    files = sorted(
        f for f in os.listdir(HERE)
        if f.startswith("test_") and f.endswith(".py")
        and f != os.path.basename(__file__)
    )
    groups = {"pytest": [], "script": [], "broken": []}
    for f in files:
        kind = classify(os.path.join(HERE, f))
        if kind.startswith("broken"):
            groups["broken"].append((f, kind))
        else:
            groups[kind].append(f)
    return groups


def run_pytest(files):
    if not files:
        return True, "（无 pytest 式用例）", 0, 0
    cmd = [sys.executable, "-m", "pytest", "-q", "--no-header", "-p", "no:cacheprovider"]
    cmd += files
    t0 = time.time()
    p = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=1800)
    out = (p.stdout or "") + (p.stderr or "")
    tail = "\n".join([ln for ln in out.strip().splitlines() if ln.strip()][-12:])
    return p.returncode == 0, tail, p.returncode, time.time() - t0


def run_scripts(files):
    ok_all = True
    lines = []
    nfail = 0
    for f in files:
        t0 = time.time()
        try:
            p = subprocess.run(
                [sys.executable, f], cwd=HERE, capture_output=True, text=True, timeout=900
            )
            dt = time.time() - t0
            rc = p.returncode
        except subprocess.TimeoutExpired:
            lines.append("  ⏱ TIMEOUT  %s  (>900s)" % f)
            ok_all = False
            nfail += 1
            continue
        out = (p.stdout or "") + (p.stderr or "")
        last = [ln for ln in out.strip().splitlines() if ln.strip()]
        brief = last[-1][:120] if last else "(无输出)"
        if rc == 0:
            lines.append("  ✅ %-42s %5.1fs  %s" % (f, dt, brief))
        else:
            ok_all = False
            nfail += 1
            lines.append("  ❌ %-42s %5.1fs  rc=%s  %s" % (f, dt, rc, brief))
            for ln in last[-4:]:
                lines.append("        │ " + ln[:150])
    return ok_all, "\n".join(lines), nfail


def main():
    args = sys.argv[1:]
    groups = discover()

    if "--list" in args:
        for k in ("pytest", "script", "broken"):
            print("[%s] %d" % (k, len(groups[k])))
            for f in groups[k]:
                print("   ", f if isinstance(f, str) else f[0])
        return 0

    only = None
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1] if i + 1 < len(args) else None

    print("=" * 70)
    print("Hergent 后端测试基线  (pytest式 %d / 脚本式 %d / 损坏 %d)"
          % (len(groups["pytest"]), len(groups["script"]), len(groups["broken"])))
    print("=" * 70)

    failed = 0
    if only in (None, "pytest"):
        print("\n── pytest 式 ──")
        ok, tail, rc, dt = run_pytest(groups["pytest"])
        print(tail)
        if not ok:
            failed += 1
    if only in (None, "script"):
        print("\n── 脚本式（逐个执行）──")
        ok, tail, nfail = run_scripts(groups["script"])
        print(tail)
        failed += nfail
    if groups["broken"] and only is None:
        print("\n── 语法损坏（无法解析）──")
        for f, err in groups["broken"]:
            print("  ⛔ %s  %s" % (f, err))
        failed += len(groups["broken"])

    print("\n" + "=" * 70)
    print("RESULT: %s" % ("ALL PASS" if failed == 0 else "FAILED (%d)" % failed))
    print("=" * 70)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
