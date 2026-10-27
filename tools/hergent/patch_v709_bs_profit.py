#!/usr/bin/env python3
"""v709 报表口径补全 + 导入脚本加固

两块改动
--------
A. `db/queries/finance.py: get_balance_sheet_gl()`
   权益里并入「尚未结转到本年利润」的当期损益（6 开头科目净额）。

   资产负债表恒等式是 资产 = 负债 + 所有者权益。损益类科目在期末结转前仍挂在
   账上，不并入就永远差一个「当期利润」。tenant_1 实测未结转 98,325.00
   （revenue_recognition 90,000 + sale 8,325），**正好等于报表差额** ——
   这不是账不平，是没结转。结转后损益类归零、4103 有余额，不会重复计。

B. `import_zhoupu.py: import_coa_openings()`
   加三重保护，防止 v709 修掉的那次事故重演：
     ① 幂等：已有 opening 分录就拒绝（生产被跑了 4 轮，每轮 52 行）；
     ② 跳父科目：舟谱「科目期初余额.xlsx」含父科目汇总行，父+子同时写会双倍
        （实测 12 个父科目逐分等于子科目合计）；
     ③ 平衡校验：写完借贷不等就删掉本次插入的行并报错。

用法
----
  python3 patch_v709_bs_profit.py --dry-run
  python3 patch_v709_bs_profit.py
  python3 patch_v709_bs_profit.py --revert
"""
import argparse
import os
import shutil
import sys
from datetime import datetime

ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
FIN = os.path.join(ERP, "db", "queries", "finance.py")
IMP = os.path.join(ERP, "import_zhoupu.py")

OLD_FIN = '''        total_assets = cat_balance("资产")
        total_liabilities = -cat_balance("负债")
        total_equity = -cat_balance("权益")
'''

NEW_FIN = '''        total_assets = cat_balance("资产")
        total_liabilities = -cat_balance("负债")
        total_equity = -cat_balance("权益")

        # v709：把「尚未结转到本年利润」的当期损益并入权益。
        # 恒等式是 资产 = 负债 + 所有者权益；损益类（6 开头）在期末结转前仍挂在
        # 账上，不并入就永远差一个「当期利润」。tenant_1 实测未结转 98,325.00
        # （revenue_recognition 90,000 + sale 8,325），恰好等于报表差额 ——
        # 不是账不平，是没结转。结转后损益类归零、4103 有余额，不会重复计。
        _all_codes = set()
        for _s in by_cat.values():
            _all_codes |= _s
        unclosed_profit = -sum(v for _c, v in bal.items()
                               if _c.startswith("6") and _c in _all_codes)
        total_equity += unclosed_profit
'''

OLD_RET = '''            "equity": {"total": round(total_equity, 2)},
            "balanced": balanced
        }'''

NEW_RET = '''            "equity": {"total": round(total_equity, 2)},
            "unclosed_profit": round(unclosed_profit, 2),
            "balanced": balanced
        }'''

OLD_IMP = '''    count = 0
    for item in data:
        try:
            code_text = item.get('科目', '').strip()
            m = re.match(r'\\s*(\\d+)\\s+(.+)', code_text)
            if not m: continue
            code = m.group(1)
            name = m.group(2).strip()
            amount = float(item.get('期初余额', '0') or '0')
            if amount == 0: continue
'''

NEW_IMP = '''    # v709：三重保护，防 v709 修的那次事故重演
    #  ① 幂等 —— 生产被跑了 4 轮，每轮 52 行完全一样，期初借方虚增到 1260 万
    #  ② 跳父科目 —— 舟谱这张表含父科目汇总行，父+子同时写会双倍
    #  ③ 平衡 —— 写完借贷不等就整体删掉
    with get_db() as _c0:
        _exist = _c0.execute(
            "SELECT COUNT(*) FROM journal_entries WHERE ref_type='opening'").fetchone()[0]
        _base_id = _c0.execute(
            "SELECT COALESCE(MAX(id),0) FROM journal_entries").fetchone()[0]
    if _exist:
        print('  ⚠️  已存在 %d 条期初分录，跳过导入（防重复累加）' % _exist)
        print('     确需重导请先执行：DELETE FROM journal_entries WHERE ref_type=\\'opening\\'')
        return

    # 先解析全部行，再按编码前缀剔除父科目汇总行（生产是 4/6/8 位标准层级）
    _parsed = []
    for _it in data:
        _ct = _it.get('科目', '').strip()
        _m = re.match(r'\\s*(\\d+)\\s+(.+)', _ct)
        if _m:
            _parsed.append((_m.group(1), _m.group(2).strip(), _it))
    _codes = set(_p[0] for _p in _parsed)
    _parents = set(_c for _c in _codes
                   if any(_y != _c and _y.startswith(_c) and len(_y) == len(_c) + 2
                          for _y in _codes))
    if _parents:
        print('  ℹ️  跳过 %d 个父科目汇总行（父+子同时写会双倍）：%s'
              % (len(_parents), sorted(_parents)))

    count = 0
    _dr_total = _cr_total = 0.0
    for code, name, item in _parsed:
        if code in _parents:
            continue
        try:
            amount = float(item.get('期初余额', '0') or '0')
            if amount == 0: continue
'''

OLD_TAIL = '''                conn.execute(
                    "INSERT INTO journal_entries (voucher_no,date,account_code,account_name,debit,credit,ref_type,ref_id,summary) VALUES (?,?,?,?,?,?,?,?,?)",
                    ('期初', datetime.now().strftime('%Y-%m-01'), code, name, debit, credit, 'opening', 0, '舟谱导入期初余额')
                )
                conn.commit()
                count += 1
        except Exception as e:
            logging.getLogger("hergent").debug(f"skipping: {e}")

    print(f'  ✅ {count} 条科目期初导入完成')
'''

NEW_TAIL = '''                conn.execute(
                    "INSERT INTO journal_entries (voucher_no,date,account_code,account_name,debit,credit,ref_type,ref_id,summary) VALUES (?,?,?,?,?,?,?,?,?)",
                    ('期初', datetime.now().strftime('%Y-%m-01'), code, name, debit, credit, 'opening', 0, '舟谱导入期初余额')
                )
                conn.commit()
                _dr_total += debit
                _cr_total += credit
                count += 1
        except Exception as e:
            logging.getLogger("hergent").debug(f"skipping: {e}")

    # ③ 平衡校验：不平就把本次插入的行删净，绝不留半截账
    if abs(_dr_total - _cr_total) > 0.01:
        with get_db() as _c1:
            _c1.execute("DELETE FROM journal_entries WHERE id > ? AND ref_type='opening'",
                        (_base_id,))
            _c1.commit()
        print('  🔴 期初不平：借 %.2f / 贷 %.2f / 差 %.2f' % (
            _dr_total, _cr_total, _dr_total - _cr_total))
        print('     已删除本次导入，请核对源表「余额方向」列是否完整')
        return

    print(f'  ✅ {count} 条科目期初导入完成（借 %.2f = 贷 %.2f）' % (_dr_total, _cr_total))
'''


def log(m):
    print(m, flush=True)


def count_occurrences(text, sub):
    n, i = 0, 0
    while True:
        i = text.find(sub, i)
        if i < 0:
            return n
        n += 1
        i += len(sub)


def replace_once(text, old, new, rel, desc, dry):
    n_old, n_new = count_occurrences(text, old), count_occurrences(text, new)
    # 🔴 必须**先判新串**：NEW = OLD + 追加内容，所以 OLD 是 NEW 的前缀，
    # 改完之后 n_old 依然 >= 1。只判 `n_old == 0` 会每次重跑都再插一遍，
    # 且语法合法 —— 静默劣化（本次实测把权益加了两次）。
    if n_new >= 1:
        log("⏭  %-28s 已是新口径（幂等跳过）— %s" % (rel, desc))
        return text, "already"
    if n_old != 1:
        log("🔴 %-28s 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     旧串前 80 字：%s" % old[:80].replace("\n", "\\n"))
        return text, "error"
    log("✏️  %-28s %s" % (rel, desc))
    return text.replace(old, new, 1), "done"


def run(dry):
    changes = [
        (FIN, [(OLD_FIN, NEW_FIN, "权益并入未结转损益"),
               (OLD_RET, NEW_RET, "返回体加 unclosed_profit")], "db/queries/finance.py"),
        (IMP, [(OLD_IMP, NEW_IMP, "幂等 + 跳父科目"),
               (OLD_TAIL, NEW_TAIL, "平衡校验 + 失败删净")], "import_zhoupu.py"),
    ]
    ok = True
    results = []
    for path, pairs, rel in changes:
        if not os.path.exists(path):
            log("🔴 文件不存在：%s" % path)
            return 2
        text = open(path, encoding="utf-8").read()
        orig = text
        statuses = []
        for old, new, desc in pairs:
            text, st = replace_once(text, old, new, rel, desc, dry)
            statuses.append(st)
            if st == "error":
                ok = False
        results.append((path, orig, text, rel, statuses))

    if not ok:
        log("\n🔴 有锚点不匹配，全部放弃（未写任何文件）")
        return 2

    log("")
    for path, orig, text, rel, statuses in results:
        if text == orig:
            log("⏭  %s 无改动" % rel)
            continue
        if dry:
            log("🔍 [dry-run] %s 待写入 %d 字节 → %d 字节" % (rel, len(orig), len(text)))
            continue
        bak = path + ".bak-v709"
        if not os.path.exists(bak):
            shutil.copy2(path, bak)
            log("   备份 → %s" % bak)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        log("✅ 已写入 %s" % rel)

    if dry:
        return 0

    # py_compile 校验 + 回读
    log("")
    import py_compile
    for path, _o, _t, rel, _s in results:
        try:
            py_compile.compile(path, doraise=True, cfile="/tmp/v709-%s.pyc" % rel.replace("/", "_"))
            log("✅ 语法 %s" % rel)
        except Exception as e:
            log("🔴 语法 %s：%s" % (rel, e))
            ok = False

    fin = open(FIN, encoding="utf-8").read()
    imp = open(IMP, encoding="utf-8").read()
    # 🔴 只判 import_coa_openings 函数体，别扫全文：
    # `import_coa()`（科目表导入，第 349 行）里也有 `for item in data:
    # try: code_text = ...` 的同构结构，全文扫会误报"未修"。
    _imp_body = ""
    if "def import_coa_openings" in imp:
        _imp_body = imp.split("def import_coa_openings", 1)[1].split("\ndef ", 1)[0]
    checks = [
        ("finance.py 含 unclosed_profit", "unclosed_profit = -sum(v for _c, v in bal.items()" in fin),
        ("finance.py 返回体带 unclosed_profit", '"unclosed_profit": round(unclosed_profit, 2),' in fin),
        ("finance.py 旧兜底未复活", "if total_equity == 0" not in fin),
        # 🔴 防重复插入：NEW 是 OLD 的超集，判据一松就会加两遍（本次踩过）
        ("finance.py 权益只加一次", fin.count("total_equity += unclosed_profit") == 1),
        ("finance.py 损益只算一次", fin.count("unclosed_profit = -sum(") == 1),
        ("import 含幂等检查", "已存在 %d 条期初分录，跳过导入" in imp),
        ("import 含父科目剔除", "_parents = set(_c for _c in _codes" in imp),
        ("import 含平衡校验", "期初不平：借 %.2f" in imp),
        ("import_coa_openings 不再无条件遍历",
         bool(_imp_body) and "for item in data:" not in _imp_body),
        ("import_coa_openings 三保护齐全",
         all(k in _imp_body for k in ("_exist", "_parents", "_dr_total", "_base_id"))),
        ("import_coa() 科目表导入未被误改", "code_text = item.get('科目', '').strip()" in imp),
    ]
    log("")
    for name, cond in checks:
        log("%s %s" % ("✅" if cond else "🔴", name))
        ok = ok and cond
    return 0 if ok else 2


def revert():
    ok = True
    for path, rel in ((FIN, "db/queries/finance.py"), (IMP, "import_zhoupu.py")):
        bak = path + ".bak-v709"
        if not os.path.exists(bak):
            log("⏭  %s 无 v709 备份" % rel)
            continue
        shutil.copy2(bak, path)
        log("✅ 已回滚 %s ← %s" % (rel, os.path.basename(bak)))
    return 0 if ok else 2


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    if a.revert:
        sys.exit(revert())
    log("ERP_DIR = %s" % ERP)
    log("时间 %s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    log("")
    sys.exit(run(a.dry_run))
