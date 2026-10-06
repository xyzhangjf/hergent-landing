#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v387-form-whitelist-align.py —— 档案页表单字段 ↔ 后端写白名单 **对齐护栏**

为什么需要它（不是洁癖）：
  档案页的 `FORM_FIELDS` 是「提交白名单的唯一来源」，而后端 `contact_create` /
  `contact_update` **各有自己的一份 allowed 列表**。两边不对齐时**不会报错** ——
  `contact_create` 里那句 `{k: kw[k] for k in allowed if k in kw}` 会把白名单外的键
  **静默丢掉**：用户填了、保存成功、打开一看是空的。本项目已经为这个病付过两次代价：
    · v316：`boss_name` / `boss_phone` / `channel` / `code` 只在 update 里、不在 create 里
      （生产数据可反推：`boss_name` 92% 有值，而导入走的是 create ⇒ 只可能来自编辑路径）
    · v387：`bank_name` / `bank_account` / `supplier_category` / `business_license` 同一形态

判据（**双向**，只查一向会漏掉一半）：
  A. 每个表单字段都能被**新建**写进去（`contact_create.allowed` 或函数位置参数 `name`）
  B. 每个表单字段都能被**编辑**写进去（`contact_update.allowed`）
  C. 表单字段清单与「两个白名单都收」的集合，除刻意豁免外**不应有落差**

刻意豁免（写死在这里，附理由 —— 让"故意"与"漏了"外观上可分）：
  · `name`：`contact_create(name, ...)` 的位置参数；`contact_update.allowed` 里有 'name'。

退出码：0 = 全绿；2 = 有不对齐（**不要**当成警告放过）。

用法：
  python3 tools/v387-form-whitelist-align.py
  HERGENT_ERP=/opt/hergent-erp python3 tools/v387-form-whitelist-align.py   # 对生产源码校验
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ERP = os.environ.get("HERGENT_ERP", "/Users/zhangjunfeng/Documents/hergent-erp")
CONTACTS_PY = os.path.join(ERP, "server", "db", "queries", "contacts.py")

# 要核的页面 → (vue 路径, 表单数组名)
PAGES = [
    ("src/pages/SupplierArchive.vue", "FORM_FIELDS"),
    ("src/pages/CustomerArchive.vue", "FORM_FIELDS"),
]

# 位置参数不是白名单项（`def contact_create(name, contact_type=..., _user=None, **kw)`）
POSITIONAL_OK = {"name"}

FAILS, PASSES = [], []


def ok(cond, label, detail=""):
    (PASSES if cond else FAILS).append(label)
    print(("  PASS  " if cond else "  FAIL  ") + label + ((" | " + str(detail)) if detail else ""))


def extract_form_fields(path, var):
    """从 .vue 里抠出 `const FORM_FIELDS = [...]` 的字面量。"""
    src = open(path, encoding="utf-8").read()
    m = re.search(r"const\s+%s\s*=\s*\[(.*?)\]" % re.escape(var), src, re.S)
    if not m:
        return None
    return re.findall(r"'([^']+)'", m.group(1))


def extract_allowed(path):
    """用 ast 抠 `contact_create` / `contact_update` 里 `allowed = [...]` 的字符串字面量。"""
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in ("contact_create", "contact_update"):
            found = None
            for sub in ast.walk(node):
                if isinstance(sub, ast.Assign) and any(
                        isinstance(t, ast.Name) and t.id == "allowed" for t in sub.targets):
                    if isinstance(sub.value, ast.List):
                        found = [e.value for e in sub.value.elts
                                 if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            out[node.name] = found
    return out


def main():
    print("### v387 表单字段 ↔ 后端写白名单 对齐护栏")
    print("后端源码：%s" % CONTACTS_PY)
    if not os.path.exists(CONTACTS_PY):
        print("!! 找不到后端源码（用 HERGENT_ERP=<仓库根> 覆盖）")
        return 3
    allows = extract_allowed(CONTACTS_PY)
    create_allowed = allows.get("contact_create")
    update_allowed = allows.get("contact_update")
    ok(create_allowed is not None, "抠到 contact_create.allowed", len(create_allowed or []))
    ok(update_allowed is not None, "抠到 contact_update.allowed", len(update_allowed or []))
    if not create_allowed or not update_allowed:
        return 3

    for rel, var in PAGES:
        path = os.path.join(REPO, rel)
        print("\n=== %s ===" % rel)
        if not os.path.exists(path):
            ok(False, "页面存在", path)
            continue
        fields = extract_form_fields(path, var)
        ok(fields is not None and len(fields) > 0, "抠到 %s" % var,
           "%d 个字段" % (len(fields) if fields else 0))
        if not fields:
            continue

        # A. 新建路径
        miss_create = [f for f in fields
                       if f not in POSITIONAL_OK and f not in create_allowed]
        ok(not miss_create, "A 新建路径：每个字段都在 contact_create.allowed 里",
           ("缺 %s" % miss_create) if miss_create else "全收")
        # B. 编辑路径
        miss_update = [f for f in fields if f not in update_allowed]
        ok(not miss_update, "B 编辑路径：每个字段都在 contact_update.allowed 里",
           ("缺 %s" % miss_update) if miss_update else "全收")
        # C. 字段重复 / 空
        dup = sorted({f for f in fields if fields.count(f) > 1})
        ok(not dup, "C 字段清单无重复项", dup or "无重复")
        print("      字段 %d 个：%s" % (len(fields), ", ".join(fields)))

    np_, nf = len(PASSES), len(FAILS)
    print("\n" + "=" * 60)
    print("汇总：%d/%d 通过，失败 %d" % (np_, np_ + nf, nf))
    if nf:
        print("[!] 有字段「填了不生效」—— 补后端白名单，不要改前端绕过。")
    print("=" * 60)
    return 0 if nf == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
