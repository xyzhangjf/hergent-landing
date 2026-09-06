# 目标与返利 45 项修复 —— 全量交付概览（2026-08-31）

## 做了什么
按《目标与返利全面审核报告-2026-08-31.md》的 45 项问题（P0×1 + P1×14 + P2×16），按 R 编号**依次全做**，端到端完成：改前端 + 改后端 + 部署生产 + 生产 E2E 验证。

## 修复批次（任务 #342-#350）
| 批次 | 内容 | 状态 |
|---|---|---|
| #342 R1 P0 | 试算接口契约错位（`{rule_id, actual_value}` 主契约） | ✅ |
| #343 R38 P1 | RBAC 四接口统一 `sales` 权限域 | ✅ |
| #344 R4+R6 P1 | 合同删除级联 + 已结算 409 保护 + 老合同重算保护 | ✅ |
| #345 R2 P1 | 季/年/自定义周期达成录入（`_norm_month` 支持 2026-Q3） | ✅ |
| #346 R8+R9 P1 | AI 返利卡阶梯（tiers_json）+ 全年达成口径 | ✅ |
| #347 P1 后端批 | R3/R5(后端)/R7/R28-R32/R37 健壮性 | ✅ |
| #348 P1 前端批 | R41 服务端 status / R5 三态 / R13 弹窗 / R14 防抖 / R21 主题色 / R39 商品键映射 / R40 双份算法注释 | ✅ |
| #349 P2 全量批 | R10-R12/R15-R20/R22-R27/R33-R36/R42-R45（筛选/复制/搜索/竞态/月份联动/确认弹窗/导入预览/重提/打印/零值等） | ✅ |
| #350 部署+E2E | 生产部署 + 23/23 项端到端验证 | ✅ |

## 部署
- 后端：rsync flatten → `chown hergent` → 清 `__pycache__` → `systemctl restart` → health 200
- 前端：rsync `--delete dist/` → `/opt/hergent-cn-v2` → chown
- 服务器侧 grep 核验：`_compute_status`×2 / `include_inactive`×3 / `preview`×10 / R40 注释；前端 `include_inactive`(Rebate chunk) / `hard=1`(modules chunk) / 导入两阶段文案命中

## 生产 E2E（mptest 登录 + tenant_1 库）：23/23 PASS
R38 四接口 200 / R41 status 字段 / R5 三态全链路（创建→upcoming→停用→可见→隐藏→启用→软删→物理删→gone）/ R1 simulate / R34 导入干跑不落库→确认落库 / R2 季键 / R45 显式 0 值保存。**测试数据零残留。**

## 部署中暴露并修复的真 bug
R41 `_compute_status(r)` 对 sqlite3.Row 调 `.get()` → `AttributeError` → `GET /api/rebate-rules` 500。
修复：入口 `if not isinstance(r, dict): r = dict(r)`。已重部署 + 重跑 E2E 全绿。
教训已沉淀：**工具函数勿对 sqlite3.Row 用 `.get()`；py_compile 只验语法；生产 E2E 必须覆盖列表类 GET 接口**（已写入 MEMORY.md 后端踩坑铁律）。

## 需确认事项
1. 两个仓库均未 push（hergent-erp 分支 upgrade/v84-international；laozhangai-product main），如需推送请告知。
2. 建议浏览器真机抽查（hergent.cn → 目标与返利）：规则停用/启用按钮、合同弹窗月度折叠、导入「预览并校验」两阶段、计提/重提按钮语义。
3. R38 权限统一 sales 后，stock 角色的用户访问返利页会出现 403——若生产有多角色共存需确认口径。
