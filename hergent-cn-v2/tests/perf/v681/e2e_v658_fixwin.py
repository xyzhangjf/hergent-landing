import sqlite3
p = "/opt/hergent-erp/tenant_99.db"
c = sqlite3.connect(p)
# 期次窗口移到"今天在窗口内"，避免 save-matrix 判成"没有进行中的期次"
c.execute("update forecast_periods set order_start='2026-10-23', order_end='2026-10-29', "
          "order_start_date='2026-10-23', order_end_date='2026-10-29', arrival_date='2026-10-31' "
          "where id=1")
# 清残留（上次全失败，理论为空，仍显式清一次）
for t in ("forecast_alloc_ratio", "forecast_extra_alloc", "forecast_extra_qty",
          "forecast_submissions", "forecast_submission_items", "forecast_import_products"):
    try:
        c.execute("delete from %s" % t)
    except Exception as e:
        print("skip", t, e)
c.commit()
print(c.execute("select id,name,order_start,order_end,arrival_date,status from forecast_periods").fetchall())
print("subs=", c.execute("select count(*) from forecast_submissions").fetchone()[0])
print("far=", c.execute("select count(*) from forecast_alloc_ratio").fetchone()[0])
print("fea=", c.execute("select count(*) from forecast_extra_alloc").fetchone()[0])
c.close()
