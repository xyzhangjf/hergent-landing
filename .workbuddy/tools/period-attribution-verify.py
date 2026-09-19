# -*- coding: utf-8 -*-
"""期次归属三改动 · 验证脚本（2026-09-15）

三处改动：
  ① 报单幂等键 (user_id, store_id, order_date) → (+ period_id)，双口径兼容历史 period_id=0
  ② save-matrix 期次解析：显式 period_id 优先 → 含今天的 open 期次 → 同窗口 open → 含今天不限状态
  ③ 首页「本期待报 TOP3」/ 催单「已报·汇总」由纯 order_date 区间 → 双口径

用法：
  python3 period-attribution-verify.py local   # 内存库，验 ①②的语义（零风险，可本地跑）
  python3 period-attribution-verify.py prod    # 只读对比真实租户库的新旧归属口径差异
"""
import sqlite3, sys, glob, os


def mem_conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE forecast_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT,"
              " user_id INT, store_id INT, order_date TEXT, period_id INT,"
              " total_qty INT DEFAULT 0, role TEXT DEFAULT 'staff')")
    c.execute("CREATE TABLE forecast_periods (id INTEGER PRIMARY KEY,"
              " name TEXT, order_start TEXT, order_end TEXT, status TEXT)")
    return c


# 旧口径 / 新口径的判重 SQL（与 forecast_submissions.py 中一致）
SUB_OLD = ("SELECT id FROM forecast_submissions "
           "WHERE user_id=? AND store_id=? AND order_date=?")
SUB_NEW = ("SELECT id FROM forecast_submissions "
           "WHERE user_id=? AND store_id=? AND (period_id=? OR (period_id=0 AND order_date=?))")

# 双口径归属表达式（与 scheduler.py / datasource_adapter.py 中一致）
ATTR = "(period_id=? OR (period_id=0 AND order_date BETWEEN ? AND ?))"


def t_idempotency():
    print("=" * 66)
    print("A. 报单幂等键：(user_id, store_id, order_date)  →  再加 period_id")
    print("=" * 66)
    c = mem_conn()
    # 关键场景：期次 9 与期次 10 的 order_start 相同（真实重叠期次）
    c.execute("INSERT INTO forecast_submissions (user_id,store_id,order_date,period_id) "
              "VALUES (7,3,'2026-09-08',9)")
    c.execute("INSERT INTO forecast_submissions (user_id,store_id,order_date,period_id) "
              "VALUES (7,4,'2026-09-08',0)")
    c.commit()
    n = ok = 0

    def chk(name, got, want):
        nonlocal n, ok
        n += 1
        good = bool(got) == want
        ok += good
        print("  %s %-54s 命中=%-5s 期望=%s" % ("OK " if good else "FAIL", name, bool(got), want))

    chk("1) 同期次重复提交(pid=9) → 命中并覆盖", c.execute(SUB_NEW, (7, 3, 9, '2026-09-08')).fetchone(), True)
    chk("2) 另一期次但 order_start 相同(pid=10) → 不命中", c.execute(SUB_NEW, (7, 3, 10, '2026-09-08')).fetchone(), False)
    old_hit = bool(c.execute(SUB_OLD, (7, 3, '2026-09-08')).fetchone())
    print("      对照：旧口径在 2) 上命中 = %s  ← True 即证明旧实现会覆盖掉期次 9" % old_hit)
    chk("3) 历史行 period_id=0 且同日 → 仍命中（向后兼容）", c.execute(SUB_NEW, (7, 4, 10, '2026-09-08')).fetchone(), True)
    chk("4) 不同门店 → 不命中", c.execute(SUB_NEW, (7, 99, 10, '2026-09-08')).fetchone(), False)
    return n, ok


def t_save_matrix():
    print()
    print("=" * 66)
    print("B. save-matrix 期次解析优先级（模拟今天 = 2026-09-10，在窗口内）")
    print("=" * 66)
    c = mem_conn()
    c.execute("INSERT INTO forecast_periods VALUES (1,'历史期','2026-09-01','2026-09-14','closed')")
    c.execute("INSERT INTO forecast_periods VALUES (2,'当期','2026-09-08','2026-09-14','open')")
    c.execute("INSERT INTO forecast_periods VALUES (3,'同窗A','2026-09-08','2026-09-14','open')")
    c.execute("INSERT INTO forecast_periods VALUES (4,'同窗B','2026-09-08','2026-09-14','open')")
    c.commit()
    TODAY = '2026-09-10'

    def resolve(start, end, pid=0):
        """与 routers/forecast_submissions.py::save_matrix 中的解析逻辑逐句同构。"""
        if pid > 0:
            if not c.execute("SELECT id FROM forecast_periods WHERE id=?", (pid,)).fetchone():
                pid = 0
        if pid <= 0:
            row = c.execute(
                "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? AND status='open' "
                "AND order_start<=? AND order_end>=? ORDER BY id DESC LIMIT 1",
                (start, end, TODAY, TODAY)).fetchone()
            if not row:
                row = c.execute(
                    "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? AND status='open' "
                    "ORDER BY id DESC LIMIT 1", (start, end)).fetchone()
            if not row:
                row = c.execute(
                    "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? "
                    "AND order_start<=? AND order_end>=? ORDER BY id DESC LIMIT 1",
                    (start, end, TODAY, TODAY)).fetchone()
            if row:
                pid = int(row["id"] or 0)
        return pid

    n = ok = 0

    def chk(name, got, want):
        nonlocal n, ok
        n += 1
        good = got == want
        ok += good
        print("  %s %-58s 得到=%-4s 期望=%s" % ("OK " if good else "FAIL", name, got, want))

    chk("1) 前端显式传 pid=3 → 照用（不再被 id 最大者抢走）", resolve('2026-09-08', '2026-09-14', 3), 3)
    chk("2) 显式传脏 pid=999 → 丢弃后回落窗口解析", resolve('2026-09-08', '2026-09-14', 999), 4)
    chk("3) 不传 pid：丢 open 同窗期取 id 最大（保持原兜底行为）", resolve('2026-09-08', '2026-09-14'), 4)
    chk("4) 已关闭但含今天的期次 → 可解析（旧实现只在 open 里找，恒 0）", resolve('2026-09-01', '2026-09-14'), 1)
    chk("5) 窗口已过期且不传 pid → 0（该场景由前端显式传 pid 覆盖）", resolve('2026-08-01', '2026-08-07'), 0)
    return n, ok


def t_prod():
    print("=" * 66)
    print("C. 生产真实数据：新旧归属口径差异（只读 mode=ro，零写入）")
    print("=" * 66)
    files = sorted(glob.glob("/opt/hergent-erp/tenant_*.db"))
    total_diff = 0
    for f in files:
        try:
            c = sqlite3.connect("file:%s?mode=ro" % os.path.abspath(f), uri=True)
            c.row_factory = sqlite3.Row
            try:
                pers = c.execute("SELECT id,name,order_start,order_end,status "
                                 "FROM forecast_periods ORDER BY id").fetchall()
                subs = c.execute("SELECT COUNT(*) AS n FROM forecast_submissions").fetchone()["n"]
            except sqlite3.OperationalError:
                c.close()
                continue
            if not pers and not subs:
                c.close()
                continue
            print("\n--- %s : 期次 %d 个 / 报单 %d 行 ---" % (os.path.basename(f), len(pers), subs))
            for p in pers:
                pid, os_, oe = p["id"], p["order_start"], p["order_end"]
                o = c.execute("SELECT COUNT(*) AS n, COALESCE(SUM(total_qty),0) AS q "
                              "FROM forecast_submissions WHERE role!='导入' "
                              "AND order_date BETWEEN ? AND ?", (os_, oe)).fetchone()
                w = c.execute("SELECT COUNT(*) AS n, COALESCE(SUM(total_qty),0) AS q "
                              "FROM forecast_submissions WHERE role!='导入' AND " + ATTR,
                              (pid, os_, oe)).fetchone()
                diff = (o["n"] != w["n"]) or (o["q"] != w["q"])
                total_diff += diff
                print("  p%-3s %-12s %s~%s  旧 n=%-3s q=%-6s | 新 n=%-3s q=%-6s %s" % (
                    pid, (p["name"] or "")[:12], os_, oe, o["n"], o["q"], w["n"], w["q"],
                    "<== 口径有差异" if diff else ""))
            c.close()
        except Exception as e:
            print("  [skip] %s: %s" % (os.path.basename(f), e))
    print("\n有差异的期次数 = %d" % total_diff)


def t_overlap():
    """D. 量化「窗口重叠」暴露面：一笔报单被几个期次窗口同时包含？
    旧口径下每被多包含一次就多计一次 —— 这个数就是「重复计入」的风险面。"""
    print()
    print("=" * 66)
    print("D. 窗口重叠暴露面：一笔报单被几个期次窗口同时包含（只读）")
    print("=" * 66)
    for f in sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
        try:
            c = sqlite3.connect("file:%s?mode=ro" % os.path.abspath(f), uri=True)
            c.row_factory = sqlite3.Row
            try:
                pers = c.execute("SELECT id,order_start,order_end FROM forecast_periods").fetchall()
                subs = c.execute("SELECT id,order_date,period_id,store_name,total_qty "
                                 "FROM forecast_submissions WHERE role!='导入' "
                                 "ORDER BY order_date").fetchall()
            except sqlite3.OperationalError:
                c.close()
                continue
            if not pers:
                c.close()
                continue
            multi = []
            for s in subs:
                hit = [p["id"] for p in pers
                       if p["order_start"] <= s["order_date"] <= p["order_end"]]
                if len(hit) > 1:
                    multi.append((s, hit))
            print("\n--- %s : 报单 %d 行，其中被多个期次窗口同时包含的 %d 行 ---"
                  % (os.path.basename(f), len(subs), len(multi)))
            for s, hit in multi[:20]:
                print("    报单#%-4s 日期=%s period_id=%-3s 门店=%-10s 数量=%-4s → 命中期次 %s"
                      % (s["id"], s["order_date"], s["period_id"],
                         (s["store_name"] or "")[:10], s["total_qty"], hit))
            dist = c.execute("SELECT period_id, COUNT(*) n, COALESCE(SUM(total_qty),0) q "
                             "FROM forecast_submissions WHERE role!='导入' "
                             "GROUP BY period_id").fetchall()
            print("    period_id 分布: " + " | ".join(
                "pid=%s:%s行/%s件" % (r["period_id"], r["n"], r["q"]) for r in dist))
            c.close()
        except Exception as e:
            print("  [skip] %s: %s" % (os.path.basename(f), e))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "local"
    if mode == "prod":
        t_prod()
        t_overlap()
    else:
        n1, ok1 = t_idempotency()
        n2, ok2 = t_save_matrix()
        tot, ok = n1 + n2, ok1 + ok2
        print()
        print("=" * 66)
        print("本地结果：A %d/%d   B %d/%d   合计 %d/%d  %s"
              % (ok1, n1, ok2, n2, ok, tot, "ALL PASS" if ok == tot else "FAIL"))
        sys.exit(0 if ok == tot else 1)
