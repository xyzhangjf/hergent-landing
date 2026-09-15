#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v171 scoped 提交（后端 hergent-erp）：把「达成填报 · 修改日志」的 hunk 单独钉进历史。

三个文件：
  · server/db/queries/entity_logs.py        —— 全部 9 个 hunk 都是本轮（直接可 add）
  · server/routers/rebate_achievements.py   —— 全部 16 个 hunk 都是本轮（直接可 add）
  · server/erp_db.py                        —— 混合：本轮 3 个（58/1444/1445），在途 11 个
故前两个文件顺带当「applier 自证」：由 HEAD 切片重建的结果必须与工作区**逐字节相同**。
"""
import subprocess, sys, re, os, ast, py_compile

REPO = "/Users/zhangjunfeng/Documents/hergent-erp"
ALL_MINE = ["server/db/queries/entity_logs.py", "server/routers/rebate_achievements.py"]
MIXED = "server/erp_db.py"
MINE_MIXED = {58, 1444, 1445}
DEFER_MIXED = {1398, 10889, 10904, 11321, 11324, 15953, 15984, 15986, 16000, 16002, 16005}
OUTDIR = "/tmp/be171"

# 期望为「模块级」的名字 —— py_compile 只证明能解析，证明不了没被误缩进（技能 §5.5 🔴🔴）
EXPECT_TOP = {
    "server/db/queries/entity_logs.py":
        {"_ensure_entity_logs_table", "log_entity_changes", "get_entity_changes",
         "get_entity_changes_by_type"},
    "server/routers/rebate_achievements.py":
        {"_who", "_achv_ref", "_num_txt", "_val_txt", "_field_changes",
         "_cleared_changes", "_log_achv_change", "upsert_achievement",
         "delete_achievement", "import_achievements", "list_achievement_audit"},
    "server/erp_db.py": {"init_db", "log_entity_changes", "get_entity_changes_by_type"},
}
# 在途标识（期望「暂存 == HEAD」，不能写 ==0：HEAD 本来就有的会必然误报 —— 技能 §8）
INFLIGHT = {
    "server/erp_db.py": ["login_is_locked", "forecast_submission_summary",
                         "extra_json TEXT DEFAULT ''"],
    "server/routers/rebate_achievements.py": [],
    "server/db/queries/entity_logs.py": [],
}
MINE_SYMS = {
    "server/db/queries/entity_logs.py": ["get_entity_changes_by_type", "idx_ecl_type",
                                         "log_migration_warn"],
    "server/routers/rebate_achievements.py": ["_log_achv_change", "list_achievement_audit",
                                              "ACHV_ENTITY" if True else "", "audit"],
    "server/erp_db.py": ["idx_ecl_type", "get_entity_changes_by_type"],
}


def git(*a, **kw):
    return subprocess.run(["git", "-C", REPO] + list(a), capture_output=True,
                          text=True, check=True, **kw).stdout


def parse_hunks(f):
    diff = git("diff", "-U0", "--", f)
    hunks, cur = [], None
    for ln in diff.splitlines(keepends=True):
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "minus": [], "plus": []}
            hunks.append(cur)
        elif cur is not None:
            if ln.startswith("+"):
                cur["plus"].append(ln[1:])
            elif ln.startswith("-"):
                cur["minus"].append(ln[1:])
    return hunks


def construct(f, keep):
    """从 HEAD 出发按 old_start 切片施加 keep 里的 hunk；返回 (结果文本, 全部hunk数, 保留数)"""
    hunks = parse_hunks(f)
    got = sorted(h["os"] for h in hunks)
    if keep is None:
        keep = set(got)
    assert set(got) | keep == set(got), ("白名单里有不存在的 hunk", keep - set(got))
    lines = git("show", "HEAD:" + f).splitlines(keepends=True)
    ops = sorted([h for h in hunks if h["os"] in keep], key=lambda h: -h["os"])
    for h in ops:
        os_, oc = h["os"], h["oc"]
        if oc == 0:
            assert h["minus"] == [], "纯插入 hunk 不该有 - 行"
            lines[os_:os_] = h["plus"]
        else:
            seg = lines[os_ - 1: os_ - 1 + oc]
            assert seg == h["minus"], ("old_start=%d 旧侧不匹配" % os_, seg[:3], h["minus"][:3])
            lines[os_ - 1: os_ - 1 + oc] = h["plus"]
    return "".join(lines), len(hunks), len(ops)


def top_level_names(src):
    tree = ast.parse(src)
    names = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Import):
            names |= {a.asname or a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            names |= {a.asname or a.name for a in n.names}
        elif isinstance(n, (ast.Assign, ast.AnnAssign)):
            tg = n.targets if isinstance(n, ast.Assign) else [n.target]
            for t in tg:
                if isinstance(t, ast.Name):
                    names.add(t.id)
    return names


def main():
    commit_msg = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--commit" else None
    os.makedirs(OUTDIR, exist_ok=True)
    result, verify = {}, []

    # ① 前两个文件：全 hunk 归本轮 → 构造结果必须 == 工作区（applier 的免费自证）
    for f in ALL_MINE:
        out, n, k = construct(f, None)
        wt = open(os.path.join(REPO, f), encoding="utf-8").read()
        assert out == wt, "%s: 构造结果 != 工作区（切片法有误）" % f
        residual = subprocess.run(
            ["git", "-C", REPO, "diff", "-U0", "--no-index", "--",
             os.path.join(OUTDIR, os.path.basename(f)), os.path.join(REPO, f)],
            capture_output=True, text=True).stdout
        assert len(re.findall(r"(?m)^@@", residual)) == 0, "%s: 自证后有残留" % f
        result[f] = out
        verify.append((f, n, k, "全 hunk 归本轮 · 构造 == 工作区 ✓"))

    # ② 混合文件：只保留本轮 3 个 hunk
    out, n, k = construct(MIXED, MINE_MIXED)
    wt = open(os.path.join(REPO, MIXED), encoding="utf-8").read()
    assert out != wt, "混合文件暂存版 == 工作区 —— 在途被整包带入"
    result[MIXED] = out
    verify.append((MIXED, n, k, "混合 · 保留 %d / 在途 %d" % (k, n - k)))

    # ③ 落盘 + 语法 + AST 模块级 + 残留 hunk 数 + 标识计数
    print("=" * 74)
    for f, n, k, note in verify:
        p = os.path.join(OUTDIR, os.path.basename(f))
        open(p, "w", encoding="utf-8").write(result[f])
        print("%-46s hunk %2d 保留 %2d  %s" % (f.split("/")[-1], n, k, note))

    print("\n-- 语法 + AST 模块级 --")
    for f in result:
        p = os.path.join(OUTDIR, os.path.basename(f))
        py_compile.compile(p, doraise=True)
        top = top_level_names(result[f])
        missing = EXPECT_TOP[f] - top
        assert not missing, "%s: 不是模块级（被误缩进了？）: %s" % (f, missing)
        print("  ok %-40s py_compile ✓ 模块级 ✓" % f.split("/")[-1])

    print("\n-- 残留 hunk 数（期望 == 在途数）--")
    resid = subprocess.run(
        ["git", "-C", REPO, "diff", "-U0", "--no-index", "--",
         os.path.join(OUTDIR, os.path.basename(MIXED)), os.path.join(REPO, MIXED)],
        capture_output=True, text=True).stdout
    n_resid = len(re.findall(r"(?m)^@@", resid))
    n_defer = len(parse_hunks(MIXED)) - len(MINE_MIXED)
    print("  erp_db.py 残留 = %d | 在途 = %d" % (n_resid, n_defer))
    assert n_resid == n_defer, "残留 hunk 数与在途数不等，归属有误"

    print("\n-- 标识计数（本轮：暂存 == 工作区；在途：暂存 == HEAD）--")
    bad = 0
    for f in result:
        wt = open(os.path.join(REPO, f), encoding="utf-8").read()
        head = git("show", "HEAD:" + f)
        for s in MINE_SYMS.get(f, []):
            if not s:
                continue
            a, b = result[f].count(s), wt.count(s)
            if not (a == b and a >= head.count(s)):
                bad += 1
                print("  BAD mine  %s %s 暂存=%d 工作区=%d HEAD=%d" % (f, s, a, b, head.count(s)))
        for s in INFLIGHT.get(f, []):
            a, c = result[f].count(s), head.count(s)
            if a != c:
                bad += 1
                print("  BAD 在途  %s %s 暂存=%d HEAD=%d" % (f, s, a, c))
    assert bad == 0, "标识计数不符"
    print("  ok 全部相符")
    print("\n自证通过 ✓ 暂存版已写 %s" % OUTDIR)

    if commit_msg:
        # 🔴 落索引 + 断言 + 提交，同一次进程内完成（索引会被并行会话整个重置）
        for f in result:
            git("reset", "-q", "HEAD", "--", f)
            blob = subprocess.run(["git", "-C", REPO, "hash-object", "-w", "--stdin"],
                                  input=result[f], text=True, capture_output=True,
                                  check=True).stdout.strip()
            subprocess.run(["git", "-C", REPO, "update-index", "--add", "--cacheinfo",
                            "100644,%s,%s" % (blob, f)], check=True)
        names = [x for x in git("-c", "core.quotepath=false", "diff",
                                "--cached", "--name-only").split("\n") if x.strip()]
        print("\n索引内容 =", names)
        assert sorted(names) == sorted(result.keys()), \
            "索引不干净（可能混入并行会话预暂存的文件），放弃提交：%s" % names
        print(git("diff", "--cached", "--stat"))
        print(git("commit", "-F", commit_msg))
        print("提交后：", git("log", "--oneline", "-1"))


main()
