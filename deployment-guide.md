# Phase 4 部署指南

## 当前状态

- ✅ 代码已提交到本地 git (commit: f79de8e)
- ✅ 全量测试通过: 322 passed, 28 skipped, 0 failed
- ✅ 验证脚本就绪: `tests/validate_production.py`
- ⚠️ 当前网络环境无法连接 GitHub，需用户手动推送和部署

## 部署步骤

### 1. 推送代码到 GitHub

```bash
cd /Users/zhangjunfeng/Documents/hergent-erp
git push origin upgrade/v84-international
```

### 2. SSH 到生产服务器

```bash
ssh hergent@47.113.224.140
cd /opt/hergent-erp  # 或实际部署目录
```

### 3. 拉取最新代码

```bash
# 注意: Git 历史已重写(v90.1)，必须用 reset 而非 pull
git fetch origin
git reset --hard origin/upgrade/v84-international
```

### 4. 安装依赖（如有变更）

```bash
pip install -r server/requirements.lock
```

### 5. 重启服务

```bash
# 如果用 Docker:
docker-compose down && docker-compose up -d

# 如果直接运行:
pkill -f "python3 server/server.py" || true
ERP_SECRET=xxx ENV=production nohup python3 server/server.py > /tmp/erp.log 2>&1 &
```

### 6. 验证迁移

```bash
# 检查新表是否创建
python3 -c "
import sqlite3
conn = sqlite3.connect('/data/erp.db')  # 或实际 DB 路径
c = conn.cursor()
for t in ['wastage_orders','wastage_order_items','procurement_plans','procurement_plan_items']:
    try:
        c.execute(f'SELECT COUNT(*) FROM {t}')
        print(f'  ✅ {t}')
    except:
        print(f'  ❌ {t} — 迁移失败')
conn.close()
"
```

### 7. 运行生产数据验收

```bash
cd /opt/hergent-erp
ERP_SECRET=xxx python3 tests/validate_production.py
```

预期结果（371商品/672客户/525订单/8024专属价）:
- 定价引擎准确率 > 98%
- FEFO 违规率 < 5%
- 临期预警覆盖所有有效期库存
- 盈亏快报格式完整
- 预测偏差 < 30% 的产品比例 > 60%
- 报损单表结构完整

### 8. 线上冒烟测试

```bash
# API 可用性
curl -s http://localhost:8700/api/health

# 前端加载
curl -s -o /dev/null -w "%{http_code}" http://localhost:8700/

# 新 API 端点
curl -s -H "Authorization: Bearer <token>" http://localhost:8700/api/wastage/summary
curl -s -H "Authorization: Bearer <token>" http://localhost:8700/api/procurement/plans
curl -s -H "Authorization: Bearer <token>" http://localhost:8700/api/forecast/overview
```

### 9. 检查磁盘空间

```bash
df -h /  # 当前 46%，注意监控
```

### 10. 备份验证

```bash
ls -la /opt/hergent-erp/backups/  # 检查最新备份
```

## 回滚方案

如果部署后出现问题:

```bash
# 回到上一个版本
git log --oneline -5  # 找到上一个 commit hash
git reset --hard <previous-hash>
# 重启服务
```

## 新增 API 端点一览

| 端点 | 方法 | 功能 |
|------|------|------|
| /api/pricing/match | POST | 专属价匹配 |
| /api/pricing/match-batch | POST | 批量价格匹配 |
| /api/pricing/explain | GET | 价格解释 |
| /api/batch/expiry-scan | GET | 临期扫描 |
| /api/batch/discount-suggestions | GET | 折扣建议 |
| /api/batch/fefo-check | GET | FEFO 违规检查 |
| /api/batch/trace/{batch_no} | GET | 批次追溯 |
| /api/batch/analytics | GET | 保质期分析 |
| /api/profit-report/daily | GET | 每日盈亏快报 |
| /api/profit-report/push | POST | 推送盈亏到企微 |
| /api/forecast/product/{id} | GET | 单品预测 |
| /api/forecast/overview | GET | 预测概览 |
| /api/procurement/generate-plan | POST | 生成采购计划 |
| /api/procurement/plans | GET | 采购计划列表 |
| /api/procurement/plans/{id}/approve | POST | 审批采购计划 |
| /api/procurement/push | POST | 推送采购到企微 |
| /api/procurement/auto-generate | POST | 自动生成+推送 |
| /api/wastage/create | POST | 创建报损单 |
| /api/wastage/list | GET | 报损单列表 |
| /api/wastage/{id} | GET | 报损单详情 |
| /api/wastage/{id}/reject | POST | 撤销报损单 |
| /api/wastage/summary | GET | 报损汇总 |
| /api/wastage/suggest-from-expiry | GET | 临期报损建议 |

## 新增前端模块

| 模块 | API | 功能 |
|------|-----|------|
| pricing-helper.js | window.HergentPricing | 自动价格匹配 |
| expiry-dashboard.js | window.HergentExpiryDashboard | 临期看板 |
| profit-report.js | window.HergentProfitReport | 盈亏快报看板 |
| procurement-console.js | window.HergentProcurement | 采购控制台 |
| wastage-console.js | window.HergentWastage | 报损管理 |
