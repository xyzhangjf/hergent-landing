# 往期预报看板空白 — 修复说明

## 现象
预报订货管理 →「往期预报」标签页显示"暂无历史预报期次"，即使已创建期次也看不到数据。

## 根因（服务端 500，非前端）
`server/erp_db.py` 的 `forecast_order_board()` 中，`_agg()` 返回的是 `sqlite3.Row` 对象，但代码用了 `agg.get("submission_count")`——**`sqlite3.Row` 没有 `.get()` 方法**（只有字典有），抛出 `AttributeError`。

线索（生产日志）：
```
erp_db.py line 12269: if int(agg.get("submission_count") or 0) == 0:
AttributeError: 'sqlite3.Row' object has no attribute 'get'
```

由于只要有真实数据就必崩，所有租户都受影响：
- tenant_1（430 商品/3 期次）会在第 12255 行崩；
- tenant_10（demo 账号，0 期次/66 提交）会在第 12269 行崩。

前端 `ForecastHistory.vue` 的 `load()` 把异常 catch 掉、`list=[]`，于是显示"暂无历史预报期次"。

## 修复
`erp_db.py:12229` —— 让 `_agg()` 返回字典：
```python
).fetchone()
agg = dict(agg) if agg else {"reporter_count": 0, "total_qty": 0, "total_amount": 0, "submission_count": 0}
finalized = db.execute(...)
```

## 部署与验证
- `bash deploy.sh`（安全部署：保留 `.env` / `*.db`，绝不动生产机密与数据）。
- 服务 `systemctl restart hergent-erp`，`/api/health` 返回 200。
- curl 复现：demo-login → `GET /api/forecast/order-board`
  - 修复前：`{"success":false,"detail":"Internal server error"}`（500）
  - 修复后：返回 6 行（tenant_10 的提交日期汇总，含报单人数/总件数/下单金额）

## 请你注意的一件事（数据/租户归属）
你创建的期次实际落在 **tenant_1**（经销商主库：430 商品 / 3 期次），而你的 `demo_boss`（张记乳品演示）账号当前被绑到 **tenant_10**（演示库：11 商品 / 0 期次 / 66 提交）。「演示登录」按 `subdomain='demo'` 固定进 tenant_10。

所以：修复后你以 demo_boss 登录，往期预报会显示 **tenant_10 的提交历史（08-17~08-22）**，而不是 tenant_1 里你建的那两期。若想直接看到自己创建的期次，可选：
1. 用拥有 tenant_1 的账号（admin / boss）登录；或
2. 我把 `demo_boss` 映射到 tenant_1（让演示账号指向真实数据）。

需要我做第 2 项的话告诉我即可。
