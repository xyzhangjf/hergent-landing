#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 部署后验收（在**生产**上以 hergent 身份跑）。

三件事：
  ① 触发 `_ensure_forecast_tables` ⇒ 给每个租户库补上 `updated_by` / `updated_at`
     （本项目的铁律：`CREATE TABLE IF NOT EXISTS` **不给已存在的表补列**，必须 ALTER）。
  ② PRAGMA 复核两列确实到位（新列缺失会让 `replace` 直接 500 —— 它 UPDATE 里就写了这两列）。
  ③ 复核新函数在导入期可见（模块已 reload，证明部署真的生效，不是"以为生效了"）。

🔴 本脚本**只做建表/补列**（幂等 DDL），不写任何业务数据。
"""
import sys

sys.path.insert(0, "/opt/hergent-erp")

import erp_db as db                                    # noqa: E402
from db.connection import set_tenant_context           # noqa: E402

NEED = {"updated_by", "updated_at"}


def main():
    if not hasattr(db, "forecast_submission_replace"):
        print("✗ 新函数 forecast_submission_replace 不存在 ⇒ 部署未生效")
        return 1
    print("✓ 模块已加载 v224 新函数 forecast_submission_replace")

    bad = 0
    for tid in (1, 9, 10):
        set_tenant_context(tid)
        try:
            with db.get_db_tx() as c:
                db._ensure_forecast_tables(c)
            with db.get_db() as c:
                cols = {r[1] for r in c.execute("PRAGMA table_info(forecast_submissions)")}
            ok = NEED <= cols
            print("  tenant_%d: %s" % (tid, "✓ 两列已就位" if ok else "✗ 缺 %s" % (NEED - cols)))
            if not ok:
                bad += 1
        except Exception as e:
            print("  tenant_%d: ✗ %s" % (tid, e))
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
