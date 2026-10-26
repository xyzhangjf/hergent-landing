#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693b 修复：补上 timezone / timedelta 的 import。

第一版补丁只加了 `import math`，但新的定价模块要用 `timezone(timedelta(hours=8))`
判断峰谷，而文件原本只有 `from datetime import datetime`。

后果特别隐蔽：`_record_tokens` 是**软失败**（异常只告警、返回 False），
所以对话一切正常、界面毫无异常，**但每一笔账都写不进去** ——
`est_cost_cny` 永远是 0，积分永远不动。这比报错更危险。

教训：AST 提取函数执行时我把 timezone 注进了 namespace，
等于替真实模块把坑填了 ⇒ 单元验证全过、集成一跑就崩。
验证脚本已补「import 完整性」这一条断言。
"""
import sys
import shutil
import py_compile
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/ai_assist.py")

OLD = "from datetime import datetime\nfrom fastapi import APIRouter, Request, HTTPException\n"
NEW = "from datetime import datetime, timedelta, timezone\nfrom fastapi import APIRouter, Request, HTTPException\n"


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    src = target.read_text(encoding="utf-8")

    if NEW in src:
        print("已修（timezone 已导入），无需重复。")
        return 0
    if src.count(OLD) != 1:
        print("锚点命中 %d 次（必须 1），未做修改。" % src.count(OLD))
        return 3

    out = src.replace(OLD, NEW, 1)
    if dry:
        print("[dry-run] 将补 timezone/timedelta import")
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v693b")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)
    tmp = target.with_suffix(".v693b.tmp")
    tmp.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败：%s" % e)
        return 4
    shutil.move(str(tmp), str(target))
    print("已写入 %s" % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
