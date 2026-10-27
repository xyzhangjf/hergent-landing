"""0002 · 补齐租户库缺失的索引（索引结构对齐主库）。

## 为什么需要这一版

`_safe_migrate()` 是在**模块导入期**跑的一次性 DDL，它只在"主库这条迁移没跑过"
时才执行。租户库的结构由 `tenant_db_init()` 在**创建那一刻**按当时的主库
`iterdump()` 复制 —— 之后主库新增的索引**不会**自己长到租户库上。
2026-10-27 体检（`python3 -m migrations.doctor`）实测：

| 库 | 缺索引 | 其中唯一索引 |
|---|---|---|
| `tenant_1`  | 4 | `idx_caliber_pk_bk` |
| `tenant_10` | 9 | `idx_caliber_pk_bk`、`uq_product_target_month` |

**唯一索引缺失比普通索引严重**：普通索引丢了只是慢；唯一索引丢了，
代码以为"一个月一个商品一条目标"，实际可以写进两条，此后所有按
`(period_month, product_id)` 取一行的逻辑都会静默取到其中一条。

## 建之前必须先证伪的事

唯一索引建不上会直接报错并整版回滚（这是对的，不能悄悄降级成普通索引）。
所以建之前先实测重复行：

    SELECT param_key, bucket, COUNT(*) FROM industry_caliber
     GROUP BY param_key, bucket HAVING COUNT(*) > 1;
    SELECT period_month, product_id, COUNT(*) FROM product_targets
     GROUP BY period_month, product_id HAVING COUNT(*) > 1;

2026-10-27 实测：`erp.db` / `tenant_1.db` / `tenant_10.db` 三台库**均为 0 行重复、
0 行 NULL**（`NULL` 在 SQLite 唯一索引里互不冲突，但 NULL 行同样不该存在，
因为它意味着"没定月份的目标"，那条目标永远不会被匹配到）。

## 三条约定（与本包 README 一致）

1. **可重入**：全部 `IF NOT EXISTS`。同一版在已有索引的库上跑是空操作 ——
   主库本来就有这 9 个索引，`--apply` 到主库必须无事发生。
2. **不信任 `IF NOT EXISTS`**：执行完逐条回读 `sqlite_master` 核对，
   并核对该是唯一索引的确实是 `UNIQUE`（同名但非唯一的索引会让 `IF NOT EXISTS`
   静默跳过，这是唯一会产生"看起来成功"的路径）。核对不过就整版回滚。
3. **表不存在就跳过并记账**：不硬报错。缺表属于另一个问题（doctor 的「缺表」
   那一类），混在本版里会让根因变模糊；跳过项写进 `schema_patches.note`。
"""

# (索引名, 表名, 建索引语句, 是否唯一)
INDEXES = [
    ("idx_admin_audit_created", "admin_audit",
     "CREATE INDEX IF NOT EXISTS idx_admin_audit_created"
     " ON admin_audit(created_at DESC, id DESC)", False),
    ("idx_admin_audit_target", "admin_audit",
     "CREATE INDEX IF NOT EXISTS idx_admin_audit_target"
     " ON admin_audit(target_type, target_id)", False),
    ("idx_caliber_pk_bk", "industry_caliber",
     "CREATE UNIQUE INDEX IF NOT EXISTS idx_caliber_pk_bk"
     " ON industry_caliber(param_key, bucket)", True),
    ("idx_prc_user_open", "password_reset_codes",
     "CREATE INDEX IF NOT EXISTS idx_prc_user_open"
     " ON password_reset_codes(user_id, used_at)", False),
    ("ix_fte_doc", "forecast_template_exports",
     "CREATE INDEX IF NOT EXISTS ix_fte_doc"
     " ON forecast_template_exports (prefix, arrival_date, seq_from, seq_to)", False),
    ("ix_fte_fp", "forecast_template_exports",
     "CREATE INDEX IF NOT EXISTS ix_fte_fp"
     " ON forecast_template_exports (period_id, arrival_date, prefix, fingerprint)", False),
    ("idx_pta_emp", "product_target_alloc",
     "CREATE INDEX IF NOT EXISTS idx_pta_emp ON product_target_alloc(employee_id)", False),
    ("idx_pt_month", "product_targets",
     "CREATE INDEX IF NOT EXISTS idx_pt_month ON product_targets(period_month, status)", False),
    ("uq_product_target_month", "product_targets",
     "CREATE UNIQUE INDEX IF NOT EXISTS uq_product_target_month"
     " ON product_targets(period_month, product_id)", True),
]


def _table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _index_sql(conn, name):
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)
    ).fetchone()
    return row[0] if row else None


def upgrade(conn):
    created, skipped = [], []
    for name, table, ddl, unique in INDEXES:
        if not _table_exists(conn, table):
            # 缺表不归本版管（doctor 的「缺表」那一类），但必须留痕
            skipped.append("%s(无表 %s)" % (name, table))
            continue
        existed = _index_sql(conn, name) is not None
        conn.execute(ddl)
        created.append("%s%s" % (name, "" if existed else "*"))

    # —— 回报核对：不信任 IF NOT EXISTS ——
    for name, table, _ddl, unique in INDEXES:
        if not _table_exists(conn, table):
            continue
        sql = _index_sql(conn, name)
        if sql is None:
            raise RuntimeError("索引 %s 执行后仍不存在" % name)
        if unique and "UNIQUE" not in sql.upper():
            # 同名非唯一索引存在时会走到这里：IF NOT EXISTS 静默跳过了
            raise RuntimeError(
                "索引 %s 应为 UNIQUE，实际为：%s —— 需人工删掉同名非唯一索引后重跑"
                % (name, sql))

    note = "核对通过 %d/%d；新建=%s" % (
        len(INDEXES) - len(skipped), len(INDEXES),
        ",".join(n for n in created if n.endswith("*")) or "无（已全部存在）")
    if skipped:
        note += "；跳过=%s" % ",".join(skipped)
    return note
