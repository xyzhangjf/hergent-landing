#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v346 本地沙箱端到端验收（真实 `/api/import/preview` 端点，库是**副本**）。

隔离声明：
  · 库指向 `/tmp/v346-sandbox/erp.db`（`ERP_DB_PATH` 是唯一切库开关，
    `db/connection.py` 里 `DB_PATH` 与 `DB_DIR` 由它派生 ⇒ 租户库也落在沙箱目录）。
  · **不碰生产**、不碰本仓 `server/erp.db`；身份是进程内桩（不打生产接口）。
  · 唯一"写"发生在沙箱副本库（只写 `import_mapping_memory`，不写任何业务表）。

被测 = v346 的两个交付点：
  ① 危险列标注（`validation.risky_columns` / `risky_detail` / `warnings`）
  ② 「记忆命中即可直接确认」判据（`remembered.direct_ok` / `block_reason`）

🔴 判别力自证：E 组三处**单点回退**，每处都必须让对应断言失败 ——
   全跑通而 E 组也"全过" ⇒ 探针无效。
"""
import io
import json
import os
import sqlite3
import sys

SANDBOX_DB = "/tmp/v346-sandbox/erp.db"
os.environ["ERP_DB_PATH"] = SANDBOX_DB
os.environ.setdefault("ERP_SECRET", "sandbox-only-not-a-secret")
os.environ.setdefault("DEEPSEEK_API_KEY", "sandbox-dummy-never-used")
os.environ["LOGIN_SCOPE_ENFORCE"] = "0"
sys.path.insert(0, os.getcwd())

import openpyxl                                     # noqa: E402
from fastapi.testclient import TestClient           # noqa: E402

import server as S                                  # noqa: E402
import core as C                                    # noqa: E402
import routers.import_router as IR                  # noqa: E402

FAKE = {"id": 1, "username": "sandbox", "display_name": "沙箱", "role": "admin"}
C._get_user = lambda r: FAKE
C._auth = lambda r: FAKE
C._check_perm = lambda user, module, action="read", tenant_id=None: True
C.user_effective_readonly = lambda user: False
C.tenant_is_readonly = lambda tid: False
S._get_user = lambda r: FAKE
IR._auth = lambda r: FAKE
IR._ai_guess_mapping = lambda headers, category: {}      # 关大模型兜底 ⇒ 可复现
if hasattr(S, "db"):
    S.db.check_user_tenant = lambda uid, tid: True

HDR = {"X-Tenant-Id": "1", "Authorization": "Bearer sandbox"}
checks = []


def chk(name, cond, detail=""):
    checks.append((name, bool(cond), detail))
    print("  %-64s %-8s %s" % (name, "OK" if cond else "**FAIL**", detail))


def xlsx(rows, sheet_title=None):
    wb = openpyxl.Workbook()
    ws = wb.active
    if sheet_title:
        ws.append([sheet_title])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def preview(client, content, category="inventory"):
    r = client.post("/api/import/preview", data={"category": category},
                    files={"file": ("t.xlsx", content, "application/octet-stream")}, headers=HDR)
    if r.status_code != 200:
        print("     [诊断] HTTP=%s 响应体=%s" % (r.status_code, r.text[:300]))
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {}


def seed_memory(category, rows):
    """往沙箱副本的记忆表**直接**写一条（不跑 execute ⇒ 零业务副作用）。

    🔴 必须**显式切到租户库上下文**：`db.get_db()` 走的是
       `_tenant_db.get() or DB_PATH`，而 `_tenant_db` 是**请求期 contextvar**。
       在请求外直接调用 ⇒ 落到主库 `erp.db`，而 `/preview` 在请求内读的是
       `tenant_1.db` ⇒ **记忆永远不命中**，看起来像"功能没做"。
       （第一次跑本脚本就栽在这里：`remembered` 恒为 `{}`。）
    """
    headers = rows[0]
    fp = IR._headers_fingerprint(headers)
    mapping = {str(i): f for i, f in IR._guess_mapping(headers, category).items()}
    IR.db.set_tenant_context(1)
    try:
        with IR.db.get_db() as conn:
            IR._ensure_import_memory_tables(conn)
            conn.commit()
            IR._memory_save(conn, category, fp, headers, mapping, "sandbox")
            conn.commit()
    finally:
        IR.db.set_tenant_context(None)
    return fp, mapping


# ── 三份素材 ────────────────────────────────────────────────────────────────
CLEAN = [["商品名称", "规格", "单位", "数量", "成本价"],
         ["沙箱验收品A", "1*10", "件", 10, 9.5]]
DANGER_REC = [["商品名称", "金额", "到期日"],
              ["沙箱验收品A", 1000, "2026-10-31"]]
DANGER_INV = [["门店名称", "数量", "批次"],
              ["沙箱某门店", 10, "P20260901"]]

with TestClient(S.app) as client:
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 A：干净模板（无记忆）—— 必须**零危险列**")
    print("=" * 86)
    st, d = preview(client, xlsx(CLEAN))
    v = d.get("validation") or {}
    print("  HTTP=%s headers=%s" % (st, d.get("headers")))
    print("  risky_columns=%s risky_detail=%s remembered=%s"
          % (v.get("risky_columns"), v.get("risky_detail"), d.get("remembered")))
    chk("A1 preview HTTP=200", st == 200, "实测=%s" % st)
    chk("A2 risky_columns == 0", v.get("risky_columns") == 0, "实测=%s" % v.get("risky_columns"))
    chk("A3 risky_detail 为空数组", v.get("risky_detail") == [], "实测=%r" % (v.get("risky_detail"),))
    chk("A4 没有「识别不确定」告警",
        not any("识别不确定" in str(w) for w in (v.get("warnings") or [])),
        "warnings=%s" % (v.get("warnings") or []))
    chk("A5 首次无记忆 ⇒ remembered 为 None", d.get("remembered") in (None, {}),
        "实测=%r" % (d.get("remembered"),))

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 B：应收表带「商品名称」列 —— 必须**标出 1 列危险**并显著提示")
    print("=" * 86)
    st, d = preview(client, xlsx(DANGER_REC), "receivables")
    v = d.get("validation") or {}
    det = v.get("risky_detail") or []
    print("  HTTP=%s 映射=%s" % (st, {s["header"]: s["suggested_field"] for s in (d.get("suggestions") or [])}))
    print("  risky_columns=%s" % v.get("risky_columns"))
    for x in det:
        print("     · %s → %s (%s)：%s" % (x["header"], x["field"], x["risk"], x["reason"]))
    chk("B1 risky_columns == 1", v.get("risky_columns") == 1, "实测=%s" % v.get("risky_columns"))
    chk("B2 点名的是「商品名称」列", [x["header"] for x in det] == ["商品名称"],
        "实测=%s" % [x["header"] for x in det])
    chk("B3 risk == generic", det and det[0].get("risk") == "generic",
        "实测=%s" % (det[0].get("risk") if det else None))
    chk("B4 命中字段是 contact_name（语义被抢）", det and det[0].get("field") == "contact_name",
        "实测=%s" % (det[0].get("field") if det else None))
    chk("B5 提示语点名「客户名称」（不是甩英文字段名）",
        det and "客户名称" in str(det[0].get("reason")),
        "实测=%s" % (det[0].get("reason") if det else None))
    chk("B6 warnings 里有「有 1 列识别不确定」",
        any("识别不确定" in str(w) for w in (v.get("warnings") or [])),
        "warnings=%s" % (v.get("warnings") or []))
    chk("B7 干净的两列（金额/到期日）没被误标",
        all(x["header"] not in ("金额", "到期日") for x in det), "实测=%s" % [x["header"] for x in det])

    print("\n" + "=" * 86)
    print("场景 B2：库存表带「门店名称」列 —— 反向（客户名被商品名吞掉）")
    print("=" * 86)
    st, d = preview(client, xlsx(DANGER_INV))
    v = d.get("validation") or {}
    det = v.get("risky_detail") or []
    for x in det:
        print("     · %s → %s (%s)：%s" % (x["header"], x["field"], x["risk"], x["reason"]))
    chk("B8 risky_columns == 1 且点名「门店名称」",
        v.get("risky_columns") == 1 and [x["header"] for x in det] == ["门店名称"],
        "实测=%s / %s" % (v.get("risky_columns"), [x["header"] for x in det]))

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 C：记忆命中 + 无危险列 ⇒ **direct_ok=True**（可跳过映射页）")
    print("=" * 86)
    _fp, _mp = seed_memory("inventory", CLEAN)
    print("  已种记忆：category=inventory fp=%s mapping=%s" % (_fp, _mp))
    st, d = preview(client, xlsx(CLEAN))
    v = d.get("validation") or {}
    rm = d.get("remembered") or {}
    print("  remembered=%s" % rm)
    # 干净库存模板 5 列里「规格」「单位」在 inventory 类目没有对应字段 ⇒ 记忆只有 3 条
    chk("C1 remembered.applied == 3（已识别的列全按记忆回填）", rm.get("applied") == 3,
        "实测=%s" % rm.get("applied"))
    _mapped = [s for s in (d.get("suggestions") or []) if s.get("suggested_field")]
    chk("C2 有映射的列 confidence 全为 memory，未识别的仍为 low",
        _mapped and all(s.get("confidence") == "memory" for s in _mapped)
        and all(s.get("confidence") == "low"
                for s in (d.get("suggestions") or []) if not s.get("suggested_field")),
        "实测=%s（有映射 %d 列）" % (sorted({s.get("confidence") for s in (d.get("suggestions") or [])}), len(_mapped)))
    chk("C3 direct_ok is True", rm.get("direct_ok") is True, "实测=%r" % (rm.get("direct_ok"),))
    chk("C4 block_reason 为空串", rm.get("block_reason") == "", "实测=%r" % (rm.get("block_reason"),))
    chk("C5 risky_columns == 0", v.get("risky_columns") == 0, "实测=%s" % v.get("risky_columns"))

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 D：记忆命中但**有危险列** ⇒ direct_ok=False（拦住）")
    print("=" * 86)
    seed_memory("receivables", DANGER_REC)
    st, d = preview(client, xlsx(DANGER_REC), "receivables")
    rm = d.get("remembered") or {}
    v = d.get("validation") or {}
    print("  remembered=%s risky_columns=%s" % (rm, v.get("risky_columns")))
    chk("D1 remembered 命中", rm.get("applied"), "实测=%s" % rm.get("applied"))
    chk("D2 direct_ok is False", rm.get("direct_ok") is False, "实测=%r" % (rm.get("direct_ok"),))
    chk("D3 block_reason 说明「有几列识别不确定」",
        "识别不确定" in str(rm.get("block_reason")), "实测=%r" % (rm.get("block_reason"),))

    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 D2：收款流水（唯一改账目类目）⇒ 永远必须过目，与记忆/危险列无关")
    print("=" * 86)
    PAY = [["客户名称", "回款金额", "回款日期", "收款方式"],
           ["沙箱某门店", 500, "2026-09-30", "微信"]]
    seed_memory("payment_receipts", PAY)
    st, d = preview(client, xlsx(PAY), "payment_receipts")
    rm = d.get("remembered") or {}
    v = d.get("validation") or {}
    print("  remembered=%s risky_columns=%s" % (rm, v.get("risky_columns")))
    chk("D4 收款流水 risky_columns == 0（本身干净）", v.get("risky_columns") == 0,
        "实测=%s" % v.get("risky_columns"))
    chk("D5 但 direct_ok is False（改账目的接口不直通）", rm.get("direct_ok") is False,
        "实测=%r" % (rm.get("direct_ok"),))
    chk("D6 block_reason 说明「会改动已有账目」",
        "改动已有账目" in str(rm.get("block_reason")), "实测=%r" % (rm.get("block_reason"),))

    print("\n" + "=" * 86)
    print("场景 D3：报单矩阵（客户列每期变）⇒ 同样拦住；无记忆时不给 direct_ok 键")
    print("=" * 86)
    CROSS = [["商品名称", "规格", "单位", "沙箱某门店A", "沙箱某门店B"],
             ["沙箱验收品A", "1*10", "件", 10, 20]]
    seed_memory("forecast_cross", CROSS)
    st, d = preview(client, xlsx(CROSS), "forecast_cross")
    rm = d.get("remembered") or {}
    print("  remembered=%s" % rm)
    chk("D7 报单矩阵 direct_ok is False", rm.get("direct_ok") is False,
        "实测=%r" % (rm.get("direct_ok"),))
    chk("D8 block_reason 说明「客户列每期都在变」",
        "每期都在变" in str(rm.get("block_reason")), "实测=%r" % (rm.get("block_reason"),))

    st, d = preview(client, xlsx([["商品名称", "数量"], ["沙箱验收品A", 1]]), "inventory")
    rm2 = d.get("remembered") or {}
    chk("D9 无记忆时 remembered 为 None ⇒ 不给 direct_ok（前端不能直通）",
        rm2 in (None, {}) and "direct_ok" not in rm2, "实测=%r" % (rm2,))

    # ══════════════════════════════════════════════════════════════════════
    # E 组：单点回退对照（判别力自证）
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 86)
    print("场景 E1：回退 `_annotate_column_risks` 为**什么都不做** ⇒ B 组断言必须失败")
    print("=" * 86)
    _real_annot = IR._annotate_column_risks
    IR._annotate_column_risks = lambda s, h, c: s
    st, d = preview(client, xlsx(DANGER_REC), "receivables")
    v = d.get("validation") or {}
    print("  risky_columns=%s（应为 0 ⇒ 说明断言确实依赖被测函数）" % v.get("risky_columns"))
    chk("E1 复现：回退后 risky_columns 掉到 0（⇒ B1 会失败，断言有判别力）",
        v.get("risky_columns") == 0, "实测=%s" % v.get("risky_columns"))
    st, d = preview(client, xlsx(DANGER_REC), "receivables")
    rm = d.get("remembered") or {}
    chk("E1b 复现：回退后 direct_ok 变回 True（⇒ D2 会失败）", rm.get("direct_ok") is True,
        "实测=%r" % (rm.get("direct_ok"),))
    IR._annotate_column_risks = _real_annot

    print("\n" + "=" * 86)
    print("场景 E2：回退 `_annotate_column_risks` 为**无脑全标** ⇒ A 组断言必须失败")
    print("=" * 86)
    def _annot_all(s, h, c):
        for _x in s:
            if _x.get("suggested_field"):
                _x["risk"] = "generic"
                _x["risk_reason"] = "sandbox: 全标"
        return s
    IR._annotate_column_risks = _annot_all
    st, d = preview(client, xlsx(CLEAN))
    v = d.get("validation") or {}
    # 干净库存模板 5 列里，「规格」「单位」在 inventory 类目**没有对应字段** ⇒ 未识别
    # ⇒ 全标后只会有 3 列被标（不是 5）。这个数字写死，防止断言变成"随便什么值都过"。
    print("  risky_columns=%s（应为 3 = 5 列中已识别的列数）" % v.get("risky_columns"))
    chk("E2 复现：无脑全标后干净模板 risky_columns == 3（⇒ A2 会失败）",
        v.get("risky_columns") == 3, "实测=%s" % v.get("risky_columns"))
    IR._annotate_column_risks = _real_annot

    print("\n" + "=" * 86)
    print("场景 E3：把 `_DIRECT_CONFIRM_EXCLUDED` 清空 ⇒ 收款流水断言必须失败")
    print("=" * 86)
    _real_ex = IR._DIRECT_CONFIRM_EXCLUDED
    IR._DIRECT_CONFIRM_EXCLUDED = ()
    st, d = preview(client, xlsx(PAY), "payment_receipts")
    rm = d.get("remembered") or {}
    print("  direct_ok=%r（应为 True ⇒ 说明 D5 确实在测排除清单）" % (rm.get("direct_ok"),))
    chk("E3 复现：清空排除清单后收款流水 direct_ok 变 True（⇒ D5 会失败）",
        rm.get("direct_ok") is True, "实测=%r" % (rm.get("direct_ok"),))
    IR._DIRECT_CONFIRM_EXCLUDED = _real_ex

    print("\n" + "=" * 86)
    print("场景 E4：复查（回退全部还原后）B1/C3/D5 复现原值")
    print("=" * 86)
    st, d = preview(client, xlsx(DANGER_REC), "receivables")
    chk("E4a 还原后 risky_columns 回到 1",
        (d.get("validation") or {}).get("risky_columns") == 1,
        "实测=%s" % (d.get("validation") or {}).get("risky_columns"))
    st, d = preview(client, xlsx(CLEAN))
    chk("E4b 还原后干净模板 direct_ok 回到 True",
        (d.get("remembered") or {}).get("direct_ok") is True,
        "实测=%r" % (d.get("remembered") or {}).get("direct_ok"))
    st, d = preview(client, xlsx(PAY), "payment_receipts")
    chk("E4c 还原后收款流水 direct_ok 回到 False",
        (d.get("remembered") or {}).get("direct_ok") is False,
        "实测=%r" % (d.get("remembered") or {}).get("direct_ok"))

# ── 收尾自证：只写了记忆表，且写在**租户库**（不是主库）────────────────────
print("\n" + "=" * 86)
_res = {}
for _f in ("erp.db", "tenant_1.db"):
    _p = os.path.join(os.path.dirname(SANDBOX_DB), _f)
    _c = sqlite3.connect(_p)
    try:
        _res[_f] = _c.execute("SELECT COUNT(*) FROM import_mapping_memory").fetchone()[0]
    except Exception as _e:
        _res[_f] = "无此表(%s)" % str(_e)[:28]
    finally:
        _c.close()
print("沙箱记忆表行数：主库 erp.db=%s / 租户库 tenant_1.db=%s" % (_res["erp.db"], _res["tenant_1.db"]))
_c = sqlite3.connect(os.path.join(os.path.dirname(SANDBOX_DB), "tenant_1.db"))
try:
    _cats = [r[0] for r in _c.execute(
        "SELECT DISTINCT category FROM import_mapping_memory ORDER BY category").fetchall()]
finally:
    _c.close()
print("租户库里的类目=%s" % _cats)
chk("F1 记忆写在**租户库** tenant_1.db（4 个类目），主库没有这张表/没有行",
    _res["tenant_1.db"] == 4 and not isinstance(_res["erp.db"], int),
    "实测=%s" % _res)

bad = [c for c in checks if not c[1]]
print("\n总判定：%d / %d 通过" % (len(checks) - len(bad), len(checks)))
if bad:
    print("未通过项：")
    for n, _, dt in bad:
        print("  · %s   %s" % (n, dt))
print("=" * 86)
sys.exit(1 if bad else 0)
