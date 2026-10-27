# 版本化迁移（migrations）

本目录是**结构变更的唯一合法入口**。从此以后：

> ❌ 不要再往 `erp_db.py` 里加 `_safe_migrate(...)` / `_safe_migrate_script(...)`
> ✅ 新变更写成 `patches/0002_你的改动.sql`（或 `.py`）

（`erp_db.py` 里现存的 **389 处**历史调用已于 2026-10-27（v706）**冻结成基线**，
明细在 `legacy_baseline.txt`。它们继续照旧运行，但**不许再增加、也不许改动内容**：
`tools/hergent/v706/inventory_safe_migrate.py --check` 会拦下这两类动作。）

> 冻结 ≠ 收编成版本。把那 389 条逐个改写成 patch 是**负收益**：它们对应的 DDL 早在生产
> 跑过，改写只会让"哪台库跑过哪一版"重新变得不可判定。真正要治的是两条静默病：
> ① 改了历史迁移不会重跑也不报错；② 新 DDL 绕过版本管理。两者都能在源码层面机械判定，
> 见下文「存量冻结」。

---

## 为什么要有这个东西

旧机制 `_migrations` 只记 `(name, status)`，于是有两个永远不会报错的窟窿：

1. **改过的迁移不会重跑、也不会报错。** 名字没变 ⇒ 判定"已执行" ⇒ 直接 return。
   结果：一台老库按旧 SQL、一台新库按新 SQL，**两台都声称 ok，结构却不同**。
2. **没有版本与顺序。** 无法回答「这台库是第几版」「哪台落后了」「两台一样吗」。

本目录用 `schema_patches` 补上 `checksum` 与版本号。规则只有一条：

> **同一个版本号的内容指纹一旦变了，运行器直接失败。**
> 要改，就新增一个版本号。历史不可改写。

---

## 目录

```
migrations/
├── runner.py            版本化运行器（--status / --apply）
├── doctor.py            结构体检（只读，主库 vs 各租户库）
├── dbutil.py            路径解析 / 连接 / 结构快照与指纹
├── platform_tables.txt  主库独有的平台级表清单（体检时排除，需人工 review）
├── legacy_platform_copies.txt  遗留平台表副本清单（现在是**回归探测器**：出现即报警）
├── legacy_baseline.txt  `_safe_migrate` 存量基线（389 条迁移的内容指纹，v706 冻结）
└── patches/
    ├── 0001_baseline.py 基线标记（无 DDL）
    └── 0002_xxx.sql     你的下一个变更
```

## 三条铁律（写 patch 前先读）

1. **幂等**。同一份 patch 会分别应用到主库和**每一个**租户库。凡 `ALTER TABLE ADD COLUMN`，
   请用运行器支持的写法（SQLite 无 `IF NOT EXISTS`，见下方模板）；凡 `CREATE INDEX`，
   一律 `CREATE INDEX IF NOT EXISTS`。
2. **不碰数据语义**。改字段类型/重算金额这类操作必须单独一个版本、并在 `note` 里写清口径 ——
   它一旦跑错，`--all-tenants` 会把错误放大到每个租户。
3. **一个版本只做一件事**，名字说清楚干什么（`0007_purchase_orders_add_received_amount`）。
   失败时你能一眼看出该回滚哪一条。

## 写 SQL patch

```sql
-- 0007_purchase_orders_add_received_amount.sql
-- 采购单：补已收金额列（v403 之后新建的库有、老库缺）
ALTER TABLE purchase_orders ADD COLUMN received_amount REAL DEFAULT 0;
```

SQLite 的 `ALTER TABLE ADD COLUMN` **没有** `IF NOT EXISTS`。若该列可能已存在
（例如某个租户库早被别的手工脚本补过），写成 `.py` 并先查：

```python
# 0007_purchase_orders_add_received_amount.py
def upgrade(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(purchase_orders)")}
    if "received_amount" in cols:
        return "already present, skipped"
    conn.execute("ALTER TABLE purchase_orders ADD COLUMN received_amount REAL DEFAULT 0")
    return "added"
```

## 常用命令

```bash
cd /opt/hergent-erp

python3 -m migrations.runner --status                    # 主库状态
python3 -m migrations.runner --status --all-tenants      # 主库 + 所有租户库
python3 -m migrations.runner --apply --dry-run           # 只列将执行什么
python3 -m migrations.runner --apply --all-tenants       # 正式执行（新版本上线时用这个）

python3 -m migrations.doctor                             # 体检：版本 + 结构漂移
python3 -m migrations.doctor --json                      # 机器可读（给 cron / 看板）
```

退出码：`0` 干净、`2` 有问题需要人看、`1` 工具自身出错。

## 存量冻结（`_safe_migrate` 的 389 处）

```bash
# 盘点：多少处、都在哪、哪些同名冲突、哪些账外裸 DDL
python3 tools/hergent/v706/inventory_safe_migrate.py /opt/hergent-erp

# 验收（每次部署前跑；退出码 0=一致 / 2=有漂移）
python3 tools/hergent/v706/inventory_safe_migrate.py /opt/hergent-erp --check
```

它只做两件事，但都是**唯一能拦住**那两条静默病的地方：

| 漂移类型 | 判据 | 为什么必须拦 |
|---|---|---|
| 改了历史迁移的 SQL（名字不变） | 内容指纹变了 | 已经跑过它的库**永远不会**拿到新逻辑，且不报错 |
| 新增 `_safe_migrate(...)` 调用 | 名字不在基线里 | 新 DDL 绕过版本管理，重演同一类不可判定 |

已知边界（别指望它做）：

- SQL 是**拼接/常量引用**的 7 处，指纹落在**表达式**上：能抓到改片段，抓不到"改被引用的常量"。
- **2 处名字是 f-string/变量**（`v658_store_name_*`、`v20_promotions_*` 的循环），不入基线，需人工确认。
- **账外裸 DDL 还有 341 处**（`CREATE TABLE IF NOT EXISTS` 直接写在函数体里、
  `db/queries/*.py` 那 42 处是同一批迁移的第二份拷贝）—— 本工具**不覆盖**它们，属于未清欠账。

## 新租户怎么办

`tenant_db_init()` 用 `iterdump()` 只复制**主库当时**的 CREATE 语句，历史 patch 的
`ALTER` 它拿不到。所以：

> 新建租户后，必须对该库跑一次 `--apply`（或直接跑 `--all-tenants`），
> 否则它的结构会停在"建库那一刻"，而 `schema_patches` 会如实显示它缺哪几版。

## 回滚

- **单个版本回滚**：本工具**不提供**自动 downgrade。原因：SQLite 的 DROP COLUMN
  与数据回滚无法保证正确，自动 downgrade 只会让人误以为"按一下就能回到过去"。
  回滚 = 写一个新版本号做反向变更 + 恢复备份，两步都要人确认。
- **整套移除**：`DROP TABLE schema_patches;`（就这一张表，且不含业务数据）。
  删掉 `migrations/` 目录即可回到 v705 之前的状态 —— 业务表**一个字节都没被改过**。

## 已知边界（别指望它做）

- 它管**结构**，不管**数据修复**（数据修复是另一类作业，必须单独评审）。
- `erp_db.py` 里 389 处 `_safe_migrate` 仍会照旧运行（已冻结基线，不许增改）。
  本目录不会替它们排序或去重 —— 排序只对"以后新写的 patch"有意义。
- `doctor` 只做结构对账，不判断业务口径是否正确（那要业务规则）。
