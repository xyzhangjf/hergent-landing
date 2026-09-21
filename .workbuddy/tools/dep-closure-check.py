#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""依赖闭包检查：**受控提交的产物里，有没有引用「只在别人的在途代码里存在」的东西**。

## 为什么需要它（v224 实测，2026-09-21）

`scoped_stage_by_marker.py` 的 `present` 只证明「我该有的在」、
`gone` 只证明「该没有的且工作区也没有」、在途抽样只从**别的** hunk 取样本
（`pick_inflight_sample` 明确排除了我 hunk 里出现过的行）。
⇒ 当我把别人的一段代码从**我认领的 hunk 里挖掉**（`drop_plus_lines` / `trim_*`）时，
「有没有**少挖一行**」这件事原本**一条断言都不覆盖**。

本轮的真实形态：`routers/forecast_submissions.py` 的 `"created": created, **result}`
与 v215 的 `"skipped_out_of_scope": dropped_out_of_scope,` 属**同一次行改写**（同一个 hunk）。
若少挖那两行：

  · `dropped_out_of_scope` 的**赋值**在另外三个 hunk 里（工作区第 278/344/366 行），本轮不提交；
  · 提交后的 `routers/forecast_submissions.py` 里出现一个**读**、而模块内**没有任何赋值**
  · ⇒ `POST /api/forecast-submissions`（小程序建单）与 `save-matrix`（Web 保存汇总）
     在**运行时**直接 `NameError` → 500。而 `python -m py_compile` **不会报**（语法合法）、
     `import` 也不会报（函数体没执行）⇒ 是一类**编译得过、启动得过、一用就炸**的缺陷。

## 判据（三层，任一非空即失败）

① **未解析的全局引用**（作用域感知，**减基线**）：对每个函数，收集其**绑定名**
   （赋值 / for / with / except / 形参 / 嵌套 def / 推导式 / walrus），
   再看它**读取**的每个 Name 是否落在「本函数局部 ∪ 模块级绑定 ∪ 内置」里。
   不在 ⇒ 打印。这是最直接的「少挖一行」探测器。
   ⚠️ **必须给 `--head`**：HEAD 里就有的那几处（解释器 dunder `__file__`、
     以及既存真实隐患 `erp_db.py::period_close_checklist` 里的 `get_config`）要与
     「本轮新引入的」相减 —— 否则任何一次提交都恒红，护栏会被当噪音绕过去。
     （`get_config` 已核实：`erp_db.py` 内既无 `def` 也无 `import`，属**既存**缺陷，
      不在受控提交的判断范围，但值得单独上报。）
② **只在在途侧存在的绑定名**：`bound(wt) - bound(staged)`，再与 staged 的**读取**名求交。
   即「我提交的文件读了、而工作区多出来的那份定义恰好提供它」。
   （与①互为冗余：①抓「谁都没定义」，②抓「只有我没提交的那部分定义」。）
③ **新增依赖**：staged 读取名 − HEAD 读取名 ⇒ 列出来供人眼过一遍（不算失败，只提示）。

## 用法

    dep-closure-check.py --staged /tmp/staged_x.py --wt <工作区同路径> [--head <HEAD 版内容文件>]

  · `--head` 可选：给了就额外做判据③（`git show HEAD:<path> > /tmp/head_x.py`）。
  · 退出码：判据①②有命中 ⇒ 1；否则 0。

## 反证自测（必须做，否则你不知道这工具是活的）

    # 故意构造一个"少挖一行"的暂存版，检查器必须报出来
    sed 's/^\( *\)"skipped_no_factory": dropped_no_fp,$/\1"skipped_no_factory": dropped_no_fp,\n\1"skipped_out_of_scope": dropped_out_of_scope,/' \
        /tmp/staged_forecast_submissions.py > /tmp/bad_staged.py
    dep-closure-check.py --staged /tmp/bad_staged.py --wt <工作区同路径>   # → 必须 exit 1 且点名 dropped_out_of_scope
"""
import argparse
import ast
import builtins
import sys

BUILTINS = set(dir(builtins))


def _bound_names(node, into):
    """收集 `node` 子树里所有**绑定（被赋值/被引入）**的名字。"""
    for n in ast.walk(node):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            into.add(n.name)
            for a in list(n.args.args) + list(n.args.posonlyargs) + list(n.args.kwonlyargs):
                into.add(a.arg)
            if n.args.vararg:
                into.add(n.args.vararg.arg)
            if n.args.kwarg:
                into.add(n.args.kwarg.arg)
        elif isinstance(n, ast.ClassDef):
            # 🔴 v229 修：`ClassDef` **没有** `.args` —— 旧写法把三类混在一个 isinstance 里，
            #   遇到任何 `class X(...)`（如 crm.py 的 `class CustPriceCreate(_Base)`）即
            #   `AttributeError: 'ClassDef' object has no attribute 'args'` 直接崩，
            #   整个文件跑不出结论（看起来像"这个文件没通过"，其实是工具自己坏了）。
            #   类只需绑定类名；类内方法的形参由上面那个 FunctionDef 分支各自处理。
            into.add(n.name)
        elif isinstance(n, ast.Lambda):
            for a in list(n.args.args) + list(n.args.posonlyargs) + list(n.args.kwonlyargs):
                into.add(a.arg)
            if n.args.vararg:
                into.add(n.args.vararg.arg)
            if n.args.kwarg:
                into.add(n.args.kwarg.arg)
        elif isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            into.add(n.id)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for al in n.names:
                into.add((al.asname or al.name).split(".")[0])
        elif isinstance(n, ast.ExceptHandler) and n.name:
            into.add(n.name)
        elif isinstance(n, ast.Global):
            into.update(n.names)
        elif isinstance(n, ast.Nonlocal):
            into.update(n.names)
    return into


def module_bound(tree):
    s = set()
    _bound_names(tree, s)
    return s


def module_reads(tree):
    s = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
            s.add(n.id)
        elif isinstance(n, ast.Attribute):
            pass
    return s


def unresolved(tree):
    """判据①：每个函数内「读了但没人定义」的名字。"""
    g = module_bound(tree)
    out = []
    for fn in [n for n in ast.walk(tree)
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        local = set()
        _bound_names(fn, local)
        reads = set()
        for n in ast.walk(fn):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
                reads.add(n.id)
        for nm in sorted(reads - local - g - BUILTINS):
            out.append(("function", fn.name, nm))
    # 模块级（顶层）读取：只算真正在顶层的语句
    top_reads = set()
    for st in tree.body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        for n in ast.walk(st):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
                top_reads.add(n.id)
    for nm in sorted(top_reads - g - BUILTINS):
        out.append(("module", "<top>", nm))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--staged", required=True)
    ap.add_argument("--wt", required=True)
    ap.add_argument("--head")
    ap.add_argument("--label", default="")
    a = ap.parse_args()

    src_staged = open(a.staged, encoding="utf-8").read()
    src_wt = open(a.wt, encoding="utf-8").read()
    t_staged = ast.parse(src_staged)
    t_wt = ast.parse(src_wt)

    bad = 0
    print("=" * 74)
    print("依赖闭包检查 %s" % (a.label or a.staged))
    print("  暂存 %s（%d 行）| 工作区 %s（%d 行）"
          % (a.staged, src_staged.count("\n"), a.wt, src_wt.count("\n")))

    # 判据① —— **只对本轮新引入的**未解析引用判失败。
    # 🔴 为什么要减基线：`erp_db.py` 在 HEAD 上就已有 3 处（2 处 `__file__` =
    #    解释器提供的模块 dunder、1 处 `get_config` = 既存真实隐患，见下方 §已知基线），
    #    若把「绝对值非空」当失败，任何一次提交都会红 ⇒ 护栏会被当成噪音绕过去。
    #    判据必须挑**有区分度**的（同 scoped_stage_by_marker 里 trim 计数那条的取舍）。
    un = unresolved(t_staged)
    base_un = set()
    if a.head:
        base_un = set(unresolved(ast.parse(open(a.head, encoding="utf-8").read())))
    new_un = [u for u in un if u not in base_un]
    if new_un:
        bad += 1
        print("  BAD ① 本轮**新引入**的未解析引用 %d 处 —— 运行时必 NameError：" % len(new_un))
        for kind, where, nm in new_un:
            print("        [%s %s] %s" % (kind, where, nm))
    else:
        print("  ok  ① 无「本轮新引入」的未解析引用（基线已有 %d 处，与本次提交无关）"
              % len(un))

    # 判据②
    inflight_defs = module_bound(t_wt) - module_bound(t_staged)
    leak = sorted(inflight_defs & module_reads(t_staged))
    if leak:
        bad += 1
        print("  BAD ② 读了只在在途侧存在的定义 %d 个 —— 本轮不提交它们：" % len(leak))
        for nm in leak:
            print("        %s" % nm)
    else:
        print("  ok  ② 未读取任何「只在在途侧定义」的名字（在途侧多出 %d 个绑定）"
              % len(inflight_defs))

    # 判据③（仅提示）
    if a.head:
        src_head = open(a.head, encoding="utf-8").read()
        new = sorted(module_reads(t_staged) - module_reads(ast.parse(src_head)))
        print("  提示 ③ 相对 HEAD 新增的读取名 %d 个（人眼过一遍即可）：" % len(new))
        for nm in new:
            print("        %s" % nm)

    print("  结论：%s" % ("FAIL" if bad else "PASS"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
