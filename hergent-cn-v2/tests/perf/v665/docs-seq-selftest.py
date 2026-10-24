#!/usr/bin/env python3
"""v665 舟谱源单据号唯一性 —— 离线自检（不连生产、不依赖 core / erp_db / 租户库）。

为什么用 **AST 抽源码** 而不是 `import`：
  `routers/forecast.py` 顶部依赖 `core` / `erp_db` / `domain.unit_convert` 与运行期环境
  （租户库、密钥），离线根本 import 不起来；而要验的这几个函数恰好是**纯的**
  （只吃 `conn`、`hashlib` 和常量）。抽出来的就是**即将上线的那份字节**，
  不是一份手抄副本 —— 副本会漂，漂了就变成「测的是一份代码、跑的是另一份」。

验的判据（全部是「会静默错」的类型，不测就等着线上发现）：
  ① 连续多批号段**互不相交**（本方案的核心）
  ② 同分单数连续三批 = 号段首尾相接、无重叠、无跳号
  ③ 幂等：同内容指纹复用原批原号段，**不吃号**
  ④ 上限：两位序号用完必须**硬拒绝**（ValueError），不许静默出三位号
  ⑤ 指纹：同数据换顺序 → 同指纹；数量变一个 → 指纹必须变
  ⑥ 自提 ZT / 调拨 DB 两套水位互不干扰
  ⑦ 事务性：某前缀分配失败时，同事务里已分配的前缀也要回滚（不留半笔）

用法：python3 tests/perf/v665/docs-seq-selftest.py [forecast.py 路径]
"""
import ast
import hashlib
import os
import sqlite3
import sys
import traceback
from contextlib import contextmanager

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = os.path.abspath(os.path.join(HERE, "../../../../.tmp-backend/forecast.py"))

WANT_FUNCS = {
    "_alloc_doc_seqs", "_content_fingerprint", "_scope_label", "_reserve_batch",
    "_ensure_doc_tables",
}
WANT_CONSTS = {
    "_DOC_SEQ_MAX", "_ZT_PREFIX", "_DB_PREFIX",
    "_DOC_SEQ_DEFAULT_ZT", "_DOC_SEQ_DEFAULT_DB", "_DOC_SEQ_DDL",
}


def load_namespace(src_path):
    """从 forecast.py 抽函数/常量，构建可独立执行的命名空间。"""
    src = open(src_path, encoding="utf-8").read()
    tree = ast.parse(src)
    ns = {"hashlib": hashlib, "print": print}
    got_f, got_c = set(), set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS:
            exec(compile(ast.Module([node], []), src_path, "exec"), ns)
            got_f.add(node.name)
        elif isinstance(node, ast.Assign):
            tgts = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if tgts and tgts[0] in WANT_CONSTS:
                exec(compile(ast.Module([node], []), src_path, "exec"), ns)
                got_c.add(tgts[0])
    missing = (WANT_FUNCS - got_f) | (WANT_CONSTS - got_c)
    if missing:
        raise RuntimeError("源码里没找到：%s" % "、".join(sorted(missing)))
    return ns


def make_fake_db(conn):
    """最小 `db` 替身：只提供 _reserve_batch 用到的 get_db_tx（commit/rollback 语义一致）。"""
    @contextmanager
    def get_db_tx():
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return type("FakeDB", (), {"get_db_tx": staticmethod(get_db_tx)})


def new_conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    return c


def bind(ns, conn):
    """把 ns 里的函数绑定到某个内存库，并补上只影响**文件名**的桩。"""
    ns["db"] = make_fake_db(conn)
    ns["_zt_filename"] = lambda s, e, b=0: "zt_%d.xlsx" % b
    ns["_db_filename"] = lambda s, e, b=0: "db_%d.xlsx" % b
    return ns


def meta(pid, arr, zt_docs=0, db_docs=0, fp_zt="", fp_db="", zt_items=0, db_items=0):
    return {"period_id": pid, "arrival_date": arr,
            "zt": {"docs": zt_docs, "items": zt_items, "fingerprint": fp_zt, "scope": "测试"},
            "db": {"docs": db_docs, "items": db_items, "fingerprint": fp_db, "scope": "测试"}}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        print("SKIP: 找不到源码 %s（后端不在 git，需先把生产 forecast.py 拉到 .tmp-backend/）" % src)
        return 0
    ns = load_namespace(src)
    print("源码：%s" % src)
    print("抽取：%d 个函数 + %d 个常量" % (len(WANT_FUNCS), len(WANT_CONSTS)))
    print()

    fails = []

    def ok(cond, label, extra=""):
        if cond:
            print("  PASS  %s %s" % (label, extra))
        else:
            print("  FAIL  %s %s" % (label, extra))
            fails.append(label)

    # ---------- ① 连续三批号段互不相交 ----------
    conn = new_conn()
    n = bind(ns, conn)
    n["_ensure_doc_tables"](conn)
    segs = []
    for _ in range(3):
        segs.append(n["_alloc_doc_seqs"](conn, 37, "20261029", n["_ZT_PREFIX"], 4, 1))
    conn.commit()
    print("① 同分单数连续三批（每批 4 单，起始 01）")
    print("     号段：%s" % "、".join("%02d–%02d" % s for s in segs))
    ok(segs == [(1, 4), (5, 8), (9, 12)], "号段首尾相接、无重叠、无跳号")
    flat = [x for s in segs for x in range(s[0], s[1] + 1)]
    ok(len(flat) == len(set(flat)), "12 个单号全程唯一", "(唯一 %d / 共 %d)" % (len(set(flat)), len(flat)))
    print()

    # ---------- ② 不同批量交替（模拟各批单数不等） ----------
    conn2 = new_conn()
    n2 = bind(ns, conn2)
    n2["_ensure_doc_tables"](conn2)
    sa = n2["_alloc_doc_seqs"](conn2, 37, "20261029", n2["_ZT_PREFIX"], 9, 1)   # 蒙牛低温 9 客户
    sb = n2["_alloc_doc_seqs"](conn2, 37, "20261029", n2["_ZT_PREFIX"], 6, 1)   # 蒙牛鲜奶 6 客户
    sc = n2["_alloc_doc_seqs"](conn2, 37, "20261029", n2["_ZT_PREFIX"], 2, 1)   # 补单 2 客户
    conn2.commit()
    print("② 批量不规则（9 / 6 / 2 单）")
    print("     号段：%02d–%02d、%02d–%02d、%02d–%02d" % (sa + sb + sc))
    inter = set(range(sa[0], sa[1] + 1)) & set(range(sb[0], sb[1] + 1))
    inter2 = set(range(sb[0], sb[1] + 1)) & set(range(sc[0], sc[1] + 1))
    ok(not inter and not inter2, "三批两两无交集", "(交集 %d / %d)" % (len(inter), len(inter2)))
    ok((sa[1] + 1, sb[0]) == (sb[0], sa[1] + 1) and sb[1] + 1 == sc[0], "相邻批首尾紧接")
    print()

    # ---------- ③ 幂等复用不吃号 ----------
    conn3 = new_conn()
    n3 = bind(ns, conn3)
    n3["_ensure_doc_tables"](conn3)
    m1 = meta(37, "20261029", zt_docs=9, fp_zt="FP-A")
    sm1, bm1, r1 = n3["_reserve_batch"]("2026-10-24", "2026-10-25", m1, "zhoupu-pickup", {"zt_seq_start": 1}, "boss")
    s1, b1 = sm1.get("ZT"), bm1.get("ZT")
    water1 = conn3.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()[0]
    sm2, bm2, r2 = n3["_reserve_batch"]("2026-10-24", "2026-10-25", m1, "zhoupu-pickup", {"zt_seq_start": 1}, "boss")
    s2, b2 = sm2.get("ZT"), bm2.get("ZT")
    water2 = conn3.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()[0]
    m2 = meta(37, "20261029", zt_docs=6, fp_zt="FP-B")
    sm3, bm3, r3 = n3["_reserve_batch"]("2026-10-24", "2026-10-25", m2, "zhoupu-pickup", {"zt_seq_start": 1}, "boss")
    s3, b3 = sm3.get("ZT"), bm3.get("ZT")
    water3 = conn3.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()[0]
    cnt = conn3.execute("SELECT COUNT(*) FROM forecast_template_exports").fetchone()[0]
    print("③ 幂等（同内容点两次 / 再换内容）")
    print("     第1次 %02d–%02d 第%d批 | 第2次同内容 %02d–%02d 第%d批 | 换内容 %02d–%02d 第%d批"
          % (s1[0], s1[1], b1, s2[0], s2[1], b2, s3[0], s3[1], b3))
    ok(s1 == (1, 9) and b1 == 1, "首次从 01 起、第 1 批", "(水位 %d)" % water1)
    ok(s2 == s1 and b2 == b1 and r2, "同内容复用原批原号段", "(水位 %d → 未上涨: %s)" % (water2, water1 == water2))
    ok(s3 == (10, 15) and b3 == 2, "换内容 → 第 2 批、接在第 1 批之后", "(水位 %d)" % water3)
    ok(cnt == 2, "台账只留 2 条（重复点击不新增记录）", "(实际 %d)" % cnt)
    print()

    # ---------- ④ 上限硬拒绝 ----------
    conn4 = new_conn()
    n4 = bind(ns, conn4)
    n4["_ensure_doc_tables"](conn4)
    n4["_alloc_doc_seqs"](conn4, 37, "20261029", n4["_ZT_PREFIX"], 97, 1)   # 01–97
    conn4.commit()
    raised, msg = False, ""
    try:
        n4["_alloc_doc_seqs"](conn4, 37, "20261029", n4["_ZT_PREFIX"], 3, 1)   # 98–100 → 超
    except ValueError as e:
        raised, msg = True, str(e)
    water = conn4.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()[0]
    print("④ 两位序号上限（已用 01–97，再要 3 个）")
    ok(raised, "抛 ValueError 硬拒绝（不是静默出三位号）")
    ok(water == 97, "拒绝后水位**不动**（不留被吃掉的号）", "(水位 %d)" % water)
    ok("超出" in msg and "②" in msg, "报错文案含处置选项")
    print("     %s" % (msg[:110] + "…" if len(msg) > 110 else msg))
    print()

    # ---------- ⑤ 指纹稳定性 ----------
    g_base = [{"alias": "永诺旗舰店", "entity": "福宝",
               "items": [("6901", "箱", 3.0, 100.0), ("6902", "箱", 1.0, 88.0)]},
              {"alias": "吾悦店", "entity": "恒滋", "items": [("6901", "箱", 2.0, 100.0)]}]
    g_reordered = [g_base[1], {**g_base[0], "items": list(reversed(g_base[0]["items"]))}]
    g_changed = [{"alias": "永诺旗舰店", "entity": "福宝",
                  "items": [("6901", "箱", 4.0, 100.0), ("6902", "箱", 1.0, 88.0)]},
                 g_base[1]]
    fp1 = ns["_content_fingerprint"](g_base, "s")
    fp2 = ns["_content_fingerprint"](g_reordered, "s")
    fp3 = ns["_content_fingerprint"](g_changed, "s")
    print("⑤ 内容指纹")
    ok(fp1 == fp2, "同数据换顺序 → 同指纹（幂等才立得住）", fp1[:12])
    ok(fp1 != fp3, "多个 1 箱 → 指纹必须变（否则改动会被当成重复下载）", fp3[:12])
    print()

    # ---------- ⑥ 两个前缀互不干扰 ----------
    conn5 = new_conn()
    n5 = bind(ns, conn5)
    n5["_ensure_doc_tables"](conn5)
    z = n5["_alloc_doc_seqs"](conn5, 37, "20261029", n5["_ZT_PREFIX"], 3, 1)
    d = n5["_alloc_doc_seqs"](conn5, 37, "20261029", n5["_DB_PREFIX"], 8, 1)
    conn5.commit()
    print("⑥ 自提 / 调拨各走一套水位")
    ok(z == (1, 3) and d == (1, 8), "DB 不因 ZT 占号而推后", "(ZT %02d-%02d / DB %02d-%02d)" % (z + d))
    print()

    # ---------- ⑦ 跨前缀失败要整体回滚 ----------
    conn6 = new_conn()
    n6 = bind(ns, conn6)
    n6["_ensure_doc_tables"](conn6)
    n6["_alloc_doc_seqs"](conn6, 37, "20261029", n6["_DB_PREFIX"], 99, 1)   # DB 用满
    conn6.commit()
    m_bad = meta(37, "20261029", zt_docs=2, db_docs=2, fp_zt="F1", fp_db="F2")
    raised2, msg2 = False, ""
    try:
        n6["_reserve_batch"]("2026-10-24", "2026-10-25", m_bad, "zhoupu-all",
                             {"zt_seq_start": 1}, "boss")
    except ValueError as e:
        raised2, msg2 = True, str(e)
    zt_water = conn6.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()
    zt_rows = conn6.execute("SELECT COUNT(*) FROM forecast_template_exports WHERE prefix='ZT'").fetchone()[0]
    print("⑦ 合并包（ZT+DB）里 DB 号段不足")
    ok(raised2, "整体拒绝")
    ok(zt_water is None, "ZT 水位**没有**被留半笔（事务回滚）", "(ZT 水位行 %s)" % (zt_water[0] if zt_water else "无"))
    ok(zt_rows == 0, "ZT 台账也没有半条", "(ZT 记录 %d)" % zt_rows)
    print()

    if fails:
        print("FAILED(%d): %s" % (len(fails), "；".join(fails)))
        return 1
    print("PASS —— 号段唯一性、幂等、上限拒绝、指纹稳定性、前缀隔离、事务原子性 全部成立")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
