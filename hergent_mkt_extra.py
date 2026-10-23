

# ===== v638（P2 市场区）：3 个有表的营销模块只读列表端点，fail-safe 回落空 =====
# 注：/mkt 23 页中仅 order_templates / visit_plans / promotions 真实存在表，其余无表（诚实空态）。
@router.get("/reports/mkt-order-templates")
def mkt_order_templates(request: Request):
    u = _auth(request)
    try:
        conn = db._connect(); c = conn.cursor()
        c.execute("SELECT t.id,t.name,COALESCE(c.name,'未指定') AS customer_name,t.user_id "
                  "FROM order_templates t LEFT JOIN contacts c ON c.id=t.customer_id "
                  "ORDER BY t.id DESC")
        rows = [dict(r) for r in c.fetchall()]; conn.close()
        return {"rows": rows}
    except Exception as e:
        logging.getLogger("hergent").warning(f"mkt_order_templates failed: {e}")
        return {"rows": []}


@router.get("/reports/mkt-visit-plans")
def mkt_visit_plans(request: Request):
    u = _auth(request)
    try:
        conn = db._connect(); c = conn.cursor()
        c.execute("SELECT id,plan_date,salesperson,created_at FROM visit_plans "
                  "ORDER BY plan_date DESC, id DESC")
        rows = [dict(r) for r in c.fetchall()]; conn.close()
        return {"rows": rows}
    except Exception as e:
        logging.getLogger("hergent").warning(f"mkt_visit_plans failed: {e}")
        return {"rows": []}


@router.get("/reports/mkt-promotions")
def mkt_promotions(request: Request):
    u = _auth(request)
    try:
        conn = db._connect(); c = conn.cursor()
        c.execute("SELECT id,name,start_date,end_date,discount_pct,bonus_qty,is_active,"
                  "promo_type,buy_qty,free_qty,gift_product_name,gift_qty FROM promotions "
                  "ORDER BY id DESC")
        rows = [dict(r) for r in c.fetchall()]; conn.close()
        return {"rows": rows}
    except Exception as e:
        logging.getLogger("hergent").warning(f"mkt_promotions failed: {e}")
        return {"rows": []}
