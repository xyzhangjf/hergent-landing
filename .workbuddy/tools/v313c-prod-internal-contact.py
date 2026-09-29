# -*- coding: utf-8 -*-
"""v313c：生产 tenant_1 建「内部往来」档案 —— 内部单（XJSR / XJFY）的落脚点。

## 为什么**不走** `POST /api/contacts`（技能默认是走 API 的，这里是**有据的例外**）
`db/queries/contacts.py::CTYPE_ALIASES` 只认 `customer / supplier / both`：
  · `routers/data.py` 的 POST 端点先 `normalize_ctype(d.get("type"), default=None)`
    ⇒ 传 `internal` 会 **400**；
  · 而 `contact_create()` 的形参叫 **`contact_type`**、`type` 不在 `allowed` 白名单里
    ⇒ 就算绕过收口，`type` 也会被**静默丢弃**、落默认值 `customer`。
  ⇒ 建出来的是**一个假客户**，会混进 702 个真客户里（销售报表、客户下拉全都会带上它）
    —— 这比直连库插一行的风险大得多。

  并且**这不是开新口子**：生产库里已有 `employee` 14 个、`department` 4 个，
  这些 type 同样不在 API 白名单内 ⇒ 它们本来就不是走这个 API 建的，做法与既有惯例一致。

## 为什么必须显式给 `type='internal'` 而不是复用别的
内部收入/费用单的「往来单位」列在舟谱里**一律是 `-`**（8 月实测 3 + 96 行，100% 是 `-`）
⇒ 不是缺档案，是内部单**本来就没有外部往来单位**。但 `contact_id` 是 NOT NULL，
且**全新库**里这些单据表有 `REFERENCES contacts(id)`（老库没有，但代码要两边都站得住）
⇒ 不能写 0。挂到一个显式命名的档案上，报表里一眼可辨，用户改名也不用改代码。

用法（在服务器上）：
    /usr/bin/python3 v313c-prod-internal-contact.py           # dry-run（默认）
    /usr/bin/python3 v313c-prod-internal-contact.py --apply   # 真写
"""
import os
import sqlite3
import sys
import time

BASE = "/opt/hergent-erp"
TENANT_DB = os.path.join(BASE, "tenant_1.db")
NAME = "内部往来"
CTYPE = "internal"

APPLY = "--apply" in sys.argv
FAILS = []


def ck(label, cond, extra=""):
    if not cond:
        FAILS.append(label)
    print("   %s %s%s" % ("PASS" if cond else "FAIL", label,
                          ("  " + str(extra)) if extra else ""))
    return cond


def main():
    print("=" * 78)
    print("v313c 建「%s」档案   模式 = %s"
          % (NAME, "真写 --apply" if APPLY else "dry-run（不写）"))
    print("=" * 78)

    # ── 0) 前置断言 ────────────────────────────────────────────────────────
    print()
    print("[0] 前置断言")
    r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    dup = r.execute("SELECT id,name,type FROM contacts WHERE name=?", (NAME,)).fetchall()
    ck("同名档案不存在（不重复建）", not dup, "已存在=%r" % (dup,))
    # 顺便确认「type 白名单不支持 internal」这个例外前提仍然成立
    print("   （例外前提：contacts 现有 type 分布 = %r）"
          % (dict(r.execute("SELECT type,COUNT(*) FROM contacts GROUP BY type").fetchall()),))
    r.close()

    # ── 1) 备份 ────────────────────────────────────────────────────────────
    print()
    print("[1] 备份")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    bk = os.path.join(BASE, "backups",
                      "tenant_1.db.before-v313c-internal-%s.bak" % stamp)
    if APPLY:
        os.makedirs(os.path.dirname(bk), exist_ok=True)
        src = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        dst = sqlite3.connect(bk)
        src.backup(dst)
        dst.close()
        src.close()
        ck("备份已生成且非空", os.path.getsize(bk) > 100000,
           "%s (%.1f MB)" % (bk, os.path.getsize(bk) / 1048576.0))
    else:
        print("   （dry-run 跳过；真跑时会生成 %s）" % bk)

    # ── 2) 插入（只填必要字段，业务字段一律不填 ⇒ 不污染客户/供应商主数据）──────
    print()
    print("[2] 插入档案")
    if APPLY:
        w = sqlite3.connect(TENANT_DB)
        w.execute("PRAGMA busy_timeout=8000")
        w.execute("BEGIN IMMEDIATE")
        cur = w.execute(
            "INSERT INTO contacts (name, type, is_active, source, "
            "created_at, updated_at) VALUES (?,?,1,?,"
            "datetime('now','localtime'),datetime('now','localtime'))",
            (NAME, CTYPE, "zhoupu_import"))
        new_id = cur.lastrowid
        w.commit()
        w.close()
        ck("插入成功（rowcount==1）", cur.rowcount == 1, "id=%d" % new_id)
    else:
        print("   （dry-run 跳过；真跑时会 INSERT 一行 name=%r type=%r）" % (NAME, CTYPE))
        new_id = None

    # ── 3) 验证 ────────────────────────────────────────────────────────────
    print()
    print("[3] 验证")
    if APPLY:
        r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        v = r.execute("SELECT id,name,type,is_active FROM contacts WHERE name=?",
                      (NAME,)).fetchone()
        ck("档案已存在且 type == %r" % CTYPE, bool(v) and v[2] == CTYPE,
           "实际=%r" % (v,))
        ck("启用中（is_active=1）", bool(v) and v[3] == 1)
        # 边界：不能被当成客户或供应商
        bad = r.execute("SELECT COUNT(*) FROM contacts WHERE name=? AND type IN "
                        "('customer','supplier')", (NAME,)).fetchone()[0]
        ck("没有混入客户/供应商主数据", bad == 0, "命中 %d" % bad)
        # 边界：既有的 702 客户 / 38 供应商 原样
        for ty, exp in (("customer", 702), ("supplier", 38)):
            n = r.execute("SELECT COUNT(*) FROM contacts WHERE type=?", (ty,)).fetchone()[0]
            ck("%s 数量未变（%d）" % (ty, exp), n == exp, "实际 %d" % n)
        r.close()

    print()
    print("=" * 78)
    if FAILS:
        print("结果：%d 项失败" % len(FAILS))
        for f in FAILS:
            print("   - " + f)
        sys.exit(1)
    print("结果：全部通过" + ("（已真写）" if APPLY else "（dry-run，未写任何数据）"))


if __name__ == "__main__":
    main()
