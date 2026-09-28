# -*- coding: utf-8 -*-
"""档案缺口清单生成器（v313，**全程只读**）。

## 为什么必须用生产档案，不能用本地 dev 库
本地 dev 库只有 6 商品 / 3 供应商 / 0 条码 —— 拿它出清单会得出「几乎全不匹配」，
对用户毫无价值甚至误导。所以先用 `v313-export-archive-snapshot.py` 把**生产
tenant_1**（755 档案 / 471 商品 / 368 条码）的最小字段快照取回本地。

## 三重隔离（每一重都是踩过的坑）
1. `conn` 用**内存库**（灌快照）⇒ 匹配过程物理上不可能写任何真实库。
2. 🔴 **`ERP_DB_PATH` 必须在 `import` 之前设** —— `routers.zhoupu_documents` 的
   import 链会触发 `erp_db.py` 的启动期 schema 同步；不隔离它就会往**真实 dev 库**
   （erp.db + tenant_N.db）执行 `ALTER TABLE ... ADD COLUMN`（v313 踩过一次，
   见 §「副作用」）。租户库路径 = `DB_DIR/tenant_N.db`，所以换目录即全部隔离。
3. 判据复用生产代码（`RefIndex` / `detect_file` / `bind_columns` / `row_get`），
   **不重写第二套匹配** —— 否则清单会与用户实际看到的预览不一致（「两把尺子」）。

用法：
    cd /Users/zhangjunfeng/Documents/hergent-erp/server
    /usr/bin/python3 <本脚本>              # 出清单（stdout + docs 下的 md/xlsx）
    /usr/bin/python3 <本脚本> --brief      # 只打摘要，不写文件
"""
import collections
import difflib
import json
import os
import shutil
import sqlite3
import sys

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
SNAP = "/tmp/v313-tenant1-snapshot.json"
OUT_MD = "/Users/zhangjunfeng/Documents/hergent-erp/docs/档案缺口清单-2026-08-舟谱单据.md"
OUT_XLSX = "/Users/zhangjunfeng/Documents/hergent-erp/docs/档案缺口清单-2026-08-舟谱单据.xlsx"
SRC = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"
FILES = [
    ("采购单明细", os.path.join(SRC, "20260801-20260831采购单明细.xlsx")),
    ("收入明细表", os.path.join(SRC, "2026年8月收入明细表.xlsx")),
    ("费用明细表", os.path.join(SRC, "2026年8月费用明细表.xlsx")),
]

# ---------- 隔离（必须在 import 之前）----------
SHADOW_DIR = "/tmp/v313-gap-shadow"
if os.path.isdir(SHADOW_DIR):
    shutil.rmtree(SHADOW_DIR)
os.makedirs(SHADOW_DIR)
shutil.copy2(os.path.join(SRV, "erp.db"), os.path.join(SHADOW_DIR, "erp.db"))
os.environ["ERP_DB_PATH"] = os.path.join(SHADOW_DIR, "erp.db")
os.environ.setdefault("ERP_SECRET", "v313-gap-scan-not-a-real-key")
sys.path.insert(0, SRV)

import routers.zhoupu_documents as Z  # noqa: E402


def mem_db():
    snap = json.load(open(SNAP, encoding="utf-8"))
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    for t, v in snap["_tables"].items():
        cols = v["cols"]
        c.execute("CREATE TABLE %s (%s)" % (t, ", ".join('"%s"' % x for x in cols)))
        c.executemany("INSERT INTO %s VALUES (%s)" % (t, ", ".join("?" * len(cols))), v["rows"])
    c.commit()
    return c, snap


def read_xlsx(fp):
    """与生产同款读法：`read_only=True` + **`reset_dimensions()`**。
    舟谱的 `<dimension ref="A1"/>` 是假的（实测 1140×28 的文件自称只有 A1），
    不 reset 就会**成功返回 0 行却不报错**。"""
    import openpyxl
    wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    ws.reset_dimensions()
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


# ---------- 档案需求收集 ----------
class Need(object):
    """一个「档案需求」聚合器：同一名字出现在多行/多单里要合并计数。"""

    def __init__(self):
        self.d = collections.OrderedDict()

    def add(self, name, order_no, **extra):
        e = self.d.get(name)
        if e is None:
            e = self.d[name] = {"name": name, "lines": 0, "orders": set(), "extra": {}}
        e["lines"] += 1
        if order_no:
            e["orders"].add(order_no)
        for k, v in extra.items():
            if v not in (None, ""):
                e["extra"].setdefault(k, set()).add(str(v))

    def rows(self):
        out = []
        for e in self.d.values():
            r = {"name": e["name"], "lines": e["lines"], "orders": len(e["orders"])}
            for k, v in e["extra"].items():
                r[k] = " / ".join(sorted(v))
            out.append(r)
        return sorted(out, key=lambda x: -x["lines"])


def top_sim(ref, name, pool):
    """在给定档案池里找最像的几个名字（复用生产同一个相似度函数 `_sim`）。"""
    scored = []
    for cand in pool:
        s = ref._sim(name, cand)
        if s >= 0.45:
            scored.append((s, cand))
    scored.sort(reverse=True)
    return scored[:3]


def scan(Z, conn, ref, snap):
    """按**档案维度**遍历三份文件，收集「要补哪些档案」。

    🔴 往来单位按**单据类型**分流到不同池 —— 这是 M0.2 必须做的判断：
       当前 `do_import_money` 只有 `ref.sup_id(cname)` 一条路（M0.1 只放行供应商单），
       放开客户单后必须按类型改走 `cust_id`，否则客户名拿去供应商池找、100% 落空。
    """
    need = {k: Need() for k in
            ("供应商", "客户", "商品", "员工", "仓库", "品牌", "内部单往来单位")}
    miss = {k: collections.OrderedDict() for k in need}   # 只记「匹配不上」的
    bumped = collections.OrderedDict()                    # twin：改挂正式档案
    stats = collections.OrderedDict()

    for lab, fp in FILES:
        kind, sheet, hr, headers = Z.detect_file(fp)
        spec = Z.SPECS[kind]
        bind = Z.bind_columns(headers, spec)
        rows = read_xlsx(fp)
        n_data = n_used = 0
        for vals in rows[hr + 1:]:
            no = str(Z.row_get(vals, bind, "no") or "").strip()
            if not no or len(no) < 6:      # 空行 / 「合计」行
                continue
            n_data += 1

            if kind == "zhoupu_purchase":
                sname = str(Z.row_get(vals, bind, "supplier") or "").strip()
                if sname:
                    need["供应商"].add(sname, no)
                    if not ref.sup_id(sname):
                        miss["供应商"].setdefault(sname, {"lines": 0, "orders": set()})
                        miss["供应商"][sname]["lines"] += 1
                        miss["供应商"][sname]["orders"].add(no)
                wh = str(Z.row_get(vals, bind, "warehouse") or "").strip()
                if wh:
                    need["仓库"].add(wh, no)
                    if wh not in ref.wh:
                        miss["仓库"].setdefault(wh, {"lines": 0, "orders": set()})
                        miss["仓库"][wh]["lines"] += 1
                        miss["仓库"][wh]["orders"].add(no)
                ag = str(Z.row_get(vals, bind, "agent") or "").strip()
                if ag:
                    need["员工"].add(ag, no, src="采购经办人")
                    if not ref.emp_id(ag):
                        miss["员工"].setdefault(ag, {"lines": 0, "orders": set()})
                        miss["员工"][ag]["lines"] += 1
                        miss["员工"][ag]["orders"].add(no)
                pname = str(Z.row_get(vals, bind, "product") or "").strip()
                bar = str(Z.row_get(vals, bind, "barcode") or "").strip()
                unit = str(Z.row_get(vals, bind, "unit") or "").strip()
                if pname:
                    p, note = ref.product(pname, bar, unit)
                    need["商品"].add(pname, no, 单位=unit, 条码=bar)
                    if p is None:
                        miss["商品"].setdefault(pname, {"lines": 0, "orders": set()})
                        miss["商品"][pname]["lines"] += 1
                        miss["商品"][pname]["orders"].add(no)
                    elif note == "twin":
                        bumped.setdefault(pname, {"lines": 0, "orders": set(),
                                                  "unit": unit})
                        bumped[pname]["lines"] += 1
                        bumped[pname]["orders"].add(no)
                n_used += 1
            else:
                otype = str(Z.row_get(vals, bind, "otype") or "").strip()
                tmap = Z._TYPE_MAP.get(kind, {}).get(otype)
                cname = str(Z.row_get(vals, bind, "contact") or "").strip()
                if otype.startswith("供应商"):
                    pool = "供应商"
                    hit = ref.sup_id(cname)
                elif otype.startswith("客户"):
                    pool = "客户"
                    hit = ref.cust_id(cname)
                else:
                    pool = "内部单往来单位"
                    hit = None if cname in ("", "-", "—") else ref.sup_id(cname)
                if cname:
                    need[pool].add(cname, no, 单据类型=otype)
                    if not hit:
                        miss[pool].setdefault(cname, {"lines": 0, "orders": set(),
                                                      "otype": otype})
                        miss[pool][cname]["lines"] += 1
                        miss[pool][cname]["orders"].add(no)
                emp = str(Z.row_get(vals, bind, "emp") or "").strip()
                if emp:
                    need["员工"].add(emp, no, src="收付款员工")
                    if not ref.emp_id(emp):
                        miss["员工"].setdefault(emp, {"lines": 0, "orders": set()})
                        miss["员工"][emp]["lines"] += 1
                        miss["员工"][emp]["orders"].add(no)
                br = str(Z.row_get(vals, bind, "brand") or "").strip()
                if br:
                    need["品牌"].add(br, no)
                n_used += 1
        stats[lab] = {"kind": kind, "data_rows": n_data, "used_rows": n_used,
                      "header_row": hr + 1}
    return need, miss, bumped, stats


def orders_by_value(rows, hr, bind, field, value):
    """找出「该字段取值 == value」的那些**单号**。

    用途：一个供应商匹配不上时，**整张单**都会被阻塞 —— 缺漏清单里记的是
    「哪一行匹配不上」（可能只 1 行），但用户实际损失的是那几张单**整张**没进来。
    按 1 行报告会严重低估影响面（同 `_fail` 用 `n_lines` 而不是 1 的理由）。"""
    hit = set()
    for vals in rows[hr + 1:]:
        no = str(Z.row_get(vals, bind, "no") or "").strip()
        if not no or len(no) < 6:
            continue
        if str(Z.row_get(vals, bind, field) or "").strip() == value:
            hit.add(no)
    return hit


def order_impact(rows, hr, bind, orders):
    """给定单号集合，从文件里回算「整单」的行数与金额。"""
    n = 0
    amt = 0.0
    detail = []
    for vals in rows[hr + 1:]:
        no = str(Z.row_get(vals, bind, "no") or "").strip()
        if no not in orders:
            continue
        n += 1
        a = Z._num(Z.row_get(vals, bind, "amount"))
        if a:
            amt += a
        detail.append((no, str(Z.row_get(vals, bind, "product") or "").strip(),
                       Z.row_get(vals, bind, "qty"), a))
    return n, amt, detail


def main():
    conn, snap = mem_db()
    ref = Z.RefIndex(conn)
    n_sup = len([r for r in snap["_tables"]["contacts"]["rows"] if r[2] == "supplier"])
    print("=" * 80)
    print("生产 tenant_1 档案基数：contacts %d（供应商 %d / 客户 %d / 员工 %d）· 商品 %d（有条码 %d）· 仓 %d"
          % (len(snap["_tables"]["contacts"]["rows"]), n_sup, len(ref.cust), len(ref.emp),
             len(snap["_tables"]["products"]["rows"]),
             sum(1 for r in snap["_tables"]["products"]["rows"] if str(r[4] or "").strip()),
             len(snap["_tables"]["warehouses"]["rows"])))
    print("  brands 表（生产 tenant_1）: 见下方品牌一节")
    print("  归一化撞车作废：商品名 %d / 商品去括号 %d / 客户 %d / 员工 %d / 供应商 %d"
          % (len(ref.amb_nkey), len(ref.amb_bkey), len(ref.amb_cust),
             len(ref.amb_emp), len(ref.amb_sup)))
    print()

    # ---- 节 1：M0.1 权威读数（生产代码 dry_run）----
    print("=" * 80)
    print("【节 1】M0.1 实际口径（只放行供应商侧）—— 生产代码 dry_run 的权威读数")
    print("=" * 80)
    reports = []
    for lab, fp in FILES:
        rep = Z.run_file(conn, fp, dry_run=True)
        reports.append((lab, rep))
        st = rep["stats"]
        print("%s：%s　%s ~ %s" % (lab, rep["kind"], rep["date_from"], rep["date_to"]))
        print("   单数 %d · 行数 %d ｜ 已建 %d / 失败 %d / 空单 %d / **阻塞 %d** / 跳过行 %d"
              % (st.get("orders_total"), st.get("lines_total"), st.get("orders_created"),
                 st.get("orders_failed"), st.get("orders_empty"), st.get("orders_blocked"),
                 st.get("lines_skipped")))
        for m in rep["missing"]:
            print("   ❌ %-4d 行 | %s | %s" % (m["lines"], m["reason"], m["key"]))
        for w in rep["warnings"]:
            print("   ⚠️ %-4d 行 | %s | %s" % (w["lines"], w["reason"], w["key"]))
        print()

    # ---- 节 2：档案维度 ----
    need, miss, bumped, stats = scan(Z, conn, ref, snap)
    print("=" * 80)
    print("【节 2】档案维度（含 M0.2 预见的客户 / 内部单）")
    print("=" * 80)
    for k in need:
        rows = need[k].rows()
        mrows = miss[k]
        if not rows and not mrows:
            continue
        print("%s：文件里需要 %d 个" % (k, len(rows)))
        for r in rows:
            bad = r["name"] in mrows
            print("   %s %-46s %4d 行 / %3d 单  %s"
                  % ("❌" if bad else "✅", r["name"][:46], r["lines"], r["orders"],
                     " ".join("%s=%s" % (kk, vv) for kk, vv in r.items()
                              if kk not in ("name", "lines", "orders"))))
        print()

    # ---- 节 3：近似项建议 ----
    POOLS = {"供应商": list(ref.sup.keys()), "客户": list(ref.cust.keys()),
             "商品": [p["name"] for p in ref.prods], "员工": list(ref.emp.keys()),
             "仓库": list(ref.wh.keys())}
    print("=" * 80)
    print("【节 3】匹配不上项 + 系统里最像的档案（改名 / 归一化就能解决，不必建档）")
    print("=" * 80)
    for k, pool in POOLS.items():
        if not miss[k]:
            continue
        print("── %s（%d 项缺）──" % (k, len(miss[k])))
        for nm, v in miss[k].items():
            print("   ❌ %-52s %3d 行 / %d 单" % (nm[:52], v["lines"], len(v["orders"])))
            for s, cand in top_sim(ref, nm, pool):
                print("        相似 %.3f  ← %s" % (s, cand))
            if not top_sim(ref, nm, pool):
                print("        （系统里没有相近项 ⇒ 确实要建档）")
        print()
    if miss["内部单往来单位"]:
        print("── 内部单的「往来单位」是 `-`（不是名字）⇒ 设计问题，不是缺档案 ──")
        for nm, v in list(miss["内部单往来单位"].items())[:5]:
            print("   %s  %d 行 / %d 单" % (nm, v["lines"], len(v["orders"])))
        print()

    # ---- 节 4：twin（改挂正式档案）----
    print("=" * 80)
    print("【节 4】「已改挂正式档案」（舟谱单位与命中的档案单位不符 ⇒ 系统自动换了一份）")
    print("       这些**不影响导入**，但说明系统里同一商品有两份档案（单位不同）。")
    print("=" * 80)
    for nm, v in sorted(bumped.items(), key=lambda x: -x[1]["lines"]):
        print("   %-56s %3d 行 / %2d 单  舟谱单位=%s" % (nm[:56], v["lines"], len(v["orders"]), v.get("unit")))
    print()

    # ---- 节 5：被阻塞整单的**真实**影响面 ----
    print("=" * 80)
    print("【节 5】被阻塞整单的真实影响面")
    print("       缺漏清单里记的是「哪一行匹配不上」；用户实际损失的是那些单**整张**没进来。")
    print("=" * 80)
    impacts = []
    for lab, fp in FILES:
        k2, _sh, hr, headers = Z.detect_file(fp)
        if k2 != "zhoupu_purchase":
            continue
        b2 = Z.bind_columns(headers, Z.SPECS[k2])
        rws = read_xlsx(fp)
        for nm, v in miss["供应商"].items():
            ords = orders_by_value(rws, hr, b2, "supplier", nm)
            if not ords:
                continue
            n, amt, det = order_impact(rws, hr, b2, ords)
            impacts.append({"name": nm, "orders": sorted(ords), "lines": n,
                            "amount": amt, "detail": det,
                            "matched_lines": v["lines"]})
            print("   供应商「%s」：匹配不上的只有 %d 行，但**整张单**被挡 ⇒"
                  % (nm, v["lines"]))
            print("      受影响 %d 张单 / %d 行，采购入库金额合计 ¥%s（占文件 %.2f%%）"
                  % (len(ords), n, "{:,.2f}".format(amt), amt / 936599.78 * 100))
            for d in det:
                print("        %-16s %-30s 数量=%-9s 金额=%s"
                      % (d[0], d[1][:30], d[2], d[3]))
        print()

    if "--brief" not in sys.argv:
        md, xl = write_files(reports, need, miss, bumped, impacts, ref, snap)
        print("=" * 80)
        print("清单已写出：")
        print("   " + md)
        print("   " + xl)
    conn.close()


def write_files(reports, need, miss, bumped, impacts, ref, snap):
    """把清单落成 Markdown（主交付）+ xlsx（可筛选明细）。"""
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    POOLS = {"供应商": list(ref.sup.keys()), "客户": list(ref.cust.keys()),
             "商品": [p["name"] for p in ref.prods], "员工": list(ref.emp.keys())}

    # 结论段的数字全部**现算**，不写死（写死的数字下次跑就骗人）。
    n_lines_all = sum(rep["stats"].get("lines_total") or 0 for _l, rep in reports)
    n_ord_all = sum(rep["stats"].get("orders_total") or 0 for _l, rep in reports)
    n_purchase_amt = 936599.78   # 采购文件已验收的权威合计（单头 = 明细，逐笔可解释）
    gaps = [(k, nm, v) for k in ("供应商", "客户", "商品") for nm, v in miss[k].items()]
    aliasable = [g for g in gaps if top_sim(ref, g[1], POOLS[g[0]]) and
                 top_sim(ref, g[1], POOLS[g[0]])[0][0] >= 0.75]

    # ---------- Markdown ----------
    L = []
    A = L.append
    A("# 舟谱 2026 年 8 月单据 —— 档案缺口清单")
    A("")
    _nb = sum(1 for r in snap["_tables"]["products"]["rows"]
              if str(r[snap["_tables"]["products"]["cols"].index("barcode")] or "").strip())
    A("> **数据来源**：生产租户库 `tenant_1`（往来档案 %d · 商品 %d 其中 %d 个有条码 · 仓库 %d）"
      % (len(snap["_tables"]["contacts"]["rows"]), len(snap["_tables"]["products"]["rows"]),
         _nb, len(snap["_tables"]["warehouses"]["rows"])))
    # ⚠️ 这句话曾经是硬编码的「没有新建任何档案」—— 2026-09-28 用户授权建档后它**变成了假话**，
    #    而报告里同时写着「员工缺口 0」（因为已补），两处互相矛盾却都能显示。
    #    ⇒ 凡「本报告自身状态」的句子，一律由数据推导，不写死。
    A("> **产出方式**：**本报告本体是只读分析**；档案数是**当前快照**的读数（含此前已补建的档案）。")
    A("> ⚠️ 含商业敏感信息（供应商名 / 客户名 / 商品名），请勿外发。")
    A("")
    A("## 一句话结论")
    A("")
    A("三份文件一共 **%d 行明细 / %d 张单**。会让单据进不来的档案缺口只有 **%d 个**；"
      % (n_lines_all, n_ord_all, len(gaps)))
    A("其中 **%d 个是「跟系统里的写法不一样」而不是真没有** —— 改一处名字或加个别名就能过，"
      "**不需要建档**。" % len(aliasable))
    A("")
    A("下表最后 %d 行是**员工档案**缺口 —— 它们**不会挡住单据**，但会让报表按经办人统计时归不到人。"
      % len(miss["员工"]))
    A("")
    A("| 缺口类型 | 待补名称 | 会让什么进不来 | 影响面 | 建议动作 |")
    A("|---|---|---|---|---|")
    for k in ("供应商", "客户", "商品"):
        for nm, v in miss[k].items():
            sims = top_sim(ref, nm, POOLS[k])
            if k == "供应商":
                im = next((i for i in impacts if i["name"] == nm), None)
                scope = ("**%d 张单整张被挡**（%d 行 / ¥%s）"
                         % (len(im["orders"]), im["lines"], "{:,.2f}".format(im["amount"]))
                         if im else "%d 行 / %d 单" % (v["lines"], len(v["orders"])))
            else:
                scope = "%d 行 / %d 单" % (v["lines"], len(v["orders"]))
            if sims and sims[0][0] >= 0.75:
                act = "**改名/加别名**（不是建档）：<br>系统里已是「%s」（相似 %.2f）" % (
                    sims[0][1], sims[0][0])
            elif sims:
                act = "先人工确认：系统里最像的是「%s」（相似 %.2f）" % (sims[0][1], sims[0][0])
            else:
                act = "**确实要建档**（系统里没有相近项）"
            harm = {"供应商": "**整张单**", "客户": "**整张单**", "商品": "个别行"}.get(k, k)
            A("| %s | %s | %s | %s | %s |" % (k, nm, harm, scope, act))
    for nm, v in miss["员工"].items():
        A("| 员工 | %s | 不挡导入，但报表归不到人 | %d 行 / %d 单 | %s |"
          % (nm, v["lines"], len(v["orders"]),
             ("**建员工档案**（系统里没有相近项）" if not top_sim(ref, nm, POOLS["员工"])
              else "确认是否与「%s」同一人" % top_sim(ref, nm, POOLS["员工"])[0][1])))
    A("")
    A("---")
    A("")
    A("## 一、会让「整张单」进不来的缺口（阻塞级）")
    A("")
    if impacts:
        for im in impacts:
            A("### 供应商「%s」" % im["name"])
            A("")
            A("匹配不上的只有 **%d 行**，但系统按**整单**处理 ⇒ **%d 张单整张没进来**："
              % (im["matched_lines"], len(im["orders"])))
            A("")
            A("| 单号 | 商品 | 采购入库数量 | 采购入库金额 |")
            A("|---|---|---|---|")
            for d in im["detail"]:
                A("| %s | %s | %s | ¥%s |" % (d[0], d[1], d[2],
                                              "{:,.2f}".format(d[3] or 0)))
            A("")
            A("**合计 %d 行 / ¥%s**（占该文件采购金额 %.2f%%）"
              % (im["lines"], "{:,.2f}".format(im["amount"]),
                 im["amount"] / n_purchase_amt * 100))
            A("")
            A("> 系统里已有「蒙牛酸奶-恒滋」（相似 0.857）。**请确认**：舟谱写「（湖北恒滋）」、"
              "系统写「-恒滋」，是同一家吗？是 ⇒ 加别名即可；不是 ⇒ 建档。")
            A("")
    else:
        A("（无）")
        A("")
    A("## 二、会让「个别行」进不来的缺口")
    A("")
    A("| 商品（舟谱写法） | 行数 | 单据数 | 系统里最像的 | 相似度 | 建议 |")
    A("|---|---|---|---|---|---|")
    for nm, v in miss["商品"].items():
        sims = top_sim(ref, nm, POOLS["商品"])
        if sims:
            A("| %s | %d | %d | %s | %.2f | 确认后改名/合并 |"
              % (nm, v["lines"], len(v["orders"]), sims[0][1], sims[0][0]))
        else:
            A("| %s | %d | %d | （无相近项） | — | **建档** |"
              % (nm, v["lines"], len(v["orders"])))
    A("")
    A("## 三、不挡导入，但你应该知道的")
    A("")
    A("### 3.1 员工档案缺 %d 个" % len(miss["员工"]))
    A("")
    A("经办人匹配不上**不会挡住单据**：名字会原样写进采购单的「经办人」字段和备注。")
    A("后果是**报表按经办人统计时归不到人**，而且无法核对是谁经手的。")
    A("")
    A("| 名字 | 出现行数 | 涉及单据 | 建议 |")
    A("|---|---|---|---|")
    for nm, v in sorted(miss["员工"].items(), key=lambda x: -x[1]["lines"]):
        sims = top_sim(ref, nm, POOLS["员工"])
        A("| %s | %d | %d | %s |" % (nm, v["lines"], len(v["orders"]),
                                     ("建档（系统里无相近项）" if not sims
                                      else "确认是否与「%s」同一人" % sims[0][1])))
    A("")
    # ⚠️ 这一段原本硬编码「谢雯 1107 行 / 54 张单、系统里没有她的档案」——
    #    2026-09-28 用户授权建档后它**与上一行「员工缺口 0 个」直接矛盾**，
    #    而报告照样生成、不报错（同一个报告里两句互相打架的话）。
    #    ⇒ 改成**由当前缺口动态决定**：有缺口才点名最大的那条，没有就说明已补齐。
    if miss["员工"]:
        _nm, _v = max(miss["员工"].items(), key=lambda x: x[1]["lines"])
        A("> 特别注意：**%s** 出现 **%d 行 / %d 张单**，是本项里**影响行数最大**的一条，"
          "系统里没有他的员工档案。" % (_nm, _v["lines"], len(_v["orders"])))
    else:
        A("> ✅ 当前**没有**员工档案缺口：文件里出现的经办人在系统里都能找到。")
        A("> （2026-09-28 经用户授权补建：谢雯 / 仲嫚嫚 / 李琴，落在 `contacts.type='employee'`，"
          "即导入匹配读取的那一套。）")
    A("")
    A("### 3.2 品牌档案是空的")
    A("")
    A("`brands` 表在生产租户库里是 **0 行**，而收付款文件里有 3 个品牌值：")
    A("")
    A("| 品牌 | 出现行数 |")
    A("|---|---|")
    for r in need["品牌"].rows():
        A("| %s | %d |" % (r["name"], r["lines"]))
    A("")
    A("品牌目前只进单据备注、不参与匹配 ⇒ **不挡导入**。若以后要用「品牌」做报表维度，需要先建品牌档案。")
    A("")
    A("### 3.3 「同一商品两份档案」（%d 个商品）" % len(bumped))
    A("")
    A("舟谱给的**单位**与系统里命中的那份档案的单位不一致时，系统会自动改挂到**同名的另一份**档案上。")
    A("这些单**都能正常导入**，但说明系统里同一个商品存在两份档案（单位不同），长期看是数据隐患。")
    A("")
    A("| 商品 | 行数 | 单据数 | 舟谱单位 |")
    A("|---|---|---|---|")
    for nm, v in sorted(bumped.items(), key=lambda x: -x[1]["lines"]):
        A("| %s | %d | %d | %s |" % (nm, v["lines"], len(v["orders"]), v.get("unit")))
    A("")
    A("## 四、下一批（M0.2：客户单 / 内部单）会遇到的")
    A("")
    for k in ("客户",):
        for nm, v in miss[k].items():
            sims = top_sim(ref, nm, POOLS[k])
            A("- **客户「%s」**（%d 行 / %d 单）%s" % (
                nm, v["lines"], len(v["orders"]),
                ("—— 系统里是「%s」，只差一个字（相似 %.2f），**很可能是错别字**"
                 % (sims[0][1], sims[0][0])) if sims else "—— 系统里没有相近项，要建档"))
    if miss["内部单往来单位"]:
        nm, v = list(miss["内部单往来单位"].items())[0]
        A("- **内部单的「往来单位」是「%s」**（%d 行 / %d 单）—— 这**不是缺档案**，"
          "而是内部单本来就没有外部往来单位。系统里 `contact_id` 是必填且带外键约束，"
          "所以要落库必须先定一件事：内部单挂到哪个内部往来单位下。" % (nm, v["lines"], len(v["orders"])))
    A("")
    A("---")
    A("")
    A("## 五、本批导入的账面读数（供核对）")
    A("")
    A("| 文件 | 单据数 | 明细行数 | 本批可导入 | 被挡 |")
    A("|---|---|---|---|---|")
    for lab, rep in reports:
        st = rep["stats"]
        A("| %s | %d | %d | %d | %d |" % (lab, st.get("orders_total"), st.get("lines_total"),
                                          st.get("orders_created"), st.get("orders_blocked")))
    A("")
    A("> 采购：单头与明细合计均为 **¥936,599.78**（取舟谱给的「采购入库金额」列；"
      "若按「数量×单价」现算会是 ¥936,604.87，差 ¥5.09）。")
    A("> 收入 / 费用：本批只导供应商侧（收入 3 单 ¥176,709.08 · 费用 1 单 ¥12,900.30），"
      "客户单与内部单留到 M0.2。")
    A("")
    A("## 六、怎么再跑一遍")
    A("")
    A("```bash")
    A("# 1) 取生产档案快照（只读）")
    A("scp v313-export-archive-snapshot.py root@47.113.224.140:/tmp/")
    A("ssh root@47.113.224.140 '/usr/bin/python3 /tmp/v313-export-archive-snapshot.py \\")
    A("      /opt/hergent-erp/tenant_1.db > /tmp/v313-snap-t1.json'")
    A("scp root@47.113.224.140:/tmp/v313-snap-t1.json /tmp/v313-tenant1-snapshot.json")
    A("")
    A("# 2) 出清单")
    A("cd /Users/zhangjunfeng/Documents/hergent-erp/server")
    A("/usr/bin/python3 <tools>/v313-archive-gap.py")
    A("```")
    A("")
    open(OUT_MD, "w", encoding="utf-8").write("\n".join(L))

    # ---------- xlsx ----------
    wb = openpyxl.Workbook()
    HEAD = Font(bold=True, color="FFFFFF")
    FILL = PatternFill("solid", fgColor="C00000")
    WARN = PatternFill("solid", fgColor="FFF2CC")

    def sheet(title, cols, rows, widths):
        ws = wb.create_sheet(title)
        ws.append(cols)
        for i, _c in enumerate(cols, 1):
            cell = ws.cell(row=1, column=i)
            cell.font = HEAD
            cell.fill = FILL
            cell.alignment = Alignment(horizontal="center")
        for r in rows:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        return ws

    def v(x):
        """openpyxl 不接受 Excel 公式前缀，也不接受 None。"""
        return "" if x is None else x

    sheet("缺口总览", ["类型", "待补名称", "出现行数", "涉及单据", "系统里最像的", "相似度", "建议"],
          [["供应商" if k == "供应商" else k, nm, v["lines"], len(v["orders"]),
            (top_sim(ref, nm, POOLS[k])[0][1] if top_sim(ref, nm, POOLS[k]) else "（无相近项）"),
            (round(top_sim(ref, nm, POOLS[k])[0][0], 3) if top_sim(ref, nm, POOLS[k]) else ""),
            ("改名/加别名，不必建档" if top_sim(ref, nm, POOLS[k]) and
             top_sim(ref, nm, POOLS[k])[0][0] >= 0.75 else "人工确认后再定")]
           for k in ("供应商", "客户", "商品", "员工") for nm, v in miss[k].items()],
          [10, 44, 10, 10, 46, 9, 26])

    sheet("阻塞整单明细", ["供应商", "单号", "商品", "采购入库数量", "采购入库金额", "说明"],
          [[im["name"], d[0], d[1], d[2], d[3], "整张单被挡"] for im in impacts for d in im["detail"]],
          [28, 18, 40, 14, 14, 14])

    sheet("双档案商品", ["商品", "行数", "单据数", "舟谱单位", "说明"],
          [[nm, v["lines"], len(v["orders"]), v.get("unit"), "系统自动改挂到同名另一份档案"]
           for nm, v in sorted(bumped.items(), key=lambda x: -x[1]["lines"])],
          [52, 8, 9, 10, 34])

    rows = []
    for k in need:
        for r in need[k].rows():
            rows.append([k, r["name"], r["lines"], r["orders"],
                         "缺" if r["name"] in miss[k] else "有",
                         " / ".join("%s=%s" % (kk, vv) for kk, vv in r.items()
                                    if kk not in ("name", "lines", "orders"))])
    sheet("文件需求全量", ["档案类型", "名称", "出现行数", "涉及单据", "系统里", "附加信息"],
          rows, [12, 52, 10, 10, 8, 34])

    sheet("本批账面读数", ["文件", "形态", "起始日期", "结束日期", "单据数", "明细行数",
                       "已建", "失败", "空单", "被挡", "跳过行"],
          [[lab, rep["kind"], rep["date_from"], rep["date_to"],
            rep["stats"].get("orders_total"), rep["stats"].get("lines_total"),
            rep["stats"].get("orders_created"), rep["stats"].get("orders_failed"),
            rep["stats"].get("orders_empty"), rep["stats"].get("orders_blocked"),
            rep["stats"].get("lines_skipped")] for lab, rep in reports],
          [14, 18, 12, 12, 9, 10, 8, 8, 8, 8, 9])

    del wb["Sheet"]
    wb.save(OUT_XLSX)
    return OUT_MD, OUT_XLSX


if __name__ == "__main__":
    main()
