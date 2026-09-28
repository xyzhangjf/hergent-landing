# -*- coding: utf-8 -*-
"""v313 收尾：① 修正 3 条档案的 type  ② 在**副本**上跑真实匹配函数做验收。

背景（本轮抓到的真缺陷）：
  `POST /api/contacts` 的实现是 `db.contact_create(_user=uname, **d)`，
  而 `contact_create(name, contact_type='customer', _user=None, **kw)` 的形参叫 **`contact_type`**。
  ⇒ 调用方传 `{"type": "employee"}` 时，`type` 落进 `**kw` 且**不在白名单里** ⇒ 被静默丢弃，
  取默认 `'customer'` ⇒ **返回 200 + success + id，但实际建成了客户**（零报错，v271 那类静默失效）。
  本脚本先把这 3 行的 type 改回 employee（按主键 + rowcount==1），
  **代码侧的修复不在此脚本范围内**（属范围外发现，交由用户决定是否修）。

验收（技能 §7：隔离副本 + 真实业务函数）：
  主库与租户库各 `sqlite3.backup()` 一份到 /tmp，用 `ERP_DB_PATH` 把**两份** DB_PATH 都指过去
  （只 patch 一处会漏 —— v289 踩过），然后调真正的 `RefIndex.sup_id/cust_id/emp_id/product`。
  🔴 **反例比正例重要**：必须同时证明「该认的认了」和「不该认的没串」。

用法（服务器上）：
    set -a; . /opt/hergent-erp/.env; set +a
    /usr/bin/python3 v313-fix-type-and-verify.py            # 修数据 + 验收
    /usr/bin/python3 v313-fix-type-and-verify.py --verify   # 只验收（已修过）
"""
import os
import shutil
import sqlite3
import sys

BASE = "/opt/hergent-erp"
TENANT_DB = os.path.join(BASE, "tenant_1.db")
MASTER_DB = os.path.join(BASE, "erp.db")
SCRATCH = "/tmp/v313-verify"
FIX_IDS = [(2970, "谢雯"), (2971, "仲嫚嫚"), (2972, "李琴")]
APPLY = "--verify" not in sys.argv

FAILS = []


def ck(label, cond, extra=""):
    if not cond:
        FAILS.append(label)
    print("   %s %s%s" % ("PASS" if cond else "FAIL", label,
                          ("  " + str(extra)) if extra else ""))
    return cond


def main():
    print("=" * 78)
    print("v313 收尾   模式 = %s" % ("修 type + 验收" if APPLY else "只验收"))
    print("=" * 78)

    # ── ① 修 type ──────────────────────────────────────────────────────────
    print()
    print("[1] 修正 3 条档案的 type（customer → employee）")
    if APPLY:
        w = sqlite3.connect(TENANT_DB)
        w.execute("PRAGMA busy_timeout=8000")
        w.execute("BEGIN IMMEDIATE")
        try:
            for cid, nm in FIX_IDS:
                cur = w.execute(
                    "UPDATE contacts SET type='employee', "
                    "updated_at=datetime('now','localtime') "
                    "WHERE id=? AND name=? AND type='customer'", (cid, nm))
                ck("  id=%d「%s」type 已改为 employee" % (cid, nm), cur.rowcount == 1,
                   "rowcount=%d" % cur.rowcount)
            w.commit()
        finally:
            try:
                w.rollback()
            except Exception:
                pass
            w.close()

    r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    for cid, nm in FIX_IDS:
        v = r.execute("SELECT type,is_active FROM contacts WHERE id=?", (cid,)).fetchone()
        ck("  id=%d 现在 type=employee 且启用" % cid,
           v and v[0] == "employee" and v[1] == 1, "实际=%r" % (v,))

    # ── ② 副本 ─────────────────────────────────────────────────────────────
    print()
    print("[2] 建隔离副本")
    if os.path.isdir(SCRATCH):
        shutil.rmtree(SCRATCH)
    os.makedirs(SCRATCH)
    for src, name in ((MASTER_DB, "erp.db"), (TENANT_DB, "tenant_998.db")):
        s = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
        d = sqlite3.connect(os.path.join(SCRATCH, name))
        s.backup(d)
        d.close()
        s.close()
    print("   副本就绪: %s" % SCRATCH)

    # 🔴 必须在 import 之前设 —— db/connection.py 在 import 期读它（v289）
    os.environ["ERP_DB_PATH"] = os.path.join(SCRATCH, "erp.db")
    # 🔴 「先验后部署」（技能 §8.1）：本轮改的代码还没上线，生产目录里仍是旧版
    #   ⇒ 默认 import 生产代码会报「属性不存在」，而你会误以为自己的改动写错了。
    #   用 HERGENT_SRC 指向「生产代码 + 本轮改动文件」的副本目录。
    SRV = os.environ.get("HERGENT_SRC", BASE)
    sys.path.insert(0, SRV)
    print("   代码来源: %s" % SRV)

    import db.connection as connection
    from routers import zhoupu_documents as Z

    # 🔴 硬护栏：两份 DB_PATH 都要指向副本，否则退出（宁可不验，也不能污染生产）
    assert os.path.abspath(connection.DB_DIR) == os.path.abspath(SCRATCH), \
        "隔离失败：connection.DB_DIR=%s" % connection.DB_DIR
    print("   隔离自证: connection.DB_DIR == %s" % connection.DB_DIR)

    connection.set_tenant_context(998)
    assert connection._tenant_db.get() == os.path.join(SCRATCH, "tenant_998.db")
    print("   租户上下文: %s" % connection._tenant_db.get())

    with connection.get_db() as conn:
        main_db = {x[1]: x[2] for x in conn.execute("PRAGMA database_list")}["main"]
    if os.path.realpath(main_db) != os.path.realpath(os.path.join(SCRATCH, "tenant_998.db")):
        sys.exit(2)
    print("   写路径自证: main == %s" % main_db)

    # ── ③ 真实匹配函数验收 ──────────────────────────────────────────────────
    print()
    print("[3] 匹配层验收（真实 RefIndex）")
    with connection.get_db() as conn:
        ref = Z.RefIndex(conn)
    ck("副本库支持 alias 列", ref.has_alias, "has_alias=%s" % ref.has_alias)
    ck("别名池无撞车（作废的别名 = 0）", len(ref.amb_alias) == 0, "作废=%r" % ref.amb_alias)

    print()
    print("   ── 供应商侧（本轮最关键的一条）──")
    ck("正例 蒙牛酸奶（湖北恒滋） → 2912「蒙牛酸奶-恒滋」",
       ref.sup_id("蒙牛酸奶（湖北恒滋）") == 2912,
       "实际=%r" % ref.sup_id("蒙牛酸奶（湖北恒滋）"))
    ck("🔴 反例 蒙牛酸奶 → 2923（不能被恒滋抢走）",
       ref.sup_id("蒙牛酸奶") == 2923, "实际=%r" % ref.sup_id("蒙牛酸奶"))
    ck("🔴 反例 蒙牛酸奶-恒滋 精确名仍指自己（幂等）",
       ref.sup_id("蒙牛酸奶-恒滋") == 2912, "实际=%r" % ref.sup_id("蒙牛酸奶-恒滋"))
    ck("🔴 反例 蒙牛鲜奶（7579） 不受影响",
       ref.sup_id("蒙牛鲜奶（7579）") == 2921, "实际=%r" % ref.sup_id("蒙牛鲜奶（7579）"))

    print()
    print("   ── 客户侧 ──")
    ck("正例 美联（卞和店） → 2221「美联（卞河店）」",
       ref.cust_id("美联（卞和店）") == 2221, "实际=%r" % ref.cust_id("美联（卞和店）"))
    ck("🔴 反例 美联（保康店） → 2225（不能串到卞河店）",
       ref.cust_id("美联（保康店）") == 2225, "实际=%r" % ref.cust_id("美联（保康店）"))
    ck("🔴 反例 美联（东津店） → 2354",
       ref.cust_id("美联（东津店）") == 2354, "实际=%r" % ref.cust_id("美联（东津店）"))
    ck("🔴 反例 美联（南漳九集） → 2224",
       ref.cust_id("美联（南漳九集）") == 2224, "实际=%r" % ref.cust_id("美联（南漳九集）"))

    print()
    print("   ── 员工侧 ──")
    for eid, nm in FIX_IDS:
        ck("正例 %s → %d" % (nm, eid), ref.emp_id(nm) == eid, "实际=%r" % ref.emp_id(nm))
    ck("🔴 反例 王琴 → 2941（李琴不能抢走她）",
       ref.emp_id("王琴") == 2941, "实际=%r" % ref.emp_id("王琴"))
    ck("🔴 反例 张俊峰 → 2943", ref.emp_id("张俊峰") == 2943, "实际=%r" % ref.emp_id("张俊峰"))

    print()
    print("   ── 商品侧 ──")
    p = ref.product("蒙牛玻璃杯大号", "", "个")
    ck("正例 蒙牛玻璃杯大号 命中（单位=个）",
       p and p[0] and p[0]["name"] == "蒙牛玻璃杯大号",
       "实际=%r" % (p[0]["name"] if p and p[0] else None))
    if p and p[0]:
        ck("  命中的就是本轮新建的 1634", p[0]["id"] == 1634, "实际 id=%s" % p[0]["id"])
        ck("  单位一致（note 不是 unit_mismatch）",
           p[1] != "unit_mismatch", "note=%r unit=%r" % (p[1], p[0].get("unit")))

    # ── ④ 清理 ─────────────────────────────────────────────────────────────
    shutil.rmtree(SCRATCH, ignore_errors=True)
    print()
    print("   副本已销毁:", "无残留" if not os.path.isdir(SCRATCH) else "❌仍有残留")

    print()
    print("=" * 78)
    if FAILS:
        print("结果：%d 项失败" % len(FAILS))
        for f in FAILS:
            print("   - " + f)
        sys.exit(1)
    print("结果：全部通过")


if __name__ == "__main__":
    main()
