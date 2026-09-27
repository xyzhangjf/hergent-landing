#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296 受控提交（**后端仓 hergent-erp**）：只提交「权限联动」的两个文件。

用法：
    python3 .workbuddy/tools/v296-perms-scoped-spec-be.py                 # 干跑
    python3 .workbuddy/tools/v296-perms-scoped-spec-be.py --commit /tmp/msg-be.txt

================================================================================
基线
================================================================================
be HEAD = 5f97d93（fix(auth): 密码长度校验口径归一 —— 界面写 4 位、后端要 8 位（v289））

================================================================================
逐文件归属
================================================================================
· server/core.py          3 hunk；我的是 **6 / 625**；
                          **508 是别人正在做的 `v293`（给 supervisor 加 `sales`）** ⇒ own_hunks
                          （那处的注释里明确写着 `v293（2026-09-27）加 sales`，且 `_DEFAULT_PERMS`
                            的 `supervisor` 行从 `["dashboard","data"]` 变成 `+ "sales"` ⇒ **不是我的**）
· server/routers/auth.py  3 hunk，**全部为本轮**（import 补两符号 / permissions 只加两键 / 新端点）⇒ keep_all

🔴 **依赖闭包（两个文件必须同批）**：auth.py 的 `import … perms_rev, custom_roles` 依赖
   core.py 新增的两个函数（HEAD 里 `def perms_rev` 出现 **0** 次）⇒ 单交 auth.py 会
   `ImportError`（`py_compile` **查不出**这种错，只有真跑才炸）。

🔴 **部署纪律**：本轮生产上的 core.py / auth.py 与**我这份工作区版本**逐字相同
   （部署前 md5 已核）；别人的 v293 改动**尚未部署** ⇒ 本次提交**绝不能**把他的 hunk 带进去，
   否则库里会出现"已提交但未验证"的默认权限变更（改 `_DEFAULT_PERMS` 影响**所有租户**）。
"""

import os
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
TOOL = os.path.join(REPO, ".workbuddy/tools/scoped_stage_by_marker.py")

SPECS = [
    {"file": "server/core.py", "own_hunks": [6, 625], "gone": [],
     "present": ["import os, hashlib, uuid, bcrypt, secrets, logging, base64, threading, json",
                 "def _canon_perms(v):",
                 "def perms_rev(tid=None):",
                 "def custom_roles(tid=None):",
                 "# ---- 权限联动：版本号 + 「真实改过」的角色（v296，2026-09-27）"],
     "dropped": ["v293（2026-09-27）加 `sales`",
                 '"supervisor": ["dashboard", "data", "sales"],']},

    {"file": "server/routers/auth.py", "keep_all": True, "gone": [],
     "present": ["effective_tenant_key, tenant_plan, perms_rev, custom_roles)",
                 '"perms_rev": perms_rev(tid),',
                 '@router.get("/perms-rev")',
                 'return {"perms_rev": perms_rev(tid), "tenant_id": tid or 0}']},
]


def main():
    src = open(TOOL, encoding="utf-8").read()
    tail = "main()"
    if not src.rstrip().endswith(tail):
        raise SystemExit("工具尾部不再是裸 main()，先读一遍再改这里")
    src = src.rstrip()[: -len(tail)] + "\n"

    old_outp = 'outp = "/tmp/staged_" + os.path.basename(path)'
    assert src.count(old_outp) == 1, "工具的文件命名行变了"
    src = src.replace(old_outp, 'outp = "/tmp/v296-staged-be/" + path.replace("/", "__")')
    old_prn = 'print("   /tmp/staged_" + os.path.basename(p))'
    assert src.count(old_prn) == 1, "工具的打印行变了"
    src = src.replace(old_prn, 'print("   /tmp/v296-staged-be/" + p.replace("/", "__"))')
    os.makedirs("/tmp/v296-staged-be", exist_ok=True)

    mod = {"__name__": "ssm_v296be", "__file__": TOOL}
    exec(compile(src, TOOL, "exec"), mod)

    mod["SPECS"]["be-v296"] = ("be", SPECS)
    sys.argv = ["v296-perms-scoped-spec-be"] + ["be-v296"] + sys.argv[1:]
    mod["main"]()


if __name__ == "__main__":
    main()
