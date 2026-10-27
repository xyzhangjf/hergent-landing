"""Hergent ERP 版本化迁移（batch A / v705）。

    from migrations import dbutil, runner, doctor

目录约定见 `README.md`。三句话概括：

1. **新结构变更只允许写成 `migrations/patches/NNNN_名字.sql|py`**，不要再往
   `erp_db.py` 里加 `_safe_migrate(...)`（那里已有 359 处历史欠账，正在逐批收编）。
2. 每个库（主库 + 每个租户库）**各自**有一张 `schema_patches`，记录版本、内容指纹、
   执行时间。指纹不符 ⇒ 直接失败，**不静默跳过**。
3. 体检用 `python3 -m migrations.doctor`，应用用 `python3 -m migrations.runner --apply`。

版本号规划：v705 为批量引入，`0001` 是基线标记（无 DDL）。
"""

__all__ = ["dbutil", "runner", "doctor"]
