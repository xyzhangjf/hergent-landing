#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v335 生效条件核验（只读）：租户库里各角色的权限值到底是「旧格式 list」还是「新格式 dict」。

判据（后端 core.normalize_perms_shape 第 1385 行）：
  · list  ⇒ 该模块拿到**全部动作**（create/update/delete/read 全开）
  · dict  ⇒ 按动作细配（{模块: [动作…]}）

⇒ 若某角色的模块仍是 list，则 v335 的按钮级门禁**对它不会隐藏任何按钮**
   （这是设计：默认全权），只有管理员在「设置 › 权限」里收窄动作后才会跟手。
   本脚本就是把这件事从"推测"变成"读数"。

只读：`mode=ro`（活库禁用 immutable —— 见本机坑 §11）。
"""
import json
import sqlite3
import sys

DB_DIR = "/opt/hergent-erp"
DBS = ["erp.db", "tenant_1.db", "tenant_10.db"]


def shape(v):
    if isinstance(v, dict):
        return "dict"
    if isinstance(v, list):
        return "list"
    return type(v).__name__


def main():
    for f in DBS:
        path = "%s/%s" % (DB_DIR, f)
        try:
            con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        except Exception as e:
            print("== %s 打不开：%s" % (f, e))
            continue
        try:
            rows = con.execute(
                "SELECT role_name, permissions FROM role_permissions ORDER BY role_name"
            ).fetchall()
        except Exception as e:
            print("== %s 无 role_permissions 表或读取失败：%s" % (f, e))
            con.close()
            continue
        print("===== %s  行数 %d" % (f, len(rows)))
        list_roles, dict_roles = [], []
        for role, p in rows:
            try:
                v = json.loads(p)
            except Exception:
                v = p
            s = shape(v)
            if s == "dict":
                dict_roles.append(role)
            elif s == "list":
                list_roles.append(role)
            if s == "dict":
                # 只看动作维度：列出「只给部分动作」的模块（这些才是门禁真正会隐藏按钮的地方）
                partial = {m: a for m, a in v.items() if isinstance(a, list) and "*" not in a}
                narrow = {m: a for m, a in partial.items()
                          if not set(a) >= {"read", "create", "update", "delete"}}
                print("  %-12s dict  模块 %2d 个；动作被收窄的模块：%s"
                      % (role, len(v), narrow if narrow else "无（全动作）"))
            else:
                print("  %-12s %-5s 模块 %2d 个：%s"
                      % (role, s, len(v) if hasattr(v, "__len__") else -1,
                         list(v)[:8] if isinstance(v, list) else v))
        print("  —— 旧格式(list ⇒ 全动作)：%s" % (list_roles or "无"))
        print("  —— 新格式(dict)：%s" % (dict_roles or "无"))
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
