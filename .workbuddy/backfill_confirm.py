import sqlite3, os, datetime

DB_DIR = "/opt/hergent-erp"
targets = ["tenant_1.db", "tenant_10.db"]

def backfill(db_path):
    c = sqlite3.connect(os.path.join(DB_DIR, db_path))
    c.row_factory = sqlite3.Row
    names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    if "forecast_period_confirm" not in names:
        c.close()
        return []
    if "forecast_submissions" not in names:
        c.close()
        return []
    periods = [dict(r) for r in c.execute("SELECT order_start, order_end FROM forecast_periods")]
    todos = []
    for p in periods:
        ps, pe = p["order_start"], p["order_end"]
        n = c.execute(
            "SELECT COUNT(*) FROM forecast_submissions WHERE role='导入' AND order_date BETWEEN ? AND ? AND status!='rejected'",
            (ps, pe),
        ).fetchone()[0]
        if n > 0 and not c.execute(
            "SELECT 1 FROM forecast_period_confirm WHERE period_start=? AND period_end=?", (ps, pe)
        ).fetchone():
            maxts = c.execute(
                "SELECT MAX(created_at) FROM forecast_submissions WHERE role='导入' AND order_date BETWEEN ? AND ?",
                (ps, pe),
            ).fetchone()[0]
            todos.append((ps, pe, maxts))
    dts = [r[0] for r in c.execute(
        "SELECT DISTINCT order_date FROM forecast_submissions WHERE role='导入' AND status!='rejected' ORDER BY order_date"
    )]
    for od in dts:
        if any(p["order_start"] <= od <= p["order_end"] for p in periods):
            continue
        if not c.execute(
            "SELECT 1 FROM forecast_period_confirm WHERE period_start=? AND period_end=?", (od, od)
        ).fetchone():
            n = c.execute(
                "SELECT COUNT(*) FROM forecast_submissions WHERE role='导入' AND order_date=? AND status!='rejected'",
                (od,),
            ).fetchone()[0]
            if n > 0:
                maxts = c.execute(
                    "SELECT MAX(created_at) FROM forecast_submissions WHERE role='导入' AND order_date=?", (od,)
                ).fetchone()[0]
                todos.append((od, od, maxts))
    done = []
    for ps, pe, ts in todos:
        c.execute(
            "INSERT OR IGNORE INTO forecast_period_confirm (period_start, period_end, confirmed_by, confirmed_at) VALUES (?,?,?,?)",
            (ps, pe, "系统回填", ts or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        done.append((db_path, ps, pe, ts))
    c.commit()
    c.close()
    return done

if __name__ == "__main__":
    total = 0
    for db in targets:
        done = backfill(db)
        for d in done:
            print("INSERT %s (%s,%s) at=%s" % d)
            total += 1
    print("TOTAL_INSERTED", total)
