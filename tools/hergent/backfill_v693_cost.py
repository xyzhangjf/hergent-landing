#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693 回填：把 v693 之前落库的 ai_usage_v2 行补上成本与峰谷。

为什么必须回填：那几行是 v692 写的，`est_cost_cny` 用的是 DEFAULT 0。
不回填，「本月已用」会显示 0 积分，而实际已经花掉约 30 积分 ——
界面上就是以假数字示人，比不显示更糟。

怎么回填（都是可推导的，不是拍数）：
  - 缓存命中：用 `_cache_hit_ratio(prompt_tokens)` 同一套插值；
  - 峰谷：用该行 `created_at`（localtime = 北京时间）反查当时的时段；
  - 成本：用 `estimate_cost_cny` 的同一公式。

幂等：只处理 `est_cost_cny = 0 AND (prompt_tokens>0 OR completion_tokens>0)`
的行。新代码写入的行成本必然 > 0，所以重复跑不会覆盖真值。
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, "/opt/hergent-erp")

BJ = timezone(timedelta(hours=8))
DB = Path("/opt/hergent-erp/erp.db")


def main() -> int:
    import sqlite3
    import erp_db as db
    from routers.ai_assist import estimate_cost_cny, is_peak_now

    c = sqlite3.connect(str(DB))
    c.row_factory = sqlite3.Row
    rows = c.execute(
        "SELECT id, tenant_id, prompt_tokens, completion_tokens, created_at "
        "FROM ai_usage_v2 "
        "WHERE COALESCE(est_cost_cny,0)=0 "
        "AND (COALESCE(prompt_tokens,0)>0 OR COALESCE(completion_tokens,0)>0)"
    ).fetchall()
    if not rows:
        print("没有需要回填的行（已全部有成本）")
        return 0

    print("待回填 %d 行：" % len(rows))
    for r in rows:
        at = None
        try:
            at = datetime.strptime(str(r["created_at"]), "%Y-%m-%d %H:%M:%S").replace(tzinfo=BJ)
        except Exception:
            pass
        peak = is_peak_now(at) if at else False
        cost, hit, _ = estimate_cost_cny(r["prompt_tokens"], r["completion_tokens"], peak=peak)
        c.execute(
            "UPDATE ai_usage_v2 SET cache_read_tokens=?, is_peak=?, est_cost_cny=? WHERE id=?",
            (int(hit), 1 if peak else 0, float(cost), int(r["id"])),
        )
        print("  id=%-4s %s prompt=%-9s 命中≈%-8s 峰谷=%s 成本=¥%.6f 积分=%d"
              % (r["id"], r["created_at"], r["prompt_tokens"], hit,
                 "高峰" if peak else "闲时", cost, round(cost * 100)))
    c.commit()

    tot = c.execute(
        "SELECT COUNT(*), ROUND(SUM(est_cost_cny),6) FROM ai_usage_v2 WHERE COALESCE(est_cost_cny,0)>0"
    ).fetchone()
    print("\n回填后：%d 行有成本，合计 ¥%s（≈ %d 积分）"
          % (tot[0], tot[1], round(float(tot[1] or 0) * 100)))
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
