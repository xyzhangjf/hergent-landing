#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验 `scoped_stage_by_marker.py` 产出的**暂存产物**（`/tmp/staged_*`）能不能跑。

为什么必须有它（skill hergent-scoped-commit §5.26）：
  到提交为止磁盘上有**三份**不同的代码 ——
    ① 工作区（真机/影子库验过的那份，已上线）；
    ② HEAD（上一个提交的人验过）；
    ③ 🔴 **暂存产物** = HEAD + 我只认领的那些 hunk —— **没有任何人验过**。
  归属自证的五个断言（旧侧逐字、残留数、零夹带、gone、keep_all）全是「归属」证明，
  没有一条检查「这个拼出来的文件能不能跑」。当某文件只落一部分 hunk 时，
  拼出来的是**历史上从未存在过的字节**，完全可能语法/符号不自洽。

本工具做两件事：
  ① `py_compile` 语法（弱判据 —— 只证明能解析）；
  ② 🔴 **AST 模块级断言 + 名字解析检查**（强判据）：
     · 期望的顶层 def 必须真的在**模块级**（防「整块被多缩进一层、嵌进上一个函数体」——
       那种情况 py_compile 照过、运行期才 AttributeError/NameError）；
     · **本轮新引用的名字必须在暂存版里可解析**（模块级 import / 顶层 def / 局部 import），
       否则就是 §5.11 的「引用了在途才有的符号」漏了依赖闭包。

用法：
  python3 staged_check.py <暂存文件> "顶层def1,顶层def2" "需要的名字1,需要的名字2"
  # 例：python3 staged_check.py /tmp/staged_x.py "def_a,def_b" "fr,_user_label,JSONResponse"
"""
import ast
import py_compile
import sys


def main():
    path = sys.argv[1]
    want_defs = [s for s in (sys.argv[2].split(",") if len(sys.argv) > 2 else []) if s.strip()]
    want_names = [s for s in (sys.argv[3].split(",") if len(sys.argv) > 3 else []) if s.strip()]

    print("── %s" % path)

    # ① 语法
    try:
        py_compile.compile(path, doraise=True, cfile="/tmp/_staged_check.pyc")
        print("   ok  py_compile 通过")
    except py_compile.PyCompileError as e:
        print("   ❌ py_compile 失败：%s" % e)
        return 1

    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)

    # ② 顶层 def 必须真的在模块级
    top_defs = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    missing = [d for d in want_defs if d not in top_defs]
    assert not missing, "不是模块级（被误缩进了？）：%s" % missing
    print("   ok  顶层 def %d 个全在模块级：%s" % (len(want_defs), want_defs))

    # ③ 名字可解析性
    #    收集「模块级可见」的名字：顶层 import / 顶层 def / 顶层赋值
    avail = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                avail.add((a.asname or a.name).split(".")[0])
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            avail.add(n.name)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    avail.add(t.id)
    #    局部 import（函数体内 `from x import y`）也算可用
    local_imports = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)) and isinstance(n, ast.ImportFrom):
            for a in n.names:
                local_imports.add((a.asname or a.name).split(".")[0])

    bad = [x for x in want_names if x not in avail and x not in local_imports]
    assert not bad, "暂存版里解析不到这些名字（依赖闭包漏了？）：%s" % bad
    print("   ok  需要的名字全部可解析：%s" % want_names)
    return 0


if __name__ == "__main__":
    sys.exit(main())
